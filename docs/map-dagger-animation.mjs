/* Step 6: a single, decorative, non-interactive dagger toss at map-solution reveal.
   The real map pin stays anchored in world-space. We only animate the presentation. */
export const MAP_THROW_MS=4100;
export const MAP_FLIGHT_MS=1150;
export const MAP_FLIGHT_DELAY_MS=2180;
export const THROW_ACTORS=Object.freeze(['rogue','blades','mage','druid']);

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

/** Return a CSS viewport point corresponding to the actual world-space marker.
 * Do not rely on the marker's rotated image or its (upward-translated) bounding box. */
export function mapThrowTarget(viewport,marker){
 if(!viewport||!marker||!viewport.contains(marker))return null;
 const box=viewport.getBoundingClientRect();
 const x=Number.parseFloat(marker.style.left),y=Number.parseFloat(marker.style.top);
 if(!box.width||!box.height||!Number.isFinite(x)||!Number.isFinite(y))return null;
 return {x:box.left+box.width*x/100,y:box.top+box.height*y/100};
}

/** Both start point and throw motion are identical for every character/target.
 * The character stands just ABOVE the map: the body never blocks a map answer. */
export function mapThrowOrigin(viewport,width=innerWidth,height=innerHeight){
 const r=viewport.getBoundingClientRect();
 const rail=Number.parseFloat(getComputedStyle(viewport.closest('.bq-map-question')||viewport).getPropertyValue('--bq-map-throw-rail'))||146;
 const scale=Math.min(1,Math.max(.5,(rail-10)/142));
 const actorWidth=142*scale;
 const actorX=clamp(r.left-rail+Math.max(0,(rail-actorWidth)/2),4,Math.max(4,width-actorWidth-4));
 const actorY=clamp(r.top+Math.min(18,r.height*.05),4,Math.max(4,height-142*scale-4));
 return {actorX,actorY,scale,handX:actorX+111*scale,handY:actorY+53*scale};
}

/** A self-contained animation that survives app.innerHTML rerenders.
 * The caller owns round guards and must cancel on scene changes. */
export function startMapDaggerThrow({viewport,marker,actor='rogue',onLand=()=>{},onDone=()=>{}}={}){
 if(!THROW_ACTORS.includes(actor)||!mapThrowTarget(viewport,marker))return null;
 const root=document.createElement('div');
 root.className='bq-map-throw-layer';
 root.setAttribute('aria-hidden','true');
 root.innerHTML=`<div class="bq-map-throw-actor bq-map-throw-actor--${actor}">
  <span class="bq-map-throw-body bq-actor bq-actor--${actor}"></span>
  <span class="bq-map-throw-arm"><span class="bq-map-throw-hand"></span><img class="bq-map-throw-held" src="./dagger-pin.svg" alt="" draggable="false"></span>
 </div><img class="bq-map-throw-flight" src="./dagger-pin.svg" alt="" draggable="false">
 <span class="bq-map-throw-impact"></span>`;
 document.body.append(root);
 const body=root.querySelector('.bq-map-throw-actor');
 const flight=root.querySelector('.bq-map-throw-flight');
 const impact=root.querySelector('.bq-map-throw-impact');
 let currentViewport=viewport,currentMarker=marker,landed=false,stopped=false;
 let mutation=null;
 const origin=mapThrowOrigin(viewport);
 body.style.left=origin.actorX+'px';body.style.top=origin.actorY+'px';
 body.style.setProperty('--bq-actor-scale',String(origin.scale));
 flight.style.left=(origin.handX-16)+'px';flight.style.top=(origin.handY-46)+'px';
 const refresh=()=>{
  if(stopped)return;
  const p=mapThrowTarget(currentViewport,currentMarker);
  if(!p)return;
  flight.style.setProperty('--bq-flight-x',(p.x-origin.handX)+'px');
  flight.style.setProperty('--bq-flight-y',(p.y-origin.handY)+'px');
  flight.style.setProperty('--bq-flight-mid-x',((p.x-origin.handX)*.44)+'px');
  flight.style.setProperty('--bq-flight-mid-y',((p.y-origin.handY)*.40-33)+'px');
  flight.style.setProperty('--bq-flight-late-x',((p.x-origin.handX)*.79)+'px');
  flight.style.setProperty('--bq-flight-late-y',((p.y-origin.handY)*.80-13)+'px');
  impact.style.left=p.x+'px';impact.style.top=p.y+'px';
  root.dataset.targetX=p.x.toFixed(2);
  root.dataset.targetY=p.y.toFixed(2);
 };
 const observeMarker=()=>{
  mutation?.disconnect();mutation=null;
  if(!currentMarker)return;
  mutation=new MutationObserver(refresh);
  mutation.observe(currentMarker,{attributes:true,attributeFilter:['style','hidden']});
 };
 const onResize=()=>refresh();
 const onScroll=()=>refresh();
 const resize=typeof ResizeObserver!=='undefined'?new ResizeObserver(refresh):null;
 resize?.observe(viewport);
 window.addEventListener('resize',onResize);
 window.addEventListener('scroll',onScroll,true);
 observeMarker();refresh();
 const land=()=>{
  if(landed||stopped)return;
  landed=true;onLand();
 };
 let timer=null;
 const finish=()=>{
  if(stopped)return;
  if(!landed)land();
  stopped=true;
  clearTimeout(timer);
  resize?.disconnect();mutation?.disconnect();
  window.removeEventListener('resize',onResize);
  window.removeEventListener('scroll',onScroll,true);
  root.remove();onDone();
 };
 const onFlightEnd=event=>{if(event.target===flight&&event.animationName==='bq-map-dagger-flight')land();};
 const onActorEnd=event=>{if(event.target===body&&event.animationName==='bq-map-thrower-pose')finish();};
 flight.addEventListener('animationend',onFlightEnd);
 body.addEventListener('animationend',onActorEnd);
 timer=setTimeout(finish,MAP_THROW_MS+800);
 return {
  get landed(){return landed},
  rebind(newViewport,newMarker){
   if(stopped||!newViewport||!newMarker)return;
   if(newViewport!==currentViewport){resize?.unobserve(currentViewport);resize?.observe(newViewport);currentViewport=newViewport}
   currentMarker=newMarker;observeMarker();refresh();
  },
  cancel(){if(stopped)return;stopped=true;clearTimeout(timer);resize?.disconnect();mutation?.disconnect();
   window.removeEventListener('resize',onResize);window.removeEventListener('scroll',onScroll,true);root.remove();},
  get element(){return root}
 };
}
