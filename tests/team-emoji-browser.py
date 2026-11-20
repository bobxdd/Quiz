"""Create an Emoji-Teamrunde and a four-slot Imposter, then play in four tabs."""
import asyncio
import re
import struct
import threading
import zlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
TARGET = "Kai'Sa"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'docs'), **kwargs)

    def log_message(self, *_args):
        pass


def png(colour):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 2, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress((b'\0' + bytes((*colour, 255)) * 2) * 2))
        + chunk(b'IEND', b'')
    )


async def edit_questions(host):
    await host.locator('[data-action="create-new-quiz"]').click()
    await host.locator('[data-se-action="category-preset"][data-category="Emoji-Teamrunde"]').click()
    await host.locator('[data-se-action="new"][data-template="team-emoji"]').click()
    await expect(host.locator('.se-team-emoji')).to_be_visible()
    for field, value in [('emojiClueSeconds', '20'), ('emojiGuessSeconds', '8'), ('emojiPalette', '🦊 ❄️ 🔥')]:
        control = host.locator(f'[data-se-field="{field}"]')
        await control.fill(value)
        await control.blur()
        await expect(control).to_have_value(value)
    await host.locator('[data-se-action="editor-pane"][data-pane="answer"]').click()
    await host.get_by_label('Champion oder Begriff (geheim)').fill(TARGET)
    await host.locator('#se-answer-text').blur()
    await expect(host.locator('.se-answer-readiness.is-ready')).to_be_visible()
    await host.locator('[data-se-action="editor-pane"][data-pane="question"]').click()
    await host.locator('.se-team-emoji [data-se-action="category-overview"]').click()
    await host.locator('[data-se-action="category-preset"][data-category="Champion zeichnen"]').click()
    await host.locator('[data-se-action="new"][data-template="team-draw"]').click()
    for field, value in [('drawSeconds', '14'), ('emojiGuessSeconds', '8')]:
        control = host.locator(f'[data-se-field="{field}"]')
        await control.fill(value)
        await control.blur()
        await expect(control).to_have_value(value)
    await host.locator('[data-se-action="editor-pane"][data-pane="answer"]').click()
    await host.get_by_label('Champion (geheim)').fill('Jinx')
    await host.locator('#se-answer-text').blur()
    await host.locator('[data-se-upload="answer-image"]').set_input_files(
        {'name': 'drawing-reference.png', 'mimeType': 'image/png', 'buffer': png((30, 140, 210))}
    )
    await expect(host.locator('.se-answer-live-preview .bq-answer-image img')).to_be_visible()
    await host.locator('[data-se-action="editor-pane"][data-pane="question"]').click()
    await host.locator('.se-team-emoji [data-se-action="category-overview"]').click()
    await host.locator('[data-se-action="category-preset"][data-category="Fähigkeiten"]').click()
    await host.locator('[data-se-action="new"][data-template="imposter"]').click()
    slots = host.locator('.se-question-pane .se-kind-image')
    await expect(slots).to_have_count(4)
    colours = [(220, 15, 20), (26, 220, 40), (30, 41, 210), (200, 30, 170), (245, 235, 21)]
    for index, colour in enumerate(colours[:4]):
        await slots.nth(index).click()
        await host.locator('[data-se-upload="image"]').set_input_files(
            {'name': f'slot-{index}.png', 'mimeType': 'image/png', 'buffer': png(colour)}
        )
        await expect(slots.nth(index).locator('img')).to_be_visible()
    decoy = await slots.nth(2).locator('img').get_attribute('src')
    await host.locator('[data-se-field="imposterIndex"]').select_option('2')
    await host.locator('[data-se-upload="correct-icon"]').set_input_files(
        {'name': 'original.png', 'mimeType': 'image/png', 'buffer': png(colours[-1])}
    )
    await host.locator('[data-se-action="editor-pane"][data-pane="answer"]').click()
    originals = host.locator('.se-answer-live-preview .se-kind-image img')
    await expect(originals).to_have_count(4)
    await expect(originals.nth(2)).not_to_have_attribute('src', decoy)
    return await originals.nth(2).get_attribute('src')


