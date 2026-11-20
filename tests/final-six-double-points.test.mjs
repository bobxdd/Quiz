import test from 'node:test';
import assert from 'node:assert/strict';
import {finalSixActive,boardQuestionPoints,openQuestionState,returnToBoardState,applyQuestionChanges,remainingBoardQuestions} from '../docs/question-flow.mjs';
import {judgementDelta} from '../docs/core.mjs';

function makeBoards(first,second=0){
 const board={},used={};
 for(const [boardRound,count] of [[1,first],[2,second]]){
  for(let i=0;i<count;i++){
   const id='r'+boardRound+'-q'+i;
   board[id]={id,boardRound,category:'Champions',type:'text',points:100+(i%3)*100,used:false};
  }
 }
 return {phase:'board',published:true,started:true,boardRound:1,round:0,board,used,
  teams:{t1:'Blau',t2:'Rot'},scores:{t1:0,t2:0},scoreMode:'team',boardSequence:true,
  settings:{buzzerEnabled:true}};
}
function use(state,round,number){
 const cells=Object.values(state.board).filter(x=>x.boardRound===round);
 for(const cell of cells.slice(0,number)){state.used[cell.id]=true;state.board[cell.id].used=true;}
}
function open(state,id){
 const q=state.board[id];
 return openQuestionState(state,{expectedRound:state.round,question:q,
  playerQuestion:{id:q.id,category:q.category,points:q.points,type:q.type,roundMode:'buzzer'},
  covered:true});
}

for(const n of [24,25,36,48]){
 test(`Final six doubles exactly six unplayed tiles on a custom ${n}-question board`,()=>{
  const state=makeBoards(n);
  use(state,1,n-7);
  assert.equal(remainingBoardQuestions(state).length,7);
  assert.equal(finalSixActive(state),false,'the seventh-to-last question must still have normal points');
  const normal=remainingBoardQuestions(state)[0];
  assert.equal(boardQuestionPoints(state,normal),normal.points);
  const opened=open(state,normal.id);
  assert.equal(opened.current.points,normal.points);
  assert.equal(opened.current.doublePoints,false);
  const next=returnToBoardState({...opened,phase:'reveal'});
  assert.equal(remainingBoardQuestions(next).length,6);
  assert.equal(finalSixActive(next),true);
  for(const cell of remainingBoardQuestions(next))assert.equal(boardQuestionPoints(next,cell),cell.points*2);
  const firstBonus=remainingBoardQuestions(next)[0];
  const doubled=open(next,firstBonus.id);
  assert.equal(doubled.current.points,firstBonus.points*2);
  assert.equal(doubled.current.basePoints,firstBonus.points);
  assert.equal(doubled.current.doublePoints,true);
  const publicSource={...doubled.current,points:firstBonus.points,basePoints:undefined,doublePoints:false};
  const revealed=applyQuestionChanges({...doubled,phase:'question'},doubled.round,firstBonus.id,
   {phase:'reveal',current:publicSource},['question']);
  assert.equal(revealed.current.points,firstBonus.points*2,'reveal must NEVER restore the base point value');
  assert.equal(revealed.current.basePoints,firstBonus.points);
  assert.equal(revealed.current.doublePoints,true);
  const after=returnToBoardState(revealed);
  assert.equal(remainingBoardQuestions(after).length,5);
  assert.equal(finalSixActive(after),true);
 });
}

test('Every board has its OWN six-question bonus phase; no quiz-global counter',()=>{
 const state=makeBoards(36,25);use(state,1,30);
 assert.equal(finalSixActive(state),true);
 assert.equal(remainingBoardQuestions(state,1).length,6);
 // Switching boards never inherits the multiplier from the first board.
 const second={...state,boardRound:2,phase:'board',round:31};
 assert.equal(remainingBoardQuestions(second,2).length,25);
 assert.equal(finalSixActive(second),false);
 assert.equal(boardQuestionPoints(second,remainingBoardQuestions(second)[0]),100);
 const afterSecond={...second,board:structuredClone(second.board),used:{...second.used}};
 use(afterSecond,2,19);
 assert.equal(remainingBoardQuestions(afterSecond,2).length,6);
 assert.equal(finalSixActive(afterSecond),true);
 const lastSixOnSecond=remainingBoardQuestions(afterSecond)[0];
 assert.equal(boardQuestionPoints(afterSecond,lastSixOnSecond),lastSixOnSecond.points*2);
});

test('Boards up to six fields start in their double-points phase',()=>{
 const six=makeBoards(6);
 assert.equal(finalSixActive(six),true);
 assert.equal(boardQuestionPoints(six,remainingBoardQuestions(six)[0]),200);
 const tiny=makeBoards(5);
 assert.equal(finalSixActive(tiny),true);
 assert.equal(boardQuestionPoints(tiny,remainingBoardQuestions(tiny)[0]),200);
});

test('Double points are also valid for the editor maximum; the wrong-answer penalty is half the DOUBLE amount',()=>{
 assert.equal(judgementDelta(20000,'correct'),20000);
 assert.equal(judgementDelta(20000,'wrong'),-10000);
 assert.equal(judgementDelta(200,'correct'),200);
 assert.equal(judgementDelta(200,'wrong'),-100);
 assert.throws(()=>judgementDelta(20001,'correct'),/Ungültiger/);
});

test('Canceling an unplayed double-valued question does not consume the final-six phase',()=>{
 const state=makeBoards(25);use(state,1,19);
 const choice=remainingBoardQuestions(state)[0],opened=open(state,choice.id);
 const rollback=returnToBoardState({...opened,phase:'ready'});
 assert.equal(rollback.round,1,'do not reuse the same round ID');
 assert.equal(remainingBoardQuestions(rollback).length,6);
 assert.equal(finalSixActive(rollback),true);
 assert.equal(open(rollback,choice.id).current.points,choice.points*2);
});
