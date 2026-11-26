import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {quickBoard,categoryColumns,STANDARD_POINTS,judgementDelta,updatePlayerScore,emptyQuiz,normalizedQuiz,buildPublicBoard,manualPlayerLabels} from '../docs/core.mjs';
import {reorderCategoryQuestions} from '../docs/category-model.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
test('Schnellset erzeugt 25 eigenständige Fragen auf 100 bis 500 Punkten',()=>{
 const qs=quickBoard(['Champions','Items','Lore','Splash Art','Fähigkeiten']);
 assert.equal(qs.length,25);assert.equal(new Set(qs.map(q=>q.id)).size,25);
 assert.deepEqual(qs.slice(0,5).map(q=>q.points),STANDARD_POINTS);
 assert.deepEqual(categoryColumns(qs).map(x=>x.items.length),[5,5,5,5,5]);
});
test('Manuelle Reihenfolge bleibt nach Import und auf dem öffentlichen Brett auf ihre Kategorie und Runde begrenzt',()=>{
 const original=normalizedQuiz({questions:[
  {id:'10',category:'Lore',points:100},{id:'other',category:'Items',points:200},
  {id:'3',category:'Lore',points:200},{id:'later',category:'Lore',boardRound:2,points:250},
  {id:'2',category:' lore ',points:300},{id:'only',category:'Items',points:100}
 ]});
 assert.equal(reorderCategoryQuestions(original.questions,'2','later','before'),null);
 assert.equal(reorderCategoryQuestions(original.questions,'10','other','after'),null);
 assert.equal(reorderCategoryQuestions(original.questions,'10','3','before'),null);
 const reordered=reorderCategoryQuestions(original.questions,'2','10','before');
 assert.deepEqual(reordered.map(q=>q.id),['2','other','10','later','3','only']);
 assert.equal(original.questions[0].manualOrder,undefined);
 const saved=normalizedQuiz(JSON.parse(JSON.stringify({...original,questions:reordered})));
 const board=buildPublicBoard(saved);
 assert.equal(board.later.boardPosition,undefined);
 const columns=categoryColumns(Object.values(board).filter(q=>q.boardRound===1));
 assert.deepEqual(columns.find(c=>c.category.trim().toLowerCase()==='lore').items.map(q=>q.id),['2','10','3']);
 assert.deepEqual(columns.find(c=>c.category==='Items').items.map(q=>q.points),[100,200]);
 assert.equal(board['2'].points,300);
});
test('Richtig gibt volle Punktzahl, falsch zieht die Hälfte ab, auch bei ungeraden Punkten',()=>{
 assert.equal(judgementDelta(300,'correct'),300);
 assert.equal(judgementDelta(300,'wrong'),-150);
 assert.equal(judgementDelta(101,'wrong'),-50.5);
});
test('Wiederholte Richtig-Bewertung führt nicht zu doppelten Punkten',()=>{
 const item={kind:'judgement',round:'3',questionId:'q3',points:400,result:'correct',at:1};
 const first=updatePlayerScore({},item),second=updatePlayerScore(first,item);
 assert.equal(first.total,400);assert.equal(second.total,400);assert.equal(second.history.length,1);
});
test('Richtig wird durch Falsch ersetzt, vorherige Wertung wird abgezogen',()=>{
 const item={kind:'judgement',round:'4',questionId:'q4',points:200,result:'correct',at:1};
 const correct=updatePlayerScore({},item),wrong=updatePlayerScore(correct,{...item,result:'wrong',at:2});
 assert.equal(wrong.total,-100);assert.equal(wrong.history.at(-1).delta,-300);
});
test('Mehrere Spieler werden unabhängig gewertet',()=>{
 const data={};for(const id of ['A','B'])data[id]=updatePlayerScore({}, {kind:'judgement',round:'1',questionId:'q1',points:500,result:id==='A'?'correct':'wrong'});
 assert.equal(data.A.total,500);assert.equal(data.B.total,-250);
});
test('Manuelle Korrektur bleibt unabhängig von der Fragenbewertung',()=>{
 const first=updatePlayerScore({}, {kind:'judgement',round:'6',points:300,result:'correct'});
 const manual=updatePlayerScore(first,{kind:'manual',delta:-75,at:3});
 const wrong=updatePlayerScore(manual,{kind:'judgement',round:'6',points:300,result:'wrong'});
 assert.equal(manual.total,225);assert.equal(wrong.total,-225);
});
test('Ungültige Werte und negative Limits werden abgelehnt',()=>{
 for(const data of [{kind:'manual',delta:10001},{kind:'manual',delta:0},{kind:'judgement',round:'xx',points:100,result:'correct'}])assert.throws(()=>updatePlayerScore({},data));
 assert.throws(()=>judgementDelta(-1,'wrong'));
});
test('Export & Import erhalten manuell angelegte Spieler',()=>{
 const q=normalizedQuiz({...emptyQuiz(),manualPlayers:['A','B'],questions:[]});
 assert.deepEqual(normalizedQuiz(JSON.parse(JSON.stringify(q))).manualPlayers,['A','B']);
 assert.deepEqual(manualPlayerLabels(q),{manual_1:'A',manual_2:'B'});
});
test('Öffentliches Quizbrett gibt nur Punktwert und Kategorie preis – keinen Fragetitel',()=>{
 const q={id:'secret',category:'Champion',title:'Die Lösung ist Ahri',points:500,type:'text',prompt:'Name?',answer:'Ahri'};
 const board=buildPublicBoard({questions:[q]});
 assert.ok(!JSON.stringify(board).includes('Ahri'));
 assert.equal(board.secret.points,500);
});
