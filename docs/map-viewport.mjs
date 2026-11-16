/* BrainQuiz step 3: one map interaction implementation for host editor and game.
   Each viewer owns its camera; editing the camera never edits an answer. */
import {normalizeMapView,mapScreenPosition,mapWorldPosition,mapZoomAt,mapPanBy,mapViewCss,normalizePoint} from './map-tools.mjs';

export function mapMarkup({prompt='',view,point=null,solution=null,otherPins=[],editable=false,editor=false,visibleSolution=false}={}){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const v=normalizeMapView(view),css=mapViewCss(v);
 const pinMarkup=(pos,cls,label,img=false)=>{
  const p=mapScreenPosition(pos,v);
  if(!p||p.x<-4||p.x>104||p.y<-4||p.y>104)return '';
  return `<span class="bq-map-pin ${cls}" style="left:${p.x}%;top:${p.y}%" data-map-world="true" data-map-x="${pos.x}" data-map-y="${pos.y}" role="img" aria-label="${esc(label)}">${img?'<img src="./dagger-pin.svg" alt="" draggable="false">':'<span class="bq-map-pin-dot" aria-hidden="true"></span>'}</span>`;
 };
 const privatePin=normalizePoint(point),answer=normalizePoint(solution);
 const action=editable?'data-map-choice="true"':'';
 const editBadge=editor?(privatePin?'<span class="bq-map-valid">✓ Zielpunkt gesetzt</span>':'<span class="bq-map-required">● Zielpunkt fehlt – zum Setzen tippen</span>'):'';
 return `<div class="bq-map-question">
 <div class="bq-map-title"><h2>${esc(prompt||'Frage eingeben')}</h2>${editBadge}</div>
 <div class="bq-map-controls" aria-label="Kartensteuerung">
  <button type="button" data-map-zoom="in" aria-label="Karte vergrößern" title="Hineinzoomen">+</button>
  <output class="bq-map-zoom-value" aria-live="off">${Math.round(v.zoom*100)} %</output>
  <button type="button" data-map-zoom="out" aria-label="Karte verkleinern" title="Herauszoomen">−</button>
  <button type="button" data-map-zoom="reset" class="bq-map-reset">Weltübersicht</button>
 </div>
 <div class="bq-map-viewport" tabindex="0" role="application" aria-label="Interaktive Weltkarte. Mit Klick oder Tippen einen Punkt setzen. Mit den Pfeiltasten bewegen, Plus und Minus zoomen. Enter setzt den Punkt in die Mitte." ${action} data-map-viewport="true">
  <div class="bq-map-layer" style="left:${css.left}%;top:${css.top}%;width:${css.width}%;height:${css.height}%"><img src="./world-map.svg" alt="" draggable="false"></div>
  <div class="bq-map-markers" aria-live="off">${privatePin?pinMarkup(privatePin,editor?'is-host':'is-self',editor?'Richtiger Zielpunkt (nur Host)':'Dein Kartenpunkt',editor):''}${visibleSolution&&answer?pinMarkup(answer,'is-solution','Richtiger Zielpunkt',true):''}${otherPins.map((pin,i)=>pinMarkup(pin,'is-public',pin.name||'Antwort '+(i+1))).join('')}</div>
 </div>
 <p class="bq-map-instruction">${editor?'Wähle den richtigen Ort direkt auf der Karte. Der Dolch kennzeichnet die geheime Lösung.':editable?'Tippe auf die Karte, um deinen Pin zu setzen. Du kannst ihn vor dem Absenden jederzeit verschieben.':'Weltkarte – die Position der Lösung wird erst bei der Aufdeckung angezeigt.'} Mit +/− oder Mausrad zoomen, mit Ziehen verschieben.</p>
 </div>`;
}

