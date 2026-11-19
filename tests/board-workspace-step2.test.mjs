import test from 'node:test';
import assert from 'node:assert/strict';
import {boardList,activeBoard,createBoard,loadBoard,resumeBoard,selectBoard,persistBoard} from '../docs/board-workspace.mjs';
const ids=['b'+'a'.repeat(32),'b'+'b'.repeat(32),'b'+'c'.repeat(32)];
class Store{
 data=new Map();failKey='';
 getItem(k){return this.data.has(k)?this.data.get(k):null;}
 setItem(k,v){if(k===this.failKey)throw new Error('quota');this.data.set(k,String(v));}
 removeItem(k){this.data.delete(k);}
}
const draft=name=>({title:name,questions:[],teams:['Team 1'],version:1});
test('first opening creates one board and reopening preserves identity',()=>{
 const store=new Store();const opened=resumeBoard(store,()=>draft('A'),()=>ids[0]);
 assert.equal(opened.id,ids[0]);assert.equal(activeBoard(store),ids[0]);
 assert.deepEqual(resumeBoard(store,()=>draft('B'),()=>ids[1]),opened);
});
test('migrates legacy LOCAL by copying without deleting source',()=>{
 const store=new Store();store.setItem('bq-quiz-LOCAL',JSON.stringify(draft('Legacy')));
 const r=resumeBoard(store,()=>draft('Empty'),()=>ids[0]);
 assert.equal(r.quiz.title,'Legacy');assert.equal(JSON.parse(store.getItem('bq-quiz-LOCAL')).title,'Legacy');
});
test('independent boards with identical titles cannot overwrite each other',()=>{
 const store=new Store();const a=createBoard(store,draft('Same'),()=>ids[0]);
 const b=createBoard(store,draft('Same'),()=>ids[1]);
 let revision=persistBoard(store,a.id,a.revision,draft('Changed'));
 assert.equal(revision,2);assert.equal(loadBoard(store,b.id).quiz.title,'Same');
 assert.equal(selectBoard(store,a.id).quiz.title,'Changed');
 assert.equal(activeBoard(store),a.id);
 assert.equal(boardList(store).length,2);
});
test('rejects stale concurrent writes from second tab',()=>{
 const store=new Store();const a=createBoard(store,draft('Original'),()=>ids[0]);
 persistBoard(store,a.id,a.revision,draft('Tab 1'));
 assert.throws(()=>persistBoard(store,a.id,a.revision,draft('Tab 2')),/anderen Tab/);
 assert.equal(loadBoard(store,a.id).quiz.title,'Tab 1');
});
test('bad or missing board never replaces with a blank draft',()=>{
 const store=new Store();createBoard(store,draft('Keep'),()=>ids[0]);
 store.setItem('bq-board-workspace-'+ids[0],'{broken');
 assert.throws(()=>resumeBoard(store,()=>draft('Empty'),()=>ids[1]),/beschädigt/);
 assert.equal(boardList(store).length,1);
});
test('failed storage allocation must not activate or list new board',()=>{
 const store=new Store();const a=createBoard(store,draft('Good'),()=>ids[0]);
 store.failKey='bq-board-workspaces-v1';
 assert.throws(()=>createBoard(store,draft('Bad'),()=>ids[1]),/quota/);
 assert.equal(activeBoard(store),a.id);assert.equal(boardList(store).length,1);
 assert.equal(store.getItem('bq-board-workspace-'+ids[1]),null);
});
test('board identifiers must be valid and unique',()=>{
 const store=new Store();createBoard(store,draft('A'),()=>ids[0]);
 assert.throws(()=>createBoard(store,draft('B'),()=>ids[0]),/bereits/);
 assert.throws(()=>createBoard(store,draft('Bad'),()=> '../trash'),/ungültig/);
});
test('source wiring keeps offline editor and live room separate',async()=>{
 const fs=await import('node:fs');const app=fs.readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 const editor=fs.readFileSync(new URL('../docs/studio-editor.mjs',import.meta.url),'utf8');
 assert.match(app,/resumeBoard\(boardStore,emptyQuiz,makeBoardId,preferred\)/);
 assert.match(app,/case 'new-board':await newStoredBoard\(\)/);
 assert.match(app,/case 'open-board':await openStoredBoard\(button.dataset.boardId\)/);
 assert.match(app,/createBoard\(boardStore,imported,makeBoardId\)/);
 assert.match(editor,/DU BEARBEITEST DIESES QUIZBRETT/);
 assert.match(editor,/data-action="new-board"/);
 assert.match(editor,/data-action="open-board"/);
});

test('corrupted board index is never silently replaced with an empty library',()=>{
 const store=new Store();store.setItem('bq-board-workspaces-v1','{corrupt');
 assert.throws(()=>resumeBoard(store,()=>draft('Wrong'),()=>ids[2]),/Verzeichnis beschädigt/);
 assert.equal(store.getItem('bq-board-workspaces-v1'),'{corrupt');
});
test('editing a board updates its library label without changing identity',()=>{
 const store=new Store();const a=createBoard(store,draft('Before'),()=>ids[0]);
 persistBoard(store,a.id,a.revision,draft('After'));
 assert.deepEqual(boardList(store).map(x=>[x.id,x.title]),[[ids[0],'After']]);
});

test('reset action uses per-board session key and cannot erase other boards',async()=>{
 const fs=await import('node:fs');const app=fs.readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 assert.match(app,/boardStore\.removeItem\('bq-session-LOCAL-'\+boardId\)/);
 assert.doesNotMatch(app,/localStorage\.removeItem\('bq-session-LOCAL'\)/);
});

