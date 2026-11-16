"""Live browser regression for four hints, world-map pins, shared private team chats and buzz lockouts. PeerJS mocked; GUI real."""
import asyncio,importlib.util,shutil
from pathlib import Path
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_peer',root/'tests/categories-3_0-browser.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

async def new_guest(ctx,code,name):
 print('GUEST',name,'opening',flush=True)
 async with ctx.expect_page() as opening:
  pages=ctx.pages;await pages[0].evaluate("window.open('about:blank','_blank')")
 page=await opening.value;print('GUEST',name,'install',flush=True);await mod.install(page);print('GUEST',name,'installed',flush=True)
 await page.locator('#join-room').fill(code);await page.locator('#join-name').fill(name)
 print('GUEST',name,'joining',flush=True);await page.locator('button[type="submit"]').first.click();print('GUEST',name,'clicked',flush=True)
 await page.locator('.bq-lobby-notice').wait_for(timeout=12000);print('GUEST',name,'pending',flush=True)
 return page

async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':900},reduced_motion='reduce')
  errors=[]
  host=await ctx.new_page();host.on('pageerror',lambda e:errors.append('Host '+str(e)))
  await mod.install(host)
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await host.locator('.se-studio').wait_for();code=await host.evaluate('window.__probe.room()')
  quiz={'title':'3.4 Regression','teams':['Rot','Blau'], 'questions':[
   {'id':'map-1','category':'Weltkarte','title':'Wo liegt die Stadt?','prompt':'Markiere den gesuchten Ort auf der Weltkarte','answer':'Ort in Afrika','type':'map','roundMode':'written','points':100,'mapTargetSet':True,'mapTargetX':57,'mapTargetY':54},
   {'id':'hints-1','category':'Rätsel','title':'Ratefigur','prompt':'Errate die Figur anhand der Tipps','answer':'Anivia','type':'text','roundMode':'buzzer','points':200,'hints':['Eis','Fliegt','Freljord','Wiedergeburt']}
  ]}
  await host.evaluate('(q)=>window.__probe.setQuiz(q)',quiz)
  await host.locator('[data-action="publish"]').first.click()
  await host.locator('.bq-board-scene').wait_for()
  print('PASS: quiz publish',flush=True)
  a=await new_guest(ctx,code,'Alice');b=await new_guest(ctx,code,'Bob');c=await new_guest(ctx,code,'Charlie')
  for p in [a,b,c]:p.on('pageerror',lambda err:errors.append('Guest '+str(err)))
  await host.locator('.top-nav [data-view="teams"]').click()
  for person in ['Alice','Bob']:
   await host.locator('[data-action="approve"]').first.click()
  await host.locator('[data-action="approve"]').first.wait_for()
  charlie_uid=await host.evaluate("() => Object.entries(window.__probe.getGame().data.members).find(([,m])=>m.name==='Charlie')[0]")
  await host.locator(f'#team-{charlie_uid}').select_option('t2')
  # A live member/presence refresh must not reset a pending team selection.
  await host.evaluate('window.__probe.getGame()._changed()')
  await host.locator(f'#team-{charlie_uid}').wait_for()
  assert await host.locator(f'#team-{charlie_uid}').input_value()=='t2'
  await host.locator(f'[data-action="approve"][data-uid="{charlie_uid}"]').click()
  await a.locator('.bq-lobby').wait_for();await b.locator('.bq-lobby').wait_for();await c.locator('.bq-lobby').wait_for()
  await a.locator('.bq-shared-team-chat summary').click()
  await a.locator('#chat-text').fill('Nur Team Rot sieht mich')
  await a.locator('#chat-form button[type="submit"]').click(timeout=3000)
  await b.locator('.bq-shared-team-chat summary').click()
  await b.locator('.chatfeed').get_by_text('Nur Team Rot sieht mich').wait_for(timeout=12000)
  await c.locator('.bq-shared-team-chat summary').click()
  print('TEAM DIAG',[(await x.evaluate('window.__probe.info()'))['member'] for x in [a,b,c]],flush=True)
  assert (await c.evaluate('window.__probe.info().member.team'))=='t2'

  print('CHAT DIAG',[(await x.locator('.chatfeed').inner_text()) for x in [a,b,c]],flush=True)
  assert await c.locator('.chatfeed').get_by_text('Nur Team Rot sieht mich').count()==0
  print('PASS: shared team chat, protected from other team',flush=True)
  await host.locator('.top-nav [data-view="live"]').click()
  await host.locator('.bq-board-scene .tile').first.click()
  for p in [a,b,c]:
   await p.locator('.bq-map-viewport').wait_for(state='visible',timeout=10000)
   await p.locator('.bq-map-viewport').click(position={'x':190,'y':135})
   await p.locator('.bq-map-pin.is-self').wait_for()
   await p.locator('[data-action="submit-answer"]').click()
  await host.locator('[data-action="start-review"]').first.click()
  await a.locator('.review-grid .review-card').first.wait_for(timeout=12000)
  assert await a.locator('.review-grid').get_by_text('@map:').count()==0
  assert await a.locator('.bq-map-pin.is-public').count()==0
  await host.locator('[data-action="reveal-answer"]').first.click()
  await a.locator('.bq-map-pin.is-public').first.wait_for(timeout=12000)
  assert await a.locator('.bq-map-pin.is-public').count()==1
  assert await a.locator('.bq-map-pin.is-solution').count()==0
  await host.locator('[data-action="reveal"]').first.click()
  await a.locator('.bq-map-pin.is-solution').first.wait_for(timeout=12000)
  print('PASS: map pin hidden, individual reveal, correct target only on solution',flush=True)
  await host.locator('[data-action="back"]').first.click()
  await host.locator('.bq-board-scene .tile:not([disabled])').first.click()
  await host.locator('.bq-question-scene .bq-host-action-bar [data-action="hint-next"]').wait_for(timeout=12000)
  for i,hint in enumerate(['Eis','Fliegt','Freljord','Wiedergeburt'],1):
   assert await a.get_by_text(hint,exact=True).count()==0
   await host.locator('[data-action="hint-next"]').click()
   await a.locator('.hintlist').get_by_text(hint).wait_for(timeout=12000)
   if i<4:assert await a.get_by_text(['Eis','Fliegt','Freljord','Wiedergeburt'][i],exact=True).count()==0
  print('PASS: exactly four progressive clues',flush=True)
  await a.locator('[data-action="buzz"]').click()
  await host.locator('[data-action="buzz-wrong"]').first.wait_for(timeout=12000)
  await host.locator('[data-action="buzz-wrong"]').first.click()
  await b.locator('[data-action="buzz"][disabled]').wait_for(timeout=12000)
  await c.locator('[data-action="buzz"]:not([disabled])').wait_for(timeout=12000)
  await c.locator('[data-action="buzz"]').click()
  await host.locator('[data-action="buzz-correct"]').first.click()
  data=await host.evaluate('window.__probe.info().publicState')
  assert data['scores']['t1']==-100,data
  assert data['scores']['t2']==200,data
  print('PASS: -50% team lock, others re-buzz, winner +points',flush=True)
  assert not errors,errors
  await browser.close()

if __name__=='__main__':asyncio.run(main())
