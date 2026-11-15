/** BrainQuiz Studio 1.3 -- dependency-free, deterministic content-block schema and safe renderer.
 * Never render untrusted HTML. Image data is MIME-checked; custom colors are hex-validated.
 */
export const BLOCK_TYPES = Object.freeze({heading:'Überschrift',text:'Text',image:'Bild',callout:'Infokarte',shape:'Grafik / Form',divider:'Trennlinie',spacer:'Abstand'});
export const BLOCK_PALETTE = Object.freeze({slate:'#b8c9ce',mint:'#a8d7c7',violet:'#c4b5df',gold:'#d6c392',rose:'#dfb1b8',white:'#eff2f3'});
const escape = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap=(x,max)=>String(x??'').slice(0,max);
const yes=x=>x===true;
const clamp=(x,min,max,base)=>{const n=Number(x);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):base};
const image=data=>typeof data==='string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data) && data.length<=220000 ? data : '';
export const blockId=()=> 'b'+Array.from(crypto.getRandomValues(new Uint8Array(9)),n=>n.toString(16).padStart(2,'0')).join('');
export const newBlock=type=>normalizeBlock({type,id:blockId(),text:({heading:'Neue Überschrift',text:'Neuer Text',callout:'Wichtiger Hinweis',shape:'',image:'',divider:'',spacer:''})[type]||''});
export function normalizeBlock(b){
 const data=b&&typeof b==='object'?b:{};const type=Object.hasOwn(BLOCK_TYPES,data.type)?data.type:'text';
 const rawId=cap(data.id||'',60).replace(/[^a-zA-Z0-9_-]/g,'');
 return {id:rawId||blockId(),type,text:cap(data.text,1100),image:image(data.image),alt:cap(data.alt,160),caption:cap(data.caption,160),width:[33,50,100].includes(Number(data.width))?Number(data.width):100,
 align:['left','center','right'].includes(data.align)?data.align:'left',color: Object.hasOwn(BLOCK_PALETTE,data.color)?data.color:'white',
 size:Math.round(clamp(data.size,12,48,type==='heading'?30:17)),height:Math.round(clamp(data.height,12,190,60)),shape:['rectangle','pill','circle','line'].includes(data.shape)?data.shape:'rectangle',
 revealOnly:yes(data.revealOnly)};
}
export function normalizeBlocks(raw){if(!Array.isArray(raw))return [];const seen=new Set();return raw.slice(0,18).map(x=>{const b=normalizeBlock(x);if(seen.has(b.id))b.id=blockId();seen.add(b.id);return b;});}
export function publicBlocks(raw,revealed=false){return normalizeBlocks(raw).filter(b=>revealed||!b.revealOnly);}
export function validateBlocks(raw){const blocks=normalizeBlocks(raw),total=blocks.reduce((sum,b)=>sum+b.image.length,0);if(total>780000)return 'Medien in den Layout-Blöcken sind zu groß (max. rund 780 KB je Frage).';
 if(blocks.some(b=>b.type==='image'&&!b.image))return 'Mindestens ein Bildblock hat noch kein Bild.';
 return '';
}
// The host canvas and published participants share this one renderer; no style or HTML injection.
export function renderBlocks(raw,{reveal=false,editable=false,selectedId=''}={}){
 const blocks=editable?normalizeBlocks(raw):publicBlocks(raw,reveal);
 if(!blocks.length)return '';
 return `<div class="bq-block-layout${editable?' editing':''}" aria-label="Freies Fragenlayout">${blocks.map(block=>{
  const b=normalizeBlock(block),color=BLOCK_PALETTE[b.color];
  const css=`--block-color:${color};--block-font:${b.size}px;--block-height:${b.height}px;`;
  const wrapper=`class="bq-block width-${b.width} align-${b.align} ${editable?'bq-selectable':''} ${editable&&selectedId===b.id?'selected':''}" style="${css}" ${editable?`data-action="select-block" data-block-id="${escape(b.id)}" tabindex="0" role="button" aria-label="${escape(BLOCK_TYPES[b.type])} bearbeiten"`:''}`;
  let body='';
  switch(b.type){
   case 'heading':body=`<h3 class="bq-heading">${escape(b.text)}</h3>`;break;
   case 'text':body=`<div class="bq-bodytext">${escape(b.text)}</div>`;break;
   case 'callout':body=`<div class="bq-callout">${escape(b.text)}</div>`;break;
   case 'image':body=b.image?`<figure class="bq-figure"><img src="${b.image}" alt="${escape(b.alt)}" loading="lazy"><figcaption>${escape(b.caption)}</figcaption></figure>`:'<div class="bq-placeholder">Bild auswählen</div>';break;
   case 'shape':body=`<div class="bq-shape ${b.shape}" aria-label="Dekorative Grafik"><span>${escape(b.text)}</span></div>`;break;
   case 'divider':body='<hr class="bq-divider">';break;
   case 'spacer':body='<div class="bq-spacer" aria-hidden="true"></div>';break;
  }
  const privacy=editable&&b.revealOnly?'<span class="bq-privacy-tag">Erst bei Auflösung</span>':'';
  return `<div ${wrapper}>${body}${privacy}</div>`;
 }).join('')}</div>`;
}
