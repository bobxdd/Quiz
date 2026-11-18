/* Private host-only audit of scoring changes. No answer content or team secrets.
 * Each entry records only the affected point totals, so unrelated changes survive undo.
 * Compensating events are never silently removed from the log.
 */
const copy=x=>x===undefined?undefined:structuredClone(x);
const equals=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clean=s=>String(s??'').slice(0,110);
export function scoreEvent(before,after,{id,kind,team='',person='',round='',questionId='',verdict='',at=Date.now()}={}){
 const changes={};
 if(team){
  changes.team={id:clean(team),before:copy(before?.scores?.[team]),after:copy(after?.scores?.[team])};
 }
 if(person){
  changes.person={id:clean(person),before:copy(before?.playerScores?.[person]),after:copy(after?.playerScores?.[person])};
 }
 if(!Object.values(changes).some(c=>!equals(c.before,c.after)))return null;
 return {id:clean(id),kind:clean(kind),round:clean(round),questionId:clean(questionId),
  verdict:clean(verdict),at:Number(at)||Date.now(),changes,undoneAt:null};
}
export function appendScoreEvent(events,event,max=120){
 const current=Array.isArray(events)?events:[];
 if(!event)return current;
 if(!event.id||current.some(x=>x.id===event.id))throw Error('Punkteaktion bereits protokolliert.');
 return [...current,event].slice(-max);
}
export function latestUndoableEvent(events){
 return (Array.isArray(events)?events:[]).findLast(e=>e&&!e.undoneAt)||null;
}
export function undoScoreEvent(state,events,id,at=Date.now()){
 const list=Array.isArray(events)?events:[];
 const target=latestUndoableEvent(list);
 if(!target||target.id!==id)throw Error('Nur die letzte noch aktive Punkteänderung kann zurückgenommen werden.');
 const result=structuredClone(state);
 for(const [name,path] of [['team','scores'],['person','playerScores']]){
  const change=target.changes?.[name];if(!change)continue;
  const now=result?.[path]?.[change.id];
  if(!equals(now,change.after))throw Error('Punkte haben sich inzwischen verändert. Zuerst die neuere Bewertung prüfen.');
 }
 for(const [name,path] of [['team','scores'],['person','playerScores']]){
  const change=target.changes?.[name];if(!change)continue;
  result[path]??={};
  if(change.before===undefined)delete result[path][change.id];
  else result[path][change.id]=copy(change.before);
 }
 const revised=list.map(e=>e===target?{...e,undoneAt:Number(at)||Date.now()}:e);
 return {state:result,events:revised,event:target};
}
