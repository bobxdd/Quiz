"""Host+guest real-browser UI regression for buzzer-mode map solution and winner.
Checks secret coordinates, announced winner/points and no written scoring controls.
"""
import asyncio,importlib.util
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_map_buzzer_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  host=await ctx.new_page();errors=[]
  host.on('pageerror',lambda e:errors.append('Host '+str(e)))
  await fixture.install(host)
  await host.locator('.bq-legacy-options>summary').click()
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await host.locator('.se-studio').wait_for()
  code=await host.evaluate('window.__probe.room()')
  q={'id':'map-buzzer','category':'Karten','title':'Wo liegt es?','type':'map',
     'roundMode':'buzzer','points':300,'prompt':'Wo liegt das Ziel?',
     'mapTargetSet':True,'mapTargetX':50,'mapTargetY':50,'answer':'',
     'scene':{'template':'map','version':2,'elements':[{'id':'heading','kind':'text','role':'question','text':'Wo liegt das Ziel?','x':58,'y':34,'w':884,'h':106,'step':0}]}}
  await host.evaluate('(q)=>window.__probe.setQuiz({title:"Map Buzz QA",teams:["Rot","Blau"],questions:[q]})',q)
  await host.locator('[data-action="publish"]').first.click()
  await host.locator('.top-nav [data-view="teams"]').click()
  async with ctx.expect_page() as opened:
   await host.evaluate("window.open('about:blank','_blank')")
  guest=await opened.value
  guest.on('pageerror',lambda e:errors.append('Gast '+str(e)))
  await fixture.install(guest)
  await guest.locator('#join-room').fill(code)
  await guest.locator('#join-name').fill('Alice')
  await guest.locator('button[type="submit"]').first.click()
  await guest.locator('.bq-lobby-notice').wait_for(timeout=12000)
  await host.locator('[data-action="approve"]').first.click()
  await guest.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=12000)
  await host.locator('.top-nav [data-view="live"]').click()
  await host.locator('[data-action="open"][data-qid="map-buzzer"]').click()
  await guest.wait_for_function("() => window.__probe.info().publicState?.current?.id==='map-buzzer'",timeout=12000)
  assert 'mapTargetX' not in await guest.evaluate('window.__probe.info().publicState.current')
  assert await guest.locator('.bq-quiz-verdict').count()==0
  await guest.locator('[data-action="buzz"]').click()
  await expect(host.locator('[data-action="buzz-correct"]')).to_be_visible(timeout=12000)
  rect=await guest.locator('.bq-map-viewport').bounding_box()
  assert rect
  await guest.mouse.click(rect['x']+rect['width']*.5,rect['y']+rect['height']*.5)
  await expect(guest.locator('.bq-map-pin.is-self')).to_have_count(1,timeout=12000)
  await guest.locator('[data-action="submit-map"]').click()
  await host.wait_for_function("() => Object.values(window.__probe.getGame().data.responses?.['1']||{}).some(v=>!!v.text)",timeout=12000)
  assert await guest.locator('.bq-map-pin.is-solution').count()==0
  await host.locator('[data-action="buzz-correct"]').click()
  for page in (host,guest):
   await page.wait_for_function("() => window.__probe.info().publicState?.phase==='reveal'",timeout=12000)
   await expect(page.locator('.bq-review-winner')).to_be_visible()
   await expect(page.locator('.bq-review-winner')).to_contain_text('Alice')
   await expect(page.locator('.bq-review-winner')).to_contain_text('+300 Punkte')
   await expect(page.locator('.bq-review-map-distance')).to_have_count(1,timeout=15000)
   await expect(page.locator('.review-summary')).to_contain_text('Buzzerentscheidung und Punktevergabe sind abgeschlossen')
   await expect(page.locator('.bq-map-pin.is-solution')).to_have_count(1)
   assert await page.locator('[data-action="judge-review-correct"]').count()==0
  await expect(host.locator('[data-action="back"]')).to_have_text('Weiter zum Quizbrett')
  assert await host.evaluate("window.__probe.info().publicState.scores.t1")==300
  await host.locator('[data-action="back"]').click()
  await expect(guest.locator('.bq-board-scene')).to_be_visible(timeout=12000)
  assert not errors,errors
  await browser.close()
  print('PASS buzzer map: winner prominently visible, accurate km review, no secret before decision, score and next-round flow')

if __name__=='__main__':asyncio.run(main())
