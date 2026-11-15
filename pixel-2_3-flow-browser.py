"""Offline host/editor/board visual + functionality check with the *actual* rendering modules.
No Firebase credentials or production data are required. This is not a live E2E test.
"""
import asyncio,base64,shutil
from pathlib import Path
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[1]
src={p:(root/'docs'/p).read_text() for p in ['app.mjs','question-flow.mjs','core.mjs','layout.mjs','studio-model.mjs','studio-editor.mjs','answer-review.mjs','history-model.mjs','lobby-model.mjs']}
css=(root/'docs/pixel-theme.css').read_text()
# Browser fixtures run at about:blank; embed dynamically rendered mascot files.
for mascot in ('mascot-pixel.png','mascot-ranger.png','mascot-lantern.png','mascot-alchemist.png'):
    data='data:image/png;base64,'+base64.b64encode((root/'docs'/mascot).read_bytes()).decode()
    src['app.mjs']=src['app.mjs'].replace('./'+mascot,data)

for name in ('pixel-constellation.png','pixel-corner.png'):
 css=css.replace("url('./"+name+"')","url(data:image/png;base64,"+base64.b64encode((root/'docs'/name).read_bytes()).decode()+")")
html=(root/'docs/index.html').read_text().replace('<link rel="stylesheet" href="./style.css">','<style>'+(root/'docs/style.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./pixel-theme.css">','<style>'+css+'</style>').replace('<script src="./firebase-config.js"></script>','').replace('<script type="module" src="./app.mjs"></script>','')
html=html.replace('./mascot-pixel.png','data:image/png;base64,'+base64.b64encode((root/'docs/mascot-pixel.png').read_bytes()).decode()).replace('./mascot-ranger.png','data:image/png;base64,'+base64.b64encode((root/'docs/mascot-ranger.png').read_bytes()).decode()).replace('./mascot-lantern.png','data:image/png;base64,'+base64.b64encode((root/'docs/mascot-lantern.png').read_bytes()).decode()).replace('./mascot-alchemist.png','data:image/png;base64,'+base64.b64encode((root/'docs/mascot-alchemist.png').read_bytes()).decode())
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--no-proxy-server'])
  page=await browser.new_page(viewport={'width':1440,'height':900});errors=[]
  page.on('pageerror',lambda exc:errors.append(str(exc)))
  await page.set_content(html)
  await page.evaluate('''async sources=>{
    const store=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}});
    window.history.replaceState=()=>{};
    const blob=body=>URL.createObjectURL(new Blob([body],{type:'text/javascript'}));
    const questionFlow=blob(sources['question-flow.mjs']);const lobby=blob(sources['lobby-model.mjs']); const layout=blob(sources['layout.mjs']); const model=blob(sources['studio-model.mjs']);
    const review=blob(sources['answer-review.mjs'].replace("from './lobby-model.mjs'",`from '${lobby}'`));
    const history=blob(sources['history-model.mjs']);
    const editor=blob(sources['studio-editor.mjs'].replace("from './studio-model.mjs'",`from '${model}'`));
    const core=blob(sources['core.mjs'].replace("from './layout.mjs'",`from '${layout}'`).replace("from './studio-model.mjs'",`from '${model}'`));
    const hook=`window.__showCase=(kind)=>{room='LOCAL';role='host';connected=false;view=kind;quiz=normalizedQuiz({...emptyQuiz(),questions:quickBoard(['Trivia','Imposter','Lore','Ability Sounds','Splash Arts'],[100,200,300,400,500])});selected=quiz.questions[0].id;publicState={title:'Demo',phase:'board',round:0,board:buildPublicBoard(quiz),used:{},teams:buildTeams(quiz),playerScores:{},manualPlayers:{},settings:{buzzerEnabled:false,chatOpen:false}};schedule()};`;
    const app=sources['app.mjs'].replace('const studio=createStudioEditor(',hook+'const studio=createStudioEditor(').replace("from './question-flow.mjs'",`from '${questionFlow}'`).replace("from './studio-editor.mjs'",`from '${editor}'`).replace("from './studio-model.mjs'",`from '${model}'`).replace("from './layout.mjs'",`from '${layout}'`).replace("from './core.mjs'",`from '${core}'`).replace("from './answer-review.mjs'",`from '${review}'`).replace("from './history-model.mjs'",`from '${history}'`).replace("from './lobby-model.mjs'",`from '${lobby}'`);
    await import(blob(app)); window.__showCase('live');
  }''',src)
  await page.locator('.board-primary .tile').first.wait_for(timeout=15000)
  assert await page.locator('.board-primary .tile').count()==25
  assert await page.locator('.top-nav [data-view="editor"]').count()==1
  assert await page.locator('.coltitle').count()==5
  bg=await page.locator('.tile').first.evaluate('(el)=>getComputedStyle(el).backgroundImage')
  assert 'gradient' in bg,bg
  # The mascot must not cover any clickable board tile or the active question stage.
  collision=await page.evaluate('''() => {const sprites=[...document.querySelectorAll('.bq-pixel-mascot')].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect());return [...document.querySelectorAll('.tile,.stage,.board-primary button,.topbar button,.roomchip')].filter(el=>{const r=el.getBoundingClientRect();return sprites.some(m=>Math.min(r.right,m.right)>Math.max(r.left,m.left)+1&&Math.min(r.bottom,m.bottom)>Math.max(r.top,m.top)+1)}).length}''')
  assert collision==0,('mascots overlap board/stage',collision)
  await page.screenshot(path=str(root/'screenshots/Vorschau_2_5_Quizbrett.png'))
  await page.evaluate("window.__showCase('editor')")
  await page.locator('.se-studio .se-toolbar').first.wait_for(timeout=15000)
  assert await page.locator('.se-studio .se-list').count()==1
  assert await page.locator('.se-studio .se-inspector').count()==1
  editor_bg=await page.locator('.se-studio .se-toolbar').evaluate('(el)=>getComputedStyle(el).backgroundImage')
  assert 'gradient' in editor_bg
  await page.screenshot(path=str(root/'screenshots/Vorschau_2_5_Frageneditor.png'),full_page=True)
  for w in [1280,1024,820,680,390]:
   await page.set_viewport_size({'width':w,'height':900})
   await page.wait_for_timeout(70)
   dims=await page.evaluate('({w:innerWidth, scrollWidth:document.documentElement.scrollWidth})')
   assert dims['scrollWidth']<=w+4,('editor horizontal overflow',dims)
  await page.set_viewport_size({'width':1440,'height':900})
  assert not errors,errors
  print('PASS: 2.5 host categories board 5x5, expanded pixel-glass details, modular editor and inspector rendering, no JS errors')
  await browser.close()
if __name__=='__main__':asyncio.run(run())
