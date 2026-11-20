/** Pure lobby rules for BrainQuiz Live. The host is NOT counted as a player. */
export const MAX_PLAYERS=10;
export const validPlayerId=id=>/^[A-Za-z0-9_-]{2,128}$/.test(String(id||''))&&!['__proto__','prototype','constructor'].includes(String(id));
export function approvedCount(roster){return Object.entries(roster||{}).filter(([id,p])=>validPlayerId(id)&&p&&typeof p==='object'&&typeof p.name==='string'&&p.name.trim()&&typeof p.team==='string'&&p.team.trim()).length;}
export function freeSlots(roster){return Math.max(0,MAX_PLAYERS-approvedCount(roster));}
export function approval(roster,id,player,team){
 if(!validPlayerId(id))throw Error('Ungültige Spieler-ID.');
 if(!player||typeof player.name!=='string'||!player.name.trim())throw Error('Spielername fehlt.');
 if(!validTeamId(team))throw Error('Ungültiges Team.');
 const current={...(roster||{})};
 if(!Object.hasOwn(current,id)&&freeSlots(current)===0)return {accepted:false,roster:current,reason:`Alle ${MAX_PLAYERS} Spielerplätze sind belegt.`};
 current[id]={name:player.name.trim().slice(0,28),team};
 return {accepted:true,roster:current};
}
export function participantLabels(roster){return Object.entries(roster||{}).filter(([id,p])=>validPlayerId(id)&&p?.name&&p?.team).slice(0,MAX_PLAYERS).map(([id,p])=>({id,name:String(p.name).slice(0,28),team:p.team}));}

export function participantSnapshot(roster){
 const valid=Object.entries(roster||{}).filter(([id,player])=>validPlayerId(id)&&player&&typeof player==='object'&&String(player.name||'').trim()).slice(0,MAX_PLAYERS);
 return Object.fromEntries(valid.map(([id,player])=>[id,{name:String(player.name).trim().slice(0,28)}]));
}

/** Step 4: stable, accessible and distinct team palette (colors are IDs, never guest CSS). */
export const MAX_TEAMS=5;
export const TEAM_PALETTE=Object.freeze(['#85bde4','#e3a09e','#a7c989','#c2a4e5','#e4bd72','#74c8be']);
export const teamColor=id=>validTeamId(id)?TEAM_PALETTE[Number(id.slice(1))-1]:'#aab6bf';
// An existing sixth team stays readable in older quizboards. New rooms can create at most five.
export const validTeamId=id=>/^t[1-6]$/.test(String(id||''));
export const canArrangeLobby=state=>state?.started!==true&&state?.phase==='board'&&Number(state?.round||0)===0&&!Object.entries(state?.used||{}).some(([id,v])=>id!=='_empty'&&v===true);
export const canAdmitPlayer=state=>!!state&&state.phase!=='finished';
export const waitsForNextQuestion=(state,member)=>member?.status==='approved'&&state?.phase!=='board'&&Number(member.playFromRound||0)>Number(state?.round||0);
export function cleanTeamName(value){
 if(typeof value!=='string')throw Error('Teamname fehlt.');
 const result=value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g,'').replace(/\s+/g,' ').trim();
 if(result.length<2||result.length>28)throw Error('Teamname muss 2 bis 28 Zeichen lang sein.');
 return result;
}
function availableTeamName(teams,name,except=''){
 const cleaned=cleanTeamName(name);
 if(Object.entries(teams).some(([id,value])=>id!==except&&String(value||'').trim().toLocaleLowerCase('de')===cleaned.toLocaleLowerCase('de')))
  throw Error('Diesen Teamnamen gibt es bereits.');
 return cleaned;
}
export function renameLobbyTeam(teams,id,name){
 if(!validTeamId(id)||!Object.hasOwn(teams||{},id))throw Error('Dieses Team existiert nicht.');
 return {...teams,[id]:availableTeamName(teams,name,id)};
}
export function addLobbyTeam(current,name){
 const teams=current&&typeof current==='object'&&!Array.isArray(current)?current:{};
 const cleaned=availableTeamName(teams,name);
 const count=Object.keys(teams).filter(validTeamId).length;
 const free=count<MAX_TEAMS?Array.from({length:MAX_TEAMS},(_,i)=>'t'+(i+1)).find(id=>!Object.hasOwn(teams,id)):null;
 if(!free)throw Error(`Maximal ${MAX_TEAMS} Teams möglich.`);
 return {teams:{...teams,[free]:cleaned},id:free,color:teamColor(free)};
}
export function lobbySnapshot(data){
 const pub=data?.public||{},teams=pub.teams||{},roster=data?.roster||{},members=data?.members||{},presence=data?.presence||{};
 const safeTeams=Object.fromEntries(Object.entries(teams).filter(([id,name])=>validTeamId(id)&&typeof name==='string').slice(0,TEAM_PALETTE.length));
 const players=Object.entries(roster).filter(([id,v])=>validPlayerId(id)&&v?.name&&safeTeams[v.team]).slice(0,MAX_PLAYERS).map(([id,player])=>({
  name:String(player.name).slice(0,28),team:player.team,ready:members[id]?.ready===true,online:!!presence[id]
 }));
 const colors=Object.fromEntries(Object.keys(safeTeams).map(id=>[id,teamColor(id)]));
 return {title:String(pub.title||data?.access?.title||'BrainQuiz').slice(0,100),teams:safeTeams,colors,players,
  scoreMode:pub.scoreMode==='individual'?'individual':'team',manualBuzzer:pub.settings?.manualBuzzer===true,
  ready:players.filter(p=>p.ready).length,online:players.filter(p=>p.online).length,
  approved:players.length,pending:Object.values(members).filter(m=>m?.status==='pending').length,
  open:canArrangeLobby(pub),canJoin:canAdmitPlayer(pub)};
}
