/* Large local quiz boards live in IndexedDB rather than the ~5 MiB
 * Web Storage quota. This adapter deliberately implements the synchronous
 * getItem/setItem interface of board-workspace.mjs. Changes are staged in
 * memory and MUST be awaited with flush() before claiming a durable save.
 *
 * Existing localStorage records are COPIED (never deleted) during migration.
 * The entire index and each board snapshot are committed atomically. A
 * compare-and-swap check prevents a second tab overwriting a newer revision.
 */
const DATABASE='brainquiz-local-workspaces-v1',TABLE='entries';
const INDEX='bq-board-workspaces-v1',ACTIVE='bq-board-active-v1';
const PREFIX='bq-board-workspace-', SESSION='bq-session-LOCAL-';
const managed=key=>key===INDEX||key===ACTIVE||key.startsWith(PREFIX)||key.startsWith(SESSION);
const copyValue=value=>value==null?null:String(value);
const errText=error=>String(error?.message||error||'Speicherfehler');
function openDatabase(){
 if(!globalThis.indexedDB)return Promise.reject(Error('IndexedDB ist in diesem Browser nicht verfügbar. Bitte zuerst ein Backup herunterladen.'));
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DATABASE,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(TABLE))request.result.createObjectStore(TABLE);};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('IndexedDB konnte nicht geöffnet werden.'));
  request.onblocked=()=>reject(Error('Die Speicherung wird von einem anderen Browser-Tab blockiert. Bitte dort das Quiz sichern.'));
 });
}
function readEntries(db){
 return new Promise((resolve,reject)=>{
  const map=new Map(),tx=db.transaction(TABLE,'readonly'),store=tx.objectStore(TABLE);
  const request=store.openCursor();
  request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;map.set(String(cursor.key),copyValue(cursor.value));cursor.continue();};
  tx.oncomplete=()=>resolve(map);
  tx.onerror=()=>reject(tx.error||Error('Quiz-Datenbank konnte nicht gelesen werden.'));
  tx.onabort=()=>reject(tx.error||Error('Quiz-Datenbank-Lesevorgang abgebrochen.'));
 });
}
function commit(db,writes,baseline){
 if(!writes.size)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(TABLE,'readwrite'),store=tx.objectStore(TABLE);
  let conflict=null;
  for(const [key,value] of writes){
   const request=store.get(key);
   request.onsuccess=()=>{
    const actual=copyValue(request.result);
    if(actual!==(baseline.get(key)??null)){
     conflict=Error('Ein anderer Tab hat das Quizbrett verändert. Es wurde nichts überschrieben. Bitte ein Backup exportieren.');
     try{tx.abort();}catch{}
     return;
    }
    if(value===null)store.delete(key);else store.put(value,key);
   };
  }
  tx.oncomplete=()=>resolve();
  tx.onerror=()=>reject(conflict||tx.error||Error('Quiz konnte nicht in IndexedDB gespeichert werden.'));
  tx.onabort=()=>reject(conflict||tx.error||Error('Quiz-Speicherung wurde abgebrochen.'));
 });
}
function legacyEntries(storage){
 // Do not silently initialize an empty database when existing local boards
 // have a corrupted directory: the old bytes must remain recoverable.
 const legacy=new Map(),raw=storage.getItem(INDEX);
 if(raw){
  let list;
  try{list=JSON.parse(raw);}catch{throw Error('Altes Quizbrett-Verzeichnis ist beschädigt. Keine Daten wurden verändert. Bitte zuerst ein Backup erstellen.');}
  if(!Array.isArray(list))throw Error('Altes Quizbrett-Verzeichnis ungültig. Keine Daten wurden verändert.');
  const seen=new Set();
  for(const item of list){
   const id=item?.id;
   if(typeof id!=='string'||!/^b[0-9a-f]{32}$/.test(id)||seen.has(id))throw Error('Ungültiger Eintrag im alten Quizbrett-Verzeichnis. Keine Daten wurden verändert.');
   seen.add(id);
   const value=storage.getItem(PREFIX+id);
   if(!value)throw Error('Altes Quizbrett „'+id+'“ fehlt. Keine Daten wurden überschrieben.');
   let record;try{record=JSON.parse(value);}catch{throw Error('Altes Quizbrett „'+id+'“ beschädigt. Keine Daten wurden überschrieben.');}
   if(!record?.quiz||!Array.isArray(record.quiz.questions)||!Number.isSafeInteger(record.revision))throw Error('Altes Quizbrett „'+id+'“ ungültig. Bitte ein Backup erstellen.');
   legacy.set(PREFIX+id,value);
   const session=storage.getItem(SESSION+id);if(session)legacy.set(SESSION+id,session);
  }
  legacy.set(INDEX,raw);
 }
 const active=storage.getItem(ACTIVE);
 if(active)legacy.set(ACTIVE,active);
 return legacy;
}
export async function openBoardStorage(storage=localStorage){
 const db=await openDatabase();
 try{
  let confirmed=await readEntries(db);
  // Start from a safe copy of the old data. The original localStorage keys
  // stay untouched even after many new successful saves in IndexedDB.
  if(!confirmed.has(INDEX)){
   const legacy=legacyEntries(storage);
   if(legacy.size){
    await commit(db,legacy,confirmed);
    confirmed=await readEntries(db);
   }
  }
  const memory=new Map(confirmed),dirty=new Map();
  let tail=Promise.resolve(),unresolvedError=null,externalChange=()=>{};
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('brainquiz-local-workspaces-v1'):null;
  if(channel)channel.onmessage=event=>{
   if(event.data?.type==='saved'&&Array.isArray(event.data.keys))externalChange(event.data.keys);
  };
  const adapter={
   kind:'indexeddb',
   getItem(key){if(managed(key))return memory.get(key)??null;return storage.getItem(key);},
   setItem(key,value){
    if(!managed(key)){storage.setItem(key,value);return;}
    const text=String(value);memory.set(key,text);dirty.set(key,text);
   },
   removeItem(key){
    if(!managed(key)){storage.removeItem(key);return;}
    memory.delete(key);dirty.set(key,null);
   },
   onExternalChange(callback){externalChange=typeof callback==='function'?callback:()=>{};},
   hasPending(){return dirty.size>0||!!adapter.writing;},
   writing:false,
   async flush(){
    const task=tail.then(async()=>{
     if(unresolvedError)throw unresolvedError;
     if(!dirty.size)return;
     const batch=new Map(dirty);dirty.clear();adapter.writing=true;
     try{
      await commit(db,batch,confirmed);
      for(const [key,value] of batch){if(value===null)confirmed.delete(key);else confirmed.set(key,value);}
      channel?.postMessage({type:'saved',keys:[...batch.keys()]});
     }catch(error){
      // Retain the attempted changes in RAM and keep the original in IDB.
      for(const [key,value] of batch)if(!dirty.has(key))dirty.set(key,value);
      unresolvedError=error instanceof Error?error:Error(errText(error));
      throw unresolvedError;
     }finally{adapter.writing=false;}
    });
    tail=task.catch(()=>{});
    return task;
   },
   async reload({discardPending=false}={}){
    await tail;
    if(dirty.size&&!discardPending)throw Error('Nicht gespeicherte Änderungen vorhanden. Vorher als Backup exportieren.');
    const fresh=await readEntries(db);
    dirty.clear();memory.clear();confirmed.clear();
    for(const [k,v] of fresh){memory.set(k,v);confirmed.set(k,v);}
    unresolvedError=null;
   },
   close(){channel?.close();db.close();}
  };
  return adapter;
 }catch(error){db.close();throw error;}
}
