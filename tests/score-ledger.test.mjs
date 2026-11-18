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
