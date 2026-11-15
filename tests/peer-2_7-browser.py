"""BrainQuiz Browser E2E with two same-origin about:blank windows and an in-browser
PeerJS transport mock (real UI, question and privacy logic; NOT real ICE/NAT).
"""
import asyncio,base64,shutil,json
from pathlib import Path
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[1]
files=['app.mjs','peer-client.mjs','core.mjs','layout.mjs','studio-model.mjs','studio-editor.mjs','answer-review.mjs','history-model.mjs','lobby-model.mjs','question-flow.mjs']
sources={name:(root/'docs'/name).read_text() for name in files}
html=(root/'docs/index.html').read_text().replace('<link rel="stylesheet" href="./style.css">','<style>'+(root/'docs/style.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./pixel-theme.css">','<style>'+(root/'docs/pixel-theme.css').read_text()+'</style>').replace('<script type="module" src="./app.mjs"></script>','')
for name in ['mascot-pixel.png','mascot-ranger.png','mascot-lantern.png','mascot-alchemist.png','pixel-constellation.png','pixel-corner.png']:
 html=html.replace('./'+name,'data:image/png;base64,'+base64.b64encode((root/'docs'/name).read_bytes()).decode())
mockpeer=(root/'tests/mock-peerjs-browser.js').read_text()
# Blob-loaded app scripts otherwise resolve relative PNGs against about:blank.
# Replace the four dynamic mascot URLs with real image bytes so screenshots and
# image-loading checks mirror GitHub Pages rather than rendering broken icons.
for mascot in ['mascot-pixel.png','mascot-ranger.png','mascot-lantern.png','mascot-alchemist.png']:
 sources['app.mjs']=sources['app.mjs'].replace('./'+mascot,'data:image/png;base64,'+base64.b64encode((root/'docs'/mascot).read_bytes()).decode())


async def install(page):
 await page.set_content(html)
 await page.evaluate(mockpeer)
 await page.evaluate('''async (src)=>{
  const local=new Map(),session=new Map();
  const storage=map=>({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)});
  Object.defineProperty(window,'localStorage',{configurable:true,value:storage(local)});
  Object.defineProperty(window,'sessionStorage',{configurable:true,value:storage(session)});
  window.history.replaceState=()=>{};
  const blob=body=>URL.createObjectURL(new Blob([body],{type:'text/javascript'}));
  const lobby=blob(src['lobby-model.mjs']);const layout=blob(src['layout.mjs']);const model=blob(src['studio-model.mjs']);
  const review=blob(src['answer-review.mjs'].replace("from './lobby-model.mjs'",`from '${lobby}'`));
  const history=blob(src['history-model.mjs']);const flow=blob(src['question-flow.mjs']);
  const editor=blob(src['studio-editor.mjs'].replace("from './studio-model.mjs'",`from '${model}'`));
  const core=blob(src['core.mjs'].replace("from './layout.mjs'",`from '${layout}'`).replace("from './studio-model.mjs'",`from '${model}'`));
  const peer=blob(src['peer-client.mjs'].replace("from './core.mjs'",`from '${core}'`).replace("from './lobby-model.mjs'",`from '${lobby}'`).replace("from './question-flow.mjs'",`from '${flow}'`));
  const hook=`window.__probe={room:()=>room,role:()=>role,getGame:()=>game,getQuiz:()=>structuredClone(quiz),setQuiz:x=>{quiz=normalizedQuiz(x);selected=quiz.questions[0]?.id||'';saveLocal();},info:()=>({role,room,publicState,member})};`;
  const app=src['app.mjs'].replace('const studio=createStudioEditor(',hook+'const studio=createStudioEditor(')
   .replace("import('./peer-client.mjs')",`import('${peer}')`)
   .replace("from './studio-editor.mjs'",`from '${editor}'`).replace("from './studio-model.mjs'",`from '${model}'`)
   .replace("from './layout.mjs'",`from '${layout}'`).replace("from './core.mjs'",`from '${core}'`)
   .replace("from './answer-review.mjs'",`from '${review}'`).replace("from './history-model.mjs'",`from '${history}'`)
   .replace("from './lobby-model.mjs'",`from '${lobby}'`).replace("from './question-flow.mjs'",`from '${flow}'`);
  await import(blob(app));
 }''',sources)

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':900})
  errors=[]
  host=await ctx.new_page();host.on('pageerror',lambda x:errors.append('Host: '+str(x)))
  await install(host)
  assert await host.get_by_role('button',name='Online-Raum erstellen').count()==1
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await host.locator('.se-studio').first.wait_for(timeout=12000)
  code=await host.evaluate('window.__probe.room()')
  assert len(code)==16,code
  question={'id':'q-test-p2p','category':'Lore','title':'Frage 1','type':'text','points':100,'prompt':'Wer fliegt durch Freljord?','answer':'Anivia'}
  quiz={'title':'Testquiz P2P','teams':['Rot','Blau'],'questions':[question]}
  await host.evaluate('(quiz)=>window.__probe.setQuiz(quiz)',quiz)
  await host.locator('[data-action="publish"]').first.click()
  await host.locator('.board-primary .tile').first.wait_for(timeout=12000)
  async with ctx.expect_page() as event:
   await host.evaluate("window.open('about:blank','_blank')")
  guest=await event.value;guest.on('pageerror',lambda x:errors.append('Gast: '+str(x)))
  await install(guest)
  await guest.locator('#join-room').fill(code)
  await guest.locator('#join-name').fill('Alice')
  await guest.locator('button[type="submit"]').first.click()
  try:
   await guest.get_by_text('FREIGABE AUSSTEHEND').wait_for(timeout=12000)
  except Exception:
   print('DIAG guest', (await guest.locator('body').inner_text())[-1800:]);print('DIAG host', (await host.locator('body').inner_text())[-950:]);print('DIAG js errors', errors)
   print('DIAG guestinfo',await guest.evaluate('()=>window.__probe?.info?.()'))
   print('DIAG hostpeer',await host.evaluate('()=>({peer:window.__probe.getGame()?.peer?.id,memberCount:Object.keys(window.__probe.getGame()?.data?.members||{}).length})'))
   raise
  await host.locator('.top-nav [data-view="teams"]').click()
  await host.locator('[data-action="approve"]').first.wait_for(timeout=12000)
  await host.locator('[data-action="approve"]').first.click()
  await guest.locator('.guest-board').wait_for(timeout=12000)
  assert await guest.locator('.guest-board .tile').count()==1
  assert 'Anivia' not in await guest.locator('body').inner_text(), 'Host answer leaked before reveal'
  await host.locator('.top-nav [data-view="live"]').click()
  await host.locator('.board-primary .tile').first.click()
  await guest.locator('.guest-question').get_by_text('Wer fliegt durch Freljord?').wait_for(timeout=12000)
  await guest.locator('#answer-text').fill('Sivir')
  await guest.locator('[data-action="submit-answer"]').click()
  await guest.locator('.review-card.is-hidden').first.wait_for(timeout=12000)
  assert 'Sivir' not in await guest.locator('.review-grid').inner_text(), 'Hidden answer leaked'
  await host.locator('.review-card.is-hidden').first.wait_for(timeout=12000)
  await host.locator('[data-action="reveal-answer"]').first.click()
  await guest.locator('.review-grid').get_by_text('Sivir').wait_for(timeout=12000)
  assert await guest.locator('.bq-character-dock img').count()==4
  assert await guest.locator('.bq-character-dock img').evaluate_all('(els)=>els.every(el=>el.complete&&el.naturalWidth>0)'), 'Four character sprites were not loaded'
  assert 'Anivia' not in await guest.locator('.review-grid').inner_text()
  await host.screenshot(path=str(root/'screenshots/Vorschau_2_7_P2P_Host.png'),full_page=True)
  await guest.screenshot(path=str(root/'screenshots/Vorschau_2_7_P2P_Teilnehmer.png'),full_page=True)
  assert not errors,errors
  print('PASS: Two browser windows: P2P host create, question publish, guest request + approval, answer, private review and explicit reveal; no JS exceptions.')
  await browser.close()
if __name__=='__main__':asyncio.run(main())
