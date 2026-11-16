/* BrainQuiz local board workspaces: distinct drafts, explicit switching, no silent overwrite.
   This module deliberately never touches public PeerJS room state. */
const INDEX='bq-board-workspaces-v1',ACTIVE='bq-board-active-v1';
const key=id=>'bq-board-workspace-'+id;
const validId=id=>typeof id==='string'&&/^b[0-9a-f]{32}$/.test(id);
const parse=(raw,fallback)=>{try{return raw?JSON.parse(raw):fallback;}catch{return fallback;}};
const clean=(items)=>{
 const seen=new Set(),out=[];
 for(const entry of items){
  if(!validId(entry?.id)||seen.has(entry.id))throw Error('Quizbrett-Verzeichnis enthält ungültige oder doppelte Kennungen. Keine Daten wurden überschrieben.');
  seen.add(entry.id);
  out.push({id:entry.id,title:String(entry.title||'Unbenanntes Quizbrett').slice(0,100),updatedAt:Math.max(0,Number(entry.updatedAt)||0)});
 }
 if(out.length>100)throw Error('Quizbrett-Verzeichnis zu groß. Bitte zunächst Sicherungen erstellen.');
 return out;
};
export function boardList(store){const raw=store.getItem(INDEX);if(!raw)return [];let data;try{data=JSON.parse(raw);}catch{throw Error('Quizbrett-Verzeichnis beschädigt. Vorhandene Quizbretter wurden nicht verändert.');}if(!Array.isArray(data))throw Error('Quizbrett-Verzeichnis ungültig. Vorhandene Quizbretter wurden nicht verändert.');return clean(data);}
export function activeBoard(store){return store.getItem(ACTIVE)||'';}
export function createBoard(store,quiz,makeId,{activate=true}={}){
 const existing=boardList(store);if(existing.length>=100)throw Error('Maximal 100 lokale Quizbretter. Bitte zuerst bestehende Bretter als Backup exportieren.');
 const id=makeId();if(!validId(id)||existing.some(x=>x.id===id)||store.getItem(key(id)))throw Error('Quizbrett-ID ungültig oder bereits vergeben.');
 const record={revision:1,quiz},oldIndex=store.getItem(INDEX),oldActive=store.getItem(ACTIVE);
 let stage=0;
 try{
  store.setItem(key(id),JSON.stringify(record));stage=1;
  store.setItem(INDEX,JSON.stringify([...existing,{id,title:String(quiz.title||'Neues Quizbrett').slice(0,100),updatedAt:Date.now()}]));stage=2;
  if(activate)store.setItem(ACTIVE,id);stage=3;
 }catch(err){
  // Compensating rollback: avoid an indexed but invisible "new" board when active write fails.
  // A browser/process crash can still interrupt multiple localStorage operations: never claim ACID.
  if(stage>=2){
   try{oldIndex===null?store.removeItem(INDEX):store.setItem(INDEX,oldIndex);stage=1;}catch{}
  }
  if(stage===1){try{store.removeItem(key(id));}catch{}}
  if(stage>=3){try{oldActive===null?store.removeItem(ACTIVE):store.setItem(ACTIVE,oldActive);}catch{}}
  throw err;
 }
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
export function resumeBoard(store,emptyQuiz,makeId,preferredId=''){
 const list=boardList(store),active=activeBoard(store);
 // A tab's explicit selection wins over changes to the global last-used pointer by other tabs.
 if(preferredId&&list.some(x=>x.id===preferredId))return loadBoard(store,preferredId);
 if(active){if(!list.some(x=>x.id===active))throw Error('Zuletzt aktives Quizbrett nicht auffindbar. Es wurde kein anderes Brett stillschweigend geladen.');return loadBoard(store,active);}
 if(list.length){const saved=loadBoard(store,list[0].id);store.setItem(ACTIVE,saved.id);return saved;}
 // Legacy migration: the old LOCAL draft is COPIED, never removed or overwritten.
 const old=store.getItem('bq-quiz-LOCAL');
 let source=emptyQuiz();
 if(old){
  try{source=JSON.parse(old);}catch{throw Error('Alter lokaler Quizentwurf beschädigt. Er wurde nicht überschrieben. Export oder Wiederherstellung prüfen.');}
  if(!source||!Array.isArray(source.questions))throw Error('Alter lokaler Quizentwurf ungültig. Es wurde kein neues Brett darüber geschrieben.');
 }
 const created=createBoard(store,source,makeId);
 // Preserve a local legacy game progress snapshot if it exists, without deleting the original.
 const oldSession=store.getItem('bq-session-LOCAL');
 if(oldSession){try{store.setItem('bq-session-LOCAL-'+created.id,oldSession);}catch{/* quiz is safe; game progress remains in old key */}}
 return created;
}
export function selectBoard(store,id){const result=loadBoard(store,id);store.setItem(ACTIVE,id);return result;}
export function persistBoard(store,id,expectedRevision,quiz){
 const record=loadBoard(store,id);
 if(record.revision!==expectedRevision)throw Error('Dieses Quizbrett wurde in einem anderen Tab verändert. Bitte als Kopie retten oder die gespeicherte Version öffnen.');
 // Avoid revisions for read-only/no-op events: otherwise ordinary navigation creates false conflicts.
 if(JSON.stringify(record.quiz)===JSON.stringify(quiz))return expectedRevision;
 const next=expectedRevision+1;
 store.setItem(key(id),JSON.stringify({revision:next,quiz}));
 const list=boardList(store).map(x=>x.id===id?{...x,title:String(quiz.title||'Unbenanntes Quizbrett').slice(0,100),updatedAt:Date.now()}:x);
 try{store.setItem(INDEX,JSON.stringify(list));}catch{ /* Draft is saved; index title can be repaired at next save. */ }
 return next;
}
