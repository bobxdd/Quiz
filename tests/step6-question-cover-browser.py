"""Step 6 – real Chromium UI check for slow once-only question covers.
Uses only local quiz UI, no external PeerJS/TURN or claimed cross-device testing.
"""
import asyncio,functools,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'qa-artifacts';ART.mkdir(exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass

async def main():
 source=(ROOT/'docs/app.mjs').read_text()
 anchor='function boardPeekRound(){'
 assert source.count(anchor)==1
 hook="""window.__step6Open=(n,id)=>{
  const q={id,category:'Animationsprobe',points:100,type:'text',prompt:'Wohin geht die Abdeckung?',blocks:[],hints:[]};
  publicState={...publicState,phase:'question',round:n,current:q,used:{...publicState.used,[id]:true},
   board:{...publicState.board,[id]:{id,category:q.category,points:100,used:true}}};
  role='host';view='live';schedule();
 };
 window.__step6Refresh=()=>schedule();
 """
 patched=source.replace(anchor,hook+anchor,1)
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'docs')))
 threading.Thread(target=server.serve_forever,daemon=True).start()
 errors=[]
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(args=['--no-sandbox'])
   page=await browser.new_page(viewport={'width':1440,'height':900},service_workers='block',reduced_motion='no-preference')
   page.on('pageerror',lambda exc:errors.append(str(exc)))
   async def intercept(route):
    await route.fulfill(status=200,content_type='text/javascript',body=patched)
   await page.route('**/app.mjs',intercept)
   await page.goto(f'http://127.0.0.1:{server.server_port}/')
   await page.get_by_role('button',name='Quizbrett bearbeiten').click()
   await page.locator('.se-board-context').wait_for(timeout=15000)
   await page.locator('.top-nav [data-view="live"]').click()
   await page.locator('.bq-board-scene').wait_for(timeout=12000)
   await page.evaluate('window.__step6Open(1,"q-one")')
   await expect(page.locator('.bq-question-curtain.bq-standalone')).to_have_count(1,timeout=12000)
   assert await page.locator('.bq-curtain-helper.bq-actor').count()==1
   duration=await page.locator('.bq-question-curtain').evaluate('(e)=>parseFloat(getComputedStyle(e).animationDuration)')
   assert duration>=2.7,duration
   assert await page.locator('.bq-question-curtain').evaluate('(e)=>getComputedStyle(e).pointerEvents')=='none'
   await page.locator('.bq-question-curtain').evaluate('(e)=>e.dataset.probeToken="same-node"')
   await page.evaluate('window.__step6Refresh()')
   await expect(page.locator('.bq-question-curtain[data-probe-token="same-node"]')).to_have_count(1)
   await page.wait_for_timeout(1100)
   await page.screenshot(path=str(ART/'step6-question-cover-mid-motion.png'),animations='allow')
   await expect(page.locator('.bq-question-curtain')).to_have_count(0,timeout=5000)
   await page.evaluate('window.__step6Refresh()')
   await expect(page.locator('.bq-question-curtain')).to_have_count(0)
   # Next question starts a fresh one-shot, and reduced-motion bypasses it.
   await page.evaluate('window.__step6Open(2,"q-two")')
   await expect(page.locator('.bq-question-curtain')).to_have_count(1)
   await page.emulate_media(reduced_motion='reduce')
   await page.evaluate('window.__step6Open(3,"q-three")')
   await expect(page.locator('.bq-question-curtain')).to_have_count(0)
   assert not errors,errors
   await browser.close()
 finally:
  server.shutdown();server.server_close()
 print('PASS Step 6: 2.9s cover, one original character, survives redraw, no replay, respects reduced motion')
if __name__=='__main__':asyncio.run(main())
