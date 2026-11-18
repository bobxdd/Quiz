import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizedQuiz,publicQuestion} from '../docs/core.mjs';
import {templateScene,renderScene} from '../docs/studio-model.mjs';
import {renderAnswerView} from '../docs/answer-view.mjs';

const read=name=>readFileSync(new URL('../docs/'+name,import.meta.url),'utf8');
const wrong='data:image/png;base64,AAAA';
const original='data:image/png;base64,BBBB';

test('Imposter is secret while playing; wrong slot remains visible and marked after reveal',()=>{
 const scene=templateScene('imposter',{prompt:'Welches Icon passt nicht?',icons:Array(5).fill(wrong)});
 const question=normalizedQuiz({questions:[{id:'imp-card',type:'imposter',
  category:'Champions',title:'Imposter',points:400,prompt:'Welches Icon passt nicht?',
  scene,icons:Array(5).fill(wrong),imposterIndex:3,correctIcon:original,answerText:'Das E-Icon wurde ersetzt.'}]}).questions[0];
 const before=publicQuestion(question,false,'',0,0);
 assert.equal(before.answer,undefined);
 assert.equal(before.imposterIndex,undefined);
 assert.equal(before.correctIcon,undefined);
 assert.ok(!JSON.stringify(before).includes(original),'correct icon must not reach players early');
 const after=publicQuestion(question,true,'',0,6);
 assert.equal(after.imposterIndex,3);
 assert.equal(after.correctIcon,original);
 assert.equal(after.icons[3],wrong,'the misleading tile must not get silently replaced');
 const sceneImages=after.scene.elements.filter(x=>x.kind==='image');
 assert.equal(sceneImages[3].src,wrong);
 assert.equal(sceneImages.length,5);
 const grid=renderScene(after.scene,{revealed:true,correctIndex:after.imposterIndex});
 assert.equal((grid.match(/se-imposter-image/g)||[]).length,1);
 assert.match(grid,/AUSGETAUSCHT/);
 assert.match(renderAnswerView(after),/Das E-Icon wurde ersetzt/);
 assert.match(renderAnswerView(after),/data:image\/png;base64,BBBB/);
});

test('Rewind is presentation-only, host-authorized and available after correct buzzer verdict',()=>{
 const app=read('app.mjs');
 const core=read('core.mjs');
 const peer=read('peer-client.mjs');
 assert.match(app,/function hostPreviousReveal\(/);
 assert.match(app,/case 'reveal-prev':await hostPreviousReveal/);
 assert.match(app,/case 'solution-forward':await hostRepeatSolution/);
 assert.match(app,/const showAnswer=isReveal&&publicState\.solutionVisible!==false/);
 assert.match(app,/phase:'reveal',solutionVisible:true/);
 assert.match(app,/\{solutionVisible:false\},\['reveal'\]/);
 assert.match(app,/\{solutionVisible:true\},\['reveal'\]/);
 assert.match(app,/Schritt zurück · Frage ansehen/);
 assert.match(peer,/async judgeBuzzer\(/);
 assert.match(peer,/Publish the score, winning buzzer, question answer and closing phase as ONE/);
 assert.match(core,/if\(q\.type==='imposter'\)\{pub\.imposterIndex=q\.imposterIndex;pub\.correctIcon=q\.correctIcon;/);
});

test('One-screen CSS fits the original 1000x560 question stage to remaining container height',()=>{
 const css=read('host-flow.css');
 for(const needle of ['ONE-SCREEN QUESTION LAYOUT 2026-11','container-type:size','156cqh',
  'bq-stage-is-answer','grid-template-areas:"question answer"','max-height:100%',
  'se-imposter-image','bq-guest-reveal-status','padding-bottom:0!important']){
  assert.ok(css.includes(needle),needle);
 }
 assert.match(css,/\.bq-question-scene \.bq-answer-view-content/);
 assert.match(css,/body\.bq-game-mode:has\(\.bq-question-scene\)/);
 assert.match(read('app.mjs'),/bq-host-info-wrap/);
 assert.match(read('app.mjs'),/renderAnswerView\(q\)/);
});
