import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyQuiz,normalizedQuiz,publicQuestion,validateQuestion,buildPublicBoard,judgementDelta,updatePlayerScore} from '../docs/core.mjs';
import {normalizeScene,normalizeElement,templateScene,element,reconcileQuestion,publicScene,renderScene,validateScene} from '../docs/studio-model.mjs';
import {createStudioEditor} from '../docs/studio-editor.mjs';
const make=(template='multiple')=>{const q=normalizedQuiz({questions:[{id:'q1',type:'text',category:'Lore',title:'SECRET-ANSWER-DO-NOT-LEAK',points:200,prompt:'Wer?',answer:'DAS-IST-DIE-LOESUNG',options:['A','B','C','D'] }]}).questions[0];q.scene=templateScene(template,q);reconcileQuestion(q);return q;};
test('Interner Fragetitel darf auch nach Reveal nicht öffentlich sein',()=>{const q=make();for(const reveal of [false,true])assert.ok(!JSON.stringify(publicQuestion(q,reveal)).includes('SECRET-ANSWER-DO-NOT-LEAK'));});
test('Öffentliches Brett enthält keine internen Fragennamen',()=>{const q=make();const board=buildPublicBoard({questions:[q]});assert.ok(!JSON.stringify(board).includes('SECRET-ANSWER-DO-NOT-LEAK'));});
test('Verlegte Hauptfrage bleibt Hauptfrage und synchronisiert Prompt',()=>{const q=make();const heading=q.scene.elements.find(x=>x.role==='question');heading.y=450;heading.text='Wer gewann?';reconcileQuestion(q);assert.equal(q.prompt,'Wer gewann?');assert.equal(q.scene.elements.find(x=>x.role==='question').y,450);});
test('Alter Quizeditor-Stand ohne Rollen erhält eine eindeutige Hauptfrage',()=>{const s=templateScene('multiple');for(const el of s.elements)delete el.role;const migrated=normalizeScene(s);assert.equal(migrated.elements.filter(x=>x.role==='question').length,1);});
test('Geladene manipulierte Elemente (null, primitive Daten) stürzen nicht ab',()=>{assert.doesNotThrow(()=>normalizeScene({template:'order',elements:[null,undefined,false,13,'abc',{kind:'text',text:'OK'}]}));});
test('Unzulässige Bild-URLs werden aus Szene entfernt',()=>{for(const src of ['https://example.com/secret.png','javascript:alert(1)','data:image/svg+xml;base64,PD94bWw='])assert.equal(normalizeElement({kind:'image',src}).src,'');});
test('Aufdeckungsstufen 0, 1, 3 und 6 geben nur Freigegebenes aus',()=>{const q=make('hints');q.scene.elements.push(element('text',{text:'TOPSECRET3',step:3}));q.scene.elements.push(element('text',{text:'TOPSECRET6',step:6}));for(const [step,known] of [[0,[]],[1,['Hinweis 1']],[2,['Hinweis 1','Hinweis 2']],[3,['TOPSECRET3']],[5,['TOPSECRET3']]]){const serialized=JSON.stringify(publicQuestion(q,false,'',0,step));assert.equal(serialized.includes('TOPSECRET3'),step>=3);assert.ok(!serialized.includes('TOPSECRET6'));for(const marker of known)assert.ok(serialized.includes(marker));}assert.ok(JSON.stringify(publicQuestion(q,true,'',0,6)).includes('TOPSECRET6'));});
test('Imposter und Schätzwert bleiben vor Aufdeckung geheim',()=>{const q=make('imposter');q.imposterIndex=4;q.correctIcon='data:image/png;base64,aGVsbG8=';const out=publicQuestion(q,false);assert.equal(Object.hasOwn(out,'imposterIndex'),false);assert.equal(Object.hasOwn(out,'correctIcon'),false);const e=make('estimate');e.estimateTarget=123456;assert.equal(Object.hasOwn(publicQuestion(e,false),'estimateTarget'),false);});
test('Reihenfolge mit zehn individuellen Einträgen ist validerstellbar',()=>{const q=make('order');for(const letter of 'HIJ'){q.scene.elements.push(element('order',{letter,text:'Eintrag '+letter,w:416,h:70,x:40,y:145}));q.scene.sortCorrect.push(letter);}reconcileQuestion(q);assert.equal(q.orderItems.length,10);assert.equal(validateScene(q),'');});
test('Doppelte Sortierbuchstaben und Musterlösungen werden abgewiesen',()=>{const q=make('order');q.scene.elements[1].letter=q.scene.elements[2].letter;assert.match(validateScene(q),/Sortieroptionen/);});
test('Musterreihenfolge F-C-D-A-B-G-E bleibt nach Export und Import erhalten',()=>{const q=make('order');q.scene.sortCorrect=['F','C','D','A','B','G','E'];reconcileQuestion(q);const exported=JSON.stringify(normalizedQuiz({questions:[q]}));const restored=normalizedQuiz(JSON.parse(exported)).questions[0];assert.deepEqual(restored.scene.sortCorrect,['F','C','D','A','B','G','E']);assert.deepEqual(restored.orderItems,q.orderItems);});
test('Fragenlayout mit verschobener Frage bleibt nach Export erhalten',()=>{const q=make();q.scene.elements.find(el=>el.role==='question').x=630;q.scene.elements.find(el=>el.role==='question').w=360;reconcileQuestion(q);const copy=normalizedQuiz(JSON.parse(JSON.stringify({questions:[q]}))).questions[0];assert.equal(copy.scene.elements.find(el=>el.role==='question').x,630);});
test('HTML und Skripte in Antworten werden ausschließlich escaped gerendert',()=>{const q=make();q.scene.elements[1].text='<img src=x onerror=alert(1)>';const rendered=renderScene(q.scene);assert.ok(!rendered.includes('<img src=x onerror='));assert.ok(rendered.includes('&lt;img src=x'));});
test('Geometrie und Schriftgrößen bleiben innerhalb der Fläche',()=>{for(let i=0;i<500;i++){const el=normalizeElement({kind:'shape',w:-100+i*6,h:600-i,x:i*3-200,y:i*2-220,font:i});assert.ok(el.x>=0&&el.y>=0&&el.x+el.w<=1000&&el.y+el.h<=560);assert.ok(el.font>=13&&el.font<=78);}});
test('Duplizierte IDs werden beim Import getrennt',()=>{const scene=normalizeScene({elements:[{id:'same',kind:'text'},{id:'same',kind:'text'}]});assert.notEqual(scene.elements[0].id,scene.elements[1].id);});
test('Maximale Elementanzahl wird auch bei manipuliertem Import begrenzt',()=>{const scene=normalizeScene({elements:Array.from({length:500},(_,i)=>({id:'b'+i,kind:'text',text:'x'}))});assert.equal(scene.elements.length,40);});
test('Antwortenwertung: halbe Punktzahl abziehen und Ersatz ohne Doppelwertung',()=>{let r=updatePlayerScore({}, {kind:'judgement',round:'1',questionId:'q',points:500,result:'correct'});assert.equal(r.total,500);r=updatePlayerScore(r,{kind:'judgement',round:'1',questionId:'q',points:500,result:'wrong'});assert.equal(r.total,-250);r=updatePlayerScore(r,{kind:'manual',delta:100});assert.equal(r.total,-150);});
test('Editor bietet Undo, Redo, Backup und Direkteigenschaften',()=>{const quiz=emptyQuiz();quiz.questions=[make()];const ed=createStudioEditor({getQuiz:()=>quiz,getQuestion:()=>quiz.questions[0],isOffline:()=>true,onlineReady:()=>false});const html=ed.html();for(const attr of ['data-se-action="undo"','data-se-action="redo"','data-se-action="backup"','data-se-action="category-form"','se-category-overview'])assert.ok(html.includes(attr));});
test('Altes Quiz ohne neue Szene wird weiterhin geladen',()=>{const quiz=normalizedQuiz({title:'Legacy',questions:[{id:'old',type:'multiple',prompt:'Alte Frage',options:['A','B','C','D'],answer:'C',correct:2,points:300}]});assert.equal(quiz.questions[0].scene,null);assert.equal(validateQuestion(quiz.questions[0]),'');});
test('Zitat bleibt erhalten, auch wenn das Textelement nach oben verschoben wird',()=>{
 const q=make('quote');const clue=q.scene.elements.find(x=>x.role==='clue');assert.ok(clue);
 clue.y=5;clue.x=200;clue.text='Wem gehört dieses Zitat?';reconcileQuestion(q);
 assert.equal(q.clue,'Wem gehört dieses Zitat?');assert.equal(q.scene.elements.find(x=>x.role==='clue').x,200);
 const restored=normalizedQuiz(JSON.parse(JSON.stringify({questions:[q]}))).questions[0];
 assert.equal(restored.scene.elements.find(x=>x.role==='clue').text,'Wem gehört dieses Zitat?');
});
test('Emoji-Hinweis ist von der Hauptfrage unabhängig positionierbar',()=>{
 const q=make('emoji'),clue=q.scene.elements.find(x=>x.role==='clue');
 clue.y=1;clue.text='🦊 🔥';reconcileQuestion(q);assert.equal(q.clue,'🦊 🔥');
});
test('Mehrfach duplizierte, absichtlich verschobene Texte lassen keinen Lösungstext ins öffentliche Quizbrett gelangen',()=>{
 const q=make('hints');q.scene.elements.push(element('text',{role:'content',text:'LÖSUNG-ENTHÜLLEN',x:50,y:50,step:6}));
 reconcileQuestion(q);const pre=JSON.stringify(publicQuestion(q,false,'',0,0));assert.ok(!pre.includes('LÖSUNG-ENTHÜLLEN'));
 const solved=JSON.stringify(publicQuestion(q,true,'',0,6));assert.ok(solved.includes('LÖSUNG-ENTHÜLLEN'));
});
test('Unterschiedliche Aufdeckungsstufen für frei verschobene Zitate funktionieren',()=>{
 const q=make('quote'),clue=q.scene.elements.find(x=>x.role==='clue');clue.step=2;clue.y=4;clue.text='CLUE-STEP-2';reconcileQuestion(q);
 assert.ok(!JSON.stringify(publicQuestion(q,false,'',0,1)).includes('CLUE-STEP-2'));
 assert.ok(JSON.stringify(publicQuestion(q,false,'',0,2)).includes('CLUE-STEP-2'));
});
