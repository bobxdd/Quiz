"""Game-design regression: a written round with missing responses must close
at its timer deadline, reveal only safely submitted answers and stay host-scored."""
import asyncio,importlib.util
from pathlib import Path
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('quiz_writer_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  context=await browser.new_context(viewport={'width':1280,'height':850},reduced_motion='reduce')
  errors=[]
  try:
   host=await context.new_page()
   host.on('pageerror',lambda err:errors.append('host: '+str(err)))
   host.on('dialog',lambda d:asyncio.create_task(d.accept()))
   await fixture.install(host)
   await host.locator('.bq-legacy-options>summary').click()
   await host.get_by_role('button',name='Online-Raum erstellen').click()
   await host.locator('.se-studio').wait_for(timeout=12000)
   room=await host.evaluate('window.__probe.room()')
   question={'id':'timer-written','category':'Champions','title':'Schreibfrage','type':'text',
    'roundMode':'written','points':200,'seconds':0,'prompt':'Welcher Champion?','answer':'Jinx'}
   await host.evaluate('(q)=>window.__probe.setQuiz({title:"Fairness Test",teams:["Blau","Rot"],questions:[q]})',question)
   await host.locator('[data-action="publish"]').click()
   await host.locator('.bq-board-scene .tile').wait_for(timeout=12000)
   players=[]
   for name in ['Anna','Ben']:
    # Open from the host tab: PeerJS mock instances share this opener context.
    # A separate about:blank context.new_page() would isolate the signaling hub.
    async with context.expect_page() as opening:
     await host.evaluate("window.open('about:blank','_blank')")
    page=await opening.value
    page.on('pageerror',lambda err:errors.append('guest: '+str(err)))
    await fixture.install(page)
    await page.locator('#join-room').fill(room)
    await page.locator('#join-name').fill(name)
    await page.locator('button[type="submit"]').first.click()
    await page.locator('.bq-lobby-notice').wait_for(timeout=12000)
    await host.locator('.top-nav [data-view="teams"]').click()
    await host.locator('[data-action="approve"]').first.click()
    await page.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=12000)
    players.append(page)
   anna,ben=players
   await host.locator('.top-nav [data-view="live"]').click()
   await host.locator('[data-action="open"][data-qid="timer-written"]').click()
   await host.locator('[data-action="uncover-question"]').click()
   await expect(anna.locator('#answer-text')).to_be_visible(timeout=12000)
   await expect(ben.locator('#answer-text')).to_be_visible(timeout=12000)
   await anna.locator('#answer-text').fill('Jinx')
   await anna.locator('#answer-form [data-action="submit-answer"]').click()
   await host.wait_for_function("() => Object.values(window.__probe.getGame().data.responses?.['1']||{}).length===1",timeout=8000)
   await expect(host.locator('.review-card')).to_have_count(0)
   # Start a short authoritative deadline AFTER Anna's submission. Ben
   # remains connected but never submits, reproducing dropout/idle players.
   await host.evaluate("""async ()=>{
    const g=window.__probe.getGame(),s=window.__probe.info().publicState;
    await g.updateCurrent(window.__probe.room(),s.round,s.current.id,{deadline:Date.now()+900},['question']);
   }""")
   await host.wait_for_function("() => window.__probe.info().publicState?.phase==='review'",timeout=9000)
   await expect(ben.locator('.review-card.is-hidden')).to_have_count(1,timeout=8000)
   await expect(ben.locator('.review-card.is-missing')).to_have_count(1)
   assert 'Jinx' not in await ben.evaluate("JSON.stringify(window.__probe.info().publicState.answerReview)"),'answer leaked while hidden'
   await host.locator('.review-card.is-hidden').first.click()
   await expect(host.locator('.review-card.is-revealed')).to_have_count(1)
   await host.locator('.review-card.is-revealed [data-action="judge-review-correct"]').click()
   assert await host.evaluate("window.__probe.info().publicState.scores.t1")==200
   assert not errors,errors
   print('PASS: timed written question closes with an absent response; private answer remains hidden, host reveals and scores once',flush=True)
  finally:
   await context.close()
   await browser.close()

if __name__=='__main__':
 asyncio.run(main())
