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
