"""Full editor QoL audit in Chromium: live preview, keyboard tabs, clipboard images,
readiness icons, error navigation on failed publish, accessible panels, mobile,
and successful publication after repairing mandatory answers.
"""
import asyncio,base64,importlib.util,struct,zlib
from pathlib import Path
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bq_qol_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

def png(r,g,b):
 def chunk(tag,data):
  return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
 row=b'\0'+bytes([r,g,b,255])*2
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',2,2,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(row*2))+chunk(b'IEND',b'')

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  page=await browser.new_page(viewport={'width':1366,'height':900},reduced_motion='reduce')
  exceptions=[];page.on('pageerror',lambda e:exceptions.append(str(e)))
  await fixture.install(page)
  await page.locator('.bq-legacy-options>summary').click()
  await page.get_by_role('button',name='Online-Raum erstellen').click()
  await expect(page.locator('.se-category-overview')).to_be_visible(timeout=12000)
  await page.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
  await page.locator('[data-se-action="new"][data-template="text"]').click()
  await expect(page.locator('.se-q-status.is-incomplete')).to_have_count(1)
  await page.locator('#se-editor-tab-question').focus()
  await page.locator('#se-editor-tab-question').press('ArrowRight')
  await expect(page.locator('#se-editor-tab-answer')).to_be_focused()
  await expect(page.locator('.se-answer-tab-content')).to_be_visible()
  assert await page.evaluate("""() => [...document.querySelectorAll('.se-editor-pane-tabs [role=tab]')].every(t=>!!document.getElementById(t.getAttribute('aria-controls')))""")
  await page.locator('#se-editor-tab-answer').press('ArrowLeft')
  await expect(page.locator('#se-editor-tab-question')).to_be_focused()
  await page.locator('#se-editor-tab-question').press('End')
  await expect(page.locator('#se-editor-tab-answer')).to_be_focused()
  print('PASS: keyboard ArrowRight/ArrowLeft/End preserves focus and each tab controls a real panel')

  await page.locator('#se-answer-text').fill('Sofortige Antwortvorschau')
  await expect(page.locator('.bq-answer-editor-preview .bq-answer-primary')).to_contain_text('Sofortige Antwortvorschau')
  await expect(page.locator('#se-answer-text')).to_be_focused()
  await expect(page.locator('.se-answer-readiness.is-ready')).to_be_visible()
  await page.locator('#se-answer-text').fill('')
  await expect(page.locator('.se-answer-readiness.is-missing')).to_be_visible()
  await expect(page.locator('.se-answer-warning')).to_be_visible()
  print('PASS: instant answer preview/status while typing and clearing, no focus/caret loss')

  await page.locator('[data-se-upload="answer-image"]').set_input_files({
   'name':'winter_champion.png','mimeType':'image/png','buffer':png(12,56,190)})
  await expect(page.locator('.bq-answer-editor-preview .bq-answer-image img')).to_be_visible()
  await expect(page.locator('[data-se-field="answerImageAlt"]')).to_have_value('winter champion')
  await expect(page.locator('.se-answer-readiness.is-ready')).to_be_visible()
  await page.locator('[data-se-action="answer-image-remove"]').click()
  await expect(page.locator('.se-answer-readiness.is-missing')).to_be_visible()
  assert (await page.evaluate("() => ({img:window.__probe.getQuiz().questions[0].answerImage,alt:window.__probe.getQuiz().questions[0].answerImageAlt})")) == {'img':'','alt':''}
  print('PASS: image upload offers editable filename alt; removal clears both image and obsolete alt')

  payload=base64.b64encode(png(63,160,70)).decode()
  await page.evaluate("""(base64)=>{
   const image=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
   const dt=new DataTransfer();dt.items.add(new File([image],'pasted.png',{type:'image/png'}));
   const ev=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});
   const target=document.querySelector('#se-answer-text');
   if(!target.dispatchEvent(ev))return;
   throw Error('Image paste was not intercepted by the answer editor');
  }""",payload)
  await expect(page.locator('.bq-answer-editor-preview .bq-answer-image img')).to_be_visible(timeout=15000)
  await expect(page.locator('[data-se-field="answerImageAlt"]')).to_have_value('pasted')
  await expect(page.locator('.se-q-status.is-complete')).to_have_count(1)
  print('PASS: screenshot pasted from clipboard becomes a saved, optimized answer image')

  await page.locator('[data-se-action="category-overview"]').first.click()
  await page.locator('[data-se-action="category-preset"][data-category="Items"]').click()
  await page.locator('[data-se-action="new"][data-template="text"]').click()
  await expect(page.locator('.se-q-status.is-incomplete')).to_have_count(1)
  second=await page.evaluate("window.__probe.getQuiz().questions[1].id")
  # Invalid published quiz must bring the host directly to this category and its mandatory Answer tab.
  await page.locator('[data-action="publish"]').click()
  await expect(page.locator('.se-answer-tab-content')).to_be_visible(timeout=12000)
  await expect(page.locator('.se-audit')).to_be_visible(timeout=12000)
  assert await page.locator('.se-qrow.is-active').get_attribute('data-id') == second
  await page.locator('[data-se-action="open-next-issue"]').click()
  await expect(page.locator('.se-answer-tab-content')).to_be_visible()
  assert await page.locator('.se-qrow.is-active').get_attribute('data-id') == second
  print('PASS: blocked publish and Quizcheck navigate to exact incomplete question and answer tab')

  await page.set_viewport_size({'width':390,'height':844})
  widths=await page.evaluate("()=>({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})")
  assert widths['content']<=widths['viewport']+8,widths
  await expect(page.locator('.se-answer-tab-content')).to_be_visible()
  await page.locator('#se-answer-text').fill('Korrekte Item-Antwort')
  await expect(page.locator('.bq-answer-editor-preview .bq-answer-primary')).to_contain_text('Korrekte Item-Antwort')
  await expect(page.locator('.se-answer-readiness.is-ready')).to_be_visible()
  await page.locator('#se-answer-text').blur()
  await page.set_viewport_size({'width':1366,'height':900})
  await page.locator('[data-action="publish"]').click()
  await expect(page.locator('.bq-board-scene .tile')).to_have_count(2,timeout=12000)
  assert not exceptions,exceptions
  print('PASS: 390px responsive answer tab and repaired quiz publishes without browser exceptions')
  await browser.close()

if __name__=='__main__':asyncio.run(main())
