import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createHistoryEntry,historyRows,responseStatus,csvSafeCell,historyCsv} from '../docs/history-model.mjs';
import {normalizeElement,templateScene,publicScene} from '../docs/studio-model.mjs';
import {makeAnswerReview,revealAnswer} from '../docs/answer-review.mjs';
const q={id:'q-01',category:'Trivia',title:'Interner Titel',prompt:'Welche Fähigkeit?',points:400,solution:''};
test('Historieneinträge enthalten die richtige Runde und begrenzte Host-Metadaten',()=>{
 const entry=createHistoryEntry(q,3,1000);assert.deepEqual({...entry,askedAt:0},{questionId:'q-01',round:3,category:'Trivia',title:'Interner Titel',prompt:'Welche Fähigkeit?',points:400,solution:'',askedAt:0});
 assert.equal(entry.solution,'');
});
test('Historie ordnet Antworten und Richtig-/Falschwertung der richtigen Runde zu',()=>{
 const journal={'1':createHistoryEntry(q,1),'2':createHistoryEntry({...q,id:'q-02'},2)};
 const submissions={'1':{abc:{text:'X'}},'2':{abc:{text:'A'},def:{text:'C'}}};
 const score={abc:{rounds:{'1':{result:'wrong',delta:-200},'2':{result:'correct',delta:400}}},def:{rounds:{'2':{result:'wrong',delta:-200}}}};
 const rows=historyRows(journal,submissions,score,{abc:{name:'Alex'},def:{name:'Ben'}});
 assert.deepEqual(rows.map(r=>r.round),[2,1]);assert.equal(rows[0].correctCount,1);assert.equal(rows[0].wrongCount,1);
 assert.equal(rows[0].participants.find(p=>p.name==='Alex').answer,'A');assert.equal(rows[0].participants.find(p=>p.name==='Ben').delta,-200);
 assert.equal(rows[1].participants[0].status,'wrong');
});
test('Leere Antworten und fehlende Bewertungen sind eindeutig markiert',()=>{
 const rows=historyRows({'1':createHistoryEntry(q,1)},{'1':{abc:{text:'Hi'}}},{},{abc:{name:'Alex'}});
 assert.equal(rows[0].participants[0].status,'open');assert.equal(rows[0].participants[0].delta,null);
 assert.equal(responseStatus('open').label,'Nicht bewertet');
});
test('Nicht erfasste Antwort erzeugt keinen erfundenen Schätzwert',()=>{
 const rows=historyRows({'1':createHistoryEntry(q,1)},{},{abc:{rounds:{'1':{result:'correct',delta:400}}}},{abc:{name:'Alex'}});
 assert.equal(rows[0].participants[0].answer,'');assert.equal(rows[0].participants[0].status,'correct');
});
test('Verlauf und CSV führen mündliche Teamwertungen mit tatsächlichem Betrag und doppeltem Fragewert',()=>{
 const entry=createHistoryEntry({...q,points:20000,answerText:'Musterlösung'},3);
 entry.oralVerdicts={first:{name:'Alice · Rot',result:'wrong',delta:-10000},second:{name:'Bob · Blau',result:'correct',delta:20000}};
 const [row]=historyRows({'3':entry},{},{},{});
 assert.equal(row.points,20000);
 assert.equal(row.solution,'Musterlösung');
 assert.equal(row.submittedCount,0);
 assert.deepEqual(row.participants.map(({name,status,delta})=>[name,status,delta]),[
  ['Alice · Rot','wrong',-10000],['Bob · Blau','correct',20000]
 ]);
 assert.match(historyCsv([row]),/"Alice · Rot";"Mündliche Antwort";"Falsch";"-10000"/);
});
test('CSV-Export neutralisiert Formelinjektionen',()=>{
 for(const v of ['=1+1','+SUM(1,1)','@cmd','-2'])assert.ok(csvSafeCell(v).startsWith('"\''));
 const csv=historyCsv(historyRows({'1':createHistoryEntry(q,1)},{'1':{abc:{text:'=IMPORTXML()'}}},{},{abc:{name:'Alex'}}),{'q-01':'B'});
 assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes("'=IMPORTXML()"));
});
test('Individuelle HEX-Farben werden sicher übernommen, CSS-Injektionen verworfen',()=>{
 assert.equal(normalizeElement({fill:'#123abc'}).fill,'#123abc');
 assert.equal(normalizeElement({bg:'#FEDCBA'}).bg,'#fedcba');
 assert.equal(normalizeElement({fill:'red; color:evil'}).fill,'#ffffff');
});
test('Schrittweise Freigabe enthält vor der Hostfreigabe keine Antworttexte',()=>{
 const board=makeAnswerReview({abc:{name:'Alex'},def:{name:'Ben'}},{abc:{text:'Ahri'},def:{text:'Ashe'}},3);
 assert.ok(!JSON.stringify(board).includes('Ahri'));assert.ok(!JSON.stringify(board).includes('Ashe'));
 const changed=revealAnswer(board,'abc',{text:'Ahri'});assert.ok(JSON.stringify(changed).includes('Ahri'));assert.ok(!JSON.stringify(changed).includes('Ashe'));
});
test('Musterlösung-Elemente einer Szene bleiben vor Aufdeckung außerhalb der Daten',()=>{
 const scene=templateScene('hints',q);scene.elements[1].text='geheim';scene.elements[1].step=6;
 assert.ok(!JSON.stringify(publicScene(scene,0,false)).includes('geheim'));
});
test('P2P-Historie bleibt ausschließlich beim Host und wird nicht als Gast-Snapshot verteilt',()=>{
 const peer=fs.readFileSync(new URL('../docs/peer-client.mjs',import.meta.url),'utf8');
 const snapshot=peer.slice(peer.indexOf('_snapshotFor(ctx){'),peer.indexOf('_sendSnapshot(ctx){'));
 assert.doesNotMatch(snapshot,/questionHistory|hostQuiz/);
 const sw=fs.readFileSync(new URL('../docs/sw.js',import.meta.url),'utf8');
 assert.ok(sw.includes('history-model.mjs'));assert.ok(!sw.includes('questionHistory'));
});
