"""Step 5: browser geometry, visual states and no-emotion regression.
Uses the real local editor and Chromium; no claim about external PeerJS/ICE.
The test-only hook changes only the in-memory round counter, never production code.
"""
import asyncio, functools, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.async_api import async_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa-artifacts'
OUT.mkdir(exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass

async def main():
 app=(ROOT/'docs/app.mjs').read_text(encoding='utf-8')
 anchor='function boardPeekRound(){'
 assert app.count(anchor)==1
 patched=app.replace(anchor,"window.__step5SetRound=(round)=>{if(publicState){publicState.round=round;publicState.phase='board';schedule();}};\n"+anchor,1)
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'docs')))
 threading.Thread(target=server.serve_forever,daemon=True).start()
 errors=[]
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(args=['--no-sandbox'])
   ctx=await browser.new_context(viewport={'width':1440,'height':900},service_workers='block',reduced_motion='reduce')
   page=await ctx.new_page()
   page.on('pageerror',lambda e:errors.append(str(e)))
   async def route_app(route):
    await route.fulfill(status=200,content_type='text/javascript',body=patched)
   await page.route('**/app.mjs',route_app)
   await page.goto(f'http://127.0.0.1:{server.server_port}/')
   await page.locator('.bq-legacy-options>summary').wait_for(timeout=12000)
   assert await page.locator('.bq-screen-watcher,.bq-scene-cameos,.bq-action-actor').count()==0
   await page.locator('.bq-legacy-options>summary').click()
   await page.get_by_role('button',name='Quizbrett bearbeiten').click()
   await page.locator('.se-board-context').wait_for(timeout=12000)
   assert await page.locator('.bq-screen-watcher,.bq-scene-cameos').count()==0,'Editor must remain clear'
   await page.locator('[data-se-action="category-preset"]').first.click()
   await page.locator('[data-se-action="new"]').first.click()
   await page.locator('.top-nav [data-action="view"][data-view="live"]').click()
   await page.locator('.bq-board-scene').wait_for(timeout=12000)
   await expect(page.locator('.bq-screen-watcher')).to_have_count(1)
   assert await page.locator('.bq-screen-watcher').is_visible()
   assert await page.locator('.bq-scene-cameos').count()==0,'Initial board must not show another actor'
   assert await page.locator('.bq-action-actor').count()==0
   await page.evaluate('window.__step5SetRound(3)')
   await expect(page.locator('.bq-scene-cameos')).to_have_count(1)
   await expect(page.locator('.bq-peek-fingers')).to_have_count(1)
   check=await page.evaluate("""() => {
     const cameo=document.querySelector('.bq-scene-cameos'),panel=document.querySelector('.bq-board-panel');
     const a=cameo.getBoundingClientRect(),b=panel.getBoundingClientRect();
     const watcher=document.querySelector('.bq-screen-watcher');
     return {cameoEnd:a.bottom,panelStart:b.top,sceneZ:Number(getComputedStyle(cameo).zIndex),
       panelZ:Number(getComputedStyle(panel).zIndex),watcherPointer:getComputedStyle(watcher).pointerEvents,
       count:document.querySelectorAll('.bq-scene-cameos .bq-actor').length};
   }""")
   assert check['count']==1,check
   assert check['panelZ']>check['sceneZ'] and check['cameoEnd']>check['panelStart'],check
   assert check['watcherPointer']=='none',check
   await page.screenshot(path=str(OUT/'step5-desktop-rare-peek.png'),animations='disabled')
   await page.evaluate('window.__step5SetRound(4)')
   await expect(page.locator('.bq-scene-cameos')).to_have_count(0)
   await expect(page.locator('.bq-peek-fingers')).to_have_count(0)
   await page.set_viewport_size({'width':390,'height':844})
   await page.evaluate('window.__step5SetRound(3)')
   await expect(page.locator('.bq-scene-cameos')).to_have_count(1)
   assert not await page.locator('.bq-screen-watcher').is_visible(),'Mobile watcher must be hidden'
   assert not await page.locator('.bq-scene-cameos').is_visible(),'Mobile cameo must not crowd UI'
   assert await page.locator('.bq-action-actor').count()==0
   assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 3'),'Unexpected horizontal overflow'
   await page.screenshot(path=str(OUT/'step5-mobile-clean-board.png'),animations='disabled')
   await page.locator('.top-nav [data-action="view"][data-view="editor"]').click()
   await page.locator('.se-board-context').wait_for(timeout=12000)
   assert await page.locator('.bq-screen-watcher,.bq-scene-cameos,.bq-peek-fingers').count()==0
   assert not errors,errors
   await browser.close()
 finally:
  server.shutdown();server.server_close()
 print('PASS Step 5: static single viewer, rare board-only cameo, genuine panel occlusion, no popups, mobile/editor clear')
if __name__=='__main__':asyncio.run(main())
