// Host-authoritative Joker rules. No answers, unrevealed drops or team-only
// hints belong in the shared public state.
import {questionRoundMode} from './question-mode.mjs';
import {boardRoundOf} from './category-model.mjs';

const isStandardBoard=question=>boardRoundOf(question)!==3;
const isFundField=question=>isStandardBoard(question)&&questionRoundMode(question)==='buzzer';
const fundFieldIds=quiz=>[...new Set((quiz?.questions||[]).filter(q=>q?.id&&isFundField(q)).map(q=>q.id))];

export const JOKER_TYPES=Object.freeze(['shield','oracle','reroll','chrono']);
export const JOKER_META=Object.freeze({
 shield:{name:'Banshees Schleier',symbol:'🛡',description:'Einmal einen regulären Punktabzug für eine falsche Antwort verhindern.'},
 oracle:{name:'Oracle Lens',symbol:'🔍',description:'Einen privaten, vorbereiteten Hinweis für dein Team anzeigen.'},
 reroll:{name:'Reroll',symbol:'↻',description:'Vor dem Aufdecken einen anderen Fragenplatz wählen lassen.'},
 chrono:{name:'Chronobreak',symbol:'⏪',description:'Nach eigenem Buzz 8 Sekunden Zeit für eine Antwortkorrektur.'}
});
// Original red scanner-lens symbol. No external asset or network request.
export function jokerIconMarkup(type){
 if(type==='oracle')return '<svg class="bq-joker-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 14l7 7" stroke="#f4a48f" stroke-width="3" stroke-linecap="round"/><circle cx="10" cy="10" r="7" fill="#552531" stroke="#ed8c79" stroke-width="2"/><path d="M4.5 10Q10 3 15.5 10Q10 17 4.5 10Z" fill="#f1b2a2"/><circle cx="10" cy="10" r="2.5" fill="#70293a"/><path d="M7 5l-2 2" stroke="#fff1dc" stroke-width="1.4" stroke-linecap="round"/></svg>';
 return '<span class="bq-joker-icon" aria-hidden="true">'+(JOKER_META[type]?.symbol||'')+'</span>';
}
export const JOKER_MAX_CHARGES=3,CHRONOBREAK_MS=8000;
export function jokerSetupSummary(quiz){
 const config=normalizeJokerConfig(quiz?.jokerConfig);
 const normal=(quiz?.questions||[]).filter(isStandardBoard);
 const available=fundFieldIds(quiz).length;
 const fields=JOKER_TYPES.reduce((sum,type)=>sum+config.drops[type],0);
 return {config,fields,available,missing:Math.max(0,fields-available),
  starters:JOKER_TYPES.filter(type=>config.startingByType[type]).length,
  missingHints:normal.filter(q=>!String(q.oracleHint||'').trim()&&!q.hints?.some(h=>String(h||'').trim())).length};
}
export function jokerType(value){return JOKER_TYPES.includes(value)?value:'';}
export function normalizeJokerConfig(value){
 const obj=value&&typeof value==='object'?value:{};
 const drops={},startingByType={};
 for(const type of JOKER_TYPES){
  drops[type]=[1,2].includes(Number(obj.drops?.[type]))?Number(obj.drops[type]):1;
  startingByType[type]=typeof obj.startingByType?.[type]==='boolean'?obj.startingByType[type]:obj.starting===true;
 }
 return {enabled:obj.enabled===true,starting:JOKER_TYPES.every(type=>startingByType[type]),startingByType,drops};
}
export function initialJokers(teams,config){
 const settings=normalizeJokerConfig(config),charges={};
 for(const id of Object.keys(teams||{}))charges[id]=Object.fromEntries(JOKER_TYPES.map(type=>[type,settings.enabled&&settings.startingByType[type]?1:0]));
 return charges;
}
// The host selects the placements once. Never publish the map to a guest.
// randomIndex is injectable for reproducible tests.
export function placeJokerDrops(quiz,randomIndex){
 const cfg=normalizeJokerConfig(quiz?.jokerConfig);
 if(!cfg.enabled||quiz?.scoreMode==='individual')return {};
 const fields=fundFieldIds(quiz);
 const types=JOKER_TYPES.flatMap(type=>Array(cfg.drops[type]).fill(type));
 const rand=typeof randomIndex==='function'?randomIndex:max=>{
  if(!globalThis.crypto?.getRandomValues)return Math.floor(Math.random()*max);
  const bytes=new Uint32Array(1),limit=0x100000000-(0x100000000%max);
  do{globalThis.crypto.getRandomValues(bytes);}while(bytes[0]>=limit);
  return bytes[0]%max;
 };
 for(const choices of [fields,types]){
  for(let i=choices.length-1;i>0;i--){
   const j=Math.max(0,Math.min(i,Math.trunc(Number(rand(i+1)))||0));
   [choices[i],choices[j]]=[choices[j],choices[i]];
  }
 }
 return Object.fromEntries(fields.slice(0,types.length).map((id,index)=>[id,types[index]]));
}
export function jokerCount(state,team,type){
 if(!jokerType(type)||!Object.hasOwn(state?.teams||{},team))return 0;
 const raw=Number(state?.jokers?.[team]?.[type]);
 return Number.isSafeInteger(raw)?Math.max(0,Math.min(JOKER_MAX_CHARGES,raw)):0;
}
export function changeJokerCharge(state,team,type,delta){
 if(!jokerType(type)||!Object.hasOwn(state?.teams||{},team)||!Number.isInteger(delta)||![-1,1].includes(delta))return null;
 const current=jokerCount(state,team,type);
 if(current+delta<0||current+delta>JOKER_MAX_CHARGES)return null;
 return {...state,jokers:{...(state.jokers||{}),[team]:{...(state.jokers?.[team]||{}),[type]:current+delta}}};
}
export function drawJokerForQuestion(state,id,drops){
 const type=jokerType(drops?.[id]),round=Number(state?.round);
 if(!type||state?.current?.id!==id||state?.phase!=='question'||!isFundField({...state.current,boardRound:state.boardRound}))return {...state,jokerEvent:null};
 return {...state,jokerEvent:{type,round,id,awarded:false}};
}
export function awardJokerForCorrectAnswer(state,team){
 const event=state?.jokerEvent;
 if(!event||event.awarded||event.id!==state.current?.id||event.round!==state.round||!state.teams?.[team]||!isFundField({...state.current,boardRound:state.boardRound}))return state;
 const next=changeJokerCharge(state,team,event.type,1);
 // Even when full, award only once. No loss of points or extra charge stacking.
 return {...(next||state),jokerEvent:{...event,awarded:true,team,full:!next}};
}
export function activeChronobreak(state,at=Date.now()){
 return !!state?.chronoBreak&&state.chronoBreak.round===state.round&&Number(state.chronoBreak.until)>at;
}
export function shieldApplies(state,team,round=state?.round){
 return !!team&&state?.jokerConfig?.enabled===true&&state?.jokerShields?.[team]===round&&jokerCount(state,team,'shield')>0;
}
export function useJokerCharge(state,team,type){
 return changeJokerCharge(state,team,type,-1);
}
