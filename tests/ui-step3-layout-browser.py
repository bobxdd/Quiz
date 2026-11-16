"""Step 3 extra quality audit, phase 1: viewport, clipping, overlap, hit testing,
unexpected visibility and evidence screenshots from real Chromium.

Only synthetic local quizboards are used. Networked PeerJS/TURN testing is separate.
Run as: python tests/ui-step3-layout-browser.py
"""
import asyncio
import functools
import json
import re
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'qa-artifacts'
SIZES=[(320,720),(375,812),(390,844),(768,1024),(1024,768),(1440,900),(1920,1080),(812,375)]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass

# Observe the browser's actual rendered rectangles rather than guessing from CSS selectors.
METRICS=r"""(options) => {
 const allowed=options.allowed||[];
 const selectors=options.selectors||[];
 const visible=e=>{
  // Closed <details> uses content-visibility:hidden in modern Chromium:
  // getBoundingClientRect() may still return a rectangle even though it cannot paint or receive input.
  // Skip the hidden content slot, but not its always-visible <summary>.
  const parent=e.closest('details:not([open])');
  if(parent && !e.closest('summary'))return false;
  const s=getComputedStyle(e),r=e.getBoundingClientRect();
  return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>3&&r.height>3;
 };
 const boxes=selectors.flatMap(sel=>[...document.querySelectorAll(sel)].filter(visible).map((e,i)=>{
  const r=e.getBoundingClientRect(),s=getComputedStyle(e);
  const centerX=r.left+r.width/2,centerY=r.top+r.height/2;
  const hit=centerX>=0&&centerY>=0&&centerX<innerWidth&&centerY<innerHeight
      ?document.elementFromPoint(centerX,centerY):null;
  return {selector:sel,index:i,tag:e.tagName,caption:(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,65),
   x:r.x,y:r.y,w:r.width,h:r.height,hidden:s.visibility==='hidden',
   overflowX:s.overflowX,scrollW:e.scrollWidth,clientW:e.clientWidth,
   hit:hit===e||e.contains(hit),hitTag:hit?.tagName,hitClass:String(hit?.className||'').slice(0,100)};
 }));
 const duplicates=[...document.querySelectorAll('[id]')].reduce((a,e)=>{a[e.id]=(a[e.id]||0)+1;return a;},{});
 const duplicateIds=Object.entries(duplicates).filter(([k,v])=>k&&v>1).map(([k,v])=>({id:k,count:v}));
 const groups=options.groups||[];
 const overlaps=[];
 for(const group of groups){
  const els=[...document.querySelectorAll(group)].filter(visible);
  for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){
   const a=els[i].getBoundingClientRect(),b=els[j].getBoundingClientRect();
   const x=Math.min(a.right,b.right)-Math.max(a.left,b.left);
   const y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
   if(x>5&&y>5&&!els[i].contains(els[j])&&!els[j].contains(els[i])){
     overlaps.push({group,a:(els[i].innerText||'').slice(0,40),b:(els[j].innerText||'').slice(0,40),x,y});
   }
  }
 }
 const clipped=boxes.filter(b=>b.clientW>0&&b.scrollW>b.clientW+5&&
  ['hidden','clip'].includes(b.overflowX)&&!allowed.some(x=>b.selector.includes(x)));
 return {viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth},
  boxes,duplicateIds,overlaps,clipped};
}"""

async def audit(page,label,selectors,groups=(),require_visible=()):
 report=await page.evaluate(METRICS,{'selectors':selectors,'groups':list(groups),'allowed':['.se-qrow','.se-category-navrow']})
 EVIDENCE.mkdir(exist_ok=True)
 name=re.sub(r'[^a-z0-9_-]+','-',label.lower()).strip('-')
 (EVIDENCE/(name+'.json')).write_text(json.dumps(report,indent=2,ensure_ascii=False))
 await page.screenshot(path=str(EVIDENCE/(name+'.png')),full_page=True,animations='disabled')
 for sel in require_visible:
  assert any(b['selector']==sel and b['w']>15 and b['h']>15 for b in report['boxes']),f'{label}: missing {sel}'
 if report['viewport']['scrollWidth']>report['viewport']['width']+8:
  offenders=await page.evaluate("""() => [...document.querySelectorAll('body *')].map(el=>({name:el.tagName.toLowerCase(),className:String(el.className||'').slice(0,100),text:(el.innerText||'').slice(0,45),r:el.getBoundingClientRect()})).filter(x=>x.r.width>3&&x.r.height>3&&x.r.right>innerWidth+4).sort((a,b)=>b.r.right-a.r.right).slice(0,15).map(x=>({...x,right:Math.round(x.r.right),left:Math.round(x.r.left),width:Math.round(x.r.width),r:undefined}))""")
  print('OVERFLOW DETAIL',label,offenders,flush=True)
 assert report['viewport']['scrollWidth']<=report['viewport']['width']+8,f'{label}: horizontal viewport overflow {report["viewport"]}'
 assert not report['duplicateIds'],f'{label}: duplicate HTML ids {report["duplicateIds"][:8]}'
 assert not report['overlaps'],f'{label}: overlapping sibling controls {report["overlaps"][:8]}'
 assert not report['clipped'],f'{label}: clipped labels {report["clipped"][:8]}'
 return report

