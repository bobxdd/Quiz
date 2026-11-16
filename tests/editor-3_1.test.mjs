import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizedQuiz} from '../docs/core.mjs';
import {changeSelectedQuestions,reuseQuestion,selectionSummary,quizAudit,createActionLease} from '../docs/editor-workflows.mjs';
import {createStudioEditor} from '../docs/studio-editor.mjs';
const fixture=()=>normalizedQuiz({categories:['Champions','Lore'],questions:[
 {id:'q1',category:'Champions',title:'Name',type:'text',points:100,prompt:'Wer?',answer:'Qiyana'},
 {id:'q2',category:'Champions',title:'Item',type:'text',points:200,prompt:'Was?',answer:'Schwert'},
 {id:'q3',category:'Lore',title:'Region',type:'text',points:300,prompt:'Wo?',answer:'Ionia'}
]});
test('3.1 Sammelbearbeitung verändert nur gewählte IDs und ist mit Undo-Snapshot kompatibel',()=>{
 const q=fixture(),before=structuredClone(q);
 assert.equal(selectionSummary(q,['q1','q2','not-a-question']).count,2);
 assert.equal(changeSelectedQuestions(q,['q1','q2'],{category:'Lore',points:500}),2);
 assert.deepEqual(q.questions.slice(0,2).map(x=>[x.category,x.points]),[['Lore',500],['Lore',500]]);
 assert.deepEqual(q.questions[2],before.questions[2]);
 assert.throws(()=>changeSelectedQuestions(q,['q2'],{points:10001}),/Punkte/);
 assert.throws(()=>changeSelectedQuestions(q,['q2'],{category:'Missing'}),/Kategorie/);
});
test('3.1 Fragenbank erstellt eigenständige vollständige Kopie ohne das Original zu ändern',()=>{
 const q=fixture(),original=structuredClone(q.questions[0]);
 const copy=reuseQuestion(q,'q1','Lore','new-unique-id');
 assert.equal(q.questions.length,4);assert.equal(copy.id,'new-unique-id');assert.equal(copy.category,'Lore');
 copy.answer='VERÄNDERT';assert.deepEqual(q.questions[0],original);
 assert.throws(()=>reuseQuestion(q,'q1','Lore','q1'),/ID/);
});
test('3.1 Quizprüfung blockiert ungültige Fragen, unterscheidet Warnungen',()=>{
 const q=fixture();assert.equal(quizAudit(q).ready,true);
 q.questions[0].prompt='';q.questions[0].answer='';
 const r=quizAudit(q);assert.equal(r.ready,false);assert.ok(r.errors.some(x=>x.id==='q1'));
 const good=fixture();good.questions[1].points=100;
 const a=quizAudit(good);assert.equal(a.ready,true);assert.ok(a.warnings.some(x=>x.id==='q2'));
 assert.equal(quizAudit(normalizedQuiz({categories:['Leer']})).ready,false);
});
test('3.1 parallele Hostaktionen: nur eine wird ausgeführt und Fehler sperren nicht dauerhaft',async()=>{
 const lease=createActionLease();let count=0;let release;
 const hold=new Promise(r=>release=r);
 const a=lease.run('room:r1:reveal',async()=>{count++;await hold;});
 const second=await lease.run('room:r1:reveal',async()=>{count++;});
 assert.equal(second,false);assert.equal(count,1);release();await a;
 await assert.rejects(lease.run('boom',async()=>{throw Error('network');}),/network/);
 assert.equal(await lease.run('boom',async()=>{count++;}),true);assert.equal(count,2);
});
test('3.1 Editor zeigt Quizcheck und Fragenbank nur im privaten Editor',()=>{
 const q=fixture();const x=createStudioEditor({getQuiz:()=>q,getQuestion:()=>q.questions[0],saveStatus:()=> 'Gespeichert',isOffline:()=>true,onlineReady:()=>false});
 const overview=x.html();assert.match(overview,/se-save-badge/);assert.match(overview,/data-se-action="audit"/);
 const app=readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 assert.match(app,/hostActionLease\.run/);
 assert.match(app,/class="bq-action-bar bq-host-action-bar"/);
 assert.match(app,/if\(!hasLiveQuestion\(\)\)return boardScene\(false\)/);
});
test('3.1 Service Worker enthält vollständige neue Shell und kein privates Quiz',()=>{
 const sw=readFileSync(new URL('../docs/sw.js',import.meta.url),'utf8');
 assert.match(sw,/brainquiz-shell-3\.6\.7/);assert.match(sw,/editor-workflows\.mjs/);assert.match(sw,/editor-31\.css/);
 assert.doesNotMatch(sw,/brainquiz\.json|answers\/private/);
});
