"""Visual usability regression: legible full answer, mobile touch targets,
score navigation, host/guest parity and no accidental solution reveal on rewind.
Mock PeerJS exercises actual DOM; external NAT/ICE is outside this audit.
"""
import asyncio
import importlib.util
import re
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('board_qa',ROOT/'tests/board-rounds-browser.py')
rounds=importlib.util.module_from_spec(spec)
spec.loader.exec_module(rounds)

EXPLANATION=('Diese Erklärung ist wichtig und darf auf kleinen Bildschirmen nicht verschwinden. ' * 20).strip()

async def audit(page,label,solved):
 report=await page.evaluate("""({solved})=>{
   const rect=s=>{const el=document.querySelector(s);if(!el)return null;
    const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
   const footer=rect('.bq-score-footer'),question=rect('.bq-question-panel'),
    answer=rect('.bq-answer-view');
   const controls=[...document.querySelectorAll('.bq-score-pager button')].map(e=>{
    const r=e.getBoundingClientRect();return {width:r.width,height:r.height,disabled:e.disabled}});
   const a=document.querySelector('.bq-answer-view');
   const exp=document.querySelector('.bq-answer-explanation');
   const state=window.__uxQA?.state?.()||{};
   return {viewport:{w:innerWidth,h:innerHeight},scrollW:document.documentElement.scrollWidth,
     footer,question,answer,controls,scorePager:!!document.querySelector('.bq-score-pager'),
     explanationDisplay:exp?getComputedStyle(exp).display:null,
     explanationLength:exp?.textContent.length||0,
     explanationScroll:!!a&&a.scrollHeight>a.clientHeight+3,
     visibleSolution:!!a,scoreMode:state.scoreMode||'team',
     teamCount:Object.keys(state.teams||{}).length,
     stageScroll:document.querySelector('.bq-question-panel .stage')?.scrollHeight,
     stageClient:document.querySelector('.bq-question-panel .stage')?.clientHeight};
 }""",{'solved':solved})
 assert report['scrollW']<=report['viewport']['w']+7,(label,'horizontal overflow',report)
 assert report['question'] and report['question']['width']>=170,(label,'lost question',report)
 assert report['question']['height']>=120,(label,'question shrunk to unreadable strip',report)
 assert report['footer'] and report['footer']['bottom']<=report['viewport']['h']+3,(label,'footer clipped',report)
 if report['scoreMode']=='team' and report['teamCount']>2 and report['viewport']['w']<470:
  assert report['scorePager'],(label,'five teams must have a visible score pager',report)
 for b in report['controls']:
  assert b['height']>=28 and b['width']>=28,(label,'score pager too small',report)
 if solved:
  assert report['visibleSolution'] and report['answer']['height']>=70,(label,'answer hidden',report)
  assert report['answer']['bottom']<=report['footer']['top']+5,(label,'answer hidden behind footer',report)
  assert report['explanationDisplay']!='none' and report['explanationLength']>=500,(label,'explanation discarded',report)
  if report['explanationScroll']:
   scroll=await page.locator('.bq-answer-view').evaluate("""el=>{
     el.scrollTop=el.scrollHeight;return {after:el.scrollTop,client:el.clientHeight,scroll:el.scrollHeight}}""")
   assert scroll['after']>0,(label,'answer explanation cannot scroll',report,scroll)
 return report

