import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedQuiz,publicQuestion} from '../docs/core.mjs';
import {readFileSync} from 'node:fs';
test('moderator notes and source metadata round-trip without guest visibility even on reveal',()=>{
 const q=normalizedQuiz({questions:[{id:'private',category:'Champions',type:'text',prompt:'Who?',answerText:'Anivia',
 acceptedAnswers:'Kryophönix\nCryophoenix',hostNotes:'Geheim: Host entscheidet',sourceUrl:'https://wiki.leagueoflegends.com',
 sourcePatch:'Patch 25.1'}]}).questions[0];
 assert.equal(q.hostNotes,'Geheim: Host entscheidet');
 assert.equal(q.sourcePatch,'Patch 25.1');
 assert.equal(q.acceptedAnswers.includes('Cryophoenix'),true);
 for(const reveal of [false,true]){
  const payload=JSON.stringify(publicQuestion(q,reveal));
  assert.ok(!payload.includes('Host entscheidet'));
  assert.ok(!payload.includes('Cryophoenix'));
  assert.ok(!payload.includes('wiki.leagueoflegends'));
  assert.ok(!payload.includes('Patch 25.1'));
 }
});
test('private audit and recovery are not serialized in per-guest snapshot',()=>{
 const peer=readFileSync(new URL('../docs/peer-client.mjs',import.meta.url),'utf8');
 const block=peer.slice(peer.indexOf('_snapshotFor(ctx){'),peer.indexOf('async _sendHostMessage(ctx,message){'));
 assert.ok(!block.includes('scoreEvents'));
 assert.ok(!block.includes('memberSecrets'));
 assert.ok(!block.includes('hostNotes'));
 assert.match(peer,/hostUndoScore\(room,id\)/);
});
