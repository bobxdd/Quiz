import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=name=>readFileSync(new URL('../docs/'+name,import.meta.url),'utf8');

test('only host can choose a question, guest board is read-only',()=>{
 const app=source('app.mjs');
 assert.match(app,/const hostCanSelect=canHost\(\)/);
 assert.match(app,/if\(readOnly\|\|!hostCanSelect\)return `<div class="\$\{classes\} bq-tile-view-only/);
 assert.match(app,/data-action="\$\{strike\?'balance-strike':'open'\}" data-qid/);
 assert.match(app,/case 'open':if\(!canHost\(\)\)return;/);
 assert.doesNotMatch(app,/data-action="request-pick"/);
 assert.doesNotMatch(app,/case 'request-pick'/);
 assert.doesNotMatch(app,/maybeOpenSelectedQuestion/);
 assert.doesNotMatch(app,/Team [0-9] wählt die nächste Frage/);
 assert.match(app,/Der Host wählt die nächste Frage/);
 assert.match(source('session-ui.css'),/bq-tile-view-only/);
});

test('old clients and forged RPCs cannot reserve a question, host gets no stale selection restriction',()=>{
 const peer=source('peer-client.mjs'),flow=source('question-flow.mjs');
 assert.match(peer,/case 'pick':throw Error\('Nur der Host darf Fragen auswählen\.'\)/);
 assert.match(peer,/async requestPick\(room,qid,name\)\{throw Error\('Nur der Host darf Fragen auswählen\.'\)/);
 assert.match(peer,/case 'buzz'/);
 assert.match(peer,/case 'answer'/);
 assert.match(peer,/case 'message'/);
 assert.match(peer,/action==='lobby-join'/);
 assert.doesNotMatch(flow,/if\(state\.questionPick&&state\.questionPick\.qid!==question\?\.id\)return null/);
 assert.match(flow,/questionPick:null/);
});
