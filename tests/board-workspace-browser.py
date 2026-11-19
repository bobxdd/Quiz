"""Browser-level workspace regression: IndexedDB migration and desktop/mobile UI.
Only the local editor is exercised; PeerJS real network is intentionally not claimed.
"""
import asyncio, functools, json, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright
from board_library_test_support import active_board_id, read_board, read_boards, wait_board_saved

ROOT=Path(__file__).resolve().parents[1] / 'docs'
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass

async def migrate_full_storage(browser,url):
 ctx=await browser.new_context()
 try:
  page=await ctx.new_page()
  await page.goto(url+'icon.svg')
  legacy=await page.evaluate("""() => {
   const canvas=document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
   canvas.width=400;canvas.height=300;
   const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height);
   for(let i=0;i<image.data.length;i+=65536)crypto.getRandomValues(image.data.subarray(i,i+65536));
   for(let i=3;i<image.data.length;i+=4)image.data[i]=255;
   ctx.putImageData(image,0,0);
   const picture=canvas.toDataURL('image/png');
   const first='b'+'a'.repeat(32),second='b'+'b'.repeat(32);
   const q1={id:'q1',title:'Frage eins',category:'Stats',answer:'Alte Antwort',answerImage:picture};
   const q2={id:'q2',title:'Frage zwei',category:'Stats',boardRound:2,answer:'Runde zwei',image:picture};
   const entries={
    'bq-board-workspaces-v1':JSON.stringify([{id:first,title:'Altes Quiz'},{id:second,title:'Zweites Altbrett'}]),
    'bq-board-active-v1':first,
    ['bq-board-workspace-'+first]:JSON.stringify({revision:7,quiz:{title:'Altes Quiz',questions:[q1,q2]}}),
    ['bq-board-workspace-'+second]:JSON.stringify({revision:3,quiz:{title:'Zweites Altbrett',questions:[q2]}}),
    ['bq-session-LOCAL-'+first]:JSON.stringify({round:5,used:{q1:true},scores:{t1:200}}),
    'bq-quiz-LOCAL':JSON.stringify({title:'Historischer Entwurf',questions:[q1]})
   };
   for(const [key,value] of Object.entries(entries))localStorage.setItem(key,value);
   let length=0;
   for(let block=2**22;block;block>>=1){
    try{localStorage.setItem('quota-test-padding','x'.repeat(length+block));length+=block;}
    catch(error){if(error.name!=='QuotaExceededError')throw error;}
   }
   try{localStorage.setItem('quota-test-check','x'.repeat(512));throw Error('Fixture has not reached localStorage quota');}
   catch(error){if(error.name!=='QuotaExceededError')throw error;}
   return {first,second,picture,entries};
  }""")
  await page.goto(url)
  await page.get_by_text('Zweites Altbrett',exact=True).wait_for()
  await page.locator('#join-room').fill('ABCDEFGHJKLMNPQR')
  await page.locator('#join-name').fill('Testname')
  await page.evaluate("""async id => {
   const {openBoardLibrary}=await import('/board-workspace.mjs');
   const library=await openBoardLibrary({onChange(){}});
   try {
    const {quiz,revision}=await library.load(id);
    await library.persist(id,revision,{...quiz,title:'Zweites Altbrett aktualisiert'});
   } finally {library.close();}
  }""",legacy['second'])
  await page.get_by_text('Zweites Altbrett aktualisiert',exact=True).wait_for()
  assert await page.locator('#join-room').input_value()=='ABCDEFGHJKLMNPQR'
  assert await page.locator('#join-name').input_value()=='Testname'
  await page.locator(f'[data-action="open-landing-board"][data-board-id="{legacy["first"]}"]').click()
  await page.locator('.se-board-context>strong').get_by_text('Altes Quiz').wait_for()
  assert (await read_board(page,legacy['first']))['revision']==7
  assert (await read_board(page,legacy['second']))['quiz']['questions'][0]['image']==legacy['picture']
  assert await page.evaluate("""async id => {
   const {openBoardLibrary}=await import('/board-workspace.mjs');
   const library=await openBoardLibrary();
   try {return await library.loadSession(id);}finally{library.close();}
  }""",legacy['first'])=={'round':5,'used':{'q1':True},'scores':{'t1':200}}
  await page.locator('.se-category-navrow[data-category="Stats"]').click()
  await page.locator('.se-add-question').click()
  await page.locator('#se-editor-tab-answer').click()
  await page.locator('[data-se-field="answerText"]').fill('Neue Antwort trotz vollem Browser')
  await page.locator('[data-action="save-board"]').click()
  await wait_board_saved(page)
  await page.reload()
  await page.locator(f'[data-action="open-landing-board"][data-board-id="{legacy["first"]}"]').click()
  await wait_board_saved(page)
  saved=(await read_board(page))['quiz']['questions']
  assert len(saved)==3 and saved[0]['answerImage']==legacy['picture'] and saved[1]['image']==legacy['picture']
  assert saved[1]['boardRound']==2 and saved[2]['answerText']=='Neue Antwort trotz vollem Browser'

  # The browser can read its own exported format even above the old 8 MB cap.
  large_quiz={'title':'Grosses Medienbackup','questions':[
   {'id':f'm{i}', 'title':f'Medienfrage {i}', 'category':f'Medien {i//6}', 'answerImage':legacy['picture']}
   for i in range(20)]}
  payload=json.dumps(large_quiz).encode()
  assert len(payload)>8_000_000
  await page.locator('#import-quiz').set_input_files({'name':'media.brainquiz.json','mimeType':'application/json','buffer':payload})
  await page.locator('.se-board-context>strong').get_by_text('Grosses Medienbackup').wait_for()
  assert len((await read_board(page))['quiz']['questions'])==20
  assert (await read_board(page,legacy['first']))['quiz']['questions']==saved
  assert await page.evaluate("(entries)=>Object.entries(entries).every(([k,v])=>localStorage.getItem(k)===v)",legacy['entries'])
  print('PASS: full localStorage, two legacy boards, unchanged media and progress, new answer after reload, backup over 8 MB')
 finally:
  await ctx.close()

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
   first=await active_board_id(page)
   await page.locator('.se-board-switch>summary').click()
   page.once('dialog',lambda dlg:asyncio.create_task(dlg.accept('Zweites Brett')))
   await page.locator('[data-action="new-board"]').click()
   await page.locator('.se-board-context>strong').get_by_text('Zweites Brett').wait_for()
   second=await active_board_id(page)
   assert first!=second
   assert len(await read_boards(page))==2
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
   await page.locator('.se-board-conflict').wait_for(state='detached',timeout=8000)
   original=(await read_board(page,first))['quiz']['title']
   assert original=='Geändert im zweiten Tab',original
   assert len(await read_boards(page))==3
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
                          'file':await page.locator('#import-quiz').count(), 'changeEvents':await page.evaluate('window.__importEvents'), 'workspace':await read_boards(page)})
    raise
   assert len(await read_boards(page))==4
   assert (await read_board(page,first))['quiz']['title']==original
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

   # A failed IndexedDB transaction keeps the old revision and offers a live draft export.
   await page.locator('.se-board-switch>summary').click()
   await page.evaluate("""() => {
     const original=IDBObjectStore.prototype.put;
     window.failBoardSave=true;
     IDBObjectStore.prototype.put=function(value,key){
       if(window.failBoardSave&&key==='bq-board-workspaces-v1')throw new DOMException('Storage full','QuotaExceededError');
       return original.call(this,value,key);
     };
   }""")
   before_failure=await read_board(page)
   await page.locator('[data-se-quiztitle]').fill('Kann nicht gespeichert werden')
   await page.locator('[data-se-quiztitle]').blur()
   await page.locator('.se-board-conflict [data-action="export"]').wait_for(timeout=8000)
   assert await read_board(page)==before_failure
   async with page.expect_download(timeout=8000) as backup_info:
    await page.locator('.se-board-conflict [data-action="export"]').click()
   backup=await backup_info.value
   assert json.loads(Path(await backup.path()).read_text(encoding='utf-8'))['title']=='Kann nicht gespeichert werden'
   await page.evaluate("window.failBoardSave=false")
   await page.locator('[data-action="save-board"]').click()
   await wait_board_saved(page)
   assert (await read_board(page))['quiz']['title']=='Kann nicht gespeichert werden'
   print('PASS: transaction rollback, draft backup and successful retry')

   assert not errors,errors
   await migrate_full_storage(browser,url)
   await browser.close()
 finally: server.shutdown();server.server_close()

if __name__=='__main__':asyncio.run(main())
