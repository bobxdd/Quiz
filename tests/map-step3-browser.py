"""Full map-question editor E2E on the actual static BrainQuiz site.
No external server/PeerJS required: uses a local host-only draft.
"""
import asyncio,functools,threading,shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright, expect
from board_library_test_support import read_board, wait_board_saved

ROOT=Path(__file__).resolve().parents[1] / 'docs'
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass

async def run():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 url=f'http://127.0.0.1:{server.server_port}/'
 errors=[]
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(args=['--no-sandbox'])
   ctx=await browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
   page=await ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(url)
   await page.locator('.bq-legacy-options>summary').click()
   await page.get_by_role('button',name='Quizbrett bearbeiten').click()
   await page.locator('.se-category-overview').wait_for()
   await page.locator('.se-list [data-se-action="category-form"]').click()
   await page.locator('[data-se-category-name]').fill('Weltkarte')
   await page.locator('[data-se-category-form] button[type="submit"]').click()
   await page.locator('[data-se-action="new"][data-template="map"]').click()
   await page.locator('.bq-map-viewport').wait_for()
   assert await page.locator('.bq-map-required').count()==1,'missing host requirement'
   assert await page.locator('.bq-map-viewport img[src$="world-map.svg"]').count()==1
   await wait_board_saved(page)
   saved=(await read_board(page))['quiz']['questions'][0]
   assert not saved['mapTargetSet'],'unset host position was incorrectly complete'
   print('PASS: fresh map question is incomplete until host deliberately drops dagger')
   await expect(page.locator('[data-se-roundmode]')).to_have_count(0)
   await page.locator('[data-se-field="mapPrompt"]').fill('Wo befindet sich diese Stadt?')
   await page.locator('[data-se-field="mapPrompt"]').blur()
   await page.wait_for_timeout(700)
   await page.locator('.bq-map-title h2').get_by_text('Wo befindet sich diese Stadt?').wait_for()
   rect=await page.locator('.bq-map-viewport').bounding_box()
   assert rect['width']>=400 and rect['height']>=190,rect
   assert abs(rect['width']/rect['height']-2)<.035,'World map is distorted: '+str(rect)
   visual=await page.locator('.bq-map-viewport').evaluate('(e)=>({bg:getComputedStyle(e).backgroundColor,fit:getComputedStyle(e.querySelector(".bq-map-layer img")).objectFit})')
   assert visual['fit']=='contain' and visual['bg']!='rgb(237, 241, 243)',visual
   await page.mouse.click(rect['x']+rect['width']*.63,rect['y']+rect['height']*.42)
   await page.locator('.bq-map-valid').wait_for()
   assert await page.locator('.bq-map-pin.is-host img[src$="dagger-pin.svg"]').count()==1
   await wait_board_saved(page)
   saved=(await read_board(page))['quiz']['questions'][0]
   assert saved['mapTargetSet'] is True,saved
   assert abs(saved['mapTargetX']-63)<1 and abs(saved['mapTargetY']-42)<1,saved
   print('PASS: actual mouse click sets and persists secret dagger target with fractional coordinates')
   old=(saved['mapTargetX'],saved['mapTargetY'])
   await page.locator('[data-map-zoom="in"]').click()
   await expect(page.locator('.bq-map-zoom-value')).to_have_text('150 %')
   await page.locator('.bq-map-viewport').hover()
   await page.mouse.wheel(0,-140)
   await page.wait_for_timeout(120)
   zoomed=await page.locator('.bq-map-zoom-value').inner_text()
   assert zoomed!='150 %',zoomed
   rect=await page.locator('.bq-map-viewport').bounding_box()
   await page.mouse.move(rect['x']+rect['width']*.48,rect['y']+rect['height']*.5)
   await page.mouse.down();await page.mouse.move(rect['x']+rect['width']*.57,rect['y']+rect['height']*.47,steps=5)
   await page.mouse.up()
   await wait_board_saved(page)
   same=(await read_board(page))['quiz']['questions'][0]
   assert (same['mapTargetX'],same['mapTargetY'])==old,'zoom/pan unexpectedly moved solution'
   print('PASS: zoom controls, mouse wheel and pan do not alter saved answer coordinates')
   await page.locator('.bq-map-viewport').focus()
   await page.keyboard.press('ArrowLeft')
   await page.keyboard.press('Enter')
   await page.locator('.bq-map-valid').wait_for()
   await wait_board_saved(page)
   saved=(await read_board(page))['quiz']['questions'][0]
   assert (saved['mapTargetX'],saved['mapTargetY'])!=old,'keyboard placement did not update answer'
   print('PASS: map keyboard navigation and Enter place a new answer')
   await page.reload()
   await page.locator('.bq-legacy-options>summary').click()
   await page.get_by_role('button',name='Quizbrett bearbeiten').click()
   await page.locator('[data-se-action="category-select"][data-category="Weltkarte"]').first.click()
   await page.locator('.bq-map-pin.is-host img').wait_for()
   assert await page.locator('.bq-map-valid').count()==1
   print('PASS: page reload preserves host target')
   await page.locator('[data-se-action="map-clear"]').click()
   await page.locator('.bq-map-required').wait_for()
   await wait_board_saved(page)
   saved=(await read_board(page))['quiz']['questions'][0]
   assert saved['mapTargetSet'] is False
   print('PASS: removing marker reverts quiz question to incomplete')
   await page.set_viewport_size({'width':390,'height':800})
   await page.locator('[data-se-action="mobile-tab"][data-mobile-tab="canvas"]').click()
   await page.locator('.se-editor-v3 .se-main').wait_for(state='visible')
   await page.locator('.bq-map-viewport').wait_for(state='visible')
   await page.wait_for_timeout(220)
   widths=await page.evaluate("() => ({w:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})")
   assert widths['content']<=widths['w']+8,widths
   rect=await page.locator('.bq-map-viewport').bounding_box()
   assert rect and rect['height']>=140 and abs(rect['width']/rect['height']-2)<.04,rect
   print('PASS: undistorted mobile map proportions and no horizontal overflow')
   assert not errors,errors
   await browser.close()
 finally:server.shutdown();server.server_close()

if __name__=='__main__':asyncio.run(run())
