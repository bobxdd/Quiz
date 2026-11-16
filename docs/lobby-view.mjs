/** BrainQuiz Step 4: one focused lobby view for pending and approved guests.
 * Team colors are server-known palette values; every name is HTML-escaped. */
import {teamColor,validTeamId,canArrangeLobby} from './lobby-model.mjs';
import {escapeHTML as e} from './core.mjs';
const safeTeams=value=>Object.entries(value||{}).filter(([id,name])=>validTeamId(id)&&typeof name==='string').slice(0,6);
const dot=id=>`<span class="bq-team-swatch" aria-hidden="true" style="--bq-team-color:${teamColor(id)}"></span>`;
const teamLabel=(id,name)=>`${dot(id)}<span>${e(name)}</span>`;
export function lobbyGuestHTML(lobby,member){
 const teams=safeTeams(lobby?.teams),players=Array.isArray(lobby?.players)?lobby.players:[],phaseOpen=lobby?.open===true;
 const requested=member?.teamRequest||null;
 const selected=member?.status==='approved'?member.team:requested?.kind==='join'?requested.id:'';
 const proposed=requested?.kind==='create'?requested.name:'';
 const ready=member?.ready===true;
 const hasTeam=member?.status==='approved'?!!selected:!!(requested&&(requested.kind==='create'||selected));
 const pending=member?.status==='pending';
 const complete=lobby?.approved||0,totalReady=lobby?.ready||0;
 return `<section class="bq-lobby" aria-label="Team-Lobby">
  <div class="bq-lobby-head">
   <div><span class="bq-lobby-eyebrow">SPIELRAUM · TEAMWAHL</span><h2>Team-Lobby</h2><p>${e(lobby?.title||'BrainQuiz')}</p></div>
   <div class="bq-lobby-counter" role="status" aria-live="polite"><strong>${totalReady} / ${complete}</strong><span>bereit</span></div>
  </div>
  ${pending?'<p class="bq-lobby-notice" role="status">Freigabe ausstehend · Du kannst dein Team bereits auswählen. Der Host bestätigt deine Aufnahme.</p>':''}
  <div class="bq-lobby-join-guide"><strong>1. Wähle dein Team</strong><span>Du kannst auch ein eigenes erstellen.</span></div>
  <div class="bq-lobby-team-grid">${teams.map(([id,name])=>{
   const members=players.filter(x=>x.team===id);
   const chosen=id===selected,canSelect=phaseOpen;
   return `<article class="bq-lobby-team ${chosen?'is-selected':''}" style="--bq-team-color:${teamColor(id)}">
     <div class="bq-lobby-team-name">${teamLabel(id,name)}<small>${members.length} ${members.length===1?'Mitglied':'Mitglieder'}</small></div>
     <div class="bq-lobby-member-list">${members.length?members.map(p=>`<span class="bq-lobby-member ${p.ready?'is-ready':''}"><i class="bq-lobby-online ${p.online?'online':''}" aria-hidden="true"></i>${e(p.name)}<small>${p.ready?'✓ Bereit':'Noch nicht bereit'}</small></span>`).join(''):'<span class="bq-lobby-empty">Noch frei</span>'}</div>
     ${canSelect?`<button type="button" class="btn ${chosen?'bq-lobby-selected':'primary'}" data-action="lobby-join" data-team="${id}" ${chosen?'disabled aria-pressed="true"':''}>${chosen?'✓ Ausgewählt':'Diesem Team beitreten'}</button>`:''}
   </article>`;
  }).join('')}</div>
  ${phaseOpen&&teams.length<6&&!member?.createdTeam?`<form class="bq-lobby-create" id="lobby-create-form"><label for="bq-new-team"><strong>Eigenes Team erstellen</strong><span>Der nächste freie Teamfarbton wird automatisch vergeben.</span></label><div class="bq-lobby-create-row"><input id="bq-new-team" name="teamname" maxlength="28" minlength="2" autocomplete="off" required placeholder="Teamname" value="${e(proposed)}"><button class="btn small" type="submit">Team erstellen</button></div></form>`:''}
  ${proposed?`<p class="bq-lobby-proposal" role="status">Neues Team „${e(proposed)}“ wird mit deiner Freigabe erstellt. Die Farbe wird automatisch vergeben.</p>`:''}
  <div class="bq-lobby-ready-bar">
   <div><strong>2. Fertig?</strong><p>${!hasTeam?'Wähle zuerst ein Team aus.':pending?'Deine Auswahl wartet auf Freigabe.':'Der Host sieht deinen Bereitschaftsstatus sofort.'}</p></div>
   <button type="button" class="btn ${ready?'bq-lobby-ready-on':'primary'}" data-action="lobby-ready" data-ready="${ready?'false':'true'}" ${!hasTeam||!phaseOpen?'disabled':''} aria-pressed="${ready}">${ready?'✓ Bereit · zurücknehmen':'✓ Ich bin bereit'}</button>
  </div>
  ${!phaseOpen?'<p class="small muted">Die Runde hat begonnen. Teamwechsel sind jetzt gesperrt.</p>':''}
 </section>`;
}
export function hostLobbySummary(lobby){
 const teams=safeTeams(lobby?.teams),players=Array.isArray(lobby?.players)?lobby.players:[];
 return `<section class="glass panel bq-host-lobby-summary" aria-label="Team-Bereitschaft">
  <div class="panelhead"><h2>Team-Lobby</h2><span class="bq-lobby-headcount" role="status" aria-live="polite"><strong>${Number(lobby?.ready)||0} / ${Number(lobby?.approved)||0}</strong> bereit</span></div>
  <div class="bq-host-team-grid">${teams.map(([id,name])=>{
    const group=players.filter(p=>p.team===id),ready=group.filter(p=>p.ready).length;
    return `<div class="bq-host-team-row" style="--bq-team-color:${teamColor(id)}"><strong>${teamLabel(id,name)}</strong><span>${ready}/${group.length} bereit</span><small>${group.map(p=>e(p.name)+(p.ready?' ✓':'')).join(', ')||'Noch keine Mitglieder'}</small></div>`;
  }).join('')}</div>
  <p class="small muted">Der Host bestätigt die Aufnahme. Bereit ist ein Signal, keine automatische Startfreigabe.</p>
 </section>`;
}
