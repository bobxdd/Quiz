/** Pure lobby rules for BrainQuiz Live. The host is NOT counted as a player. */
export const MAX_PLAYERS=8;
export const validPlayerId=id=>/^[A-Za-z0-9_-]{2,128}$/.test(String(id||''))&&!['__proto__','prototype','constructor'].includes(String(id));
export function approvedCount(roster){return Object.entries(roster||{}).filter(([id,p])=>validPlayerId(id)&&p&&typeof p==='object'&&typeof p.name==='string'&&p.name.trim()&&typeof p.team==='string'&&p.team.trim()).length;}
export function freeSlots(roster){return Math.max(0,MAX_PLAYERS-approvedCount(roster));}
export function approval(roster,id,player,team){
 if(!validPlayerId(id))throw Error('Ungültige Spieler-ID.');
 if(!player||typeof player.name!=='string'||!player.name.trim())throw Error('Spielername fehlt.');
 if(!/^t[1-6]$/.test(String(team)))throw Error('Ungültiges Team.');
 const current={...(roster||{})};
 if(!Object.hasOwn(current,id)&&freeSlots(current)===0)return {accepted:false,roster:current,reason:'Alle 8 Spielerplätze sind belegt.'};
 current[id]={name:player.name.trim().slice(0,28),team};
 return {accepted:true,roster:current};
}
export function participantLabels(roster){return Object.entries(roster||{}).filter(([id,p])=>validPlayerId(id)&&p?.name&&p?.team).slice(0,MAX_PLAYERS).map(([id,p])=>({id,name:String(p.name).slice(0,28),team:p.team}));}
