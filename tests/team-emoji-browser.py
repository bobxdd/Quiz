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
SORT_ITEMS = ['Ahri', 'Braum', 'Ekko', 'Garen', 'Jinx', 'Lux', 'Rell', 'Zed']
SORT_RULE = 'Sortiere die Champions alphabetisch. A zuerst.'


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
    await host.get_by_label('Geheimer Champion', exact=True).fill(TARGET)
    await host.get_by_label('Geheimer Champion', exact=True).blur()
    for field, value in [('emojiClueSeconds', '20'), ('emojiGuessSeconds', '8')]:
        control = host.locator(f'[data-se-field="{field}"]')
        await control.fill(value)
        await control.blur()
        await expect(control).to_have_value(value)
    await expect(host.locator('[data-se-field="emojiPalette"]')).to_have_count(0)
    await host.locator('[data-se-action="editor-pane"][data-pane="answer"]').click()
    await expect(host.get_by_label('Champion oder Begriff (geheim)')).to_have_value(TARGET)
    await expect(host.locator('.se-answer-readiness.is-ready')).to_be_visible()
    await host.locator('[data-se-action="editor-pane"][data-pane="question"]').click()
    await host.locator('.se-team-emoji [data-se-action="category-overview"]').click()
    await host.locator('[data-se-action="category-preset"][data-category="Champion zeichnen"]').click()
    await host.locator('[data-se-action="new"][data-template="team-draw"]').click()
    for field, value in [('drawSeconds', '16'), ('emojiGuessSeconds', '8')]:
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
    await host.locator('[data-se-action="category-preset"][data-category="Sortieren"]').click()
    await host.locator('[data-se-action="new"][data-template="order"]').click()
    await host.get_by_label('Sortierauftrag').fill(SORT_RULE)
    await host.get_by_label('Sortierauftrag').blur()
    await host.locator('[data-se-action="sort-add"]').click()
    await expect(host.locator('[data-se-action="sort-add"]')).to_be_disabled()
    for position, item in enumerate(SORT_ITEMS, 1):
        field = host.get_by_label(f'Sortiereintrag {position}', exact=True)
        await field.fill(item)
        await field.blur()
    await host.locator('.se-question-pane .se-back').click()
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


async def save_clue(player, symbols):
    await expect(player.locator('.bq-emoji-target')).to_contain_text(TARGET)
    await expect(player.locator('.bq-emoji-palette')).to_have_count(0)
    await expect(player.locator('.bq-emoji-native-help')).to_contain_text('Win')
    await expect(player.locator('.bq-emoji-native-help')).to_contain_text('Punkt')
    entry = player.get_by_label('Eure Emojis')
    if symbols.startswith('🦊'):
        await player.set_viewport_size({'width': 320, 'height': 568})
        await expect(entry).to_be_in_viewport(ratio=.98)
        await entry.fill('🦊 ❄️ 🇩🇪 🧑🏾‍🚀')
        await expect(entry).to_have_value('🦊 ❄️ 🇩🇪')
        await expect(player.locator('.bq-emoji-selection button')).to_have_count(3)
        await player.locator('.bq-emoji-selection button').nth(2).click()
        await expect(entry).to_have_value('🦊 ❄️')
        # Full optional catalogue remains usable without a predefined palette.
        await player.get_by_role('button', name='Emoji-Tastatur', exact=True).click()
        keyboard = player.get_by_role('dialog', name='Emoji-Tastatur')
        await keyboard.get_by_label('Kategorie').select_option(label='Flaggen')
        await keyboard.get_by_label('Emoji suchen').fill('deutschland')
        await keyboard.get_by_role('button', name='Flagge: Deutschland', exact=True).click()
        await expect(keyboard).not_to_be_visible()
        await expect(entry).to_have_value('🦊 ❄️ 🇩🇪')
    else:
        await entry.fill(symbols)
    await expect(player.locator('[data-emoji-status]')).to_contain_text('Hinweis gespeichert.')


