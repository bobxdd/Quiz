const root=document.getElementById('projector-root');
const clock=document.getElementById('projector-clock');
const status=document.getElementById('projector-status');
const fullscreen=document.getElementById('projector-fullscreen');
const query=new URLSearchParams(location.search);
const room=(query.get('room')||'').toUpperCase();
const key=location.hash.slice(1);
let deadline=0,lastMarkup='';

function tick(){
 if(!deadline){clock.hidden=true;return;}
 clock.hidden=false;
 const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));
 clock.textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
}
function showStatus(text){
 deadline=0;lastMarkup='';tick();
 const section=document.createElement('section');
 section.className='bq-projector-wait';
 const heading=document.createElement('h1');
 heading.textContent='BrainQuiz Studio';
 section.append(heading);
 root.replaceChildren(section);
 status.textContent=text;
}
function showFrame(payload){
 if(typeof payload?.html!=='string'||payload.html.length>3_000_000)return;
 deadline=Number(payload.deadline)||0;tick();
 if(payload.html===lastMarkup)return;
 lastMarkup=payload.html;
 const template=document.createElement('template');
 template.innerHTML=lastMarkup;
 for(const element of template.content.querySelectorAll('script,iframe,object,embed,form,button,input,textarea,select,base,link,meta,style,svg,math'))element.remove();
 for(const element of template.content.querySelectorAll('*')){
  for(const attribute of [...element.attributes]){
   if(attribute.name.startsWith('on')||['data-action','href','srcdoc','tabindex','autofocus','contenteditable'].includes(attribute.name))element.removeAttribute(attribute.name);
  }
 }
 status.textContent='';
 root.replaceChildren(template.content);
}

if(!document.fullscreenEnabled)fullscreen.hidden=true;
fullscreen.addEventListener('click',async()=>{
 try{
  if(document.fullscreenElement)await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
 }catch{status.textContent='Vollbild konnte nicht geöffnet werden.';}
});
document.addEventListener('fullscreenchange',()=>{fullscreen.textContent=document.fullscreenElement?'Vollbild verlassen':'Vollbild';});
setInterval(tick,250);

if(!/^[A-HJ-NP-Z2-9]{16}$/.test(room)||!/^[a-f0-9]{32}$/.test(key)){
 showStatus('Ungültiger Beamer-Link. Öffne ihn über die Host-Steuerung.');
}else if(query.get('remote')==='1'){
 showStatus('Verbindung zur Quiz-Präsentation wird aufgebaut …');
 try{
  const {watchProjector}=await import('./peer-client.mjs');
  const stop=watchProjector(room,key,showFrame,showStatus);
  window.addEventListener('pagehide',stop,{once:true});
 }catch{showStatus('Die Quiz-Präsentation konnte nicht geladen werden.');}
}else if(typeof BroadcastChannel!=='undefined'){
 const channel=new BroadcastChannel('brainquiz-projector-'+room+'-'+key);
 channel.onmessage=({data})=>{
  if(data?.t==='closed')showStatus('Der Host hat den Spielraum geschlossen.');
  else if(data?.t==='frame')showFrame(data);
 };
 channel.postMessage({t:'ready'});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)channel.postMessage({t:'ready'});});
}else{
 showStatus('Dieser Browser unterstützt den lokalen Beamer nicht. Bitte verwende den Zuschauerlink.');
}
