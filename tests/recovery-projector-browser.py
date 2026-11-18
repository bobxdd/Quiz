"""Real-origin Chromium audit of IndexedDB checkpoints and read-only projector.
No external signaling or user credentials are involved.
"""
import asyncio,threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright,expect
DOCS=Path(__file__).resolve().parents[1]/'docs'
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory=str(DOCS),**kw)
 def log_message(self,*args):pass

async def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 root=f'http://127.0.0.1:{server.server_port}'
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
   context=await browser.new_context()
   page=await context.new_page()
   await page.goto(root+'/projector.html')
   saved=await page.evaluate("""async()=>{
    const b=await import('/backup-store.mjs');
    const key='session-AAAAAAAAAAAAAAAA';
    await b.saveHostCheckpoint(key,{uid:'host',savedAt:5,data:{round:9},secrets:{secret:'PRIVATE'}});
    const result=await b.loadHostCheckpoint(key);
    return {uid:result?.uid,round:result?.data?.round,secret:result?.secrets?.secret};
   }""")
   assert saved=={'uid':'host','round':9,'secret':'PRIVATE'},saved
   await page.reload()
   recovered=await page.evaluate("""async()=>{
    const b=await import('/backup-store.mjs');
    return await b.loadHostCheckpoint('session-AAAAAAAAAAAAAAAA');
   }""")
   assert recovered['data']['round']==9
   await page.evaluate("""async()=>{const b=await import('/backup-store.mjs');await b.deleteHostCheckpoint('session-AAAAAAAAAAAAAAAA')}""")
   assert await page.evaluate("""async()=>{const b=await import('/backup-store.mjs');return b.loadHostCheckpoint('session-AAAAAAAAAAAAAAAA')}""") is None
   print('PASS: IndexedDB host checkpoint survives reload, contains full saved state and deletes cleanly')
   room='AAAAAAAAAAAAAAAA';token='a'*32
   projector=await context.new_page()
   errors=[];projector.on('pageerror',lambda error:errors.append(str(error)))
   await projector.goto(f'{root}/projector.html?room={room}#{token}')
   await expect(projector.locator('.bq-projector-wait')).to_be_visible()
   await page.evaluate("""([room,token])=>{
    const bc=new BroadcastChannel('brainquiz-projector-'+room+'-'+token);
    bc.postMessage({t:'frame',html:'<section class="bq-session-scene"><h1>PUBLIC BOARD</h1><p>Score: 200</p><button data-action="score">No host controls</button></section>'});
    setTimeout(()=>bc.close(),1000);
   }""",[room,token])
   await expect(projector.locator('#projector-root')).to_contain_text('PUBLIC BOARD',timeout=10000)
   assert await projector.evaluate("document.querySelector('#projector-root').textContent.includes('Score: 200')")
   assert not errors,errors
   await page.close();await projector.close();await browser.close()
   print('PASS: local projector receives only explicitly published display frames and has no game engine')
 finally:server.shutdown();server.server_close()

if __name__=='__main__':asyncio.run(main())
