/* BrainQuiz local board workspaces: distinct drafts, explicit switching, no silent overwrite.
   This module deliberately never touches public PeerJS room state. */
// Deliberately keep this module standalone. Browser tests and offline recovery
// load it from an isolated data: URL; relative ES module imports would break them.
// Mirror the small category model selectors without introducing an import.
const MAX_BALANCE_FIELDS=12;
const categoryKey=value=>String(value??'').trim().replace(/\s+/g,' ').slice(0,70).toLocaleLowerCase('de');
const boardRoundOf=q=>[2,3].includes(Number(q?.boardRound))?Number(q.boardRound):1;
const roundQuestions=(quiz,round=1)=>(quiz?.questions||[]).filter(q=>boardRoundOf(q)===Number(round));
const collectCategories=(stored,questions=[])=>{
 const names=[],seen=new Set();
 const add=value=>{
  const name=String(value??'').trim().replace(/\s+/g,' ').slice(0,70),key=categoryKey(name);
  if(!name||seen.has(key)||names.length>=180)return;
  seen.add(key);names.push(name);
 };
 if(Array.isArray(stored))stored.forEach(add);
 if(Array.isArray(questions))questions.forEach(q=>add(q?.category));
 return names;
};
const questionsInCategory=(questions,category)=>(questions||[]).filter(q=>categoryKey(q?.category)===categoryKey(category));
const roundCategories=(quiz,round=1)=>collectCategories(quiz?.roundCategories?.[round]??(Number(round)===1?quiz?.categories:[]),roundQuestions(quiz,round));
const INDEX='bq-board-workspaces-v1',ACTIVE='bq-board-active-v1';
const key=id=>'bq-board-workspace-'+id;
const LEGACY_QUIZ='bq-quiz-LOCAL',SESSION='bq-session-LOCAL';
const sessionKey=id=>SESSION+'-'+id;
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
function resumeId(store,preferredId){
 const list=boardList(store),active=activeBoard(store);
 // A tab's explicit selection wins over changes to the global last-used pointer by other tabs.
 if(preferredId&&list.some(x=>x.id===preferredId))return preferredId;
 if(active&&!list.some(x=>x.id===active))throw Error('Zuletzt aktives Quizbrett nicht auffindbar. Es wurde kein anderes Brett stillschweigend geladen.');
 return active||list[0]?.id||'';
}
export function resumeBoard(store,emptyQuiz,makeId,preferredId=''){
 const id=resumeId(store,preferredId);
 if(id){
  const saved=loadBoard(store,id);
  if(!activeBoard(store)&&id!==preferredId)store.setItem(ACTIVE,id);
  return saved;
 }
 const old=store.getItem(LEGACY_QUIZ);
 let source=emptyQuiz();
 if(old){
  try{source=JSON.parse(old);}catch{throw Error('Alter lokaler Quizentwurf beschädigt. Er wurde nicht überschrieben. Export oder Wiederherstellung prüfen.');}
  if(!source||!Array.isArray(source.questions))throw Error('Alter lokaler Quizentwurf ungültig. Es wurde kein neues Brett darüber geschrieben.');
 }
 const created=createBoard(store,source,makeId);
 // Preserve a local legacy game progress snapshot if it exists, without deleting the original.
 const oldSession=store.getItem(SESSION);
 if(oldSession){try{store.setItem(sessionKey(created.id),oldSession);}catch{/* quiz is safe; game progress remains in old key */}}
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

/**
 * Transfer a complete category between TWO distinct local saved quizzes.
 * The destination is always saved first: a failed source removal leaves a
 * duplicate category, never a missing one. No live-room data is involved.
 */
export function transferCategoryBetweenBoards(store,{
 sourceId,targetId,expectedSourceRevision,category,sourceRound=1,targetRound=sourceRound,
 move=false,makeQuestionId
}={}){
 if(!validId(sourceId)||!validId(targetId)||sourceId===targetId)
  throw Error('Bitte ein anderes gespeichertes Quizbrett auswählen.');
 if(![1,2,3].includes(Number(sourceRound))||![1,2,3].includes(Number(targetRound)))
  throw Error('Ungültige Spielrunde.');
 const fromRound=Number(sourceRound),toRound=Number(targetRound);
 const source=loadBoard(store,sourceId),target=loadBoard(store,targetId);
 if(fromRound===3&&!source.quiz.balanceBoard||toRound===3&&!target.quiz.balanceBoard)throw Error('Ausgleichs-Board ist im gewählten Quiz nicht aktiv.');
 if(source.revision!==expectedSourceRevision)
  throw Error('Das Quellquiz wurde in einem anderen Tab geändert. Bitte neu laden; es wurde nichts übertragen.');
 const sourceNames=roundCategories(source.quiz,fromRound);
 const sourceName=sourceNames.find(name=>categoryKey(name)===categoryKey(category));
 if(!sourceName)throw Error('Kategorie im ausgewählten Quellbrett nicht gefunden.');
 const sourceQuestions=questionsInCategory(roundQuestions(source.quiz,fromRound),sourceName);
 const destinationNames=roundCategories(target.quiz,toRound);
 const existingName=destinationNames.find(name=>categoryKey(name)===categoryKey(sourceName));
 const destinationName=existingName||sourceName;
 const destinationQuestions=questionsInCategory(roundQuestions(target.quiz,toRound),destinationName);
 if(!existingName&&destinationNames.length>=6)
  throw Error('Im Zielbrett sind bereits sechs Kategorien. Es wurde nichts übertragen.');
 if(destinationQuestions.length+sourceQuestions.length>6)
  throw Error('Die Kategorie würde im Zielbrett mehr als sechs Fragen enthalten. Es wurde nichts übertragen.');
 if(toRound===3&&roundQuestions(target.quiz,3).length+sourceQuestions.length>MAX_BALANCE_FIELDS)throw Error('Im Ausgleichs-Board sind bis zu zwölf Fragen erlaubt.');
 if(toRound===3&&sourceQuestions.some(q=>q.roundMode==='written'||['map','order','team-emoji','team-draw'].includes(q.type)))throw Error('Im Ausgleichs-Board sind nur Buzzerfragen zulässig.');
 if(target.quiz.questions.length+sourceQuestions.length>180)
  throw Error('Das Zielquiz würde mehr als 180 Fragen enthalten. Es wurde nichts übertragen.');
 const targetQuiz=structuredClone(target.quiz);
 const existingIds=new Set(targetQuiz.questions.map(q=>q.id));
 const copiedQuestions=sourceQuestions.map(q=>{
  if(typeof makeQuestionId!=='function')throw Error('Keine sichere Fragen-ID-Quelle vorhanden.');
  const id=makeQuestionId();
  if(typeof id!=='string'||!/^q[0-9a-f]{32}$/.test(id)||existingIds.has(id))
   throw Error('Neue Fragen-ID ungültig oder doppelt. Kein Quiz wurde verändert.');
  existingIds.add(id);
  return {...structuredClone(q),id,category:destinationName,boardRound:toRound};
 });
 const targetRounds={1:roundCategories(targetQuiz,1),2:roundCategories(targetQuiz,2),3:roundCategories(targetQuiz,3)};
 if(!existingName)targetRounds[toRound].push(destinationName);
 targetQuiz.questions.push(...copiedQuestions);
 targetQuiz.roundCategories=targetRounds;
 targetQuiz.categories=collectCategories([...targetRounds[1],...targetRounds[2],...targetRounds[3]],targetQuiz.questions);
 // Validate BOTH future board states before changing any stored data.
 let sourceQuiz=null;
 if(move){
  sourceQuiz=structuredClone(source.quiz);
  const movingIds=new Set(sourceQuestions.map(q=>q.id));
  sourceQuiz.questions=sourceQuiz.questions.filter(q=>!movingIds.has(q.id));
  const sourceRounds={1:roundCategories(source.quiz,1),2:roundCategories(source.quiz,2),3:roundCategories(source.quiz,3)};
  sourceRounds[fromRound]=sourceRounds[fromRound].filter(name=>categoryKey(name)!==categoryKey(sourceName));
  sourceQuiz.roundCategories=sourceRounds;
  sourceQuiz.categories=collectCategories([...sourceRounds[1],...sourceRounds[2],...sourceRounds[3]],sourceQuiz.questions);
 }
 const targetRevision=persistBoard(store,target.id,target.revision,targetQuiz);
 let sourceRevision=source.revision;
 if(move){
  try{sourceRevision=persistBoard(store,source.id,source.revision,sourceQuiz);}
  catch(error){throw Error('Zielbrett gespeichert, aber Quelle nicht entfernt. Die Kategorie liegt sicher in beiden Brettern. '+String(error?.message||error));}
 }
 return {sourceId,targetId,sourceRevision,targetRevision,sourceQuiz,
  copiedQuestions:copiedQuestions.length,category:destinationName,sourceRound:fromRound,targetRound:toRound,move:!!move};
}

const LIBRARY='brainquiz-board-library-v1',RECORDS='workspaces',MIGRATED='legacy-copied';

function openWorkspaceDB(){
 return new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(Error('Der Browser stellt den lokalen Quizspeicher (IndexedDB) nicht bereit.'));return;}
  const request=indexedDB.open(LIBRARY,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(RECORDS);
  request.onblocked=()=>reject(Error('Ein anderer Tab blockiert den Quizspeicher.'));
  request.onerror=()=>reject(request.error||Error('Der Quizspeicher konnte nicht geöffnet werden.'));
  request.onsuccess=()=>{
   const db=request.result;
   db.onversionchange=()=>db.close();
   resolve(db);
  };
 });
}

