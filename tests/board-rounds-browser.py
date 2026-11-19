"""Two authored boards, host-controlled uncovering, carried scores and board-based rehearsal."""
import asyncio
import importlib.util
import re
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect
from board_library_test_support import read_boards, wait_board_saved

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('emoji_http',ROOT/'tests/team-emoji-browser.py')
http=importlib.util.module_from_spec(spec)
spec.loader.exec_module(http)


async def question(page,title,points,answer):
    await page.locator('[data-se-action="new"]').first.click()
    for field,value in [('title',title),('points',str(points))]:
        control=page.locator('[data-se-field="'+field+'"]')
        await control.fill(value)
        await control.blur()
    await expect(page.locator('.se-canvas-top h2')).to_have_text(f'{title} · {points} Punkte')
    await page.locator('[data-se-action="editor-pane"][data-pane="answer"]').click()
    await page.locator('#se-answer-text').fill(answer)
    await page.locator('#se-answer-text').blur()
    await expect(page.locator('.se-answer-readiness.is-ready')).to_be_visible()
    await page.locator('[data-se-action="editor-pane"][data-pane="question"]').click()


def tile(page,points):
    return page.locator('.bq-board-scene [data-action="open"]').filter(has_text=str(points))


async def choose(page,points):
    await tile(page,points).click()
    await expect(page.locator('.bq-question-covered')).to_be_visible()
    await expect(page.locator('.bq-question-panel')).to_have_count(0)


