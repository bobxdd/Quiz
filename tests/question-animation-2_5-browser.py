"""Single-browser pixel-curtain/mascot test with the real app renderer.
Mocks Firebase state; does not claim online synchronization testing.
"""
import asyncio,base64,shutil
from pathlib import Path
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[1]
sources={name:(root/'docs'/name).read_text() for name in ['app.mjs','question-flow.mjs','core.mjs','layout.mjs','studio-model.mjs','studio-editor.mjs','answer-review.mjs','history-model.mjs','lobby-model.mjs','category-model.mjs','editor-workflows.mjs','round-rules.mjs','map-tools.mjs']}
sources['studio-model.mjs']=sources['studio-model.mjs'].replace('./world-map.svg','data:image/svg+xml;base64,'+base64.b64encode((root/'docs/world-map.svg').read_bytes()).decode())
css=(root/'docs/pixel-theme.css').read_text()
characters_css=(root/'docs/characters.css').read_text()
for character in ('rogue','blades','mage','druid'):
 src='./characters/'+character+'.webp'
 characters_css=characters_css.replace(src,'data:image/webp;base64,'+base64.b64encode((root/'docs'/src).read_bytes()).decode())
for name in ('pixel-constellation.png','pixel-corner.png'):
 css=css.replace("url('./"+name+"')", "url(data:image/png;base64,"+base64.b64encode((root/'docs'/name).read_bytes()).decode()+")")
