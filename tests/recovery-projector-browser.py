"""IndexedDB, read-only viewer and ten-player native WebRTC audit on a local origin."""
import asyncio,os,threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright,expect
DOCS=Path(__file__).resolve().parents[1]/'docs'
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory=str(DOCS),**kw)
 def log_message(self,*args):pass

async def native_room(browser,root):
 """Use native ICE/data channels with deterministic local test signaling."""
 ctx=await browser.new_context()
 await ctx.add_init_script(path=DOCS.parent/'tests/native-rtc-peer-browser.js')
 host=await ctx.new_page()
 url=root+'/projector.html'
 await host.goto(url)
 room='BCDEFGHJKLMNP234'
 await host.evaluate("""async room=>{
  const {PeerGame}=await import('/peer-client.mjs');
  const {emptyQuiz,quickBoard}=await import('/core.mjs');
  const quiz=emptyQuiz();
  quiz.teams=['Rot','Blau','Grün','Gold','Violett'];
  quiz.questions=quickBoard(['Test'],[100]);
  quiz.questions[0].answerText='Unveröffentlichte Lösung';
  window.live=new PeerGame();
  await live.create(room,quiz,{published:true});
  await live.saveHostQuiz(room,quiz);
 }""",room)

 async def join(i):
  page=await ctx.new_page()
  await page.goto(url)
  player=await page.evaluate("""async ([room,i])=>{
   const {PeerGame}=await import('/peer-client.mjs');
   window.live=new PeerGame();
   await live.connect(room,'Spieler '+(i+1));
   return live.uid;
  }""",[room,i])
  return page,player

 clients=await asyncio.gather(*(join(i) for i in range(10)))
 players=[player for _,player in clients]
 await host.evaluate("""async ([room,players])=>{
  const {publicQuestion}=await import('/core.mjs');
  for(const [i,id] of players.entries())await live.hostAssign(room,id,live.data.members[id],'t'+(1+i%5));
  await live.setState(room,{started:true});
  const question=live.hostQuiz.questions[0];
  await live.openQuestion(room,0,question,publicQuestion(question,false),null,0);
 }""",[room,players])
 await asyncio.gather(*(page.wait_for_function("live.guestData.public?.round===1") for page,_ in clients))
 assert all(await asyncio.gather(*(page.evaluate("live.conn.peerConnection.connectionState==='connected'") for page,_ in clients)))
 outcomes=await asyncio.gather(*(page.evaluate("room=>live.buzzer(room,1)",room) for page,_ in clients))
 assert sum(outcomes)==1,outcomes
 winner=await host.evaluate("""async room=>{
  const winner=live.data.buzzers['1'];
  await live.judgeBuzzer(room,1,winner.uid,'wrong');
  await live.checkpointWrites;
  live.shutdown();
  localStorage.removeItem('bq-p2p-session-'+room);
  return winner;
 }""",room)

 await host.reload()
 resumed=await host.evaluate("""async ([room,winner])=>{
  const {PeerGame}=await import('/peer-client.mjs');
  window.live=new PeerGame();
  await live.resumeHost(room);
  const {public:state,roster}=live.data;
  return {total:state.scores[winner.team],round:state.round,players:Object.keys(roster).length,
   locked:!!state.buzzerBlocked['1'][winner.uid]};
 }""",[room,winner])
 assert resumed=={'total':-50,'round':1,'players':10,'locked':True},resumed
 await asyncio.gather(*(page.wait_for_function(
  "winner=>live.connected && live.guestData.public?.scores?.[winner.team]===-50 && live.guestData.public?.buzzerBlocked?.['1']?.[winner.uid]",
  arg=winner
 ) for page,_ in clients))
 assert [await page.evaluate("live.uid") for page,_ in clients]==players
 assert not await clients[0][0].evaluate("JSON.stringify(live.guestData).includes('Unveröffentlichte Lösung')")

 key=await host.evaluate("""room=>{
  const key=live.enableProjector(room);
  live.publishProjector(room,{t:'frame',html:'<section><h1>Native Zuschaueransicht</h1></section>',deadline:0});
  return key;
 }""",room)
 viewer=await ctx.new_page()
 await viewer.goto(f'{url}?room={room}&remote=1#{key}')
 await expect(viewer.get_by_role('heading',name='Native Zuschaueransicht')).to_be_visible(timeout=15000)
 assert await viewer.locator('[data-action]').count()==0
 await ctx.close()
 print('PASS: 10 native WebRTC guests in 5 teams, simultaneous buzz, IndexedDB-only host recovery and remote viewer')

async def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 root=f'http://127.0.0.1:{server.server_port}'
 try:
  async with async_playwright() as p:
   engine=os.getenv('BRAINQUIZ_BROWSER','chromium')
   browser=await getattr(p,engine).launch(args=['--no-sandbox','--no-proxy-server'] if engine=='chromium' else [])
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
   await page.close();await projector.close()
   print('PASS: local projector receives only explicitly published display frames and has no game engine')
   if engine=='chromium':await native_room(browser,root)
   await browser.close()
 finally:server.shutdown();server.server_close()

if __name__=='__main__':asyncio.run(main())
