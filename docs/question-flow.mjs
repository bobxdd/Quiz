// Guarded question lifecycle for host actions. Every question is identified by
// its unique board ID, not its category/title/position.
import {initialJokers} from './joker-system.mjs';
import {participatingTeamIds} from './lobby-model.mjs';
const own=(obj,key)=>obj!=null&&Object.hasOwn(obj,key);
const validBalanceQuestion=q=>q?.roundMode==='buzzer'&&!['map','order','team-emoji','team-draw'].includes(q?.type);
const boardRound=value=>[2,3].includes(Number(value?.boardRound))?Number(value.boardRound):1;
export function makeSelectionTurn(state,roster={}){
 if(state?.scoreMode==='individual')return null;
 const all=Object.keys(state?.teams||{});
 const order=participatingTeamIds(state,roster);
 return {order:order.length?order:all,index:0};
}
export function balanceSelectionTurn(state){
 const eligible=Array.isArray(state?.participatingTeams)?participatingTeamIds(state):Object.keys(state?.teams||{});
 const order=eligible.sort((a,b)=>(Number(state?.scores?.[a])||0)-(Number(state?.scores?.[b])||0)||a.localeCompare(b,'de'));
 return {order,index:0,balance:true};
}
export function selectingTeam(state){
 const turn=state?.selectionTurn;
 if(state?.scoreMode==='individual'||!Array.isArray(turn?.order))return '';
 const order=turn.order.filter(id=>own(state.teams,id));
 const index=Number.isSafeInteger(turn.index)&&turn.index>=0?turn.index:0;
 return order.length?(turn.balance?order[index]||'':order[index%order.length]):'';
}
export function resetBoardGameState(state,board,roster={}){
 return {...state,current:null,phase:'board',round:0,boardRound:1,started:false,deadline:0,pausedRemaining:0,
  used:{},board,scores:Object.fromEntries(Object.keys(state?.teams||{}).map(id=>[id,0])),playerScores:{},
  jokers:initialJokers(state?.teams,state?.jokerConfig),jokerEvent:null,jokerNotice:null,
  balanceStrike:null,lastBalanceStrike:null,
  oracleCalls:{},jokerRerollRequest:null,jokerRerollExclude:null,chronoBreak:null,
  buzzerBlocked:{},buzzerBlockedTeams:{},buzzerReleased:{},buzzerJudgements:{},buzzerResolved:{},writtenTeamRepresentatives:{},
  answerReview:null,answerParticipants:null,teamEmoji:null,audioPlayback:null,questionPick:null,
  participatingTeams:participatingTeamIds({teams:state.teams},roster),
  selectionTurn:makeSelectionTurn({teams:state.teams,scoreMode:state.scoreMode},roster),presentation:null,finaleStep:null};
}
export function remainingBoardQuestions(state,round=boardRound(state)){
 return Object.values(state?.board||{}).filter(cell=>cell?.id&&boardRound(cell)===round&&!cell.used&&!state.used?.[cell.id]);
}
/** Round two starts only after the first board is exhausted. A deliberate
 * host override is a separate action requiring an explicit force flag; stale
 * guest RPCs and the regular Next action cannot skip unanswered questions. */
/** The user-defined last-six bonus is per current board (not per quiz).
 * Compute it on the UNPLAYED state before opening the next question:
 * the seventh-to-last question must still have normal points. */
export const FINAL_DOUBLE_QUESTIONS=6;
export function finalSixActive(state,round=boardRound(state)){
 const left=remainingBoardQuestions(state,round).length;
 return left>0&&left<=FINAL_DOUBLE_QUESTIONS;
}
export function boardQuestionPoints(state,cell){
 const base=Number(cell?.points);
 if(!Number.isFinite(base)||base<0)return 0;
 if(!cell||boardRound(cell)!==boardRound(state)||cell.used||state?.used?.[cell.id])return base;
 return base*(finalSixActive(state)?2:1);
}
/** Keep persisted board IDs stable (1 and 2 = regular, 3 = balance),
 * while playing the optional balance board BETWEEN the regular boards. */
