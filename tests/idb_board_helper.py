"""Read the durable local quizboard IndexedDB in browser integration tests.
Test-only helper; never import into the shipped website.
"""
async def get_value(page,key):
 return await page.evaluate("""async (key) => {
  const db=await new Promise((resolve,reject)=>{
   const request=indexedDB.open('brainquiz-local-workspaces-v1',1);
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error);
  });
  try{
   return await new Promise((resolve,reject)=>{
    const tx=db.transaction('entries','readonly');
    const request=tx.objectStore('entries').get(key);
    request.onsuccess=()=>resolve(request.result??null);
    request.onerror=()=>reject(request.error);
   });
  }finally{db.close();}
 }""",key)

async def get_json(page,key):
 import json
 raw=await get_value(page,key)
 return json.loads(raw) if raw is not None else None

async def get_entries(page):
 return await page.evaluate("""async () => {
  const db=await new Promise((resolve,reject)=>{
   const request=indexedDB.open('brainquiz-local-workspaces-v1',1);
   request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  try{
   return await new Promise((resolve,reject)=>{
    const tx=db.transaction('entries','readonly');
    const entries=[];
    const request=tx.objectStore('entries').openCursor();
    request.onsuccess=()=>{const row=request.result;if(row){entries.push([row.key,row.value]);row.continue();}else resolve(entries);};
    request.onerror=()=>reject(request.error);
   });
  }finally{db.close();}
 }""")
