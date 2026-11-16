"""Two-client PeerJS-mocked E2E for world-map question privacy and answer lifecycle.
Exercises actual host/guest UI and app state, not real network ICE/TURN.
"""
import asyncio,importlib.util
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
(ROOT/'qa-artifacts').mkdir(exist_ok=True)
spec=importlib.util.spec_from_file_location('bq_categories',ROOT/'tests/categories-3_0-browser.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
install=module.install
layoutSpec=importlib.util.spec_from_file_location('bq_ui_layout',ROOT/'tests/ui-step3-layout-browser.py')
layoutModule=importlib.util.module_from_spec(layoutSpec);layoutSpec.loader.exec_module(layoutModule)
audit=layoutModule.audit

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  errors=[]
  host=await ctx.new_page();host.on('pageerror',lambda err:errors.append('Host: '+str(err)))
  await install(host)
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await host.locator('.se-studio').wait_for()
  code=await host.evaluate('window.__probe.room()')
  assert len(code)==16

  q={'id':'map-e2e','category':'Geographie','title':'Weltkarte','type':'map','roundMode':'written','points':100,
     'prompt':'Wo befindet sich unser gesuchter Ort?','answer':'','mapTargetSet':True,'mapTargetX':67.321,'mapTargetY':34.112,
     'scene':{'template':'map','version':2,'elements':[{'id':'heading','kind':'text','role':'question','text':'Wo befindet sich unser gesuchter Ort?','x':58,'y':34,'w':884,'h':106,'step':0}]}}
  await host.evaluate('(q)=>window.__probe.setQuiz({title:"Kartenquiz",teams:["Rot","Blau"],questions:[q]})',q)
  await host.locator('[data-action="publish"]').first.click()
  await host.locator('.bq-board-scene .tile').first.wait_for()

  async with ctx.expect_page() as opening:
   await host.evaluate("window.open('about:blank','_blank')")
  guest=await opening.value;guest.on('pageerror',lambda err:errors.append('Gast: '+str(err)))
  await install(guest)
  await guest.locator('#join-room').fill(code);await guest.locator('#join-name').fill('Alice')
  await guest.locator('button[type="submit"]').first.click()
  await guest.locator('.bq-lobby-notice').wait_for(timeout=12000)
  await host.locator('.top-nav [data-view="teams"]').click()
  await host.locator('[data-action="approve"]').first.click()
  await guest.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=12000)
  await guest.locator('.bq-lobby').wait_for(timeout=12000)
  # A second approved guest deliberately does not submit. Their answer card
  # must be 'no answer', never a misleading frosted/hidden answer.
  async with ctx.expect_page() as second_open:
   await host.evaluate("window.open('about:blank','_blank')")
  second=await second_open.value
  second.on('pageerror',lambda err:errors.append('Guest2: '+str(err)))
  await install(second)
  await second.locator('#join-room').fill(code);await second.locator('#join-name').fill('Bob')
  await second.locator('button[type="submit"]').first.click()
  await second.locator('.bq-lobby-notice').wait_for(timeout=12000)
  await host.locator('[data-action="approve"]').first.click()
  await second.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=12000)
  await second.locator('.bq-lobby').wait_for(timeout=12000)
  await host.locator('.top-nav [data-view="live"]').click()
  await host.locator('.bq-board-scene .tile').first.click()
  await host.wait_for_function("() => window.__probe.info().publicState?.phase==='question'",timeout=8000)
  await guest.wait_for_timeout(450)
  await guest.locator('.bq-map-viewport').wait_for(timeout=12000)
  await guest.wait_for_function("() => {const image=document.querySelector('.bq-map-layer img');return image?.complete && image.naturalWidth>0}",timeout=12000)
  qpublic=await guest.evaluate("window.__probe.info().publicState.current")
  assert 'mapTargetX' not in qpublic and 'mapTargetY' not in qpublic and 'mapTargetSet' not in qpublic,qpublic
  await expect(guest.locator('.bq-map-pin.is-solution')).to_have_count(0)
  await expect(guest.locator('.bq-map-pin.is-host')).to_have_count(0)
  assert '67.321' not in await guest.locator('.bq-question-scene').inner_text()
  print('PASS: host secret answer coordinates absent from guest state, markup, and visible text')
  # Visual geometry: no hidden solution, clipped controls, duplicate IDs, or horizontal overflow.
  hostSelectors=['.bq-map-viewport','.bq-map-title h2','.bq-map-controls button',
                 '.bq-action-bar button','.bq-scene-heading h2']
  guestSelectors=['.bq-map-viewport','.bq-map-title h2','.bq-map-controls button',
                  '.bq-guest-compose .formgrid>.btn','.bq-map-instruction']
  for width,height in [(320,720),(390,844),(768,1024),(1366,850)]:
   await guest.set_viewport_size({'width':width,'height':height})
   await guest.locator('.bq-map-viewport').wait_for(state='visible')
   await audit(guest,f'participant-map-{width}x{height}',guestSelectors,
               ['.bq-map-controls button','.bq-guest-compose .formgrid>.btn'],
               ['.bq-map-viewport','.bq-map-title h2'])
   await expect(guest.locator('[data-action="reveal"],[data-action="publish"],[data-action="start-review"]')).to_have_count(0)
   await expect(guest.locator('.bq-map-pin.is-solution')).to_have_count(0)
   print('PASS participant map layout/permissions',width,height,flush=True)
  for width,height in [(390,844),(1366,850)]:
   await host.set_viewport_size({'width':width,'height':height})
   await host.locator('.bq-map-viewport').wait_for(state='visible')
   await audit(host,f'host-map-{width}x{height}',hostSelectors,
               ['.bq-map-controls button','.bq-action-bar>.btn'],
               ['.bq-map-viewport','.bq-map-title h2'])
   print('PASS host map layout',width,height,flush=True)
  await guest.set_viewport_size({'width':1366,'height':850})
  await host.set_viewport_size({'width':1366,'height':850})
  rect=await guest.locator('.bq-map-viewport').bounding_box()
  assert rect and rect['width']>=900 and rect['height']>=300,rect
  before=await guest.evaluate("""() => ({role:window.__probe.info().role,member:window.__probe.info().member,
    phase:window.__probe.info().publicState?.phase,round:window.__probe.info().publicState?.round,
    participants:window.__probe.info().publicState?.answerParticipants,
    uid:window.__probe.getGame()?.uid,
    mapBound:document.querySelector('.bq-map-viewport')?.dataset.mapBound,
    mapCanChoose:document.querySelector('.bq-map-viewport')?.dataset.mapChoice,
    elementsFromPoint:document.elementsFromPoint(document.querySelector('.bq-map-viewport').getBoundingClientRect().left+rect.width*.71,
       document.querySelector('.bq-map-viewport').getBoundingClientRect().top+rect.height*.42).slice(0,5).map(el=>el.className)
  })""".replace("rect.width",str(rect['width'])).replace("rect.height",str(rect['height'])))
  print('MAP DIAG before click',before,flush=True)
  await guest.mouse.click(rect['x']+rect['width']*.71,rect['y']+rect['height']*.42)
  await guest.wait_for_timeout(300)
  after=await guest.evaluate("""() => ({pinned:!!document.querySelector('.bq-map-pin.is-self'),message:document.querySelector('.bq-map-result')?.innerText,
    bound:document.querySelector('.bq-map-viewport')?.dataset.mapBound,clickable:document.querySelector('.bq-map-viewport')?.dataset.mapChoice})""")
  print('MAP DIAG after click',after,flush=True)
  await guest.locator('.bq-map-pin.is-self').wait_for(timeout=5000)
  await expect(guest.locator('[data-action="submit-answer"]')).to_be_enabled()
  await guest.locator('[data-action="submit-answer"]').click()
  await guest.locator('[data-action="submit-answer"]').get_by_text('Pin aktualisieren').wait_for(timeout=12000)
  assert (await guest.evaluate('window.__probe.info().publicState.phase'))=='question'
  await expect(guest.locator('.bq-map-pin.is-solution')).to_have_count(0)
  # Repositioning is allowed even after first submission while the round stays open.
  rect=await guest.locator('.bq-map-viewport').bounding_box()
  await guest.mouse.click(rect['x']+rect['width']*.39,rect['y']+rect['height']*.55)
  await guest.locator('[data-action="submit-answer"]').click()
  await host.wait_for_function("() => Object.values(window.__probe.getGame().data.responses||{}).some(bucket=>Object.values(bucket).some(rec=>String(rec.text||'').includes('39')))",timeout=10000)
  answer=await host.evaluate("""() => Object.values(window.__probe.getGame().data.responses||{})""")
  assert any('39' in str(rec) for bucket in answer for rec in bucket.values()),answer
  print('PASS: guest can move and re-send their private pin until map round closes')
  await host.locator('[data-action="start-review"]').first.click()
  await guest.locator('.review-card.is-hidden').first.wait_for(timeout=12000)
  await guest.locator('.review-card.is-missing').first.wait_for(timeout=12000)
  await expect(guest.locator('.review-card.is-hidden')).to_have_count(1)
  await expect(guest.locator('.review-card.is-missing')).to_have_count(1)
  assert 'Keine Antwort abgegeben' in await guest.locator('.review-card.is-missing').inner_text()
  await expect(guest.locator('.review-card.is-missing .frosted-shield')).to_have_count(0)
  await expect(second.locator('.review-card.is-hidden')).to_have_count(1,timeout=12000)
  assert '@map:39' not in await second.locator('.bq-question-scene').inner_text()
  print('PASS: review separates absent responses from private submitted answers for two guests',flush=True)
  # Only this guest uses normal motion: all earlier privacy/layout checks keep the
  # existing reduced-motion baseline, but the live reveal must show the throw.
  await guest.emulate_media(reduced_motion='no-preference')
  await second.set_viewport_size({'width':390,'height':844})
  await second.emulate_media(reduced_motion='no-preference')
  await host.locator('[data-action="reveal"]').first.click()
  await expect(guest.locator('.bq-map-throw-layer')).to_have_count(1,timeout=12000)
  await expect(guest.locator('.bq-map-throw-actor')).to_have_count(1)
  await expect(guest.locator('.bq-map-throw-arm')).to_have_count(1)
  assert not await guest.locator('.bq-map-pin.is-solution').is_visible(),'Solution marker leaked before dagger impact'
  geometry=await guest.locator('.bq-map-throw-layer').evaluate('''layer=>{
   const marker=document.querySelector('.bq-map-pin.is-solution');
   const viewport=marker.closest('.bq-map-viewport');
   const box=viewport.getBoundingClientRect();
   return {x:Number(layer.dataset.targetX),y:Number(layer.dataset.targetY),
    expectedX:box.left+box.width*parseFloat(marker.style.left)/100,
    expectedY:box.top+box.height*parseFloat(marker.style.top)/100,
    actor:layer.querySelector('.bq-map-throw-actor')?.className,
    pointer:getComputedStyle(layer).pointerEvents};
  }''')
  assert abs(geometry['x']-geometry['expectedX'])<1 and abs(geometry['y']-geometry['expectedY'])<1,geometry
  assert geometry['pointer']=='none',geometry
  # Real layout assertions: the casting figure must stay in its OWN rail,
  # not cover the map surface, the question title, or the zoom controls.
  actor_layout=await guest.evaluate("""() => {
   const actor=document.querySelector('.bq-map-throw-actor'),map=document.querySelector('.bq-map-viewport');
   const title=document.querySelector('.bq-map-title'),controls=document.querySelector('.bq-map-controls');
   const rect=el=>{const r=el.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}};
   return {actor:rect(actor),map:rect(map),title:rect(title),controls:rect(controls)};
  }""")
  a=actor_layout['actor'];m=actor_layout['map'];t=actor_layout['title'];z=actor_layout['controls']
  intersects=lambda p,q:p['l']<q['r']-1 and p['r']>q['l']+1 and p['t']<q['b']-1 and p['b']>q['t']+1
  assert a['r']<=m['l']+2 and not intersects(a,t) and not intersects(a,z),actor_layout
  # Same exact class pose on a narrow real guest viewport.
  await expect(second.locator('.bq-map-throw-actor')).to_have_count(1,timeout=12000)
  small=await second.evaluate("""() => {
   const a=document.querySelector('.bq-map-throw-actor')?.getBoundingClientRect();
   const m=document.querySelector('.bq-map-viewport')?.getBoundingClientRect();
   const reset=document.querySelector('.bq-map-reset');
   return a&&m&&reset?{right:a.right,mapLeft:m.left,actorWidth:a.width,viewportWidth:innerWidth,
    resetNoWrap:getComputedStyle(reset).whiteSpace==='nowrap',resetFits:reset.scrollWidth<=reset.clientWidth+2}:null;
  }""")
  assert small and small['right']<=small['mapLeft']+2 and small['actorWidth']<=105 and small['right']<=small['viewportWidth']+2,small
  assert small['resetNoWrap'] and small['resetFits'],'World overview label clipped/wrapped during mobile throw: '+str(small)
  await second.screenshot(path=str(ROOT/'qa-artifacts/step6-dagger-mobile-windup.png'),animations='allow')
  await guest.screenshot(path=str(ROOT/'qa-artifacts/step6-dagger-windup.png'),animations='allow')
  await guest.wait_for_timeout(2400)
  assert await guest.locator('.bq-map-throw-flight').count()==1,'Flying dagger missing'
  await guest.screenshot(path=str(ROOT/'qa-artifacts/step6-dagger-flight.png'),animations='allow')
  await guest.locator('.bq-map-pin.is-solution img').wait_for(state='visible',timeout=14000)
  await expect(guest.locator('.bq-map-throw-layer')).to_have_count(0,timeout=10000)
  print('PASS Step 6: visible character arm throw, flying dagger, accurate marker landing, no input obstruction',flush=True)
  assert await guest.locator('.bq-map-pin.is-solution img').evaluate('(img)=>img.complete&&img.naturalWidth>0'),'Pixel dagger missing in two-client view'
  released=await guest.evaluate('window.__probe.info().publicState.current')
  assert abs(released['mapTargetX']-67.321)<.001
  assert abs(released['mapTargetY']-34.112)<.001
  print('PASS: solution dagger and exact host target appear only after host reveal')
  for width,height in [(390,844),(1366,850)]:
   await guest.set_viewport_size({'width':width,'height':height})
   await guest.locator('.bq-map-pin.is-solution img').wait_for(state='visible')
   await audit(guest,f'participant-reveal-{width}x{height}',
               ['.bq-map-viewport','.bq-map-title h2','.bq-map-controls button','.bq-answer-review-body'],
               ['.bq-map-controls button'],['.bq-map-viewport'])
   await expect(guest.locator('[data-action="publish"],[data-action="reveal"]')).to_have_count(0)
  print('PASS guest reveal geometry and host-control absence',flush=True)
  assert not errors,errors
  await browser.close()

if __name__=='__main__':asyncio.run(main())
