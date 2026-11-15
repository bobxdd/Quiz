"""Browser E2E for board-first authoring, scoring and responsive host UI (offline; no Firebase)."""
import asyncio,pathlib,shutil
from playwright.async_api import async_playwright
p=pathlib.Path(__file__).resolve().parent.parent
CAP=p/'test-artifacts';CAP.mkdir(exist_ok=True)
async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True,executable_path=shutil.which('chromium'),args=['--no-sandbox','--no-proxy-server'])
  page=await browser.new_page(viewport={'width':1680,'height':980})
  errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
  page.on('dialog',lambda dialog:asyncio.create_task(dialog.accept('Ada')))
  html=(p/'docs/index.html').read_text().replace('<link rel="stylesheet" href="./style.css">','<style>'+(p/'docs/style.css').read_text()+'</style>').replace('<script src="./firebase-config.js"></script>','').replace('<script type="module" src="./app.mjs"></script>','')
  await page.set_content(html)
  await page.evaluate('''async ({app,core,layout})=>{
   const m=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}});
   window.history.replaceState=()=>{};window.BRAINQUIZ_FIREBASE_CONFIG={};
   const lu=URL.createObjectURL(new Blob([layout],{type:'text/javascript'}));
   const cu=URL.createObjectURL(new Blob([core.replace("from './layout.mjs'",`from '${lu}'`)],{type:'text/javascript'}));
   await import(URL.createObjectURL(new Blob([app.replace("from './layout.mjs'",`from '${lu}'`).replace("from './core.mjs'",`from '${cu}'`)],{type:'text/javascript'})));
  }''',{'app':(p/'docs/app.mjs').read_text(),'core':(p/'docs/core.mjs').read_text(),'layout':(p/'docs/layout.mjs').read_text()})
  await page.locator('[data-action=create-offline]').click()
  await page.locator('.editor-studio').wait_for()
  await page.locator('[data-action=toggle-quickset]').click()
  await page.locator('#quick-categories').wait_for()
  assert await page.locator('#quick-categories').count()==1
  await page.locator('[data-action=quick-add]').click()
  await page.wait_for_timeout(150)
  assert await page.locator('.editor-board .tile').count()==25
  assert await page.locator('.editor-board .column').count()==5
  assert await page.locator('.editor-board .tile').first.inner_text()=='100\n○'
  await page.locator('#q-prompt').fill('Welcher Champion besitzt Charme?')
  await page.locator('#q-answer').fill('Ahri')
  await page.wait_for_timeout(500)
  await page.screenshot(path=str(CAP/'Vorschau_1_5_25_Fragen_Editor.png'),full_page=False)
  await page.locator('[data-action=view][data-view=live]').first.click()
  await page.locator('.board-primary .jeopardy-board .tile').first.wait_for()
  assert await page.locator('.board-primary .tile').count()==25
  await page.locator('[data-action=add-person]').click()
  await page.locator('.score-person').first.wait_for(timeout=5000)
  assert 'Ada' in await page.locator('.scoring-panel').inner_text()
  await page.locator('.board-primary .tile').first.click()
  await page.get_by_text('Welcher Champion besitzt Charme?').first.wait_for(timeout=5000)
  await page.locator('.scoring-panel [data-action=select-player]').first.click()
  await page.locator('[data-action=judge-correct]').click()
  await page.wait_for_function('document.querySelector(".score-person strong")?.textContent==="100"',timeout=5000)
  await page.locator('[data-action=judge-correct]').click()
  await page.wait_for_function('document.querySelector(".score-person strong")?.textContent==="100"',timeout=5000)
  await page.locator('[data-action=judge-wrong]').click()
  await page.wait_for_function('document.querySelector(".score-person strong")?.textContent==="-50"',timeout=5000)
  await page.locator('#person-adjust').fill('25')
  await page.locator('[data-action=adjust-player]').click()
  await page.wait_for_function('document.querySelector(".score-person strong")?.textContent==="-25"',timeout=5000)
  await page.screenshot(path=str(CAP/'Vorschau_1_5_Brett_Punkte.png'),full_page=False)
  await page.locator('[data-action=back]').click()
  await page.wait_for_function('document.querySelectorAll(".board-primary .tile.used").length===1',timeout=5000)
  for w in [1680,1280,1024,820,390]:
   await page.set_viewport_size({'width':w,'height':900})
   dims=await page.evaluate('({w:innerWidth,scrollWidth:document.documentElement.scrollWidth})')
   assert dims['scrollWidth']<=dims['w']+3,f'overflow {dims}'
   print('responsive',dims)
  assert not errors, errors
  print('PASS: 5x5 builder, secret-free board, person score, correct/idempotency/wrong/manual, used tiles, responsive')
  await browser.close()
if __name__=='__main__': asyncio.run(main())