async def main():
 server=rounds.http.ThreadingHTTPServer(('127.0.0.1',0),rounds.http.Handler)
 threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
   ctx=await browser.new_context(viewport={'width':1366,'height':900},reduced_motion='reduce')
   await ctx.add_init_script(path=ROOT/'tests/mock-peerjs-browser.js')
   source=(ROOT/'docs/app.mjs').read_text(encoding='utf-8').replace(
     'const studio=createStudioEditor(',
     'window.__uxQA={question:()=>quiz.questions.at(-1),quiz:()=>quiz,save:()=>saveLocal(),state:()=>structuredClone(publicState)};const studio=createStudioEditor(',1)
   async def route_app(route):
    await route.fulfill(status=200,content_type='text/javascript',body=source)
   await ctx.route('**/app.mjs',route_app)
   errors=[]
   ctx.on('page',lambda page:page.on('pageerror',lambda e:errors.append(str(e))))
   try:
    host=await ctx.new_page()
    host.on('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
    await host.goto(f'http://127.0.0.1:{server.server_port}/')
    await host.locator('[data-action="create-new-quiz"]').click()
    await host.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
    await rounds.question(host,'Welches Bild passt zur richtigen Antwort?',400,'Die richtige Antwort ist C.')
    await host.evaluate("""explanation=>{
      const q=window.__uxQA.question(),quiz=window.__uxQA.quiz();
      quiz.teams=['Rot','Blau','Grün','Gelb','Violett'];
      q.scene=null;q.type='multiple';
      q.prompt='Welche der vier Möglichkeiten ist wirklich richtig?';
      q.options=['A: falsch','B: falsch','C: richtig','D: falsch'];
      q.correct=2;q.answerText='C: richtig';q.answer='C: richtig';
      q.explanation=explanation;
      window.__uxQA.save();
    }""",EXPLANATION)
    await host.locator('[data-action="host-current-board"]').click()
    await host.wait_for_url(re.compile(r'\?room=[A-Z2-9]{16}'))
    room=parse_qs(urlparse(host.url).query)['room'][0]
    guest=await ctx.new_page()
    await guest.goto(f'http://127.0.0.1:{server.server_port}/')
    await guest.locator('#join-room').fill(room)
    await guest.locator('#join-name').fill('Mobile-Test')
    await guest.get_by_role('button',name='Beitreten',exact=True).click()
    await guest.locator('[data-action="lobby-join"][data-team="t1"]').click()
    await host.locator('[data-action="approve"]').click()
    await expect(guest.locator('.role-caption')).to_have_text('Rot')
    await host.locator('[data-action="start-game"]').click()
    await rounds.choose(host,400)
    await host.locator('[data-action="uncover-question"]').click()
    for page,name in [(host,'host'),(guest,'guest')]:
     await expect(page.locator('.choices .choice')).to_have_count(4)
     assert await page.locator('.choices .choice.correct').count()==0,(name,'correct answer visible before solving')
     for w,h in [(320,568),(390,844),(768,720),(1280,720)]:
      await page.set_viewport_size({'width':w,'height':h})
      await audit(page,f'{name}-question-{w}x{h}',False)
    await guest.locator('[data-action="buzz"]').click()
    await host.locator('[data-action="buzz-correct"]').click()
    for page,name in [(host,'host'),(guest,'guest')]:
     await expect(page.locator('.bq-answer-view .bq-answer-explanation')).to_contain_text('Diese Erklärung ist wichtig')
     await expect(page.locator('.choices .choice.correct')).to_have_count(1)
     for w,h in [(320,568),(390,844),(768,720),(1280,720)]:
      await page.set_viewport_size({'width':w,'height':h})
      await audit(page,f'{name}-answer-{w}x{h}',True)
    await host.locator('[data-action="reveal-prev"]').click()
    for page in [host,guest]:
     await expect(page.locator('.choices .choice.correct')).to_have_count(0)
     await expect(page.locator('.bq-answer-view')).to_have_count(0)
    await host.locator('[data-action="solution-forward"]').click()
    for page in [host,guest]:
     await expect(page.locator('.choices .choice.correct')).to_have_count(1)
     await expect(page.locator('.bq-answer-explanation')).to_be_visible()
    assert not errors,errors
    print('PASS UX: full explanations and choices at 320/390/768/1280, 5-team score pager size, host/guest rewind hides correct answers',flush=True)
   finally:
    await ctx.close();await browser.close()
 finally:
  server.shutdown();server.server_close()

if __name__=='__main__':asyncio.run(main())
