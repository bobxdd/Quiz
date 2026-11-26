import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizedQuiz,validateQuestion,publicQuestion} from '../docs/core.mjs';
import {quizAudit} from '../docs/editor-workflows.mjs';
import {answerViewContent} from '../docs/answer-view.mjs';
const src=p=>readFileSync(new URL('../docs/'+p,import.meta.url),'utf8');

test('0-point questions survive normalization, export and subsequent import without silently becoming 100',()=>{
 const q=normalizedQuiz({questions:[{id:'zero',category:'Spiel',type:'text',prompt:'Test?',answer:'Ja',points:0}]}).questions[0];
 assert.equal(q.points,0);
 assert.equal(normalizedQuiz({questions:[q]}).questions[0].points,0);
 assert.equal(publicQuestion(q,false).points,0);
 assert.equal(validateQuestion(q),'');
 assert.equal(normalizedQuiz({questions:[{prompt:'Test?',answer:'Ja',points:'invalid'}]}).questions[0].points,100);
 assert.equal(normalizedQuiz({questions:[{prompt:'Test?',answer:'Ja',points:null}]}).questions[0].points,100);
});

test('Question readiness reflects quiz validation, not merely presence of an editor scene',()=>{
 const quiz=normalizedQuiz({questions:[
  {id:'one',category:'Champions',title:'One',prompt:'Who?',answer:'',scene:{template:'text',elements:[{id:'heading',kind:'text',role:'question',text:'Who?',step:0}]}},
  {id:'two',category:'Items',title:'Two',prompt:'What?',answerText:'An item'}
 ]});
 const report=quizAudit(quiz);
 assert.ok(report.errors.some(x=>x.id==='one'&&x.reason.includes('Antwort-Tab')));
 assert.ok(!report.errors.some(x=>x.id==='two'));
 const editor=src('studio-editor.mjs');
 assert.ok(editor.includes('invalidIds.has(x.id)'));
 assert.ok(editor.includes('case \'open-next-issue\':'));
 assert.ok(editor.includes('focusIssue:id=>'));
});

test('Pure answer content is recomputed without prematurely publishing media',()=>{
 const q=normalizedQuiz({questions:[{id:'image-only',category:'Images',type:'text',prompt:'Who?',answerImage:'data:image/png;base64,AAAA',answerImageAlt:'Answer illustration'}]}).questions[0];
 assert.ok(answerViewContent(q).image);
 const hidden=publicQuestion(q,false);
 assert.equal(hidden.answerImage,undefined);
 assert.equal(hidden.answerImageAlt,undefined);
 assert.equal(publicQuestion(q,true).answerImageAlt,'Answer illustration');
 const editor=src('studio-editor.mjs');
 assert.match(editor,/function refreshAnswerPreview\(\)/);
 assert.match(editor,/root\.addEventListener\('paste'/);
 assert.match(editor,/event\.preventDefault\(\)/);
 assert.match(editor,/requestAnimationFrame\(\(\)=>document\.querySelector\('\.se-editor-pane-tabs/);
});

test('Quizcheck flags untouched question placeholders even when an answer is filled',()=>{
 const quiz=normalizedQuiz({questions:[
  {id:'template',category:'Items',title:'Template',prompt:'Frage eingeben',answerText:'Ja'},
  {id:'complete',category:'Items',title:'Complete',prompt:'Frage eingeben',answerText:'Ja',scene:{
   template:'text',elements:[{kind:'text',role:'question',text:'Welche Fähigkeit?',step:0}]
  }}
 ]});
 const report=quizAudit(quiz);
 assert.equal(report.ready,true);
 assert.deepEqual(report.warnings.filter(x=>x.reason.includes('Platzhalter')).map(x=>x.id),['template']);
});

test('Dedicated editor tab controls always have corresponding panels and issue routing',()=>{
 const editor=src('studio-editor.mjs');
 assert.ok(editor.includes('id="se-answer-tabpanel" role="tabpanel"'));
 assert.ok(editor.includes('id="se-question-tabpanel" role="tabpanel"'));
 assert.ok(editor.includes('problem.includes(\'Antwort-Tab\')'));
 const app=src('app.mjs');
 assert.match(app,/studio\.focusIssue\?\.\(audit\.errors\[0\]\?\.id\)/);
});
