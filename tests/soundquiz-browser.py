"""Host-autorisiertes Soundquiz mit zwei Teilnehmern, realer Audio-Wiedergabe und Buzzer.
Chromium und Mock-PeerJS: UI-/State-Synchronisation, kein echter WAN/ICE-Test.
"""
import asyncio,base64,importlib.util,io,math,struct,wave
from pathlib import Path
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_sound_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

def sound():
 out=io.BytesIO()
 with wave.open(out,'wb') as f:
  f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000)
  f.writeframes(b''.join(struct.pack('<h',int(7500*math.sin(i*2*math.pi*440/16000))) for i in range(16000*2)))
 return 'data:audio/wav;base64,'+base64.b64encode(out.getvalue()).decode('ascii')

async def assert_no_premature_replay(host):
 # The two-second fixture can already have FINISHED on a busy CI runner
 # after both guests synchronize. Replay is allowed after the clip ends.
 # Detect an EARLY replay by comparing the host's authoritative timestamp.
 state=await host.evaluate("""() => {
  const play=window.__probe.info().publicState.audioPlayback;
  return {exists:!!play,elapsed:play?window.__probe.getGame().serverNow()-play.at:NaN};
 }""")
 assert state['exists'] and math.isfinite(state['elapsed']),state
 if state['elapsed']<1850:
  assert await host.locator('[data-action="audio-play"]').count()==0,(
   'Host replay appeared before clip duration elapsed',state)

async def join(ctx,host,code,name):
 async with ctx.expect_page() as opening:
  await host.evaluate("window.open('about:blank','_blank')")
 guest=await opening.value
 await fixture.install(guest)
 await guest.locator('#join-room').fill(code);await guest.locator('#join-name').fill(name)
 await guest.locator('button[type="submit"]').first.click()
 await guest.locator('.bq-lobby-notice').wait_for(timeout=10000)
 await host.locator('[data-action="approve"]').first.click()
 await guest.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=10000)
 await guest.locator('.bq-lobby').wait_for(timeout=10000)
 return guest

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  errors=[]
  host=await ctx.new_page();host.on('dialog',lambda d:asyncio.create_task(d.accept()));host.on('pageerror',lambda e:errors.append('Host '+str(e)))
  await fixture.install(host)
  await host.locator('.bq-legacy-options>summary').click()
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await host.locator('.se-studio').wait_for()
  code=await host.evaluate('window.__probe.room()')
  q={'id':'sound-ability','category':'Audio','title':'Welcher Champion?','type':'audio',
     'roundMode':'buzzer','points':100,'prompt':'Welche Ability hörst du?',
     'answer':'Beispiel-Antwort','audio':sound(),
     'scene':{'template':'audio','version':2,'elements':[{'id':'heading','kind':'text','role':'question','text':'Welche Ability hörst du?','x':58,'y':34,'w':884,'h':106,'step':0}]}}
  await host.evaluate('(q)=>window.__probe.setQuiz({title:"Soundquiz",teams:["Rot","Blau"],questions:[q]})',q)
  await host.locator('[data-action="publish"]').first.click()
  await host.locator('.bq-board-scene .tile').first.wait_for()
  await host.locator('.top-nav [data-view="teams"]').click()
  alice=await join(ctx,host,code,'Alice');bob=await join(ctx,host,code,'Bob')
  for page,name in [(alice,'Alice'),(bob,'Bob')]:
   page.on('pageerror',lambda e,n=name:errors.append(n+' '+str(e)))
  await host.locator('[data-action="start-game"]').click()
  await host.locator('.top-nav [data-view="live"]').click()
  await host.locator('.bq-board-scene .tile').first.click()
  await host.locator('[data-action="uncover-question"]').click()
  await expect(alice.locator('.bq-soundquiz')).to_have_count(1,timeout=12000)
  for guest in [alice,bob]:
   assert 'audioPlayback' not in (await guest.evaluate("window.__probe.info().publicState.current"))
   assert await guest.locator('.bq-soundquiz audio').count()==0
   assert await guest.locator('.bq-soundquiz [data-action="audio-play"]').count()==0
   assert await guest.locator('.bq-soundquiz [data-action="audio-unblock"]').count()==0
   await expect(guest.locator('[data-action="buzz"]')).to_be_enabled()
  assert 'Der Host startet' in await bob.locator('.bq-sound-status').inner_text()
  await host.locator('[data-action="audio-play"]').first.click()
  for guest in [alice,bob]:
   await guest.wait_for_function("() => window.__probe.info().publicState.audioPlayback?.seq===1",timeout=10000)
   assert await guest.locator('.bq-soundquiz [data-action="audio-play"]').count()==0
  await assert_no_premature_replay(host)
  # Each guest can only unlock this host-authorized run if browser autoplay blocked.
  for guest in (alice,bob):
   if await guest.locator('[data-action="audio-unblock"]').count():
    await guest.locator('[data-action="audio-unblock"]').click()
  if await host.locator('[data-action="audio-unblock"]').count():
   await host.locator('[data-action="audio-unblock"]').click()
  await expect(bob.locator('[data-action="buzz"]')).to_be_enabled()
  await bob.locator('[data-action="buzz"]').click()
  await host.wait_for_function("() => Object.values(window.__probe.getGame().data.buzzers||{}).some(b=>b&&b.name==='Bob')",timeout=10000)
  await expect(alice.locator('[data-action="buzz"]')).to_be_disabled(timeout=10000)
  # No guest can restart after listening. The host gets replay only at the end.
  await host.get_by_role('button',name='↻ Sound erneut abspielen').wait_for(timeout=10000)
  assert await alice.locator('[data-action="audio-play"]').count()==0
  assert await bob.locator('[data-action="audio-play"]').count()==0
  assert await alice.locator('audio[controls]').count()==0
  await host.get_by_role('button',name='↻ Sound erneut abspielen').click()
  for guest in [alice,bob]:
   await guest.wait_for_function("() => window.__probe.info().publicState.audioPlayback?.seq===2",timeout=10000)
  await assert_no_premature_replay(host)
  if await host.locator('[data-action="audio-unblock"]').count():
   await host.locator('[data-action="audio-unblock"]').click()
  await host.get_by_role('button',name='↻ Sound erneut abspielen').wait_for(timeout=10000)
  # The host must explicitly judge or clear an active buzzer BEFORE revealing.
  # This question tests the manual solution, so reset an accidental buzz,
  # keep the scores unchanged, then reveal normally.
  await expect(host.locator('[data-action="reveal"]')).to_be_disabled()
  await host.locator('.bq-buzzer-winner [data-action="reset-buzz"]').click()
  await expect(host.locator('[data-action="reveal"]')).to_be_enabled()
  await host.locator('[data-action="reveal"]').first.click()
  await alice.wait_for_function("() => window.__probe.info().publicState.phase==='reveal'",timeout=10000)
  assert await alice.locator('[data-action="audio-unblock"]').count()==0
  assert await alice.locator('[data-action="audio-play"]').count()==0
  assert not errors,errors
  print('PASS: host-only start/replay after ended, 2 synchronized authorization events, buzz while audio plays, no native replay, no JS errors')
  await browser.close()

if __name__=='__main__':asyncio.run(main())
