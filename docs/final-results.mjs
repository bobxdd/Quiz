/* Final standings from public scores only. Equal scores share a rank.
 * No hidden questions, host secrets or chat data are accessed. */
import {participatingTeamIds} from './lobby-model.mjs';

const valid=n=>Number.isFinite(Number(n))?Number(n):0;
export function podiumRanks(standings){
 return [...new Set(standings.map(row=>row.rank).filter(rank=>rank<=3))].sort((a,b)=>b-a);
}
export function finalStandings(state={},roster={}){
 const individual=state.scoreMode==='individual';
 const players=state.playerScores||{},teams=state.teams||{},manual=state.manualPlayers||{};
 let rows=[];
 if(individual){
  const ids=new Set([...Object.keys(roster),...Object.keys(manual),...Object.keys(players)].filter(id=>id!=='_empty'&&!id.startsWith('_')));
  rows=[...ids].map(id=>({id,name:String(roster[id]?.name||manual[id]||id).slice(0,55),
    team:String(roster[id]?.team||''),points:valid(players[id]?.total)}));
 }else{
  const ids=participatingTeamIds(state,roster);
  rows=ids.map(id=>({id,name:String(teams[id]||id).slice(0,55),points:valid(state.scores?.[id])}));
 }
 rows.sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name,'de'));
 return rows.map((row,i)=>({...row,rank:rows.findIndex(v=>v.points===row.points)+1,tied:rows.some(v=>v.id!==row.id&&v.points===row.points)}));
}
export function mayFinishGame(state){
 return !!state&&!!state.published&&['board','reveal'].includes(state.phase);
}
