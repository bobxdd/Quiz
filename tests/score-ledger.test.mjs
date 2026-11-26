import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreEvent,appendScoreEvent,latestUndoableEvent,undoScoreEvent,regradeScoreEvent} from '../docs/score-ledger.mjs';
const before={scores:{t1:200,t2:50},playerScores:{p:{total:60,rounds:{},history:[]}}};
const after={scores:{t1:300,t2:50},playerScores:{p:{total:160,rounds:{},history:[]}}};
test('ledger records only affected people/teams; last active event undoes atomically',()=>{
 const e=scoreEvent(before,after,{id:'e1',kind:'written-judgement',team:'t1',person:'p',round:2,questionId:'q1'});
 assert.equal(e.changes.team.after,300);
 assert.equal(e.changes.person.after.total,160);
 assert.equal(JSON.stringify(e).includes('answerImage'),false);
 let events=appendScoreEvent([],e);
 assert.throws(()=>appendScoreEvent(events,e),/protokolliert/);
 const changed=structuredClone(after);changed.scores.t2=999;
 const undo=undoScoreEvent(changed,events,'e1',12345);
 assert.equal(undo.state.scores.t1,200);
 assert.equal(undo.state.scores.t2,999);
 assert.equal(undo.state.playerScores.p.total,60);
 assert.equal(undo.events[0].undoneAt,12345);
 assert.equal(latestUndoableEvent(undo.events),null);
 assert.throws(()=>undoScoreEvent(undo.state,undo.events,'e1'),/letzte/);
});
test('stale concurrent point totals and out-of-order undo fail safely',()=>{
 const e1=scoreEvent(before,after,{id:'e1',kind:'manual-team',team:'t1'});
 const e2=scoreEvent(after,{scores:{t1:350},playerScores:after.playerScores},{id:'e2',kind:'manual-team',team:'t1'});
 const events=appendScoreEvent([e1],e2);
 assert.throws(()=>undoScoreEvent(after,events,'e1'),/letzte/);
 assert.throws(()=>undoScoreEvent({scores:{t1:999}},events,'e2'),/inzwischen verändert/);
 const rolled=undoScoreEvent({scores:{t1:350}},events,'e2');
 assert.equal(rolled.state.scores.t1,300);
 assert.equal(latestUndoableEvent(rolled.events).id,'e1');
});
test('no-op events do not fill the score ledger',()=>{assert.equal(scoreEvent(before,before,{id:'n',kind:'manual-team',team:'t1'}),null);});

test('regrading a buzzer replaces its verdict and preserves later team adjustments',()=>{
 const initial={scores:{t1:0,t2:20}};
 const wrong={scores:{t1:-50,t2:20}};
 const event=scoreEvent(initial,wrong,{id:'wrong',kind:'buzzer-judgement',round:1,team:'t1',points:100,verdict:'wrong'});
 const current={scores:{t1:-25,t2:200}};
 const corrected=regradeScoreEvent(current,[event],'wrong',{newId:'correct'});
 assert.deepEqual(corrected.state.scores,{t1:125,t2:200});
 assert.equal(corrected.events[0].supersededBy,'correct');
 assert.throws(()=>regradeScoreEvent(corrected.state,corrected.events,'wrong',{newId:'again'}),/aktuell/);
 const reverted=undoScoreEvent(corrected.state,corrected.events,'correct');
 assert.deepEqual(reverted.state,current);
 assert.equal(latestUndoableEvent(reverted.events).id,'wrong');
});

test('regrading a shield-protected wrong answer uses actual zero penalty, not theoretical half',()=>{
 const initial={scores:{t1:100,t2:20}};
 const wrong=structuredClone(initial);
 const event=scoreEvent(initial,wrong,{id:'shield',kind:'buzzer-judgement',round:1,team:'t1',points:100,verdict:'wrong'});
 assert.equal(event.effectiveDelta,0);
 const corrected=regradeScoreEvent(wrong,[event],'shield',{newId:'correct'});
 assert.equal(corrected.state.scores.t1,200);
 const wrongAgain=regradeScoreEvent(corrected.state,corrected.events,'correct',{newId:'wrong-again'});
 assert.equal(wrongAgain.state.scores.t1,50);
});

test('the closed round reflects a new verdict and undo while keeping its solution and lock',()=>{
 const initial={scores:{t1:0},round:1,current:{id:'q',points:100}};
 const verdict={team:'t1',uid:'p',result:'correct',delta:100,at:200};
 const shown={...initial,scores:{t1:100},phase:'reveal',solutionVisible:true,
  buzzerJudgements:{1:verdict},buzzerResolved:{1:verdict}};
 const first=scoreEvent(initial,shown,{id:'first',kind:'buzzer-judgement',round:1,questionId:'q',actor:'p',team:'t1',points:100,verdict:'correct',judgedAt:200});
 const corrected=regradeScoreEvent(shown,[first],'first',{newId:'corrected'});
 assert.equal(corrected.state.scores.t1,-50);
 assert.equal(corrected.state.buzzerResolved[1].result,'wrong');
 assert.equal(corrected.state.buzzerJudgements[1].delta,-50);
 assert.equal(corrected.state.solutionVisible,true);
 const restored=undoScoreEvent(corrected.state,corrected.events,'corrected');
 assert.deepEqual(restored.state,shown);
 const undone=undoScoreEvent(restored.state,restored.events,'first');
 assert.equal(undone.state.scores.t1,0);
 assert.equal(undone.state.phase,'reveal');
 assert.equal(undone.state.buzzerResolved[1].result,'undone');
});

test('regrading an earlier attempt cannot overwrite a later verdict by the same player',()=>{
 const initial={scores:{t1:0},round:1,current:{id:'q',points:100}};
 const wrong={...initial,scores:{t1:-50}};
 const first=scoreEvent(initial,wrong,{id:'first',kind:'buzzer-judgement',round:1,questionId:'q',actor:'p',team:'t1',points:100,verdict:'wrong',judgedAt:200});
 const verdict={team:'t1',uid:'p',result:'wrong',delta:-50,at:300};
 const shown={...wrong,scores:{t1:-100},buzzerJudgements:{1:verdict}};
 const corrected=regradeScoreEvent(shown,[first],'first',{newId:'corrected'});
 assert.deepEqual(corrected.state.buzzerJudgements[1],verdict);
});
