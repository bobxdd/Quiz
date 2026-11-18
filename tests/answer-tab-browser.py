"""Chromium end-to-end: required Antwort editor tab, image picker/drag and text,
successful publish, privacy, host-authorized reveal, image-only and text-only,
responsive answer screen. PeerJS is simulated by browser fixture.
"""
import asyncio,base64,importlib.util,struct,zlib
from pathlib import Path
from playwright.async_api import async_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('answer_editor_fixture',ROOT/'tests/categories-3_0-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

def png(r,g,b):
 def chunk(tag,data):
  return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
 row=b'\0'+bytes([r,g,b,255])*2
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',2,2,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(row*2))+chunk(b'IEND',b'')

async def answer_tab(host,text='',color=(20,190,120),image=True):
 await host.locator('[data-se-action="editor-pane"][data-pane="answer"]').click()
 await expect(host.locator('.se-answer-tab-content')).to_be_visible()
 await expect(host.locator('#se-editor-tab-answer')).to_have_attribute('aria-selected','true')
 if text:
  await host.locator('#se-answer-text').fill(text)
  await host.locator('#se-answer-text').blur()
 if image:
  await host.locator('[data-se-upload="answer-image"]').set_input_files({'name':'answer.png','mimeType':'image/png','buffer':png(*color)})
  await expect(host.locator('.bq-answer-editor-preview .bq-answer-image img')).to_have_count(1,timeout=12000)
 await expect(host.locator('.se-answer-readiness.is-ready')).to_be_visible(timeout=12000)
 await expect(host.locator('.bq-answer-editor-preview')).to_be_visible()
 if text: await expect(host.locator('.bq-answer-editor-preview')).to_contain_text(text)
 await host.locator('[data-se-action="editor-pane"][data-pane="question"]').click()

async def unique_question(host,title,points):
 await host.locator('[data-se-field="title"]').fill(title)
 await host.locator('[data-se-field="title"]').blur()
 heading=host.locator('.se-canvas-top h2')
 await expect(heading).to_contain_text(title)
 await host.locator('[data-se-field="points"]').fill(str(points))
 await host.locator('[data-se-field="points"]').blur()
 await expect(heading).to_have_text(f'{title} · {points} Punkte')

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
  ctx=await browser.new_context(viewport={'width':1366,'height':850},reduced_motion='reduce')
  host=await ctx.new_page();errors=[]
  host.on('pageerror',lambda exc:errors.append('host '+str(exc)))
  await fixture.install(host)
  await host.locator('.bq-legacy-options>summary').click()
  await host.get_by_role('button',name='Online-Raum erstellen').click()
  await expect(host.locator('.se-category-overview')).to_be_visible(timeout=12000)
  room=await host.evaluate('window.__probe.room()')
  await host.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
  await host.locator('[data-se-action="new"][data-template="text"]').click()
  await host.locator('[data-se-action="editor-pane"][data-pane="answer"]').click()
  await expect(host.locator('.se-answer-readiness.is-missing')).to_be_visible()
  await expect(host.locator('#se-answer-text')).to_be_visible()
  assert (await host.evaluate("window.__probe.getQuiz().questions[0].answerImage")) == ''
  await host.locator('[data-action="publish"]').click()
  await expect(host.locator('.se-studio')).to_be_visible() # Blank answer must not publish
  await host.locator('[data-se-action="editor-pane"][data-pane="question"]').click()

  await unique_question(host,'Champions · 100',100)
  await answer_tab(host,'Anivia ist der Kryophönix.',(32,160,215),True)
  await host.locator('[data-se-action="new"]').first.click()
  await unique_question(host,'Champions · 200',200)
  await answer_tab(host,'',(178,73,92),True)
  await host.locator('[data-se-action="new"]').first.click()
  await unique_question(host,'Champions · 300',300)
  await answer_tab(host,'Nur Textantwort',image=False)
  ids=await host.evaluate("window.__probe.getQuiz().questions.map(x=>x.id)")
  assert len(ids)==3,ids
  authoring=await host.evaluate("window.__probe.getQuiz().questions.map(q=>({answer:q.answer,answerText:q.answerText,image:q.answerImage?.length||0}))")
  assert authoring[0]['image']>50 and authoring[0]['answerText']=='Anivia ist der Kryophönix.',authoring
  assert authoring[1]['image']>50 and not authoring[1]['answerText'] and not authoring[1]['answer'],authoring
  assert authoring[2]['image']==0 and authoring[2]['answerText']=='Nur Textantwort',authoring

  await host.locator('[data-action="publish"]').click()
  try:
   await expect(host.locator('.bq-board-scene .tile')).to_have_count(3,timeout=12000)
  except AssertionError:
   details={'toast':await host.locator('#toaster').inner_text(),
     'quiz':await host.evaluate("window.__probe.getQuiz().questions.map(q=>({title:q.title,points:q.points,prompt:q.prompt,answer:q.answer,answerText:q.answerText,answerImageLength:q.answerImage?.length,scene:q.scene?.template}))"),
     'errors':errors}
   raise AssertionError('Publishing question variants failed: '+str(details))
  await host.locator('.top-nav [data-view="teams"]').click()
  async with ctx.expect_page() as opening:
   await host.evaluate("window.open('about:blank','_blank')")
  guest=await opening.value
  guest.on('pageerror',lambda exc:errors.append('guest '+str(exc)))
  await fixture.install(guest)
  await guest.locator('#join-room').fill(room)
  await guest.locator('#join-name').fill('Alice')
  await guest.locator('button[type="submit"]').first.click()
  await guest.locator('.bq-lobby-notice').wait_for(timeout=12000)
  await host.locator('[data-action="approve"]').first.click()
  await guest.wait_for_function("() => window.__probe.info().member?.status==='approved'",timeout=12000)
  await host.locator('.top-nav [data-view="live"]').click()
  await host.locator('[data-action="open"][data-qid="'+ids[0]+'"]').click()
  await host.locator('[data-action="uncover-question"]').click()
  await guest.wait_for_function("(id) => window.__probe.info().publicState?.current?.id===id",arg=ids[0],timeout=12000)
  before=await guest.evaluate("window.__probe.info().publicState.current")
  assert 'answerImage' not in before and 'answerText' not in before and 'answer' not in before,before.keys()
  assert await guest.locator('.bq-answer-view').count()==0
  await guest.locator('[data-action="buzz"]').click()
  await host.locator('[data-action="buzz-correct"]').wait_for(timeout=12000)
  await host.locator('[data-action="buzz-correct"]').click()
  await host.wait_for_function("() => window.__probe.info().publicState?.phase==='answered'")
  assert 'answer' not in await host.evaluate("window.__probe.info().publicState.current")
  await host.locator('[data-action="reveal"]').click()
  for page in (host,guest):
   await page.wait_for_function("() => window.__probe.info().publicState?.phase==='reveal'",timeout=12000)
   await expect(page.locator('.bq-answer-view .bq-answer-image img')).to_be_visible()
   await expect(page.locator('.bq-answer-view .answer')).to_contain_text('Anivia ist der Kryophönix.')
   assert (await page.evaluate("window.__probe.info().publicState.current.answerImage")).startswith('data:image/')
  quiz_nav=guest.locator('.top-nav [data-view="play"]')
  await quiz_nav.focus()
  await guest.set_viewport_size({'width':390,'height':844})
  await guest.wait_for_function("""()=>{
   const box=document.querySelector('.bq-answer-view')?.getBoundingClientRect();
   return box && box.width>0 && box.left>=-2 && box.right<=392;
  }""")
  await expect(quiz_nav).to_be_focused()
  await host.locator('[data-action="back"]').click()
  await host.locator('[data-action="open"][data-qid="'+ids[1]+'"]').click()
  await host.locator('[data-action="uncover-question"]').click()
  await guest.wait_for_function("(id) => window.__probe.info().publicState?.current?.id===id",arg=ids[1],timeout=12000)
  assert 'answerImage' not in await guest.evaluate("window.__probe.info().publicState.current")
  await host.locator('[data-action="reveal"]').click()
  await guest.wait_for_function("() => window.__probe.info().publicState?.phase==='reveal'",timeout=12000)
  await expect(guest.locator('.bq-answer-view .bq-answer-image img')).to_be_visible()
  assert await guest.locator('.bq-answer-view .answer').count()==0,'Image-only answer does not require text'
  await host.locator('[data-action="back"]').click()
  await host.locator('[data-action="open"][data-qid="'+ids[2]+'"]').click()
  await host.locator('[data-action="uncover-question"]').click()
  await host.locator('[data-action="reveal"]').click()
  await guest.wait_for_function("() => window.__probe.info().publicState?.phase==='reveal'",timeout=12000)
  await expect(guest.locator('.bq-answer-view .answer')).to_contain_text('Nur Textantwort')
  assert await guest.locator('.bq-answer-view .bq-answer-image img').count()==0
  assert not errors,errors
  await browser.close()
  print('PASS: required editor answer tab, blocked missing answer, text/image/both publishing, guest secrecy, auto/manual reveal and mobile')

if __name__=='__main__':asyncio.run(main())