async def join(context, host, root, code, name, team, observe):
    player = await context.new_page()
    await player.set_viewport_size({'width': 390, 'height': 844})
    observe(player)
    await player.goto(root + '/')
    await player.locator('#join-room').fill(code)
    await player.locator('#join-name').fill(name)
    await player.get_by_role('button', name='Beitreten', exact=True).click()
    await player.locator('[data-action="lobby-join"][data-team="' + team + '"]').click()
    await expect(host.locator('.bq-lobby-request')).to_contain_text('Gewünscht: Team ' + team[-1])
    await host.locator('[data-action="approve"]').click()
    await expect(player.locator('.role-caption')).to_have_text('Team ' + team[-1])
    return player


def tile(host, category):
    return host.locator('.bq-board-scene .column').filter(has_text=category).locator('[data-action="open"]')


async def save_clue(player, labels):
    await expect(player.locator('.bq-emoji-target')).to_contain_text(TARGET)
    await expect(player.locator('.bq-emoji-palette button')).to_have_count(3)
    verify_catalogue = labels[0] == 'Fuchs'
    if verify_catalogue:
        await player.get_by_role('button', name='Tiere', exact=True).click()
        await expect(player.locator('.bq-emoji-palette button')).to_have_count(1)
        await player.get_by_role('button', name='Fuchs', exact=True).click()
        await player.get_by_role('button', name='Natur', exact=True).click()
        await expect(player.locator('.bq-emoji-palette button')).to_have_count(2)
        await expect(player.locator('.bq-emoji-selection')).to_contain_text('🦊')
        labels = labels[1:]
    for label in labels:
        await player.get_by_role('button', name=label, exact=True).click()
    if verify_catalogue:
        await player.get_by_role('button', name='Emoji-Tastatur', exact=True).click()
        keyboard = player.get_by_role('dialog', name='Emoji-Tastatur')
        await expect(keyboard.locator('[data-catalog-emoji]')).to_have_count(3944)
        assert await keyboard.locator('.bq-emoji-keyboard-list').evaluate('(el) => el.scrollHeight > el.clientHeight')
        await keyboard.get_by_label('Kategorie').select_option(label='Flaggen')
        await keyboard.get_by_label('Emoji suchen').fill('deutschland')
        await keyboard.get_by_role('button', name='Flagge: Deutschland', exact=True).click()
        await keyboard.get_by_role('button', name='Fertig', exact=True).click()
        entry = player.get_by_label('Eure Emojis')
        await expect(entry).to_have_value('🦊 ❄️ 🇩🇪')
        await entry.fill('🦊 ❄️ 🇩🇪 🧑🏾‍🚀')
    await player.get_by_role('button', name='Hinweis speichern').click()
    await expect(player.get_by_text('Hinweis gespeichert.', exact=True)).to_be_visible()


async def submit_guess(player, hint, guess):
    await expect(player.locator('.bq-emoji-hint')).to_have_text(hint,timeout=26000)
    await expect(player.locator('.bq-team-emoji')).not_to_contain_text(TARGET)
    await expect(player.get_by_label('Eure Antwort')).to_be_in_viewport(ratio=1)
    await expect(player.get_by_role('button', name='Antwort fürs Team abgeben')).to_be_in_viewport(ratio=1)
    await player.get_by_label('Eure Antwort').fill(guess)
    await player.get_by_role('button', name='Antwort fürs Team abgeben').click()
    await expect(player.get_by_text('Eure letzte gespeicherte Antwort zählt nach Ablauf der Zeit.')).to_be_visible()


