"""Real Chromium interactions (offline mode), responsive checks, no Firebase backend."""
import asyncio, pathlib, shutil, io, json
from playwright.async_api import async_playwright
from PIL import Image
p=pathlib.Path(__file__).resolve().parent.parent
CAP=p/'test-artifacts'; CAP.mkdir(exist_ok=True)
async def run():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True,executable_path=shutil.which('chromium'),args=['--no-sandbox','--no-proxy-server'])
  page=await browser.new_page(viewport={'width':1680,'height':960})
  errs=[];page.on('pageerror',lambda err:errs.append(str(err)))
  html=(p/'docs/index.html').read_text().replace('<link rel="stylesheet" href="./style.css">','<style>'+(p/'docs/style.css').read_text()+'</style>').replace('<script src="./firebase-config.js"></script>','').replace('<script type="module" src="./app.mjs"></script>','')
  await page.set_content(html)
  await page.evaluate('''async ({app,core,layout})=>{
   const m=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}});
   window.history.replaceState=()=>{};window.BRAINQUIZ_FIREBASE_CONFIG={};
   const lu=URL.createObjectURL(new Blob([layout],{type:'text/javascript'}));
   const cu=URL.createObjectURL(new Blob([core.replace("from './layout.mjs'",`from '${lu}'`)],{type:'text/javascript'}));
   await import(URL.createObjectURL(new Blob([app.replace("from './layout.mjs'",`from '${lu}'`).replace("from './core.mjs'",`from '${cu}'`)],{type:'text/javascript'})));
  }''',{'app':(p/'docs/app.mjs').read_text(),'core':(p/'docs/core.mjs').read_text(),'layout':(p/'docs/layout.mjs').read_text()})
  assert await page.locator('.start-grid .start-card').count()==3
  assert 'Deine Bühne' not in await page.locator('body').inner_text()
  assert await page.locator('h1').first.inner_text()=='Quiz öffnen'
  await page.screenshot(path=str(CAP/'Vorschau_1_4_Start.png'),full_page=True)
  await page.locator('[data-action="create-offline"]').click()
  await page.locator('.editor-studio').wait_for()
  assert not await page.locator('.quiz-metadata').evaluate('(e)=>e.open')
  await page.locator('[data-action="new-q"]').click()
  await page.locator('#q-prompt').fill('Welcher Champion ist gesucht?')
  await page.locator('#q-answer').fill('Beispielchampion')
  await page.locator('.question-settings summary').click()
  await page.locator('#q-title').fill('Champion erraten')
  await page.wait_for_timeout(500)
  assert await page.locator('.question-settings').evaluate('(e)=>e.open'),'Advanced question settings collapsed after input'
  await page.locator('.question-settings summary').click()
  for typ in ['heading','text','image','shape']:
   await page.locator(f'[data-action="add-block"][data-block-type="{typ}"]').click()
  await page.wait_for_function('document.querySelectorAll(".studio-canvas .bq-block").length===4')
  await page.locator('.studio-canvas .bq-block').first.click()
  await page.locator('#block-text').fill('CHAMPION')
  await page.locator('.inspector-advanced summary').click()
  await page.locator('#block-size').fill('32')
  await page.wait_for_timeout(500)
  assert await page.locator('.inspector-advanced').evaluate('(e)=>e.open'),'Inspector collapsed after editing'
  assert 'CHAMPION' in await page.locator('.studio-canvas').inner_text()
  await page.locator('[data-action="preview-q"]').click()
  await page.locator('.previewpanel').wait_for(timeout=4000)
  await page.screenshot(path=str(CAP/'Vorschau_1_4_Frageneditor.png'),full_page=False)
  # interaction regression: search, selection and save after UI redraw
  await page.locator('#editor-search').fill('NO-MATCH-SEARCH')
  await page.wait_for_timeout(400)
  assert await page.get_by_text('Keine passenden Fragen.').count()==1
  await page.locator('#editor-search').fill('Champion')
  await page.wait_for_timeout(400)
  assert await page.locator('.questionitem').count()==1
  await page.locator('.questionitem').first.click()
  assert await page.locator('#q-prompt').input_value()=='Welcher Champion ist gesucht?'
  await page.locator('[data-action="view"][data-view="present"]').click()
  await page.locator('.presenter-stage').wait_for(timeout=4000)
  await page.screenshot(path=str(CAP/'Vorschau_1_4_Praesentation.png'),full_page=False)
  # responsive layout in typical desktop, tablet and phone widths
  await page.locator('[data-action="view"][data-view="editor"]').first.click()
  await page.locator('.editor-studio').wait_for(timeout=4000)
  for w in [1680,1280,1024,820,390]:
   await page.set_viewport_size({'width':w,'height':900})
   await page.wait_for_timeout(120)
   dims=await page.evaluate('({w:window.innerWidth,sw:document.documentElement.scrollWidth,question:!!document.querySelector("#q-prompt")})')
   assert dims['question'], dims
   assert dims['sw'] <= dims['w']+3,f'Horizontal overflow at {w}: {dims}'
   print('responsive',w,dims,flush=True)
  assert not errs,errs
  print('PASS: task-first landing, modular editor, advanced property states, question search, preview, presentation, responsive widths, no JS errors',flush=True)
  await browser.close()
if __name__=='__main__':asyncio.run(run())
