"""End-to-end Joker UI smoke test with real host/guest browser views and mock PeerJS.
Checks joker card privacy, hidden drops, reroll, protective score, Oracle, and
Chronobreak. Separate native-network tests cover WebRTC itself.
"""
import asyncio,importlib.util,threading
from pathlib import Path
from playwright.async_api import async_playwright,expect
from board_library_test_support import active_board_id,read_board,wait_board_saved

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_joker_fixture',ROOT/'tests/board-rounds-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

async def join(ctx,host,room,name,team,origin):
 page=await ctx.new_page()
 await page.goto(origin)
 await page.locator('#join-room').fill(room)
 await page.locator('#join-name').fill(name)
 await page.locator('#join-form button[type="submit"]').click()
 await page.locator('[data-action="lobby-join"][data-team="'+team+'"]').click()
 request=host.locator('.bq-host-join-request').filter(has_text=name)
 await expect(request).to_contain_text('Gewünscht: '+('Rot' if team=='t1' else 'Blau'))
 await request.locator('[data-action="approve"]').click()
 await page.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=15000)
 return page

async def editor_settings(browser,origin):
 ctx=await browser.new_context(viewport={'width':1920,'height':1080},reduced_motion='reduce')
 try:
  page=await ctx.new_page()
  await page.goto(origin)
  await page.locator('[data-action="create-new-quiz"]').click()
  panel=page.locator('.bq-editor-toolbar .bq-joker-editor-settings')
  await expect(panel).to_be_visible()
  await expect(panel.locator('[data-joker-card]')).to_have_count(4)
  await expect(panel.locator('#joker-drops-shield')).to_be_disabled()
  await expect(panel.locator('.bq-joker-config-status')).to_contain_text('Deaktiviert')
  # The wide viewport uses the existing free space beside the quiz title.
  geometry=await page.evaluate("""()=>{const left=document.querySelector('.bq-editor-quiz-column').getBoundingClientRect(),right=document.querySelector('.bq-joker-editor-settings').getBoundingClientRect(),tabs=document.querySelector('.bq-round-picker').getBoundingClientRect();return {left:left.right,right:right.left,bottom:right.bottom,tabs:tabs.top}}""")
  assert geometry['right']>=geometry['left']-1 and geometry['bottom']<=geometry['tabs']+1,geometry
  await panel.locator('#joker-enabled').check()
  await panel.locator('#joker-drops-shield').select_option('2')
  await panel.locator('#joker-drops-chrono').select_option('2')
  await panel.locator('#joker-start-all').check()
  await panel.locator('#joker-start-oracle').uncheck()
  await expect(panel.locator('.bq-joker-config-status')).to_contain_text('0 von 6 Funden möglich')
  await expect(panel.locator('.bq-joker-config-foot')).to_contain_text('0 Buzzerfragen')
  await expect(panel.locator('#joker-start-all')).not_to_be_checked()
  await page.locator('[data-se-action="board-round"][data-board-round="2"]').click()
  await expect(panel).to_be_visible()
  await expect(panel.locator('#joker-drops-shield')).to_have_value('2')
  await expect(panel.locator('#joker-start-oracle')).not_to_be_checked()
  await page.locator('[data-se-action="board-round"][data-board-round="1"]').click()
  for width,height in [(1920,1080),(1366,850),(768,1024),(390,844),(320,720)]:
   await page.set_viewport_size({'width':width,'height':height})
   await expect(panel).to_be_visible()
   assert await page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+8'),f'Joker editor horizontal overflow {width}'
   for card in await panel.locator('[data-joker-card]').all():
    assert await card.evaluate('(el)=>el.scrollWidth<=el.clientWidth+4'),f'Joker card horizontal clipping {width}'
  await page.set_viewport_size({'width':1366,'height':850})
  await page.locator('[data-action="save-board"]').click()
  await wait_board_saved(page)
  board=await active_board_id(page)
  saved=(await read_board(page))['quiz']['jokerConfig']
  assert saved['enabled'] and saved['drops']['shield']==2 and saved['drops']['chrono']==2
  assert saved['startingByType']=={'shield':True,'oracle':False,'reroll':True,'chrono':True}
  await page.reload()
  await page.locator(f'[data-action="open-landing-board"][data-board-id="{board}"]').click()
  await expect(panel.locator('#joker-enabled')).to_be_checked()
  await expect(panel.locator('#joker-drops-chrono')).to_have_value('2')
  await expect(panel.locator('#joker-start-oracle')).not_to_be_checked()
  # Switching to individual scoring must never trap an enabled config.
  await page.locator('[data-se-scoremode]').select_option('individual')
  await expect(panel.locator('#joker-drops-shield')).to_be_disabled()
  await panel.locator('#joker-enabled').uncheck()
  await page.locator('[data-se-scoremode]').select_option('team')
  await panel.locator('#joker-enabled').check()
  await expect(panel.locator('#joker-drops-shield')).to_have_value('2')
  print('PASS: upper toolbar, four per-type Joker controls, five viewport sizes, board switching and persistent settings',flush=True)
 finally:
  await ctx.close()

