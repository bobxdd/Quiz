import {collectCategories} from './category-model.mjs';
import {normalizeBlocks,publicBlocks,validateBlocks} from './layout.mjs';
import {normalizeScene,publicScene,reconcileQuestion,validateScene} from './studio-model.mjs';
import {hasRequiredAnswer} from './answer-view.mjs';
// Pure, dependency-free, testable game domain functions.
export const VERSION='3.6.0';
export const MODES={text:'Freitext',multiple:'Multiple Choice',splash:'Splash-Art-Zoom',imposter:'Ability-Imposter',order:'Sortieren / Chronologie',estimate:'Schätzfrage',quote:'Champion-Zitat',emoji:'Emoji-Rätsel',audio:'Audio- / Login-Sound',map:'Kartenpunkt wählen'};
export const ABILITIES=['Passiv','Q','W','E','R'];
export const TEAM_COLORS=['#79a8af','#b2a5dc','#b7ad83','#b79ab1','#8aa7a0','#b9a090'];
export function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function roomCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return Array.from(bytes,n=>alphabet[n%alphabet.length]).join('');}
export function uid(){const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return 'q'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
export function safeId(value){return String(value||uid()).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||uid();}
export function isImageData(value){return typeof value==='string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length<900000;}
export function isAudioData(value){return typeof value==='string' && /^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length<600000;}
export function emptyQuiz(){return {version:1,scoreMode:'team',title:'Meine Quiznacht',description:'',teams:['Team 1','Team 2'],manualPlayers:[],categories:[],questions:[]};}
export function normalizedQuiz(source){
 const obj=source&&typeof source==='object'?source:{};
 const names=Array.isArray(obj.teams)?obj.teams.map(x=>String(x??'').trim().slice(0,35)).filter(Boolean).slice(0,6):[];
 const seen=new Set();
 const questions=(Array.isArray(obj.questions)?obj.questions:[]).slice(0,180).map((raw)=>{
 const q=raw&&typeof raw==='object'?raw:{};let id=safeId(q.id);if(seen.has(id))id=uid();seen.add(id);
 return {id,roundMode:q.roundMode==='written'?'written':'buzzer',category:String(q.category||'Allgemein').slice(0,70),title:String(q.title||'Frage').slice(0,100),type:MODES[q.type]?q.type:'text',points:Math.max(0,Math.min(10000,Number(q.points)||100)),prompt:String(q.prompt||'').slice(0,2000),answer:String(q.answer||'').slice(0,2000),answerText:String(q.answerText||'').slice(0,2000),answerImage:isImageData(q.answerImage)?q.answerImage:'',answerImageAlt:String(q.answerImageAlt||'').slice(0,140),explanation:String(q.explanation||'').slice(0,2000),options:Array.from({length:4},(_,i)=>String(q.options?.[i]||'').slice(0,500)),correct:Math.max(0,Math.min(3,Number(q.correct)||0)),image:isImageData(q.image)?q.image:'',cropX:Math.max(0,Math.min(100,Number(q.cropX??50))),cropY:Math.max(0,Math.min(100,Number(q.cropY??50))),zoom:Math.max(1,Math.min(9,Number(q.zoom??3))),abilityNames:Array.from({length:Math.max(5,Math.min(8,q.scene?.elements?.filter?.(e=>e.kind==='image').length||q.icons?.length||5))},(_,i)=>String(q.abilityNames?.[i]||ABILITIES[i]||`Bild ${i+1}`).slice(0,30)),icons:Array.from({length:Math.max(5,Math.min(8,q.scene?.elements?.filter?.(e=>e.kind==='image').length||q.icons?.length||5))},(_,i)=>isImageData(q.icons?.[i])?q.icons[i]:''),imposterIndex:Math.max(0,Math.min(7,Number(q.imposterIndex)||0)),mapTargetX:Math.max(0,Math.min(100,Number(q.mapTargetX??50)||0)),mapTargetY:Math.max(0,Math.min(100,Number(q.mapTargetY??50)||0)),mapTargetSet:q.mapTargetSet===true,correctIcon:isImageData(q.correctIcon)?q.correctIcon:'',orderItems:(Array.isArray(q.orderItems)?q.orderItems:[]).slice(0,10).map(x=>String(x??'').trim().slice(0,120)),clue:String(q.clue||'').slice(0,1200),estimateTarget:Number.isFinite(Number(q.estimateTarget))?Number(q.estimateTarget):0,estimateUnit:String(q.estimateUnit||'').slice(0,40),seconds:Math.max(0,Math.min(600,Number(q.seconds)||0)),hints:(Array.isArray(q.hints)?q.hints:[]).slice(0,4).map(x=>String(x||'').slice(0,220)),audio:isAudioData(q.audio)?q.audio:'',audioStart:Math.max(0,Math.min(3600,Number(q.audioStart)||0)),audioDuration:Math.max(1,Math.min(12,Number(q.audioDuration)||8)),blocks:normalizeBlocks(q.blocks),scene:normalizeScene(q.scene),orderDisplayItems:(Array.isArray(q.orderDisplayItems)?q.orderDisplayItems:[]).slice(0,10).map(x=>String(x??'').trim().slice(0,120))};
 });
 return {version:1,scoreMode:obj.scoreMode==='individual'?'individual':'team',title:String(obj.title||'Meine Quiznacht').slice(0,100),description:String(obj.description||'').slice(0,400),teams:names.length?names:['Team 1','Team 2'],manualPlayers:(Array.isArray(obj.manualPlayers)?obj.manualPlayers:[]).slice(0,24).map(x=>String(x||'').trim().slice(0,28)).filter(Boolean),categories:collectCategories(obj.categories,questions),questions};
}
export function buildPublicBoard(quiz,used={}){return Object.fromEntries(quiz.questions.map(q=>[q.id,{id:q.id,category:q.category,type:q.type,points:q.points,used:!!used[q.id]}]));}
export function buildTeams(quiz){return Object.fromEntries(quiz.teams.map((name,i)=>['t'+(i+1),name]));}
export function buildScores(quiz){return Object.fromEntries(quiz.teams.map((_,i)=>['t'+(i+1),0]));}
// Never copy/extend the original object: it contains secret answers and full imagery.
// A private question is never embedded in the public room. The `visual` argument
// must be a freshly rendered crop (splash) or a newly shuffled list (order).
export function publicQuestion(q,reveal=false,visual='',releasedHints=0,sceneStep=0){
 const pub={id:q.id,category:q.category,type:q.type,roundMode:q.roundMode==='written'?'written':'buzzer',points:q.points,prompt:q.scene?'':q.prompt,blocks:q.scene?[]:publicBlocks(q.blocks,reveal)};
 if(q.scene)pub.scene=publicScene(q.scene,reveal?6:sceneStep,reveal);
 if(q.type==='multiple')pub.options=q.scene&&!reveal?'ABCD'.split('').map(letter=>q.scene.elements.some(el=>el.kind==='choice'&&el.letter===letter&&el.step<=sceneStep)?q.options['ABCD'.indexOf(letter)]:''):q.options.slice(0,4);
 if(q.type==='splash')pub.image=typeof visual==='string'?visual:'';
 if(q.type==='imposter'){const images=q.scene?.elements.filter(el=>el.kind==='image')||[];pub.icons=q.icons.slice(0,8).map((icon,i)=>q.scene&&!reveal&&images[i]?.step>sceneStep?'':icon);pub.abilityNames=q.abilityNames.slice(0,8);}
 if(q.type==='order'){pub.displayItems=Array.isArray(visual)?visual.slice(0,10).map((x,i)=>q.scene&&!reveal&&!q.scene.elements.some(el=>el.kind==='order'&&el.letter==='ABCDEFGHIJ'[i]&&el.step<=sceneStep)?'':x):[];}
 if(q.type==='quote'||q.type==='emoji')pub.clue=q.scene&&!reveal?'':q.clue||'';
 if(q.type==='estimate')pub.estimateUnit=q.estimateUnit||'';
 if(q.type==='audio')pub.audio=q.audio||'';
 pub.hints=(q.hints||[]).slice(0,Math.max(0,Math.min(4,releasedHints))).filter(Boolean);
 pub.hintStep=Math.max(0,Math.min(4,releasedHints));
 if(reveal){
  pub.answer=q.answer;pub.answerText=q.answerText||'';pub.answerImage=isImageData(q.answerImage)?q.answerImage:'';pub.answerImageAlt=q.answerImageAlt||'';pub.explanation=q.explanation||'';
  if(q.type==='multiple')pub.correct=q.correct;
  if(q.type==='imposter'){pub.imposterIndex=q.imposterIndex;pub.correctIcon=q.correctIcon;}
  if(q.type==='order')pub.orderItems=(q.orderItems||[]).slice();if(q.scene?.template==='order')pub.orderCorrect=q.scene.sortCorrect.slice();
  if(q.type==='estimate')pub.estimateTarget=q.estimateTarget;
  if(q.type==='map'&&q.mapTargetSet===true){pub.mapTargetX=q.mapTargetX;pub.mapTargetY=q.mapTargetY;}
 }
 return pub;
}
// Fisher–Yates using a cryptographically secure random source in browsers.
export function shuffledItems(items,random=(n)=>{const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);return bytes[0]%n;}){
 const copy=items.slice();for(let i=copy.length-1;i>0;i--){const j=random(i+1);[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;
}
export function splashStageZoom(base,step){const z=Math.max(1,Math.min(9,Number(base)||3));return step<=0?z:step===1?Math.max(1.4,z*.64):Math.max(1.15,z*.38);}
export function rankEstimates(list,target){const wanted=Number(target);return (Array.isArray(list)?list:[]).map(r=>({...r,value:Number(String(r.text||'').replace(',','.'))})).filter(r=>String(r.text||'').trim()!==''&&Number.isFinite(r.value)).map(r=>({...r,difference:Math.abs(r.value-wanted)})).sort((a,b)=>a.difference-b.difference||Number(a.at||0)-Number(b.at||0));}
export async function splashPreview(dataURL,{cropX=50,cropY=50,zoom=3},reveal=false){
 if(!isImageData(dataURL))return '';
 if(reveal)return dataURL;
 const bitmap=await imageFromDataURL(dataURL);const canvas=document.createElement('canvas');
 const w=bitmap.naturalWidth||bitmap.width,h=bitmap.naturalHeight||bitmap.height,ratio=Math.max(1,Math.min(9,Number(zoom)||1));
 const sw=w/ratio,sh=h/ratio;let x=Math.max(0,Math.min(w-sw,w*(Number(cropX)/100)-sw/2)),y=Math.max(0,Math.min(h-sh,h*(Number(cropY)/100)-sh/2));
 canvas.width=Math.min(1000,Math.floor(w));canvas.height=Math.max(1,Math.round(canvas.width*h/w));
 canvas.getContext('2d').drawImage(bitmap,x,y,sw,sh,0,0,canvas.width,canvas.height);
 return canvas.toDataURL('image/jpeg',0.76);
}
export function imageFromDataURL(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Bild konnte nicht gelesen werden'));img.src=url;});}
export async function optimizeImage(file,maxEdge=1250,maxBytes=350000){
 if(!['image/png','image/jpeg','image/webp'].includes(file?.type))throw Error('Bitte PNG, JPG oder WebP auswählen.');
 if(file.size>6_000_000)throw Error('Bild zu groß (max. 6 MB Quelldatei).');
 const raw=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
 const img=await imageFromDataURL(raw),c=document.createElement('canvas');let w=img.naturalWidth,h=img.naturalHeight,scale=Math.min(1,maxEdge/Math.max(w,h));
 for(let i=0;i<5;i++){c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);const out=c.toDataURL(file.type==='image/png'?'image/webp':'image/jpeg',Math.max(.48,.78-i*.07));if(out.length<maxBytes)return out;scale*=.78;}
 throw Error('Bild konnte nicht ausreichend komprimiert werden.');
}
// Decode and re-encode only the selected interval to stripped, mono PCM WAV.
// This intentionally removes tags/filenames and does not upload the original audio.
export async function optimizeAudio(file,start=0,duration=8){
 if(!file||file.size>8_000_000)throw Error('Audioquelle darf maximal 8 MB groß sein.');
 const AC=globalThis.AudioContext||globalThis.webkitAudioContext;
 if(!AC||!globalThis.OfflineAudioContext)throw Error('Dieser Browser unterstützt das Audiowerkzeug nicht.');
 const ac=new AC();let decoded;
 try{decoded=await ac.decodeAudioData(await file.arrayBuffer());}catch{throw Error('Audio konnte nicht dekodiert werden. Bitte WAV, MP3 oder OGG nutzen.');}
 finally{await ac.close().catch(()=>{});}
 start=Math.max(0,Math.min(3600,Number(start)||0));duration=Math.max(1,Math.min(12,Number(duration)||8));
 if(start>=decoded.duration)throw Error('Startzeit liegt hinter dem Ende der Datei.');
 const frames=Math.max(1,Math.floor(Math.min(duration,decoded.duration-start)*16000));
 const rendered=new OfflineAudioContext(1,frames,16000),buffer=rendered.createBuffer(1,decoded.length,decoded.sampleRate);
 const mono=buffer.getChannelData(0);for(let ch=0;ch<decoded.numberOfChannels;ch++){const samples=decoded.getChannelData(ch);for(let i=0;i<samples.length;i++)mono[i]+=samples[i]/decoded.numberOfChannels;}
 const source=rendered.createBufferSource();source.buffer=buffer;source.connect(rendered.destination);source.start(0,start,frames/16000);
 const result=await rendered.startRendering(),samples=result.getChannelData(0);
 const wav=new ArrayBuffer(44+samples.length*2),v=new DataView(wav),ascii=(at,str)=>{for(let i=0;i<str.length;i++)v.setUint8(at+i,str.charCodeAt(i));};
 ascii(0,'RIFF');v.setUint32(4,36+samples.length*2,true);ascii(8,'WAVE');ascii(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++){const f=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,Math.round(f<0?f*32768:f*32767),true);}
 let binary='';const bytes=new Uint8Array(wav);for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
 const data='data:audio/wav;base64,'+btoa(binary);if(!isAudioData(data))throw Error('Verarbeitetes Audio zu groß. Bitte einen kürzeren Ausschnitt wählen.');return data;
}
export function safeDownload(name,text){const blob=new Blob([text],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
export function validateQuestion(q){
 if(!q.prompt?.trim()&&!normalizeBlocks(q.blocks).some(b=>['heading','text','callout'].includes(b.type)&&b.text.trim()&&!b.revealOnly))return 'Fragetext oder sichtbarer Textblock fehlt';
 const blockError=q.scene?validateScene(q):validateBlocks(q.blocks);if(blockError)return blockError;
 if(q.type==='multiple'&&(!Array.isArray(q.options)||q.options.slice(0,4).length!==4||q.options.some(s=>!s.trim())))return 'Vier Antworten erforderlich';
 if(q.type==='audio'&&!q.audio)return 'Audioausschnitt fehlt';
 if(q.type==='splash'&&!q.image)return 'Bild fehlt';
 if(q.type==='map'&&(q.mapTargetSet!==true||!Number.isFinite(q.mapTargetX)||!Number.isFinite(q.mapTargetY)||q.mapTargetX<0||q.mapTargetX>100||q.mapTargetY<0||q.mapTargetY>100))return 'Auf der Weltkarte zuerst den richtigen Zielpunkt mit dem Dolch festlegen.';
 if(q.type==='splash'&&Number(q.zoom)<=1)return 'Zoomfaktor muss größer als 1 sein';
 if(q.type==='imposter'&&(!Array.isArray(q.icons)||q.icons.length<2||q.icons.length>8||q.icons.some(i=>!i)))return 'Zwei bis acht Bilder erforderlich';
 if(q.type==='imposter'&&!q.correctIcon)return 'Korrektes Ersatzsymbol fehlt';
 if(q.type==='order'&&(!Array.isArray(q.orderItems)||q.orderItems.length<3||q.orderItems.some(s=>!s.trim())))return 'Mindestens drei vollständige Sortiereinträge erforderlich';
 if(q.type==='order'&&new Set(q.orderItems.map(x=>x.trim().toLowerCase())).size!==q.orderItems.length)return 'Sortiereinträge müssen eindeutig sein';
 if(q.type==='estimate'&&!Number.isFinite(Number(q.estimateTarget)))return 'Gültigen Schätzwert angeben';
 if((q.type==='quote'||q.type==='emoji')&&!q.clue?.trim())return 'Zitat beziehungsweise Emojis fehlen';
 if(q.type==='emoji'&&!q.clue?.trim())return 'Emoji-Hinweis fehlt';
 if(!hasRequiredAnswer(q))return 'Antwort-Tab ist Pflicht: Bitte einen Antworttext oder ein Antwortbild hinterlegen.';
 return '';
}

// Board-based authoring: five standard point rows per custom category.
export const DEFAULT_CATEGORIES=['Champions','Splash Arts','Items','Fähigkeiten','Lore'];
export const STANDARD_POINTS=[100,200,300,400,500];
export function quickBoard(categories=DEFAULT_CATEGORIES,points=STANDARD_POINTS){
 const out=[];
 for(const category of categories.map(x=>String(x).trim().slice(0,70)).filter(Boolean).slice(0,10)){
  for(const value of points.slice(0,10)){
   const pointsNumber=Number(value);
   if(!Number.isFinite(pointsNumber)||pointsNumber<0||pointsNumber>10000)continue;
   out.push({id:uid(),category,title:`${category} ${pointsNumber}`,type:'text',points:pointsNumber,prompt:'',answer:'',options:['','','',''],hints:['','','',''],blocks:[]});
  }
 }
 return out;
}
export function categoryColumns(questions){
 const grouped=new Map();
 for(const q of questions||[]){if(!grouped.has(q.category))grouped.set(q.category,[]);grouped.get(q.category).push(q);}
 return [...grouped].map(([category,items])=>({category,items:[...items].sort((a,b)=>a.points-b.points||String(a.title).localeCompare(String(b.title)))}));
}
export function judgementDelta(points,result){
 const value=Number(points);if(!Number.isFinite(value)||value<0||value>10000)throw Error('Ungültiger Fragewert.');
 if(result==='correct')return value;if(result==='wrong')return -value/2;
 throw Error('Unbekannte Bewertung.');
}
export function updatePlayerScore(record={},action={}){
 const old=record&&typeof record==='object'?record:{};
 const prev=Number(old.total)||0;
 const rounds={...(old.rounds||{})};
 const history=Array.isArray(old.history)?old.history.slice(-29):[];
 let next=prev,change=0;
 if(action.kind==='judgement'){
  const round=String(action.round||'');if(!/^\d{1,10}$/.test(round))throw Error('Runde fehlt.');
  const delta=judgementDelta(action.points,action.result);
  const previous=Number(rounds[round]?.delta)||0;
  change=delta-previous;next=prev+change;
  rounds[round]={delta,result:action.result,questionId:String(action.questionId||'').slice(0,80)};
 }else if(action.kind==='manual'){
  change=Number(action.delta);if(!Number.isFinite(change)||!change||Math.abs(change)>10000)throw Error('Ungültige manuelle Punktänderung.');
  next=prev+change;
 }else throw Error('Unbekannte Punkteaktion.');
 if(Math.abs(next)>999999)throw Error('Punktelimit überschritten.');
 if(change)history.push({kind:action.kind,delta:change,round:String(action.round||''),at:Number(action.at)||0});
 return {total:next,rounds,history:history.slice(-30)};
}
export function manualPlayerLabels(quiz){return Object.fromEntries((quiz.manualPlayers||[]).map((name,i)=>['manual_'+(i+1),name]));}

// Presentation-only helpers: derive everything from the authoritative public state.
// No answers or host-private fields are involved.
export function sceneForPublicState(state){
 return state?.current&&['question','paused','review','reveal'].includes(state.phase)?'question':'board';
}
export function isBoardCellPlayed(item,state){
 return !!(item?.used||state?.used?.[item?.id]||state?.current?.id===item?.id);
}
export function pageBoardColumns(columns,width=1280,height=800){
 const maxCols=width<470?2:width<720?3:width<1030?4:width<1380?5:6;
 const maxRows=Math.max(2,Math.min(9,Math.floor((height-280)/57)));
 const pages=[];
 for(let c=0;c<columns.length;c+=maxCols){
  const group=columns.slice(c,c+maxCols),highest=Math.max(0,...group.map(x=>x.items.length));
  for(let start=0;start<highest;start+=maxRows)pages.push({columns:group.map(col=>({...col,items:col.items.slice(start,start+maxRows)})),start,rows:Math.min(maxRows,highest-start)});
 }
 return pages;
}
