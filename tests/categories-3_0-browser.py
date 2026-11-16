"""BrainQuiz Browser E2E with two same-origin about:blank windows and an in-browser
PeerJS transport mock (real UI, question and privacy logic; NOT real ICE/NAT).
"""
import asyncio,base64,shutil,json
from pathlib import Path
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[1]
files=['app.mjs','peer-client.mjs','core.mjs','layout.mjs','studio-model.mjs','studio-editor.mjs','answer-review.mjs','history-model.mjs','lobby-model.mjs','lobby-view.mjs','question-flow.mjs','category-model.mjs','editor-workflows.mjs','round-rules.mjs','map-tools.mjs','map-viewport.mjs','map-dagger-animation.mjs','board-workspace.mjs']
sources={name:(root/'docs'/name).read_text() for name in files}
characters_css=(root/'docs/characters.css').read_text()
for character in ('rogue','blades','mage','druid'):
 src='./characters/'+character+'.webp'
 characters_css=characters_css.replace(src,'data:image/webp;base64,'+base64.b64encode((root/'docs'/src).read_bytes()).decode())
html=(root/'docs/index.html').read_text().replace('<link rel="stylesheet" href="./lobby-ui.css">','<style>'+(root/'docs/lobby-ui.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./style.css">','<style>'+(root/'docs/style.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./pixel-theme.css">','<style>'+(root/'docs/pixel-theme.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./characters.css">','<style>'+characters_css+'</style>').replace('<link rel="stylesheet" href="./session-ui.css">','<style>'+(root/'docs/session-ui.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./editor-categories.css">','<style>'+(root/'docs/editor-categories.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./editor-31.css">','<style>'+(root/'docs/editor-31.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./map-ui.css">','<style>'+(root/'docs/map-ui.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./actor-motion.css">','<style>'+(root/'docs/actor-motion.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./map-dagger-animation.css">','<style>'+(root/'docs/map-dagger-animation.css').read_text()+'</style>').replace('<link rel="stylesheet" href="./board-workspace.css">','<style>'+(root/'docs/board-workspace.css').read_text()+'</style>').replace('<script type="module" src="./app.mjs"></script>','')
for name in ['characters/rogue.webp','characters/blades.webp','characters/mage.webp','characters/druid.webp','pixel-constellation.png','pixel-corner.png']:
 html=html.replace('./'+name,'data:image/png;base64,'+base64.b64encode((root/'docs'/name).read_bytes()).decode())
# A Blob module has no GitHub Pages-relative asset base; inline the real static map assets for genuine pixel tests.
sources['map-viewport.mjs']=sources['map-viewport.mjs'].replace('./world-map.svg','data:image/svg+xml;base64,'+base64.b64encode((root/'docs/world-map.svg').read_bytes()).decode()).replace('./dagger-pin.svg','data:image/svg+xml;base64,'+base64.b64encode((root/'docs/dagger-pin.svg').read_bytes()).decode())
sources['map-dagger-animation.mjs']=sources['map-dagger-animation.mjs'].replace('./dagger-pin.svg','data:image/svg+xml;base64,'+base64.b64encode((root/'docs/dagger-pin.svg').read_bytes()).decode())
mockpeer=(root/'tests/mock-peerjs-browser.js').read_text()
# Blob-loaded app scripts otherwise resolve relative PNGs against about:blank.
# Replace the four dynamic mascot URLs with real image bytes so screenshots and
# image-loading checks mirror GitHub Pages rather than rendering broken icons.
for mascot in ['characters/rogue.webp','characters/blades.webp','characters/mage.webp','characters/druid.webp']:
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
  const lobby=blob(src['lobby-model.mjs']);const layout=blob(src['layout.mjs']);const map=blob(src['map-tools.mjs']);const viewport=blob(src['map-viewport.mjs'].replace("from './map-tools.mjs'",`from '${map}'`));const model=blob(src['studio-model.mjs'].replace("from './map-viewport.mjs'",`from '${viewport}'`));const category=blob(src['category-model.mjs']);
  const review=blob(src['answer-review.mjs'].replace("from './lobby-model.mjs'",`from '${lobby}'`));
  const history=blob(src['history-model.mjs']);const flow=blob(src['question-flow.mjs']);const dagger=blob(src['map-dagger-animation.mjs']);
  const boardWorkspaces=blob(src['board-workspace.mjs']);
  const core=blob(src['core.mjs'].replace("from './layout.mjs'",`from '${layout}'`).replace("from './studio-model.mjs'",`from '${model}'`).replace("from './category-model.mjs'",`from '${category}'`));
  const lobbyView=blob(src['lobby-view.mjs'].replace("from './core.mjs'",`from '${core}'`).replace("from './lobby-model.mjs'",`from '${lobby}'`));
  const workflows=blob(src['editor-workflows.mjs'].replace("from './core.mjs'",`from '${core}'`).replace("from './category-model.mjs'",`from '${category}'`));
  const editor=blob(src['studio-editor.mjs'].replace("from './studio-model.mjs'",`from '${model}'`).replace("from './category-model.mjs'",`from '${category}'`).replace("from './editor-workflows.mjs'",`from '${workflows}'`).replace("from './map-tools.mjs'",`from '${map}'`).replace("from './map-viewport.mjs'",`from '${viewport}'`));
  const rules=blob(src['round-rules.mjs'].replace("from './core.mjs'",`from '${core}'`));
  const peer=blob(src['peer-client.mjs'].replace("from './core.mjs'",`from '${core}'`).replace("from './lobby-model.mjs'",`from '${lobby}'`).replace("from './question-flow.mjs'",`from '${flow}'`).replace("from './round-rules.mjs'",`from '${rules}'`).replace("from './map-tools.mjs'",`from '${map}'`));
  const hook=`window.__probe={room:()=>room,role:()=>role,getGame:()=>game,getQuiz:()=>structuredClone(quiz),setQuiz:x=>{quiz=normalizedQuiz(x);selected=quiz.questions[0]?.id||'';saveLocal();},info:()=>({role,room,publicState,member,guestLobby})};`;
  const app=src['app.mjs'].replace('const studio=createStudioEditor(',hook+'const studio=createStudioEditor(')
   .replace("import('./peer-client.mjs')",`import('${peer}')`)
   .replace("from './studio-editor.mjs'",`from '${editor}'`).replace("from './studio-model.mjs'",`from '${model}'`)
   .replace("from './layout.mjs'",`from '${layout}'`).replace("from './core.mjs'",`from '${core}'`).replace("from './category-model.mjs'",`from '${category}'`).replace("from './editor-workflows.mjs'",`from '${workflows}'`)
   .replace("from './answer-review.mjs'",`from '${review}'`).replace("from './history-model.mjs'",`from '${history}'`)
   .replace("from './lobby-model.mjs'",`from '${lobby}'`).replace("from './lobby-view.mjs'",`from '${lobbyView}'`).replace("from './question-flow.mjs'",`from '${flow}'`)
   .replace("from './round-rules.mjs'",`from '${rules}'`).replace("from './map-tools.mjs'",`from '${map}'`).replace("from './map-viewport.mjs'",`from '${viewport}'`).replace("from './map-dagger-animation.mjs'",`from '${dagger}'`).replace("from './board-workspace.mjs'",`from '${boardWorkspaces}'`);
  await import(blob(app));
 }''',sources)

async def run():
    async with async_playwright() as p:
       browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--no-proxy-server'])
       ctx=await browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
       errors=[]
       page=await ctx.new_page()
       page.on('pageerror',lambda error:errors.append(str(error)))
       await install(page)
       await page.get_by_role('button',name='Online-Raum erstellen').click()
       await page.locator('.se-category-overview').wait_for(timeout=15000)
       assert await page.locator('.se-category-card').count()>=7
       # Quick preset: creates an empty category, *not* an accidental question.
       await page.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
       await page.locator('.se-empty-category h2').get_by_text('Champions').wait_for()
       assert await page.locator('.se-scene').count()==0
       obj=await page.evaluate('''()=>window.__probe.getQuiz()''')
       assert obj['categories']==['Champions'] and obj['questions']==[],obj
       # One click: create a question in that category with a scene to edit.
       await page.locator('[data-se-action="new"][data-template="multiple"]').click()
       await page.locator('.se-scene').wait_for()
       obj=await page.evaluate('''()=>window.__probe.getQuiz()''')
       assert obj['questions'][0]['category']=='Champions',obj
       assert obj['questions'][0]['type']=='multiple',obj
       assert await page.locator('.se-scene .se-element').count()>=5
       await page.locator('.se-scene').click(button='right',position={'x':10,'y':10})
       await page.locator('.se-context').wait_for()
       await page.keyboard.press('Escape')
       # Add another category from overview, edit via inline form.
       await page.locator('[data-se-action="category-overview"]').first.click()
       await page.locator('[data-se-action="category-preset"][data-category="Schätzen"]').click()
       await page.locator('.se-empty-category h2').get_by_text('Schätzen').wait_for()
       await page.locator('.se-add-question').click()
       await page.locator('.se-scene').wait_for()
       obj=await page.evaluate('''()=>window.__probe.getQuiz()''')
       assert obj['questions'][-1]['category']=='Schätzen' and obj['questions'][-1]['type']=='estimate',obj
       # Rename a populated category: all linked questions move, no loss.
       await page.locator('[data-se-action="category-rename"]').click()
       await page.locator('[data-se-category-name]').fill('Schätz- und Zahlenfragen')
       await page.locator('[data-se-category-form] button[type="submit"]').click()
       await page.get_by_role('button',name='Schätz- und Zahlenfragen',exact=False).first.wait_for()
       obj=await page.evaluate('''()=>window.__probe.getQuiz()''')
       assert 'Schätz- und Zahlenfragen' in obj['categories'],obj
       assert any(q['category']=='Schätz- und Zahlenfragen' and q['type']=='estimate' for q in obj['questions']),obj
       # Removing a category with questions must not erase content.
       await page.locator('[data-se-action="category-remove"]').click()
       obj=await page.evaluate('''()=>window.__probe.getQuiz()''')
       assert 'Schätz- und Zahlenfragen' in obj['categories'] and len(obj['questions'])==2
       # Custom category creation, empty category removal.
       await page.locator('[data-se-action="category-overview"]').first.click()
       await page.locator('.se-list [data-se-action="category-form"]').click()
       await page.locator('[data-se-category-name]').fill('Eigene Spezialrunde')
       await page.locator('[data-se-category-form] button[type="submit"]').click()
       await page.locator('.se-empty-category h2').get_by_text('Eigene Spezialrunde').wait_for()
       page.on('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
       await page.locator('[data-se-action="category-remove"]').click()
       await page.locator('.se-category-overview').wait_for()
       obj=await page.evaluate('''()=>window.__probe.getQuiz()''')
       assert 'Eigene Spezialrunde' not in obj['categories'],obj
       # Existing quiz questions can be moved to a different category via inspector.
       await page.locator('[data-se-action="category-select"][data-category="Champions"]').first.click()
       await page.locator('.se-scene').wait_for()
       await page.locator('[data-se-field="category"]').select_option('Schätz- und Zahlenfragen')
       await page.wait_for_timeout(900)
       obj=await page.evaluate('''()=>window.__probe.getQuiz()''')
       assert len(obj['questions'])==2 and all(q['category']=='Schätz- und Zahlenfragen' for q in obj['questions']),obj
       # On narrow screens, no content off-screen on the horizontal axis.
       await page.set_viewport_size({'width':390,'height':780})
       await page.wait_for_timeout(250)
       await page.screenshot(path=str(root/'screenshots/Vorschau_3_0_Editor_Mobil.png'),full_page=True)
       over=await page.evaluate('''()=>({w:document.documentElement.scrollWidth,inner:innerWidth})''')
       assert over['w']<=over['inner']+8,over
       await page.locator('[data-se-action="mobile-tab"][data-mobile-tab="categories"]').click()
       await page.locator('[data-se-action="category-overview"]').first.click()
       await page.screenshot(path=str(root/'screenshots/Vorschau_3_0_Kategorien_Mobil.png'),full_page=True)
       await page.set_viewport_size({'width':1440,'height':900})
       await page.screenshot(path=str(root/'screenshots/Vorschau_3_0_Kategorien_Desktop.png'),full_page=True)
       assert not errors,errors
       print('PASS: categories CRUD, legacy-safe persistence, type presets, question editing, context menu, mobile layout; browser JavaScript errors: none')
       await browser.close()
if __name__=='__main__':asyncio.run(run())
