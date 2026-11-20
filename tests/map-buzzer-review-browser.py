"""An older board flagged as a buzzer map plays as a timed pin round.
Checks private pin receipts, the deadline, tolerance advice and manual grading.
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
     'roundMode':'buzzer','points':300,'seconds':75,'answerTolerance':100,'prompt':'Wo liegt das Ziel?',
     'mapTargetSet':True,'mapTargetX':50,'mapTargetY':50,'answer':'',
     'scene':{'template':'map','version':2,'elements':[{'id':'heading','kind':'text','role':'question','text':'Wo liegt das Ziel?','x':58,'y':34,'w':884,'h':106,'step':0}]}}
  await host.evaluate('(q)=>window.__probe.setQuiz({title:"Kartenrunde QA",teams:["Rot","Blau"],questions:[q]})',q)
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
  await host.locator('[data-action="uncover-question"]').click()
  await guest.wait_for_function("() => window.__probe.info().publicState?.current?.id==='map-buzzer'",timeout=12000)
  current=await guest.evaluate('window.__probe.info().publicState.current')
  assert current['roundMode']=='written' and 'mapTargetX' not in current,current
  assert 'answerTolerance' not in current
  await expect(guest.locator('[data-action="buzz"]')).to_have_count(0)
  await expect(guest.locator('#clock')).to_be_visible()
  atlas=guest.locator('.bq-map-viewport[data-map-choice="true"]')
  await expect(atlas).to_be_visible(timeout=12000)
  rect=await atlas.bounding_box()
  assert rect
  await guest.mouse.click(rect['x']+rect['width']*.5,rect['y']+rect['height']*.5)
  await expect(guest.locator('.bq-map-pin.is-self')).to_have_count(1,timeout=12000)
  await expect(guest.locator('.bq-map-result')).to_contain_text('Pin gespeichert')
  await host.wait_for_function("() => Object.values(window.__probe.getGame().data.responses?.['1']||{}).some(v=>!!v.text)",timeout=12000)
  await expect(host.locator('.bq-map-pin-log')).to_contain_text('1 Pin eingegangen')
  first=await host.evaluate("Object.values(window.__probe.getGame().data.responses['1'])[0]")
  assert await host.evaluate("window.__probe.info().publicState.phase")=='question'
  await guest.mouse.click(rect['x']+rect['width']*.65,rect['y']+rect['height']*.45)
  await host.wait_for_function("first => Object.values(window.__probe.getGame().data.responses['1'])[0].text!==first",arg=first['text'])
  updated=await host.evaluate("Object.values(window.__probe.getGame().data.responses['1'])[0]")
  assert updated['at']==first['at'] and updated['updatedAt']>=first['updatedAt']
  assert await guest.evaluate("""async()=>{
   try { await window.__probe.getGame().buzzer(window.__probe.room(),1); return false; }
   catch { return true; }
  }""")
  assert await guest.locator('.bq-map-pin.is-solution').count()==0
  await host.evaluate("""async()=>{
   const {room}=window.__probe, state=window.__probe.info().publicState;
   await window.__probe.getGame().updateCurrent(room(),state.round,state.current.id,{deadline:Date.now()+900},['question']);
  }""")
  await guest.wait_for_function("() => window.__probe.info().publicState?.phase==='review'",timeout=10000)
  assert await guest.evaluate("""async()=>{
   try { await window.__probe.getGame().answer(window.__probe.room(),1,'t1','@map:10,10'); return false; }
   catch { return true; }
  }""")
  await host.locator('[data-action="reveal-all-answers"]').click()
  await expect(host.get_by_text('Außerhalb der Toleranz',exact=False)).to_be_visible()
  await expect(guest.get_by_text('Außerhalb der Toleranz',exact=False)).to_have_count(0)
  await host.locator('[data-action="judge-review-correct"]').click()
  await host.locator('[data-action="reveal"]').click()
  for page in (host,guest):
   await page.wait_for_function("() => window.__probe.info().publicState?.phase==='reveal'",timeout=12000)
   await expect(page.locator('.bq-review-map-distance')).to_have_count(1,timeout=15000)
   await expect(page.locator('.bq-map-pin.is-solution')).to_have_count(1)
  await expect(host.locator('[data-action="back"]')).to_have_text('Weiter zum Quizbrett')
  assert await host.evaluate("window.__probe.info().publicState.scores.t1")==600
  await host.locator('[data-action="back"]').click()
  await expect(guest.locator('.bq-board-scene')).to_be_visible(timeout=12000)
  assert not errors,errors
  await browser.close()
  print('PASS legacy map opens as a timed pin round: immediate receipt, revisions, cutoff, secret coordinates, manual grade')

if __name__=='__main__':asyncio.run(main())
