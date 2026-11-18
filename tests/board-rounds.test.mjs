import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedQuiz,buildPublicBoard,publicQuestion,pageBoardColumns} from '../docs/core.mjs';
import {boardLayoutIssues,roundCategories,roundQuestions} from '../docs/category-model.mjs';
import {openQuestionState,returnToBoardState,advanceBoardState,validQuestionPair} from '../docs/question-flow.mjs';

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
