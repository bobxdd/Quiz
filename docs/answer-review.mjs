/* BrainQuiz 2.0 — review orchestration. Public state must NEVER contain an
   unrevealed submission; private answers remain under /responses/<round>/<uid>.
   Pure functions shared by browser runtime and regression tests. */
import {participantSnapshot,validPlayerId} from './lobby-model.mjs';
export {participantSnapshot};
const safeText=(v,max)=>String(v??'').slice(0,max);
const allowedId=id=>typeof id==='string'&&validPlayerId(id);
export function answerProgress(expected,responses){
 const ids=Object.keys(expected||{}).filter(allowedId);
 const count=ids.filter(id=>typeof responses?.[id]?.text==='string'&&responses[id].text.trim().length>0).length;
 return {total:ids.length,submitted:count,complete:ids.length>0&&count===ids.length};
}
/** Timed answers stay editable until the deadline. In untimed rounds,
 * only explicit submissions can trigger automatic review. */
export function shouldAutoBeginAnswerReview(state,responses,time=Date.now()){
 if(state?.phase!=='question'||state.current?.roundMode!=='written')return false;
 const expected=state.answerParticipants||{};
 const progress=answerProgress(expected,responses);
 if(!progress.total)return false;
 const deadline=Number(state.deadline)||0;
 const expired=deadline>0&&time>=deadline;
 return deadline>0?expired:state.current?.type!=='map'&&progress.complete&&
  Object.keys(expected).filter(allowedId).every(id=>responses?.[id]?.draft!==true);
}
export function makeAnswerReview(expected,responses,round){
 const entries={};
 for(const [id,person] of Object.entries(expected||{})){
  if(!allowedId(id))continue;
  const submitted=typeof responses?.[id]?.text==='string'&&responses[id].text.trim().length>0;
  entries[id]={name:safeText(person?.name||'Spieler',28),submitted,revealed:false};
 }
 return {round:Math.max(0,Math.floor(Number(round)||0)),entries};
}
export function revealAnswer(review,id,response){
 if(!review||!review.entries||!Object.hasOwn(review.entries,id)||!allowedId(id))throw Error('Spieler gehört nicht zur aktuellen Fragerunde.');
 if(!review.entries[id].submitted)throw Error('Für diese Person wurde keine Antwort abgegeben.');
 if(typeof response?.text!=='string'||!response.text.trim())throw Error('Die private Antwort konnte nicht geladen werden.');
 const value=response.text.trim().slice(0,800);
 return {...review,entries:{...review.entries,[id]:{...review.entries[id],revealed:true,value}}};
}
/** The review UI must not imply an unanswered entry hides a submitted answer. */
export function answerCardState(entry){
 if(!entry?.submitted)return 'missing';
 return entry.revealed?'revealed':'hidden';
}
export function reviewIsCurrent(state){
 return !!state&&['review','reveal'].includes(state.phase)&&!!state.answerReview&&state.answerReview.round===state.round;
}