async def submit_guess(player, hint, guess):
    await expect(player.locator('.bq-emoji-hint')).to_have_text(hint,timeout=26000)
    await expect(player.locator('.bq-team-emoji')).not_to_contain_text(TARGET)
    await expect(player.get_by_label('Eure Antwort')).to_be_in_viewport(ratio=1)
    await player.get_by_label('Eure Antwort').fill(guess)
    await expect(player.locator('.bq-answer-saved')).to_have_text('Teamantwort gespeichert.')


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


async def expect_ink(player, rgba):
    await player.wait_for_function("""expected => {
        const canvas = document.querySelector('#team-draw-canvas');
        if (!canvas) return false;
        const pixel = canvas.getContext('2d').getImageData(320, 190, 1, 1).data;
        return expected.every((channel, i) => pixel[i] === channel);
    }""", arg=rgba, timeout=4000)


async def play_drawing(host, players, viewer):
    alice, bob, claire, deniz = players
    await bob.set_viewport_size({'width': 320, 'height': 568})
    await deniz.set_viewport_size({'width': 667, 'height': 375})
    await alice.set_viewport_size({'width': 320, 'height': 568})
    await claire.set_viewport_size({'width': 640, 'height': 360})
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
    await expect(host.locator('#clock')).to_have_text(re.compile(r'^0:1[0-6]$'))
    for artist in [bob, deniz]:
        await expect(artist.locator('.bq-drawing-prompt')).to_contain_text('Jinx')
        await expect(artist.get_by_role('img', name='Vorlage für Jinx')).to_be_visible()
        await expect(artist.locator('#team-draw-canvas')).to_be_in_viewport(ratio=.98)
        await expect(artist.get_by_role('button', name='Radierer', exact=True)).to_be_in_viewport(ratio=.98)
        await expect(artist.get_by_label('Strich')).to_be_in_viewport(ratio=.98)
    for guest in [alice, claire, viewer]:
        await expect(guest.locator('.bq-team-emoji')).not_to_contain_text('Jinx')
        await expect(guest.locator('.bq-drawing-art, .bq-drawing-reference')).to_have_count(0)
    await expect(bob.get_by_role('group', name='Pinselfarbe').get_by_role('button')).to_have_count(8)
    await bob.get_by_role('button', name='Rot', exact=True).click()
    await expect(bob.get_by_role('button', name='Rot', exact=True)).to_have_attribute('aria-pressed', 'true')
    await bob.get_by_label('Strich').select_option('2')
    await deniz.get_by_role('button', name='Blau', exact=True).click()
    await asyncio.gather(draw_line(bob), draw_line(deniz, touch=True))
    await expect_ink(bob, [215, 59, 71, 255])
    await bob.get_by_role('button', name='Radierer', exact=True).click()
    await draw_line(bob, reverse=True)
    await expect_ink(bob, [255, 255, 255, 255])
    await bob.get_by_role('button', name='Rückgängig', exact=True).click()
    await expect_ink(bob, [215, 59, 71, 255])
    await expect(bob.get_by_text('Zeichnung gespeichert.', exact=True)).to_be_visible()
    await deniz.get_by_role('button', name='Leeren', exact=True).click()
    await expect(deniz.get_by_text('Zeichne den Champion auf die Fläche.', exact=True)).to_be_visible()
    await expect_ink(deniz, [0, 0, 0, 0])
    await draw_line(deniz, touch=True, reverse=True)
    await expect(host.get_by_role('heading', name='Jetzt raten')).to_be_visible(timeout=18000)
    await expect(host.locator('#clock')).to_have_text(re.compile(r'^0:0[5-8]$'))
    for guest, colour in [(alice, '#d73b47'), (claire, '#2579cb')]:
        paths = guest.locator('.bq-drawing-guess path')
        await expect(paths).to_have_count(1, timeout=16000)
        await expect(paths).to_have_attribute('stroke', colour)
        drawing = guest.locator('.bq-drawing-guess svg')
        await expect(drawing).to_be_in_viewport(ratio=.98)
        assert (await drawing.bounding_box())['height'] >= 95
        await expect(guest.get_by_label('Eure Antwort')).to_be_in_viewport(ratio=.98)
        await expect(guest.locator('.bq-answer-saved')).to_be_in_viewport(ratio=.98)
        await expect(guest.locator('.bq-team-emoji')).not_to_contain_text('Jinx')
    await expect(alice.locator('.bq-drawing-guess path')).to_have_attribute('stroke-width', '15')
    await expect(viewer.locator('.bq-drawing-art')).to_have_count(0)
    await alice.get_by_label('Eure Antwort').fill('Jinx')
    await expect(alice.locator('.bq-answer-saved')).to_have_text('Teamantwort gespeichert.')
    for page in [host, *players, viewer]:
        await expect(page.get_by_role('heading', name='Bereit zur Auflösung')).to_be_visible(timeout=12000)
        await expect(page.locator('.bq-emoji-results')).to_have_count(0)
        await expect(page.locator('.bq-emoji-native-help')).to_have_count(0)
    await expect(viewer.locator('.bq-drawing-art')).to_have_count(0)
    await expect(viewer.locator('.bq-team-emoji')).not_to_contain_text('Jinx')
    await expect(alice.locator('#team-emoji-guess')).to_have_count(0)
    await host.get_by_role('button', name='Lösung & alle Teamantworten aufdecken').click()
    await expect(host.get_by_role('heading', name='Alle Team-Ergebnisse')).to_be_visible(timeout=12000)
    await expect(host.locator('.bq-emoji-results li').nth(0)).to_contain_text('Richtig')
    await expect(host.locator('.bq-emoji-results li').nth(1)).to_contain_text('Keine Antwort')
    await host.locator('[data-action="emoji-score-correct"][data-team="t2"]').click()
    await expect(host.locator('.bq-emoji-results li').nth(1)).to_contain_text('Richtig · +')
    await expect(host.locator('.bq-emoji-results li').nth(1)).to_contain_text('Bestätigt')
    await expect(host.locator('[data-action="emoji-score-correct"][data-team="t2"]')).to_have_attribute('aria-pressed','true')
    for participant in players:
        await expect(participant.locator('.bq-emoji-results .bq-drawing-art')).to_have_count(2)
        await expect(participant.locator('.bq-emoji-results li').nth(0)).to_contain_text('Jinx')
    await expect(viewer.locator('img.bq-drawing-art')).to_have_count(2)
    await viewer.wait_for_function("""() => {
        const drawings = [...document.querySelectorAll('img.bq-drawing-art')];
        return drawings.length === 2 && drawings.every(image => image.complete && image.naturalWidth > 0);
    }""")
    await host.locator('[data-action="emoji-close"]').click()
    await bob.set_viewport_size({'width': 640, 'height': 360})
    print('PASS: drawing layouts, drawing tools, separate timers, private reference, isolated guessing, shared drawings at reveal and manual scoring', flush=True)


