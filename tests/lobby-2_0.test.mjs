import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_PLAYERS,approval,freeSlots,approvedCount,participantLabels} from '../docs/lobby-model.mjs';
import {participantSnapshot,answerProgress,makeAnswerReview,revealAnswer} from '../docs/answer-review.mjs';
const person=n=>({name:'Spieler '+n,status:'pending',team:''});
function fill(n){let roster={};for(let i=1;i<=n;i++){const res=approval(roster,'user_'+i,person(i),'t1');assert.ok(res.accepted);roster=res.roster;}return roster;}
test('Host plus acht eingelassene Spieler, nie neun',()=>{
 assert.equal(MAX_PLAYERS,8);let r=fill(8);assert.equal(approvedCount(r),8);assert.equal(freeSlots(r),0);
 const denied=approval(r,'user_9',person(9),'t2');assert.equal(denied.accepted,false);assert.deepEqual(denied.roster,r);assert.match(denied.reason,/8/);
});
test('Achter Spieler darf Team wechseln; bereits belegter Platz wird nicht doppelt gezählt',()=>{
 const r=fill(8), changed=approval(r,'user_4',person(4),'t2');assert.ok(changed.accepted);
 assert.equal(approvedCount(changed.roster),8);assert.equal(changed.roster.user_4.team,'t2');assert.equal(r.user_4.team,'t1');
});
test('Entfernung gibt einen Platz frei; neuer Spieler kann rein',()=>{
 const r=fill(8);delete r.user_5;assert.equal(freeSlots(r),1);const ninth=approval(r,'user_9',person(9),'t1');assert.ok(ninth.accepted);assert.equal(freeSlots(ninth.roster),0);
});
test('Ungültige Spieler-IDs und Teams werden abgewiesen',()=>{
 for(const id of ['','../../secret','__proto__'])assert.throws(()=>approval({},id,person(1),'t1'));
 for(const team of ['','HOST','t99'])assert.throws(()=>approval({},'user_1',person(1),team));
});
test('Die acht Review-Karten enthalten vor der Freigabe keine Antworten',()=>{
 const roster=fill(8), expected=participantSnapshot(roster);assert.equal(participantLabels(roster).length,8);
 const responses=Object.fromEntries(Object.keys(roster).map((uid,i)=>[uid,{text:'Supergeheim'+i}]));
 assert.equal(answerProgress(expected,responses).complete,true);
 const review=makeAnswerReview(expected,responses,2);
 assert.equal(Object.keys(review.entries).length,8);
 assert.ok(!JSON.stringify(review).includes('Supergeheim'));
 const released=revealAnswer(review,'user_8',responses.user_8);
 assert.equal(Object.values(released.entries).filter(e=>e.revealed).length,1);
});
test('Früherer Review-Fallback kappt manipulierte 20er-Teilnehmerliste auf acht',()=>{
 const oversized=Object.fromEntries(Array.from({length:20},(_,i)=>['user_'+i,{name:'Spieler '+i,team:'t1'}]));
 assert.equal(Object.keys(participantSnapshot(oversized)).length,8);
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
 assert.match(y,/needs: check/);assert.doesNotMatch(y,/vars.FIREBASE/);assert.match(y,/npm run build:pages/);
 assert.match(y,/deploy-pages@v4/);
});
