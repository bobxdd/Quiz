"""Browser integration: no Firebase project required, offline editing and image blocks."""
import asyncio, pathlib, os, shutil, base64, io
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
from importlib.machinery import SourceFileLoader
p=pathlib.Path(__file__).resolve().parent.parent
CAP=p/'test-artifacts';CAP.mkdir(exist_ok=True)
async def run():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True,executable_path=shutil.which('chromium'),args=['--no-sandbox','--no-proxy-server'])
  page=await browser.new_page(viewport={'width':1600,'height':1000});errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
  html=(p/'docs/index.html').read_text().replace('<link rel="stylesheet" href="./style.css">','<style>'+(p/'docs/style.css').read_text()+'</style>').replace('<script src="./firebase-config.js"></script>','').replace('<script type="module" src="./app.mjs"></script>','')
  await page.set_content(html)
  await page.evaluate('''async ({app,core,layout})=>{
   const map = new Map(); Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)}});
   window.history.replaceState=()=>{};window.BRAINQUIZ_FIREBASE_CONFIG={};
   const layoutURL=URL.createObjectURL(new Blob([layout],{type:'text/javascript'}));
   const coreURL=URL.createObjectURL(new Blob([core.replace("from './layout.mjs'",`from '${layoutURL}'`)],{type:'text/javascript'}));
   await import(URL.createObjectURL(new Blob([app.replace("from './layout.mjs'",`from '${layoutURL}'`).replace("from './core.mjs'",`from '${coreURL}'`)],{type:'text/javascript'})));
  }''',{'app':(p/'docs/app.mjs').read_text(),'core':(p/'docs/core.mjs').read_text(),'layout':(p/'docs/layout.mjs').read_text()})
  assert await page.locator('[data-action="create-offline"]').count()==1
  await page.locator('[data-action="create-offline"]').click()
  await page.locator('.editor-studio').wait_for(timeout=4000)
  await page.locator('[data-action="new-q"]').click()
  await page.locator('#q-prompt').fill('Welcher Champion gehört zu diesen Hinweisen?')
  await page.locator('#q-answer').fill('Ein Beispielchampion')
  await page.locator('#q-title').fill('Blocklayout-Vorführung')
  for typ in ['heading','text','callout','shape','image']:
   await page.locator(f'[data-action="add-block"][data-block-type="{typ}"]').click()
  await page.wait_for_timeout(250)
  print('BLOCKS',await page.locator('.studio-canvas .bq-block').count(),'errors',errors,'toast',await page.locator('#toaster').inner_text(),flush=True)
  assert await page.locator('.studio-canvas .bq-block').count()==5
  await page.locator('.studio-canvas .bq-block').first.click()
  await page.locator('#block-text').fill('DER CHAMPION-TEST')
  await page.locator('#block-size').fill('36');await page.locator('#block-size').dispatch_event('change')
  await page.wait_for_timeout(450)
  assert 'DER CHAMPION-TEST' in await page.locator('.studio-canvas').inner_text()
  print('before click blocks',await page.locator('.studio-canvas [data-action="select-block"]').evaluate_all('(els)=>els.map(x=>[x.dataset.blockId,x.innerText.substring(0,15)])'),flush=True)
  await page.locator('.studio-canvas [data-action="select-block"]').last.click()
  await page.wait_for_timeout(200)
  print('selected block=',await page.locator('.studio-canvas .bq-block.selected').count(), 'inspector', (await page.locator('.studio-tools').inner_text())[:400], 'errors', errors,flush=True)
  await page.locator('[data-blockimage]').wait_for(timeout=2500)
  image=Image.new('RGB',(420,210),'#3a414b');d=ImageDraw.Draw(image);d.rounded_rectangle((52,30,350,178),radius=32,outline='#bdccc9',width=9);d.ellipse((150,67,258,163),fill='#afc5c0');buf=io.BytesIO();image.save(buf,format='PNG')
  await page.locator('[data-blockimage]').set_input_files({'name':'example.png','mimeType':'image/png','buffer':buf.getvalue()})
  await page.wait_for_timeout(350)
  assert await page.locator('.studio-canvas .bq-figure img').count()==1
  await page.locator('#block-alt').fill('Abstrakte Demo-Grafik')
  await page.locator('#block-revealOnly').check();await page.wait_for_timeout(450)
  assert await page.locator('.studio-canvas .bq-privacy-tag').count()==1
  await page.locator('[data-action="preview-q"]').click()
  await page.wait_for_timeout(250)
  assert await page.locator('.previewpanel .bq-figure img').count()==0, 'Hidden image leaked in preview'
  await page.locator('[data-action="preview-reveal"]').click();await page.wait_for_timeout(250)
  assert await page.locator('.previewpanel .bq-figure img').count()==1, 'Reveal missing image'
  await page.screenshot(path=str(CAP/'Vorschau_1_3_Modularer_Editor.png'),full_page=True)
  await page.locator('[data-action="view"][data-view="present"]').click()
  await page.wait_for_timeout(300)
  assert await page.locator('.presenter-stage .bq-block').count()>=4
  await page.screenshot(path=str(CAP/'Vorschau_1_3_Praesentation.png'),full_page=True)
  await page.locator('[data-action="view"][data-view="editor"]').first.click()
  await page.locator('[data-action="export"]').click()
  await page.wait_for_timeout(200)
  assert not errors,errors
  print('PASS: Offline-Start, Frageneditor, fünf Layoutblöcke, Eigenschaftsänderungen, Bildoptimierung, Reveal-Privatsphäre, Präsentation, Export; JS errors=0')
  await browser.close()
if __name__=='__main__': asyncio.run(run())