async def move_sort_item(participant, name, step):
    items = participant.locator('[data-sort-value]')
    position = (await items.all_text_contents()).index(name)
    direction = 'oben' if step < 0 else 'unten'
    button = participant.get_by_role('button', name=f'{name} nach {direction}', exact=True)
    await button.click()
    await expect(items.nth(position + step)).to_have_text(name)
    await expect(button).to_be_focused()


async def exercise_sorting(participant, target):
    items = participant.locator('[data-sort-value]')
    initial = await items.all_text_contents()
    for name in initial:
        step = -1 if initial.index(name) == len(initial) - 1 else 1
        await move_sort_item(participant, name, step)
        await move_sort_item(participant, name, -step)
    await expect(items).to_have_text(initial)
    for index, name in enumerate(target):
        position = (await items.all_text_contents()).index(name)
        while position > index:
            await move_sort_item(participant, name, -1)
            position -= 1
    await expect(items).to_have_text(target)
    await participant.get_by_role('button', name='Antwort aktualisieren', exact=True).click()
    await expect(participant.locator('.bq-answer-saved')).to_contain_text(' → '.join(target))


async def play_sorting(host, participant, other):
    await tile(host, 'Sortieren').click()
    await host.locator('#ready-time').fill('28')
    await host.locator('[data-action="uncover-question"]').click()
    for player in [participant, other]:
        await expect(player.get_by_role('heading', name=SORT_RULE, exact=True)).to_be_visible()
        items = player.locator('[data-sort-value]')
        await expect(items).to_have_count(8)
        assert await items.all_text_contents() != SORT_ITEMS
        submit = player.get_by_role('button', name='Reihenfolge abgeben', exact=True)
        await expect(submit).to_be_in_viewport(ratio=1)
        await submit.click()
        await expect(player.get_by_role('button', name='Antwort aktualisieren', exact=True)).to_be_visible()
    reversed_items = list(reversed(SORT_ITEMS))
    await asyncio.gather(exercise_sorting(participant, SORT_ITEMS), exercise_sorting(other, reversed_items))
    await expect(other.locator('.review-card.is-hidden')).to_have_count(2, timeout=32000)
    await expect(other.locator('.review-answer')).to_have_count(0)
    for name, target in [('Alice', SORT_ITEMS), ('Bob', reversed_items)]:
        card = host.locator('.review-card').filter(has_text=name)
        await card.click()
        await expect(card.locator('.review-answer')).to_have_text(' → '.join(target))
    await host.locator('.review-card').filter(has_text='Alice').locator('[data-action="judge-review-correct"]').click()
    await host.locator('[data-action="reveal"]').first.click()
    await host.locator('[data-action="back"]').first.click()
    print('PASS: both teammates move all eight items in both directions, update independently and the host receives both exact sequences', flush=True)


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
    await asyncio.gather(save_clue(alice, '🦊 ❄️ 🇩🇪'), save_clue(claire, '🔥'))
    await expect(viewer.locator('.bq-team-emoji')).not_to_contain_text(TARGET)
    await expect(viewer.locator('.bq-host-solution')).to_have_count(0)
    await expect(bob.locator('.bq-host-solution')).to_have_count(0)
    await expect(bob.locator('.bq-emoji-palette')).to_have_count(0)
    await expect(deniz.locator('.bq-emoji-palette')).to_have_count(0)

    await submit_guess(bob, '🦊 ❄️ 🇩🇪', 'Jinx')
    await bob.get_by_label('Eure Antwort').fill('KAISA')
    await expect(bob.locator('.bq-answer-saved')).to_have_text('Teamantwort gespeichert.')
    await submit_guess(deniz, '🔥', 'Amumu')
    for page in [host, *players, viewer]:
        await expect(page.locator('.bq-emoji-results')).to_have_count(0)
    for page in [bob, deniz, viewer]:
        await expect(page.locator('.bq-team-emoji')).not_to_contain_text(TARGET)
        await expect(page.get_by_text('Amumu', exact=True)).to_have_count(0)
    await expect(viewer.locator('.bq-team-emoji')).not_to_contain_text('🦊')
    await expect(bob.locator('#team-emoji-guess')).to_have_value('KAISA')
    await host.get_by_role('button',name='Lösung & alle Teamantworten aufdecken').click()
    for page in [host, *players, viewer]:
        await expect(page.get_by_role('heading', name='Alle Team-Ergebnisse')).to_be_visible(timeout=15000)
        await expect(page.locator('.bq-team-emoji')).to_contain_text(TARGET)
        await expect(page.locator('.bq-emoji-results li').nth(0)).to_contain_text('Richtig · +200 Punkte')
        await expect(page.locator('.bq-emoji-results li').nth(1)).to_contain_text('Falsch · 0 Punkte')
        await expect(page.locator('.bq-emoji-results li').nth(0)).to_contain_text('🦊 ❄️ 🇩🇪')
        await expect(page.locator('.bq-emoji-results li').nth(0)).to_contain_text('KAISA')
        await expect(page.locator('.bq-emoji-results li').nth(1)).to_contain_text('🔥')
        await expect(page.locator('.bq-emoji-results li').nth(1)).to_contain_text('Amumu')
    print('PASS: native emoji help, three-clue cap, optional full keyboard, private waiting and explicit joint reveal', flush=True)

    await host.locator('[data-action="emoji-close"]').click()
    await play_drawing(host, players, viewer)
    await play_sorting(host, alice, bob)
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
