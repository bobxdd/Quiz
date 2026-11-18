/** Round rules kept separate from rendering and transport. */
import {judgementDelta,updatePlayerScore} from './core.mjs';
export const roundMode=q=>q?.type==='team-emoji'?'team-emoji':q?.roundMode==='written'?'written':'buzzer';
export const scoreMode=state=>state?.scoreMode==='individual'?'individual':'team';
export function canBuzz(state,buzzers,uid,team,time=Date.now()){
 const round=String(state?.round||0);
 return !!uid&&!!team&&state?.phase==='question'&&roundMode(state.current)==='buzzer'&&state.buzzerArmed!==false&&state.settings?.buzzerEnabled!==false&&(!state.deadline||state.deadline>=time)
  &&!buzzers?.[round]&&!state?.buzzerResolved?.[round]&&!state?.buzzerBlocked?.[round]?.[uid]
  &&!(scoreMode(state)==='team'&&state?.buzzerBlockedTeams?.[round]?.[team]);
}
export function applyBuzzerJudgement(state,buzzers,{round,uid,result,at=Date.now()}){
 const key=String(round),winner=buzzers?.[key];
 if(state?.phase!=='question'||roundMode(state.current)!=='buzzer'||key!==String(state.round)||!winner||winner.uid!==uid||!['correct','wrong'].includes(result))throw Error('Buzzer nicht mehr aktuell. Bitte Spielstand aktualisieren.');
 if(state?.buzzerResolved?.[key])throw Error('Der Buzzer wurde bereits bewertet.');
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
  next.buzzerBlocked={...(next.buzzerBlocked||{}),[key]:{...(next.buzzerBlocked?.[key]||{}),[uid]:{uid,name:winner.name,team:winner.team,at}}};
  if(scoreMode(state)==='team')next.buzzerBlockedTeams={...(next.buzzerBlockedTeams||{}),[key]:{...(next.buzzerBlockedTeams?.[key]||{}),[winner.team]:{team:winner.team,name:winner.name,at}}};
  delete nextBuzzers[key];
 }else next.buzzerResolved={...(next.buzzerResolved||{}),[key]:{uid,team:winner.team,result,at}};
 return {state:next,buzzers:nextBuzzers,delta,winner};
}
