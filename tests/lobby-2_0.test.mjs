import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_PLAYERS,approval,freeSlots,approvedCount,participantLabels} from '../docs/lobby-model.mjs';
import {participantSnapshot,answerProgress,makeAnswerReview,revealAnswer} from '../docs/answer-review.mjs';
const person=n=>({name:'Spieler '+n,status:'pending',team:''});
function fill(n){let roster={};for(let i=1;i<=n;i++){const res=approval(roster,'user_'+i,person(i),'t1');assert.ok(res.accepted);roster=res.roster;}return roster;}
test('Host plus zehn eingelassene Spieler, nie elf',()=>{
 assert.equal(MAX_PLAYERS,10);let r=fill(10);assert.equal(approvedCount(r),10);assert.equal(freeSlots(r),0);
 const denied=approval(r,'user_11',person(11),'t2');assert.equal(denied.accepted,false);assert.deepEqual(denied.roster,r);assert.match(denied.reason,/10/);
});
test('Zehnter Spieler darf Team wechseln; belegter Platz wird nicht doppelt gezählt',()=>{
 const r=fill(10), changed=approval(r,'user_10',person(10),'t2');assert.ok(changed.accepted);
 assert.equal(approvedCount(changed.roster),10);assert.equal(changed.roster.user_10.team,'t2');assert.equal(r.user_10.team,'t1');
});
test('Entfernung gibt einen Platz frei; neuer Spieler kann rein',()=>{
 const r=fill(10);delete r.user_5;assert.equal(freeSlots(r),1);const replacement=approval(r,'user_11',person(11),'t1');assert.ok(replacement.accepted);assert.equal(freeSlots(replacement.roster),0);
});
test('Ungültige Spieler-IDs und Teams werden abgewiesen',()=>{
 for(const id of ['','../../secret','__proto__'])assert.throws(()=>approval({},id,person(1),'t1'));
 for(const team of ['','HOST','t99'])assert.throws(()=>approval({},'user_1',person(1),team));
});
test('Die zehn Review-Karten enthalten vor der Freigabe keine Antworten',()=>{
 const roster=fill(10), expected=participantSnapshot(roster);assert.equal(participantLabels(roster).length,10);
 const responses=Object.fromEntries(Object.keys(roster).map((uid,i)=>[uid,{text:'Supergeheim'+i}]));
 assert.equal(answerProgress(expected,responses).complete,true);
 const review=makeAnswerReview(expected,responses,2);
 assert.equal(Object.keys(review.entries).length,10);
 assert.ok(!JSON.stringify(review).includes('Supergeheim'));
 const released=revealAnswer(review,'user_10',responses.user_10);
 assert.equal(Object.values(released.entries).filter(e=>e.revealed).length,1);
});
test('Review-Fallback begrenzt manipulierte 20er-Teilnehmerliste auf zehn',()=>{
 const oversized=Object.fromEntries(Array.from({length:20},(_,i)=>['user_'+i,{name:'Spieler '+i,team:'t1'}]));
 assert.equal(Object.keys(participantSnapshot(oversized)).length,10);
});
test('P2P host confirms team membership; guest requests never directly grant access',()=>{
 const peer=readFileSync(new URL('../docs/peer-client.mjs',import.meta.url),'utf8');
 assert.match(peer,/async hostAssign\(room,uid,player,team\)/);
 assert.match(peer,/approval\(d\.roster,uid,member,destination\)/);
 assert.match(peer,/member\?\.status!=='approved'/);
 assert.match(peer,/action==='lobby-join'/);
 assert.match(peer,/action==='lobby-create'/);
 assert.match(peer,/Hostfreigabe erforderlich/);
});
test('GitHub Pages workflow publishes the static PeerJS site after tests',()=>{
 const y=readFileSync(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
 assert.match(y,/needs:\s*\[check,\s*crossbrowser\]/);assert.doesNotMatch(y,/vars.FIREBASE/);assert.match(y,/npm run build:pages/);
 assert.match(y,/deploy-pages@v4/);
});
