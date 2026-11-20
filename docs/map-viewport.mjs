/* BrainQuiz step 3: one map interaction implementation for host editor and game.
   Each viewer owns its camera; editing the camera never edits an answer. */
import {normalizeMapView,mapScreenPosition,mapWorldPosition,mapZoomAt,mapPanBy,mapViewCss,normalizePoint,formatMapDistanceKm} from './map-tools.mjs';

export function mapMarkup({prompt='',view,point=null,solution=null,otherPins=[],editable=false,editor=false,visibleSolution=false}={}){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const v=normalizeMapView(view),css=mapViewCss(v);
 const pinMarkup=(pos,cls,label,img=false,number='',name='',movable=false)=>{
  const p=mapScreenPosition(pos,v);
  if(!p)return '';
  const offscreen=p.x<-4||p.x>104||p.y<-4||p.y>104;
  return `<span class="bq-map-pin ${cls}" ${offscreen?'hidden':''} ${movable?'data-map-draggable="true"':''} style="left:${p.x}%;top:${p.y}%" data-map-world="true" data-map-x="${pos.x}" data-map-y="${pos.y}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${img?'<img src="./dagger-pin.svg" alt="" draggable="false">':`<span class="bq-map-pin-dot" aria-hidden="true">${number?esc(number):''}</span>${number?`<span class="bq-map-pin-name" aria-hidden="true">${esc(name)}</span>`:''}`}<span class="bq-map-pin-tip" aria-hidden="true"></span></span>`;
 };
 const privatePin=normalizePoint(point),answer=normalizePoint(solution);
 const publicPins=otherPins.map((pin,i)=>{
  const team=/^t[1-6]$/.test(String(pin.team||''))?String(pin.team):'t0';
  const number=String(Number.isInteger(pin.number)&&pin.number>0?pin.number:i+1);
  const name=String(pin.name||'Antwort '+number),teamLabel=String(pin.teamLabel||'');
  const distance=typeof pin.distanceKm==='number'&&Number.isFinite(pin.distanceKm)?' · '+formatMapDistanceKm(pin.distanceKm)+' Luftlinie':'';
  return {pin,team,number,name,teamLabel,label:number+'. '+name+(teamLabel?' ('+teamLabel+')':'')+distance};
 });
 const action=editable?'data-map-choice="true"':'';
 const editBadge=editor?(privatePin?'<span class="bq-map-valid">✓ Zielpunkt gesetzt</span>':'<span class="bq-map-required">● Zielpunkt fehlt – zum Setzen tippen</span>'):'';
 return `<div class="bq-map-question">
 <div class="bq-map-title"><h2>${esc(prompt||'Frage eingeben')}</h2>${editBadge}</div>
 <div class="bq-map-controls" aria-label="Kartensteuerung">
  <button type="button" data-map-zoom="in" aria-label="Karte vergrößern" title="Hineinzoomen">+</button>
  <output class="bq-map-zoom-value" aria-live="off">${Math.round(v.zoom*100)} %</output>
  <button type="button" data-map-zoom="out" aria-label="Karte verkleinern" title="Herauszoomen">−</button>
  <button type="button" data-map-zoom="reset" class="bq-map-reset">Weltübersicht</button>
  ${privatePin?`<button type="button" data-map-zoom="pin" class="bq-map-reset">${editor?'Zum Zielpunkt':'Zu meinem Pin'}</button>`:''}
 </div>
 <div class="bq-map-viewport" tabindex="0" role="application" aria-label="Interaktive Weltkarte. Pfeiltasten verschieben die Karte, Plus und Minus zoomen. Enter setzt den Pin in die Mitte. Umschalt und Pfeiltaste verschieben einen eigenen Pin präzise." ${action} data-map-viewport="true">
  <div class="bq-map-layer" style="left:${css.left}%;top:${css.top}%;width:${css.width}%;height:${css.height}%"><img src="./world-map.svg" alt="" draggable="false"></div>
  <div class="bq-map-markers" aria-live="off">${privatePin?pinMarkup(privatePin,editor?'is-host':'is-self',editor?'Richtiger Zielpunkt (nur Host)':'Dein Kartenpunkt',editor,'','',editable):''}${visibleSolution&&answer?pinMarkup(answer,'is-solution','Richtiger Zielpunkt',true):''}${publicPins.map(p=>pinMarkup(p.pin,'is-public is-team-'+p.team+(p.pin.muted?' is-muted':''),p.label,false,p.number,p.name)).join('')}</div>
   ${publicPins.length?`<div class="bq-map-pin-legend" aria-label="Zuordnung der Kartenpunkte">${publicPins.map(p=>`<span class="bq-map-pin-legend-item is-team-${p.team}${p.pin.muted?' is-muted':''}" title="${esc(p.label)}"><b>${esc(p.number)}</b><span>${esc(p.name)}${p.teamLabel?' · '+esc(p.teamLabel):''}</span></span>`).join('')}</div>`:''}
 </div>
 <p class="bq-map-instruction">${editor?'Tippe auf den Zielort oder ziehe den Dolch an die genaue Position.':editable?'Tippe auf einen Ort oder ziehe deinen Pin. Jede Platzierung wird direkt gespeichert.':'Ziehe die Karte zum Verschieben.'} Mit +/−, Mausrad oder zwei Fingern zoomen.</p>
 </div>`;
}

