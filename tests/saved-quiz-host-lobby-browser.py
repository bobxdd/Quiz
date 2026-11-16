"""Saved-quiz-first host workflow: explicit save, library selection, one quiz per lobby.
Real Chromium DOM + existing mocked PeerJS transport; no real TURN/ICE claims.
"""
import asyncio,importlib.util,shutil
from pathlib import Path
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
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
  first=await page.evaluate('localStorage.getItem("bq-board-active-v1")')
  await expect(page.locator('[data-action="save-board"]')).to_have_count(1)
  await expect(page.locator('[data-action="host-current-board"]')).to_have_count(1)
  # Empty quizzes can be saved as drafts but must never open an unusable lobby.
  await page.locator('[data-action="host-current-board"]').click()
  assert await page.evaluate('window.__probe.room()')=='LOCAL'
  assert 'noch nicht bereit' in (await page.locator('#toaster').inner_text()).lower()
  await page.evaluate('(q)=>window.__probe.setQuiz(q)',make_quiz('Quiz eins','q-one','Birne'))
  await page.locator('[data-action="save-board"]').click()
  one=await page.evaluate("""(id)=>JSON.parse(localStorage.getItem('bq-board-workspace-'+id))""",first)
  assert one['quiz']['title']=='Quiz eins' and one['quiz']['questions'][0]['answer']=='Birne',one
  await page.locator('[data-action="back-to-quizzes"]').click()
  await expect(page.locator('.bq-saved-quiz')).to_have_count(1)
  assert await page.locator('.bq-saved-quiz-info strong').first.inner_text()=='Quiz eins'

  await page.locator('[data-action="create-new-quiz"]').click()
  await page.locator('.se-board-context').wait_for()
  second=await page.evaluate('localStorage.getItem("bq-board-active-v1")')
  assert second!=first
  await page.evaluate('(q)=>window.__probe.setQuiz(q)',make_quiz('Quiz zwei','q-two','Apfel'))
  await page.locator('[data-action="save-board"]').click()
  await page.locator('[data-action="back-to-quizzes"]').click()
  await expect(page.locator('.bq-saved-quiz')).to_have_count(2)
  # Host the FIRST saved quiz, not the most recently edited second one.
  await page.locator(f'.bq-saved-quiz[data-saved-quiz-id="{first}"] [data-action="host-saved-board"]').click()
  await page.locator('.bq-host-lobby-summary').wait_for(timeout=15000)
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
  saved_count=await page.evaluate('JSON.parse(localStorage.getItem("bq-board-workspaces-v1")).length')
  assert saved_count==2
  assert await page.evaluate('(r)=>localStorage.getItem("bq-published-"+r)',code)=='1'
  print('PASS: host selected saved quiz directly in team lobby; published lock and solutions remain host-only',flush=True)

  # A participant sees that room's teams and title but not private answer.
  guest=await ctx.new_page();guest.on('pageerror',lambda e:errors.append(str(e)))
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
  assert await page.evaluate('(id)=>JSON.parse(localStorage.getItem("bq-board-workspace-"+id)).quiz.questions[0].answer',first)=='Birne'
  print('PASS: cancelling a waiting lobby preserves both source quizzes and allows another room',flush=True)

  # Host from the editor itself; this must save before creating the room.
  await page.locator(f'.bq-saved-quiz[data-saved-quiz-id="{second}"] [data-action="open-landing-board"]').click()
  await page.locator('.se-board-context').wait_for()
  await page.locator('[data-action="host-current-board"]').click()
  await page.locator('.bq-host-lobby-summary').wait_for(timeout=15000)
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