export function nextBoardRound(state){
 const present=new Set(Object.values(state?.board||{}).filter(cell=>cell?.id).map(boardRound));
 const current=boardRound(state);
 if(current===1)return present.has(3)?3:present.has(2)?2:null;
 if(current===3)return present.has(2)?2:null;
 return null;
}
export function canAdvanceBoard(state,{force=false}={}){
 return state?.phase==='board'&&nextBoardRound(state)!==null&&
  !state.balanceStrike&&(force===true||remainingBoardQuestions(state).length===0||
   (boardRound(state)===3&&!selectingTeam(state)));
}
export function advanceBoardState(state,{force=false}={}){
 if(!canAdvanceBoard(state,{force}))return null;
 const nextRound=nextBoardRound(state),previousRound=boardRound(state);
 const next={...state,boardRound:nextRound,current:null,deadline:0,pausedRemaining:0,presentation:null};
 if(nextRound===3){
  next.preBalanceSelectionTurn=state.selectionTurn?structuredClone(state.selectionTurn):null;
  next.selectionTurn=balanceSelectionTurn(next);
  next.balanceStrike=null;
  next.lastBalanceStrike=null;
 }else if(previousRound===3){
  next.selectionTurn=state.preBalanceSelectionTurn??makeSelectionTurn(next);
  delete next.preBalanceSelectionTurn;
  next.lastBalanceStrike=null;
 }
 return next;
}
export function returnToBoardState(state){
 if(!state?.current||!['ready','question','answered','paused','review','reveal'].includes(state.phase))return null;
 const next={...state,phase:'board',current:null,deadline:0,pausedRemaining:0,answerReview:null,answerParticipants:null,teamEmoji:null,presentation:null,questionPick:null};
 const turnsLeft=(state.selectionTurn?.order?.length||0)-(Number(state.selectionTurn?.index)||0);
 if(state.current.firstAnswerTeam&&state.phase==='reveal'&&remainingBoardQuestions(next).length>=Math.max(1,turnsLeft)){
  next.balanceStrike={team:state.current.firstAnswerTeam,round:state.round};
 }else if(state.phase!=='ready'&&selectingTeam(state))next.selectionTurn={...state.selectionTurn,index:(Number(state.selectionTurn.index)||0)+1};
 if(state.phase==='ready'){
  const id=state.current.id;
  next.used={...state.used};delete next.used[id];
  next.board={...state.board,[id]:{...state.board[id],used:false}};
 }
 return !remainingBoardQuestions(next).length&&canAdvanceBoard(next)?advanceBoardState(next):next;
}
export function strikeBalanceField(state,id){
 if(state?.phase!=='board'||boardRound(state)!==3||state.balanceStrike?.round!==state.round||
    !remainingBoardQuestions(state).some(cell=>cell.id===id))return null;
 const strike=state.balanceStrike;
 return {...state,balanceStrike:null,lastBalanceStrike:{...strike,id},
  selectionTurn:{...state.selectionTurn,index:(Number(state.selectionTurn?.index)||0)+1},
  used:{...state.used,[id]:true},board:{...state.board,[id]:{...state.board[id],used:true,struck:true}}};
}
export function undoBalanceStrike(state){
 const strike=state?.lastBalanceStrike;
 if(state?.phase!=='board'||boardRound(state)!==3||state.balanceStrike||!strike||
    strike.round!==state.round||!state.board?.[strike.id]?.struck)return null;
 const board={...state.board,[strike.id]:{...state.board[strike.id],used:false}};
 delete board[strike.id].struck;
 const used={...state.used};
 delete used[strike.id];
 return {...state,board,used,lastBalanceStrike:null,balanceStrike:{team:strike.team,round:strike.round},
  selectionTurn:{...state.selectionTurn,index:Math.max(0,(Number(state.selectionTurn?.index)||0)-1)}};
}
export function judgeBalanceAnswer(state,{round,team,result,revealPatch,at=Date.now()}){
 const q=state?.current;
 if(Number(round)!==state?.round||!['question','paused'].includes(state.phase)||
    boardRound(state)!==3||state.scoreMode!=='team'||!q?.firstAnswerPending||
    q.firstAnswerTeam!==team||selectingTeam(state)!==team||!['correct','wrong'].includes(result)||
    revealPatch?.phase!=='reveal'||revealPatch.deadline!==0||revealPatch.current?.id!==q.id||
    !own(revealPatch.current,'answer'))return null;
 const delta=result==='correct'?Number(q.points):0;
 const total=(Number(state.scores?.[team])||0)+delta;
 if(!Number.isFinite(total)||Math.abs(total)>999999)throw Error('Punktelimit überschritten.');
 const next=applyQuestionChanges(state,round,q.id,revealPatch,['question','paused']);
 if(!next)return null;
 const verdict={team,uid:'',result,delta,at,firstAnswer:true};
 next.current={...next.current,firstAnswerPending:false,firstAnswerTeam:team,firstAnswerResult:result};
 next.scores={...state.scores,[team]:total};
 next.buzzerArmed=false;
 next.buzzerJudgements={...state.buzzerJudgements,[round]:verdict};
 next.buzzerResolved={...state.buzzerResolved,[round]:verdict};
 return {state:next,delta,team,result};
}
/** Explicitly cancel an unscored question. Never recycle round numbers:
 * delayed guest packets must not accidentally apply to the next question. */
