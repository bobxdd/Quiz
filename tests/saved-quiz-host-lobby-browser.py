"""Saved-quiz-first host workflow: explicit save, library selection, one quiz per lobby.
Real Chromium DOM + existing mocked PeerJS transport; no real TURN/ICE claims.
"""
import asyncio,importlib.util,shutil
from pathlib import Path
from playwright.async_api import async_playwright,expect
from board_library_test_support import active_board_id, read_board, read_boards, wait_board_saved

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa-artifacts';OUT.mkdir(exist_ok=True)
loader=importlib.util.spec_from_file_location('bq_saved_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(loader);loader.loader.exec_module(fixture)
install=fixture.install

def make_quiz(title,qid,answer):
 return {'title':title,'teams':['Team Rot','Team Blau'],'questions':[{
  'id':qid,'category':'Wissen','title':'Erste Frage','type':'text',
  'roundMode':'written','prompt':title+' – richtige Antwort?',
  'answer':answer,'points':100}]}

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':900},reduced_motion='reduce')
  page=await ctx.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('dialog',lambda d:asyncio.create_task(d.accept()))
  await install(page)

  await page.locator('[data-action="create-new-quiz"]').click()
  await page.locator('.se-board-context').wait_for()
  first=await active_board_id(page)
  await expect(page.locator('[data-action="save-board"]')).to_have_count(1)
  await expect(page.locator('[data-action="host-current-board"]')).to_have_count(1)
  # Empty quizzes can be saved as drafts but must never open an unusable lobby.
  await page.locator('[data-action="host-current-board"]').click()
  await expect(page.locator('#toaster')).to_contain_text('noch nicht bereit')
  assert await page.evaluate('window.__probe.room()')=='LOCAL'
  await page.evaluate('(q)=>window.__probe.setQuiz(q)',make_quiz('Quiz eins','q-one','Birne'))
  await page.locator('[data-action="save-board"]').click()
  await wait_board_saved(page)
  one=await read_board(page,first)
  assert one['quiz']['title']=='Quiz eins' and one['quiz']['questions'][0]['answer']=='Birne',one
  await page.locator('[data-action="back-to-quizzes"]').click()
  await expect(page.locator('.bq-saved-quiz')).to_have_count(1)
  assert await page.locator('.bq-saved-quiz-info strong').first.inner_text()=='Quiz eins'

  await page.locator('[data-action="create-new-quiz"]').click()
  await page.locator('.se-board-context').wait_for()
  second=await active_board_id(page)
  assert second!=first
  await page.evaluate('(q)=>window.__probe.setQuiz(q)',make_quiz('Quiz zwei','q-two','Apfel'))
  await page.locator('[data-action="save-board"]').click()
  await page.locator('[data-action="back-to-quizzes"]').click()
  await expect(page.locator('.bq-saved-quiz')).to_have_count(2)
  for width,height in [(390,844),(1366,900)]:
   await page.set_viewport_size({'width':width,'height':height})
   await expect(page.locator('.bq-saved-quiz-actions .btn.primary')).to_have_count(2)
   widths=await page.evaluate("""() => ({
    viewport:document.documentElement.clientWidth,
    content:document.documentElement.scrollWidth,
    quizButtons:[...document.querySelectorAll('.bq-saved-quiz-actions [data-action="host-saved-board"]')]
     .map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))
   })""")
   assert widths['content']<=widths['viewport']+8,'Quiz library overflows on '+str(width)+': '+str(widths)
   assert all(b['h']>=36 and b['w']>=75 for b in widths['quizButtons']),widths
   await page.screenshot(path=str(OUT/f'saved-quiz-picker-{width}x{height}.png'),full_page=True,animations='disabled')
  await page.set_viewport_size({'width':1366,'height':900})
  print('PASS saved quiz picker: both cards and lobby actions visible without horizontal overflow on desktop/mobile',flush=True)
  # Host the FIRST saved quiz, not the most recently edited second one.
  await page.locator(f'.bq-saved-quiz[data-saved-quiz-id="{first}"] [data-action="host-saved-board"]').click()
  await page.locator('.bq-host-lobby-summary').wait_for(timeout=15000)
  assert 'Quiz eins' in await page.locator('.bq-host-lobby-summary .bq-host-lobby-title').inner_text(), 'Hosted quiz title is not visible in lobby'
  info=await page.evaluate('window.__probe.info()')
  code=info['room']
  assert len(code)==16 and info['role']=='host'
  assert info['publicState']['published'] is True,info
  assert info['publicState']['title']=='Quiz eins',info
  actual=await page.evaluate('window.__probe.getQuiz()')
  assert actual['questions'][0]['id']=='q-one' and actual['questions'][0]['answer']=='Birne',actual
  await expect(page.locator('.top-nav [data-view="editor"]')).to_have_count(0)
  await expect(page.locator('[data-action="publish"]')).to_have_count(0)
  await expect(page.locator('[data-action="leave-host-room"]')).to_have_count(1)
  await expect(page.get_by_role('button',name='Lobby schließen')).to_have_count(1)
  await page.screenshot(path=str(OUT/'saved-quiz-host-lobby-desktop.png'),full_page=True,animations='disabled')
  saved_count=len(await read_boards(page))
  assert saved_count==2
  assert await page.evaluate('(r)=>localStorage.getItem("bq-published-"+r)',code)=='1'
  print('PASS: host selected saved quiz directly in team lobby; published lock and solutions remain host-only',flush=True)

  # A participant sees that room's teams and title but not private answer.
  # The PeerJS mock links separate real DOM windows through opener, just like
  # the existing multiplayer fixture; a detached ctx.new_page() cannot see it.
  async with ctx.expect_page() as opening:
   await page.evaluate("window.open('about:blank','_blank')")
  guest=await opening.value;guest.on('pageerror',lambda e:errors.append(str(e)))
  await install(guest)
  await guest.locator('#join-room').fill(code)
  await guest.locator('#join-name').fill('Alex')
  await guest.locator('#join-form button[type="submit"]').click()
  await expect(guest.locator('.bq-lobby-team')).to_have_count(2,timeout=15000)
  raw=await guest.evaluate('JSON.stringify(window.__probe.info())')
  assert 'Birne' not in raw and 'Apfel' not in raw,raw[:300]
  await guest.close()
  print('PASS: saved-quiz guest receives waiting lobby but no host-only question answers',flush=True)

  await page.locator('.top-nav [data-view="live"]').click()
  await page.locator('.bq-board-scene').wait_for()
  assert await page.locator('[data-qid="q-one"]').count()>=1
  assert await page.locator('[data-qid="q-two"]').count()==0
  await page.locator('.top-nav [data-view="teams"]').click()
  await page.get_by_role('button',name='Lobby schließen').click()
  await page.locator('[data-action="create-new-quiz"]').wait_for(timeout=12000)
  assert await page.evaluate('window.__probe.room()')==''
  assert await page.evaluate('localStorage.getItem("bq-last-host")') is None
  assert await page.evaluate('(r)=>localStorage.getItem("bq-published-"+r)',code) is None
  await expect(page.locator('.bq-saved-quiz')).to_have_count(2)
  assert (await read_board(page,first))['quiz']['questions'][0]['answer']=='Birne'
  print('PASS: cancelling a waiting lobby preserves both source quizzes and allows another room',flush=True)

  # Host from the editor itself; this must save before creating the room.
  await page.locator(f'.bq-saved-quiz[data-saved-quiz-id="{second}"] [data-action="open-landing-board"]').click()
  await page.locator('.se-board-context').wait_for()
  await page.locator('[data-action="host-current-board"]').click()
  await page.locator('.bq-host-lobby-summary').wait_for(timeout=15000)
  assert 'Quiz zwei' in await page.locator('.bq-host-lobby-summary .bq-host-lobby-title').inner_text(), 'Second hosted quiz title is not visible'
  again=await page.evaluate('window.__probe.info()')
  assert again['room']!=code and again['publicState']['title']=='Quiz zwei'
  assert (await page.evaluate('window.__probe.getQuiz()'))['questions'][0]['answer']=='Apfel'
  await expect(page.locator('.top-nav [data-view="editor"]')).to_have_count(0)
  print('PASS: one-click host from existing editor saves and loads exactly the current quiz',flush=True)

  # A forged command must not create a second room while one is already hosted.
  await page.evaluate("""(id)=>{
   const b=document.createElement('button');b.dataset.action='host-saved-board';
   b.dataset.boardId=id;document.body.append(b);b.click();
  }""",first)
  await page.wait_for_timeout(250)
  assert await page.evaluate('window.__probe.room()')==again['room']
  assert not errors,errors
  await browser.close()

if __name__=='__main__':asyncio.run(main())
