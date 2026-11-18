/* Local same-origin display mirror. A projector has no PeerJS identity,
 * no score or moderation actions, and never fetches private host files.
 * It only accepts already rendered public-stage HTML from the host tab.
 * This is NOT a remote spectator service or a secure cross-origin boundary.
 */
const root=document.getElementById('projector-root');
const room=(new URLSearchParams(location.search).get('room')||'').toUpperCase();
const key=location.hash.slice(1);
function message(text){root.replaceChildren();const section=document.createElement('section');section.className='bq-projector-wait';
 const heading=document.createElement('h1');heading.textContent='BrainQuiz Studio';const detail=document.createElement('p');
 detail.textContent=text;section.append(heading,detail);root.append(section);
}
if(!/^[A-HJ-NP-Z2-9]{16}$/.test(room)||!/^[a-f0-9]{32}$/.test(key)||typeof BroadcastChannel==='undefined') {
 message('Ungültiger lokaler Beamer-Link. Öffne ihn erneut über die Host-Steuerung.');
}else{
 const channel=new BroadcastChannel('brainquiz-projector-'+room+'-'+key);
 channel.onmessage=event=>{
  const payload=event.data;
  if(payload?.t==='closed'){message('Der Host hat diesen Spielraum geschlossen.');return;}
  if(payload?.t!=='frame'||typeof payload.html!=='string'||payload.html.length>3_000_000)return;
  // All fields are escaped by the existing public quiz/board renderer.
  // This page has a restrictive CSP and has no host commands or private state.
  root.innerHTML=payload.html;
 };
 channel.postMessage({t:'ready'});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)channel.postMessage({t:'ready'});});
}
