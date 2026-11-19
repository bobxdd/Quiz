"""Host-only field selection, shared guest buzzer rights and mandatory host judgement."""
import asyncio, importlib.util, re, threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.async_api import async_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('turn_rounds',ROOT/'tests/board-rounds-browser.py')
rounds=importlib.util.module_from_spec(spec)
spec.loader.exec_module(rounds)

def tile(page,points):
    return page.locator('.bq-board-scene [data-action="open"]').filter(has_text=str(points))

async def exercise(browser,root):
    context=await browser.new_context(viewport={'width':1440,'height':950},reduced_motion='reduce')
    await context.add_init_script(path=ROOT/'tests/mock-peerjs-browser.js')
    source=(ROOT/'docs/app.mjs').read_text(encoding='utf-8')
    source=source.replace('const studio=createStudioEditor(', 'window.__turnTest={game:()=>game,state:()=>structuredClone(publicState)};const studio=createStudioEditor(',1)
    async def route_app(route):
        await route.fulfill(status=200,content_type='text/javascript',body=source)
    await context.route('**/app.mjs',route_app)
    errors=[]
    context.on('page',lambda page:page.on('pageerror',lambda err:errors.append(str(err))))
    try:
        host=await context.new_page()
        dialogs=[]
        def accept_and_record(dialog):
            dialogs.append(dialog.message)
            asyncio.create_task(dialog.accept())
        host.on('dialog',accept_and_record)
        await host.goto(root)
        await host.locator('[data-action="create-new-quiz"]').click()
        await host.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
        await rounds.question(host,'Erstes Feld',100,'Antwort eins')
        await rounds.question(host,'Zweites Feld',200,'Antwort zwei')
        await host.locator('[data-se-action="board-round"][data-board-round="2"]').click()
        await host.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
        await rounds.question(host,'Drittes Feld',300,'Antwort drei')
        await host.locator('[data-action="host-current-board"]').click()
        await host.wait_for_url(re.compile(r'\?room=[A-Z2-9]{16}'))
        code=parse_qs(urlparse(host.url).query)['room'][0]
        players=[]
        for name,team in [('Anna','t1'),('Alina','t1'),('Ben','t2'),('Bea','t2')]:
            page=await context.new_page()
            await page.goto(root)
            await page.locator('#join-room').fill(code)
            await page.locator('#join-name').fill(name)
            await page.get_by_role('button',name='Beitreten',exact=True).click()
            await page.locator('[data-action="lobby-join"][data-team="'+team+'"]').click()
            await expect(page.locator('.bq-lobby-team.is-selected [data-team="'+team+'"]')).to_be_visible()
            await host.locator('.bq-host-join-request').filter(has_text=name).locator('[data-action="approve"]').click()
            await expect(page.locator('.role-caption')).to_have_text('Team '+team[-1])
            players.append(page)
        anna,alina,ben,bea=players
        await host.locator('[data-action="start-game"]').click()
        assert any('noch nicht bereit' in message for message in dialogs),dialogs
        await expect(host.locator('.bq-selection-turn')).to_contain_text('Host wählt')
        for guest in players:
            await expect(guest.locator('.bq-selection-turn')).to_contain_text('Host wählt')
            assert await guest.locator('.bq-board-scene [data-action="open"]').count()==0
            assert await guest.locator('.bq-board-scene [data-action="request-pick"]').count()==0
            assert await guest.locator('.bq-board-scene .tile').count()>0
        assert await host.locator('[data-action="skip-turn"]').count()==0
        qid=await tile(host,200).get_attribute('data-qid')
        denied=await ben.evaluate('''async ({qid})=>{try{await window.__turnTest.game()._rpc('pick',{qid,round:0});return 'allowed'}catch(err){return err.message}}''',{'qid':qid})
        assert 'Nur der Host' in denied,denied
        assert (await host.evaluate('window.__turnTest.state().questionPick')) is None
        await tile(host,200).click()
        for page in [host,*players]:
            await expect(page.locator('.bq-question-covered')).to_be_visible()
            await expect(page.locator('.bq-answer-view')).to_have_count(0)
        assert (await host.evaluate('window.__turnTest.state().deadline'))==0
        await host.locator('[data-action="uncover-question"]').click()
        await ben.locator('[data-action="buzz"]').click()
        await expect(host.locator('.bq-buzzer-winner')).to_contain_text('Ben')
        assert await host.locator('[data-action="reveal"]').is_disabled()
        assert await host.locator('[data-action="back"]').is_disabled()
        state=await host.evaluate('window.__turnTest.state()')
        assert state['scores']['t1']==0 and state['scores']['t2']==0,state['scores']
        for page in players:
            await expect(page.locator('[data-action="buzz"]')).to_be_disabled()
        await host.locator('[data-action="buzz-wrong"]').click()
        await expect(alina.locator('[data-action="buzz"]')).to_be_enabled()
        for page in [ben,bea]:
            await expect(page.locator('[data-action="buzz"]')).to_be_disabled()
        assert (await host.evaluate('window.__turnTest.state().scores.t2'))==-100
        await alina.locator('[data-action="buzz"]').click()
        await expect(host.locator('.bq-buzzer-winner')).to_contain_text('Alina')
        assert (await host.evaluate('window.__turnTest.state().scores.t1'))==0
        await host.locator('[data-action="buzz-correct"]').click()
        await expect(ben.locator('.bq-answer-view')).to_contain_text('Antwort zwei')
        await host.locator('[data-action="back"]').click()
        await expect(bea.locator('.bq-selection-turn')).to_contain_text('Host wählt')
        await expect(tile(host,100)).to_be_enabled()
        await tile(host,100).click()
        await host.locator('[data-action="uncover-question"]').click()
        await anna.locator('[data-action="buzz"]').click()
        await host.locator('[data-action="buzz-correct"]').click()
        await expect(bea.locator('.bq-answer-view')).to_contain_text('Antwort eins')
        await host.locator('[data-action="back"]').click()
        for page in [host,*players]:
            await expect(page.locator('.bq-board-scene .bq-eyebrow')).to_contain_text('RUNDE 2')
            await expect(page.locator('.bq-selection-turn')).to_contain_text('Host wählt')
            await expect(page.locator('.bq-score-footer')).to_contain_text('300')
            await expect(page.locator('.bq-score-footer')).to_contain_text('-100')
        await host.reload()
        await expect(host.locator('.bq-selection-turn')).to_contain_text('Host wählt',timeout=20000)
        await host.locator('.top-nav [data-view="setup"]').click()
        await host.locator('[data-action="reset-questions"]').click()
        await host.locator('.top-nav [data-view="teams"]').click()
        await host.locator('[data-action="start-game"]').click()
        await expect(anna.locator('.bq-board-scene .bq-eyebrow')).to_contain_text('RUNDE 1')
        assert (await host.evaluate('window.__turnTest.state().scores'))=={'t1':0,'t2':0}
        await tile(host,100).click()
        await host.locator('[data-action="uncover-question"]').click()
        await expect(host.locator('[data-action="cancel-question"]')).to_be_visible()
        await host.locator('[data-action="cancel-question"]').click()
        await expect(tile(host,100)).to_be_enabled()
        await expect(anna.locator('.bq-selection-turn')).to_contain_text('Host wählt')
        await tile(host,200).click()
        await host.locator('[data-action="uncover-question"]').click()
        await ben.locator('[data-action="buzz"]').click()
        await host.locator('[data-action="buzz-correct"]').click()
        await expect(anna.locator('.bq-answer-view')).to_contain_text('Antwort zwei')
        assert (await host.evaluate('window.__turnTest.state().scores.t2'))==200
        assert not errors,errors
        print('PASS: host-only selection, guest pick RPC rejected, unready-start consent, locked verdict, cancel question, shared buzzers, -50% penalty, board transition and reset',flush=True)
    finally:
        await context.close()

async def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),rounds.http.Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        async with async_playwright() as p:
            browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
            try:
                await exercise(browser,f'http://127.0.0.1:{server.server_port}/')
            finally:
                await browser.close()
    finally:
        server.shutdown()
        server.server_close()

if __name__=='__main__':
    asyncio.run(main())
