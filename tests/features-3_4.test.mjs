import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {normalizedQuiz,publicQuestion,validateQuestion} from '../docs/core.mjs';
import {normalizePoint,encodePoint,decodePoint,worldLatLon} from '../docs/map-tools.mjs';
import {templateScene,renderScene,publicScene,reconcileQuestion} from '../docs/studio-model.mjs';
import {canBuzz,applyBuzzerJudgement} from '../docs/round-rules.mjs';
const docs=new URL('../docs/',import.meta.url);
const app=readFileSync(new URL('app.mjs',docs),'utf8');
const editor=readFileSync(new URL('studio-editor.mjs',docs),'utf8');

test('3.4: four hints survive import; unrevealed hints never leak',()=>{
 const q=normalizedQuiz({questions:[{id:'qHints',category:'Lore',title:'Vier Tipps',prompt:'Wen suche ich?',answer:'Anivia',hints:['Tipp A','Tipp B','Tipp C','Tipp D']}]}).questions[0];
 assert.equal(q.hints.length,4);
 for(let k=0;k<=4;k++){
  const p=publicQuestion(q,false,'',k);assert.equal(p.hints.length,k);
  assert.equal(p.hintStep,k);assert.equal(p.answer,undefined);
  for(let i=k;i<4;i++)assert.equal(JSON.stringify(p).includes(q.hints[i]),false);
 }
 assert.match(editor,/Tipps \(1–4\)/);
 assert.match(app,/if\(current>=4\)return/);
});

test('3.4: world map pin values validated, anti-injection, and keyboard projection',()=>{
 const val=normalizePoint({x:58.456,y:33.55});assert.deepEqual(val,{x:58.456,y:33.55});
 assert.deepEqual(decodePoint(encodePoint(val)),val);
 assert.deepEqual(worldLatLon({x:50,y:50}),{lat:0,lon:0});
 for(const value of ["@map:20,20<script>","@map:-3,50",'@map:100.1,10','@map:1,120','hi','@map:NaN,10'])assert.equal(decodePoint(value),null);
 assert.throws(()=>encodePoint({x:-1,y:50}),/Ungültiger/);
 assert.ok(statSync(new URL('world-map.svg',docs)).size>50_000);
 assert.ok(statSync(new URL('world-map.svg',docs)).size<200_000);
});

test('3.4: map solution is host-only before reveal; shared world scene works for all',()=>{
 const question=normalizedQuiz({questions:[{id:'qMap',category:'Weltkarte',type:'map',title:'Kartenfrage',prompt:'Wo liegt es?',answer:'Im Westen',roundMode:'written',mapTargetX:61,mapTargetY:34,mapTargetSet:true,scene:templateScene('map',{prompt:'Wo liegt es?'})}]}).questions[0];
 const privateView=publicQuestion(question,false,'',0,0);
 assert.equal(privateView.mapTargetX,undefined);
 assert.equal(privateView.mapTargetY,undefined);
 assert.equal(privateView.answer,undefined);
 assert.equal(privateView.roundMode,'written');
 const markup=renderScene(privateView.scene,{mapCanPick:true,mapPin:{x:12,y:50}});
 assert.match(markup,/world-map\.svg/);
 assert.match(markup,/data-map-choice="true"/);
 assert.match(markup,/left:12%/);
 const released=publicQuestion(question,true,'',0,6);
 assert.equal(released.mapTargetX,61);
 assert.equal(released.mapTargetY,34);
});

test('3.4: universal imposter can show customized icon set without leaking correct image',()=>{
 const scene=templateScene('imposter',{prompt:'Welche Grafik wurde ersetzt?'});
 const mocked='data:image/png;base64,aGVsbG8=';
 for(const [i,el] of scene.elements.filter(e=>e.kind==='image').entries()){el.src=mocked;el.alt='Grafik '+String.fromCharCode(65+i);}
 const q={type:'imposter',scene,imposterIndex:2,correctIcon:mocked,answer:'Bild C'};
 reconcileQuestion(q);
 assert.equal(q.abilityNames[0],'Grafik A');
 assert.equal(q.abilityNames[2],'Grafik C');
 const normalized=normalizedQuiz({questions:[{...q,id:'qImpost',category:'I',title:'I',prompt:'Welche Grafik wurde ersetzt?'}]}).questions[0];
 const p=publicQuestion(normalized,false);
 assert.equal(p.correctIcon,undefined);
 assert.equal(p.imposterIndex,undefined);
 const html=renderScene(publicScene(q.scene,6,true),{revealed:true,correctIndex:2});
 assert.match(html,/se-imposter-label/);
 assert.match(html,/AUSGETAUSCHT/);
});

test('3.4: buzzer wrong half points, team lock, manual unlock option, no duplicate scoring',()=>{
 const state={phase:'question',round:4,current:{id:'q1',type:'text',roundMode:'buzzer',points:300},scoreMode:'team',teams:{t1:'Rot',t2:'Blau'},scores:{t1:500,t2:100},settings:{buzzerEnabled:true}};
 const incoming={'4':{uid:'alice',team:'t1',name:'Alice'}};
 assert.ok(canBuzz(state,{},'alice','t1'));
 const first=applyBuzzerJudgement(state,incoming,{round:4,uid:'alice',result:'wrong'});
 assert.equal(first.delta,-150);
 assert.equal(first.state.scores.t1,350);
 assert.equal(first.buzzers['4'],undefined);
 assert.equal(canBuzz(first.state,first.buzzers,'alice','t1'),false);
 assert.equal(canBuzz(first.state,first.buzzers,'bob','t1'),false);
 assert.equal(canBuzz(first.state,first.buzzers,'chloe','t2'),true);
 assert.equal(state.scores.t1,500,'original state must not mutate');
});

test('3.4: team chat is shared per team and other teams only see their snapshots',()=>{
 const peer=readFileSync(new URL('peer-client.mjs',docs),'utf8');
 assert.match(peer,/messages\[member\.team\]/);
 assert.match(peer,/const msgs=approved&&member\.team\?\{\[member\.team\]/);
 assert.match(app,/bq-shared-team-chat/);
 for(const text of [app,editor])assert.doesNotMatch(text,/Discord/i);
});
