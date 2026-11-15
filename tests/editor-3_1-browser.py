"""Real Chromium UI verification for BrainQuiz 3.1; PeerJS signaling mocked only.
Tests batch edit, undo/redo, bank reuse, preview, publish audit, responsive layout.
"""
import asyncio, importlib.util, shutil
from pathlib import Path
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_categories_test',root/'tests/categories-3_0-browser.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
install=module.install

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--no-proxy-server'])
  context=await browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
  page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await install(page)
  await page.get_by_role('button',name='Online-Raum erstellen').click()
  await page.locator('.se-category-overview').wait_for(timeout=12000)
  await page.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
  await page.locator('[data-se-action="new"][data-template="text"]').click()
  await page.locator('.se-scene').wait_for()
  await page.locator('[data-se-field="title"]').fill('Wer ist das?');await page.locator('[data-se-field="title"]').blur()
  await page.wait_for_timeout(600)
  await page.locator('.se-add-question').click()
  await page.locator('.se-qrow').nth(1).wait_for()
  old=await page.evaluate('window.__probe.getQuiz()')
  assert len(old['questions'])==2
  await page.locator('.se-qpick input').nth(0).check()
  await page.locator('.se-qpick input').nth(1).check()
  await page.locator('.se-batch strong').get_by_text('2 ausgewählt').wait_for(timeout=10000)
  await page.locator('[data-se-batch-points]').fill('400')
  await page.locator('[data-se-action="batch-apply"]').click()
  await page.wait_for_timeout(100)
  after=await page.evaluate('window.__probe.getQuiz()')
  assert [q['points'] for q in after['questions']]==[400,400],after
  await page.locator('[data-se-action="undo"]').click();await page.wait_for_timeout(100)
  undo=await page.evaluate('window.__probe.getQuiz()')
  assert [q['points'] for q in undo['questions']]==[100,100],undo
  await page.locator('[data-se-action="redo"]').click();await page.wait_for_timeout(100)
  assert all(q['points']==400 for q in (await page.evaluate('window.__probe.getQuiz()'))['questions'])
  print('PASS: multi-select, one snapshot, undo/redo')
  await page.locator('[data-se-action="category-overview"]').first.click()
  await page.locator('[data-se-action="category-preset"][data-category="Lorefragen"]').click()
  await page.locator('.se-question-bank summary').click()
  await page.locator('.se-question-bank [data-se-action="reuse-question"]').first.click()
  await page.locator('.se-scene').wait_for()
  reused=await page.evaluate('window.__probe.getQuiz()')
  assert len(reused['questions'])==3 and reused['questions'][-1]['category']=='Lorefragen' and reused['questions'][-1]['id'] not in [q['id'] for q in old['questions']],reused
  assert len(reused['questions'][0]['answer'])==len(old['questions'][0]['answer'])
  print('PASS: question bank creates independent copy in selected category')
  await page.locator('[data-se-action="toggle-preview"]').click()
  await page.locator('.se-audience-preview').wait_for();assert await page.locator('.se-audience-label').count()==1
  await page.locator('[data-se-action="preview-device"]').click();await page.locator('.se-audience-mobile').wait_for()
  await page.locator('[data-se-action="toggle-preview"]').click()
  await page.locator('[data-se-action="audit"]').click();await page.locator('.se-audit').wait_for()
  assert await page.locator('.se-audit').get_by_text('Fehler',exact=False).count()>=1
  assert not (await page.locator('.se-save-badge').inner_text()).startswith('●')
  (root/'screenshots').mkdir(exist_ok=True)
  await page.screenshot(path=str(root/'screenshots/Vorschau_3_1_Editor_Desktop.png'),full_page=True)
  for w,h in [(390,780),(768,850)]:
   await page.set_viewport_size({'width':w,'height':h});await page.wait_for_timeout(100)
   widths=await page.evaluate('''()=>({page:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})''')
   assert widths['content']<=widths['page']+8,widths
   if w==390:
    await page.locator('[data-se-action="mobile-tab"][data-mobile-tab="categories"]').click()
    await page.locator('.se-editor-v3 .se-list').wait_for(state='visible',timeout=5000)
    assert not await page.locator('.se-editor-v3 .se-main').is_visible()
    await page.locator('[data-se-action="mobile-tab"][data-mobile-tab="properties"]').click()
    await page.locator('.se-editor-v3 .se-inspector').wait_for(state='visible',timeout=5000)
    await page.locator('[data-se-action="mobile-tab"][data-mobile-tab="canvas"]').click()
    await page.locator('.se-editor-v3 .se-main').wait_for(state='visible',timeout=5000)
  await page.screenshot(path=str(root/'screenshots/Vorschau_3_1_Editor_Mobil.png'),full_page=True)
  assert not errors,errors
  print('PASS: audience preview, quizcheck, save badge, mobile viewport, no JS exceptions')
  await browser.close()
if __name__=='__main__':asyncio.run(main())
