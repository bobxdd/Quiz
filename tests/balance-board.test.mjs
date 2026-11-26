import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedQuiz,buildPublicBoard,publicQuestion} from '../docs/core.mjs';
import {roundQuestions,boardLayoutIssues} from '../docs/category-model.mjs';
import {advanceBoardState,nextBoardRound,canAdvanceBoard,openQuestionState,returnToBoardState,selectingTeam,skipSelectionTurn,strikeBalanceField,undoBalanceStrike,judgeBalanceAnswer,applyQuestionChanges} from '../docs/question-flow.mjs';
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

test('round three survives a JSON round trip and accepts an additional strike field per team',()=>{
 const q=create();
 assert.equal(q.balanceBoard,true);
 assert.equal(roundQuestions(q,3).length,3);
 assert.deepEqual(normalizedQuiz(JSON.parse(JSON.stringify(q))),q);
 assert.deepEqual(boardLayoutIssues(q),[]);
 const expanded=normalizedQuiz({...q,questions:[...q.questions,...source.slice(2).map(item=>({...item,id:item.id+'-extra'}))]});
 assert.equal(roundQuestions(expanded,3).length,6);
 assert.deepEqual(boardLayoutIssues(expanded),[]);
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
 assert.equal(finished.balanceStrike.team,'t2');
 const struck=strikeBalanceField(finished,'b');
 assert.equal(selectingTeam(struck),'t1','the next lowest team is next after the strike');
});

test('normal team choice rotation is restored after the temporary balance order',()=>{
 const p={...publicState(),selectionTurn:{order:['t1','t2','t3'],index:2}};
 const balance=advanceBoardState(p,{force:true});
 assert.deepEqual(balance.selectionTurn.order,['t2','t1','t3']);
 assert.deepEqual(balance.preBalanceSelectionTurn,p.selectionTurn);
 const normal=advanceBoardState(balance,{force:true});
 assert.equal(normal.boardRound,2);
 assert.deepEqual(normal.selectionTurn,p.selectionTurn);
 assert.equal(Object.hasOwn(normal,'preBalanceSelectionTurn'),false);
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
 assert.equal(canBuzz(released,{},'b','t1',Date.now()),false);
 assert.equal(canBuzz(released,{},'a','t2',Date.now()),false);
});

test('exclusive wrong and right answers reveal and end the field, then the same team gets a reversible strike',()=>{
 const quiz=normalizedQuiz({...create(),questions:[...source,...source.slice(2).map(item=>({...item,id:item.id+'-extra'}))]});
 const initial={...publicState(),board:buildPublicBoard(quiz),participatingTeams:['t1','t2']};
 let state=advanceBoardState(initial,{force:true});
 assert.deepEqual(state.selectionTurn.order,['t2','t1']);
 for(const [id,team,result,target] of [['a','t2','wrong','b'],['c','t1','correct','a-extra']]){
  const q=quiz.questions.find(item=>item.id===id);
  state=openQuestionState(state,{expectedRound:state.round,question:q,playerQuestion:publicQuestion(q)});
  const round=state.round;
  const refreshed=applyQuestionChanges(state,round,id,{current:publicQuestion(q)});
  assert.equal(refreshed.current.firstAnswerTeam,team);
  const revealPatch={current:publicQuestion(q,true),phase:'reveal',deadline:0};
  assert.equal(judgeBalanceAnswer(refreshed,{round,team:'t3',result,revealPatch}),null);
  const judgement=judgeBalanceAnswer(refreshed,{round,team,result,revealPatch});
  assert.equal(judgement.delta,result==='wrong'?0:state.current.points);
  assert.equal(judgement.state.phase,'reveal');
  assert.equal(judgement.state.current.firstAnswerResult,result);
  assert.equal(judgement.state.current.answer,id);
  assert.equal(judgeBalanceAnswer(judgement.state,{round,team,result,revealPatch}),null);
  state=returnToBoardState(judgement.state);
  assert.equal(state.balanceStrike.team,team);
  assert.equal(advanceBoardState(state,{force:true}),null);
  assert.equal(strikeBalanceField(state,id),null);
  assert.equal(strikeBalanceField(state,'two'),null);
  const struck=strikeBalanceField(state,target);
  assert.equal(struck.board[target].struck,true);
  assert.equal(strikeBalanceField(struck,'b-extra'),null);
  state=undoBalanceStrike(struck);
  assert.equal(state.board[target].used,false);
  assert.equal(state.balanceStrike.team,team);
  state=strikeBalanceField(state,target);
 }
 assert.equal(selectingTeam(state),'','no second turn on the balance board');
 assert.equal(advanceBoardState(state).boardRound,2);
});
