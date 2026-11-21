"""IndexedDB, read-only viewer and ten-player native WebRTC audit on a local origin."""
import asyncio,os,threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright,expect
from board_library_test_support import read_boards, wait_board_saved
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
 assert resumed=={'total':-100,'round':1,'players':10,'locked':True},resumed
 await asyncio.gather(*(page.wait_for_function(
  "winner=>live.connected && live.guestData.public?.scores?.[winner.team]===-100 && live.guestData.public?.buzzerBlocked?.['1']?.[winner.uid]",
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

async def rehearse_locally(browser,root):
 ctx=await browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce')
 page=await ctx.new_page()
 errors=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 await page.goto(root+'/')
 await page.locator('[data-action="create-new-quiz"]').click()
 await page.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
 await page.locator('[data-se-action="new"][data-template="text"]').click()
 await page.locator('[data-se-action="editor-pane"][data-pane="answer"]').click()
 await page.locator('#se-answer-text').fill('Anivia aus der Generalprobe')
 await page.locator('[data-se-upload="answer-image"]').set_input_files(DOCS/'pixel-corner.png')
 await expect(page.locator('.se-answer-live-preview img')).to_be_visible()
 await wait_board_saved(page)
 await expect(page.locator('#se-answer-text')).to_have_value('Anivia aus der Generalprobe')
 await page.locator('[data-action="editor-probe"]').click()
 await expect(page.locator('.bq-rehearsal')).to_be_visible()
 saved=lambda:read_boards(page,load_records=True)
 before=await saved()
 await page.locator('.bq-board-scene [data-action="open"]').first.click()
 await page.locator('[data-action="uncover-question"]').click()
 await page.locator('[data-action="probe-buzz"]').first.click()
 await page.locator('[data-action="probe-wrong"]').click()
 await expect(page.locator('.bq-probe-scores')).to_contain_text('-100')
 await page.locator('[data-action="probe-buzz"]').last.click()
 await page.locator('[data-action="probe-correct"]').click()
 await expect(page.locator('.presenter-stage')).to_contain_text('Anivia aus der Generalprobe')
 await page.locator('[data-action="probe-width"]').click()
 await expect(page.locator('.bq-probe-compact')).to_be_visible()
 await page.locator('[data-action="probe-media"]').click()
 await expect(page.locator('.bq-rehearsal-toolbar [role="status"]')).to_contain_text('1 eingebettete Medien geprüft · 0 Probleme')
 assert await saved()==before
 assert not errors,errors
 await ctx.close()
 print('PASS: local mobile rehearsal, score rules, answer reveal, image decode and unchanged saved quiz')

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
   async def send_frame(html):
    await page.evaluate("""([room,token,html])=>{
     const bc=new BroadcastChannel('brainquiz-projector-'+room+'-'+token);
     bc.postMessage({t:'frame',html});
     setTimeout(()=>bc.close(),1000);
    }""",[room,token,html])
   await send_frame('<section class="bq-session-scene"><h1>PUBLIC BOARD</h1><p>Score: 200</p><button data-action="score">No host controls</button></section>')
   await expect(projector.locator('#projector-root')).to_contain_text('PUBLIC BOARD',timeout=10000)
   await expect(projector.locator('#projector-root')).to_contain_text('Score: 200')
   assert await projector.locator('#projector-root button, #projector-root [data-action]').count()==0
   frame='<div class="bq-projector-scene"><section class="bq-session-scene bq-question-scene"><div class="glass panel bq-question-panel"><div class="bq-scene-content">{}</div></div></section></div>'
   question='<div class="stage"><div class="se-scene"><div class="se-element se-kind-image" style="left:10%;top:10%;width:80%;height:80%"><img src="./pixel-corner.png" alt="Fragebild"></div></div></div>'
   await send_frame(frame.format(question))
   picture=projector.get_by_alt_text('Fragebild')
   await expect(picture).to_be_in_viewport(ratio=.95)
   assert (await picture.bounding_box())['width']>=160
   await send_frame(frame.format('<div class="bq-buzzer-cover" role="status"><strong>Frage verdeckt</strong></div>'))
   await expect(projector.get_by_text('Frage verdeckt',exact=True)).to_be_in_viewport(ratio=.95)
   await expect(picture).to_have_count(0)
   await send_frame(frame.format(question))
   await expect(picture).to_be_in_viewport(ratio=.95)
   print('PASS: projector image, full buzzer cover and restored image occupy visible space',flush=True)
   assert not errors,errors
   await page.close();await projector.close()
   print('PASS: local projector receives only explicitly published display frames and has no game engine')
   if engine=='chromium':await native_room(browser,root)
   await rehearse_locally(browser,root)
   await browser.close()
 finally:server.shutdown();server.server_close()

if __name__=='__main__':asyncio.run(main())
