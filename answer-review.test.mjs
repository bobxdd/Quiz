import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {participantSnapshot,answerProgress,makeAnswerReview,revealAnswer,reviewIsCurrent} from '../docs/answer-review.mjs';
const roster=n=>Object.fromEntries(Array.from({length:n},(_,i)=>['user_'+(i+1),{name:'Spieler '+(i+1),team:'t'+((i%2)+1)}]));
const responses=(n,type='estimate')=>Object.fromEntries(Array.from({length:n},(_,i)=>['user_'+(i+1),{uid:'user_'+(i+1),team:'t1',text:type==='estimate'?String(100+i):`Antwort ${i+1}`} ]));
for(const n of [4,5,6,7,8])test(`Gemeinsamer Review bei ${n} Spielern bleibt bis zur letzten Antwort geschlossen`,()=>{
 const expected=participantSnapshot(roster(n));const part=responses(n-1);assert.deepEqual(answerProgress(expected,part),{total:n,submitted:n-1,complete:false});
 assert.deepEqual(answerProgress(expected,responses(n)),{total:n,submitted:n,complete:true});
 const board=makeAnswerReview(expected,responses(n),17);
 assert.equal(Object.keys(board.entries).length,n);
 const json=JSON.stringify(board);for(let i=0;i<n;i++)assert.ok(!json.includes('"value"'),'Private Werte dürfen nie in verdeckten Karten sein');
});
test('Host enthüllt gezielt eine einzige Schätzung, alle anderen bleiben tatsächlich ohne Wert',()=>{
 const expected=participantSnapshot(roster(8)),privateAnswers=responses(8),initial=makeAnswerReview(expected,privateAnswers,3);
 const revealed=revealAnswer(initial,'user_3',privateAnswers.user_3);
 assert.equal(revealed.entries.user_3.value,'102');assert.equal(revealed.entries.user_3.revealed,true);
 assert.equal(Object.keys(revealed.entries).filter(id=>Object.hasOwn(revealed.entries[id],'value')).length,1);
 assert.ok(!Object.hasOwn(initial.entries.user_3,'value'),'Eingangsstatus darf nicht mutiert werden');
 assert.equal(revealed.entries.user_1.revealed,false);
});
test('Aufdeckung gibt generische Texte über neun Fragetypen frei, ohne die Fragenschablone zu verändern',()=>{
 const formats=['estimate','multiple','text','order','emoji','quote','audio','splash','imposter'];
 for(const type of formats){const expected=participantSnapshot(roster(4)),privateAnswers=responses(4,type);const b=makeAnswerReview(expected,privateAnswers,4);
  assert.equal(JSON.stringify(b).includes(privateAnswers.user_1.text),false);
  const changed=revealAnswer(b,'user_1',privateAnswers.user_1);
  assert.equal(changed.entries.user_1.value,privateAnswers.user_1.text);
 }
});
test('Teilnehmer ohne Antwort werden grau angezeigt, nicht fälschlich enthüllt',()=>{
 const board=makeAnswerReview(participantSnapshot(roster(6)),responses(4),23);
 assert.equal(board.entries.user_6.submitted,false);
 assert.throws(()=>revealAnswer(board,'user_6',{}),/keine Antwort/);
});
test('Nicht zur Fragerunde gehörende oder manipulierte Benutzer-IDs sind gesperrt',()=>{
 const b=makeAnswerReview(participantSnapshot(roster(4)),responses(4),9);
 for(const id of ['user_99','__proto__','../../owner'])assert.throws(()=>revealAnswer(b,id,{text:'Geheim'}));
});
test('Ablauf löscht bei jeder neuen Runde die Freigabe vom vorherigen Rundenzustand',()=>{
 const expected=participantSnapshot(roster(4));const board=makeAnswerReview(expected,responses(4),16);
 assert.equal(reviewIsCurrent({round:16,phase:'review',answerReview:board}),true);
 assert.equal(reviewIsCurrent({round:17,phase:'review',answerReview:board}),false);
 assert.equal(reviewIsCurrent({round:16,phase:'question',answerReview:board}),false);
 assert.equal(reviewIsCurrent({round:16,phase:'reveal',answerReview:board}),true);
});
test('Leere oder unerwartete Antworten werden nicht aufgedeckt',()=>{
 const expected=participantSnapshot(roster(4));const b=makeAnswerReview(expected,responses(4),5);
 assert.throws(()=>revealAnswer(b,'user_2',{text:'   '}),/nicht geladen/);
 assert.equal(answerProgress(expected,{'user_1':{text:'  '}}).submitted,0);
});
test('Vollständig verdecktes Raster enthält nur Namen, Status und keine Lösung',()=>{
 const expected=participantSnapshot(roster(8));const input=responses(8);input.user_5.text='GEHEIME-LOESUNG';
 const board=makeAnswerReview(expected,input,3);
 assert.ok(!JSON.stringify(board).includes('GEHEIME-LOESUNG'));
 assert.ok(!JSON.stringify(board).includes('Antwort'));
});
test('P2P: Host sendet weder fremde Antworten noch private Lösungen an Gäste',()=>{
 const peer=readFileSync(new URL('../docs/peer-client.mjs',import.meta.url),'utf8');
 assert.match(peer,/this\.data\.responses\?\.\[round\]\?\.\[ctx\.uid\]/);
 assert.match(peer,/this\.data\.messages\?\.\[member\.team\]/);
 assert.match(peer,/this\.data\.public/);
 assert.doesNotMatch(peer.slice(peer.indexOf('_snapshotFor(ctx){'),peer.indexOf('_sendSnapshot(ctx){')),/hostQuiz/);
});
test('Publizierte Review-Karten bekommen nur aufgedeckten Wert und keine Rohantworten der übrigen',()=>{
 const exp=participantSnapshot(roster(8)),priv=responses(8);let b=makeAnswerReview(exp,priv,6);
 for(const id of ['user_8','user_1','user_4']){
  b=revealAnswer(b,id,priv[id]);
  for(const other of Object.keys(priv).filter(x=>!b.entries[x].revealed))assert.ok(!Object.hasOwn(b.entries[other],'value'));
 }
 assert.equal(Object.keys(b.entries).filter(id=>b.entries[id].revealed).length,3);
});