async def exercise(origin):
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  await editor_settings(browser,origin)
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  await ctx.add_init_script(path=ROOT/'tests/mock-peerjs-browser.js')
  source=(ROOT/'docs/app.mjs').read_text(encoding='utf-8').replace('const studio=createStudioEditor(','''window.__probe={room:()=>room,getGame:()=>game,info:()=>({publicState,member}),setQuiz:async x=>{quiz=normalizedQuiz(x);selected=quiz.questions[0]?.id||'';const audit=quizAudit(quiz);if(!audit.ready)throw Error(JSON.stringify(audit.errors));await saveLocal();schedule();}};const studio=createStudioEditor(''',1)
  async def route_app(route):
   await route.fulfill(status=200,content_type='text/javascript',body=source)
  await ctx.route('**/app.mjs',route_app)
  errors=[]
  ctx.on('page',lambda page:page.on('pageerror',lambda e:errors.append(str(e))))
  host=await ctx.new_page()
  host.on('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
  host.on('console',lambda msg:print('HOST CONSOLE:',msg.text,flush=True) if msg.type=='error' and '[BrainQuiz]' in msg.text else None)
  await host.goto(origin)
  await host.locator('.bq-legacy-options>summary').click()
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await expect(host.locator('#se-root')).to_be_visible(timeout=15000)
  room=await host.evaluate('window.__probe.room()')
  questions=[{'id':ch,'boardRound':1,'category':'Jokerprobe','title':'Frage '+ch,'type':'text','roundMode':'buzzer',
              'points':(i+1)*100,'prompt':'Rate Champion '+ch,'answer':'Anivia','answerText':'Anivia','oracleHint':'VERTRAULICHER ORAKELTIPP'}
             for i,ch in enumerate('abcd')]
  questions.append({**questions[-1],'id':'schriftlich','title':'Schriftliche Frage','points':500,'roundMode':'written'})
  settings={'enabled':True,'starting':True,'drops':{'shield':1,'oracle':1,'reroll':1,'chrono':1}}
  await host.evaluate('(payload)=>window.__probe.setQuiz({title:"Joker QA",teams:["Rot","Blau"],questions:payload.questions,jokerConfig:payload.settings})',
                      {'questions':questions,'settings':settings})
  await host.locator('[data-action="publish"]').first.click()
  try:
   await host.wait_for_function('()=>window.__probe.info().publicState?.published===true',timeout=15000)
   await expect(host.locator('.bq-board-scene .tile')).to_have_count(5,timeout=15000)
  except Exception:
   print('Publication failure:',await host.locator('#toaster').text_content(),await host.evaluate('window.__probe.info().publicState'),flush=True)
   raise
  await host.locator('.top-nav [data-view="teams"]').click()
  alice=await join(ctx,host,room,'Alice','t1',origin)
  bob=await join(ctx,host,room,'Bob','t2',origin)
  await host.locator('[data-action="start-game"]').click()
  await expect(host.locator('.bq-board-scene')).to_be_visible()
  await host.wait_for_function('()=>window.__probe.info().publicState.started===true')
  for page in (host,alice,bob):
   await expect(page.locator('.bq-joker-panel')).to_have_count(1,timeout=15000)
   await expect(page.locator('.bq-joker-token')).to_have_count(8)
   if not await page.locator('.bq-joker-panel').evaluate('(el)=>el.open'):
    await page.locator('.bq-joker-panel summary').click()
  assert await host.evaluate("Object.keys(window.__probe.getGame().data.jokerDrops).length")==4
  assert not await host.evaluate("'schriftlich' in window.__probe.getGame().data.jokerDrops")

  # Hidden drop stays secret while the host has selected but not revealed a question.
  await host.locator('[data-action="open"][data-qid="a"]').click()
  await expect(host.locator('.bq-question-covered')).to_be_visible()
  assert await alice.locator('.bq-joker-event').count()==0
  await alice.locator('[data-action="joker-use"][data-type="reroll"]').click()
  await expect(host.locator('.bq-reroll-request')).to_be_visible(timeout=15000)
  await host.locator('[data-action="joker-reroll-accept"]').click()
  await expect(host.locator('.bq-board-scene')).to_be_visible()
  await expect(host.locator('[data-action="open"][data-qid="a"]')).to_be_disabled()
  await expect(host.locator('[data-action="open"][data-qid="b"]')).to_be_enabled()
  await alice.wait_for_function("()=>window.__probe.info().publicState.jokers.t1.reroll===0")
  print('PASS: covered question rerolls via host approval; no early drop disclosure',flush=True)

  # Reveal guarantees one of the four secret drops, but only after uncovering.
  await host.locator('[data-action="open"][data-qid="b"]').click()
  assert await bob.locator('.bq-joker-event').count()==0
  await host.locator('[data-action="uncover-question"]').click()
  await expect(bob.locator('.bq-joker-event')).to_be_visible(timeout=15000)
  assert 'VERTRAULICHER ORAKELTIPP' not in str(await bob.evaluate("window.__probe.info().publicState"))
  await alice.locator('[data-action="joker-use"][data-type="oracle"]').click()
  await expect(alice.locator('.bq-oracle-private')).to_contain_text('VERTRAULICHER ORAKELTIPP',timeout=15000)
  assert await bob.locator('.bq-oracle-private').count()==0
  assert 'VERTRAULICHER ORAKELTIPP' not in str(await bob.evaluate("window.__probe.info().publicState"))
  print('PASS: Oracle Lens hint is private to the receiving team and hidden during preparation',flush=True)

  # The protective Joker is armed first, charged only when the wrong answer is judged.
  await alice.locator('[data-action="joker-use"][data-type="shield"]').click()
  await alice.locator('[data-action="buzz"]').click()
  await expect(host.locator('.bq-buzzer-winner')).to_contain_text('Alice')
  await host.locator('[data-action="buzz-wrong"]').click()
  await alice.wait_for_function("()=>window.__probe.info().publicState?.jokers?.t1?.shield===0",timeout=15000)
  assert await host.evaluate("window.__probe.info().publicState.scores.t1")==0
  await expect(bob.locator('[data-action="buzz"]')).to_be_enabled(timeout=15000)
  await bob.locator('[data-action="buzz"]').click()
  await expect(host.locator('.bq-buzzer-winner')).to_contain_text('Bob')
  await host.locator('[data-action="buzz-correct"]').click()
  await expect(host.locator('.bq-joker-event')).to_contain_text('Aufladung erhalten',timeout=15000)
  assert await host.evaluate("window.__probe.info().publicState.jokerEvent.team")=='t2'
  await host.locator('[data-action="back"]').click()
  print('PASS: shield prevents a negative score and correct answer awards one dropped joker',flush=True)

  # Chronobreak freezes host controls and allows only the current buzzer to correct.
  await host.locator('[data-action="open"][data-qid="c"]').click()
  await host.locator('[data-action="uncover-question"]').click()
  await alice.locator('[data-action="buzz"]').click()
  await expect(alice.locator('.bq-chrono-quick-wrap [data-type="chrono"]')).to_be_visible(timeout=15000)
  await alice.locator('.bq-chrono-quick-wrap [data-type="chrono"]').click()
  await expect(host.locator('.bq-chrono-overlay.is-host-lock')).to_be_visible(timeout=15000)
  await expect(bob.locator('.bq-chrono-overlay')).to_contain_text('CHRONOBREAK',timeout=15000)
  await alice.locator('#chrono-correction').fill('Korrigierte Antwort')
  await alice.locator('[data-action="joker-chrono-answer"]').click()
  await host.wait_for_function("()=>window.__probe.getGame().hostChronoAnswer(window.__probe.room(),3)==='Korrigierte Antwort'",timeout=15000)
  await expect(host.locator('.bq-chrono-overlay')).to_have_count(0,timeout=15000)
  await expect(host.locator('.bq-buzzer-winner')).to_contain_text('Korrigierte Antwort',timeout=15000)
  assert await alice.evaluate("window.__probe.info().publicState.jokers.t1.chrono")==0
  await host.locator('[data-action="buzz-correct"]').click()
  await host.locator('[data-action="back"]').click()
  await host.locator('[data-action="open"][data-qid="schriftlich"]').click()
  await host.locator('[data-action="uncover-question"]').click()
  for player in (alice,bob):
   await expect(player.locator('.bq-joker-event')).to_have_count(0)
   await expect(player.locator('#answer-text')).to_be_visible()
  panel=alice.locator('.bq-joker-panel')
  save=alice.locator('[data-action="submit-answer"]')
  for width,height in [(320,568),(390,844),(768,1024),(1366,850),(1920,1080)]:
   await alice.set_viewport_size({'width':width,'height':height})
   for opened in (False,True):
    if await panel.evaluate('(el)=>el.open')!=opened:
     await panel.locator('summary').click()
    await save.click(trial=True,timeout=5000)
   await alice.locator('#answer-text').fill(f'Test {width}')
   await save.click()
   await expect(alice.locator('.bq-answer-saved')).to_contain_text(f'Test {width}')
  await bob.locator('#answer-text').fill('Blau meldet ab')
  await bob.locator('[data-action="submit-answer"]').click()
  await expect(host.locator('.review-card')).to_have_count(2)
  print('PASS: writing stays clickable with open and closed Joker inventory at five viewport sizes',flush=True)
  await balance_board(ctx,origin)
  assert not errors,errors
  await ctx.close();await browser.close()
  print('PASS: Chronobreak is visible to all and host controls resume after an eight-second correction',flush=True)

async def balance_board(ctx,origin):
 host=await ctx.new_page()
 host.on('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
 await host.goto(origin)
 await host.locator('.bq-legacy-options>summary').click()
 await host.get_by_role('button',name='Online-Raum erstellen').click()
 await expect(host.locator('#se-root')).to_be_visible()
 room=await host.evaluate('window.__probe.room()')
 def question(id,board,points):
  return {'id':id,'boardRound':board,'points':points,'category':'Testfragen','title':'Frage '+id,
          'type':'text','prompt':'Frage '+id,'answer':'Lösung '+id}
 questions=[question('start',1,100),question('next',2,100)]
 questions.extend(question(id,3,index*100) for index,id in enumerate('abcd',1))
 await host.evaluate('(questions)=>window.__probe.setQuiz({title:"Ausgleich QA", teams:["Rot","Blau"],balanceBoard:true,questions})',questions)
 await host.locator('[data-action="publish"]').first.click()
 await host.wait_for_function('()=>window.__probe.info().publicState?.published')
 await host.locator('.top-nav [data-view="teams"]').click()
 red=await join(ctx,host,room,'Rot QA','t1',origin)
 blue=await join(ctx,host,room,'Blau QA','t2',origin)
 await host.locator('[data-action="start-game"]').click()

 async def uncover(id):
  await host.locator(f'[data-action="open"][data-qid="{id}"]').click()
  await host.locator('[data-action="uncover-question"]').click()

 await uncover('start')
 await red.locator('[data-action="buzz"]').click()
 await expect(host.locator('.bq-buzzer-winner')).to_contain_text('Rot QA')
 await host.locator('[data-action="buzz-correct"]').click()
 await host.locator('[data-action="back"]').click()
 await expect(blue.locator('.bq-selection-turn')).to_contain_text('Blau')
 for id,team,verdict,strike in [('a','t2','wrong','b'),('c','t1','correct','d')]:
  await uncover(id)
  await expect(host.locator('.bq-first-answer')).to_contain_text('Blau' if team=='t2' else 'Rot')
  for guest in (red,blue):
   await expect(guest.locator('.bq-quiz-verdict')).to_contain_text('antwortet')
   await expect(guest.locator('[data-action="buzz"]')).to_have_count(0)
  before=await host.evaluate('team=>window.__probe.info().publicState.scores[team]',team)
  points=await host.evaluate('()=>window.__probe.info().publicState.current.points')
  await host.locator(f'[data-action="first-{verdict}"]').click()
  await expect(blue.locator('.bq-answer-view')).to_contain_text('Lösung '+id)
  assert await host.evaluate('team=>window.__probe.info().publicState.scores[team]',team)==before+(points if verdict=='correct' else 0)
  await host.locator('[data-action="back"]').click()
  field=host.locator(f'[data-action="balance-strike"][data-qid="{strike}"]')
  for width,height in [(320,568),(390,844),(768,1024),(1366,850),(1920,1080)]:
   await host.set_viewport_size({'width':width,'height':height})
   await field.click(trial=True,timeout=5000)
   assert await host.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  await field.click()
  await expect(blue.locator('.tile.is-struck')).to_have_count(1 if id=='a' else 2)
  await host.locator('[data-action="balance-unstrike"]').click()
  await expect(field).to_be_enabled()
  await field.click()
 await host.locator('[data-action="next-board"]').click()
 await expect(blue.locator('.bq-board-scene .bq-eyebrow')).to_contain_text('RUNDE 2')
 print('PASS: Board 1, balance board exclusive answers, zero or full points, reversible strikes, then Board 2',flush=True)

async def main():
 server=fixture.http.ThreadingHTTPServer(('127.0.0.1',0),fixture.http.Handler)
 threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  await exercise(f'http://127.0.0.1:{server.server_port}/')
 finally:
  server.shutdown();server.server_close()

if __name__=='__main__':asyncio.run(main())
