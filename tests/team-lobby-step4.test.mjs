import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_PLAYERS,MAX_TEAMS,TEAM_PALETTE,teamColor,validTeamId,canArrangeLobby,cleanTeamName,addLobbyTeam,lobbySnapshot,approval} from '../docs/lobby-model.mjs';
import {lobbyGuestHTML,hostLobbySummary} from '../docs/lobby-view.mjs';
const base=()=>({public:{title:'Demo',phase:'board',round:0,used:{},teams:{t1:'Rot',t2:'Blau'},scores:{t1:0,t2:0}},members:{},roster:{},presence:{}});
test('Step 4 palette: six different predefined team identities, no user-controlled color injection',()=>{
 assert.equal(MAX_TEAMS,6);assert.equal(MAX_PLAYERS,8);
 assert.equal(new Set(TEAM_PALETTE).size,6);
 for(let i=1;i<=6;i++){const id='t'+i;assert.equal(validTeamId(id),true);assert.match(teamColor(id),/^#[0-9a-f]{6}$/);}
 for(const id of ['t0','t7','__proto__','t1;--team-color:red','constructor'])assert.equal(validTeamId(id),false);
});
test('Step 4 team creation: deterministic IDs, unique case-insensitive names, six-team upper limit',()=>{
 let teams=base().public.teams;
 const created=addLobbyTeam(teams,'  Die Krähen  ');
 assert.equal(created.id,'t3');
 assert.equal(created.teams.t3,'Die Krähen');
 assert.equal(Object.hasOwn(teams,'t3'),false);
 assert.throws(()=>addLobbyTeam(created.teams,'dIE krähen'),/bereits/);
 assert.throws(()=>addLobbyTeam(teams,'Rot'),/bereits/);
 assert.throws(()=>addLobbyTeam(teams,'A'),/2 bis 28/);
 assert.throws(()=>addLobbyTeam(teams,'X'.repeat(29)),/2 bis 28/);
 for(const name of ['Nebel','Komet','Sonne'])teams=addLobbyTeam(teams,name).teams;
 assert.equal(Object.keys(teams).length,5);
 teams=addLobbyTeam(teams,'Mond').teams;
 assert.equal(Object.keys(teams).length,6);
 assert.throws(()=>addLobbyTeam(teams,'Weitere'),/sechs Teams/);
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
});
test('Step 4 readiness and team selection locked after first question even after returning to board',()=>{
 assert.equal(canArrangeLobby(base().public),true);
 for(const state of [{phase:'question',round:1},{phase:'board',round:1},{phase:'reveal',round:1},{phase:'board',round:0,used:{q:true}}])assert.equal(canArrangeLobby(state),false);
});
test('Step 4 host approval still limits players and validates fixed team IDs',()=>{
 let roster={};
 for(let i=0;i<MAX_PLAYERS;i++)roster=approval(roster,'p_'+i,{name:'Player '+i},'t1').roster;
 assert.equal(approval(roster,'p_9',{name:'Last'},'t1').accepted,false);
 assert.throws(()=>approval(roster,'evil',{name:'X'},'__proto__'),/Ungültiges Team/);
});
test('Step 4 assets are shipped through the offline cache and HTML',()=>{
 const idx=readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../docs/sw.js',import.meta.url),'utf8');
 assert.match(idx,/lobby-ui\.css/);assert.match(sw,/lobby-view\.mjs/);assert.match(sw,/lobby-ui\.css/);
 assert.match(sw,/brainquiz-shell-3\.6\.4/);
});
