"""End-to-end host-first UX: saved quiz -> room code -> admit -> start -> board.
Chromium with existing deterministic PeerJS transport, not real ICE/TURN.
"""
import asyncio,importlib.util,shutil
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa-artifacts';OUT.mkdir(exist_ok=True)
spec=importlib.util.spec_from_file_location('bq_host_ux_fixture',ROOT/'tests/categories-3_0-browser.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
install=loader.install

async def audit_layout(page,label):
 dimensions=await page.evaluate("""() => {
  const rect=sel=>{const el=document.querySelector(sel);if(!el)return null;
   const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  return {viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
   code:rect('.bq-host-code-value strong'),actions:rect('.bq-host-code-actions'),
   requests:rect('.bq-host-requests'),participants:rect('.bq-host-participants'),
   start:rect('.bq-host-lobby-next'),btn:rect('.bq-host-start')};
 }""")
 assert dimensions['scroll']<=dimensions['viewport']+5,(label,dimensions)
 assert all(dimensions[k] and dimensions[k]['width']>0 for k in ['code','actions','requests','participants','start','btn']),(label,dimensions)
 assert dimensions['code']['top']<dimensions['requests']['top'] and dimensions['requests']['top']<dimensions['start']['top'],(label,dimensions)
 assert dimensions['btn']['width']>=125 and dimensions['btn']['height']>=44,(label,dimensions)
 return dimensions

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':900},reduced_motion='reduce')
  host=await ctx.new_page();errors=[]
  host.on('pageerror',lambda e:errors.append('host: '+str(e)))
  host.on('dialog',lambda dlg:asyncio.create_task(dlg.accept()))
  await install(host)
  await expect(host.get_by_role('heading',name='Quiz erstellen oder beitreten')).to_have_count(1)
  await expect(host.locator('[data-action="create-new-quiz"]')).to_have_count(1)
  await host.locator('[data-action="create-new-quiz"]').click()
  await host.locator('.se-board-context').wait_for(timeout=15000)
  await expect(host.locator('.bq-editor-host-cta')).to_have_count(1)
  # The quiz is edited once; hosting the same quiz automatically saves changes.
  draft={'title':'Mein Filmquiz','teams':['Rot','Blau'],'questions':[{
    'id':'flow-first','category':'Allgemein','title':'Film','type':'text',
    'roundMode':'written','prompt':'Welcher Film?','answer':'Die Antwort','points':100
  }]}
  await host.evaluate('(q)=>window.__probe.setQuiz(q)',draft)
  await host.locator('.bq-editor-host-cta').click()
  await host.locator('.bq-host-code-banner').wait_for(timeout=16000)
  code=await host.evaluate('window.__probe.room()')
  assert len(code)==16
  assert code==await host.locator('#bq-lobby-code').inner_text()
  assert 'Mein Filmquiz' in await host.locator('.bq-host-code-banner').inner_text()
  assert await host.get_by_role('button',name='Code kopieren').count()==1
  assert await host.get_by_role('button',name='Einladungslink kopieren').count()==1
  assert await host.locator('.bq-host-join-request').count()==0
  await expect(host.locator('.bq-request-count')).to_contain_text('Keine offen')
  assert await host.locator('[data-action="start-game"]').is_disabled()
  for width,height in [(390,844),(1366,900)]:
   await host.set_viewport_size({'width':width,'height':height})
   await audit_layout(host,f'host pregame {width}')
   await host.screenshot(path=str(OUT/f'host-flow-empty-lobby-{width}.png'),full_page=True,animations='disabled')
  print('PASS host sees code, share actions, zero pending status and clear start call to action',flush=True)

  async with ctx.expect_page() as opening:
   await host.evaluate("window.open('about:blank','_blank')")
  guest=await opening.value;guest.on('pageerror',lambda e:errors.append('guest: '+str(e)))
  await install(guest)
  await guest.locator('#join-room').fill(code)
  await guest.locator('#join-name').fill('Lea')
  await guest.locator('#join-form button[type="submit"]').click()
  await guest.locator('.bq-lobby-notice').wait_for(timeout=15000)
  await expect(host.locator('.bq-host-join-request')).to_have_count(1,timeout=15000)
  await expect(host.locator('.bq-request-count')).to_contain_text('1 offen')
  await expect(host.locator('.bq-host-join-request [data-action="approve"]')).to_have_count(1)
  assert 'Lea' in await host.locator('.bq-host-join-request').inner_text()
  await host.screenshot(path=str(OUT/'host-flow-pending-approval.png'),full_page=True,animations='disabled')
  await guest.locator('[data-action="lobby-join"][data-team="t1"]').click()
  await guest.locator('[data-action="lobby-ready"]').click()
  await expect(host.locator('.bq-host-join-request')).to_contain_text('Bereit',timeout=12000)
  await host.locator('.bq-host-join-request [data-action="approve"]').click()
  await expect(host.locator('.bq-host-join-request')).to_have_count(0,timeout=12000)
  await expect(host.locator('.bq-host-approved-person')).to_have_count(1,timeout=12000)
  await expect(host.locator('.bq-request-count')).to_contain_text('Keine offen')
  assert not await host.locator('[data-action="start-game"]').is_disabled()
  await host.set_viewport_size({'width':390,'height':844})
  await audit_layout(host,'host approved phone')
  await host.screenshot(path=str(OUT/'host-flow-ready-390.png'),full_page=True,animations='disabled')
  print('PASS guest requests admission, host sees clear pending count, approves and sees ready player',flush=True)

  await host.locator('[data-action="start-game"]').click()
  await expect(host.locator('.bq-board-scene')).to_have_count(1,timeout=12000)
  await expect(guest.locator('.bq-board-scene')).to_have_count(1,timeout=12000)
  info=await host.evaluate('window.__probe.info()')
  assert info['publicState']['started'] is True
  assert info['publicState']['published'] is True
  await host.locator('.top-nav [data-view="teams"]').click()
  assert await host.locator('[data-action="start-game"]').count()==0
  assert 'Spiel gestartet' in await host.locator('.bq-host-lobby-next').inner_text()
  assert not await host.locator('.bq-host-team-create').count()
  assert not errors,errors
  print('PASS explicit Spiel starten transitions host and guest to board and locks team admission',flush=True)
  await browser.close()

if __name__=='__main__':asyncio.run(main())
