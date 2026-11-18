"""End-to-end Chromium proof: normal buzzer correctness atomically reveals the solution.
Tests host + two guests with independent app instances and mocked PeerJS transport.
This is a local multiplayer UI test, NOT a physical-device/ICE network test.
"""
import asyncio,base64,importlib.util,io,math,struct,wave
from pathlib import Path
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_reveal_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

def clip():
 out=io.BytesIO()
 with wave.open(out,'wb') as wf:
  wf.setnchannels(1);wf.setsampwidth(2);wf.setframerate(16000)
  wf.writeframes(b''.join(struct.pack('<h',int(12000*math.sin(i*2*math.pi*440/16000))) for i in range(9600)))
 return 'data:audio/wav;base64,'+base64.b64encode(out.getvalue()).decode()

async def join(ctx,host,room,name,team=None):
 async with ctx.expect_page() as opening:
  await host.evaluate("window.open('about:blank','_blank')")
 page=await opening.value
 await fixture.install(page)
 await page.locator('#join-room').fill(room)
 await page.locator('#join-name').fill(name)
 await page.locator('button[type="submit"]').first.click()
 await page.locator('.bq-lobby-notice').wait_for(timeout=12000)
 if team:
  uid=await host.evaluate("(name)=>Object.entries(window.__probe.getGame().data.members).find(([,m])=>m.name===name)[0]",name)
  await host.locator('#team-'+uid).select_option(team)
  await host.locator('[data-action="approve"][data-uid="'+uid+'"]').click()
 else:
  await host.locator('[data-action="approve"]').first.click()
 await page.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=12000)
 return page

async def check_revealed(page,expected):
 await page.wait_for_function("() => window.__probe.info().publicState?.phase==='reveal'",timeout=12000)
 await expect(page.locator('.stage .answer')).to_contain_text(expected,timeout=12000)

