"""End-to-end Chromium coverage for recovery UX, join errors and host transport restart.
Uses an in-page PeerJS mock; external CGNAT/TURN interoperability is documented separately.
"""
import asyncio
import importlib.util
import re
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('board_helper',ROOT/'tests/board-rounds-browser.py')
rounds=importlib.util.module_from_spec(spec)
spec.loader.exec_module(rounds)

async def main():
 server=rounds.http.ThreadingHTTPServer(('127.0.0.1',0),rounds.http.Handler)
 threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(args=['--no-sandbox','--no-proxy-server'])
   context=await browser.new_context(viewport={'width':1280,'height':820},reduced_motion='reduce')
   await context.add_init_script(path=ROOT/'tests/mock-peerjs-browser.js')
   source=(ROOT/'docs/app.mjs').read_text(encoding='utf-8').replace(
    'const studio=createStudioEditor(',
    'window.__netQA={game:()=>game,report:()=>connectionReport()};const studio=createStudioEditor(',1)
   async def route_app(route):
    await route.fulfill(status=200,content_type='text/javascript',body=source)
   await context.route('**/app.mjs',route_app)
   errors=[]
   context.on('page',lambda page:page.on('pageerror',lambda err:errors.append(str(err))))
   root=f'http://127.0.0.1:{server.server_port}/'
   try:
    missing=await context.new_page()
    await missing.goto(root)
    await missing.locator('#join-room').fill('ZZZZZZZZZZZZZZZZ')
    await missing.locator('#join-name').fill('Testgast')
    await missing.locator('#join-form button[type="submit"]').click()
    await expect(missing.locator('.bq-join-error')).to_contain_text('Host')
    await expect(missing.locator('#join-room')).to_have_value('ZZZZZZZZZZZZZZZZ')
    await expect(missing.locator('#join-form button[type="submit"]')).to_be_enabled()
    assert await missing.locator('.bq-join-error').count()==1
    await missing.close()
    print('PASS: missing room is distinguished from occupied ID, stays visible inline and join can be retried',flush=True)

    host=await context.new_page()
    host.on('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
    await host.goto(root)
    await host.locator('[data-action="create-new-quiz"]').click()
    await host.locator('[data-se-action="category-preset"][data-category="Champions"]').click()
    await rounds.question(host,'Host-Netzwerkcheck',100,'Antwort')
    await host.locator('[data-action="host-current-board"]').click()
    await host.wait_for_url(re.compile(r'\?room=[A-Z2-9]{16}'))
    room=parse_qs(urlparse(host.url).query)['room'][0]

    guest=await context.new_page()
    await guest.goto(root)
    await guest.locator('#join-room').fill(room)
    await guest.locator('#join-name').fill('Wiederverbinden')
    await guest.locator('#join-form button[type="submit"]').click()
    await guest.locator('[data-action="lobby-join"][data-team="t1"]').click()
    await host.locator('[data-action="approve"]').click()
    await expect(guest.locator('.role-caption')).to_contain_text('Team 1')
    await guest.evaluate('window.__netQA.game().conn.close()')
    await expect(guest.locator('[data-action="retry-connect"]')).to_be_visible()
    await guest.locator('[data-action="retry-connect"]').click()
    await expect(guest.locator('.status')).to_contain_text('Live verbunden',timeout=15000)
    await expect(guest.locator('[data-action="retry-connect"]')).to_have_count(0)
    print('PASS: approved guest reconnects manually with the same team and identity',flush=True)

    await host.locator('.top-nav [data-view="setup"]').click()
    await expect(host.locator('.bq-connection-audit')).to_be_visible()
    report=await host.evaluate('window.__netQA.report()')
    assert 'turnConfigured' in report and 'iceState' in report
    assert 'memberSecrets' not in report and room not in report
    await host.locator('[data-action="restart-host-transport"]').click()
    await expect(host.locator('.status')).to_contain_text('Live verbunden',timeout=15000)
    await expect(guest.locator('.status')).to_contain_text('Live verbunden',timeout=18000)
    assert not errors,errors
    print('PASS: host restarts the transport without deleting the guest and keeps sanitized diagnostic data',flush=True)
   finally:
    await context.close()
    await browser.close()
 finally:
  server.shutdown();server.server_close()

if __name__=='__main__':
 asyncio.run(main())
