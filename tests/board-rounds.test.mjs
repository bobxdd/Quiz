import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedQuiz,buildPublicBoard,publicQuestion,pageBoardColumns} from '../docs/core.mjs';
import {changeSelectedQuestions} from '../docs/editor-workflows.mjs';
import {boardLayoutIssues,roundCategories,roundQuestions} from '../docs/category-model.mjs';
import {openQuestionState,returnToBoardState,canAdvanceBoard,advanceBoardState,validQuestionPair,makeSelectionTurn,selectingTeam,resetBoardGameState,cancelQuestionState,skipSelectionTurn} from '../docs/question-flow.mjs';

const questions=[
 {id:'first',category:'Champions',points:100,prompt:'Erste geheime Frage',answer:'Antwort eins'},
 {id:'second',boardRound:2,category:'Champions',points:300,prompt:'Zweite geheime Frage',answer:'Antwort zwei'}
];
const quiz=()=>normalizedQuiz({categories:['Champions'],questions});
const state=()=>({published:true,phase:'board',round:0,boardRound:1,boardSequence:true,board:buildPublicBoard(quiz()),
 scores:{t1:500,t2:-50},playerScores:{alice:{total:500}},used:{},teams:{t1:'Rot',t2:'Blau'}});

test('old quiz imports keep the first board and two-board exports preserve question identity',()=>{
 const old=normalizedQuiz({categories:['Lore'],questions:[questions[0]]});
 assert.equal(old.questions[0].boardRound,1);
 assert.deepEqual(roundCategories(quiz(),2),['Champions']);
 assert.deepEqual(normalizedQuiz(JSON.parse(JSON.stringify(quiz()))),quiz());
 assert.equal(roundQuestions(quiz(),2)[0].id,'second');
 assert.deepEqual(boardLayoutIssues(quiz()),[]);
});

test('covered selection hides the complete prompt and starts no timer or buzzer',()=>{
 const p=state(),q=quiz().questions[0];
 assert.equal(validQuestionPair(p,quiz().questions[1]),false);
 const next=openQuestionState(p,{expectedRound:0,question:q,playerQuestion:publicQuestion(q),deadline:9999,covered:true});
 assert.equal(next.phase,'ready');
 assert.equal(next.deadline,0);
 assert.equal(next.buzzerArmed,false);
 assert.equal(next.current.prompt,undefined);
 assert.equal(next.current.answer,undefined);
 assert.equal(JSON.stringify(next).includes('geheime Frage'),false);
 const cancelled=returnToBoardState(next);
 assert.equal(cancelled.board.first.used,false);
 assert.equal(cancelled.boardRound,1);
 assert.equal(cancelled.current,null);
});

test('returning to the board starts the second round once and carries every score',()=>{
 const p=state(),q=quiz().questions[0];
 const opened=openQuestionState(p,{expectedRound:0,question:q,playerQuestion:publicQuestion(q)});
 const answered={...opened,phase:'reveal',scores:{t1:600,t2:-50}};
 assert.equal(openQuestionState(answered,{expectedRound:1,question:quiz().questions[1],playerQuestion:publicQuestion(quiz().questions[1])}),null);
 const next=returnToBoardState(answered);
 assert.equal(next.phase,'board');
 assert.equal(next.boardRound,2);
 assert.deepEqual(next.scores,{t1:600,t2:-50});
 assert.deepEqual(next.playerScores,p.playerScores);
 assert.equal(next.board.first.used,true);
 assert.equal(next.board.second.used,false);
 assert.equal(advanceBoardState(next),null);
 assert.equal(validQuestionPair(next,quiz().questions[1]),true);
});

