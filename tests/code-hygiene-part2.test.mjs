import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../docs/'+path,import.meta.url),'utf8');

test('Part 2 hygiene: old map HTML and selectors are removed, all new map hooks remain',()=>{
 const scene=read('studio-model.mjs'),css=read('map-ui.css'),controller=read('map-viewport.mjs');
 assert.doesNotMatch(scene,/legacyMapMarkup|se-world-map|bq-pin-self|arguments\[1\]\?\.mapPin/);
 assert.doesNotMatch(css,/\.se-world-map\b|\.bq-pin-self\b|\.bq-pin-public\b|\.bq-pin-solution\b/);
 assert.match(scene,/mapMarkup\(\{prompt:text/);
 assert.match(controller,/mountMapViewport\(/);
 assert.match(controller,/pointercancel/);
});
test('Part 2 hygiene: resubmitting an existing map pin is permitted by the form path only for maps',()=>{
 const app=read('app.mjs');
 assert.match(app,/ev\.target\.id==='answer-form'&&!canHost\(\)&&\(!myResponse\|\|activeQuestion\(\)\?\.type==='map'\)/);
 assert.match(app,/myResponse&&activeQuestion\(\)\?\.type!=='map'/);
});
test('Part 2 hygiene: review privacy and missing response distinctions remain wired in UI',()=>{
 const app=read('app.mjs');
 assert.match(app,/state=answerCardState\(a\)/);
 assert.match(app,/!submitted\?'is-missing'/);
 assert.match(app,/!submitted\?'<span class="small muted">Keine Antwort abgegeben/);
 assert.match(app,/revealAnswer\(review,uid,privateResponse\)/);
 assert.match(app,/reviewIsCurrent\(publicState\)/);
});
test('Part 2: background transport separates private host state from public participant snapshots',()=>{
 const src=read('peer-client.mjs');
 const start=src.indexOf(' _snapshotFor(ctx){'),end=src.indexOf(' _sendSnapshot(ctx){',start);
 assert.ok(start>=0&&end>start);
 const send=src.slice(start,end);
 assert.match(send,/approved\?this\.data\.public:null/);
 assert.match(send,/approved\?this\.data\.responses\?\.\[round\]\?\.\[ctx\.uid\]/);
 assert.match(send,/this\.data\.messages\?\.\[member\.team\]/);
 assert.doesNotMatch(send,/hostQuiz|memberSecrets|questionHistory/);
 const guestActions=src.slice(src.indexOf(' _handleGuestAction(ctx,action,payload){'),src.indexOf(' _rpc(action,payload={})'));
 assert.match(guestActions,/Hostfreigabe erforderlich/);
 assert.doesNotMatch(guestActions,/case 'score':|case 'publish':|case 'reveal':/);
});