export function cancelQuestionState(state){
 if(!state?.current||!['ready','question','paused'].includes(state.phase))return null;
 return returnToBoardState({...state,phase:'ready'});
}
/** Voluntary host override for a disconnected / inactive selecting team.
 * Only moves the choice token, never gives points or advances the question. */
export function skipSelectionTurn(state){
 if(state?.phase!=='board'||state.questionPick||state.scoreMode==='individual'||boardRound(state)===3)return null;
 const turn=state.selectionTurn;
 if(!Array.isArray(turn?.order))return null;
 const order=turn.order.filter(team=>own(state.teams,team));
 if(order.length<2)return null;
 const index=Number.isSafeInteger(turn.index)&&turn.index>=0?turn.index:0;
 return {...state,selectionTurn:{...turn,index:index+1}};
}
export function validQuestionPair(state,question){
  const id=question?.id;
  if(typeof id!=='string'||id.length<1||id.length>80||!own(state?.board,id)||state?.jokerRerollExclude===id)return false;
  const cell=state.board[id];
  return !!cell&&boardRound(cell)===boardRound(state)&&boardRound(question)===boardRound(state)&&cell.category===question.category&&Number(cell.points)===Number(question.points)&&!cell.used&&!state?.used?.[id];
}
export function openQuestionState(state,{expectedRound,question,playerQuestion,participants,deadline=0,covered=false}){
  if(!state||!['board','reveal'].includes(state.phase)||Number(state.round)!==Number(expectedRound))return null;
 if(state.balanceStrike)return null;
  if(state.boardSequence&&state.phase!=='board')return null;
  // Legacy guest reservations must not restrict the host's choice.
  if(!validQuestionPair(state,question)||playerQuestion?.id!==question.id||playerQuestion.category!==question.category||Number(playerQuestion.points)!==Number(question.points))return null;
  const round=Number(state.round)+1;
  if(!Number.isSafeInteger(round)||round>999999)return null;
  const doublePoints=finalSixActive(state);
  const effectivePoints=Number(question.points)*(doublePoints?2:1);
  const mode=question.type==='map'?'written':playerQuestion.roundMode;
  const current=covered?{id:question.id,category:question.category,type:question.type,points:effectivePoints,roundMode:mode}
   :{...playerQuestion,roundMode:mode,points:effectivePoints};
  current.basePoints=Number(question.points);
  current.doublePoints=doublePoints;
  if(boardRound(state)===3){
   const team=selectingTeam(state);
   if(!team||!validBalanceQuestion(playerQuestion))return null;
   current.firstAnswerTeam=team;
   current.firstAnswerPending=true;
  }
  return {...state,lastBalanceStrike:null,phase:covered?'ready':'question',round,current,deadline:covered?0:Number(deadline)||0,pausedRemaining:0,buzzerArmed:covered?false:boardRound(state)===3?false:!state.settings?.manualBuzzer,
    answerReview:null,answerParticipants:covered?null:participants||null,audioPlayback:null,questionPick:null,buzzerAnnouncement:null,
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
  // Clues, partial reveals and a final solution replace current with a freshly
  // sanitized source object. Never lose/recalculate the locked-in bonus then.
  if(!returnedToBoard){
   next.current.points=state.current.points;
   next.current.basePoints=state.current.basePoints??state.board[expectedId].points;
   next.current.doublePoints=state.current.doublePoints===true;
   if(state.current.firstAnswerTeam){
    next.current.firstAnswerTeam=state.current.firstAnswerTeam;
    next.current.firstAnswerPending=state.current.firstAnswerPending===true;
    if(state.current.firstAnswerResult)next.current.firstAnswerResult=state.current.firstAnswerResult;
   }
  }
  return next;
}
export function questionMotion(round,id){
  const key=String(round)+':'+String(id);
  let sum=0;for(let i=0;i<key.length;i++)sum=(sum*33+key.charCodeAt(i))>>>0;
  return ['left','right','up','down'][sum%4];
}