async def main():
 async with async_playwright() as playwright:
  browser=await playwright.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  host=await ctx.new_page();errors=[]
  host.on('pageerror',lambda ex:errors.append('Host: '+str(ex)))
  await fixture.install(host)
  await host.locator('.bq-legacy-options>summary').click()
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await host.locator('.se-studio').wait_for()
  room=await host.evaluate('window.__probe.room()')
  q=[
   {'id':'normal-text','category':'Normal','title':'Textfrage','type':'text','roundMode':'buzzer','points':100,
    'prompt':'Wer hat Eisflügel?','answer':'Anivia','explanation':'Anivia ist der Kryophönix.'},
   {'id':'normal-multiple','category':'Normal','title':'Auswahlfrage','type':'multiple','roundMode':'buzzer','points':200,
    'prompt':'Welche Antwort ist richtig?','options':['Azir','Braum','Caitlyn','Darius'],'correct':2,'answer':'Caitlyn'},
   {'id':'normal-audio','category':'Normal','title':'Soundfrage','type':'audio','roundMode':'buzzer','points':300,
    'prompt':'Welche Fähigkeit klingt so?','answer':'Anivias Q','audio':clip()},
   {'id':'normal-manual','category':'Normal','title':'Manuelle Auflösung','type':'text','roundMode':'buzzer','points':400,
    'prompt':'Wer wirbelt?','answer':'Garen'},
  ]
  await host.evaluate('(questions)=>window.__probe.setQuiz({title:"Buzzer QA",teams:["Rot","Blau"],questions})',q)
  await host.locator('[data-action="publish"]').first.click()
  await expect(host.locator('.bq-board-scene .tile')).to_have_count(4,timeout=12000)
  await host.locator('.top-nav [data-view="teams"]').click()
  alice=await join(ctx,host,room,'Alice')
  bob=await join(ctx,host,room,'Bob','t2')
  for page,name in [(alice,'Alice'),(bob,'Bob')]:
   page.on('pageerror',lambda ex,n=name:errors.append(n+': '+str(ex)))
  await host.locator('.top-nav [data-view="live"]').click()

  # First answer is wrong: hide solution, deduct -50, unlock Bob's buzzer.
  await host.locator('[data-action="open"][data-qid="normal-text"]').click()
  await host.locator('[data-action="uncover-question"]').click()
  await expect(alice.locator('.bq-big-buzzer')).to_be_visible(timeout=12000)
  for page in (alice,bob):
   assert (await page.evaluate("window.__probe.info().publicState.current.answer")) is None
  await alice.locator('[data-action="buzz"]').click()
  await host.locator('[data-action="buzz-wrong"]').wait_for(timeout=12000)
  await host.locator('[data-action="buzz-wrong"]').click()
  await expect(bob.locator('[data-action="buzz"]')).to_be_enabled(timeout=12000)
  assert await bob.evaluate("window.__probe.info().publicState.phase")=='question'
  assert (await bob.evaluate("window.__probe.info().publicState.current.answer")) is None
  await expect(bob.locator('.bq-quiz-verdict.is-wrong')).to_contain_text('Andere Spieler')
  await expect(alice.locator('[data-action="buzz"]')).to_be_disabled()
  assert 'Lösung bleibt verborgen' in await host.locator('.bq-host-main-status').inner_text()

  # Correct by Bob: score and solution are published in the same shared event.
  await bob.locator('[data-action="buzz"]').click()
  await host.locator('[data-action="buzz-correct"]').wait_for(timeout=12000)
  await host.locator('[data-action="buzz-correct"]').click()
  for page in (host,alice,bob):
   await check_revealed(page,'Anivia')
   assert await page.evaluate("window.__probe.info().publicState.current.answer")=='Anivia'
   assert await page.evaluate("window.__probe.info().publicState.buzzerResolved?.['1']?.team")=='t2'
  await expect(bob.locator('.bq-quiz-verdict.is-right')).to_contain_text('Richtig beantwortet')
  await expect(bob.locator('[data-action="buzz"]')).to_have_count(0)  # The completed round hides its inactive buzzer.
  await expect(host.locator('[data-action="buzz-correct"]')).to_have_count(0)
  await expect(host.locator('[data-action="reveal"]')).to_have_count(0)
  await expect(host.locator('[data-action="back"]')).to_have_text('Weiter zum Quizbrett')
  assert 'Anivia ist der Kryophönix.' in await alice.locator('.stage').inner_text()
  score=await host.evaluate("window.__probe.info().publicState.scores")
  assert score['t1']==-50 and score['t2']==100,score
  await host.evaluate('window.__probe.getGame()._changed()')
  await host.wait_for_timeout(200)
  assert await host.evaluate("window.__probe.info().publicState.scores.t2")==100,'Repeated state must not double count'
  await host.locator('[data-action="back"]').click()
  await expect(host.locator('.bq-board-scene')).to_be_visible()

  # Next multiple-choice question shows right choice and points without manual reveal.
  await host.locator('[data-action="open"][data-qid="normal-multiple"]').click()
  await host.locator('[data-action="uncover-question"]').click()
  await expect(alice.locator('[data-action="buzz"]')).to_be_enabled(timeout=12000)
  assert (await bob.evaluate("window.__probe.info().publicState.current.answer")) is None
  await alice.locator('[data-action="buzz"]').click()
  await host.locator('[data-action="buzz-correct"]').click()
  for page in (host,alice,bob):
   await check_revealed(page,'Caitlyn')
   assert await page.locator('.choices .choice.correct').count()==1
  score=await host.evaluate("window.__probe.info().publicState.scores")
  assert score['t1']==150 and score['t2']==100,score
  await host.locator('[data-action="back"]').click()

  # The existing host-controlled soundquiz also gets automatic answer reveal.
  await host.locator('[data-action="open"][data-qid="normal-audio"]').click()
  await host.locator('[data-action="uncover-question"]').click()
  await alice.locator('[data-action="buzz"]').click()
  await host.locator('[data-action="buzz-correct"]').click()
  for page in (host,alice,bob):
   await check_revealed(page,'Anivias Q')
   assert await page.locator('[data-action="audio-play"]').count()==0
  await host.locator('[data-action="back"]').click()

  # The host can still reveal manually when nobody buzzes; no bogus score.
  before=await host.evaluate("JSON.stringify(window.__probe.info().publicState.scores)")
  await host.locator('[data-action="open"][data-qid="normal-manual"]').click()
  await host.locator('[data-action="uncover-question"]').click()
  await host.locator('[data-action="reveal"]').click()
  for page in (host,alice,bob):await check_revealed(page,'Garen')
  after=await host.evaluate("JSON.stringify(window.__probe.info().publicState.scores)")
  assert after==before,'Manual reveal must not award points'
  assert not errors,errors
  await browser.close()
  print('PASS buzzer auto-reveal: wrong stays private/rebuzz, correct atomic solution/score for 3 types, next round, manual reveal, no browser errors')

if __name__=='__main__':asyncio.run(main())