async def clickability(page,label,selectors):
 # Scroll each control into view first; otherwise offscreen scrollable elements are expected.
 for selector in selectors:
  loc=page.locator(selector).first
  if not await loc.count() or not await loc.is_visible(): continue
  await loc.scroll_into_view_if_needed(timeout=6000)
  report=await loc.evaluate("""e=>{
    const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    const hit=document.elementFromPoint(x,y);
    return {center:[x,y],screen:[innerWidth,innerHeight],hit:hit===e||e.contains(hit),
      className:String(hit?.className||''),text:(e.innerText||'').slice(0,60)};
  }""")
  assert report['hit'],f'{label}: covered/unreachable control {selector}: {report}'

async def main():
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'docs')))
 threading.Thread(target=server.serve_forever,daemon=True).start()
 origin=f'http://127.0.0.1:{server.server_port}/'
 errors=[]
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(args=['--no-sandbox'])
   ctx=await browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
   page=await ctx.new_page()
   page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(origin)
   await page.locator('.bq-legacy-options>summary').wait_for()
   for width,height in SIZES:
    await page.set_viewport_size({'width':width,'height':height})
    report=await audit(page,f'landing-{width}x{height}',[
      '.topbar','.landing-actions button','.bq-landing-boards summary',
      '.shell .page button'
    ],['.landing-actions button'])
    print(f'PASS landing {width}×{height}',flush=True)
   await page.set_viewport_size({'width':1440,'height':900})
   await page.locator('.bq-legacy-options>summary').click()
    await page.get_by_role('button',name='Quizbrett bearbeiten').click()
   await page.locator('.se-board-context').wait_for()
   # Browser should never expose unopened disclosure controls as interactable elements.
   assert not await page.locator('.se-file-actions:not([open]) .se-file-menu button').first.is_visible()
   assert not await page.locator('.se-board-switch:not([open]) .se-board-switch-items button').first.is_visible()
   print('PASS closed disclosure controls are not visible or actionable',flush=True)
   for width,height in SIZES:
    await page.set_viewport_size({'width':width,'height':height})
    await audit(page,f'editor-home-{width}x{height}',[
      '.se-board-context>strong','.se-board-switch>summary','.se-toolbar',
      '.se-toolbar button','.se-mobile-editor-tabs button'
    ],['.se-toolbar button','.se-mobile-editor-tabs button'],
       ['.se-board-context>strong'])
    if width in [320,390,1440]:
     await clickability(page,f'editor-home-{width}',[
      '.se-board-switch>summary','.se-toolbar button:visible'
     ])
    print(f'PASS editor overview {width}×{height}',flush=True)
   await page.set_viewport_size({'width':1440,'height':900})
   await page.locator('.se-list [data-se-action="category-form"]').click()
   await page.locator('[data-se-category-name]').fill('Weltkarte')
   await page.locator('[data-se-category-form] button[type="submit"]').click()
   await page.locator('[data-se-action="new"][data-template="map"]').click()
   await page.locator('.bq-map-viewport').wait_for()
   await page.locator('[data-se-field="mapPrompt"]').fill('In welchem Land befindet sich diese fiktive Stadt?')
   await page.locator('[data-se-field="mapPrompt"]').blur()
   await page.wait_for_timeout(350)
   for width,height in SIZES:
    await page.set_viewport_size({'width':width,'height':height})
    # The mobile editor switches to its canvas tab, which is intentionally separate.
    if width<=680:
     tab=page.locator('[data-se-action="mobile-tab"][data-mobile-tab="canvas"]')
     if await tab.count() and await tab.is_visible():await tab.click()
    await page.locator('.bq-map-viewport').wait_for(state='visible',timeout=7000)
    report=await audit(page,f'editor-map-{width}x{height}',[
      '.bq-map-viewport','.bq-map-title h2','.bq-map-controls button',
      '.bq-map-controls output','.bq-map-required','.se-board-context>strong'
    ],['.bq-map-controls button','.bq-map-title h2, .bq-map-required'],
       ['.bq-map-viewport','.bq-map-title h2'])
    mapRect=next(b for b in report['boxes'] if b['selector']=='.bq-map-viewport')
    assert mapRect['w']>=min(width-26,220),f'map too narrow at {width}: {mapRect}'
    assert mapRect['h']>=min(280,mapRect['w']/2-4),f'map unexpectedly short at {height}: {mapRect}'
    assert abs(mapRect['w']/mapRect['h']-2)<.04,f'world-map projection distorted at {width}×{height}: {mapRect}'
    if width in [320,390,1440]:
     await clickability(page,f'map-editor-{width}',[
      '.bq-map-controls [data-map-zoom="in"]','.bq-map-controls [data-map-zoom="out"]'
     ])
    print(f'PASS map editor {width}×{height}',flush=True)
   assert not errors,errors
   await browser.close()
 finally:
  server.shutdown();server.server_close()

if __name__=='__main__':asyncio.run(main())
