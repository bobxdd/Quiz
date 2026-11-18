// Guarded question lifecycle for host actions. Every question is identified by
// its unique board ID, not its category/title/position.
const own=(obj,key)=>obj!=null&&Object.hasOwn(obj,key);
export function validQuestionPair(state,question){
  const id=question?.id;
  if(typeof id!=='string'||id.length<1||id.length>80||!own(state?.board,id))return false;
  const cell=state.board[id];
  return !!cell&&cell.category===question.category&&Number(cell.points)===Number(question.points)&&!cell.used&&!state?.used?.[id];
}
export function openQuestionState(state,{expectedRound,question,playerQuestion,participants,deadline=0}){
  if(!state||!['board','reveal'].includes(state.phase)||Number(state.round)!==Number(expectedRound))return null;
  if(!validQuestionPair(state,question)||playerQuestion?.id!==question.id||playerQuestion.category!==question.category||Number(playerQuestion.points)!==Number(question.points))return null;
  const round=Number(state.round)+1;
  if(!Number.isSafeInteger(round)||round>999999)return null;
  return {...state,phase:'question',round,current:playerQuestion,deadline:Number(deadline)||0,pausedRemaining:0,buzzerArmed:!state.settings?.manualBuzzer,
    answerReview:null,answerParticipants:participants||null,audioPlayback:null,
    used:{...state.used,[question.id]:true},board:{...state.board,[question.id]:{...state.board[question.id],used:true}}};
}
export function applyQuestionChanges(state,expectedRound,expectedId,changes,allowedPhases=['question','paused','review']){
  if(!state||Number(state.round)!==Number(expectedRound)||state.current?.id!==expectedId||!allowedPhases.includes(state.phase))return null;
  if(!own(state.board,expectedId)||!state.used?.[expectedId])return null;
  const next=structuredClone(state);
  for(const [path,value] of Object.entries(changes||{})){
    const segments=path.split('/');
    if(!segments.length||segments.some(k=>!k||['__proto__','constructor','prototype'].includes(k)))return null;
    let cursor=next;
    for(const segment of segments.slice(0,-1)){
      if(!own(cursor,segment)||cursor[segment]===null||typeof cursor[segment]!=='object')cursor[segment]={};
      cursor=cursor[segment];
    }
    const key=segments.at(-1);if(value===null)delete cursor[key];else cursor[key]=value;
  }
  const returnedToBoard=next.phase==='board'&&!next.current;
  if((!returnedToBoard&&next.current?.id!==expectedId)||next.round!==state.round||next.used?.[expectedId]!==true)return null;
  return next;
}
export function questionMotion(round,id){
  const key=String(round)+':'+String(id);
  let sum=0;for(let i=0;i<key.length;i++)sum=(sum*33+key.charCodeAt(i))>>>0;
  return ['left','right','up','down'][sum%4];
}