// Read only the records an operation needs. Enqueue the writes in the same
// transaction so revision checks, the directory and a category move are atomic.
function workspaceTransaction(db,mode,keys,operation,moreKeys){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(RECORDS,mode,{durability:mode==='readwrite'?'strict':'default'});
  const objectStore=tx.objectStore(RECORDS);
  const values=new Map(),changes=new Map();
  const store={
   getItem:name=>values.get(name)??null,
   setItem:(name,value)=>{values.set(name,value);changes.set(name,value);},
   removeItem:name=>{values.delete(name);changes.set(name,null);}
  };
  let failure,result;
  tx.oncomplete=()=>resolve({result,store,changed:changes});
  tx.onabort=()=>reject(failure||tx.error||Error('Die Schreibtransaktion für den Quizspeicher wurde abgebrochen.'));
  const safely=callback=>{
   try{callback();}catch(error){failure=error;tx.abort();}
  };
  const read=(names,done)=>{
   const unique=new Set(names);
   if(!unique.size){done();return;}
   let pending=unique.size;
   for(const name of unique){
    const request=objectStore.get(name);
    request.onsuccess=()=>{
     values.set(name,request.result);
     if(--pending===0)safely(done);
    };
   }
  };
  safely(()=>read(keys,()=>read(moreKeys?.(store)||[],()=>{
   result=operation(store);
   for(const [name,value] of changes){
    if(value===null)objectStore.delete(name);
    else objectStore.put(value,name);
   }
  })));
 });
}

