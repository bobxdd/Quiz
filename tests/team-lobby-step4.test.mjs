import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_PLAYERS,MAX_TEAMS,TEAM_PALETTE,teamColor,validTeamId,canArrangeLobby,cleanTeamName,addLobbyTeam,lobbySnapshot,approval} from '../docs/lobby-model.mjs';
import {lobbyGuestHTML,hostLobbySummary} from '../docs/lobby-view.mjs';
const base=()=>({public:{title:'Demo',phase:'board',round:0,used:{},teams:{t1:'Rot',t2:'Blau'},scores:{t1:0,t2:0}},members:{},roster:{},presence:{}});
test('Step 4 palette: five new teams, ten players, six-team legacy compatibility',()=>{
 assert.equal(MAX_TEAMS,5);assert.equal(MAX_PLAYERS,10);
 assert.equal(new Set(TEAM_PALETTE).size,6);
 for(let i=1;i<=5;i++){const id='t'+i;assert.equal(validTeamId(id),true);assert.match(teamColor(id),/^#[0-9a-f]{6}$/);}
 assert.equal(validTeamId('t6'),true,'Old sixth teams must remain readable');
 for(const id of ['t0','t7','__proto__','t1;--team-color:red','constructor'])assert.equal(validTeamId(id),false);
});
test('Step 4 team creation: deterministic IDs, unique names, strict five-new-team cap',()=>{
 let teams=base().public.teams;
 const created=addLobbyTeam(teams,'  Die Krähen  ');
 assert.equal(created.id,'t3');
 assert.equal(created.teams.t3,'Die Krähen');
 assert.equal(Object.hasOwn(teams,'t3'),false);
 assert.throws(()=>addLobbyTeam(created.teams,'dIE krähen'),/bereits/);
 assert.throws(()=>addLobbyTeam(teams,'Rot'),/bereits/);
 assert.throws(()=>addLobbyTeam(teams,'A'),/2 bis 28/);
 assert.throws(()=>addLobbyTeam(teams,'X'.repeat(29)),/2 bis 28/);
 teams=created.teams;
 for(const name of ['Nebel','Komet'])teams=addLobbyTeam(teams,name).teams;
 assert.equal(Object.keys(teams).length,5);
 assert.throws(()=>addLobbyTeam(teams,'Sonne'),/5 Teams/);
 assert.throws(()=>addLobbyTeam({...teams,t6:'Legacy'},'Noch Eins'),/5 Teams/);
 assert.equal(cleanTeamName('  Foo\nBar  '),'FooBar'); // controls stripped, whitespace compact
});
test('Step 4 lobby snapshots: pending people never receive hidden game questions or private answers',()=>{
 const data=base();data.public.current={id:'secret',answer:'PRIVATE-ANSWER',mapTargetX:75};
 data.responses={'1':{user_x:{text:'SECRET SUBMISSION'}}};data.messages={t1:{m1:{text:'Private chat'}}};
 data.members={user_a:{status:'approved',name:'Alice',team:'t1',ready:true},user_b:{status:'pending',name:'Bob',teamRequest:{kind:'create',name:'Foxes'},ready:true}};
 data.roster={user_a:{name:'Alice',team:'t1'}};data.presence={user_a:{connectedAt:1}};
 const s=lobbySnapshot(data),json=JSON.stringify(s);
 assert.deepEqual(s.teams,{t1:'Rot',t2:'Blau'});
 assert.equal(s.ready,1);assert.equal(s.approved,1);assert.equal(s.pending,1);
 for(const secret of ['PRIVATE-ANSWER','SECRET SUBMISSION','Private chat','mapTargetX','memberSecrets','teamRequest'])assert.ok(!json.includes(secret),secret);
 assert.equal(s.players[0].ready,true);assert.equal(s.players[0].online,true);
});
test('Step 4 guest lobby: every team is legible and user-supplied names are safely escaped',()=>{
 const l=lobbySnapshot(base()),member={status:'pending',teamRequest:{kind:'create',name:'<img src=x onerror=alert(1)>'},ready:true};
 const html=lobbyGuestHTML(l,member);
 assert.match(html,/Team-Lobby/);assert.match(html,/lobby-create-form/);assert.match(html,/data-action="lobby-ready"/);
 assert.ok(!html.includes('<img src=x'));
 assert.match(html,/&lt;img src=x/);
 assert.match(html,/aria-pressed="true"/);
 assert.match(html,/data-team="t1"/);
 assert.match(hostLobbySummary(l),/0 \/ 0/);
 assert.match(hostLobbySummary(l),/id="host-team-create-form"/);
 assert.doesNotMatch(hostLobbySummary({...l,open:false}),/id="host-team-create-form"/);
});
test('Step 4 readiness and team selection locked after first question even after returning to board',()=>{
 assert.equal(canArrangeLobby(base().public),true);
 assert.equal(canArrangeLobby({...base().public,used:{_empty:true}}),true,'Published quiz placeholder must not lock lobby');
 for(const state of [{phase:'question',round:1},{phase:'board',round:1},{phase:'reveal',round:1},{phase:'board',round:0,used:{q:true}}])assert.equal(canArrangeLobby(state),false);
});
test('Step 4 host approval still limits players and validates fixed team IDs',()=>{
 let roster={};
 for(let i=0;i<MAX_PLAYERS;i++)roster=approval(roster,'p_'+i,{name:'Player '+i},'t1').roster;
 assert.equal(approval(roster,'p_10',{name:'Last'},'t1').accepted,false);
 assert.throws(()=>approval(roster,'evil',{name:'X'},'__proto__'),/Ungültiges Team/);
});
test('Step 4 assets are shipped through the offline cache and HTML',()=>{
 const idx=readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../docs/sw.js',import.meta.url),'utf8');
 assert.match(idx,/lobby-ui\.css/);assert.match(sw,/lobby-view\.mjs/);assert.match(sw,/lobby-ui\.css/);
 assert.match(sw,/brainquiz-shell-3\.7\.0/);
});

test('Host team form preserves open state during live redraw, then clears and collapses after submission',()=>{
 const l=lobbySnapshot(base());
 assert.match(hostLobbySummary(l),/data-bq-persist="hostteamcreate"/);
 const app=readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 assert.match(app,/input\.closest\('details'\)\?\.removeAttribute\('open'\)/);
 assert.match(app,/input\.value=''/);
});
test('Host team creation appears for fewer than five teams and never for a filled room',()=>{
 let current={t1:'Rot',t2:'Blau'};
 let state=base();state.public.teams=current;
 let lobby=lobbySnapshot(state);
 assert.match(hostLobbySummary(lobby),/id="host-team-create-form"/);
 assert.match(hostLobbySummary(lobby),/Team anlegen/);
 for(const name of ['Gelb','Lila','Grün'])current=addLobbyTeam(current,name).teams;
 state.public.teams=current;
 lobby=lobbySnapshot(state);
 assert.equal(Object.keys(lobby.teams).length,5);
 assert.doesNotMatch(hostLobbySummary(lobby),/id="host-team-create-form"/);
 assert.doesNotMatch(lobbyGuestHTML(lobby,{status:'pending'}),/id="lobby-create-form"/);
});
test('Ten participants are preserved in lobby and in secret-answer review',()=>{
 const state=base();
 for(let i=1;i<=10;i++){
  const id='user_'+i;
  state.roster[id]={name:'Person '+i,team:i<=5?'t1':'t2'};
  state.members[id]={status:'approved',ready:i%2===0};
  state.presence[id]={connectedAt:i};
 }
 const lobby=lobbySnapshot(state);
 assert.equal(lobby.players.length,10);
 assert.equal(lobby.ready,5);
 assert.equal(lobby.approved,10);
 assert.match(hostLobbySummary(lobby),/5 \/ 10/);
});

test('Live reset zeroes all current host-created team scores instead of only original editor teams',()=>{
 const app=readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 const reset=app.slice(app.indexOf("case 'reset-questions':"),app.indexOf("case 'delete-room':"));
 assert.match(reset,/scores:Object\.fromEntries\(Object\.keys\(publicState\?\.teams\|\|\{\}\)\.map\(id=>\[id,0\]\)\)/);
 assert.doesNotMatch(reset,/scores:buildScores\(quiz\)/);
});
