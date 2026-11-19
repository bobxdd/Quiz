"""Browser-level Step 2 regression: real ES modules, localStorage and desktop/mobile UI.
Only the local editor is exercised; PeerJS real network is intentionally not claimed.
"""
import asyncio, functools, json, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright
import idb_board_helper as idb

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
   await page.locator('.bq-legacy-options>summary').click()
   await page.get_by_role('button',name='Quizbrett bearbeiten').click()
   await page.locator('.se-board-context').wait_for(timeout=12000)
   assert 'DU BEARBEITEST DIESES QUIZBRETT' in await page.locator('.se-board-context').inner_text()
   await page.locator('[data-se-quiztitle]').fill('Waldquiz')
   await page.locator('[data-se-quiztitle]').blur()
   await page.wait_for_timeout(650)
   assert 'Waldquiz' in await page.locator('.se-board-context').inner_text()
   first=(await idb.get_json(page,'bq-board-workspaces-v1'))[0]['id']
   await page.locator('.se-board-switch>summary').click()
   page.once('dialog',lambda dlg:asyncio.create_task(dlg.accept('Zweites Brett')))
   await page.locator('[data-action="new-board"]').click()
   await page.locator('.se-board-context>strong').get_by_text('Zweites Brett').wait_for()
   second=await idb.get_value(page,'bq-board-active-v1')
   assert first!=second
   assert len(await idb.get_json(page,'bq-board-workspaces-v1'))==2
   await page.locator('.se-board-switch>summary').click()
   await page.locator(f'[data-action="open-board"][data-board-id="{first}"]').click()
   await page.locator('.se-board-context>strong').get_by_text('Waldquiz').wait_for()
   await page.reload()
   await page.locator('.bq-legacy-options>summary').click()
   await page.get_by_role('button',name='Quizbrett bearbeiten').click()
   await page.locator('.se-board-context>strong').get_by_text('Waldquiz').wait_for()
   print('PASS: new board, independent board, explicit selection, and tab-specific reload')

   # Start-page quick selection must open exactly the chosen board, not the last-used board.
   await page.goto(url)
   if not await page.locator('.bq-landing-boards').evaluate('(el)=>el.open'):
    await page.locator('.bq-landing-boards>summary').click()
   await page.locator(f'[data-action="open-landing-board"][data-board-id="{second}"]').click()
   await page.locator('.se-board-context>strong').get_by_text('Zweites Brett').wait_for()
   await page.goto(url)
   if not await page.locator('.bq-landing-boards').evaluate('(el)=>el.open'):
    await page.locator('.bq-landing-boards>summary').click()
   await page.locator(f'[data-action="open-landing-board"][data-board-id="{first}"]').click()
   await page.locator('.se-board-context>strong').get_by_text('Waldquiz').wait_for()
   print('PASS: explicit startup board picker preserves intended board identity')

   # A second editor modifies the same quiz; stale first tab must not overwrite it.
   other=await ctx.new_page()
   other.on('pageerror',lambda err:errors.append(str(err)))
   await other.goto(url)
   await other.locator('.bq-legacy-options>summary').click()
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
   original=(await idb.get_json(page,'bq-board-workspace-'+first))['quiz']['title']
   assert original=='Geändert im zweiten Tab',original
   assert len(await idb.get_json(page,'bq-board-workspaces-v1'))==3
   await page.locator('.se-board-conflict').wait_for(state='detached',timeout=8000)
   await page.wait_for_timeout(120)  # ensure rescue's scheduled editor redraw cannot replace the import input
   print('PASS: stale-tab change detection, no overwrite, rescue as copy')

   # Import must always make a separate board and leave the originals intact.
   payload=json.dumps({'version':1,'title':'Importiert','questions':[],'teams':['A','B']}).encode()
   await page.evaluate("() => {window.__importEvents=0;document.addEventListener('change',e=>{if(e.target.id==='import-quiz')window.__importEvents++},true)}")
   await page.locator('#import-quiz').set_input_files({'name':'probe.brainquiz.json','mimeType':'application/json','buffer':payload})
   try: await page.locator('.se-board-context>strong').get_by_text('Importiert').wait_for(timeout=8000)
   except Exception:
    print('DIAG import',{'title':await page.locator('.se-board-context>strong').all_inner_texts(),
                          'toaster':await page.locator('#toaster').all_inner_texts(),
                          'errors':errors,
                          'file':await page.locator('#import-quiz').count(), 'changeEvents':await page.evaluate('window.__importEvents'), 'workspace':await idb.get_json(page,'bq-board-workspaces-v1')})
    raise
   assert len(await idb.get_json(page,'bq-board-workspaces-v1'))==4
   assert (await idb.get_json(page,'bq-board-workspace-'+first))['quiz']['title']==original
   print('PASS: non-destructive imported board')
   if not await page.locator('.bq-editor-extras').evaluate('(e)=>e.open'):
    await page.locator('.bq-editor-extras>summary').click()
   await page.locator('.se-file-actions>summary').click()
   async with page.expect_download(timeout=8000) as download_info:
    await page.locator('.se-file-menu [data-action="export"]').click()
   download=await download_info.value
   assert 'Importiert' in download.suggested_filename and download.suggested_filename.endswith('.brainquiz.json'),download.suggested_filename
   print('PASS: identifiable per-board export filename')

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

   # localStorage is deliberately blocked: all new board edits must still
   # succeed in IndexedDB without ever touching localStorage's small quota.
   await page.locator('.se-board-switch>summary').click()
   await page.evaluate("""() => {
     const old=Storage.prototype.setItem;
     Storage.prototype.setItem=function(key,value){
       if(key.startsWith('bq-board-workspace-')||key==='bq-board-workspaces-v1')
        throw new DOMException('Storage full','QuotaExceededError');
       return old.call(this,key,value);
     };
   }""")
   await page.locator('[data-se-quiztitle]').fill('Speichern trotz vollem localStorage')
   await page.locator('[data-se-quiztitle]').blur()
   await page.locator('[data-action="save-board"]').click()
   await page.wait_for_timeout(150)
   assert (await idb.get_json(page,'bq-board-workspace-'+await idb.get_value(page,'bq-board-active-v1')))['quiz']['title']=='Speichern trotz vollem localStorage'
   assert await page.locator('.se-board-conflict').count()==0
   print('PASS: localStorage quota no longer blocks durable IndexedDB question boards')
   assert not errors,errors
   await browser.close()
 finally: server.shutdown();server.server_close()

if __name__=='__main__':asyncio.run(main())