export function mountMapViewport(element,{getView,setView,onPick,canPick=false,onGesture}={}){
 if(!element||element.dataset.mapBound==='yes')return;
 element.dataset.mapBound='yes';
 let camera=normalizeMapView(getView?.()),active=new Map(),movement=0,gestured=false,pinch=null,dragPin=null;
 const mayPick=()=>typeof canPick==='function'?canPick():canPick;
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
  if(!element.clientWidth||!element.clientHeight)return null;
  return {x:(clientX-r.left-element.clientLeft)/element.clientWidth*100,y:(clientY-r.top-element.clientTop)/element.clientHeight*100};
 };
 const clampPoint=p=>({x:Math.max(0,Math.min(100,p.x)),y:Math.max(0,Math.min(100,p.y))});
 const place=(p)=>{if(!mayPick()||!p)return;const world=mapWorldPosition(clampPoint(p),camera);if(world)onPick?.(world);};
 const ownPin=()=>element.querySelector('.bq-map-pin.is-self, .bq-map-pin.is-host');
 const worldOf=pin=>pin&&normalizePoint({x:pin.dataset.mapX,y:pin.dataset.mapY});
 const distance=(one,two)=>Math.hypot(one.x-two.x,one.y-two.y);
 const midpoint=(one,two)=>({x:(one.x+two.x)/2,y:(one.y+two.y)/2});
 controls?.addEventListener('click',ev=>{
  const button=ev.target.closest('[data-map-zoom]');if(!button)return;
  ev.preventDefault();ev.stopPropagation();
  const action=button.dataset.mapZoom;
  const point=action==='pin'?worldOf(ownPin()):null;
  const next=action==='reset'?normalizeMapView():point?normalizeMapView({...point,zoom:Math.max(4,camera.zoom)}):mapZoomAt(camera,camera.zoom*(action==='in'?1.5:1/1.5));
  render(next);
 });
 element.addEventListener('wheel',ev=>{
  ev.preventDefault();const p=percent(ev.clientX,ev.clientY);if(!p)return;
  const pixels=ev.deltaY*(ev.deltaMode===1?16:ev.deltaMode===2?element.clientHeight:1);
  const ratio=Math.exp(-Math.max(-150,Math.min(150,pixels))/450);
  render(mapZoomAt(camera,camera.zoom*ratio,p));
 },{passive:false});
 element.addEventListener('pointerdown',ev=>{
  if(ev.button!==0&&ev.pointerType!=='touch')return;
  const p=percent(ev.clientX,ev.clientY);if(!p)return;
  if(!active.size){
   movement=0;onGesture?.(true);
   const target=ev.target.closest('[data-map-draggable]');
   const tip=target&&mayPick()?mapScreenPosition(worldOf(target),camera):null;
   if(tip)dragPin={target,dx:tip.x-p.x,dy:tip.y-p.y};
  }
  active.set(ev.pointerId,p);
  try{element.setPointerCapture(ev.pointerId);}catch{}
  if(active.size===2){
   if(dragPin){dragPin=null;render(camera);}
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
  }else if(active.size===1&&dragPin&&movement>3){
   const tip=clampPoint({x:p.x+dragPin.dx,y:p.y+dragPin.dy});
   dragPin.target.style.left=tip.x+'%';dragPin.target.style.top=tip.y+'%';
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
  if(!cancel&&wasSingle&&!gestured){
   if(dragPin&&p&&movement>3)place({x:p.x+dragPin.dx,y:p.y+dragPin.dy});
   else if(!dragPin&&movement<=5)place(p);
  }
  if(!active.size){if(cancel&&dragPin)render(camera);gestured=false;pinch=null;dragPin=null;movement=0;onGesture?.(false);}
 }
 element.addEventListener('pointerup',ev=>endPointer(ev));
 element.addEventListener('pointercancel',ev=>endPointer(ev,true));
 element.addEventListener('lostpointercapture',ev=>endPointer(ev,true));
 element.addEventListener('keydown',ev=>{
  const k=ev.key;
  if(k==='+'||k==='='||k==='-'){ev.preventDefault();render(mapZoomAt(camera,camera.zoom*(k==='-'?1/1.7:1.7)));return;}
  if(k==='0'){ev.preventDefault();render(normalizeMapView());return;}
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '].includes(k))return;
  ev.preventDefault();
  if(k==='Enter'||k===' '){place({x:50,y:50});return;}
  const x=k==='ArrowRight'?1:k==='ArrowLeft'?-1:0,y=k==='ArrowDown'?1:k==='ArrowUp'?-1:0;
  if(ev.shiftKey&&mayPick()){
   const tip=mapScreenPosition(worldOf(ownPin()),camera);
   if(tip)place({x:tip.x+x*100/element.clientWidth,y:tip.y+y*100/element.clientHeight});
  }else render(mapPanBy(camera,x*-6,y*-6));
 });
}
