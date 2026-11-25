import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizedQuiz,publicQuestion,VERSION} from '../docs/core.mjs';
import {element,templateScene,reconcileQuestion,renderScene,publicScene} from '../docs/studio-model.mjs';
import {applyBuzzerJudgement,canBuzz} from '../docs/round-rules.mjs';

const app=readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
test('3.6 live: version, hints and shared team chat stay expanded after updates',()=>{
 assert.equal(VERSION,'3.6.2');
 assert.match(app,/const expanded=\[\.\.\.document\.querySelectorAll\('#app details\[data-bq-persist\]\[open\]'\)\]/);
 assert.match(app,/if\(item\)item\.open=true/);
 assert.match(app,/Tipp '\+Math\.min\(4,Number\(q\.hintStep/);
 assert.match(app,/data-bq-persist="teamchat"/);
});
test('3.6: image imposter supports 8 independently named images, no original answer leakage',()=>{
 const scene=templateScene('imposter',{prompt:'Finde das falsche Bild'});
 for(let i=4;i<8;i++)scene.elements.push(element('image',{x:40+(i-4)*230,y:380,w:180,h:150,alt:'Bild '+(i+1)}));
 const img='data:image/png;base64,aGVsbG8=';
 const images=scene.elements.filter(e=>e.kind==='image');
 assert.equal(images.length,8);
 images.forEach((el,i)=>{el.alt='Grafik '+(i+1);el.src=img;});
 const q={id:'imposter-eight',category:'Grafiken',title:'Acht Bilder',type:'imposter',prompt:'Welche ist ersetzt?',answer:'Bild 8',imposterIndex:7,correctIcon:img,scene};
 reconcileQuestion(q);assert.equal(q.icons.length,8);assert.equal(q.abilityNames.length,8);
 const norm=normalizedQuiz({questions:[q]}).questions[0];
 assert.equal(norm.icons.length,8);
 const hidden=publicQuestion(norm,false,'',0,0);
 assert.equal(hidden.icons.length,8);assert.equal(hidden.abilityNames.length,8);
 for(const secret of ['answer','imposterIndex','correctIcon'])assert.equal(Object.hasOwn(hidden,secret),false);
 const shown=publicQuestion(norm,true,'',0,6);
 assert.equal(shown.imposterIndex,7);
 assert.match(renderScene(publicScene(shown.scene,6,true),{revealed:true,correctIndex:7}),/AUSGETAUSCHT/);
});
test('3.6: multiple distinct winners can be judged after wrong buzz without reopening for the failed team',()=>{
 let state={phase:'question',round:1,current:{id:'q',roundMode:'buzzer',points:200},scoreMode:'team',settings:{buzzerEnabled:true},teams:{t1:'Rot',t2:'Blau'},scores:{t1:0,t2:0}};
 const fail=applyBuzzerJudgement(state,{'1':{uid:'a',team:'t1',name:'Alice'}},{round:1,uid:'a',result:'wrong'});
 state=fail.state;assert.equal(state.scores.t1,-100);
 assert.equal(canBuzz(state,fail.buzzers,'b','t1'),false);
 assert.equal(canBuzz(state,fail.buzzers,'c','t2'),true);
 const win=applyBuzzerJudgement(state,{'1':{uid:'c',team:'t2',name:'Charlie'}},{round:1,uid:'c',result:'correct'});
 assert.equal(win.state.scores.t2,200);assert.equal(canBuzz(win.state,win.buzzers,'d','t2'),false);
});
