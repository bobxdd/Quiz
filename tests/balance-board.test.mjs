import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedQuiz,buildPublicBoard,publicQuestion} from '../docs/core.mjs';
import {roundQuestions,boardLayoutIssues} from '../docs/category-model.mjs';
import {advanceBoardState,nextBoardRound,canAdvanceBoard,openQuestionState,returnToBoardState,selectingTeam,skipSelectionTurn} from '../docs/question-flow.mjs';
import {canBuzz,applyBuzzerJudgement} from '../docs/round-rules.mjs';

const source=[
 {id:'one',boardRound:1,category:'Wissen',points:100,type:'text',prompt:'Eins',answer:'A'},
 {id:'two',boardRound:2,category:'Wissen',points:100,type:'text',prompt:'Zwei',answer:'B'},
 ...['a','b','c'].map((id,i)=>({id,boardRound:3,category:'Ausgleich',points:100*(i+1),type:'text',
  roundMode:'buzzer',prompt:'Frage '+id,answer:id}))
];
const create=()=>normalizedQuiz({teams:['Rot','Blau','Grün'],balanceBoard:true,questions:source});
const publicState=()=>{
 const quiz=create();
 return {phase:'board',round:0,boardRound:1,boardSequence:true,scoreMode:'team',
  teams:{t1:'Rot',t2:'Blau',t3:'Grün'},scores:{t1:600,t2:-100,t3:600},
  board:buildPublicBoard(quiz),used:{},settings:{buzzerEnabled:true,manualBuzzer:false}};
};

test('round three is optional, survives a JSON round trip and has exactly one question per team',()=>{
 const q=create();
 assert.equal(q.balanceBoard,true);
 assert.equal(roundQuestions(q,3).length,3);
 assert.deepEqual(normalizedQuiz(JSON.parse(JSON.stringify(q))),q);
 assert.deepEqual(boardLayoutIssues(q),[]);
 const missing=structuredClone(q);missing.questions.pop();
 assert.match(boardLayoutIssues(missing).map(issue=>issue.reason).join('; '),/eine Frage je Team/);
 const invalid=structuredClone(q);invalid.questions[2].roundMode='written';
 assert.match(boardLayoutIssues(invalid).map(issue=>issue.reason).join('; '),/Buzzerfrage/);
});

test('balance-round selection starts with lowest score and breaks ties by stable team ID',()=>{
 const p=publicState();
 const third=advanceBoardState(p,{force:true});
 assert.equal(third.boardRound,3,'balance comes directly after Board 1');
 const second=advanceBoardState(third,{force:true});
 assert.equal(second.boardRound,2,'regular Board 2 is played after the balance round');
 assert.equal(advanceBoardState(second,{force:true}),null,'the finale cannot loop back to balance');
 assert.deepEqual(third.selectionTurn.order,['t2','t1','t3']);
 assert.equal(selectingTeam(third),'t2');
 assert.equal(skipSelectionTurn(third),null,'host cannot casually skip a guaranteed team choice');
 const q=create().questions.find(item=>item.id==='a');
 const open=openQuestionState(third,{expectedRound:0,question:q,playerQuestion:publicQuestion(q),covered:true});
 assert.equal(open.current.firstAnswerTeam,'t2');
 assert.equal(open.current.firstAnswerPending,true);
 assert.equal(open.buzzerArmed,false);
 const cancelled=returnToBoardState(open);
 assert.equal(selectingTeam(cancelled),'t2','uncovered cancellation must preserve the selection turn');
 const finished=returnToBoardState({...open,phase:'reveal'});
 assert.equal(selectingTeam(finished),'t1','the next lowest team is next after a played question');
});

test('the intermediate board cannot be skipped and an absent intermediate board preserves Board 1 → Board 2',()=>{
 const p=publicState();
 assert.equal(nextBoardRound(p),3);
 assert.equal(canAdvanceBoard(p),false,'Board 1 must be completed first');
 const finishedFirst={...p,used:{one:true},board:{...p.board,one:{...p.board.one,used:true}}};
 assert.equal(canAdvanceBoard(finishedFirst),true);
 const balance=advanceBoardState(finishedFirst);
 assert.equal(balance.boardRound,3);
 assert.equal(canAdvanceBoard(balance),false,'balance questions must be played before Board 2');
 const finishedBalance={...balance,used:{...balance.used,a:true,b:true,c:true},
  board:Object.fromEntries(Object.entries(balance.board).map(([id,cell])=>[id,['a','b','c'].includes(id)?{...cell,used:true}:cell]))};
 const final=advanceBoardState(finishedBalance);
 assert.equal(final.boardRound,2);
 assert.equal(nextBoardRound(final),null);
 const withoutBalance=structuredClone(p);
 for(const id of ['a','b','c'])delete withoutBalance.board[id];
 assert.equal(nextBoardRound(withoutBalance),2,'a normal two-board quiz is unchanged');
});

test('the first-answer reservation blocks all buzzers even when the buzzer is forced armed',()=>{
 const third=advanceBoardState(publicState(),{force:true});
 const q=create().questions.find(item=>item.id==='a');
 const open=openQuestionState(third,{expectedRound:0,question:q,playerQuestion:publicQuestion(q)});
 const pending={...open,phase:'question',buzzerArmed:true};
 assert.equal(canBuzz(pending,{},'bob','t3',Date.now()),false);
 assert.throws(()=>applyBuzzerJudgement(pending,{'1':{uid:'bob',team:'t3',name:'Bob'}},
  {round:1,uid:'bob',result:'correct'}),/reserviert/);
 const released={...pending,current:{...pending.current,firstAnswerPending:false},
  buzzerBlockedTeams:{'1':{t2:{team:'t2'}}}};
 assert.equal(canBuzz(released,{},'b','t1',Date.now()),true);
 assert.equal(canBuzz(released,{},'a','t2',Date.now()),false,'first team cannot steal its second chance');
});
