/* BrainQuiz 1.6: standalone question canvas schema. No HTML accepted, no secret answer sent before reveal. */
import {mapMarkup} from './map-viewport.mjs';
export const SCENE_WIDTH=1000,SCENE_HEIGHT=560;
export const TEMPLATE_NAMES={text:'Freitext',multiple:'A / B / C / D',order:'Reihenfolge',hints:'Hinweise aufdecken',image:'Bildfrage',imposter:'Bild-Imposter (auch Abilities)',quote:'Zitat',emoji:'Emoji','team-emoji':'Emoji-Teamrunde','team-draw':'Champion zeichnen',estimate:'Schätzfrage',audio:'Audio',map:'Karte / Ort auswählen'};
const TYPES=new Set(['text','image','shape','choice','order']);
const COLORS=new Set(['#ffffff','#d4d6e2','#adb0c5','#9c8cff','#ff95a7','#75d7b6','#20212d','#343644']);
const safeHexColor=(value,fallback)=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():fallback;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap=(v,n=1000)=>String(v??'').slice(0,n);
const num=(v,a,b,def)=>Number.isFinite(Number(v))?Math.min(b,Math.max(a,Number(v))):def;
const safeImage=(s,limit=450000)=>typeof s==='string'&&/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(s)&&s.length<limit?s:'';
export const elemId=()=>`el${Math.random().toString(36).slice(2,11)}`;
export function element(kind='text',overrides={}){
 return normalizeElement({id:elemId(),kind,x:85,y:95,w:430,h:95,text:kind==='image'?'':kind==='shape'?'':'Text',font:32,step:0,fill:'#ffffff',bg:'#252c30',align:'left',shape:'rect',letter:'',src:'',role:'content',...overrides});
}
export function normalizeElement(raw={}){
 raw=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 const kind=TYPES.has(raw.kind)?raw.kind:'text',w=num(raw.w,50,1000,420),h=num(raw.h,30,560,90);
 return {id:cap(raw.id||elemId(),45).replace(/[^\w-]/g,'')||elemId(),kind,x:num(raw.x,0,1000-w,40),y:num(raw.y,0,560-h,40),w,h,
  text:cap(raw.text,950),font:num(raw.font,13,78,30),step:Math.round(num(raw.step,0,6,0)),fill:safeHexColor(raw.fill,'#ffffff'),bg:safeHexColor(raw.bg,'#20212d'),align:['left','center','right'].includes(raw.align)?raw.align:'left',shape:['rect','pill','circle','line'].includes(raw.shape)?raw.shape:'rect',letter:cap(raw.letter,3).replace(/[^A-J]/g,''),role:['question','clue'].includes(raw.role)?raw.role:'content',src:safeImage(raw.src),alt:cap(raw.alt,100)};
}
export function normalizeScene(raw){if(!raw||typeof raw!=='object')return null;
 const taken=new Set(),els=(Array.isArray(raw.elements)?raw.elements:[]).filter(v=>v&&typeof v==='object'&&!Array.isArray(v)).slice(0,40).map(v=>{const el=normalizeElement(v);if(taken.has(el.id))el.id=elemId();taken.add(el.id);return el;});
 // Older quiz files have no explicit question role: migrate the topmost visible text element.
 if(!els.some(el=>el.kind==='text'&&el.role==='question')){const first=els.filter(el=>el.kind==='text'&&el.step===0).sort((a,b)=>a.y-b.y)[0];if(first)first.role='question';}
 const template=Object.hasOwn(TEMPLATE_NAMES,raw.template)?raw.template:'text';
 const letters=(Array.isArray(raw.sortCorrect)?raw.sortCorrect:[]).filter(x=>/^[A-J]$/.test(x)).slice(0,10);
 return {version:2,template,elements:els,sortCorrect:letters};
}
const question=(text='Frage eingeben')=>element('text',{role:'question',x:58,y:34,w:884,h:106,font:38,text,align:'center',bg:'#252c30'});
export function templateScene(name='text',q={}){
 const template=Object.hasOwn(TEMPLATE_NAMES,name)?name:'text';
 const prompt=template==='team-draw'?'Welchen Champion zeichnet dein Team?':template==='team-emoji'?'Welchen Champion oder Begriff beschreibt dein Team?':q.prompt||'Frage eingeben';
 const elements=[question(prompt)];
 const options=(q.options||[]).filter(Boolean);
 if(template==='multiple')elements.push(...'ABCD'.split('').map((letter,i)=>element('choice',{letter,x:80+(i%2)*430,y:200+Math.floor(i/2)*138,w:400,h:111,text:options[i]||`Antwort ${letter}`,font:25,bg:'#363e43'})));
 if(template==='order')elements.push(...'ABCDEFG'.split('').map((letter,i)=>element('order',{letter,x:70+(i%2)*450,y:155+Math.floor(i/2)*80,w:416,h:70,text:q.orderDisplayItems?.[i]||q.orderItems?.[i]||`Eintrag ${letter}`,font:21,bg:'#363e43'})));
 if(template==='hints')elements.push(...[1,2,3,4].map((n,i)=>element('text',{x:90+(i%2)*420,y:180+Math.floor(i/2)*143,w:395,h:112,text:`Hinweis ${n}`,step:n,bg:'#363e43'}))); 
 if(template==='image')elements.push(element('image',{x:140,y:164,w:720,h:340,alt:'Bild hinzufügen'}));
 if(template==='imposter'){
  const icons=Array.isArray(q.icons)&&q.icons.some(Boolean)?q.icons.slice(0,8):['','','',''];
  const labels=icons.length===4?['Q','W','E','R']:['Passiv','Q','W','E','R'];
  const slotWidth=920/icons.length;
  elements.push(...icons.map((src,i)=>element('image',{letter:'ABCDEFGH'[i],x:40+i*slotWidth,y:185,w:slotWidth-16,h:210,
   src,alt:src&&q.abilityNames?.[i]||labels[i]||`Bild ${i+1}`})));
 }
 if(template==='quote')elements.push(element('text',{role:'clue',x:110,y:192,w:780,h:165,font:32,text:q.clue||'Zitat eingeben',align:'center',bg:'#363e43'}));
 if(template==='emoji')elements.push(element('text',{role:'clue',x:130,y:195,w:740,h:165,font:65,text:q.clue||'🦊 🔥 ✨',align:'center',bg:'#363e43'}));
 if(template==='estimate')elements.push(element('text',{x:180,y:230,w:640,h:120,font:28,text:'Wert schätzen',align:'center'}));
 if(template==='audio')elements.push(element('text',{x:180,y:230,w:640,h:120,font:28,text:'Audioquiz',align:'center'}));
 return normalizeScene({template,elements,sortCorrect:'ABCDEFG'.split('')});
}
export function ensureScene(q){if(!q.scene)q.scene=templateScene(q.type==='splash'?'image':q.type,q);return q.scene;}
export function reconcileQuestion(q){const scene=normalizeScene(q.scene);if(!scene)return q;q.scene=scene;
 if(['team-emoji','team-draw'].includes(scene.template)){q.type=scene.template;q.roundMode=scene.template;return q;}
 const heading=scene.elements.find(x=>x.kind==='text'&&x.role==='question')||scene.elements.find(x=>x.kind==='text'&&x.step===0);
 if(heading)q.prompt=heading.text;
 if(scene.template==='multiple'){
  q.type='multiple';const choices=scene.elements.filter(x=>x.kind==='choice').slice(0,4);
  q.options='ABCD'.split('').map(letter=>choices.find(el=>el.letter===letter)?.text||'');
  q.correct=Math.max(0,Math.min(3,num(q.correct,0,3,0)));q.answer=q.options[q.correct]||'';
 }else if(scene.template==='order'){
  q.type='order';const entries=scene.elements.filter(x=>x.kind==='order').slice(0,10);
  const byLetter=new Map(entries.map(el=>[el.letter,el.text]));q.orderDisplayItems=entries.slice().sort((a,b)=>a.letter.localeCompare(b.letter)).map(el=>el.text);
  const order=scene.sortCorrect.filter(letter=>byLetter.has(letter));q.orderItems=order.map(letter=>byLetter.get(letter));
 }else if(scene.template==='imposter'){q.type='imposter';const images=scene.elements.filter(el=>el.kind==='image').slice(0,8);q.icons=images.map(el=>el.src||'');q.abilityNames=images.map((el,i)=>el.alt||['Passiv','Q','W','E','R'][i]||`Bild ${i+1}`);}else if(scene.template==='quote'||scene.template==='emoji'){q.type=scene.template;const clue=scene.elements.find(x=>x.kind==='text'&&x.role==='clue')||scene.elements.find(x=>x.kind==='text'&&x.role!=='question');q.clue=clue?.text||'';}else if(scene.template==='estimate'){q.type='estimate';}else if(scene.template==='audio'){q.type='audio';}else if(scene.template==='map'){q.type='map';q.roundMode='written';}else if(scene.template==='image'){q.type='text';}else q.type='text';
 return q;
}
export function publicScene(raw,step=0,showAnswers=false){const scene=normalizeScene(raw);if(!scene)return null;
 return {version:2,template:scene.template,elements:scene.elements.filter(el=>showAnswers||el.step<=step).map(el=>({...el})),step:showAnswers?6:num(step,0,5,0),...(showAnswers?{sortCorrect:scene.sortCorrect}: {})};
}
export function imposterPublicScene(scene,index,replacement,step=0){
 const view=publicScene(scene,step);
 const src=safeImage(replacement,900000);
 if(src&&view){
  const slot=scene.elements.filter(element=>element.kind==='image')[index];
  const visible=view.elements.find(element=>element.id===slot?.id);
  if(visible)visible.src=src;
 }
 return view;
}
export function sceneHasStep(q,currentStep=0){return !!q?.scene?.elements?.some(x=>x.step>currentStep&&x.step<6);}
export function renderScene(scene,{editing=false,selected='',revealed=false,interactive=false,canAnswer=false,picked=[],correctIndex=0,mapCanPick=false,mapCanEdit=false,mapPin=null,mapEditorPoint=null,mapSolution=null,mapPublicPins=[],mapView=null,mapPrompt=''}={}){
 if(!scene)return '';
 if(scene.template==='map'){
  const heading=scene.elements.find(el=>el.kind==='text'&&el.role==='question')||scene.elements.find(el=>el.kind==='text'&&el.step===0);
  const text=heading?.text||mapPrompt||'Frage eingeben';
  return `<div class="se-scene bq-map-scene ${editing?'se-editing':''}" aria-label="Kartenfrage">${mapMarkup({prompt:text,view:mapView,point:editing?mapEditorPoint:mapPin,solution:mapSolution,otherPins:mapPublicPins,editable:!!(mapCanPick||mapCanEdit),editor:editing,visibleSolution:revealed})}</div>`;
 }
 const content=scene.elements.map(el=>{
  const style=`left:${el.x/10}%;top:${el.y/5.6}%;width:${el.w/10}%;height:${el.h/5.6}%;font-size:clamp(10px,${el.font/1000*100}cqw,${el.font}px);color:${el.fill};background:${el.kind==='image'||el.shape==='line'?'transparent':el.bg};text-align:${el.align};`;
  const n=el.kind==='choice'?Math.max(0,'ABCD'.indexOf(el.letter)):0;
  const correct=revealed&&el.kind==='choice'&&(n===correctIndex);
  const wrong=revealed&&el.kind==='choice'&&!correct;
  const imposter=revealed&&scene.template==='imposter'&&el.kind==='image'&&scene.elements.filter(x=>x.kind==='image').indexOf(el)===correctIndex;
  const count=el.kind==='order'?'ABCDEFGH IJ'.replace(/\s/g,'').indexOf(el.letter):-1;
  const attrs=editing?`data-se-element="${escape(el.id)}" tabindex="0" role="button" aria-label="Element ${escape(el.kind)} bearbeiten"`:(interactive&&canAnswer&&el.kind==='choice'?`data-action="select-choice" data-choice="${escape(el.letter)}" tabindex="0" role="button"`:(interactive&&canAnswer&&el.kind==='order'?`data-action="pick-order" data-index="${count}" tabindex="0" role="button"`:''));
  const img=el.kind==='image'?(el.src?`<img src="${el.src}" draggable="false" alt="${escape(el.alt)}">`:'<div class="se-empty-image">Bild hochladen</div>'):'',label=el.letter&&['choice','order'].includes(el.kind)?`<span class="se-letter">${escape(el.letter)}</span>`:'';
  const body=el.kind==='shape'?`<div class="se-shape ${escape(el.shape)}">${escape(el.text)}</div>`:img||`${label}<span class="se-content">${escape(el.text).replace(/\n/g,'<br>')}</span>${el.kind==='order'&&picked.includes(count)?`<strong class="se-order-rank">${picked.indexOf(count)+1}.</strong>`:''}`;
  return `<div class="se-element ${editing?'is-editable':''} ${selected===el.id?'is-selected':''} se-kind-${el.kind} ${correct?'se-correct':''} ${wrong?'se-wrong':''} ${imposter?'se-imposter-image':''} ${picked.includes(count)&&el.kind==='order'?'se-picked':''}" style="${style}" ${attrs}>${body}${imposter?'<span class="se-imposter-label">AUSGETAUSCHT</span>':''}${editing?`<span class="se-reveal-mark">${el.step===0?'Start':el.step===6?'Lösung':'Tipp '+el.step}</span><span class="se-resize" data-se-resize="${escape(el.id)}" title="Größe ändern"></span>`:''}</div>`;
 }).join('');
 return `<div class="se-scene ${editing?'se-editing':''}" ${editing?'tabindex="0"':''} style="--scene-w:${SCENE_WIDTH}" aria-label="Fragenfläche">${content}</div>`;
}
export function validateScene(q){const scene=normalizeScene(q?.scene);if(!scene)return '';
 if(!scene.elements.length)return 'Mindestens ein Element hinzufügen.';
 if(scene.elements.reduce((sum,el)=>sum+(el.src?.length||0),0)>1200000)return 'Bitte weniger oder kleinere Bilder verwenden (maximal 1,2 MB je Frage).';
 if(scene.template==='multiple'){const choices=scene.elements.filter(el=>el.kind==='choice');if(choices.length!==4||choices.some(el=>!el.text.trim()))return 'Vier ausgefüllte Antworten (A bis D) erforderlich.';}
 if(scene.template==='order'){const rows=scene.elements.filter(el=>el.kind==='order');const ids=rows.map(el=>el.letter);if(rows.length<3||rows.length>10||new Set(ids).size!==ids.length||rows.some(el=>!el.text.trim())||scene.sortCorrect.length!==rows.length||new Set(scene.sortCorrect).size!==rows.length||scene.sortCorrect.some(k=>!ids.includes(k)))return 'Sortieroptionen und Musterreihenfolge stimmen nicht überein.';}
 if(scene.elements.some(el=>el.kind==='image'&&!el.src&&scene.template==='image'))return 'Bild noch nicht ausgewählt.';
 return '';
}
export {escape};
