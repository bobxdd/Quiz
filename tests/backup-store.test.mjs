import test from 'node:test';
import assert from 'node:assert/strict';
import {saveHostCheckpoint,loadHostCheckpoint,deleteHostCheckpoint} from '../docs/backup-store.mjs';
test('private recovery keys reject malformed storage locations',async()=>{
 for(const value of ['session-bad','quiz-../../bad','../session-AAAA','session-AAAAAAAAAAAAAAAAA']){
  await assert.rejects(()=>loadHostCheckpoint(value),/Backup-Schlüssel/);
 }
});
test('storage gracefully falls back when IndexedDB is not available (Node)',async()=>{
 const key='session-AAAAAAAAAAAAAAAA';
 if(typeof globalThis.indexedDB!=='undefined')return;
 assert.equal(await saveHostCheckpoint(key,{savedAt:1}),null);
 assert.equal(await loadHostCheckpoint(key),null);
 assert.equal(await deleteHostCheckpoint(key),null);
});
