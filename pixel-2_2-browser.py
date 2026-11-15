"""Browser-based layout regression using the actual BrainQuiz app renderer and CSS.
Isolated fixture; not a Firebase / multiple-browser end-to-end test.
"""
import asyncio,shutil,json,base64
from pathlib import Path
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[1]
files=['app.mjs','core.mjs','layout.mjs','studio-model.mjs','studio-editor.mjs','answer-review.mjs','history-model.mjs','lobby-model.mjs']
sources={f:(root/'docs'/f).read_text() for f in files}
html=(root/'docs/index.html').read_text().replace('./mascot-pixel.png','data:image/png;base64,'+base64.b64encode((root/'docs/mascot-pixel.png').read_bytes()).decode()).replace('<link rel="stylesheet" href="./style.css">','<style>'+(root/'docs/style.css').read_text()+'</style>').replace('<script src="./firebase-config.js"></script>','').replace('<script type="module" src="./app.mjs"></script>','')
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--no-proxy-server'])
  pages=[];errors=[]
  for host in [False,True]:
   page=await browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
   pages.append(page)
   page.on('pageerror',lambda exc:errors.append(str(exc)))
   await page.set_content(html)
   await page.evaluate('''async (args)=>{
    const store=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}});
    window.history.replaceState=()=>{};
    const blob=body=>URL.createObjectURL(new Blob([body],{type:'text/javascript'}));
    const lobby=blob(args.sources['lobby-model.mjs']);
    const layout=blob(args.sources['layout.mjs']);
    const model=blob(args.sources['studio-model.mjs']);
    const review=blob(args.sources['answer-review.mjs'].replace("from './lobby-model.mjs'",`from '${lobby}'`));
    const history=blob(args.sources['history-model.mjs']);
    const editor=blob(args.sources['studio-editor.mjs'].replace("from './studio-model.mjs'",`from '${model}'`));
    const core=blob(args.sources['core.mjs'].replace("from './layout.mjs'",`from '${layout}'`).replace("from './studio-model.mjs'",`from '${model}'`));
    const injection=`window.__loadReview=(asHost)=>{room='DEMO123';role=asHost?'host':'guest';view=asHost?'live':'play';connected=true;member={status:'approved',name:'Spieler 1',team:'t1'};const entries={};roster={};for(let i=1;i<=8;i++){const id='guest_'+i;entries[id]={name:'Person '+i,submitted:true,revealed:i===3};if(i===3)entries[id].value='200';roster[id]={name:'Person '+i,team:'t1'};}publicState={phase:'review',round:1,current:{id:'q',category:'Schätzfragen',points:300,prompt:'Schätzfrage'},answerReview:{round:1,entries},settings:{buzzerEnabled:false,chatOpen:false},teams:{t1:'Team 1'},playerScores:{},manualPlayers:{}};schedule()};`;
    const app=args.sources['app.mjs'].replace('const studio=createStudioEditor(',injection+'const studio=createStudioEditor(').replace("from './studio-editor.mjs'",`from '${editor}'`).replace("from './studio-model.mjs'",`from '${model}'`).replace("from './layout.mjs'",`from '${layout}'`).replace("from './core.mjs'",`from '${core}'`).replace("from './answer-review.mjs'",`from '${review}'`).replace("from './history-model.mjs'",`from '${history}'`).replace("from './lobby-model.mjs'",`from '${lobby}'`);
    await import(blob(app));window.__loadReview(args.host);
   }''',{'sources':sources,'host':host})
   await page.locator('.review-grid .review-card').first.wait_for(timeout=10000)
   assert await page.locator('.review-card').count()==8
   assert await page.locator('.sidebar').count()==0
   mascot=page.locator('.bq-pixel-mascot img')
   assert await mascot.count()==1
   assert await mascot.evaluate('(el)=>el.complete && el.naturalWidth>0')
   assert await mascot.evaluate('(el)=>getComputedStyle(el).imageRendering')=='pixelated'
   assert await page.locator('.bq-pixel-mascot').evaluate('(el)=>getComputedStyle(el).pointerEvents')=='none'
   assert await page.locator('.review-sidebar').count()==0
   assert await page.locator('.header-state .status').inner_text()=='Live verbunden'
   assert await page.locator('.review-card.is-hidden').count()==7
   assert await page.locator('.review-answer').count()==1
   assert await page.locator('.review-card.is-hidden .review-value').first.evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgba(0, 0, 0, 0)'
   # Decorative art must not cover answer cards or critical host action buttons.
   collision=await page.evaluate("""() => {const sprite=document.querySelector('.bq-pixel-mascot').getBoundingClientRect();const controls=[...document.querySelectorAll('.review-card,.review-actions button')];return controls.filter(el=>{const r=el.getBoundingClientRect();return Math.min(sprite.right,r.right)-Math.max(sprite.left,r.left)>1 && Math.min(sprite.bottom,r.bottom)-Math.max(sprite.top,r.top)>1}).map(el=>el.className)}""")
   assert not collision,('Mascot overlaps live question UI',collision)
   assert await page.locator('.review-card.is-hidden').first.evaluate('(el)=>getComputedStyle(el).backdropFilter.includes("blur")')
   assert '200' not in '\n'.join(await page.locator('.review-card.is-hidden').all_inner_texts())
   rects=await page.locator('.review-card').evaluate_all('(els)=>els.map(el=>{let r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})')
   assert len(set(round(r['y']) for r in rects))==2,rects
   assert len(set(round(r['x']) for r in rects[:4]))==4,rects
   assert rects[3]['x']+rects[3]['w']>1360,rects
   if host:
    assert await page.locator('.top-nav [data-view=history]').count()==1
    await page.locator('#review-points-panel summary').click()
    assert await page.locator('#review-points-panel').get_attribute('open') is not None
    assert await page.locator('#review-points-panel .scoring-panel').count()==1
   else:
    assert await page.locator('.top-nav [data-view=teams]').count()==1
    assert await page.locator('#review-points-panel').count()==0
   if host:
    await page.locator('#review-points-panel summary').click()
    await page.wait_for_timeout(80)
   await page.evaluate('window.scrollTo(0,0)')
   await page.wait_for_timeout(400)
   await page.screenshot(path=str(root/'screenshots'/('Vorschau_2_2_Host.png' if host else 'Vorschau_2_2_Teilnehmer.png')))
  guest=pages[0]
  for w in [1280,1024,820,680,390,320]:
   await guest.set_viewport_size({'width':w,'height':844})
   await guest.wait_for_timeout(80)
   dims=await guest.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
   assert dims['scroll']<=w+3,(w,dims)
   bounds=await guest.locator('.bq-pixel-mascot').bounding_box()
   assert bounds and bounds['width']<=120 and bounds['x']>=0,(w,bounds)
   if w==390:await guest.screenshot(path=str(root/'screenshots/Vorschau_2_2_Mobil.png'),full_page=True)
  # Navigation is not decorative: each moved tab must still open its page.
  await guest.locator('.top-nav [data-view=teams]').click()
  await guest.locator('.page .roster').wait_for()
  await guest.locator('.top-nav [data-view=setup]').click()
  await guest.get_by_text('Verbindungsdetails',exact=True).wait_for()
  await guest.locator('.top-nav [data-view=play]').click()
  await guest.locator('.review-grid').wait_for()
  host=pages[1]
  await host.locator('.top-nav [data-view=history]').click()
  await host.locator('.history-panel').wait_for()
  await host.locator('.top-nav [data-view=live]').click()
  await host.locator('.review-grid').wait_for()
  assert not errors,errors
  print('PASS: Pixel Glass 2.2 renderer: 8 cards 4x2, full width, real top nav and status, no sidebar, full-card frosted effect, private masked values, host scoring details, responsive at 6 widths')
  await browser.close()
if __name__=='__main__':asyncio.run(main())
