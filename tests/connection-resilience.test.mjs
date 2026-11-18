import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadPeerJS} from '../docs/peer-client.mjs';

test('PeerJS script loader falls back to a second pinned CDN without an infinite spinner',async()=>{
 const oldPeer=globalThis.Peer,oldDocument=globalThis.document;
 const requested=[];
 class FakePeer{}
 try{
  delete globalThis.Peer;
  globalThis.document={
   createElement:()=>({async:false,crossOrigin:'',onerror:null,onload:null,remove(){}}),
   head:{appendChild(script){
    requested.push(script.src);
    queueMicrotask(()=>{
     if(requested.length===1)script.onerror?.(new Error('CDN blocked'));
     else{globalThis.Peer=FakePeer;script.onload?.();}
    });
   }}
  };
  const result=await loadPeerJS();
  assert.equal(result,FakePeer);
  assert.equal(requested.length,2);
  assert.match(requested[0],/jsdelivr/);
  assert.match(requested[1],/unpkg/);
  assert.ok(requested.every(url=>url.includes('peerjs@1.5.5')));
 }finally{
  if(oldPeer===undefined)delete globalThis.Peer;else globalThis.Peer=oldPeer;
  if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
 }
});

test('connection UI exposes failure feedback and recovery without exposing credentials',()=>{
 const app=readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 const css=readFileSync(new URL('../docs/lobby-ui.css',import.meta.url),'utf8');
 for(const fragment of ["bq-join-error","retry-connect","test-turn-relay","restart-host-transport","copy-connection-report",
   "joining=ev.target.id==='join-form'","event.visibilityState"] .filter(s=>s!=='event.visibilityState'))
  assert.ok(app.includes(fragment),'UI should include '+fragment);
 assert.ok(app.includes("window.addEventListener('online'"));
 assert.ok(css.includes(".bq-join-error"));
 assert.ok(css.includes(".bq-reconnect-actions"));
 assert.ok(!app.includes("navigator.clipboard.writeText(JSON.stringify(game.data)"));
});
