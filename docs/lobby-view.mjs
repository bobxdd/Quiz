/** BrainQuiz Step 4: one focused lobby view for pending and approved guests.
 * Team colors are server-known palette values; every name is HTML-escaped. */
import {teamColor,validTeamId,MAX_TEAMS} from './lobby-model.mjs';
import {escapeHTML as e} from './core.mjs';
const safeTeams=value=>Object.entries(value||{}).filter(([id,name])=>validTeamId(id)&&typeof name==='string').slice(0,6);
const dot=id=>`<span class="bq-team-swatch" aria-hidden="true" style="--bq-team-color:${teamColor(id)}"></span>`;
const teamLabel=(id,name)=>`${dot(id)}<span>${e(name)}</span>`;
/** The public rules are visible to EVERY participant BEFORE ready-up.
 * They must describe BrainQuiz's active scoring, not unimplemented Brainlag
 * bonus/joker variants. */
export function lobbyRulesHTML(lobby){
 const individual=lobby?.scoreMode==='individual';
 return `<details class="bq-lobby-rules" data-bq-persist="quizrules"><summary>Spielregeln und Punkte vor dem Start ansehen</summary>
 <div class="bq-lobby-rules-body"><p><strong>${individual?'Einzelwertung':'Teamwertung'}:</strong> ${individual?'Jeder sammelt eigene Punkte.':'Der Host wählt jedes Fragenfeld. ALLE Teams dürfen anschließend buzzern.'}</p>
 <p><strong>Buzzerfragen:</strong> Das erste vom Host empfangene gültige Signal erhält das Antwortrecht. Der Host bestätigt jede Antwort ausdrücklich. Richtig: voller Fragewert. Falsch: halber Fragewert als Abzug; ${individual?'die betroffene Person':'das betroffene Team'} ist für diese Frage gesperrt, andere dürfen weiter buzzern.</p>
 <p><strong>Schreibfragen:</strong> Alle dürfen zunächst verdeckt antworten. Der Host deckt die Antworten auf. ${individual?'Jede Person wird einzeln bewertet.':'In der Teamwertung wählt der Host genau eine offizielle Antwort pro Team und Frage; weitere Teamantworten werden gezeigt, geben aber keine zusätzlichen Punkte.'} Eine offizielle falsche Wertung kostet die Hälfte der Fragepunkte.</p>
 <p><strong>Fragenwechsel:</strong> Der Host wählt die nächste Frage. Lösung und Punkte sind erst nach der Hostentscheidung verbindlich. Der Host kann offensichtliche Wertungsfehler berichtigen.</p>
 <p><strong>Letzte sechs Fragen pro Brett:</strong> Bei höchstens sechs offenen Feldern zählen alle verbleibenden Fragen doppelt. Nach Runde 1 geht es mit demselben Punktestand auf Runde 2 weiter. Dort zählt die Zahl der noch offenen Felder dieses Bretts.</p>
 ${!individual?'<p><strong>Gemeinsame Team-Punkte:</strong> Ein Team besitzt genau einen Gesamtpunktestand. Bei Schreibfragen darf pro Team und Frage nur eine Antwort offiziell gewertet werden – unabhängig von der Teamgröße.</p>':''}
 <p class="small muted">Joker und Sonderbonusfragen sind in diesen Standardregeln nicht aktiviert. Sonderregeln sollten vor Spielbeginn gemeinsam vereinbart werden.</p>
 </div></details>`;
}
export function lobbyGuestHTML(lobby,member){
 const teams=safeTeams(lobby?.teams),players=Array.isArray(lobby?.players)?lobby.players:[],phaseOpen=lobby?.open===true;
 const requested=member?.teamRequest||null;
 const selected=member?.status==='approved'?member.team:requested?.kind==='join'?requested.id:'';
 const proposed=requested?.kind==='create'?requested.name:'';
 const ready=member?.ready===true;
 const hasTeam=member?.status==='approved'?!!selected:!!(requested&&(requested.kind==='create'||selected));
 const pending=member?.status==='pending';
 const late=pending&&!phaseOpen&&lobby?.canJoin===true;
 const complete=lobby?.approved||0,totalReady=lobby?.ready||0;
 return `<section class="bq-lobby" aria-label="Team-Lobby">
  <div class="bq-lobby-head">
   <div><span class="bq-lobby-eyebrow">SPIELRAUM · TEAMWAHL</span><h2>Team-Lobby</h2><p>${e(lobby?.title||'BrainQuiz')}</p></div>
   <div class="bq-lobby-counter" role="status" aria-live="polite"><strong>${totalReady} / ${complete}</strong><span>bereit</span></div>
  </div>
  ${pending?`<p class="bq-lobby-notice" role="status">${late?'Das Quiz läuft. Wähle ein Team und warte auf den Host. Nach der Freigabe spielst du ab der nächsten verfügbaren Frage mit.':lobby?.canJoin===false?'Das Quiz ist beendet.':'Freigabe ausstehend · Du kannst dein Team bereits auswählen. Der Host bestätigt deine Aufnahme.'}</p>`:''}
  ${lobbyRulesHTML(lobby)}
  <div class="bq-lobby-join-guide"><strong>Wähle dein Team</strong>${phaseOpen?'<span>Du kannst auch ein eigenes erstellen.</span>':''}</div>
  <div class="bq-lobby-team-grid">${teams.map(([id,name])=>{
   const members=players.filter(x=>x.team===id);
   const chosen=id===selected,canSelect=phaseOpen||late;
   return `<article class="bq-lobby-team ${chosen?'is-selected':''}" style="--bq-team-color:${teamColor(id)}">
     <div class="bq-lobby-team-name">${teamLabel(id,name)}<small>${members.length} ${members.length===1?'Mitglied':'Mitglieder'}</small></div>
     <div class="bq-lobby-member-list">${members.length?members.map(p=>`<span class="bq-lobby-member ${p.ready?'is-ready':''}"><i class="bq-lobby-online ${p.online?'online':''}" aria-hidden="true"></i>${e(p.name)}<small>${p.ready?'✓ Bereit':'Noch nicht bereit'}</small></span>`).join(''):'<span class="bq-lobby-empty">Noch frei</span>'}</div>
     ${canSelect?`<button type="button" class="btn ${chosen?'bq-lobby-selected':'primary'}" data-action="lobby-join" data-team="${id}" ${chosen?'disabled aria-pressed="true"':''}>${chosen?'✓ Ausgewählt':'Diesem Team beitreten'}</button>`:''}
   </article>`;
  }).join('')}</div>
  ${phaseOpen&&teams.length<MAX_TEAMS&&!member?.createdTeam?`<form class="bq-lobby-create" id="lobby-create-form"><label for="bq-new-team"><strong>Eigenes Team erstellen</strong><span>Der nächste freie Teamfarbton wird automatisch vergeben.</span></label><div class="bq-lobby-create-row"><input id="bq-new-team" name="teamname" maxlength="28" minlength="2" autocomplete="off" required placeholder="Teamname" value="${e(proposed)}"><button class="btn small" type="submit">Team erstellen</button></div></form>`:''}
  ${proposed?`<p class="bq-lobby-proposal" role="status">Neues Team „${e(proposed)}“ wird mit deiner Freigabe erstellt. Die Farbe wird automatisch vergeben.</p>`:''}
  <div class="bq-lobby-ready-bar">
   <div><strong>2. Fertig?</strong><p>${!hasTeam?'Wähle zuerst ein Team aus.':pending?'Deine Auswahl wartet auf Freigabe.':'Der Host sieht deinen Bereitschaftsstatus sofort.'}</p></div>
   <button type="button" class="btn ${ready?'bq-lobby-ready-on':'primary'}" data-action="lobby-ready" data-ready="${ready?'false':'true'}" ${!hasTeam||!phaseOpen?'disabled':''} aria-pressed="${ready}">${ready?'✓ Bereit · zurücknehmen':'✓ Ich bin bereit'}</button>
  </div>
  ${!phaseOpen?'<p class="small muted">Die Runde hat begonnen. Teamwechsel sind jetzt gesperrt.</p>':''}
 </section>`;
}
export function hostLobbySummary(lobby,canRename=true){
 const teams=safeTeams(lobby?.teams),players=Array.isArray(lobby?.players)?lobby.players:[];
 return `<section class="glass panel bq-host-lobby-summary" aria-label="Team-Bereitschaft">
  <div class="panelhead"><div class="bq-host-lobby-title"><h2>Team-Lobby</h2><p class="small muted">Quiz: <strong>${e(lobby?.title||'BrainQuiz')}</strong></p></div><span class="bq-lobby-headcount" role="status" aria-live="polite"><strong>${Number(lobby?.ready)||0} / ${Number(lobby?.approved)||0}</strong> bereit</span></div>
  ${lobbyRulesHTML(lobby)}
  <div class="bq-host-team-grid">${teams.map(([id,name])=>{
    const group=players.filter(p=>p.team===id),ready=group.filter(p=>p.ready).length;
    return `<div class="bq-host-team-row" style="--bq-team-color:${teamColor(id)}"><strong>${teamLabel(id,name)}</strong><span>${ready}/${group.length} bereit</span><small>${group.map(p=>e(p.name)+(p.ready?' ✓':'')).join(', ')||'Noch keine Mitglieder'}</small>${canRename?`<button type="button" class="btn small" data-action="rename-team" data-team="${id}" aria-label="${e(name)} umbenennen">Umbenennen</button>`:''}</div>`;
  }).join('')}</div>
  ${lobby?.open&&teams.length<MAX_TEAMS?`<details class="bq-host-team-create" data-bq-persist="hostteamcreate"><summary>+ Team erstellen</summary><form id="host-team-create-form" class="bq-lobby-create"><label for="bq-host-team-name"><strong>Neues Team benennen</strong><span>Die Farbe wird automatisch vergeben. Bis zu ${MAX_TEAMS} Teams.</span></label><div class="bq-lobby-create-row"><input type="text" id="bq-host-team-name" name="teamname" required minlength="2" maxlength="28" autocomplete="off" placeholder="Teamname"><button class="btn primary" type="submit">Team anlegen</button></div></form></details>`:''}
  <p class="small muted">Bis zu 10 Teilnehmer · maximal ${MAX_TEAMS} neue Teams · Der Host bestätigt die Aufnahme. Bereit ist ein Signal, keine automatische Startfreigabe.</p>
 </section>`;
}
