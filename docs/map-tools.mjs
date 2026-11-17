/** Shared equirectangular world-map math: 0..100 across both axes.
 * Keep original positions in world space; zooming never alters stored answers.
 */
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const clamp=(v,low,high)=>Math.min(high,Math.max(low,v));
export function normalizePoint(point){
 if(!point||typeof point!=='object'||!finite(point.x)||!finite(point.y))return null;
 const x=Number(point.x),y=Number(point.y);
 if(x<0||x>100||y<0||y>100)return null;
 return {x:Math.round(x*1000)/1000,y:Math.round(y*1000)/1000};
}
export function encodePoint(point){const p=normalizePoint(point);if(!p)throw Error('Ungültiger Kartenpunkt.');return `@map:${p.x},${p.y}`;}
export function decodePoint(text){const match=/^@map:(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(String(text||''));return match?normalizePoint({x:Number(match[1]),y:Number(match[2])}):null;}
export function worldLatLon(point){const p=normalizePoint(point);return p?{lat:90-1.8*p.y,lon:3.6*p.x-180}:null;}
export const DEFAULT_MAP_VIEW=Object.freeze({zoom:1,x:50,y:50});
export function normalizeMapView(raw=DEFAULT_MAP_VIEW){
 const zoom=clamp(finite(raw?.zoom)?Number(raw.zoom):1,1,16);
 const edge=50/zoom;
 return {zoom:Math.round(zoom*10000)/10000,x:clamp(finite(raw?.x)?Number(raw.x):50,edge,100-edge),y:clamp(finite(raw?.y)?Number(raw.y):50,edge,100-edge)};
}
/** Percent of the interactive viewport, not pixels of the zoomed image. */
export function mapScreenPosition(point,view=DEFAULT_MAP_VIEW){
 const p=normalizePoint(point);if(!p)return null;const v=normalizeMapView(view);
 return {x:50+(p.x-v.x)*v.zoom,y:50+(p.y-v.y)*v.zoom};
}
export function mapWorldPosition(screenPercent,view=DEFAULT_MAP_VIEW){
 if(!screenPercent||!finite(screenPercent.x)||!finite(screenPercent.y))return null;
 const v=normalizeMapView(view);
 return normalizePoint({x:v.x+(Number(screenPercent.x)-50)/v.zoom,y:v.y+(Number(screenPercent.y)-50)/v.zoom});
}
export function mapZoomAt(view,newZoom,screenPercent={x:50,y:50}){
 const v=normalizeMapView(view);
 const focus=mapWorldPosition(screenPercent,v);
 if(!focus)return v;
 const z=clamp(Number(newZoom)||v.zoom,1,16);
 return normalizeMapView({zoom:z,x:focus.x-(screenPercent.x-50)/z,y:focus.y-(screenPercent.y-50)/z});
}
export function mapPanBy(view,dxPercent,dyPercent){
 const v=normalizeMapView(view);
 return normalizeMapView({zoom:v.zoom,x:v.x-Number(dxPercent)/v.zoom,y:v.y-Number(dyPercent)/v.zoom});
}
export function mapViewCss(view){
 const v=normalizeMapView(view);
 return {left:50-v.x*v.zoom,top:50-v.y*v.zoom,width:100*v.zoom,height:100*v.zoom};
}


/** Spherical great-circle distance in km, independent of zoom or projection.
 * Atlas coordinates x/y span longitude -180..180, latitude +90..-90.
 * Mean Earth radius: 6371 km. This is approximate air-line distance.
 */
export function mapDistanceKm(from,to){
 const a=worldLatLon(from),b=worldLatLon(to);
 if(!a||!b)return null;
 const rad=Math.PI/180,lat1=a.lat*rad,lat2=b.lat*rad;
 const dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
 const hav=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
 return 2*6371*Math.asin(Math.sqrt(clamp(hav,0,1)));
}
export function formatMapDistanceKm(km){
 if(typeof km!=='number'||!Number.isFinite(km)||km<0)return '';
 return new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(km)+' km';
}
/** Only published, valid map pins can contribute to public distance rows.
 * Distances are informational: winner and scoring stay entirely with the host.
 */
export function mapAnswerDistances(review,target){
 if(!normalizePoint(target))return [];
 const rows=[];
 for(const [id,entry] of Object.entries(review?.entries||{})){
  if(!entry?.revealed)continue;
  const point=decodePoint(entry.value);
  if(!point)continue;
  const distanceKm=mapDistanceKm(point,target);
  if(distanceKm!==null)rows.push({id,name:String(entry.name||'Spieler').slice(0,28),point,distanceKm});
 }
 return rows.sort((a,b)=>a.distanceKm-b.distanceKm||a.name.localeCompare(b.name,'de')||a.id.localeCompare(b.id));
}
