"""Step 4: actual browser/UI multiplayer lobby regression on mocked PeerJS connections.
The mock transports messages between distinct pages; it does not emulate real ICE/TURN.
"""
import asyncio,importlib.util,shutil
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_lobby_loader',ROOT/'tests/categories-3_0-browser.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
install=loader.install
OUT=ROOT/'qa-artifacts'

async def spawn(ctx,host,code,name,errors):
 async with ctx.expect_page() as evt:
  await host.evaluate("window.open('about:blank','_blank')")
 page=await evt.value;page.on('pageerror',lambda e:errors.append(name+': '+str(e)))
 await install(page)
 await page.locator('#join-room').fill(code);await page.locator('#join-name').fill(name)
 await page.locator('#join-form button[type="submit"]').click()
 await page.locator('.bq-lobby-notice').wait_for(timeout=12000)
 return page

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':900},reduced_motion='reduce')
  errors=[]
  host=await ctx.new_page();host.on('pageerror',lambda e:errors.append('Host: '+str(e)))
  host.on('dialog',lambda d:asyncio.create_task(d.accept()))
  await install(host)
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await host.locator('.se-studio').wait_for()
  code=await host.evaluate('window.__probe.room()')
  quiz={'title':'Team-Lobby-Test','teams':['Rot','Blau'],'questions':[{'id':'q-lobby',
    'category':'Wissen','title':'Erste Frage','type':'text','roundMode':'written',
    'prompt':'Welche Pflanze ist hier gemeint?','answer':'Pfefferminze','points':100}]}
  await host.evaluate('(x)=>window.__probe.setQuiz(x)',quiz)
  await host.locator('[data-action="publish"]').first.click()
  await host.locator('.bq-board-scene').wait_for()
  a=await spawn(ctx,host,code,'Alice',errors)
  assert await a.locator('.bq-lobby-team').count()==2
  assert await a.locator('.bq-lobby-create').count()==1
  assert await a.locator('[data-action="lobby-ready"]').is_disabled()
  secret=await a.evaluate('JSON.stringify(window.__probe.getGame().guestData)')
  assert 'Pfefferminze' not in secret and '"current"' not in secret
  print('PASS: pending player sees safe team lobby, no host answers and ready initially disabled',flush=True)

  await a.locator('[data-action="lobby-join"][data-team="t2"]').click()
  await a.locator('.bq-lobby-team.is-selected').wait_for()
  await a.wait_for_timeout(210)
  await a.locator('[data-action="lobby-ready"]').click()
  await a.locator('[data-action="lobby-ready"][aria-pressed="true"]').wait_for()
  await host.locator('.top-nav [data-view="teams"]').click()
  await host.locator('[data-action="approve"]').first.wait_for()
  assert 'Gewünscht: Blau' in await host.locator('.bq-lobby-request').first.inner_text()
  assert 'Bereit' in await host.locator('.bq-lobby-request').first.inner_text()
  await host.locator('[data-action="approve"]').first.click()
  await a.wait_for_function("() => window.__probe.info().member?.status==='approved'")
  assert (await a.evaluate('window.__probe.info().member.team'))=='t2'
  assert await a.locator('.bq-lobby-counter').inner_text()=='1 / 1\nbereit'
  print('PASS: self-chosen existing team and pre-approval readiness survive host admission',flush=True)

  b=await spawn(ctx,host,code,'Bob',errors)
  await b.locator('#bq-new-team').fill('Aurora & Wald')
  await b.locator('#lobby-create-form button[type="submit"]').click()
  await b.locator('.bq-lobby-proposal').wait_for()
  assert await b.locator('.bq-lobby-team').count()==2
  await b.wait_for_timeout(210)
  await b.locator('[data-action="lobby-ready"]').click()
  await host.locator('[data-action="approve"]').first.wait_for()
  assert 'Neues Team: Aurora & Wald' in await host.locator('.bq-lobby-request').first.inner_text()
  assert await host.locator('select[id^="team-"]').first.input_value()==''
  await host.locator('[data-action="approve"]').first.click()
  await b.wait_for_function("() => window.__probe.info().member?.status==='approved'")
  assert (await b.evaluate('window.__probe.info().member.team'))=='t3'
  live=await host.evaluate('window.__probe.info().publicState')
  assert live['teams']['t3']=='Aurora & Wald'
  assert live['scores']['t3']==0
  colors=await b.evaluate("""() => [...document.querySelectorAll('.bq-lobby-team')].map(x=>getComputedStyle(x).borderTopColor)""")
  assert len(colors)==3 and len(set(colors))==3,colors
  print('PASS: host commits a unique new team, three distinct color accents and score baseline',flush=True)

  c=await spawn(ctx,host,code,'Charlie',errors)
  await c.locator('[data-action="lobby-join"][data-team="t3"]').click()
  await host.locator('.bq-lobby-request').filter(has_text='Gewünscht: Aurora & Wald').wait_for(timeout=10000)
  await host.locator('[data-action="approve"]').first.click()
  await c.wait_for_function("() => window.__probe.info().member?.status==='approved'")
  assert (await c.evaluate('window.__probe.info().member.team'))=='t3'
  team_stats=await host.locator('.bq-host-team-row').filter(has_text='Aurora & Wald').inner_text()
  assert '1/2 bereit' in team_stats,team_stats  # Charlie has not pressed ready
  print('PASS: subsequent players can join a team created in this room',flush=True)
  # Host-created teams use the same capacity/name rules as participant-created ones.
  for team_name,expected_count in [('Host Gold',4),('Host Violett',5)]:
   creator=host.locator('.bq-host-team-create')
   if await creator.get_attribute('open') is None:
    await creator.locator('summary').click()
   await host.locator('#bq-host-team-name').fill(team_name)
   await host.locator('#host-team-create-form button[type="submit"]').click()
   await host.wait_for_function('(count)=>Object.keys(window.__probe.info().publicState.teams).length===count',expected_count)
  assert await host.locator('.bq-host-team-create').count()==0
  await a.wait_for_function("() => Object.keys(window.__probe.info().guestLobby?.teams||{}).length===5")
  assert await a.locator('.bq-lobby-team').count()==5
  assert await a.locator('#lobby-create-form').count()==0
  names=await host.evaluate("Object.values(window.__probe.info().publicState.teams)")
  assert len(names)==5 and len(set(names))==5,names
  assert (await host.evaluate('Object.keys(window.__probe.getGame().data.roster).length'))==3
  print('PASS: host can create two teams directly; five-team limit enforced without consuming guest slots',flush=True)


  # A team change automatically cancels an earlier ready signal.
  await a.wait_for_timeout(210)
  await a.locator('[data-action="lobby-join"][data-team="t1"]').click()
  await a.locator('[data-action="lobby-ready"][aria-pressed="false"]').wait_for()
  assert (await host.evaluate("Object.values(window.__probe.getGame().data.members).find(x=>x.name==='Alice').ready")) is False
  await a.wait_for_timeout(210);await a.locator('[data-action="lobby-ready"]').click()
  await a.locator('[data-action="lobby-ready"][aria-pressed="true"]').wait_for()
  print('PASS: team changes invalidate readiness and re-ready updates host',flush=True)

  # Team-only chat stays confined to the new team's room.
  await b.locator('.bq-shared-team-chat summary').click()
  await b.locator('#chat-text').fill('Aurora Team Secret')
  await b.locator('#chat-form button[type="submit"]').click()
  await c.locator('.bq-shared-team-chat summary').click()
  await c.locator('.chatfeed').get_by_text('Aurora Team Secret').wait_for(timeout=12000)
  await a.locator('.bq-shared-team-chat summary').click()
  assert await a.locator('.chatfeed').get_by_text('Aurora Team Secret').count()==0
  print('PASS: private chat does not follow a player into another team',flush=True)
  
  OUT.mkdir(exist_ok=True)
  for width,height in [(320,720),(390,844),(768,1024),(1366,900)]:
   await b.set_viewport_size({'width':width,'height':height})
   await b.locator('.bq-lobby-team').first.wait_for(state='visible')
   sizes=await b.evaluate("""() => ({inner:innerWidth,scroll:document.documentElement.scrollWidth,
    buttons:[...document.querySelectorAll('.bq-lobby-team button,.bq-lobby-ready-bar button')].filter(x=>!x.disabled).map(x=>x.getBoundingClientRect().height),
    names:[...document.querySelectorAll('.bq-lobby-team-name')].map(e=>({w:e.clientWidth,scroll:e.scrollWidth}))})""")
   assert sizes['scroll']<=sizes['inner']+8,sizes
   assert all(h>=38 for h in sizes['buttons']),sizes
   assert all(n['scroll']<=n['w']+6 for n in sizes['names']),sizes
   await b.screenshot(path=str(OUT/f'step4-lobby-{width}x{height}.png'),full_page=True,animations='disabled')
   print('PASS: clear responsive lobby',width,height,flush=True)

  # Publishing or resetting a quiz must preserve the dynamically created team.
  await host.locator('.top-nav [data-view="editor"]').click()
  await host.locator('[data-action="publish"]').first.click()
  await host.locator('.bq-board-scene').wait_for()
  new=await host.evaluate('window.__probe.info().publicState')
  assert new['teams']['t3']=='Aurora & Wald'
  assert 't3' in new['scores']
  assert new['teams']['t4']=='Host Gold' and new['teams']['t5']=='Host Violett'
  assert 't4' in new['scores'] and 't5' in new['scores']
  print('PASS: created team persists through republish',flush=True)

  await host.locator('.bq-board-scene .tile:not([disabled])').first.click()
  await a.locator('.bq-question-scene').wait_for(timeout=12000)
  await b.locator('.bq-question-scene').wait_for(timeout=12000)
  denial=await a.evaluate("""async()=>{try{await window.__probe.getGame().chooseLobbyTeam(window.__probe.room(),'t2');return 'WRONGLY ACCEPTED'}catch(e){return e.message}}""")
  assert 'gesperrt' in denial,denial
  assert (await host.evaluate("window.__probe.info().publicState.current.id"))=='q-lobby'
  print('PASS: game begins and blocks team swaps without altering current question',flush=True)
  # Late arrivals must not see actionable team controls or an actionable host approval.
  late=await spawn(ctx,host,code,'Late Join',errors)
  assert await late.locator('[data-action="lobby-join"]').count()==0
  assert await late.locator('[data-action="lobby-ready"]').is_disabled()
  await host.locator('.top-nav [data-view="teams"]').click()
  await host.locator('[data-action="approve"]').first.wait_for()
  assert await host.locator('[data-action="approve"]').first.is_disabled()
  assert 'Spiel läuft' in await host.locator('[data-action="approve"]').first.inner_text()
  print('PASS: late joiners are shown locked lobby, host cannot click invalid admission',flush=True)
  assert not errors,errors
  await browser.close()

if __name__=='__main__':asyncio.run(main())
