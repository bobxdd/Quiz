import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openQuestionState,applyQuestionChanges,validQuestionPair,questionMotion} from '../docs/question-flow.mjs';
const make=()=>({title:'Quiz',phase:'board',round:0,board:{a:{id:'a',category:'Lore',points:100,used:false},b:{id:'b',category:'Imposter',points:200,used:false},c:{id:'c',category:'Lore',points:300,used:false}},used:{},settings:{}});
const question=(id='a',category='Lore',points=100)=>({id,category,points,prompt:'Frage'});
function open(state,q=question(),round=state.round){return openQuestionState(state,{expectedRound:round,question:q,playerQuestion:q,participants:{a:{name:'Player 1'}},deadline:0})}
test('2.5 strict: one question opens and marks exactly one board ID',()=>{const state=make(),res=open(state);assert.equal(res.round,1);assert.equal(res.current.id,'a');assert.equal(res.phase,'question');assert.equal(res.used.a,true);assert.equal(res.board.a.used,true);assert.equal(res.board.b.used,false);assert.equal(res.board.c.used,false);assert.equal(state.board.a.used,false);});
test('2.5 strict: cannot open two questions in a question phase',()=>{const next=open(make());assert.equal(open(next,question('b','Imposter',200)),null);assert.equal(open(next,question('c','Lore',300)),null);});
test('2.5 strict: same ID cannot be opened twice after reveal or board return',()=>{const once=open(make());const after={...once,phase:'board',current:null};assert.equal(open(after),null);});
test('2.5 strict: mismatched category or point value is rejected even if ID exists',()=>{const state=make();assert.equal(validQuestionPair(state,question('a','Imposter',100)),false);assert.equal(validQuestionPair(state,question('a','Lore',200)),false);assert.equal(open(state,question('b','Lore',200)),null);});
test('2.5 strict: stale expected round cannot open a fresh question',()=>{const once=open(make());const after={...once,phase:'reveal'};assert.equal(open(after,question('b','Imposter',200),0),null);const current=open(after,question('b','Imposter',200),1);assert.equal(current.round,2);assert.equal(current.current.id,'b');});
test('2.5 strict: late hint/reveal from older question cannot modify newer round',()=>{const one=open(make());const two=open({...one,phase:'reveal'},question('b','Imposter',200));assert.equal(applyQuestionChanges(two,1,'a',{phase:'reveal'}),null);assert.equal(applyQuestionChanges(two,1,'b',{phase:'reveal'}),null);assert.equal(applyQuestionChanges(two,2,'a',{phase:'reveal'}),null);assert.equal(two.current.id,'b');});
test('2.5 strict: current question ID cannot be swapped by hint updates',()=>{const one=open(make());assert.equal(applyQuestionChanges(one,1,'a',{current:question('b','Imposter',200)}),null);});
test('2.5 strict: separate categories and same-category questions keep distinct IDs',()=>{let state=make();state=open(state,question('a','Lore',100));state=open({...state,phase:'reveal'},question('c','Lore',300));assert.deepEqual(Object.keys(state.used).sort(),['a','c']);assert.equal(state.board.b.used,false);});
test('2.5 strict: one reviewed answer only changes its own slot',()=>{let state=open(make());state={...state,phase:'review',answerReview:{entries:{one:{revealed:false},two:{revealed:false}}}};const next=applyQuestionChanges(state,1,'a',{'answerReview/entries/one':{revealed:true,value:'23'}});assert.equal(next.answerReview.entries.one.value,'23');assert.equal(next.answerReview.entries.two.revealed,false);});
test('2.5 strict: prototype pollution and missing question are rejected',()=>{const state=open(make());assert.equal(applyQuestionChanges(state,1,'a',{'__proto__/polluted':true}),null);assert.equal(openQuestionState(make(),{expectedRound:0,question:{...question(),id:'missing'},playerQuestion:question()}),null);});
test('2.5 animation: same question always gets same motion, multiple variants exist',()=>{assert.equal(questionMotion(1,'a'),questionMotion(1,'a'));assert.equal(new Set(['a','b','c','d','e','f','g','h'].map(id=>questionMotion(1,id))).size,4);});
test('2.7 P2P: host serializes question opening and validates full board identity',()=>{
 const app=readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 const peer=readFileSync(new URL('../docs/peer-client.mjs',import.meta.url),'utf8');
 assert.match(app,/await game\.openQuestion\(/);
 assert.match(peer,/openQuestionState\(d\.public/);
 assert.match(peer,/applyQuestionChanges\(d\.public/);
 assert.doesNotMatch(app,/await game\.setState\(room,\{current:pub\}/);
 assert.match(app,/openingQuestion=true/);
});
test('2.5 strict: going back from a specific round cannot close a newer round',()=>{const first=open(make());const next=applyQuestionChanges(first,1,'a',{phase:'board',current:null,deadline:0},['question']);assert.equal(next.phase,'board');assert.equal(next.current,undefined);const second=open(next,question('b','Imposter',200));assert.equal(applyQuestionChanges(second,1,'a',{phase:'board',current:null},['question']),null);assert.equal(second.current.id,'b');});

test('2.5 strict: twenty racing host selections have one canonical winning commit',async()=>{
 let published=make(),commitCount=0;
 // Simulates the host event loop linearization; real peer transport covered separately.
 const attempt=async index=>{await Promise.resolve();const id=index%2?'a':'b',cat=id==='a'?'Lore':'Imposter',pts=id==='a'?100:200;const result=openQuestionState(published,{expectedRound:0,question:question(id,cat,pts),playerQuestion:question(id,cat,pts),participants:{}});if(result){published=result;commitCount++}};
 await Promise.all(Array.from({length:20},(_,i)=>attempt(i)));
 assert.equal(commitCount,1);assert.equal(published.round,1);assert.equal(Object.entries(published.used).filter(([,value])=>value).length,1);
});
