"""SFX live browser E2E: host buzzer chime, own button click, wrong/right feedback,
per-client sliders, local persistence, mute, redraw dedupe and mobile menu.
This uses the real BrainQuiz browser UI with mocked PeerJS signaling, NOT external ICE.
"""
import asyncio,importlib.util
from pathlib import Path
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_fx_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

async def count(page):
 return await page.evaluate('window.__sfxOscCount||0')

async def install_spy(page):
 await page.evaluate("""() => {
  window.__sfxOscCount=0;
  const original=AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator=function(...args){
   window.__sfxOscCount+=1;
   return original.apply(this,args);
  };
 }""")

async def join(ctx,host,room,name):
 async with ctx.expect_page() as opening:
  await host.evaluate("window.open('about:blank','_blank')")
 page=await opening.value
 await fixture.install(page);await install_spy(page)
 await page.locator('#join-room').fill(room)
 await page.locator('#join-name').fill(name)
 await page.locator('button[type="submit"]').first.click()
 await page.locator('.bq-lobby-notice').wait_for(timeout=12000)
 await host.locator('[data-action="approve"]').first.click()
 await page.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=12000)
 return page

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  host=await ctx.new_page();errors=[]
  host.on('pageerror',lambda e:errors.append('host: '+str(e)))
  await fixture.install(host);await install_spy(host)
  await host.locator('.bq-legacy-options>summary').click()
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await host.locator('.se-studio').wait_for()
  room=await host.evaluate('window.__probe.room()')
  questions=[{'id':'cue-1','category':'Sound','type':'text','roundMode':'buzzer','points':100,
              'title':'Buzzer-Soundtest','prompt':'Welcher Champion ist das?','answer':'Anivia'}]
  await host.evaluate('(q)=>window.__probe.setQuiz({title:"SFX QA",teams:["Rot","Blau"],questions:q})',questions)
  await host.locator('[data-action="publish"]').first.click()
  await host.locator('.bq-board-scene .tile').first.wait_for()
  await host.locator('.top-nav [data-view="teams"]').click()
  alice=await join(ctx,host,room,'Alice')
  alice.on('pageerror',lambda e:errors.append('guest: '+str(e)))
  await host.locator('[data-action="start-game"]').click()
  await host.locator('.top-nav [data-view="live"]').click()
  await host.locator('.bq-board-scene .tile').first.click()
  await host.locator('[data-action="uncover-question"]').click()
  await expect(alice.locator('.bq-big-buzzer')).to_be_visible(timeout=12000)
  # The icon and the separate controls are available to guest and host.
  for page in (host,alice):
   speaker=page.locator('.bq-sfx-menu>summary')
   await expect(speaker).to_be_visible()
   await speaker.click()
   await expect(page.locator('[data-sfx-volume]')).to_have_count(4)
   assert await page.locator('[data-sfx-volume="master"]').input_value()=='35'
  # Adjust Alice's buzzer volume; all other controls remain untouched.
  await alice.locator('[data-sfx-volume="buzz"]').evaluate("""el=>{
   el.value='17';el.dispatchEvent(new Event('input',{bubbles:true}))
  }""")
  saved=await alice.evaluate("JSON.parse(localStorage.getItem('brainquiz-sfx-local-v1'))")
  assert saved['buzz']==17 and saved['master']==35 and saved['correct']==40,saved
  host_before=await count(host);guest_before=await count(alice)
  # Preview generates exactly one buzz oscillator; owner retains local settings.
  await host.locator('[data-action="sfx-preview"][data-sfx="buzz"]').click()
  assert await count(host)==host_before+1
  # Close settings before pressing the large buzzer.
  await host.locator('.bq-sfx-menu>summary').click()
  await alice.locator('.bq-sfx-menu>summary').click()
  host_before=await count(host);guest_before=await count(alice)
  await alice.locator('[data-action="buzz"]').click()
  await host.wait_for_function("() => Object.values(window.__probe.getGame().data.buzzers||{}).some(b=>b?.name==='Alice')",timeout=12000)
  await host.wait_for_function("(n) => (window.__sfxOscCount||0)>n",arg=host_before,timeout=5000)
  assert await count(host)==host_before+1,'Host must beep only once for the approved buzzer'
  assert await count(alice)==guest_before+1,'Participant must hear their own buzzer once'
  # Repeated snapshots, UI redraws and unrelated network updates cannot replay the cue.
  stable=await count(host)
  await host.evaluate('window.__probe.getGame()._changed()')
  await host.wait_for_timeout(350)
  assert await count(host)==stable,'Repeated snapshot produced duplicate host buzzer sound'
  # Wrong score is an authoritative public event. Both clients hear one error cue.
  h0=await count(host);a0=await count(alice)
  await host.locator('[data-action="buzz-wrong"]').click()
  await host.wait_for_function("() => window.__probe.info().publicState.buzzerJudgements?.['1']?.result==='wrong'",timeout=10000)
  await alice.wait_for_function("() => window.__probe.info().publicState.buzzerJudgements?.['1']?.result==='wrong'",timeout=10000)
  await host.wait_for_function('(n) => (window.__sfxOscCount||0)>=n+2',arg=h0,timeout=4000)
  assert await count(host)==h0+2 and await count(alice)==a0+2,(await count(host),await count(alice))
  h1=await count(host)
  await host.evaluate('window.__probe.getGame()._changed()')
  await host.wait_for_timeout(300)
  assert await count(host)==h1,'Score redraw replayed the wrong-answer cue'
  # Host re-enables the participant, then judges correct.
  await host.locator('[data-action="unlock-buzz-all"]').first.click()
  await alice.locator('[data-action="buzz"]').wait_for(state='visible')
  await expect(alice.locator('[data-action="buzz"]')).to_be_enabled(timeout=10000)
  await alice.locator('[data-action="buzz"]').click()
  await host.locator('[data-action="buzz-correct"]').wait_for(timeout=10000)
  h2=await count(host);a2=await count(alice)
  await host.locator('[data-action="buzz-correct"]').click()
  await alice.wait_for_function("() => window.__probe.info().publicState.buzzerJudgements?.['1']?.result==='correct'",timeout=10000)
  assert await count(host)==h2+2 and await count(alice)==a2+2,(await count(host),await count(alice))
  # Mute blocks preview, changes only this device, and survives navigation redraw.
  await alice.locator('.bq-sfx-menu>summary').click()
  await alice.locator('[data-action="sfx-mute"]').click()
  await expect(alice.locator('.bq-sfx-menu>summary')).to_have_text('🔇')
  before_mute=await count(alice)
  await alice.locator('[data-action="sfx-preview"][data-sfx="buzz"]').click()
  assert await count(alice)==before_mute,'Muted client played a preview'
  assert (await alice.evaluate("JSON.parse(localStorage.getItem('brainquiz-sfx-local-v1'))"))['muted'] is True
  assert await host.evaluate("() => {const text=localStorage.getItem('brainquiz-sfx-local-v1');return !text||JSON.parse(text).muted===false}")
  # Mobile popover must remain inside screen bounds.
  await alice.set_viewport_size({'width':390,'height':844})
  await expect(alice.locator('.bq-sfx-panel')).to_be_visible()
  rect=await alice.locator('.bq-sfx-panel').bounding_box()
  assert rect and rect['x']>=-1 and rect['x']+rect['width']<=391,rect
  assert not errors,errors
  print('PASS: header controls, local volumes, preview, own and host buzzer, right/wrong, dedupe, mute, mobile popover')
  await browser.close()

if __name__=='__main__':asyncio.run(main())
