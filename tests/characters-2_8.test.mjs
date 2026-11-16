import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
const get=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const app=get('../docs/app.mjs'),html=get('../docs/index.html'),css=get('../docs/characters.css'),sw=get('../docs/sw.js');
test('2.8: exactly four supplied characters, without old floating mascots',()=>{
 for(const name of ['rogue','blades','mage','druid']){
  assert.match(css,new RegExp('characters/'+name+'\\.webp'));
  const path=new URL('../docs/characters/'+name+'.webp',import.meta.url);
  const bytes=readFileSync(path);assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert.ok(statSync(path).size>10000);
  assert.match(sw,new RegExp('characters/'+name+'\\.webp'));
 }
 assert.doesNotMatch(html,/class="bq-pixel-scene"/);
 assert.match(app,/const CHARACTER_IDS=\['rogue','blades','mage','druid'\]/);
});
test('Step 5: restrained and rare original characters, no reaction overlays',()=>{
 const motion=get('../docs/actor-motion.css'),pixel=get('../docs/pixel-theme.css');
 assert.match(app,/function boardPeekRound\(/);
 assert.match(app,/round%7===3/);
 assert.match(app,/function watcherMarkup\(/);
 assert.match(app,/function sceneCameos\(/);
 assert.match(app,/bq-peek-fingers/);
 assert.match(motion,/\.bq-screen-watcher/);
 assert.match(motion,/\.bq-scene-cameos/);
 assert.match(motion,/pointer-events:none/);
 assert.match(motion,/prefers-reduced-motion:reduce/);
 for(const source of [app,motion,css,pixel]){
  assert.doesNotMatch(source,/maybeAnimateGameplay|animateDock|bq-action-actor|bq-happy-reaction|bq-curtain-actor|bq-actor--(?:answer|review|points|buzzer|solution)/);
 }
 assert.doesNotMatch(app,/bq-landing-cast|mascot-ranger\.png|mascot-lantern\.png|mascot-alchemist\.png/);
});
