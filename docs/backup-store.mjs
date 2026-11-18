/* Private redundant host checkpoint. IndexedDB is a fallback, not an excuse to
 * discard the existing localStorage format. Callers serialize writes in order.
 * Never transmit these checkpoints to guests or put them in Service Worker cache.
 */
const DB='brainquiz-private-recovery-v1',STORE='checkpoints';
const validKey=k=>/^(session|quiz)-[A-HJ-NP-Z2-9]{16}$/.test(String(k||''));
function openDB(){
 if(!globalThis.indexedDB)return Promise.resolve(null);
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('IndexedDB nicht erreichbar.'));
  request.onblocked=()=>reject(Error('Der Host-Speicher ist durch einen anderen Tab blockiert.'));
 });
}
async function access(key,mode,value){
 if(!validKey(key))throw Error('Ungültiger Backup-Schlüssel.');
 const db=await openDB();if(!db)return null;
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode==='read'?'readonly':'readwrite'),store=tx.objectStore(STORE);
  const request=mode==='read'?store.get(key):mode==='delete'?store.delete(key):store.put(value,key);
  let readValue=null;
  request.onsuccess=()=>{if(mode==='read')readValue=request.result??null;};
  tx.oncomplete=()=>resolve(mode==='read'?readValue:true);
  tx.onerror=()=>reject(tx.error||Error('Host-Backup konnte nicht gespeichert werden.'));
  tx.onabort=()=>reject(tx.error||Error('Host-Backup wurde abgebrochen.'));
 });}finally{db.close();}
}
export const saveHostCheckpoint=(key,value)=>access(key,'write',structuredClone(value));
export const loadHostCheckpoint=key=>access(key,'read');
export const deleteHostCheckpoint=key=>access(key,'delete');
