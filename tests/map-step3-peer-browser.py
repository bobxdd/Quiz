"""Two-client PeerJS-mocked E2E for world-map question privacy and answer lifecycle.
Exercises actual host/guest UI and app state, not real network ICE/TURN.
"""
import asyncio,importlib.util
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_categories',ROOT/'tests/categories-3_0-browser.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
install=module.install

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  errors=[]
  host=await ctx.new_page();host.on('pageerror',lambda err:errors.append('Host: '+str(err)))
  await install(host)
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await host.locator('.se-studio').wait_for()
  code=await host.evaluate('window.__probe.room()')
  assert len(code)==16

  q={'id':'map-e2e','category':'Geographie','title':'Weltkarte','type':'map','roundMode':'written','points':100,
     'prompt':'Wo befindet sich unser gesuchter Ort?','answer':'','mapTargetSet':True,'mapTargetX':67.321,'mapTargetY':34.112,
     'scene':{'template':'map','version':2,'elements':[{'id':'heading','kind':'text','role':'question','text':'Wo befindet sich unser gesuchter Ort?','x':58,'y':34,'w':884,'h':106,'step':0}]}}
  await host.evaluate('(q)=>window.__probe.setQuiz({title:"Kartenquiz",teams:["Rot","Blau"],questions:[q]})',q)
  await host.locator('[data-action="publish"]').first.click()
  await host.locator('.bq-board-scene .tile').first.wait_for()

  async with ctx.expect_page() as opening:
   await host.evaluate("window.open('about:blank','_blank')")
  guest=await opening.value;guest.on('pageerror',lambda err:errors.append('Gast: '+str(err)))
  await install(guest)
  await guest.locator('#join-room').fill(code);await guest.locator('#join-name').fill('Alice')
  await guest.locator('button[type="submit"]').first.click()
  await guest.get_by_text('FREIGABE AUSSTEHEND').wait_for(timeout=12000)
  await host.locator('.top-nav [data-view="teams"]').click()
  await host.locator('[data-action="approve"]').first.click()
  await guest.locator('.bq-board-scene').wait_for(timeout=12000)
  await host.locator('.top-nav [data-view="live"]').click()
  await host.locator('.bq-board-scene .tile').first.click()
  await guest.locator('.bq-map-viewport').wait_for(timeout=12000)
  qpublic=await guest.evaluate("window.__probe.info().publicState.current")
  assert 'mapTargetX' not in qpublic and 'mapTargetY' not in qpublic and 'mapTargetSet' not in qpublic,qpublic
  assert await guest.locator('.bq-map-pin.is-solution').count()==0
  assert await guest.locator('.bq-map-pin.is-host').count()==0
  assert '67.321' not in await guest.locator('.bq-question-scene').inner_text()
  print('PASS: host secret answer coordinates absent from guest state, markup, and visible text')
  rect=await guest.locator('.bq-map-viewport').bounding_box()
  assert rect and rect['width']>=900 and rect['height']>=300,rect
  await guest.mouse.click(rect['x']+rect['width']*.71,rect['y']+rect['height']*.42)
  await guest.locator('.bq-map-pin.is-self').wait_for()
  assert await guest.locator('[data-action="submit-answer"]').is_enabled()
  await guest.locator('[data-action="submit-answer"]').click()
  await guest.locator('[data-action="submit-answer"]').get_by_text('Pin aktualisieren').wait_for(timeout=12000)
  assert (await guest.evaluate('window.__probe.info().publicState.phase'))=='question'
  assert await guest.locator('.bq-map-pin.is-solution').count()==0
  # Repositioning is allowed even after first submission while the round stays open.
  rect=await guest.locator('.bq-map-viewport').bounding_box()
  await guest.mouse.click(rect['x']+rect['width']*.39,rect['y']+rect['height']*.55)
  await guest.locator('[data-action="submit-answer"]').click()
  answer=await host.evaluate("""() => Object.values(window.__probe.getGame().data.responses||{})""")
  assert any('39' in str(rec) for bucket in answer for rec in bucket.values()),answer
  print('PASS: guest can move and re-send their private pin until map round closes')
  await host.locator('[data-action="start-review"]').first.click()
  await guest.locator('.review-card.is-hidden').first.wait_for(timeout=12000)
  await host.locator('[data-action="reveal"]').first.click()
  await guest.locator('.bq-map-pin.is-solution img[src$="dagger-pin.svg"]').wait_for(timeout=12000)
  released=await guest.evaluate('window.__probe.info().publicState.current')
  assert abs(released['mapTargetX']-67.321)<.001
  assert abs(released['mapTargetY']-34.112)<.001
  print('PASS: solution dagger and exact host target appear only after host reveal')
  assert not errors,errors
  await browser.close()

if __name__=='__main__':asyncio.run(main())
