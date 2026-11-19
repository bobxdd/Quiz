"""End-to-end host/guest scoring corrections, private ledger, and finale."""
import asyncio,importlib.util
from pathlib import Path
from playwright.async_api import async_playwright,expect
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('finale_fixture',root/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  host=await ctx.new_page();exceptions=[]
  host.on('pageerror',lambda e:exceptions.append('host '+str(e)))
  host.on('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
  await fixture.install(host)
  await host.locator('.bq-legacy-options>summary').click()
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await expect(host.locator('.se-category-overview')).to_be_visible()
  room=await host.evaluate("window.__probe.room()")
  await host.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
  await host.locator('[data-se-action="new"][data-template="text"]').click()
  await host.locator('[data-se-field="title"]').fill('Finale · 100')
  await host.locator('[data-se-field="title"]').blur()
  await host.locator('[data-se-action="editor-pane"][data-pane="answer"]').click()
  await host.locator('#se-answer-text').fill('Anivia')
  await host.locator('.se-host-metadata > summary').click()
  await host.locator('[data-se-field="hostNotes"]').fill('Privat: Nur der Host darf das lesen.')
  await host.locator('[data-se-field="hostNotes"]').blur()
  await expect(host.locator('.se-host-metadata')).to_have_attribute('open','')
  await expect(host.locator('[data-se-field="hostNotes"]')).to_have_value('Privat: Nur der Host darf das lesen.')
  await host.locator('[data-se-action="editor-pane"][data-pane="question"]').click()
  await host.locator('[data-action="publish"]').click()
  await expect(host.locator('.bq-board-scene .tile')).to_have_count(1,timeout=15000)
  await host.locator('.top-nav [data-view="teams"]').click()
  async with ctx.expect_page() as opening:
   await host.evaluate("window.open('about:blank','_blank')")
  guest=await opening.value
  guest.on('pageerror',lambda e:exceptions.append('guest '+str(e)))
  await fixture.install(guest)
  await guest.locator('#join-room').fill(room)
  await guest.locator('#join-name').fill('Alice')
  await guest.locator('button[type="submit"]').first.click()
  await expect(guest.locator('.bq-lobby-notice')).to_be_visible(timeout=15000)
  await host.locator('[data-action="approve"]').first.click()
  await guest.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=15000)
  # The host is authoritative; a spectator/guest never receives the private ledger or host notes.
  before=await guest.evaluate("JSON.stringify(window.__probe.info().publicState)")
  assert 'Nur der Host darf' not in before and 'scoreEvents' not in before
  await host.evaluate("() => window.__probe.getGame().setState(window.__probe.room(),{started:true})")
  await host.locator('.top-nav [data-view="live"]').click()
  await host.evaluate("async() => {const g=window.__probe.getGame(),room=window.__probe.room();await g.score(room,'t1',100);await g.score(room,'t1',100)}")
  await host.locator('.top-nav [data-view="history"]').click()
  await host.locator('.bq-score-ledger summary').click()
  await expect(host.locator('.bq-score-ledger li')).to_have_count(2)
  await host.locator('[data-action="undo-last-score"]').click()
  await host.wait_for_function("() => window.__probe.info().publicState?.scores?.t1===100")
  await expect(host.locator('.bq-score-ledger')).to_contain_text('zurückgenommen')
  await guest.wait_for_function("() => window.__probe.info().publicState?.scores?.t1===100")
  assert await guest.evaluate("window.__probe.info().publicState.scores.t1")==100
  print('PASS: private audit, guarded last-score undo and synchronized score on guest')
  await host.locator('.top-nav [data-view="live"]').click()
  await host.locator('[data-action="finish-game"]').click()
  await expect(host.locator('[data-action="finale-all"]')).to_be_visible()
  await host.locator('[data-action="finale-all"]').click()
  for page in (host,guest):
   await page.wait_for_function("() => window.__probe.info().publicState?.phase==='finished'",timeout=15000)
   await expect(page.locator('.bq-finale')).to_be_visible()
   await expect(page.locator('.bq-finale-results')).to_contain_text('100 Punkte')
  assert await guest.locator('[data-action="resume-final"]').count()==0
  await guest.set_viewport_size({'width':390,'height':844})
  await guest.wait_for_function("""()=>{
   const box=document.querySelector('.bq-finale')?.getBoundingClientRect();
   return box && box.width>0 && box.x>=-2 && box.right<=392;
  }""")
  await host.locator('[data-action="resume-final"]').click()
  await guest.wait_for_function("() => window.__probe.info().publicState?.phase==='board'",timeout=15000)
  assert await guest.evaluate("window.__probe.info().publicState.scores.t1")==100
  assert not exceptions,exceptions
  await browser.close()
  print('PASS: end-of-quiz winner display, protected role, mobile, resume board without losing scores')

if __name__=='__main__':asyncio.run(main())
