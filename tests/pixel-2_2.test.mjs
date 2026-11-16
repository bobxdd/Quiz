import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {VERSION} from '../docs/core.mjs';
const root=new URL('../docs/',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const css=readFileSync(new URL('pixel-theme.css',root),'utf8');
const sw=readFileSync(new URL('sw.js',root),'utf8');
const mascot=readFileSync(new URL('mascot-pixel.png',root));
test('2.2: Originalquiz-Logik und Versionsstand bleiben kompatibel',()=>{assert.equal(VERSION,'3.6.0')});
test('2.2: Optimiertes transparentes Maskottchen wird als dekoratives PNG eingebunden',()=>{
 assert.doesNotMatch(html,/bq-pixel-scene/);
 assert.match(html,/href="\.\/characters\.css"/);
 assert.deepEqual([...mascot.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 assert.ok(statSync(new URL('mascot-pixel.png',root)).size<60000);
 assert.doesNotMatch(html,/\.\/mascot-ranger\.png/);
 assert.doesNotMatch(html,/\.\/mascot-lantern\.png/);
 assert.doesNotMatch(html,/\.\/mascot-alchemist\.png/);
});
test('2.2: Pixelart ist scharf, dekorativ und schnappt keine Klicks ab',()=>{
 assert.match(css,/\.bq-pixel-scene\{position:fixed/);
 assert.match(css,/\.bq-pixel-mascot\{[^}]*pointer-events:none/);
 assert.match(css,/\.bq-pixel-mascot img\{[^}]*image-rendering:pixelated/);
 assert.match(css,/\.bq-mascot-lantern\{/);
 assert.match(css,/@media\(max-width:680px\)\{/);
 assert.match(css,/padding-bottom:76px/);
});
test('2.2: Dezente Akzente, keine globale Pixel-Schrift und keine Animationspflicht',()=>{
 assert.match(css,/--pixel-cloak:#ab8098/);
 assert.match(css,/\.top-nav \.nav.active::before/);
 assert.match(css,/\.tile::after/);
 assert.doesNotMatch(css,/@font-face[^}]*pixel/i);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(css,/@media\(prefers-reduced-transparency:reduce\)/);
});
test('2.2: Der Service Worker cached ausschließlich öffentliche App-Dateien samt Maskottchen',()=>{
 assert.match(sw,/brainquiz-shell-3\.6\.8/);
 assert.doesNotMatch(sw,/'\.\/mascot-pixel\.png'/);
 assert.doesNotMatch(sw,/'\.\/mascot-ranger\.png'/);
 assert.doesNotMatch(sw,/'\.\/mascot-lantern\.png'/);
 assert.doesNotMatch(sw,/'\.\/mascot-alchemist\.png'/);
 assert.match(sw,/ALLOWED_PATHS/);
 assert.match(sw,/event\.request\.method!==['"]GET['"]/);
});
test('2.2: Bildabmessungen liegen vor und verhindern unnötige Layoutsprünge',()=>{
 assert.match(html,/href="\.\/characters\.css"/);
 assert.match(css,/\.bq-pixel-mascot img\{display:block;width:100%;height:auto/);
});
