"""End-to-end Joker UI smoke test with real host/guest browser views and mock PeerJS.
Checks joker card privacy, hidden drops, reroll, protective score, Oracle, and
Chronobreak. Separate native-network tests cover WebRTC itself.
"""
import asyncio,importlib.util
from pathlib import Path
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_joker_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

async def join(ctx,host,room,name,team):
 async with ctx.expect_page() as opening:
  await host.evaluate("window.open('about:blank','_blank')")
 page=await opening.value
 await fixture.install(page)
 await page.locator('#join-room').fill(room)
 await page.locator('#join-name').fill(name)
 await page.locator('#join-form button[type="submit"]').click()
 await page.locator('.bq-lobby-notice').wait_for(timeout=15000)
 uid=await host.evaluate("(name)=>Object.entries(window.__probe.getGame().data.members).find(([,m])=>m.name===name)[0]",name)
 await host.locator('#team-'+uid).select_option(team)
 await host.locator('[data-action="approve"][data-uid="'+uid+'"]').click()
 await page.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=15000)
 return page

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  errors=[]
  host=await ctx.new_page();host.on('pageerror',lambda e:errors.append('host '+str(e)))
  await fixture.install(host)
  await host.locator('.bq-legacy-options>summary').click()
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  room=await host.evaluate('window.__probe.room()')
  questions=[{'id':ch,'boardRound':1,'category':'Jokerprobe','title':'Frage '+ch,'type':'text','roundMode':'buzzer',
              'points':(i+1)*100,'prompt':'Rate Champion '+ch,'answer':'Anivia','oracleHint':'VERTRAULICHER ORAKELTIPP'}
             for i,ch in enumerate('abcd')]
  settings={'enabled':True,'starting':True,'drops':{'shield':1,'oracle':1,'reroll':1,'chrono':1}}
  await host.evaluate('(payload)=>window.__probe.setQuiz({title:"Joker QA",teams:["Rot","Blau"],questions:payload.questions,jokerConfig:payload.settings})',
                      {'questions':questions,'settings':settings})
  await host.locator('[data-action="publish"]').first.click()
  await expect(host.locator('.bq-board-scene .tile')).to_have_count(4,timeout=15000)
  await host.locator('.top-nav [data-view="teams"]').click()
  alice=await join(ctx,host,room,'Alice','t1')
  bob=await join(ctx,host,room,'Bob','t2')
  alice.on('pageerror',lambda e:errors.append('alice '+str(e)))
  bob.on('pageerror',lambda e:errors.append('bob '+str(e)))
  await host.locator('.top-nav [data-view="live"]').click()
  for page in (host,alice,bob):
   await expect(page.locator('.bq-joker-panel')).to_have_count(1,timeout=15000)
   await expect(page.locator('.bq-joker-token')).to_have_count(8)
  assert await host.evaluate("Object.keys(window.__probe.getGame().data.jokerDrops).length")==4

  # Hidden drop stays secret while the host has selected but not revealed a question.
  await host.locator('[data-action="open"][data-qid="a"]').click()
  await expect(host.locator('.bq-question-covered')).to_be_visible()
  assert await alice.locator('.bq-joker-event').count()==0
  await alice.locator('[data-action="joker-use"][data-type="reroll"]').click()
  await expect(host.locator('.bq-reroll-request')).to_be_visible(timeout=15000)
  await host.locator('[data-action="joker-reroll-accept"]').click()
  await expect(host.locator('.bq-board-scene')).to_be_visible()
  await expect(host.locator('[data-action="open"][data-qid="a"]')).to_be_disabled()
  await expect(host.locator('[data-action="open"][data-qid="b"]')).to_be_enabled()
  assert await alice.evaluate("window.__probe.info().publicState.jokers.t1.reroll")==0
  print('PASS: covered question rerolls via host approval; no early drop disclosure',flush=True)

  # Reveal guarantees one of the four secret drops, but only after uncovering.
  await host.locator('[data-action="open"][data-qid="b"]').click()
  assert await bob.locator('.bq-joker-event').count()==0
  await host.locator('[data-action="uncover-question"]').click()
  await expect(bob.locator('.bq-joker-event')).to_be_visible(timeout=15000)
  assert 'VERTRAULICHER ORAKELTIPP' not in str(await bob.evaluate("window.__probe.info().publicState"))
  await alice.locator('[data-action="joker-use"][data-type="oracle"]').click()
  await expect(alice.locator('.bq-oracle-private')).to_contain_text('VERTRAULICHER ORAKELTIPP',timeout=15000)
  assert await bob.locator('.bq-oracle-private').count()==0
  assert 'VERTRAULICHER ORAKELTIPP' not in str(await bob.evaluate("window.__probe.info().publicState"))
  print('PASS: Oracle Lens hint is private to the receiving team and hidden during preparation',flush=True)

  # The protective Joker is armed first, charged only when the wrong answer is judged.
  await alice.locator('[data-action="joker-use"][data-type="shield"]').click()
  await alice.locator('[data-action="buzz"]').click()
  await host.locator('[data-action="buzz-wrong"]').click()
  await alice.wait_for_function("()=>window.__probe.info().publicState?.jokers?.t1?.shield===0",timeout=15000)
  assert await host.evaluate("window.__probe.info().publicState.scores.t1")==0
  await expect(bob.locator('[data-action="buzz"]')).to_be_enabled(timeout=15000)
  await bob.locator('[data-action="buzz"]').click()
  await host.locator('[data-action="buzz-correct"]').click()
  await expect(host.locator('.bq-joker-event')).to_contain_text('Aufladung erhalten',timeout=15000)
  assert await host.evaluate("window.__probe.info().publicState.jokerEvent.team")=='t2'
  await host.locator('[data-action="back"]').click()
  print('PASS: shield prevents a negative score and correct answer awards one dropped joker',flush=True)

  # Chronobreak freezes host controls and allows only the current buzzer to correct.
  await host.locator('[data-action="open"][data-qid="c"]').click()
  await host.locator('[data-action="uncover-question"]').click()
  await alice.locator('[data-action="buzz"]').click()
  await expect(alice.locator('.bq-chrono-quick-wrap [data-type="chrono"]')).to_be_visible(timeout=15000)
  await alice.locator('.bq-chrono-quick-wrap [data-type="chrono"]').click()
  await expect(host.locator('.bq-chrono-overlay.is-host-lock')).to_be_visible(timeout=15000)
  await expect(bob.locator('.bq-chrono-overlay')).to_contain_text('CHRONOBREAK',timeout=15000)
  await alice.locator('#chrono-correction').fill('Korrigierte Antwort')
  await alice.locator('[data-action="joker-chrono-answer"]').click()
  await host.wait_for_function("()=>window.__probe.getGame().hostChronoAnswer(window.__probe.room(),3)==='Korrigierte Antwort'",timeout=15000)
  await expect(host.locator('.bq-chrono-overlay')).to_have_count(0,timeout=15000)
  assert await alice.evaluate("window.__probe.info().publicState.jokers.t1.chrono")==0
  assert not errors,errors
  await ctx.close();await browser.close()
  print('PASS: Chronobreak is visible to all and host controls resume after an eight-second correction',flush=True)

if __name__=='__main__':asyncio.run(main())