html=(root/'docs/index.html').read_text()
html=html.replace('<link rel="stylesheet" href="./style.css">','<style>'+(root/'docs/style.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./pixel-theme.css">','<style>'+css+'</style>').replace('<link rel="stylesheet" href="./characters.css">','<style>'+characters_css+'</style>').replace('<link rel="stylesheet" href="./editor-categories.css">','<style>'+(root/'docs/editor-categories.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./editor-31.css">','<style>'+(root/'docs/editor-31.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./map-ui.css">','<style>'+(root/'docs/map-ui.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./actor-motion.css">','<style>'+(root/'docs/actor-motion.css').read_text()+'</style>').replace('<script src="./firebase-config.js"></script>','').replace('<link rel="stylesheet" href="./actor-motion.css">','<style>'+(root/'docs/actor-motion.css').read_text()+'</style>').replace('<script type="module" src="./app.mjs"></script>','')

async def setup(page):
 await page.set_content(html)
 await page.evaluate('''async sources => {
  const store=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}});window.history.replaceState=()=>{};
  const blob=body=>URL.createObjectURL(new Blob([body],{type:'text/javascript'}));
  const category=blob(sources['category-model.mjs']);const flow=blob(sources['question-flow.mjs']),lobby=blob(sources['lobby-model.mjs']),layout=blob(sources['layout.mjs']),model=blob(sources['studio-model.mjs']);
  const review=blob(sources['answer-review.mjs'].replace("from './lobby-model.mjs'",`from '${lobby}'`)),hist=blob(sources['history-model.mjs']);
  const core=blob(sources['core.mjs'].replace("from './layout.mjs'",`from '${layout}'`).replace("from './studio-model.mjs'",`from '${model}'`).replace("from './category-model.mjs'",`from '${category}'`));
  const workflows=blob(sources['editor-workflows.mjs'].replace("from './core.mjs'",`from '${core}'`).replace("from './category-model.mjs'",`from '${category}'`));
  const ed=blob(sources['studio-editor.mjs'].replace("from './studio-model.mjs'",`from '${model}'`).replace("from './category-model.mjs'",`from '${category}'`).replace("from './editor-workflows.mjs'",`from '${workflows}'`));
  const map=blob(sources['map-tools.mjs']);const rules=blob(sources['round-rules.mjs'].replace("from './core.mjs'",`from '${core}'`));
  const hook=`window.__setQuestion=(index)=>{room='DEMO123';role='guest';view='play';connected=true;member={status:'approved',name:'Spieler 1',team:'t1'};const question={id:index===1?'a':'b',category:index===1?'Lore':'Imposter',points:index===1?100:200,type:'text',prompt:'Welcher Champion ist gemeint?',hints:[]};roster={guest1:{name:'Spieler 1',team:'t1'}};publicState={title:'Demo',phase:'question',round:index,current:question,used:{a:true,b:index>1},board:{a:{id:'a',category:'Lore',points:100,used:true},b:{id:'b',category:'Imposter',points:200,used:index>1}},answerParticipants:{guest1:{name:'Spieler 1',team:'t1'}},settings:{buzzerEnabled:false,chatOpen:false},teams:{t1:'Team 1'},playerScores:{}};schedule()};window.__refresh=()=>schedule();`;
  const app=sources['app.mjs'].replace('const studio=createStudioEditor(',hook+'const studio=createStudioEditor(').replace("from './question-flow.mjs'",`from '${flow}'`).replace("from './studio-editor.mjs'",`from '${ed}'`).replace("from './studio-model.mjs'",`from '${model}'`).replace("from './layout.mjs'",`from '${layout}'`).replace("from './core.mjs'",`from '${core}'`).replace("from './category-model.mjs'",`from '${category}'`).replace("from './editor-workflows.mjs'",`from '${workflows}'`).replace("from './answer-review.mjs'",`from '${review}'`).replace("from './history-model.mjs'",`from '${hist}'`).replace("from './lobby-model.mjs'",`from '${lobby}'`).replace("from './round-rules.mjs'",`from '${rules}'`).replace("from './map-tools.mjs'",`from '${map}'`);
  await import(blob(app));window.__setQuestion(1);
 }''',sources)

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--no-proxy-server'])
  page=await browser.new_page(viewport={'width':1440,'height':900},reduced_motion='no-preference');errors=[]
  page.on('pageerror',lambda exc:errors.append(str(exc)))
  await setup(page)
  await page.locator('.bq-question-curtain').wait_for(timeout=10000)
  assert await page.locator('.bq-question-scene .stage').evaluate('(e)=>e.getBoundingClientRect().width')>900
  assert await page.locator('.bq-question-curtain').count()==1
  assert await page.locator('.bq-question-curtain').evaluate('(e)=>getComputedStyle(e).animationName.includes("bq-curtain")')
  assert await page.locator('.bq-curtain-actor').count()==0
  assert await page.locator('.bq-scene-cameos').count()==0
  assert await page.locator('.bq-action-actor').count()==0
  await page.screenshot(path=str(root/'screenshots/Vorschau_2_5_Frage_Aufdeckung.png'))
  await page.wait_for_timeout(1850)
  assert await page.locator('.bq-question-curtain').count()==0
  await page.evaluate('window.__refresh()')
  await page.wait_for_timeout(160)
  assert await page.locator('.bq-question-curtain').count()==0,'same question must not replay reveal animation'
  await page.evaluate('window.__setQuestion(2)')
  await page.locator('.bq-question-curtain').wait_for(timeout=10000)
  assert await page.locator('.bq-question-curtain').count()==1
  await page.wait_for_timeout(1850)
  assert await page.locator('.bq-question-curtain').count()==0
  await page.screenshot(path=str(root/'screenshots/Vorschau_2_5_Frage.png'))
  assert not errors,errors
  # reduced motion: never obscure question content
  reduce=await browser.new_page(viewport={'width':1280,'height':900},reduced_motion='reduce')
  await setup(reduce)
  await reduce.locator('.bq-question-scene .stage').wait_for(timeout=10000)
  assert await reduce.locator('.bq-question-curtain').count()==0
  await browser.close()
  print('PASS 2.5: Question curtain runs once per round, clean DOM after animation, no emotion sprites, no repeat on render, next round animates, reduced-motion instant reveal')
if __name__=='__main__':asyncio.run(main())
