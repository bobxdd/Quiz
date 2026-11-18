import test from 'node:test';
import assert from 'node:assert/strict';
import {finalStandings,mayFinishGame} from '../docs/final-results.mjs';
test('teams share ranks on equal scores without duplicating awards',()=>{
 const rows=finalStandings({scoreMode:'team',teams:{t1:'Alpha',t2:'Beta',t3:'Gamma',t4:'Delta'},scores:{t1:300,t2:300,t3:200,t4:-50}});
 assert.deepEqual(rows.map(r=>r.rank),[1,1,3,4]);
 assert.deepEqual(rows.map(r=>r.points),[300,300,200,-50]);
 assert.equal(rows[0].tied,true);assert.equal(rows[2].tied,false);
});
test('individual standings use roster and manual players, not hidden answers',()=>{
 const rows=finalStandings({scoreMode:'individual',playerScores:{alice:{total:100},manual_1:{total:30},_empty:{}},manualPlayers:{manual_1:'Gast'}},{alice:{name:'Alice',team:'red'}});
 assert.deepEqual(rows.map(r=>r.name),['Alice','Gast']);
 assert.deepEqual(rows.map(r=>r.rank),[1,2]);
});
test('finish only between questions or following reveal',()=>{
 for(const phase of ['board','reveal'])assert.equal(mayFinishGame({phase,published:true}),true);
 for(const phase of ['question','paused','review','finished'])assert.equal(mayFinishGame({phase,published:true}),false);
 assert.equal(mayFinishGame({phase:'board',published:false}),false);
});