test('a board has at most six columns and six rows on every screen',()=>{
 const dense=normalizedQuiz({questions:Array.from({length:49},(_,i)=>({
  id:'q'+i,category:'Kategorie '+Math.floor(i/7),points:i,prompt:'Frage',answer:'Antwort'
 }))});
 assert.match(boardLayoutIssues(dense).map(item=>item.reason).join(' '),/sechs Kategorien/);
 assert.match(boardLayoutIssues(dense).map(item=>item.reason).join(' '),/sechs Fragen/);
 const columns=Array.from({length:7},(_,i)=>({category:'Kategorie '+i,items:Array.from({length:8},(_,j)=>({id:i+'-'+j}))}));
 for(const width of [320,768,1440,2560]){
  const pages=pageBoardColumns(columns,width,2000);
  assert.ok(pages.every(page=>page.columns.length<=6&&page.columns.every(column=>column.items.length<=6)));
  assert.equal(pages.flatMap(page=>page.columns.flatMap(column=>column.items)).length,56);
 }
});


test('batch category moves enforce six cells per round before changing questions or points',()=>{
 const q=normalizedQuiz({categories:['Voll','Quelle'],questions:[
  ...Array.from({length:6},(_,i)=>({id:'full'+i,category:'Voll',points:100,prompt:'Frage',answer:'Antwort'})),
  {id:'move',category:'Quelle',points:200,prompt:'Frage',answer:'Antwort'},
  {id:'round2',category:'Voll',boardRound:2,points:300,prompt:'Frage',answer:'Antwort'}
 ]});
 const original=structuredClone(q);
 assert.throws(()=>changeSelectedQuestions(q,['move'],{category:'Voll',points:900}),/sechs Fragen/);
 assert.deepEqual(q,original,'rejected batch must leave every question unchanged');
 assert.equal(changeSelectedQuestions(q,['round2'],{category:'Quelle',points:500}),1);
 assert.equal(q.questions.at(-1).boardRound,2);
 assert.equal(q.questions.at(-1).points,500);
 assert.equal(q.questions.at(-1).category,'Quelle');
});


test('team selection rotates after a completed field and across boards, independently of score',()=>{
 const p=state();p.teams.t3='Leer';p.selectionTurn=makeSelectionTurn(p,{alice:{team:'t1'},bob:{team:'t2'}});
 assert.deepEqual(p.selectionTurn.order,['t1','t2']);
 assert.equal(selectingTeam(p),'t1');
 const q=quiz().questions[0];
 const ready=openQuestionState(p,{expectedRound:0,question:q,playerQuestion:publicQuestion(q),covered:true});
 assert.equal(selectingTeam(returnToBoardState(ready)),'t1','covered cancellation must preserve the chooser');
 const next=returnToBoardState({...ready,phase:'reveal',scores:{t1:600,t2:-50}});
 assert.equal(next.boardRound,2);
 assert.equal(selectingTeam(next),'t2','next team chooses even when team one won the points');
 const second=quiz().questions[1];
 const finished=returnToBoardState({...openQuestionState(next,{expectedRound:1,question:second,playerQuestion:publicQuestion(second)}),phase:'reveal'});
 assert.equal(selectingTeam(finished),'t1');
 assert.deepEqual(finished.scores,{t1:600,t2:-50});
});

test('a reserved team selection cannot be replaced by another field',()=>{
 const p=state();p.questionPick={qid:'other',round:0,team:'t1'};
 const q=quiz().questions[0];
 assert.equal(openQuestionState(p,{expectedRound:0,question:q,playerQuestion:publicQuestion(q),covered:true}),null);
 assert.equal(makeSelectionTurn({...p,scoreMode:'individual'}),null);
});