async def draw_line(player, touch=False, reverse=False):
    handle = await player.wait_for_function("""() => {
        const canvas = document.querySelector('#team-draw-canvas');
        if (!canvas) return false;
        canvas.scrollIntoView({block: 'nearest'});
        const box = canvas.getBoundingClientRect();
        return box.width >= 110 && box.height >= 65 && box.toJSON();
    }""")
    box = await handle.json_value()
    x, y, width, height = (box[key] for key in ('x', 'y', 'width', 'height'))
    start = {'x': x + width * .2, 'y': y + height * (.7 if reverse else .25)}
    end = {'x': x + width * .8, 'y': y + height * (.25 if reverse else .7)}
    if touch:
        session = await player.context.new_cdp_session(player)
        await session.send('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 1})
        for kind, points in [('touchStart', [start]), ('touchMove', [end]), ('touchEnd', [])]:
            await session.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': points})
        await session.detach()
    else:
        await player.mouse.move(start['x'], start['y'])
        await player.mouse.down()
        await player.mouse.move(end['x'], end['y'], steps=8)
        await player.mouse.up()
    await expect(player.get_by_text('Zeichnung gespeichert.', exact=True)).to_be_visible()


async def play_drawing(host, players, viewer):
    alice, bob, claire, deniz = players
    await tile(host, 'Champion zeichnen').click()
    await host.locator('[data-action="uncover-question"]').click()
    for player in players:
        await expect(player.get_by_role('button', name='Zeichnen', exact=True)).to_have_attribute('aria-pressed', 'false')
        await expect(player.get_by_role('button', name='Raten', exact=True)).to_have_attribute('aria-pressed', 'false')
    for artist, guesser in [(bob, alice), (deniz, claire)]:
        await artist.get_by_role('button', name='Zeichnen', exact=True).click()
        await expect(guesser.get_by_role('button', name='Zeichnen', exact=True)).to_be_disabled()
        await guesser.get_by_role('button', name='Raten', exact=True).click()
    await expect(host.get_by_text('Rollen bereit', exact=True)).to_have_count(2)
    await host.get_by_role('button', name='Zeichenphase starten', exact=True).click()
    for artist in [bob, deniz]:
        await expect(artist.locator('.bq-drawing-prompt')).to_contain_text('Jinx')
        await expect(artist.get_by_role('img', name='Vorlage für Jinx')).to_be_visible()
    for guest in [alice, claire, viewer]:
        await expect(guest.locator('.bq-team-emoji')).not_to_contain_text('Jinx')
        await expect(guest.locator('.bq-drawing-art, .bq-drawing-reference')).to_have_count(0)
    await bob.get_by_role('button', name='Rot', exact=True).click()
    await bob.get_by_label('Strich').select_option('2')
    await deniz.get_by_role('button', name='Blau', exact=True).click()
    await asyncio.gather(draw_line(bob), draw_line(deniz, touch=True))
    await bob.get_by_role('button', name='Radierer', exact=True).click()
    await draw_line(bob, reverse=True)
    await bob.get_by_role('button', name='Rückgängig', exact=True).click()
    await expect(bob.get_by_text('Zeichnung gespeichert.', exact=True)).to_be_visible()
    for guest, colour in [(alice, '#d73b47'), (claire, '#2579cb')]:
        paths = guest.locator('.bq-drawing-guess path')
        await expect(paths).to_have_count(1, timeout=16000)
        await expect(paths).to_have_attribute('stroke', colour)
        await expect(guest.get_by_label('Eure Antwort')).to_be_in_viewport(ratio=1)
        await expect(guest.locator('.bq-team-emoji')).not_to_contain_text('Jinx')
    await expect(viewer.locator('.bq-drawing-art')).to_have_count(0)
    await alice.get_by_label('Eure Antwort').fill('Jinx')
    await alice.get_by_role('button', name='Antwort fürs Team abgeben').click()
    await expect(host.get_by_role('heading', name='Alle Team-Ergebnisse')).to_be_visible(timeout=12000)
    await expect(host.locator('.bq-emoji-results li').nth(0)).to_contain_text('Richtig')
    await expect(host.locator('.bq-emoji-results li').nth(1)).to_contain_text('Keine Antwort')
    await host.locator('[data-action="emoji-score-correct"][data-team="t2"]').click()
    await expect(host.locator('.bq-emoji-results li').nth(1)).to_contain_text('Richtig')
    await expect(viewer.locator('.bq-drawing-art')).to_have_count(2)
    await host.locator('[data-action="emoji-close"]').click()
    print('PASS: new drawing roles, private reference, mouse and touch strokes, undo, team-only clues and manual scoring', flush=True)


async def run(browser, root):
    context = await browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
    await context.add_init_script(path=ROOT / 'tests' / 'mock-peerjs-browser.js')
    errors = []

    def observe(page):
        page.on('pageerror', lambda error: errors.append(str(error)))

    host = await context.new_page()
    observe(host)
    host.on('dialog', lambda dialog: asyncio.create_task(dialog.accept()))
    await host.goto(root + '/')
    original = await edit_questions(host)
    await host.locator('[data-action="host-current-board"]').click()
    await host.wait_for_url(re.compile(r'\?room=[A-Z2-9]{16}'))
    code = parse_qs(urlparse(host.url).query)['room'][0]

    players = []
    for name, team in [('Alice', 't1'), ('Bob', 't1'), ('Claire', 't2'), ('Deniz', 't2')]:
        players.append(await join(context, host, root, code, name, team, observe))
    alice, bob, claire, deniz = players
    await host.locator('[data-action="start-game"]').click()
    await host.locator('.top-nav [data-view="setup"]').click()
    async with context.expect_page() as opening:
        await host.locator('[data-action="open-projector"]').click()
    viewer = await opening.value
    observe(viewer)
    await host.locator('.top-nav [data-view="live"]').click()
    await tile(host, 'Emoji-Teamrunde').click()
    await host.locator('[data-action="uncover-question"]').click()

    for player in players:
        await expect(player.get_by_role('heading', name='Rollen wählen')).to_be_visible()
        await expect(player.locator('.bq-team-emoji')).not_to_contain_text(TARGET)
    await alice.get_by_role('button', name='Emojis legen').click()
    await expect(bob.get_by_role('button', name='Emojis legen')).to_be_disabled()
    await bob.get_by_role('button', name='Raten', exact=True).click()
    await claire.get_by_role('button', name='Emojis legen').click()
    await deniz.get_by_role('button', name='Raten', exact=True).click()
    await expect(host.get_by_text('Rollen bereit', exact=True)).to_have_count(2)
    await host.get_by_role('button', name='Emoji-Phase starten').click()
    await expect(host.locator('.bq-host-solution-preview')).to_contain_text(TARGET)
    await expect(host.locator('.bq-host-solution-preview')).to_be_in_viewport(ratio=1)
    await asyncio.gather(save_clue(alice, ['Fuchs', 'Schneeflocke']), save_clue(claire, ['Feuer']))
    await expect(viewer.locator('.bq-team-emoji')).not_to_contain_text(TARGET)
    await expect(viewer.locator('.bq-host-solution')).to_have_count(0)
    await expect(bob.locator('.bq-host-solution')).to_have_count(0)
    await expect(bob.locator('.bq-emoji-palette')).to_have_count(0)
    await expect(deniz.locator('.bq-emoji-palette')).to_have_count(0)

    await asyncio.gather(submit_guess(bob, '🦊 ❄️ 🇩🇪 🧑🏾‍🚀', 'Jinx'), submit_guess(deniz, '🔥', 'Amumu'))
    await bob.get_by_label('Eure Antwort').fill('KAISA')
    await bob.get_by_role('button',name='Teamantwort aktualisieren').click()
    await expect(alice.get_by_text('Amumu', exact=True)).to_have_count(0)
    for page in [host, *players, viewer]:
        await expect(page.get_by_role('heading', name='Alle Team-Ergebnisse')).to_be_visible(timeout=15000)
        await expect(page.locator('.bq-team-emoji')).to_contain_text(TARGET)
        await expect(page.locator('.bq-emoji-results li').nth(0)).to_contain_text('Richtig · +200 Punkte')
        await expect(page.locator('.bq-emoji-results li').nth(1)).to_contain_text('Falsch · 0 Punkte')
    print('PASS: full emoji catalogue, Unicode text entry, timed private clues, changeable guess and joint result', flush=True)

    await host.locator('[data-action="emoji-close"]').click()
    await play_drawing(host, players, viewer)
    await tile(host, 'Fähigkeiten').click()
    await host.locator('[data-action="uncover-question"]').click()
    images = lambda page: page.locator('.bq-question-panel .se-kind-image img')
    for page in [host, *players, viewer]:
        await expect(images(page)).to_have_count(4)
    before = await images(host).evaluate_all('items => items.map(item => item.src)')
    assert before[2] != original
    for page in [*players, viewer]:
        assert await images(page).evaluate_all('items => items.map(item => item.src)') == before
    await host.locator('[data-action="reveal"]').click()
    for page in [host, *players, viewer]:
        await expect(images(page).nth(2)).to_have_attribute('src', before[2])
        assert await images(page).evaluate_all('items => items.map(item => item.src)') == before
        await expect(page.locator('.bq-question-panel .se-imposter-image')).to_have_count(1)
        await expect(page.locator('.bq-question-panel .bq-answer-image img')).to_have_attribute('src', original)
    assert not errors, errors
    print('PASS: four Ability-Imposter images keep original decoy highlighted; real icon and answer shown separately', flush=True)
    await context.close()


async def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(args=['--no-sandbox', '--no-proxy-server'])
            try:
                await run(browser, f'http://127.0.0.1:{server.server_port}')
            finally:
                await browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    asyncio.run(main())
