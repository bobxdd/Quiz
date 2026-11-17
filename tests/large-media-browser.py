"""Large 12-second quiz audio tested through browser MockPeerJS with a simulated
24 KiB RTC message limit. Asserts first transfer, small follow-up updates,
buzzer latency, reveal and mobile answer visibility.
"""
import asyncio,base64,importlib.util,io,math,struct,wave
from pathlib import Path
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_large_media_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

def wav_12s():
 raw=io.BytesIO()
 with wave.open(raw,'wb') as f:
  f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000)
  f.writeframes(b''.join(struct.pack('<h',int(5000*math.sin(i*2*math.pi*440/16000))) for i in range(16000*12)))
 return 'data:audio/wav;base64,'+base64.b64encode(raw.getvalue()).decode()

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  host=await ctx.new_page();errors=[]
  host.on('pageerror',lambda e:errors.append('Host '+str(e)))
  await fixture.install(host)
  await host.evaluate("""() => {
   window.__rtcWireSizes=[];
   const original=Peer.prototype.on;
   Peer.prototype.on=function(type,callback){
    if(type!=='connection')return original.call(this,type,callback);
    return original.call(this,type,conn=>{
     const send=conn.send.bind(conn);
     conn.send=function(value){
      const bytes=new TextEncoder().encode(JSON.stringify(value)).length;
      window.__rtcWireSizes.push(bytes);
      if(bytes>24000)throw Error('Simulated RTC max 24KB exceeded: '+bytes);
      return send(value);
     };
     callback(conn);
    });
   };
  }""")
  await host.locator('.bq-legacy-options>summary').click()
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await host.locator('.se-studio').wait_for(timeout=12000)
  room=await host.evaluate('window.__probe.room()')
  audio=wav_12s()
  assert len(audio)>500000,len(audio)
  q={'id':'large-sound','title':'Langer Sound','category':'Audio','type':'audio',
    'roundMode':'buzzer','points':400,'prompt':'Welche Fähigkeit ist das?','answer':'Anivias Q','audio':audio}
  await host.evaluate('(q)=>window.__probe.setQuiz({title:"Audio Langtest",teams:["Rot","Blau"],questions:[q]})',q)
  await host.locator('[data-action="publish"]').first.click()
  await host.locator('.bq-board-scene .tile').wait_for(timeout=12000)
  await host.locator('.top-nav [data-view="teams"]').click()
  async with ctx.expect_page() as opening:
   await host.evaluate("window.open('about:blank','_blank')")
  guest=await opening.value
  guest.on('pageerror',lambda e:errors.append('Gast '+str(e)))
  await fixture.install(guest)
  await guest.locator('#join-room').fill(room)
  await guest.locator('#join-name').fill('Alice')
  await guest.locator('button[type="submit"]').first.click()
  await guest.locator('.bq-lobby-notice').wait_for(timeout=12000)
  assert await guest.evaluate("window.__probe.info().publicState") is None,'Pending guest has no quiz'
  await host.locator('[data-action="approve"]').first.click()
  await guest.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=12000)
  await host.locator('.top-nav [data-view="live"]').click()
  await host.locator('[data-action="open"][data-qid="large-sound"]').first.click()
  await guest.wait_for_function("() => window.__probe.info().publicState?.current?.audio?.length>500000",timeout=30000)
  assert await guest.evaluate("window.__probe.info().publicState.current.answer") is None
  await expect(guest.locator('.bq-soundquiz')).to_be_visible(timeout=15000)
  assert await host.evaluate("Math.max(...window.__rtcWireSizes)")<=24000
  assert await host.evaluate("window.__rtcWireSizes.filter(n=>n>5000).length")>=40

  previous=await host.evaluate("window.__rtcWireSizes.length")
  await host.evaluate("() => window.__probe.getGame().setState(window.__probe.room(),{'settings/chatOpen':false})")
  await guest.wait_for_function("() => window.__probe.info().publicState?.settings?.chatOpen===false",timeout=12000)
  transferred=await host.evaluate("(i)=>window.__rtcWireSizes.slice(i).reduce((sum,n)=>sum+n,0)",previous)
  assert transferred<40000,'An ordinary update retransmitted the audio: '+str(transferred)
  await guest.locator('[data-action="buzz"]').click()
  await host.locator('[data-action="buzz-correct"]').wait_for(timeout=12000)
  await host.locator('[data-action="buzz-correct"]').click()
  await guest.wait_for_function("() => window.__probe.info().publicState?.phase==='reveal'",timeout=12000)
  await expect(guest.locator('.stage .answer')).to_contain_text('Anivias Q')
  assert await guest.evaluate("window.__probe.info().publicState.current.audio.length")==len(audio)
  assert await host.evaluate("Math.max(...window.__rtcWireSizes)")<=24000
  await guest.set_viewport_size({'width':390,'height':844})
  await expect(guest.locator('.stage .answer')).to_be_visible()
  # Capture geometry synchronously because the live view replaces its DOM on
  # WebRTC snapshots; detached handles must not make an otherwise valid test flaky.
  bounds=await guest.evaluate("""() => {
   const el=document.querySelector('.stage .answer');
   if(!el)return null;
   el.scrollIntoView({block:'nearest',inline:'nearest'});
   const r=el.getBoundingClientRect();
   return {x:r.x,width:r.width};
  }""")
  assert bounds and bounds['width']>10 and bounds['x']>=-2 and bounds['x']+bounds['width']<=391,bounds
  assert not errors,errors
  await browser.close()
  print('PASS large media: 12s WAV >500KB across <=24KB packets, repeated state cache, buzzer, reveal and mobile')

if __name__=='__main__':asyncio.run(main())
