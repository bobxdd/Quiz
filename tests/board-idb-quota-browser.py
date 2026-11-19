"""Quota-safe local workspaces: real Chromium IndexedDB migration, large saves, conflict safety."""
import asyncio,functools,threading,json
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.async_api import async_playwright
import idb_board_helper as idb

ROOT=Path(__file__).resolve().parents[1]/'docs'
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass

async def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
 threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
   page=await browser.new_page()
   errors=[];page.on('pageerror',lambda error: errors.append(str(error)))
   await page.goto(f'http://127.0.0.1:{server.server_port}/')
   bid='b'+'a'*32
   record={'revision':1,'quiz':{'version':1,'title':'Mein altes Quiz','description':'Altbestand',
    'scoreMode':'team','teams':['Rot','Blau'],'questions':[{'id':'q'+'b'*32,'boardRound':1,
    'category':'Wissen','title':'Frage','prompt':'?','answer':'Unersetzbare Antwort','type':'text','points':100}],
    'categories':['Wissen'],'roundCategories':{'1':['Wissen'],'2':[]}}}
   await page.evaluate("""({id,record})=>{
    localStorage.setItem('bq-board-workspace-'+id,JSON.stringify(record));
    localStorage.setItem('bq-board-workspaces-v1',JSON.stringify([{id,title:record.quiz.title,updatedAt:1}]));
    localStorage.setItem('bq-board-active-v1',id);
   }""",{'id':bid,'record':record})
   original=await page.evaluate("(id)=>localStorage.getItem('bq-board-workspace-'+id)",bid)
   await page.reload()
   await page.wait_for_timeout(350)
   persisted=await idb.get_json(page,'bq-board-workspace-'+bid)
   assert persisted==record, 'Legacy quiz must be copied byte-for-byte'
   assert await page.evaluate("(id)=>localStorage.getItem('bq-board-workspace-'+id)",bid)==original
   print('PASS: old localStorage quiz migrated without deleting or rewriting old bytes',flush=True)

   verdict=await page.evaluate("""async (id)=>{
    const {openBoardStorage}=await import('./board-idb.mjs');
    const {loadBoard,persistBoard}=await import('./board-workspace.mjs');
    const store=await openBoardStorage(localStorage);
    const before=loadBoard(store,id);
    // Previous Web Storage quota is ~5 MiB; this record is >6 MiB.
    before.quiz.description='L'.repeat(6_300_000);
    persistBoard(store,id,before.revision,before.quiz);
    await store.flush();
    const fresh=await openBoardStorage(localStorage);
    const saved=loadBoard(fresh,id);
    const clean=await openBoardStorage(localStorage);
    const blocked=loadBoard(clean,id);
    blocked.quiz.title='Another tab must not overwrite';
    // Both adapters loaded the same revision. First writer wins.
    const newer=loadBoard(fresh,id);
    newer.quiz.title='First writer';
    persistBoard(fresh,id,newer.revision,newer.quiz);
    await fresh.flush();
    persistBoard(clean,id,blocked.revision,blocked.quiz);
    let conflict='';
    try{await clean.flush();}catch(err){conflict=String(err.message);}
    store.close();fresh.close();clean.close();
    return {savedLength:saved.quiz.description.length,
      conflict,oldBytes:localStorage.getItem('bq-board-workspace-'+id).length};
   }""",bid)
   assert verdict['savedLength']==6_300_000,verdict
   assert 'anderer Tab' in verdict['conflict'],verdict
   assert verdict['oldBytes']==len(original),verdict
   last=await idb.get_json(page,'bq-board-workspace-'+bid)
   assert last['quiz']['title']=='First writer' and last['revision']==3
   print('PASS: >6 MB board saves to IDB even while original localStorage is preserved',flush=True)
   print('PASS: stale tab cannot overwrite a newer committed quiz',flush=True)
   assert not errors,errors
   await browser.close()
 finally:
  server.shutdown();server.server_close()

if __name__=='__main__':asyncio.run(main())
