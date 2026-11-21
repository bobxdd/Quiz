/** Round rules kept separate from rendering and transport. */
import {judgementDelta,updatePlayerScore,questionRoundMode as roundMode} from './core.mjs';
export {roundMode};
export const scoreMode=state=>state?.scoreMode==='individual'?'individual':'team';
export function buzzerCoverActive(state,buzzers){
 const round=String(state?.round||0);
 return ['question','paused'].includes(state?.phase)&&roundMode(state.current)==='buzzer'&&
  !!buzzers?.[round]&&!buzzers[round].oral&&!state.buzzerResolved?.[round];
}
export function buzzerLocked(state,uid,team){
 const round=String(state?.round||0);
 return state?.buzzerReleased?.[round]?.[uid]!==true&&
  !!(state?.buzzerBlocked?.[round]?.[uid]||(scoreMode(state)==='team'&&state?.buzzerBlockedTeams?.[round]?.[team]));
}
export function canBuzz(state,buzzers,uid,team,time=Date.now()){
 const round=String(state?.round||0);
 return !!uid&&!!team&&state?.phase==='question'&&roundMode(state.current)==='buzzer'&&
  (state.buzzerArmed!==false||state.buzzerReleased?.[round]?.[uid]===true)&&
  state.settings?.buzzerEnabled!==false&&!state.current?.firstAnswerPending&&(!state.deadline||state.deadline>time)&&
  !buzzers?.[round]&&!state?.buzzerResolved?.[round]&&!buzzerLocked(state,uid,team);
}
export function applyBuzzerJudgement(state,buzzers,{round,uid,result,at=Date.now()}){
 const key=String(round),winner=buzzers?.[key];
 if(!['question','paused'].includes(state?.phase)||roundMode(state.current)!=='buzzer'||key!==String(state.round)||!winner||winner.uid!==uid||!['correct','wrong'].includes(result))throw Error('Buzzer nicht mehr aktuell. Bitte Spielstand aktualisieren.');
 if(state?.buzzerResolved?.[key]||state.current?.firstAnswerPending)throw Error('Der Buzzer ist noch für das zuerst antwortende Team reserviert oder wurde bereits bewertet.');
 const points=Number(state.current.points),delta=judgementDelta(points,result),next=structuredClone(state),nextBuzzers={...buzzers};
 next.buzzerJudgements={...(next.buzzerJudgements||{}),[key]:{uid,result,delta,team:winner.team,at}};
 if(scoreMode(state)==='team'){
  if(!Object.hasOwn(state.teams||{},winner.team))throw Error('Das Team ist nicht mehr aktiv.');
  next.scores={...(next.scores||{}),[winner.team]:(Number(next.scores?.[winner.team])||0)+delta};
 }else{
  next.playerScores={...(next.playerScores||{})};
  next.playerScores[uid]=updatePlayerScore(next.playerScores[uid],{kind:'judgement',round:key,questionId:state.current.id,points,result,at});
 }
 if(result==='wrong'){
  if(next.buzzerReleased?.[key])delete next.buzzerReleased[key][uid];
  next.buzzerBlocked={...(next.buzzerBlocked||{}),[key]:{...(next.buzzerBlocked?.[key]||{}),[uid]:{uid,name:winner.name,team:winner.team,at}}};
  if(scoreMode(state)==='team')next.buzzerBlockedTeams={...(next.buzzerBlockedTeams||{}),[key]:{...(next.buzzerBlockedTeams?.[key]||{}),[winner.team]:{team:winner.team,name:winner.name,at}}};
  delete nextBuzzers[key];
 }else next.buzzerResolved={...(next.buzzerResolved||{}),[key]:{uid,team:winner.team,result,at}};
 return {state:next,buzzers:nextBuzzers,delta,winner};
}