export async function openBoardLibrary({onChange}={}){
 const db=await openWorkspaceDB();
 let library;
 try{
  await workspaceTransaction(db,'readwrite',[MIGRATED],store=>{
   if(store.getItem(MIGRATED))return;
   // Copy the original data verbatim, including orphan records and old game
   // progress. Keep the original keys as a recovery copy. A failed copy aborts
   // with the migration marker unset, so opening the library can retry.
   const legacy=globalThis.localStorage;
   for(let i=0;i<legacy.length;i++){
    const name=legacy.key(i);
    if(name===INDEX||name===ACTIVE||name===LEGACY_QUIZ||name===SESSION||
       name?.startsWith('bq-board-workspace-')||name?.startsWith(SESSION+'-')){
     const value=legacy.getItem(name);
     if(value!==null)store.setItem(name,value);
    }
   }
   store.setItem(MIGRATED,'1');
  });
  const channel=onChange&&typeof BroadcastChannel==='function'?new BroadcastChannel(LIBRARY):null;
  const read=(keys,operation)=>workspaceTransaction(db,'readonly',keys,operation).then(({result})=>result);
  const edit=async(keys,operation,moreKeys)=>{
   const {result,store,changed}=await workspaceTransaction(db,'readwrite',[INDEX,...keys],operation,moreKeys);
   library.boards=boardList(store);
   const boardKeys=[...changed.keys()].filter(name=>name.startsWith('bq-board-workspace-'));
   if(boardKeys.length)channel?.postMessage(boardKeys.map(name=>name.slice('bq-board-workspace-'.length)));
   return result;
  };
  library={
   boards:[],
   async refresh(){library.boards=await read([INDEX],boardList);return library.boards;},
   create(quiz,makeId){
    const id=makeId();
    return edit([key(id)],store=>createBoard(store,quiz,()=>id));
   },
   resume(emptyQuiz,makeId,preferredId=''){
    const freshId=makeId();
    return edit([ACTIVE],
     store=>resumeBoard(store,emptyQuiz,()=>freshId,preferredId),
     store=>{
      const id=resumeId(store,preferredId);
      return id?[key(id)]:[key(freshId),LEGACY_QUIZ,SESSION];
     });
   },
   load:id=>read([INDEX,key(id)],store=>loadBoard(store,id)),
   select:id=>edit([key(id)],store=>selectBoard(store,id)),
   persist:(id,revision,quiz)=>edit([key(id)],store=>persistBoard(store,id,revision,quiz)),
   transferCategory:options=>edit([key(options.sourceId),key(options.targetId)],store=>transferCategoryBetweenBoards(store,options)),
   loadSession:id=>read([sessionKey(id)],store=>parse(store.getItem(sessionKey(id)),null)),
   async saveSession(id,session){
    const snapshot=JSON.stringify(session);
    await workspaceTransaction(db,'readwrite',[],store=>store.setItem(sessionKey(id),snapshot));
   },
   async clearSession(id){
    await workspaceTransaction(db,'readwrite',[],store=>store.removeItem(sessionKey(id)));
   },
   close(){channel?.close();db.close();}
  };
  await library.refresh();
  if(channel)channel.onmessage=event=>onChange(event.data);
  return library;
 }catch(error){
  if(library)library.close();
  else db.close();
  throw error;
 }
}