test('restarting a completed game resets both boards, turn order and every previous buzzer verdict',()=>{
 const p={...state(),boardRound:2,phase:'finished',round:2,selectionTurn:{order:['t1','t2'],index:3},
  buzzerResolved:{1:{uid:'alice'}},buzzerJudgements:{1:{result:'correct'}},buzzerBlocked:{1:{bob:true}},
  buzzerBlockedTeams:{1:{t2:true}},playerScores:{alice:{total:500}},questionPick:{qid:'second'},
  presentation:'scores',finaleStep:2};
 const before=structuredClone(p);
 const next=resetBoardGameState(p,buildPublicBoard(quiz()),{alice:{team:'t1'},bob:{team:'t2'}});
 assert.equal(next.boardRound,1);assert.equal(next.round,0);assert.equal(next.phase,'board');
 assert.equal(selectingTeam(next),'t1');assert.equal(next.started,false);
 assert.deepEqual(next.scores,{t1:0,t2:0});assert.deepEqual(next.playerScores,{});
 for(const key of ['used','buzzerResolved','buzzerJudgements','buzzerBlocked','buzzerBlockedTeams'])assert.deepEqual(next[key],{});
 assert.equal(next.questionPick,null);assert.equal(next.presentation,null);
 assert.equal(next.board.first.used,false);assert.equal(next.board.second.used,false);
 assert.deepEqual(p,before);
});

test('a no-verdict cancellation restores a question, preserves the chooser and does not reuse old round IDs',()=>{
 const p=state();p.selectionTurn=makeSelectionTurn(p,{alice:{team:'t1'},bob:{team:'t2'}});
 const question=quiz().questions[0];
 const covered=openQuestionState(p,{expectedRound:0,question,playerQuestion:publicQuestion(question),covered:true});
 const shown={...covered,phase:'question',current:publicQuestion(question)};
 const cancelled=cancelQuestionState(shown);
 assert.equal(cancelled.phase,'board');
 assert.equal(cancelled.current,null);
 assert.equal(cancelled.used.first,undefined);
 assert.equal(cancelled.board.first.used,false);
 assert.equal(cancelled.round,1,'keep round number to invalidate stale guest packets');
 assert.equal(selectingTeam(cancelled),'t1');
 assert.equal(openQuestionState(cancelled,{expectedRound:0,question,playerQuestion:publicQuestion(question)}),null);
 const reopened=openQuestionState(cancelled,{expectedRound:1,question,playerQuestion:publicQuestion(question)});
 assert.equal(reopened.round,2);
 assert.deepEqual(shown.used,{first:true},'original remains untouched');
 for(const phase of ['reveal','review'])assert.equal(cancelQuestionState({...shown,phase}),null);
});

test('selection override only advances on an empty board without altering score, answers or turn rights in active rounds',()=>{
 const p=state();p.selectionTurn=makeSelectionTurn(p,{alice:{team:'t1'},bob:{team:'t2'}});
 const shifted=skipSelectionTurn(p);
 assert.equal(selectingTeam(p),'t1');
 assert.equal(selectingTeam(shifted),'t2');
 assert.deepEqual(shifted.scores,p.scores);
 assert.deepEqual(shifted.used,p.used);
 assert.equal(skipSelectionTurn({...p,questionPick:{qid:'first'}}),null);
 assert.equal(skipSelectionTurn({...p,phase:'question'}),null);
 assert.equal(skipSelectionTurn({...p,scoreMode:'individual'}),null);
 assert.equal(skipSelectionTurn({...p,selectionTurn:{order:['t1'],index:0}}),null);
});

test('Second board cannot be reached through the normal action while first board has unplayed questions',()=>{
 const p=state();p.selectionTurn=makeSelectionTurn(p,{alice:{team:'t1'},bob:{team:'t2'}});
 assert.equal(canAdvanceBoard(p),false);
 assert.equal(advanceBoardState(p),null);
 assert.equal(canAdvanceBoard(p,{force:true}),true,'host explicitly acknowledges an early finish');
 assert.equal(advanceBoardState(p,{force:true}).boardRound,2);
 assert.equal(state().boardRound,1,'explicit override must not mutate the input');
 const q=quiz().questions[0],opened=openQuestionState(p,{expectedRound:0,question:q,playerQuestion:publicQuestion(q)});
 const next=returnToBoardState({...opened,phase:'reveal'});
 assert.equal(next.boardRound,2,'normal transition happens immediately after the last first-board field');
 assert.equal(advanceBoardState(next),null,'round two may not be started twice');
});
