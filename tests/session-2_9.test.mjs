import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneForPublicState,isBoardCellPlayed,pageBoardColumns} from '../docs/core.mjs';
test('Only two audience scenes exist, and the board is hidden in all question phases',()=>{
 const q={id:'q1'};
 for(const phase of ['question','paused','review','reveal'])assert.equal(sceneForPublicState({phase,current:q}),'question');
 for(const phase of ['board','closed',undefined])assert.equal(sceneForPublicState({phase,current:null}),'board');
 assert.equal(sceneForPublicState({phase:'question',current:null}),'board');
});
test('Played, currently selected and synchronized used IDs are all unavailable',()=>{
 const q={id:'q1'};assert.equal(isBoardCellPlayed(q,{used:{}}),false);
 assert.equal(isBoardCellPlayed({...q,used:true},{}),true);
 assert.equal(isBoardCellPlayed(q,{used:{q1:true}}),true);
 assert.equal(isBoardCellPlayed(q,{current:{id:'q1'}}),true);
});
test('Board pagination preserves every item with no duplication across viewports',()=>{
 const columns=Array.from({length:12},(_,i)=>({category:'Kategorie '+i,items:Array.from({length:10},(_,j)=>({id:`${i}-${j}`}))}));
 const ids=columns.flatMap(c=>c.items.map(q=>q.id));
 for(const [width,height] of [[320,568],[390,740],[768,1024],[1280,720],[1920,1080]]){
  const pages=pageBoardColumns(columns,width,height);
  assert.ok(pages.length>1);
  const found=pages.flatMap(p=>p.columns.flatMap(c=>c.items.map(q=>q.id)));
  assert.deepEqual(found.slice().sort(),ids.slice().sort());
  assert.equal(new Set(found).size,ids.length);
  assert.ok(pages.every(p=>p.columns.length<=6&&p.rows<=9&&p.rows>0));
 }
});