test('saving unchanged board does not increment revision or cause false second-tab conflict',()=>{
 const store=new Store(),a=createBoard(store,draft('A'),()=>ids[0]);
 assert.equal(persistBoard(store,a.id,a.revision,draft('A')),a.revision);
 assert.equal(persistBoard(store,a.id,a.revision,draft('A')),a.revision);
 assert.equal(loadBoard(store,a.id).revision,1);
});
test('active pointer failure rolls back new board and leaves current unchanged',()=>{
 const store=new Store(),a=createBoard(store,draft('Keep'),()=>ids[0]);
 store.failKey='bq-board-active-v1';
 assert.throws(()=>createBoard(store,draft('Not active'),()=>ids[1]),/quota/);
 assert.equal(activeBoard(store),a.id);
 assert.equal(boardList(store).length,1);
 assert.equal(store.getItem('bq-board-workspace-'+ids[1]),null);
});
test('legacy round progress is copied, not deleted, on first migration',()=>{
 const store=new Store();
 store.setItem('bq-quiz-LOCAL',JSON.stringify(draft('Earlier')));
 store.setItem('bq-session-LOCAL',JSON.stringify({round:5,used:{old:true}}));
 const b=resumeBoard(store,()=>draft('Empty'),()=>ids[0]);
 assert.deepEqual(JSON.parse(store.getItem('bq-session-LOCAL-'+b.id)),{round:5,used:{old:true}});
 assert.ok(store.getItem('bq-session-LOCAL'));
});
test('corrupted legacy quiz is preserved and never silently replaced with blank',()=>{
 const store=new Store();store.setItem('bq-quiz-LOCAL','{incomplete');
 assert.throws(()=>resumeBoard(store,()=>draft('Blank'),()=>ids[0]),/beschädigt/);
 assert.equal(boardList(store).length,0);
 assert.equal(store.getItem('bq-quiz-LOCAL'),'{incomplete');
});
test('failed record update does not touch saved old revision or title index',()=>{
 const store=new Store(),a=createBoard(store,draft('Good'),()=>ids[0]);
 store.failKey='bq-board-workspace-'+a.id;
 assert.throws(()=>persistBoard(store,a.id,a.revision,draft('Unsaved')),/quota/);
 assert.equal(loadBoard(store,a.id).revision,a.revision);
 assert.equal(loadBoard(store,a.id).quiz.title,'Good');
 assert.equal(boardList(store)[0].title,'Good');
});
test('conflict recovery UX and original board load are present and reachable',async()=>{
 const fs=await import('node:fs');
 const app=fs.readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 const ui=fs.readFileSync(new URL('../docs/studio-editor.mjs',import.meta.url),'utf8');
 assert.match(app,/async function rescueStoredBoard\(/);
 assert.match(app,/async function reloadStoredBoard\(/);
 assert.match(app,/case 'rescue-board':await rescueStoredBoard\(\)/);
 assert.match(app,/case 'reload-board':await reloadStoredBoard\(\)/);
 assert.match(app,/window\.addEventListener\('storage'/);
 assert.match(app,/boardConflict=true/);
 assert.match(ui,/data-action="rescue-board"/);
 assert.match(ui,/data-action="reload-board"/);
 assert.match(ui,/data-action="export"/);
 assert.match(ui,/role="alert"/);
});

test('per-tab preference overrides global last-used board without rewriting global pointer',()=>{
 const store=new Store();
 const a=createBoard(store,draft('A'),()=>ids[0]);
 const b=createBoard(store,draft('B'),()=>ids[1]);
 assert.equal(activeBoard(store),b.id);
 const tabA=resumeBoard(store,()=>draft('Empty'),()=>ids[2],a.id);
 assert.equal(tabA.id,a.id);
 assert.equal(activeBoard(store),b.id);
});
test('unknown global active board never silently switches to some other draft',()=>{
 const store=new Store();createBoard(store,draft('A'),()=>ids[0]);
 store.setItem('bq-board-active-v1',ids[2]);
 assert.throws(()=>resumeBoard(store,()=>draft('Blank'),()=>ids[1]),/nicht auffindbar/);
 assert.equal(boardList(store).length,1);
});
test('duplicate and invalid board library records fail closed',()=>{
 const store=new Store();const a=createBoard(store,draft('A'),()=>ids[0]);
 const x=boardList(store)[0];store.setItem('bq-board-workspaces-v1',JSON.stringify([x,x]));
 assert.throws(()=>boardList(store),/doppelte Kennungen/);
 store.setItem('bq-board-workspaces-v1',JSON.stringify([x,{id:'../../x',title:'Fake'}]));
 assert.throws(()=>boardList(store),/ungültige/);
 assert.equal(store.getItem('bq-board-workspace-'+a.id)!==null,true);
});

test('every board export contains a distinct title and board identifier',async()=>{
 const fs=await import('node:fs');const app=fs.readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 assert.match(app,/function backupFilename\(/);
 assert.match(app,/location=isOffline\(\)\?boardId\.slice\(1,8\):room/);
 assert.match(app,/case 'export':safeDownload\(backupFilename\(\)/);
 assert.ok(app.includes("backup:()=>safeDownload(backupFilename('BrainQuiz_Backup')"));
 assert.match(app,/safeDownload\(backupFilename\('BrainQuiz_Autosicherung'\)/);
});
test('destructive live room import first exports a private backup',async()=>{
 const fs=await import('node:fs');const app=fs.readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 const section=app.slice(app.indexOf('async function handleImport('),app.indexOf('function updateClock()'));
 assert.match(section,/safeDownload\(backupFilename\('BrainQuiz_Vor_Import'\)/);
 assert.ok(section.indexOf("safeDownload(backupFilename('BrainQuiz_Vor_Import')")<section.indexOf('snapshotLayout();quiz=imported;'));
});