async def run(browser,root):
    context=await browser.new_context(viewport={'width':1440,'height':950},reduced_motion='reduce')
    await context.add_init_script(path=ROOT/'tests/mock-peerjs-browser.js')
    errors=[]
    context.on('page',lambda page:page.on('pageerror',lambda err:errors.append(str(err))))
    host=await context.new_page()
    host.on('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
    await host.goto(root)
    await host.locator('[data-action="create-new-quiz"]').click()
    await host.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
    await question(host,'Erstes Feld',100,'Geheime Antwort eins')
    await question(host,'Zweites Feld',200,'Geheime Antwort zwei')
    # Move a complete category from the sidebar, then undo and redo the single edit.
    round_button=lambda number:host.locator(f'[data-se-action="board-round"][data-board-round="{number}"]')
    champion_nav=host.locator('.se-category-navrow[data-category="Champions"]')
    await champion_nav.click(button='right')
    await host.get_by_role('menuitem',name='Nach Runde 2 verschieben').click()
    await expect(champion_nav).to_have_count(0)
    await host.keyboard.press('Control+z')
    await expect(champion_nav).to_have_count(1)
    await expect(round_button(1)).to_contain_text('2/36 Fragen')
    await host.keyboard.press('Control+Shift+z')
    await expect(champion_nav).to_have_count(0)
    await round_button(2).click()
    await expect(round_button(2)).to_contain_text('2/36 Fragen')
    card=host.locator('.se-category-card[data-category="Champions"] .se-category-open')
    await card.focus()
    await host.keyboard.press('Shift+F10')
    await expect(host.get_by_role('menuitem',name='Nach Runde 1 verschieben')).to_be_visible()
    await host.keyboard.press('Escape')
    await expect(card).to_be_focused()
    await card.click(button='right')
    await host.get_by_role('menuitem',name='Nach Runde 1 verschieben').click()
    await expect(round_button(1)).to_contain_text('2/36 Fragen')
    await expect(round_button(2)).to_contain_text('0/36 Fragen')
    print('PASS: category moves both ways from the context menu, keyboard focus and undo/redo',flush=True)
    await host.locator('[data-se-action="board-round"][data-board-round="2"]').click()
    await host.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
    await question(host,'Drittes Feld',300,'Geheime Antwort drei')
    await host.locator('[data-action="save-board"]').click()
    await wait_board_saved(host)
    saved=await read_boards(host, load_records=True)
    await host.locator('[data-action="editor-probe"]').click()
    await expect(host.locator('.bq-board-scene .tile')).to_have_count(2)
    await choose(host,200)
    await host.locator('[data-action="uncover-question"]').click()
    await host.locator('[data-action="probe-buzz"]').first.click()
    await host.locator('[data-action="probe-correct"]').click()
    await expect(host.locator('.bq-answer-view')).to_contain_text('Geheime Antwort zwei')
    await host.locator('[data-action="back"]').click()
    await expect(host.locator('.bq-board-scene')).to_be_visible()
    await choose(host,100)
    await host.locator('[data-action="uncover-question"]').click()
    await host.locator('[data-action="reveal"]').click()
    await host.locator('[data-action="back"]').click()
    await expect(host.locator('.bq-board-scene .bq-eyebrow')).to_contain_text('RUNDE 2')
    await expect(host.locator('.bq-score-footer')).to_contain_text('200')
    await expect(tile(host,300)).to_be_visible()
    assert await host.locator('[data-action="present-next"]').count()==0
    await host.locator('.bq-rehearsal-toolbar [data-view="editor"]').click()
    assert await read_boards(host, load_records=True)==saved
    print('PASS: round authoring, arbitrary board choice, covered rehearsal and retained rehearsal points',flush=True)

    await host.locator('[data-action="host-current-board"]').click()
    await host.wait_for_url(re.compile(r'\?room=[A-Z2-9]{16}'))
    code=parse_qs(urlparse(host.url).query)['room'][0]
    guest=await context.new_page()
    await guest.set_viewport_size({'width':390,'height':844})
    await guest.goto(root)
    await guest.locator('#join-room').fill(code)
    await guest.locator('#join-name').fill('Alice')
    await guest.get_by_role('button',name='Beitreten',exact=True).click()
    await host.locator('[data-action="approve"]').click()
    await expect(guest.locator('.role-caption')).to_have_text('Team 1')
    await host.locator('[data-action="start-game"]').click()
    for points in [200,100]:
        await choose(host,points)
        await expect(guest.locator('.bq-question-covered')).to_be_visible()
        assert await guest.locator('[data-action="buzz"]').count()==0
        await expect(guest.locator('body')).not_to_contain_text('Geheime Antwort')
        await host.locator('[data-action="uncover-question"]').click()
        await guest.locator('[data-action="buzz"]').click()
        await host.locator('[data-action="buzz-correct"]').click()
        await expect(guest.locator('.bq-answer-view')).to_be_visible()
        await host.locator('[data-action="back"]').click()
        await expect(guest.locator('.bq-board-scene')).to_be_visible()
    for page in [host,guest]:
        await expect(page.locator('.bq-board-scene .bq-eyebrow')).to_contain_text('RUNDE 2')
        await expect(page.locator('.bq-score-footer')).to_contain_text('300')
        await expect(page.locator('.bq-board-scene .tile')).to_have_count(1)
    await choose(host,300)
    await host.reload()
    await expect(host.locator('.bq-question-covered')).to_be_visible(timeout=20000)
    await host.locator('[data-action="uncover-question"]').click()
    await host.locator('[data-action="reveal"]').click()
    await expect(guest.locator('.bq-answer-view')).to_contain_text('Geheime Antwort drei',timeout=20000)
    await host.locator('[data-action="back"]').click()
    await expect(guest.locator('.bq-board-scene')).to_be_visible()
    assert not errors,errors
    print('PASS: two-player round carryover, explicit question reveal, automatic correct solution and covered host recovery',flush=True)
    await context.close()



async def limits(browser,root):
    context=await browser.new_context(viewport={'width':1440,'height':950},reduced_motion='reduce')
    try:
        page=await context.new_page()
        await page.goto(root)
        await page.locator('[data-action="create-new-quiz"]').click()
        await page.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
        for n in range(1,7):
            await question(page,f'Feld {n}',n*100,f'Antwort {n}')
        await expect(page.locator('.se-qrow')).to_have_count(6)
        for action in ['copy-q','new']:
            await page.locator('[data-se-action="'+action+'"]').first.click()
            await expect(page.locator('#toaster')).to_contain_text('sechs Fragen')
            await expect(page.locator('.se-qrow')).to_have_count(6)
        await page.locator('[data-se-action="board-round"][data-board-round="2"]').click()
        await page.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
        await question(page,'Zweite Runde',100,'Antwort')
        await expect(page.locator('.se-qrow')).to_have_count(1)
        await page.locator('[data-se-action="board-round"][data-board-round="1"]').click()
        await page.locator('[data-se-action="category-select"][data-category="Champions"]').first.click()
        await expect(page.locator('.se-qrow')).to_have_count(6)
        await page.locator('.se-category-navrow[data-category="Champions"]').click(button='right')
        await page.get_by_role('menuitem',name='Nach Runde 2 verschieben').click()
        await expect(page.locator('#toaster')).to_contain_text('höchstens sechs Fragen')
        await expect(page.locator('.se-qrow')).to_have_count(6)
        print('PASS: rapid six-question editing, create/duplicate capacity guards and independent second-round category',flush=True)
    finally:
        await context.close()


async def main():
    server=http.ThreadingHTTPServer(('127.0.0.1',0),http.Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        async with async_playwright() as p:
            browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
            try:
                await run(browser,f'http://127.0.0.1:{server.server_port}/')
                await limits(browser,f'http://127.0.0.1:{server.server_port}/')
            finally:
                await browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__=='__main__':
    asyncio.run(main())
