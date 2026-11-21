"""Real Chromium host/guest viewport and reversible imposter reveal regression.
   Uses mocked signaling because actual cross-network ICE is tested separately.
"""
import asyncio
import importlib.util
import re
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('board_qa', ROOT / 'tests/board-rounds-browser.py')
rounds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rounds)

PIXEL = ('data:image/png;base64,'
 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==')

async def fit(page):
    return await page.locator('.bq-question-panel .se-scene').evaluate("""scene => {
      const stage = scene.closest('.bq-question-panel');
      const box = scene.getBoundingClientRect();
      const rect = stage.getBoundingClientRect();
      const content = stage.querySelector('.bq-scene-content');
      return {top: box.top, bottom: box.bottom, left: box.left, right: box.right,
       outerTop: rect.top, outerBottom: rect.bottom, client: content.clientHeight,
       scroll: content.scrollHeight, viewport: innerHeight, sceneHeight: box.height};
    }""")

async def assert_fits(page, label):
    metrics = await fit(page)
    assert metrics['top'] >= metrics['outerTop'] - 3, (label, metrics)
    assert metrics['bottom'] <= metrics['outerBottom'] + 3, (label, metrics)
    assert metrics['bottom'] <= metrics['viewport'] + 2, (label, metrics)
    assert metrics['scroll'] <= metrics['client'] + 3, (label, metrics)
    assert metrics['sceneHeight'] >= 110, (label, metrics)

async def run(browser, origin):
    context = await browser.new_context(viewport={'width':1716, 'height':928}, reduced_motion='reduce')
    await context.add_init_script(path=ROOT / 'tests/mock-peerjs-browser.js')
    source = (ROOT / 'docs/app.mjs').read_text(encoding='utf-8').replace(
      'const studio=createStudioEditor(',
      'window.__screenQA={current:()=>quiz.questions.at(-1),save:()=>saveLocal(),state:()=>structuredClone(publicState)};const studio=createStudioEditor(',1)
    async def route_app(route):
        await route.fulfill(status=200, content_type='text/javascript', body=source)
    await context.route('**/app.mjs', route_app)
    errors = []
    context.on('page', lambda p: p.on('pageerror', lambda err: errors.append(str(err))))
    try:
        host = await context.new_page()
        host.on('dialog', lambda dialog: asyncio.create_task(dialog.accept()))
        await host.goto(origin)
        await host.locator('[data-action="create-new-quiz"]').click()
        await host.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
        await rounds.question(host,'E-Icon herausfinden',400,'Die E-Fähigkeit wurde ausgetauscht.')
        await host.evaluate("""async pixel => {
          const {templateScene,reconcileQuestion}=await import('/studio-model.mjs');
          const q=window.__screenQA.current();
          q.type='imposter';q.imposterIndex=3;q.correctIcon=pixel;q.icons=Array(5).fill(pixel);
          q.abilityNames=['Passiv','Q','W','E','R'];
          q.scene=templateScene('imposter',{prompt:'Welches Icon wurde ausgetauscht?',icons:q.icons,abilityNames:q.abilityNames});
          reconcileQuestion(q);
          window.__screenQA.save();
        }""", PIXEL)
        await host.locator('[data-action="host-current-board"]').click()
        await host.wait_for_url(re.compile(r'\?room=[A-Z2-9]{16}'))
        room = parse_qs(urlparse(host.url).query)['room'][0]

        guest = await context.new_page()
        await guest.set_viewport_size({'width':390,'height':844})
        await guest.goto(origin)
        await guest.locator('#join-room').fill(room)
        await guest.locator('#join-name').fill('Viewport')
        await guest.get_by_role('button',name='Beitreten',exact=True).click()
        await host.locator('[data-action="approve"]').click()
        await expect(guest.locator('.role-caption')).to_have_text('Team 1')
        await host.locator('[data-action="start-game"]').click()
        await rounds.choose(host,400)
        await host.locator('[data-action="uncover-question"]').click()
        for page in [host,guest]:
            await expect(page.locator('.bq-question-panel .se-kind-image')).to_have_count(5)
            await expect(page.locator('.bq-answer-view')).to_have_count(0)
        await assert_fits(host,'host opened desktop')
        await assert_fits(guest,'guest opened mobile')

        await guest.locator('[data-action="buzz"]').click()
        await host.locator('[data-action="buzz-correct"]').click()
        for page in [host,guest]:
            await expect(page.locator('.bq-answer-view')).to_contain_text('Die E-Fähigkeit wurde ausgetauscht.')
            await expect(page.locator('.se-imposter-image')).to_have_count(1)
            await expect(page.locator('.bq-answer-image img')).to_have_count(1)
        await assert_fits(host,'host solved desktop')
        await assert_fits(guest,'guest solved mobile')
        previous = await host.evaluate('window.__screenQA.state().scores')
        await host.locator('[data-action="reveal-prev"]').click()
        for page in [host,guest]:
            await expect(page.locator('.bq-answer-view')).to_have_count(0)
            await expect(page.locator('.se-imposter-image')).to_have_count(0)
            await expect(page.locator('.se-kind-image')).to_have_count(5)
        state = await host.evaluate('window.__screenQA.state()')
        assert state['scores'] == previous and state['phase'] == 'reveal',state
        await host.locator('[data-action="solution-forward"]').click()
        for page in [host,guest]:
            await expect(page.locator('.bq-answer-view')).to_be_visible()
            await expect(page.locator('.se-imposter-image')).to_have_count(1)

        await host.set_viewport_size({'width':1280,'height':720})
        await expect(host.locator('.bq-question-panel .se-scene')).to_be_visible(timeout=7000)
        await assert_fits(host,'host solved laptop')
        await host.locator('[data-action="back"]').click()
        await expect(guest.locator('.bq-board-scene')).to_be_visible()
        assert not errors, errors
        print('PASS: one-screen imposter question at desktop/mobile/laptop, original wrong icon framed, correct icon+answer shown, synchronized rewind keeps score',flush=True)
    finally:
        await context.close()

async def main():
    server = rounds.http.ThreadingHTTPServer(('127.0.0.1',0),rounds.http.Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
            try:
                await run(browser,f'http://127.0.0.1:{server.server_port}/')
            finally:
                await browser.close()
    finally:
        server.shutdown()
        server.server_close()

if __name__ == '__main__':
    asyncio.run(main())
