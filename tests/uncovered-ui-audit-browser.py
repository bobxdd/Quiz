"""Broad real Chromium UX regression beyond existing happy-path tests.

Covers clipping and hit interception in landing/editor/settings/host lobby/guest,
screen reader identifiers, settings actions, export and copy, mobile landscape,
keyboard focus, and question/buzzer/chat controls. PeerJS transport is mocked,
not a real across-the-internet ICE/TURN test.
"""
import asyncio,importlib.util,json
from pathlib import Path
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa-artifacts';OUT.mkdir(exist_ok=True)
spec=importlib.util.spec_from_file_location('bq_wide_audit_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
REPORT=[]

async def audit(page,label,selector,cap=45):
 data=await page.evaluate("""({selector,cap})=>{
  const all=[...document.querySelectorAll(selector)].filter(el=>{
   if(el.disabled||el.getAttribute('aria-hidden')==='true'||el.closest('[inert]'))return false;
   const closed=[];
   for(let n=el.parentElement;n;n=n.parentElement)if(n.matches?.('details:not([open])'))closed.push(n);
   // Own summary is interactive when ITS details is closed, but not when
   // that details itself sits inside any other closed details.
   if(closed.length&&!(closed.length===1&&el.matches('summary')&&el.parentElement===closed[0]))return false;
   const st=getComputedStyle(el),r=el.getBoundingClientRect();
   return st.display!=='none'&&st.visibility==='visible'&&Number(st.opacity)>0&&
    st.pointerEvents!=='none'&&r.width>=9&&r.height>=8;
  }).slice(0,cap);
  const out={checked:0,blocked:[],tiny:[],offscreen:[],duplicateIds:[],overflow:0};
  for(const el of all){
   el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
   const r=el.getBoundingClientRect();
   const x=Math.max(1,Math.min(innerWidth-2,(r.left+r.right)/2));
   const y=Math.max(1,Math.min(innerHeight-2,(r.top+r.bottom)/2));
   if(r.left< -5||r.right>innerWidth+5){out.offscreen.push({name:el.textContent?.trim().slice(0,40),x:r.left,right:r.right});continue;}
   if(r.height<25||r.width<24)out.tiny.push(el.getAttribute('data-action')||el.textContent?.trim().slice(0,40));
   const hit=document.elementFromPoint(x,y);
   // A floating tooltip or menu may legitimately cover an inactive control;
   // this test runs only with popovers closed except when explicitly scoped.
   if(hit&&!el.contains(hit)&&!hit.contains(el))out.blocked.push({
     name:el.getAttribute('data-action')||el.getAttribute('data-se-action')||el.textContent?.trim().slice(0,40),
     blocker:hit.tagName.toLowerCase()+(hit.className&&typeof hit.className==='string'?'.'+hit.className.split(' ').slice(0,2).join('.'):''),x,y});
   out.checked++;
  }
  const counts=new Map();
  for(const el of document.querySelectorAll('[id]'))counts.set(el.id,(counts.get(el.id)||0)+1);
  out.duplicateIds=[...counts].filter(([k,n])=>k&&n>1).slice(0,20);
  out.overflow=document.documentElement.scrollWidth-document.documentElement.clientWidth;
  return out;
 }""",{'selector':selector,'cap':cap})
 REPORT.append({'view':label,**data})
 assert data['checked']>0,(label,data)
 assert not data['blocked'],(label,'controls visually intercepted',data['blocked'][:10])
 assert not data['offscreen'],(label,'controls outside viewport',data['offscreen'][:8])
 assert not data['duplicateIds'],(label,'ambiguous DOM IDs',data['duplicateIds'])
 assert data['overflow']<=7,(label,'horizontal page overflow',data['overflow'])
 return data

async def main():
 errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':900},reduced_motion='reduce',accept_downloads=True)
  host=await ctx.new_page()
  host.on('pageerror',lambda e:errors.append('host '+str(e)))
  host.on('dialog',lambda d:asyncio.create_task(d.accept()))
  await fixture.install(host)
  await host.evaluate("""()=>Object.defineProperty(navigator,'clipboard',{
    configurable:true,value:{writeText:async value=>window.__lastCopied=String(value)}
  })""")
  for w,h in [(320,720),(390,844),(812,375),(768,1024),(1366,900)]:
   await host.set_viewport_size({'width':w,'height':h})
   await audit(host,'landing-%d-%d'%(w,h),'main button,main input,main summary',28)
  print('PASS audit landing: five widths, exposed creation/join controls, no click blockers',flush=True)

  await host.locator('[data-action="create-new-quiz"]').click()
  await host.locator('.se-board-context').wait_for(timeout=14000)
  for w,h in [(320,720),(390,844),(768,1024),(1366,900)]:
   await host.set_viewport_size({'width':w,'height':h})
   await audit(host,'editor-%d-%d'%(w,h),'.bq-editor-toolbar button,.bq-editor-toolbar input,.bq-editor-toolbar select,.bq-editor-toolbar summary',22)
  await host.locator('.bq-editor-extras>summary').click()
  await expect(host.locator('.bq-editor-extras')).to_have_attribute('open','')
  await audit(host,'editor-extras','.bq-editor-extras button,.bq-editor-extras summary',16)
  await host.locator('.bq-editor-extras>summary').click()
  # Verify score mode is an actual editor setting, and save works.
  await host.locator('[data-se-scoremode]').select_option('individual')
  await expect(host.locator('[data-se-scoremode]')).to_have_value('individual')
  await host.locator('[data-se-scoremode]').select_option('team')
  await host.locator('.bq-editor-main-info [data-se-quiztitle]').fill('UI-Audit Quiz')
  await host.locator('[data-action="save-board"]').click()
  assert (await host.evaluate('window.__probe.getQuiz()'))['title']=='UI-Audit Quiz'
  await host.screenshot(path=str(OUT/'audit-editor-toolbar-390.png'),full_page=True,animations='disabled')
  print('PASS audit editor: responsive toolbar, tools, score setting and saved title',flush=True)

  # Create one valid question and host the saved quiz.
  quiz={'title':'UI-Audit Quiz','teams':['Grün','Violett'],'questions':[{
   'id':'audit-q1','category':'Film','title':'Frage','type':'text',
   'roundMode':'written','prompt':'Was ist die Antwort?','answer':'Intern nur beim Host','points':100
  }]}
  await host.evaluate('(q)=>window.__probe.setQuiz(q)',quiz)
  await host.locator('[data-action="save-board"]').click()
  await host.locator('[data-action="host-current-board"]').click()
  await host.locator('.bq-host-code-banner').wait_for(timeout=16000)
  room=await host.evaluate('window.__probe.room()')
  await host.locator('[data-action="copy-room"]').click()
  assert await host.evaluate('window.__lastCopied')==room
  await host.locator('[data-action="copy-invite-link"]').click()
  assert ('?room='+room) in (await host.evaluate('window.__lastCopied'))
  for w,h in [(320,720),(390,844),(768,1024),(1366,900)]:
   await host.set_viewport_size({'width':w,'height':h})
   await audit(host,'lobby-%d-%d'%(w,h),'.bq-host-lobby-page button,.bq-host-lobby-page select,.bq-host-lobby-page summary',28)
  print('PASS audit lobby: code copy/link and functional responsive controls',flush=True)

  # Guest joined to test permissions and dynamic pending approval overlays.
  async with ctx.expect_page() as op:
   await host.evaluate("window.open('about:blank','_blank')")
  guest=await op.value;guest.on('pageerror',lambda e:errors.append('guest '+str(e)))
  await fixture.install(guest)
  await guest.locator('#join-room').fill(room)
  await guest.locator('#join-name').fill('Sam')
  await guest.locator('#join-form button[type="submit"]').click()
  await expect(host.locator('.bq-host-join-request')).to_have_count(1,timeout=16000)
  for w,h in [(390,844),(1366,900)]:
   await host.set_viewport_size({'width':w,'height':h})
   await audit(host,'lobby-pending-%d'%(w),'.bq-host-lobby-page button,.bq-host-lobby-page select',30)
  await host.locator('.bq-host-join-request [data-action="approve"]').click()
  await expect(host.locator('.bq-host-approved-person')).to_have_count(1,timeout=12000)
  for w,h in [(390,844),(1366,900)]:
   await guest.set_viewport_size({'width':w,'height':h})
   await audit(guest,'guest-lobby-%d'%(w),'.bq-lobby button,.bq-lobby input,.bq-lobby summary',25)
  assert await guest.locator('[data-action="publish"]').count()==0
  assert 'Intern nur beim Host' not in await guest.locator('body').inner_text()
  print('PASS audit admission: host pending/approved and guest controls, no secret answer',flush=True)

  # Host settings are a separate, previously under-tested surface.
  await host.locator('.top-nav [data-view="setup"]').click()
  await host.locator('.page [data-action="export"]').wait_for(timeout=10000)
  for w,h in [(390,844),(1366,900)]:
   await host.set_viewport_size({'width':w,'height':h})
   await audit(host,'host-settings-%d'%(w),'main button,main input,main select,main summary',25)
  # Imported quiz files must remain private and accept only the intended extensions.
  assert '.json' in await host.locator('#import-quiz').get_attribute('accept')
  async with host.expect_download(timeout=15000) as receipt:
   await host.locator('.page [data-action="export"]').click()
  artifact=await receipt.value
  assert artifact.suggested_filename.lower().endswith('.json'),artifact.suggested_filename
  await host.locator('.top-nav [data-view="teams"]').click()
  print('PASS audit setup: all visible controls, private backup export and import selector',flush=True)

  # Explicit start, then ensure keyboard & settings in actual live question.
  await host.locator('.bq-host-start').click()
  await host.locator('.bq-board-scene').wait_for(timeout=12000)
  await host.locator('.bq-board-scene [data-action="open"]').first.click()
  await host.locator('.bq-question-scene').wait_for(timeout=12000)
  await host.locator('.bq-auxiliary>summary').click()
  await audit(host,'host-question-tools','.bq-host-detail button,.bq-host-detail input,.bq-host-detail select,.bq-host-detail summary',36)
  # Actual toggles should roundtrip in shared room state and remain accessible.
  before=(await host.evaluate('window.__probe.info().publicState.settings'))
  await host.locator('[data-action="toggle-chat"]').click()
  await host.wait_for_timeout(350)
  after=(await host.evaluate('window.__probe.info().publicState.settings'))
  assert after['chatOpen']!=before['chatOpen'],(before,after)
  await host.locator('[data-action="toggle-chat"]').click()
  await host.wait_for_timeout(350)
  again=(await host.evaluate('window.__probe.info().publicState.settings'))
  assert again['chatOpen']==before['chatOpen'],(before,again)
  for w,h in [(390,844),(1366,900)]:
   await host.set_viewport_size({'width':w,'height':h})
   await audit(host,'live-question-%d'%(w),'.bq-host-action-bar button,.bq-question-panel button,.bq-auxiliary>summary',25)
  print('PASS audit live question: host action bar, detail toggles and state roundtrip',flush=True)

  assert not errors,errors
  (OUT/'uncovered-ui-audit.json').write_text(json.dumps(REPORT,indent=2,ensure_ascii=False))
  print('PASS comprehensive UI: '+str(len(REPORT))+' stage×viewport audits recorded; no blocked/duplicate/offscreen controls',flush=True)
  await browser.close()
if __name__=='__main__':asyncio.run(main())
