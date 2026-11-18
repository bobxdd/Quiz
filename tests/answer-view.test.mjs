import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizedQuiz,publicQuestion,validateQuestion} from '../docs/core.mjs';
import {answerViewContent,hasRequiredAnswer,renderAnswerView} from '../docs/answer-view.mjs';
import {quizAudit} from '../docs/editor-workflows.mjs';

const sample='data:image/png;base64,AAAA';
const base={id:'answer-qa',title:'Antwort QA',category:'League',type:'text',roundMode:'buzzer',points:200,prompt:'Welcher Champion?',answer:''};
const normalize=q=>normalizedQuiz({title:'Answer Audit',questions:[{...base,...q}]}).questions[0];
const source=p=>readFileSync(new URL('../docs/'+p,import.meta.url),'utf8');

test('A mandatory answer tab permits text only, image only or both, but not a blank answer',()=>{
 const missing=normalize({});
 assert.match(validateQuestion(missing),/Antwort-Tab.*Pflicht/);
 assert.equal(hasRequiredAnswer(missing),false);
 assert.match(quizAudit({questions:[missing]}).errors[0].reason,/Antwort/);
 for(const additions of [{answerText:'Anivia'},{answerImage:sample},{answerText:'Anivia',answerImage:sample}]){
  const q=normalize(additions);
  assert.equal(validateQuestion(q),'',JSON.stringify(additions));
  assert.equal(hasRequiredAnswer(q),true);
 }
});

test('Answer image is not transferred before host reveal, including on template scenes',()=>{
 const question=normalize({answerText:'*** GEHEIM ***',answerImage:sample,answerImageAlt:'<Gefährlich>',
  explanation:'Erklärung des Hosts',scene:{template:'text',elements:[{id:'a',kind:'text',step:0,role:'question',text:'Sichtbar',x:20,y:20,w:300,h:100}]}});
 const before=JSON.stringify(publicQuestion(question,false));
 assert.ok(!before.includes('*** GEHEIM ***'));
 assert.ok(!before.includes('data:image/png'));
 assert.ok(!before.includes('answerText'));
 assert.ok(!before.includes('answerImage'));
 assert.ok(!before.includes('Erklärung des Hosts'));
 const after=publicQuestion(question,true,'',0,6);
 assert.equal(after.answerText,'*** GEHEIM ***');
 assert.equal(after.answerImage,sample);
 assert.equal(after.answerImageAlt,'<Gefährlich>');
 const markup=renderAnswerView(after);
 assert.match(markup,/GEHEIM/);
 assert.match(markup,/bq-answer-image/);
 assert.match(markup,/<img/);
 assert.doesNotMatch(markup,/<Gefährlich>/);
 assert.match(markup,/&lt;Gefährlich&gt;/);
});

test('All question types retain appropriate legacy automatic answers after migration',()=>{
 for(const [name,props,expected] of [
  ['multiple',{type:'multiple',options:['Irelia','Jinx','Sona','Zeri'],correct:1},'Jinx'],
  ['order',{type:'order',orderItems:['Alpha','Beta','Gamma']},'Alpha'],
  ['estimate',{type:'estimate',estimateTarget:44,estimateUnit:'km'},'44 km'],
  ['map',{type:'map',mapTargetSet:true,mapTargetX:50,mapTargetY:50},'Dolch'],
  ['imposter',{type:'imposter',imposterIndex:2,correctIcon:sample,icons:[sample,sample]},'Ersetztes Bild'],
  ['splash',{type:'splash',image:sample},'bq-answer-image']
 ]){
  const q=normalize(props);
  assert.equal(hasRequiredAnswer(q),true,name);
  const view=renderAnswerView(q);
  assert.ok(view.includes(expected),name+' should give a meaningful answer view');
 }
});

test('Explicit user answer overrides automatic option without modifying its correct index',()=>{
 const q=normalize({type:'multiple',options:['A','B','C','D'],correct:2,answerText:'C, wegen der Fähigkeit.'});
 assert.equal(q.correct,2);
 assert.equal(answerViewContent(q).text,'C, wegen der Fähigkeit.');
 assert.equal(publicQuestion(q,false).correct,undefined);
 assert.equal(publicQuestion(q,true).correct,2);
});

test('Unsafe or oversized answer images are stripped on import, and output always escaped',()=>{
 for(const src of ['https://example.com/a.png','javascript:alert(1)','data:image/svg+xml;base64,AAAA',
    'data:image/png;base64,'+'A'.repeat(920000)]){
  const q=normalize({answerImage:src});
  assert.equal(q.answerImage,'');
  assert.match(validateQuestion(q),/Antwort-Tab/);
 }
 const q=normalize({answerText:'<img src=x onerror=alert(1)>',answerImage:sample,
   answerImageAlt:'" onclick="alert(1)'});
 const view=renderAnswerView(q);
 assert.ok(!view.includes('<img src=x'));
 assert.match(view,/&lt;img/);
 assert.ok(!view.includes('" onclick="alert(1)"'));
});

test('Answer view has a dedicated reveal screen while retaining original map, sound and MC context',()=>{
 const app=source('app.mjs'),editor=source('studio-editor.mjs'),css=source('session-ui.css');
 assert.match(app,/renderAnswerView\(q\)/);
 assert.match(app,/bq-answer-context/);
 assert.match(app,/case 'buzz-correct':case 'buzz-wrong':/);
 assert.match(app,/buildRevealPatch\(q\)/);
 assert.match(editor,/data-pane="answer"/);
 assert.match(editor,/data-se-upload="answer-image"/);
 assert.match(editor,/id="se-answer-text"/);
 assert.match(editor,/editorPane==='answer'\?answerEditor\(item\)/);
 assert.match(css,/bq-answer-view-content/);
});
