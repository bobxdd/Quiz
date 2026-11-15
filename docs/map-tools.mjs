/** World-map quiz positions. Coordinates are percentages in equirectangular projection. */
export function normalizePoint(point){
 if(!point||typeof point!=='object'||!Number.isFinite(Number(point.x))||!Number.isFinite(Number(point.y)))return null;
 const x=Number(point.x),y=Number(point.y);
 if(x<0||x>100||y<0||y>100)return null;
 return {x:Math.round(x*10)/10,y:Math.round(y*10)/10};
}
export function encodePoint(point){const p=normalizePoint(point);if(!p)throw Error('Ungültiger Kartenpunkt.');return `@map:${p.x},${p.y}`;}
export function decodePoint(text){const match=/^@map:(\d+(?:\.\d)?),(\d+(?:\.\d)?)$/.exec(String(text||''));return match?normalizePoint({x:Number(match[1]),y:Number(match[2])}):null;}
export function worldLatLon(point){const p=normalizePoint(point);return p?{lat:90-1.8*p.y,lon:3.6*p.x-180}:null;}
