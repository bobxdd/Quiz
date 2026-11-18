/* Private host-only audit of scoring changes. No answer content or team secrets.
 * Each entry records only the affected point totals, so unrelated changes survive undo.
 * Compensating events are never silently removed from the log.
 */
import {judgementDelta,updatePlayerScore} from './core.mjs';

const copy=x=>x===undefined?undefined:structuredClone(x);
const equals=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clean=s=>String(s??'').slice(0,110);
export function scoreEvent(before,after,{id,kind,team='',person='',actor=person,round='',questionId='',points,verdict='',at=Date.now()}={}){
 const changes={};
 if(team){
  changes.team={id:clean(team),before:copy(before?.scores?.[team]),after:copy(after?.scores?.[team])};
 }
 if(person){
  changes.person={id:clean(person),before:copy(before?.playerScores?.[person]),after:copy(after?.playerScores?.[person])};
 }
 if(!['correct','wrong'].includes(verdict)&&!Object.values(changes).some(c=>!equals(c.before,c.after)))return null;
 return {id:clean(id),kind:clean(kind),round:clean(round),questionId:clean(questionId),
  actor:clean(actor),points,verdict:clean(verdict),at:Number(at)||Date.now(),changes,undoneAt:null};
}
export function appendScoreEvent(events,event,max=120){
 const current=Array.isArray(events)?events:[];
 if(!event)return current;
 if(!event.id||current.some(x=>x.id===event.id))throw Error('Punkteaktion bereits protokolliert.');
 return [...current,event].slice(-max);
}
export function latestUndoableEvent(events){
 return (Array.isArray(events)?events:[]).findLast(e=>e&&!e.undoneAt&&!e.supersededBy)||null;
}
export function mayRegradeScore(state,event){
 if(!event||event.undoneAt||event.supersededBy||!['correct','wrong'].includes(event.verdict))return false;
 const person=event.changes.person;
 return !person||equals(state?.playerScores?.[person.id]?.rounds?.[event.round],person.after?.rounds?.[event.round]);
}
export function regradeScoreEvent(state,events,id,{newId,questionPoints,at=Date.now()}){
 const target=events?.find(event=>event.id===id);
 if(!mayRegradeScore(state,target))throw Error('Diese Bewertung ist nicht mehr aktuell.');
 const verdict=target.verdict==='correct'?'wrong':'correct';
 const points=target.points??questionPoints;
 const adjustment=judgementDelta(points,verdict)-judgementDelta(points,target.verdict);
 const next=structuredClone(state);
 const {team,person}=target.changes;
 if(team){
  if(!Object.hasOwn(next.scores||{},team.id))throw Error('Das Team ist nicht mehr aktiv.');
  const total=Number(next.scores[team.id]||0)+adjustment;
  if(Math.abs(total)>999999)throw Error('Punktelimit überschritten.');
  next.scores[team.id]=total;
 }
 if(person){
  next.playerScores[person.id]=updatePlayerScore(next.playerScores[person.id],{
   kind:'judgement',round:target.round,questionId:target.questionId,points,result:verdict,at
  });
 }
 const event=scoreEvent(state,next,{id:newId,kind:target.kind,team:team?.id,person:person?.id,
  actor:target.actor,round:target.round,questionId:target.questionId,points,verdict,at});
 event.corrects=id;
 const revised=events.map(entry=>entry===target?{...entry,supersededBy:event.id}:entry);
 return {state:next,events:appendScoreEvent(revised,event),event};
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
 const revised=list.map(e=>{
  if(e===target)return {...e,undoneAt:Number(at)||Date.now()};
  if(e.id===target.corrects&&e.supersededBy===target.id){const {supersededBy,...rest}=e;return rest;}
  return e;
 });
 return {state:result,events:revised,event:target};
}
