"""Browser-level Step 2 regression: real ES modules, localStorage and desktop/mobile UI.
Only the local editor is exercised; PeerJS real network is intentionally not claimed.
"""
import asyncio, functools, json, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1] / 'docs'
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass

async def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 url=f'http://127.0.0.1:{server.server_port}/'
 errors=[]
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(args=['--no-sandbox'])
   ctx=await browser.new_context(viewport={'width':1280,'height':800})
   page=await ctx.new_page()
   page.on('pageerror',lambda err: errors.append(str(err)))
   await page.goto(url)
   await page.get_by_role('button',name='Quizbrett bearbeiten').click()
   await page.locator('.se-board-context').wait_for(timeout=12000)
   assert 'DU BEARBEITEST DIESES QUIZBRETT' in await page.locator('.se-board-context').inner_text()
   await page.locator('[data-se-quiztitle]').fill('Waldquiz')
   await page.locator('[data-se-quiztitle]').blur()
   await page.wait_for_timeout(650)
   assert 'Waldquiz' in await page.locator('.se-board-context').inner_text()
   first=await page.evaluate("() => JSON.parse(localStorage.getItem('bq-board-workspaces-v1'))[0].id")
   await page.locator('.se-board-switch>summary').click()
   page.once('dialog',lambda dlg:asyncio.create_task(dlg.accept('Zweites Brett')))
   await page.locator('[data-action="new-board"]').click()
   await page.locator('.se-board-context>strong').get_by_text('Zweites Brett').wait_for()
   second=await page.evaluate("() => localStorage.getItem('bq-board-active-v1')")
   assert first!=second
   assert await page.evaluate("() => JSON.parse(localStorage.getItem('bq-board-workspaces-v1')).length")==2
   await page.locator('.se-board-switch>summary').click()
   await page.locator(f'[data-action="open-board"][data-board-id="{first}"]').click()
   await page.locator('.se-board-context>strong').get_by_text('Waldquiz').wait_for()
   await page.reload()
   await page.get_by_role('button',name='Quizbrett bearbeiten').click()
   await page.locator('.se-board-context>strong').get_by_text('Waldquiz').wait_for()
   print('PASS: new board, independent board, explicit selection, and tab-specific reload')

   # A second editor modifies the same quiz; stale first tab must not overwrite it.
   other=await ctx.new_page()
   other.on('pageerror',lambda err:errors.append(str(err)))
   await other.goto(url)
   await other.get_by_role('button',name='Quizbrett bearbeiten').click()
   await other.locator('.se-board-context>strong').get_by_text('Waldquiz').wait_for()
   await other.locator('[data-se-quiztitle]').fill('Geändert im zweiten Tab')
   await other.locator('[data-se-quiztitle]').blur()
   await other.wait_for_timeout(700)
   await page.locator('[data-action="rescue-board"]').wait_for(timeout=8000)
   await page.locator('[data-se-quiztitle]').fill('Meine ungesicherte Version')
   await page.locator('[data-se-quiztitle]').blur()
   await page.locator('[data-action="rescue-board"]').click()
   await page.locator('.se-board-context>strong').get_by_text('Meine ungesicherte Version').wait_for()
   original=await page.evaluate("""id => JSON.parse(localStorage.getItem('bq-board-workspace-'+id)).quiz.title""",first)
   assert original=='Geändert im zweiten Tab',original
   assert await page.evaluate("() => JSON.parse(localStorage.getItem('bq-board-workspaces-v1')).length")==3
   print('PASS: stale-tab change detection, no overwrite, rescue as copy')

   # Import must always make a separate board and leave the originals intact.
   payload=json.dumps({'version':1,'title':'Importiert','questions':[],'teams':['A','B']}).encode()
   await page.locator('#import-quiz').set_input_files({'name':'probe.brainquiz.json','mimeType':'application/json','buffer':payload})
   await page.locator('.se-board-context>strong').get_by_text('Importiert').wait_for(timeout=8000)
   assert await page.evaluate("() => JSON.parse(localStorage.getItem('bq-board-workspaces-v1')).length")==4
   assert await page.evaluate("""id => JSON.parse(localStorage.getItem('bq-board-workspace-'+id)).quiz.title""",first)==original
   print('PASS: non-destructive imported board')

   # XSS-style board labels must be displayed as text, never run as markup.
   await page.locator('[data-se-quiztitle]').fill('<img src=x onerror="window.__injected=true">')
   await page.locator('[data-se-quiztitle]').blur()
   await page.wait_for_timeout(650)
   assert await page.evaluate("() => window.__injected===undefined")
   assert await page.locator('.se-board-context img').count()==0
   print('PASS: escaped quizboard labels')

   await page.set_viewport_size({'width':390,'height':780})
   await page.locator('.se-board-switch>summary').click()
   dims=await page.evaluate("() => ({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})")
   assert dims['scroll']<=dims['client']+8,dims
   await page.locator('.se-board-switch-items [data-action="open-board"]').first.wait_for(state='visible')
   print('PASS: mobile workspace menu without horizontal overflow')

   assert not errors,errors
   await browser.close()
 finally: server.shutdown();server.server_close()

if __name__=='__main__':asyncio.run(main())
