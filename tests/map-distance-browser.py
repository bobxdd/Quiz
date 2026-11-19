"""E2E: two real mock-WebRTC guests submit map pins; host reveals km and manually awards."""
import asyncio,importlib.util
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_fixture_distances',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

async def join_guest(ctx,host,code,name,team='t1'):
 async with ctx.expect_page() as opened:
  await host.evaluate("window.open('about:blank','_blank')")
 guest=await opened.value
 await fixture.install(guest)
 await guest.locator('#join-room').fill(code)
 await guest.locator('#join-name').fill(name)
 await guest.locator('button[type="submit"]').first.click()
 await guest.locator('.bq-lobby-notice').wait_for(timeout=12000)
 await host.locator('select[id^="team-"]').first.select_option(team)
 await host.locator('[data-action="approve"]').first.click()
 await guest.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=12000)
 await guest.locator('.bq-lobby').wait_for()
 return guest

async def pin_and_submit(page,x,y):
 await page.locator('.bq-map-viewport').wait_for(timeout=12000)
 rect=await page.locator('.bq-map-viewport').bounding_box()
 await page.mouse.click(rect['x']+rect['width']*x,rect['y']+rect['height']*y)
 await expect(page.locator('.bq-map-pin.is-self')).to_have_count(1,timeout=12000)
 await page.locator('[data-action="submit-answer"]').click()
 await page.locator('[data-action="submit-answer"]').get_by_text('Pin aktualisieren').wait_for(timeout=12000)

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  errors=[];host=await ctx.new_page()
  host.on('pageerror',lambda err:errors.append('host: '+str(err)))
  await fixture.install(host)
  await host.locator('.bq-legacy-options>summary').click()
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await host.locator('.se-studio').wait_for()
  code=await host.evaluate('window.__probe.room()')
  q={'id':'map-distance','category':'Geographie','title':'Kilometer','type':'map','roundMode':'written','points':200,'seconds':90,
     'prompt':'Wo liegt der Ort?','answer':'','mapTargetSet':True,'mapTargetX':50,'mapTargetY':50,
     'scene':{'template':'map','version':2,'elements':[{'id':'heading','kind':'text','role':'question','text':'Wo liegt der Ort?','x':58,'y':34,'w':884,'h':106,'step':0}]}}
  await host.evaluate('(q)=>window.__probe.setQuiz({title:"Km Test",teams:["Rot","Blau"],questions:[q]})',q)
  await host.locator('[data-action="publish"]').first.click()
  await host.locator('.bq-board-scene .tile').first.wait_for()
  await host.locator('.top-nav [data-view="teams"]').click()
  alice=await join_guest(ctx,host,code,'Alice')
  bob=await join_guest(ctx,host,code,'Bob')
  charlie=await join_guest(ctx,host,code,'Charlie','t2')
  for guest,name in [(alice,'alice'),(bob,'bob'),(charlie,'charlie')]:
   guest.on('pageerror',lambda err,label=name:errors.append(label+': '+str(err)))
  await host.locator('.top-nav [data-view="live"]').click()
  await host.locator('.bq-board-scene .tile').first.click()
  await host.locator('[data-action="uncover-question"]').click()
  await alice.locator('.bq-map-viewport').wait_for(timeout=12000)
  await bob.locator('.bq-map-viewport').wait_for(timeout=12000)
  await charlie.locator('.bq-map-viewport').wait_for(timeout=12000)
  for page in (host,alice,bob,charlie):
   await expect(page.locator('.bq-round-countdown')).to_be_visible()
   assert ':' in await page.locator('#clock').inner_text()
  await pin_and_submit(alice,.5,.5)
  await pin_and_submit(bob,.75,.5)
  await pin_and_submit(charlie,.25,.5)
  await host.wait_for_function("() => Object.values(window.__probe.getGame().data.responses||{}).some(bucket=>Object.keys(bucket).length>=3)",timeout=12000)
  assert 'mapTargetX' not in await alice.evaluate('window.__probe.info().publicState.current')
  for guest in (alice,bob,charlie):
   assert await guest.locator('.bq-review-map-distance').count()==0
   assert await guest.locator('.bq-map-pin.is-public').count()==0
   assert await guest.locator('.bq-map-pin.is-solution').count()==0
  # Directly reveal, without first publishing any individual answer.
  await host.locator('[data-action="reveal"]').first.click()
  for guest in (alice,bob,charlie):
   await expect(guest.locator('.bq-review-map-distance')).to_have_count(3,timeout=15000)
   await expect(guest.locator('.bq-map-pin.is-public')).to_have_count(3,timeout=15000)
   await expect(guest.locator('.bq-map-pin.is-solution')).to_have_count(1,timeout=15000)
   assert 'Luftlinie' in await guest.locator('.review-summary').inner_text()
   assert 'entscheidet weiterhin selbst' in await guest.locator('.review-summary').inner_text()
  await expect(host.locator('.review-card')).to_have_count(3,timeout=15000)
  await expect(host.locator('.bq-map-pin-legend')).to_contain_text('Alice')
  await expect(host.locator('.bq-map-pin-legend')).to_contain_text('Bob')
  await expect(host.locator('.bq-map-pin-legend')).to_contain_text('Charlie')
  assert await host.locator('.bq-map-pin.is-public .bq-map-pin-dot').all_inner_texts()==['1','2','3']
  await host.locator('.bq-review-team-nav [data-team="t1"]').click()
  await expect(host.locator('.review-card')).to_have_count(2)
  await host.locator('.bq-review-team-nav [data-team="t2"]').click()
  await expect(host.locator('.review-card')).to_have_count(1)
  await expect(host.locator('.review-card')).to_contain_text('Charlie')
  await host.locator('.bq-review-team-nav [data-team="all"]').click()
  await expect(host.locator('.review-card')).to_have_count(3)
  cards=await host.evaluate("""() => Array.from(document.querySelectorAll('.review-card')).map(card=>({
    name:card.querySelector('.review-name')?.firstChild?.textContent,
    distance:card.querySelector('.bq-review-map-distance strong')?.textContent
  }))""")
  assert len(cards)==3,cards
  by_name={card['name']:card['distance'] for card in cards}
  assert by_name['Alice']=='0 km',by_name
  assert by_name['Bob'] and by_name['Bob']!='0 km',by_name
  before=await host.evaluate("""() => window.__probe.info().publicState.playerScores || {}""")
  assert not any((v.get('total') or 0)!=0 for v in before.values() if isinstance(v,dict)),before
  assert await host.locator('.review-card [data-action="judge-review-correct"]').count()==3
  # Bob is farther away, but the host may choose Bob anyway.
  bobid=await host.evaluate("""() => Object.entries(window.__probe.info().publicState.answerReview.entries).find(([,v])=>v.name==='Bob')[0]""")
  await host.locator(f'.review-card[data-review-player="{bobid}"] [data-action="judge-review-correct"]').click()
  await host.wait_for_function("""(id) => window.__probe.info().publicState.playerScores?.[id]?.total===200""",arg=bobid,timeout=12000)
  after=await host.evaluate("""() => window.__probe.info().publicState.playerScores || {}""")
  assert after[bobid]['total']==200,after
  assert sum(v.get('total',0) for v in after.values() if isinstance(v,dict))==200,after
  assert not errors,errors
  print('PASS: two public distances after solution, private until reveal, host chooses winner manually',flush=True)
  await browser.close()

if __name__=='__main__':asyncio.run(main())