export function mountMapViewport(element,{getView,setView,onPick,canPick=false}={}){
 if(!element||element.dataset.mapBound==='yes')return;
 element.dataset.mapBound='yes';
 let camera=normalizeMapView(getView?.()),active=new Map(),movement=0,gestured=false,pinch=null;
 const controls=element.closest('.bq-map-question')?.querySelector('.bq-map-controls');
 const render=(v)=>{
  camera=normalizeMapView(v);setView?.(camera);
  const layer=element.querySelector('.bq-map-layer'),css=mapViewCss(camera);
  if(layer)Object.assign(layer.style,{left:css.left+'%',top:css.top+'%',width:css.width+'%',height:css.height+'%'});
  for(const pin of element.querySelectorAll('[data-map-world]')){
   const p=normalizePoint({x:pin.dataset.mapX,y:pin.dataset.mapY}),loc=mapScreenPosition(p,camera);
   if(loc){pin.style.left=loc.x+'%';pin.style.top=loc.y+'%';pin.hidden=loc.x<-4||loc.x>104||loc.y<-4||loc.y>104;}
  }
  const display=controls?.querySelector('.bq-map-zoom-value');if(display)display.textContent=Math.round(camera.zoom*100)+' %';
 };
 const percent=(clientX,clientY)=>{
  const r=element.getBoundingClientRect();
  if(!r.width||!r.height)return null;
  return {x:(clientX-r.left)/r.width*100,y:(clientY-r.top)/r.height*100};
 };
 const place=(p)=>{if(!canPick||!p)return;const world=mapWorldPosition(p,camera);if(world)onPick?.(world);};
 const distance=(one,two)=>Math.hypot(one.x-two.x,one.y-two.y);
 const midpoint=(one,two)=>({x:(one.x+two.x)/2,y:(one.y+two.y)/2});
 controls?.addEventListener('click',ev=>{
  const button=ev.target.closest('[data-map-zoom]');if(!button)return;
  ev.preventDefault();ev.stopPropagation();
  const action=button.dataset.mapZoom;
  const next=action==='reset'?normalizeMapView():mapZoomAt(camera,camera.zoom*(action==='in'?1.7:1/1.7));
  render(next);
 });
 element.addEventListener('wheel',ev=>{
  ev.preventDefault();const p=percent(ev.clientX,ev.clientY);if(!p)return;
  render(mapZoomAt(camera,camera.zoom*(ev.deltaY<0?1.18:1/1.18),p));
 },{passive:false});
 element.addEventListener('pointerdown',ev=>{
  if(ev.button!==0&&ev.pointerType!=='touch')return;
  const p=percent(ev.clientX,ev.clientY);if(!p)return;
  active.set(ev.pointerId,p);movement=0;
  try{element.setPointerCapture(ev.pointerId);}catch{}
  if(active.size===2){
   const pts=[...active.values()];
   pinch={distance:distance(pts[0],pts[1]),middle:midpoint(pts[0],pts[1]),base:camera};
   gestured=true;
  }
 });
 element.addEventListener('pointermove',ev=>{
  if(!active.has(ev.pointerId))return;
  const p=percent(ev.clientX,ev.clientY);if(!p)return;
  const previous=active.get(ev.pointerId);
  active.set(ev.pointerId,p);
  const r=element.getBoundingClientRect(),dx=(p.x-previous.x)*r.width/100,dy=(p.y-previous.y)*r.height/100;
  movement+=Math.hypot(dx,dy);
  if(active.size>=2&&pinch){
   const pts=[...active.values()],mid=midpoint(pts[0],pts[1]);
   let next=mapZoomAt(pinch.base,pinch.base.zoom*(distance(pts[0],pts[1])/Math.max(.1,pinch.distance)),pinch.middle);
   next=mapPanBy(next,mid.x-pinch.middle.x,mid.y-pinch.middle.y);
   render(next);
  }else if(active.size===1&&movement>5){
   gestured=true;
   if(camera.zoom>1)render(mapPanBy(camera,p.x-previous.x,p.y-previous.y));
  }
 });
 function endPointer(ev,cancel=false){
  if(!active.has(ev.pointerId))return;
  const p=percent(ev.clientX,ev.clientY);
  const wasSingle=active.size===1;
  active.delete(ev.pointerId);
  try{if(element.hasPointerCapture(ev.pointerId))element.releasePointerCapture(ev.pointerId);}catch{}
  if(!cancel&&wasSingle&&!gestured&&movement<=5)place(p);
  if(!active.size){gestured=false;pinch=null;movement=0;}
 }
 element.addEventListener('pointerup',ev=>endPointer(ev));
 element.addEventListener('pointercancel',ev=>endPointer(ev,true));
 element.addEventListener('lostpointercapture',ev=>{if(active.has(ev.pointerId)){active.delete(ev.pointerId);if(!active.size){gestured=false;pinch=null;movement=0;}}});
 element.addEventListener('keydown',ev=>{
  const k=ev.key;
  if(k==='+'||k==='='||k==='-'){ev.preventDefault();render(mapZoomAt(camera,camera.zoom*(k==='-'?1/1.7:1.7)));return;}
  if(k==='0'){ev.preventDefault();render(normalizeMapView());return;}
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '].includes(k))return;
  ev.preventDefault();
  if(k==='Enter'||k===' '){place({x:50,y:50});return;}
  const dx=k==='ArrowRight'?-10:k==='ArrowLeft'?10:0,dy=k==='ArrowDown'?-10:k==='ArrowUp'?10:0;
  render(mapPanBy(camera,dx,dy));
 });
}
