/* Independent question-answer view. The host alone may create the revealed
 * publicQuestion; this renderer must not be used to prepare unrevealed payloads.
 * It is also reused in the editor so the final screen matches the preview.
 */
const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const imageOK=s=>typeof s==='string'&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s)&&s.length<900000;
const hasWords=s=>typeof s==='string'&&s.trim().length>0;
export function answerViewContent(q={}){
 const type=q.type||'text';
 let text=hasWords(q.answerText)?q.answerText.trim():hasWords(q.answer)?q.answer.trim():'';
 if(!text){
  if(type==='multiple')text=String(q.options?.[q.correct]||'').trim();
  else if(type==='order')text=(q.orderItems||[]).map((v,i)=>(i+1)+'. '+v).join('  →  ');
  else if(type==='estimate'&&Number.isFinite(Number(q.estimateTarget)))text=String(q.estimateTarget)+(q.estimateUnit?' '+q.estimateUnit:'');
  else if(type==='imposter'&&q.correctIcon)text='Ersetztes Bild '+(Number(q.imposterIndex||0)+1)+' · '+(q.abilityNames?.[q.imposterIndex]||'Originalsymbol');
 }
 const image=imageOK(q.answerImage)?q.answerImage:
   type==='imposter'&&imageOK(q.correctIcon)?q.correctIcon:
   type==='splash'&&imageOK(q.image)?q.image:'';
 return {text,image,alt:hasWords(q.answerImageAlt)?q.answerImageAlt.slice(0,140):'Bild zur richtigen Antwort',
   explanation:hasWords(q.explanation)?q.explanation.trim():''};
}
export function hasRequiredAnswer(q={}){
 const content=answerViewContent(q);
 if(q.type==='team-emoji')return !!content.text;
 return !!(content.text||content.image||(q.type==='map'&&q.mapTargetSet===true));
}
export function renderAnswerView(q,{preview=false}={}){
 const {text,image,alt,explanation}=answerViewContent(q);
 const mapOnly=!text&&!image&&q.type==='map'&&q.mapTargetSet;
 const fallback=mapOnly?'Der richtige Ort ist auf der Karte mit dem Dolch markiert.':
  !text&&!image?'Noch keine Antwort hinterlegt.':'';
 return '<section class="bq-answer-view'+(preview?' bq-answer-editor-preview':'')+'" aria-label="Antwortansicht" tabindex="0">'
  +'<div class="bq-answer-view-top"><span class="bq-answer-overline">AUFLÖSUNG</span><strong>Richtige Antwort</strong></div>'
  +'<div class="bq-answer-view-content'+(image?' has-image':'')+'">'
  +(image?'<div class="bq-answer-image"><img src="'+image+'" alt="'+html(alt)+'" loading="eager" draggable="false"></div>':'')
  +(text||fallback?'<div class="answer bq-answer-primary">'+html(text||fallback).replace(/\n/g,'<br>')+'</div>':'')
  +'</div>'
  +(explanation?'<p class="bq-answer-explanation">'+html(explanation).replace(/\n/g,'<br>')+'</p>':'')
  +'</section>';
}
