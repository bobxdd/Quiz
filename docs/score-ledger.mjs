/* Private host-only audit of scoring changes. No answer content or team secrets.
 * Each entry records only the affected point totals, so unrelated changes survive undo.
 * Compensating events are never silently removed from the log.
 */
import {judgementDelta,updatePlayerScore} from './core.mjs';
import {JOKER_TYPES,jokerCount,changeJokerCharge,awardJokerForCorrectAnswer,shieldApplies} from './joker-system.mjs';

const copy=x=>x===undefined?undefined:structuredClone(x);
const equals=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clean=s=>String(s??'').slice(0,110);
export function scoreEvent(before,after,{id,kind,team='',person='',actor=person,round='',questionId='',points,verdict='',effectiveDelta,shieldUsed,fundAward,at=Date.now()}={}){
 const changes={};
 if(team){
  changes.team={id:clean(team),before:copy(before?.scores?.[team]),after:copy(after?.scores?.[team])};
  const charges=JOKER_TYPES.map(type=>({type,delta:jokerCount(after,team,type)-jokerCount(before,team,type)})).filter(change=>change.delta);
  if(charges.length)changes.jokers=charges;
  if(before?.jokerShields?.[team]!==after?.jokerShields?.[team]){
   changes.shield={before:before?.jokerShields?.[team],after:after?.jokerShields?.[team]};
  }
  const previous=before?.jokerEvent,current=after?.jokerEvent;
  if(!equals(previous,current)&&Number(current?.round??previous?.round)===Number(round)){
   changes.fund={before:copy(previous),after:copy(current)};
   fundAward??=current?.awarded&&current.team===team?copy(current):null;
  }
  shieldUsed??=verdict==='wrong'&&charges.some(change=>change.type==='shield'&&change.delta===-1);
 }
 if(person){
  changes.person={id:clean(person),before:copy(before?.playerScores?.[person]),after:copy(after?.playerScores?.[person])};
 }
 if(!['correct','wrong'].includes(verdict)&&!Object.values(changes).some(c=>!equals(c.before,c.after)))return null;
 // A shield can turn a wrong verdict into zero points. Preserve the real
 // awarded amount, not the usual penalty, for later score-only regrading.
 if(['correct','wrong'].includes(verdict)&&!Number.isFinite(effectiveDelta)){
  const recorded=changes.person?.after?.rounds?.[String(round)]?.delta;
  if(Number.isFinite(recorded))effectiveDelta=recorded;
  else if(Number.isFinite(changes.team?.before)&&Number.isFinite(changes.team?.after))effectiveDelta=changes.team.after-changes.team.before;
 }
 return {id:clean(id),kind:clean(kind),round:clean(round),questionId:clean(questionId),
  actor:clean(actor),points,verdict:clean(verdict),...(Number.isFinite(effectiveDelta)?{effectiveDelta}:{}),
  ...(shieldUsed?{shieldUsed:true}:{}),...(fundAward?{fundAward}:{}),at:Number(at)||Date.now(),changes,undoneAt:null};
}
function adjustJoker(state,team,type,delta){
 const updated=changeJokerCharge(state,team,type,delta);
 if(!updated)throw Error('Der Jokerbestand verhindert diese Korrektur. Prüfe zuerst die Ladungen des Teams.');
 state.jokers=updated.jokers;
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
 let nextDelta=judgementDelta(points,verdict);
 const previousDelta=Number.isFinite(target.effectiveDelta)?target.effectiveDelta:judgementDelta(points,target.verdict);
 let next=structuredClone(state);
 let shieldUsed=false,fundAward=null;
 const {team,person}=target.changes;
 if(team){
  if(!Object.hasOwn(next.scores||{},team.id))throw Error('Das Team ist nicht mehr aktiv.');
  if(target.shieldUsed){
   adjustJoker(next,team.id,'shield',1);
   if(Number(target.round)===next.round&&next.current?.id===target.questionId)(next.jokerShields??={})[team.id]=next.round;
  }
  if(target.fundAward){
   const fund=target.fundAward;
   if(!fund.full)adjustJoker(next,team.id,fund.type,-1);
   if(equals(next.jokerEvent,fund))next.jokerEvent={type:fund.type,round:fund.round,id:fund.id,awarded:false};
  }
  if(Number(target.round)===next.round&&next.current?.id===target.questionId){
   if(nextDelta<0&&shieldApplies(next,team.id)){
    adjustJoker(next,team.id,'shield',-1);delete next.jokerShields[team.id];shieldUsed=true;nextDelta=0;
   }
   if(verdict==='correct'&&!next.jokerEvent?.awarded){
    next=awardJokerForCorrectAnswer(next,team.id);
    if(next.jokerEvent?.awarded)fundAward=copy(next.jokerEvent);
   }
  }
  const total=Number(next.scores[team.id]||0)+nextDelta-previousDelta;
  if(Math.abs(total)>999999)throw Error('Punktelimit überschritten.');
  next.scores[team.id]=total;
 }
 if(person){
  next.playerScores[person.id]=updatePlayerScore(next.playerScores[person.id],{
   kind:'judgement',round:target.round,questionId:target.questionId,points,result:verdict,at
  });
  if(shieldUsed){
   const scored=next.playerScores[person.id];
   scored.total-=scored.rounds[target.round].delta;
   scored.rounds[target.round].delta=0;
   if(scored.history.at(-1)?.round===target.round)scored.history.pop();
  }
 }
 const event=scoreEvent(state,next,{id:newId,kind:target.kind,team:team?.id,person:person?.id,
  actor:target.actor,round:target.round,questionId:target.questionId,points,verdict,effectiveDelta:nextDelta,shieldUsed,fundAward,at});
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
 for(const change of target.changes?.jokers||[])adjustJoker(result,target.changes.team.id,change.type,-change.delta);
 const fund=target.changes?.fund;
 if(fund&&equals(result.jokerEvent,fund.after))result.jokerEvent=copy(fund.before);
 const shield=target.changes?.shield;
 if(shield&&Number(target.round)===result.round&&result.current?.id===target.questionId){
  const team=target.changes.team.id;
  const shields=result.jokerShields??={};
  if(shields[team]===shield.after){
   if(shield.before===undefined)delete shields[team];
   else shields[team]=shield.before;
  }
 }
 const revised=list.map(e=>{
  if(e===target)return {...e,undoneAt:Number(at)||Date.now()};
  if(e.id===target.corrects&&e.supersededBy===target.id){const {supersededBy,...rest}=e;return rest;}
  return e;
 });
 return {state:result,events:revised,event:target};
}
