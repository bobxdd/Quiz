"""Live-host UI lifecycle: accidental lobby exit, irreversible publication and session exit.
Uses the real app modules with the deterministic in-browser PeerJS fixture, not ICE/TURN.
"""
import asyncio,importlib.util
from pathlib import Path
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_install',ROOT/'tests/categories-3_0-browser.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
install=module.install

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1280,'height':850},reduced_motion='reduce')
  page=await ctx.new_page();errors=[]
  page.on('pageerror',lambda exc:errors.append(str(exc)))
  page.on('dialog',lambda dlg:asyncio.create_task(dlg.accept()))
  await install(page)

  if not await page.locator('.bq-legacy-options').evaluate('(e)=>e.open'):
   await page.locator('.bq-legacy-options>summary').click()
  await page.get_by_role('button',name='Online-Raum erstellen').click()
  await page.locator('.se-studio').wait_for(timeout=15000)
  old_room=await page.evaluate('window.__probe.room()')
  assert len(old_room)==16
  await expect(page.get_by_role('button',name='Lobby schließen')).to_have_count(1)
  assert await page.locator('.top-nav [data-view="editor"]').count()==1
  await page.get_by_role('button',name='Lobby schließen').click()
  await page.locator('.bq-legacy-options>summary').wait_for(timeout=12000)
  assert await page.evaluate('window.__probe.room()')==''
  assert await page.evaluate('localStorage.getItem("bq-last-host")') is None
  assert await page.evaluate('location.search')==''
  print('PASS accidental host lobby closes, guest room destroyed and start page restored',flush=True)

  if not await page.locator('.bq-legacy-options').evaluate('(e)=>e.open'):
   await page.locator('.bq-legacy-options>summary').click()
  await page.get_by_role('button',name='Online-Raum erstellen').click()
  await page.locator('.se-studio').wait_for(timeout=15000)
  new_room=await page.evaluate('window.__probe.room()')
  assert old_room!=new_room
  quiz={'title':'Publish Lock','teams':['Rot','Blau'],'questions':[{
   'id':'q-lock','category':'Allgemein','title':'Feste Frage','type':'text',
   'roundMode':'written','prompt':'Welche Antwort ist richtig?','answer':'42','points':100
  }]}
  await page.evaluate('(q)=>window.__probe.setQuiz(q)',quiz)
  await page.locator('[data-action="publish"]').first.click()
  await page.locator('.bq-board-scene').wait_for(timeout=12000)
  info=await page.evaluate('window.__probe.info().publicState')
  assert info['published'] is True
  await expect(page.locator('.top-nav [data-view="editor"]')).to_have_count(0)
  await expect(page.locator('[data-action="publish"]')).to_have_count(0)
  assert await page.evaluate('(room)=>localStorage.getItem("bq-published-"+room)',new_room)=='1'
  print('PASS publishing atomically locks the quiz editor and stores the committed state',flush=True)

  # Fabricated controls must not bypass the app's guard. The host may still
  # navigate presentation, team lobby, scores and settings.
  await page.evaluate("""()=>{
   const e=document.createElement('button');
   e.id='try-editor';e.dataset.action='view';e.dataset.view='editor';document.body.append(e);e.click();
  }""")
  await expect(page.locator('.bq-board-scene')).to_have_count(1)
  assert await page.locator('.se-studio').count()==0
  await page.evaluate("""()=>{
   const e=document.createElement('button');e.id='try-new-question';e.dataset.action='new-q';
   document.body.append(e);e.click();
  }""")
  await page.wait_for_timeout(250)
  result=await page.evaluate('window.__probe.getQuiz()')
  assert len(result['questions'])==1 and result['questions'][0]['id']=='q-lock'
  print('PASS hidden or injected editor actions cannot create questions after publication',flush=True)

  await page.evaluate("""()=>{
   const btn=document.createElement('button');btn.dataset.action='view';btn.dataset.view='present';
   document.body.append(btn);btn.click();btn.remove();
  }""")
  await expect(page.locator('.bq-board-scene')).to_be_visible()
  assert await page.get_by_role('button',name='Zurück zum Editor').count()==0
  assert await page.locator('[data-action="present-next"],[data-action="present-prev"]').count()==0
  await page.locator('.bq-board-scene').wait_for()
  await page.get_by_role('button',name='Lobby schließen').click()
  await page.locator('.bq-legacy-options>summary').wait_for(timeout=12000)
  assert await page.evaluate('window.__probe.room()')==''
  assert await page.evaluate('(r)=>localStorage.getItem("bq-published-"+r)',new_room) is None
  print('PASS published host game closes and a fresh lobby can be created',flush=True)
  assert not errors,errors
  await browser.close()

if __name__=='__main__':asyncio.run(main())
