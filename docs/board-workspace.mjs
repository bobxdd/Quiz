/* BrainQuiz local board workspaces: distinct drafts, explicit switching, no silent overwrite.
   This module deliberately never touches public PeerJS room state. */
const INDEX='bq-board-workspaces-v1',ACTIVE='bq-board-active-v1';
const key=id=>'bq-board-workspace-'+id;
const validId=id=>typeof id==='string'&&/^b[0-9a-f]{32}$/.test(id);
const parse=(raw,fallback)=>{try{return raw?JSON.parse(raw):fallback;}catch{return fallback;}};
const clean=(items)=>Array.isArray(items)?items.filter(x=>validId(x?.id)).slice(0,100).map(x=>({id:x.id,title:String(x.title||'Unbenanntes Quizbrett').slice(0,100),updatedAt:Math.max(0,Number(x.updatedAt)||0)})):[];
export function boardList(store){return clean(parse(store.getItem(INDEX),[]));}
export function activeBoard(store){return store.getItem(ACTIVE)||'';}
export function createBoard(store,quiz,makeId,{activate=true}={}){
 const existing=boardList(store);if(existing.length>=100)throw Error('Maximal 100 lokale Quizbretter. Bitte zuerst bestehende Bretter als Backup exportieren.');
 const id=makeId();if(!validId(id)||existing.some(x=>x.id===id)||store.getItem(key(id)))throw Error('Quizbrett-ID ungültig oder bereits vergeben.');
 const record={revision:1,quiz};
 store.setItem(key(id),JSON.stringify(record));
 try{store.setItem(INDEX,JSON.stringify([...boardList(store),{id,title:String(quiz.title||'Neues Quizbrett').slice(0,100),updatedAt:Date.now()}]));}
 catch(err){store.removeItem(key(id));throw err;}
 if(activate)store.setItem(ACTIVE,id);
 return {id,revision:1,quiz};
}
export function loadBoard(store,id){
 if(!validId(id)||!boardList(store).some(x=>x.id===id))throw Error('Quizbrett nicht gefunden.');
 const raw=store.getItem(key(id));
 if(!raw)throw Error('Quizbrett-Daten fehlen. Es wurde nichts überschrieben.');
 let data;try{data=JSON.parse(raw);}catch{throw Error('Quizbrett-Daten beschädigt. Es wurde nichts überschrieben.');}
 if(!data||!data.quiz||!Array.isArray(data.quiz.questions)||!Number.isSafeInteger(data.revision)||data.revision<1)throw Error('Quizbrett-Daten ungültig. Es wurde nichts überschrieben.');
 return {id,revision:data.revision,quiz:data.quiz};
}
export function resumeBoard(store,emptyQuiz,makeId){
 const list=boardList(store),active=activeBoard(store);
 if(active&&list.some(x=>x.id===active))return loadBoard(store,active);
 if(list.length){const saved=loadBoard(store,list[0].id);store.setItem(ACTIVE,saved.id);return saved;}
 // Legacy migration: the old LOCAL draft is COPIED, never removed or overwritten.
 const legacy=parse(store.getItem('bq-quiz-LOCAL'),null);
 const source=legacy&&Array.isArray(legacy.questions)?legacy:emptyQuiz();
 return createBoard(store,source,makeId);
}
export function selectBoard(store,id){const result=loadBoard(store,id);store.setItem(ACTIVE,id);return result;}
export function persistBoard(store,id,expectedRevision,quiz){
 const record=loadBoard(store,id);
 if(record.revision!==expectedRevision)throw Error('Dieses Quizbrett wurde in einem anderen Tab verändert. Bitte den Editor neu laden, um Überschreiben zu verhindern.');
 const next=expectedRevision+1;
 store.setItem(key(id),JSON.stringify({revision:next,quiz}));
 const list=boardList(store).map(x=>x.id===id?{...x,title:String(quiz.title||'Unbenanntes Quizbrett').slice(0,100),updatedAt:Date.now()}:x);
 try{store.setItem(INDEX,JSON.stringify(list));}catch{ /* Draft is saved; index title can be repaired at next save. */ }
 return next;
}
