import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=name=>readFileSync(new URL('../docs/'+name,import.meta.url),'utf8');
test('projector page uses read-only channel with no host credentials or editable RPC',()=>{
 const receiver=file('projector.mjs'),page=file('projector.html'),app=file('app.mjs');
 assert.match(receiver,/BroadcastChannel/);
 assert.ok(!receiver.includes('localStorage'));
 assert.match(receiver,/watchProjector\(room,key,showFrame,showStatus\)/);
 assert.ok(!receiver.includes('new PeerGame'));
 assert.ok(!receiver.includes('hostQuiz'));
 assert.ok(!receiver.includes('memberSecrets'));
 assert.match(page,/Content-Security-Policy/);
 assert.match(app,/function projectorFrame\(\)/);
 assert.match(app,/function openProjector\(\)/);
 assert.match(app,/role!=='host'\|\|isOffline\(\)/);
 const frame=app.slice(app.indexOf('function projectorFrame(){'),app.indexOf('function pushProjector('));
 assert.doesNotMatch(frame,/renderChat|boardScene|sessionFooter|hostPrivateSolution/);
 assert.match(frame,/renderBoard\(true\)/);
});
test('rehearsal remains separate from multiplayer and renders the current final answer',()=>{
 const app=file('app.mjs');
 assert.match(app,/case 'editor-probe':/);
 assert.match(app,/previewRevealed\?renderAnswerView\(q,\{preview:true\}\)/);
 assert.match(app,/if\(!isOffline\(\)\|\|!canHost\(\)\)/);
});
