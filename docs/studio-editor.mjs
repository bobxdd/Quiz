import {changeSelectedQuestions,reuseQuestion,quizAudit} from './editor-workflows.mjs';
import {renderAnswerView,hasRequiredAnswer,answerViewContent} from './answer-view.mjs';
import {normalizePoint,DEFAULT_MAP_VIEW} from './map-tools.mjs';
import {hasDraggedFiles,imageFilesFromDrop,imageDropPoint} from './image-drop.mjs';
import {mountMapViewport} from './map-viewport.mjs';
import {CATEGORY_SUGGESTIONS,MAX_CATEGORIES,collectCategories,questionsInCategory,categoryKey,cleanCategoryName,assertNewCategory,suggestedTemplate} from './category-model.mjs';
/* BrainQuiz 1.7 — standalone browser editor. Local listeners on a replaceable root; no old q-* field wiring. */
import {TEMPLATE_NAMES,element,templateScene,ensureScene,normalizeScene,normalizeElement,reconcileQuestion,renderScene,publicScene,validateScene,escape} from './studio-model.mjs';
export function createStudioEditor(api){
 let sel='',reveal=0,preview=false,search='',snap=true,drag=null,draftTimer=null,redrawPending=false,trackedInput=null,menu=null,libraryMenu=null,touchTimer=null,touchStart=null;
 let activeCategory='',showCategoryForm=false,renamingCategory=false,categoryDraft='';
 let selectedQuestions=new Set(),bankOpen=false,bankQuery='',previewDevice='desktop',auditOpen=false,savePending=false,mobileTab='canvas',editorPane='question';
 let mapCamera={...DEFAULT_MAP_VIEW},mapQuestionId='';
 const q=()=>api.getQuestion();
 const quiz=()=>api.getQuiz();
 const categories=()=>collectCategories(quiz()?.categories,quiz()?.questions);
 const current=()=>{const item=q();if(!activeCategory||categoryKey(item?.category)!==categoryKey(activeCategory))return null;if(item)ensureScene(item);return item;};
 const find=()=>current()?.scene?.elements.find(x=>x.id===sel)||null;
 const saveLabel=()=>{const status=api.saveStatus?.()||'Gespeichert';return /fehler|voll|exportieren|konflikt/i.test(status)?'⚠ '+status:'✓ '+status;};
 const libraryMenuHTML=()=>{if(!libraryMenu)return '';const {kind,x,y,id,category}=libraryMenu;const title=kind==='category'?(category||'Kategorie'):(quiz().questions||[]).find(q=>q.id===id)?.title||'Frage';const items=kind==='category'?[['library-open','Öffnen'],['library-new','Neue Frage'],['library-rename','Umbenennen'],['library-delete','Kategorie löschen','se-destructive']]:[['library-open','Öffnen'],['copy-q','Duplizieren'],['library-delete','Frage löschen','se-destructive']];return `<div class="se-context" style="left:${Math.max(8,Math.min(window.innerWidth-238,x))}px;top:${Math.max(8,Math.min(window.innerHeight-200,y))}px" role="menu" aria-label="Kontextmenü"><div class="se-context-head"><strong>${escape(title)}</strong><button type="button" data-se-action="library-menu-close">✕</button></div>${items.map(([action,label,cls=''])=>`<button type="button" role="menuitem" class="${cls}" data-se-action="${action}">${label}</button>`).join('')}</div>`;};
 const setSaveBadge=(pending)=>{savePending=pending;const el=document.querySelector('.se-save-badge');if(el){el.textContent=pending?'● Wird gespeichert …':saveLabel();el.classList.toggle('is-warning',!pending&&saveLabel().startsWith('⚠'));}if(!pending&&/SPEICHERFEHLER|KONFLIKT/i.test(api.saveStatus?.()||''))draw();};
 const persist=(refresh=false)=>{const item=current();if(item)reconcileQuestion(item);api.save();setSaveBadge(false);if(refresh)draw();};
 const snapshot=()=>api.snapshot();
 const flushDraft=()=>{if(draftTimer){clearTimeout(draftTimer);draftTimer=null;const item=q();if(item)reconcileQuestion(item);api.save();setSaveBadge(false);}};
 const preventFileNavigation=event=>{
  if(typeof document==='undefined'||!document.getElementById('se-root')||!hasDraggedFiles(event.dataTransfer)||event.defaultPrevented)return;
  event.preventDefault();
  if(event.type==='dragover'&&event.dataTransfer)event.dataTransfer.dropEffect='none';
 };
 if(typeof window!=='undefined'){
  window.addEventListener('dragover',preventFileNavigation);
  window.addEventListener('drop',preventFileNavigation);
 }
 if(typeof window!=='undefined')window.addEventListener('pagehide',flushDraft);
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushDraft();});
 const deferDraft=()=>{setSaveBadge(true);clearTimeout(draftTimer);draftTimer=setTimeout(()=>{draftTimer=null;const item=q();if(item)reconcileQuestion(item);api.save();setSaveBadge(false);},450)};
 const letterList='ABCDEFGHIJ'.split('');
 // Find a low-overlap position within the 1000x560 canvas; never spawn outside it.
 function findInsertion(elements,w,h){
  let best={x:40,y:40,score:Infinity};
  for(let y=20;y<=560-h;y+=20)for(let x=20;x<=1000-w;x+=20){
   let overlap=0;
   for(const e of elements){const width=Math.max(0,Math.min(x+w,e.x+e.w)-Math.max(x,e.x));const height=Math.max(0,Math.min(y+h,e.y+e.h)-Math.max(y,e.y));overlap+=width*height;}
   const score=overlap+Math.abs(x-160)*0.05+Math.abs(y-310)*0.06;
   if(score<best.score)best={x,y,score};
  }
  return {x:best.x,y:best.y};
 }

 function setType(name){flushDraft();const item=current();if(!item)return; if(item.scene?.elements?.length&&!confirm('Vorlage wechseln? Die bisherigen Elemente dieser Frage werden durch die Vorlage ersetzt.')){draw();return;}
  snapshot();item.scene=templateScene(name,item);if(name==='map')item.roundMode='written';item.type=name==='multiple'?'multiple':name==='order'?'order':name==='imposter'?'imposter':name==='quote'?'quote':name==='emoji'?'emoji':name==='audio'?'audio':name==='estimate'?'estimate':name==='map'?'map':'text';sel='';reveal=0;preview=false;persist(true);
 }
 const input=(name,label,value,{kind='text',min,max,step,rows=0,options}={})=>{
  const id=`se-in-${name}`;
  let ctl;if(options)ctl=`<select id="${id}" data-se-field="${name}">${options.map(([val,label])=>`<option value="${escape(val)}" ${String(val)===String(value)?'selected':''}>${escape(label)}</option>`).join('')}</select>`;
  else if(rows)ctl=`<textarea id="${id}" data-se-field="${name}" rows="${rows}">${escape(value)}</textarea>`;
  else ctl=`<input id="${id}" data-se-field="${name}" type="${kind}" value="${escape(value)}" ${min!==undefined?`min="${min}"`:''} ${max!==undefined?`max="${max}"`:''} ${step!==undefined?`step="${step}"`:''}>`;
  return `<label class="se-field"><span>${escape(label)}</span>${ctl}</label>`;
 };
 function propsPanel(item){const el=find(),scene=item.scene;
  const base=`<section class="se-properties"><h3>Frage</h3><div class="se-two">${input('category','Kategorie',item.category,{options:categories().map(name=>[name,name])})}${input('points','Punkte',item.points,{kind:'number',min:0,max:10000,step:50})}</div>${input('title','Interner Fragetitel',item.title)}<label class="se-field"><span>Spielmodus</span><select data-se-roundmode><option value="buzzer" ${item.roundMode!=='written'?'selected':''}>Buzzer – Antwort durch Host bewerten</option><option value="written" ${item.roundMode==='written'?'selected':''}>Alle schreiben – Antworten verdeckt sammeln</option></select></label><p class="se-muted">Buzzer ist Standard, unabhängig vom Fragetyp. Nur Schreib-Runden sammeln Texte.</p>
  <label class="se-field"><span>Vorlage</span><select data-se-template>${Object.entries(TEMPLATE_NAMES).map(([key,label])=>`<option value="${key}" ${scene.template===key?'selected':''}>${escape(label)}</option>`).join('')}</select></label>
  ${scene.template==='multiple'?`<div class="se-subpanel"><h4>Richtige Antwort</h4>${input('correct','Musterlösung',letterList[item.correct||0]||'A',{options:'ABCD'.split('').map(k=>[k,k])})}</div>`:''}
  ${scene.template==='order'?`<div class="se-subpanel"><h4>Richtige Reihenfolge</h4><div class="se-sort-sequence">${scene.sortCorrect.map((key,i)=>`<div class="se-sort-entry"><strong>${i+1}.</strong><b>${key}</b><span>${escape(scene.elements.find(v=>v.kind==='order'&&v.letter===key)?.text||'')}</span><button type="button" data-se-action="sort-up" data-pos="${i}" ${i===0?'disabled':''} title="Nach oben">↑</button><button type="button" data-se-action="sort-down" data-pos="${i}" ${i===scene.sortCorrect.length-1?'disabled':''} title="Nach unten">↓</button></div>`).join('')}</div><div class="se-inline"><button type="button" data-se-action="sort-add" ${scene.sortCorrect.length>=10?'disabled':''}>+ Eintrag</button><button type="button" data-se-action="sort-remove" ${scene.sortCorrect.length<=3?'disabled':''}>− Letzten entfernen</button></div></div>`:''}
  ${scene.template==='estimate'?`${input('estimateTarget','Schätzwert',item.estimateTarget||0,{kind:'number',step:'any'})}${input('estimateUnit','Einheit',item.estimateUnit||'')}`:''}
  ${scene.template==='imposter'?`${input('imposterIndex','Ersetztes Bild',item.imposterIndex||0,{options:scene.elements.filter(el=>el.kind==='image').map((el,i)=>[String(i),el.alt||`Bild ${i+1}`])})}<label class="se-field" data-se-upload-zone="correct-icon"><span>Originalbild vor dem Austausch (nur Host)</span><small class="se-drop-help">Bild hier ablegen oder auswählen</small><input type="file" accept="image/png,image/jpeg,image/webp" data-se-upload="correct-icon"></label>`:''}
  ${scene.template==='map'?`<div class="se-subpanel bq-map-host-point"><h4>Geheimer Zielpunkt (Pflicht)</h4><p>${item.mapTargetSet?'✓ Dolch wurde auf der Karte platziert.':'⚠ Noch kein Zielpunkt gewählt. Zum Veröffentlichen ist ein Pin erforderlich.'}</p><p class="se-muted">Öffne „Bearbeiten“ und tippe auf die graue Weltkarte. Mit +, −, Mausrad oder zwei Fingern kannst du vorher heranzoomen. Der Dolch markiert deinen Antwortpunkt. Teilnehmer sehen ihn erst nach der Lösung.</p>${item.mapTargetSet?`<div class="se-inline"><strong>Position: ${Number(item.mapTargetX).toFixed(3)} / ${Number(item.mapTargetY).toFixed(3)}</strong><button type="button" data-se-action="map-clear">Pin entfernen</button></div>`:''}</div>`:''}
  ${scene.template==='map'?input('mapPrompt','Frage über der Weltkarte',item.prompt||'',{rows:2}):''}
  ${scene.template==='audio'?`${input('audioStart','Start im Original (Sekunden)',item.audioStart||0,{kind:'number',min:0,step:0.5})}${input('audioDuration','Ausschnitt (1–12 Sekunden)',item.audioDuration||8,{kind:'number',min:1,max:12})}<label class="se-field"><span>MP3 / WAV / OGG auswählen</span><input type="file" accept=".mp3,audio/mpeg,.wav,audio/wav,.ogg,audio/ogg" data-se-upload="audio"></label><p class="se-muted">MP3 wird in einen kompakten Clip umgewandelt. Im Live-Spiel startet und wiederholt nur der Host; alle können währenddessen buzzern.</p>${item.audio?`<audio controls src="${item.audio}"></audio>`:''}`:''}
  <details class="se-extras"><summary>Weitere Angaben & Tipps (1–4)</summary>${scene.template==='hints'?'<p class="se-muted">Die vier Tipps bearbeitest du direkt in der Fragenfläche. Ihr Aufdeckzeitpunkt ist bei jedem Tipp einstellbar.</p>':`<p class="se-muted">Optional: bis zu vier Tipps, die der Host einzeln veröffentlicht.</p>${[0,1,2,3].map(i=>input('hint-'+i,`Tipp ${i+1}`,item.hints?.[i]||'',{rows:2})).join('')}`} ${input('seconds','Timer in Sekunden (0 = aus)',item.seconds||0,{kind:'number',min:0,max:600})}</details></section>`;
  if(!el)return `${base}<section class="se-properties"><h3>Element</h3><p class="se-muted">Ein Element auf der Fragenfläche anklicken.</p></section>`;
  return `${base}<section class="se-properties"><div class="se-sectionhead"><h3>Ausgewähltes Element</h3><div class="se-inline"><button type="button" data-se-action="duplicate" title="Duplizieren">⧉</button><button type="button" data-se-action="remove" title="Entfernen">✕</button></div></div><div class="se-chip">${escape(el.kind.toUpperCase())} ${el.letter?`· ${escape(el.letter)}`:''}</div>
  ${el.kind!=='image'?input('text','Inhalt',el.text,{rows:3}):`<label class="se-field" data-se-upload-zone="image"><span>Bilddatei (PNG/JPG/WebP)</span><small class="se-drop-help">Bild hier ablegen oder auswählen</small><input type="file" accept="image/png,image/jpeg,image/webp" data-se-upload="image"></label>${input('alt','Bildbeschreibung',el.alt||'')}`}
  <details class="se-more-properties"><summary>Position, Größe und Gestaltung</summary>  <div class="se-two">${input('x','X',Math.round(el.x),{kind:'number',min:0,max:950})}${input('y','Y',Math.round(el.y),{kind:'number',min:0,max:530})}${input('w','Breite',Math.round(el.w),{kind:'number',min:50,max:1000})}${input('h','Höhe',Math.round(el.h),{kind:'number',min:30,max:560})}</div>
  <div class="se-two">${input('font','Schriftgröße',el.font,{kind:'number',min:13,max:78})}${input('step','Aufdecken',el.step,{options:[[0,'Sofort'],[1,'Hinweis 1'],[2,'Hinweis 2'],[3,'Hinweis 3'],[4,'Hinweis 4'],[5,'Hinweis 5'],[6,'Erst bei Lösung']]})}</div>
  ${el.kind==='shape'?input('shape','Form',el.shape,{options:[['rect','Rechteck'],['pill','Abgerundet'],['circle','Kreis'],['line','Linie']]}):''}
  <div class="se-two">${input('fill','Textfarbe',el.fill,{kind:'color'})}${input('bg','Hintergrundfarbe',el.bg,{kind:'color'})}</div>
  ${el.kind==='text'?input('role','Verwendung',el.role,{options:[['content','Text / Hinweis'],['question','Hauptfrage'],['clue','Zitat / Emoji-Hinweis']]}) :''}
  ${input('align','Ausrichtung',el.align,{options:[['left','Links'],['center','Mitte'],['right','Rechts']]})}
  </details>
  <div class="se-inline"><button type="button" data-se-action="layer-back">Nach hinten</button><button type="button" data-se-action="layer-front">Nach vorn</button></div>
  <p class="se-muted">Mit der Maus ziehen oder die X-/Y-Felder verwenden. Pfeiltasten verschieben das gewählte Element.</p></section>`;
 }

 function answerEditor(item){
  const info=answerViewContent(item),ready=hasRequiredAnswer(item),automatic=!!(info.text||info.image)&&!item.answerText?.trim()&&!item.answerImage;
  const previewMap=item.type==='map'&&item.mapTargetSet?
   '<div class="se-answer-map-preview"><h4>Kartenlösung</h4>'
    +renderScene(item.scene,{revealed:true,mapView:mapCamera,mapSolution:normalizePoint({x:item.mapTargetX,y:item.mapTargetY})})
    +'</div>':'';
  const currentText=item.answerText||(!['multiple','order','estimate','map','imposter'].includes(item.type)?item.answer||'':'');
  return '<section class="se-answer-tab-content" id="se-answer-tabpanel" role="tabpanel" aria-labelledby="se-editor-tab-answer" tabindex="0">'
   +'<div class="se-answer-sectionhead"><div><span class="se-eyebrow">SCHRITT 2 · VERPFLICHTEND</span><h3>Antwort gestalten</h3>'
   +'<p>Diese eigenständige Ansicht erscheint erst, wenn der Host die Lösung freigibt oder eine Buzzerantwort als richtig bewertet.</p></div>'
   +'<span class="se-answer-readiness '+(ready?'is-ready':'is-missing')+'" role="status">'+(ready?'✓ Antwort bereit':'⚠ Antwort fehlt')+'</span></div>'
   +'<div class="se-answer-edit-grid"><div class="se-answer-fields">'
   +'<label class="se-field"><span>Antworttext</span><textarea id="se-answer-text" data-se-field="answerText" rows="4" maxlength="2000" placeholder="Die richtige Antwort …">'+escape(currentText)+'</textarea></label>'
   +'<p class="se-muted">Der Text ist optional, wenn ein Antwortbild vorhanden ist. Du kannst aber auch beides gleichzeitig verwenden.</p>'
   +'<label class="se-field se-answer-upload" data-se-upload-zone="answer-image"><span>Antwortbild · PNG, JPG oder WebP</span>'
   +'<small class="se-drop-help">Bild auswählen, hier ablegen oder mit Strg+V einfügen (max. 6 MB Original, wird verkleinert)</small>'
   +'<input type="file" accept="image/png,image/jpeg,image/webp" data-se-upload="answer-image"></label>'
   +(item.answerImage?'<button type="button" class="se-answer-remove" data-se-action="answer-image-remove">✕ Antwortbild entfernen</button>':'')
   +input('answerImageAlt','Bildbeschreibung für Barrierefreiheit',item.answerImageAlt||'')
   +input('explanation','Zusätzliche Erklärung (optional)',item.explanation||'',{rows:3})
   +'<details class="se-host-metadata" data-bq-persist="host-metadata"><summary>🔒 Host-Notizen, Alternativantworten & Quellen</summary><p class="se-muted">Diese Angaben sieht nur der Host. Akzeptierte Varianten dienen als Entscheidungshilfe; die Bewertung bleibt beim Host.</p>'
   +input('acceptedAnswers','Weitere akzeptierte Lösungen · eine pro Zeile',item.acceptedAnswers||'',{rows:3})
   +input('hostNotes','Notizen für die Moderation · nur Host',item.hostNotes||'',{rows:4})
   +input('sourceUrl','Quellenlink (https://)',item.sourceUrl||'')
   +input('sourcePatch','LoL-Patch / Bezugsjahr / Datenstand',item.sourcePatch||'')
   +input('sourceCheckedOn','Geprüft am (JJJJ-MM-TT)',item.sourceCheckedOn||'')
   +'</details>'
   +(automatic?'<p class="se-muted">Die vorhandene Musterlösung dieses Fragetyps wird automatisch übernommen. Du kannst sie mit eigenem Text oder einem Bild ergänzen.</p>':'')
   +(!ready?'<p class="se-answer-warning" role="alert">Vor dem Veröffentlichen bitte mindestens Text oder ein Bild für die Antwort hinterlegen.</p>':'')
   +'</div><div class="se-answer-live-preview"><span class="se-eyebrow">VORSCHAU · SO SEHEN ALLE DIE LÖSUNG</span>'
   +renderAnswerView(item,{preview:true})+previewMap
   +'</div></div></section>';
 }

 function refreshAnswerPreview(){
  if(editorPane!=='answer')return;
  const item=current(),root=document.getElementById('se-root');
  if(!item||!root)return;
  const previewNode=root.querySelector('.se-answer-live-preview .bq-answer-view');
  if(previewNode)previewNode.outerHTML=renderAnswerView(item,{preview:true});
  const ready=hasRequiredAnswer(item),badge=root.querySelector('.se-answer-readiness');
  if(badge){
   const before=badge.classList.contains('is-ready');
   badge.classList.toggle('is-ready',ready);badge.classList.toggle('is-missing',!ready);
   if(ready!==before)badge.textContent=ready?'✓ Antwort bereit':'⚠ Antwort fehlt';
  }
  const tab=root.querySelector('[data-se-action="editor-pane"][data-pane="answer"]');
  if(tab)tab.textContent='✓ Antwort · Pflicht '+(ready?'●':'⚠');
  const warning=root.querySelector('.se-answer-warning');
  if(warning)warning.hidden=ready;
 }
 function contextMenuHTML(){
  if(!menu||preview)return '';
  const el=find();const actions=el?
  [['focus-content','Bearbeiten'],['duplicate','Duplizieren'],['center-x','Horizontal zentrieren'],['center-y','Vertikal zentrieren'],['layer-front','In Vordergrund'],['layer-back','In Hintergrund'],['remove','Löschen']]:
  [['add-element','Text hinzufügen','text'],['add-element','Bild hinzufügen','image'],['add-element','Form hinzufügen','shape']];
  const left=Math.max(8,Math.min(menu.x,window.innerWidth-240)),top=Math.max(8,Math.min(menu.y,window.innerHeight-385));
  return `<div class="se-context" role="menu" aria-label="Frageneditor: Kontextaktionen" style="left:${left}px;top:${top}px"><div class="se-context-head"><strong>${el?'Elementaktionen':'Element hinzufügen'}</strong><button type="button" aria-label="Menü schließen" data-se-action="menu-close">✕</button></div>${actions.map(([id,label,kind])=>`<button type="button" role="menuitem" data-se-action="${id}" ${kind?`data-kind="${kind}"`:''} class="${id==='remove'?'se-destructive':''}">${label}</button>`).join('')}</div>`;
 }
 // Categories are the project structure, while question templates describe how a question plays.
 function categoryCard(name,created,all){
  const count=questionsInCategory(all,name).length;
  const meta=CATEGORY_SUGGESTIONS.find(s=>categoryKey(s.name)===categoryKey(name));
  return `<article class="se-category-card ${created?'':'se-category-suggestion'}">
   <button type="button" class="se-category-open" data-se-action="${created?'category-select':'category-preset'}" data-category="${escape(name)}"><strong>${escape(name)}</strong><small>${created?`${count} ${count===1?'Frage':'Fragen'}`:'Vorlage'}</small><span>${escape(meta?.description||'Eigene Quizkategorie')}</span></button>
   ${created?`<button type="button" class="se-category-add" data-se-action="category-new-question" data-category="${escape(name)}" title="Frage in ${escape(name)} anlegen">+ Frage</button>`:''}
  </article>`;
 }
 function overview(all,cats){
  const presets=CATEGORY_SUGGESTIONS.filter(s=>!cats.some(cat=>categoryKey(cat)===categoryKey(s.name)));
  const matching=search.trim()?all.filter(item=>[item.title,item.prompt,item.category].join(' ').toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de'))):[];
  return `<section class="se-category-overview" aria-label="Kategorieübersicht"><div class="se-overview-head"><div><span class="se-eyebrow">Quizstruktur</span><h2>Kategorien</h2><p>Erstelle zuerst eine Kategorie, dann die Fragen darin.</p></div><button type="button" class="se-primary" data-se-action="category-form">+ Kategorie</button></div>
   ${cats.length?`<div class="se-category-grid">${cats.map(name=>categoryCard(name,true,all)).join('')}</div>`:'<p class="se-overview-empty">Noch keine Kategorie angelegt.</p>'}
   ${matching.length?`<section class="se-search-results"><h3>Suchergebnisse (${matching.length})</h3>${matching.slice(0,30).map(item=>`<button type="button" data-se-action="select" data-id="${escape(item.id)}">${escape(item.category)} · ${escape(item.title)}</button>`).join('')}</section>`:''}
   ${presets.length?`<div class="se-overview-presets"><h3>Schnell anlegen</h3><p>Das sind Vorschläge – du kannst auch eigene Namen verwenden.</p><div class="se-category-grid">${presets.map(s=>categoryCard(s.name,false,all)).join('')}</div></div>`:''}
  </section>`;
 }
 function html(){
  const all=quiz().questions||[],cats=categories();
  if(activeCategory&&!cats.some(c=>categoryKey(c)===categoryKey(activeCategory)))activeCategory='';
  const item=current(),within=activeCategory?questionsInCategory(all,activeCategory):[];
  if(item?.id!==mapQuestionId){mapQuestionId=item?.id||'';mapCamera={...DEFAULT_MAP_VIEW};}
  const displayed=within.filter(x=>[x.title,x.prompt,String(x.points)].join(' ').toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de')));
  const bankItems=all.filter(x=>categoryKey(x.category)!==categoryKey(activeCategory)&&[x.title,x.prompt,x.category,String(x.points)].join(' ').toLocaleLowerCase('de').includes(bankQuery.toLocaleLowerCase('de'))).slice(0,40);
  const audit=quizAudit(quiz()),invalidIds=new Set(audit.errors.map(x=>x.id));
  const nav=`<nav class="se-category-nav" aria-label="Quizkategorien"><button type="button" data-se-action="category-overview" class="se-category-navrow ${!activeCategory?'is-current':''}" aria-current="${!activeCategory?'page':'false'}"><span>▦ Alle Kategorien</span><small>${cats.length}</small></button>${cats.map(name=>`<button type="button" class="se-category-navrow ${categoryKey(name)===categoryKey(activeCategory)?'is-current':''}" data-se-library="category" data-se-action="category-select" data-category="${escape(name)}" ${categoryKey(name)===categoryKey(activeCategory)?'aria-current="page"':''}><span>${escape(name)}</span><small>${questionsInCategory(all,name).length}</small></button>`).join('')}</nav>`;
  const categoryForm=showCategoryForm?`<form class="se-category-form" data-se-category-form><label for="se-new-category">${renamingCategory?'Kategorie umbenennen':'Kategorie erstellen'}</label><input id="se-new-category" data-se-category-name maxlength="70" autocomplete="off" required value="${escape(categoryDraft)}" placeholder="z. B. Lorefragen"><div class="se-inline"><button type="submit" class="se-primary">${renamingCategory?'Umbenennen':'Anlegen'}</button><button type="button" data-se-action="category-form-cancel">Abbrechen</button></div></form>`:'';
  const editorTabs=item?
   '<nav class="se-editor-pane-tabs" role="tablist" aria-label="Frage und Antwort bearbeiten">'
   +'<button id="se-editor-tab-question" role="tab" type="button" data-se-action="editor-pane" data-pane="question" aria-controls="se-question-tabpanel" aria-selected="'+(editorPane==='question')+'" tabindex="'+(editorPane==='question'?'0':'-1')+'" class="'+(editorPane==='question'?'active':'')+'">✎ Frage bearbeiten</button>'
   +'<button id="se-editor-tab-answer" role="tab" type="button" data-se-action="editor-pane" data-pane="answer" aria-controls="se-answer-tabpanel" aria-selected="'+(editorPane==='answer')+'" tabindex="'+(editorPane==='answer'?'0':'-1')+'" class="'+(editorPane==='answer'?'active':'')+'">✓ Antwort · Pflicht '+(hasRequiredAnswer(item)?'●':'⚠')+'</button>'
   +'</nav>':'';
  const currentBoard=api.boardInfo?.()||{isLocal:false,boards:[]};
  const otherBoards=(currentBoard.boards||[]).filter(b=>b.id!==currentBoard.id);
  const boardSaveError=/SPEICHERFEHLER|KONFLIKT/i.test(api.saveStatus?.()||'');
  return `<div class="se-studio se-editor-v3" id="se-root">
   <div class="se-board-context" role="status" aria-label="Aktuell bearbeitetes Quizbrett"><span class="se-board-context-caption">DU BEARBEITEST DIESES QUIZBRETT</span><strong title="${escape(quiz().title)}">${escape(quiz().title)}</strong><span class="se-board-context-lock">▣ ${currentBoard.conflict?'Sicherungskonflikt – Schreibschutz aktiv':currentBoard.isLocal?'Lokales Quizbrett · bleibt geöffnet':'Aktueller Hostraum'}</span>${currentBoard.isLocal?`<details class="se-board-switch"><summary>Quizbretter</summary><div class="se-board-switch-items"><b>Aktuelles Quizbrett</b><span aria-current="true">${escape(quiz().title)}</span>${otherBoards.length?`<b>Andere Quizbretter</b>${otherBoards.map(b=>`<button type="button" data-action="open-board" data-board-id="${escape(b.id)}"><span>${escape(b.title)}</span><small>Letzte Bearbeitung: ${b.updatedAt?new Date(b.updatedAt).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'–'} · Kennung ${escape(b.id.slice(1,7).toUpperCase())}</small></button>`).join('')}`:''}<button type="button" class="se-primary" data-action="new-board">+ Neues Quizbrett erstellen</button><p class="se-board-storage-hint">Bretter liegen in diesem Browser. Für Backups: Dateien → Quiz exportieren.</p></div></details>`:''} </div>
   ${currentBoard.conflict?`<section class="se-board-conflict" role="alert"><strong>Das Quizbrett wurde in einem anderen Tab verändert.</strong><p>Hier wird nichts überschrieben. Sichere deine Änderungen als eigenes Brett oder öffne bewusst die gespeicherte Version.</p><div class="se-inline"><button type="button" class="se-primary" data-action="rescue-board">Änderungen als Kopie retten</button><button type="button" data-action="reload-board">Gespeicherte Version öffnen</button><button type="button" data-action="export">Backup herunterladen</button></div></section>`:boardSaveError?`<section class="se-board-conflict" role="alert"><strong>Dieses Brett konnte nicht sicher gespeichert werden.</strong><p>${escape(api.saveStatus?.()||'Speicherproblem')} Bitte vor dem Schließen eine Sicherung herunterladen.</p><button type="button" data-action="export">Backup herunterladen</button></section>`:''}
   <div class="se-toolbar bq-editor-toolbar">
     <div class="bq-editor-main">
      <div class="bq-editor-main-info"><span class="bq-editor-step">SCHRITT 1 · QUIZ ERSTELLEN</span><label class="se-field se-title"><span>Quizname</span><input data-se-quiztitle maxlength="100" value="${escape(quiz().title)}"></label></div>
      <div class="bq-editor-primary-actions">
       <span class="se-save-badge" role="status" aria-live="polite">${savePending?'● Wird gespeichert …':escape(saveLabel())}</span>
       ${api.isOffline()?'<button type="button" data-action="save-board">Quiz speichern</button>':''}
       ${api.isOffline()&&api.onlineReady()?'<button type="button" class="se-primary bq-editor-host-cta" data-action="host-current-board">Lobby hosten</button>':!api.isOffline()?'<button type="button" class="se-primary" data-action="publish">Live veröffentlichen</button>':''}
      </div>
     </div>
     <div class="bq-editor-tools">
      ${api.isOffline()?'<button type="button" class="bq-editor-library-btn" data-action="back-to-quizzes">← Meine Quizze</button>':''}
      <button type="button" data-action="view" data-view="live">Quizbrett ansehen</button>
      <label class="se-field se-score-mode"><span>Wertung</span><select data-se-scoremode aria-label="Punkte für Teams oder Einzelpersonen"><option value="team" ${quiz().scoreMode!=='individual'?'selected':''}>Teams</option><option value="individual" ${quiz().scoreMode==='individual'?'selected':''}>Einzelpersonen</option></select></label>
      <details class="bq-editor-extras" data-bq-persist="editor-extras"><summary>Weitere Werkzeuge</summary><div class="bq-editor-extras-menu">
       <details class="se-file-actions"><summary>Dateien importieren / exportieren</summary><div class="se-file-menu"><button type="button" data-action="import">Quiz importieren</button><button type="button" data-action="export">Quiz exportieren</button><button type="button" data-se-action="backup">Sicherung herunterladen</button></div></details>
       <button type="button" data-se-action="audit" class="${audit.errors.length?'se-audit-needs-attention':''}" title="Fragen vor dem Hosten prüfen">Quizcheck ${audit.errors.length?'⚠ '+audit.errors.length:'✓'}</button>
       <button type="button" data-se-action="undo" title="Rückgängig (Strg+Z)">↶ Rückgängig</button>
       <button type="button" data-se-action="redo" title="Wiederholen (Strg+Umschalt+Z)">↷ Wiederholen</button>
      </div></details>
     </div>
    </div>
   ${auditOpen?`<section class="se-audit" aria-label="Quizprüfung"><div class="se-sectionhead"><h3>${audit.ready?'Quiz bereit':'Quiz noch unvollständig'} · ${audit.questionCount} Fragen</h3><button type="button" data-se-action="audit">Schließen</button></div><p>${audit.errors.length} Fehler · ${audit.warnings.length} Hinweise</p>${audit.errors.some(row=>row.id)?`<button type="button" class="se-audit-next" data-se-action="open-next-issue">Nächsten Fehler bearbeiten →</button>`:''}${[...audit.errors,...audit.warnings].slice(0,25).map(a=>`<div class="se-audit-row"><span>${escape(a.label)}: ${escape(a.reason)}</span>${a.id?`<button type="button" data-se-action="select" data-id="${escape(a.id)}">Öffnen</button>`:''}</div>`).join('')}</section>`:''}
   <div class="se-workgrid ${activeCategory?'se-category-detail se-mobile-tab-'+mobileTab:'se-category-home'}">${activeCategory?`<nav class="se-mobile-editor-tabs" aria-label="Editorbereiche">${[['categories','Bibliothek'],['canvas',editorPane==='answer'?'Antwort':'Bearbeiten'],...(editorPane==='answer'?[]:[['properties','Eigenschaften']])].map(([name,label])=>`<button type="button" data-se-action="mobile-tab" data-mobile-tab="${name}" aria-current="${mobileTab===name?'page':'false'}" class="${mobileTab===name?'active':''}">${label}</button>`).join('')}</nav>`:''}<aside class="se-list"><div class="se-sectionhead"><h3>Bibliothek</h3><button type="button" data-se-action="category-form" title="Kategorie erstellen" aria-label="Neue Kategorie">+ Kategorie</button></div>${categoryForm}${nav}
    ${activeCategory?`<div class="se-category-questions-head"><div><strong>${escape(activeCategory)}</strong><small>${within.length} ${within.length===1?'Frage':'Fragen'}</small></div><div class="se-inline"><button type="button" data-se-action="category-rename" title="Kategorie umbenennen">✎</button><button type="button" data-se-action="category-remove" title="Kategorie mit allen Fragen löschen">✕</button></div></div><button type="button" class="se-primary se-add-question" data-se-action="new">+ Frage hinzufügen</button><input class="se-search" data-se-search aria-label="Fragen dieser Kategorie suchen" placeholder="Fragen suchen …" value="${escape(search)}"><div class="se-questions">${displayed.map(x=>`<div class="se-qwrap"><label class="se-qpick" title="Frage für Sammelbearbeitung auswählen"><input type="checkbox" data-se-multi="${escape(x.id)}" aria-label="${escape(x.title)} auswählen" ${selectedQuestions.has(x.id)?'checked':''}></label><button type="button" class="se-qrow ${x.id===item?.id?'is-active':''}" data-se-library="question" data-se-action="select" data-id="${escape(x.id)}"><span><strong>${escape(x.points)} Punkte</strong><small>${escape(x.title)}</small></span><span class="se-q-status ${invalidIds.has(x.id)?'is-incomplete':'is-complete'}" title="${invalidIds.has(x.id)?'Noch unvollständig':'Zum Veröffentlichen bereit'}" aria-label="${invalidIds.has(x.id)?'Frage unvollständig':'Frage bereit'}">${invalidIds.has(x.id)?'⚠':'✓'}</span></button></div>`).join('')}${!displayed.length?'<p class="se-muted se-empty-filter">Keine Fragen gefunden.</p>':''}</div><div class="se-inline se-listfoot"><button type="button" data-se-action="copy-q" ${item?'':'disabled'}>Duplizieren</button><button type="button" data-se-action="delete-q" ${item?'':'disabled'}>Löschen</button></div>
    <details class="se-question-bank" ${bankOpen?'open':''}><summary>Fragenbank · Frage übernehmen</summary><label class="se-field"><span>In anderen Kategorien suchen</span><input data-se-bank-search value="${escape(bankQuery)}" placeholder="Frage oder Kategorie …"></label><div class="se-bank-list">${bankItems.length?bankItems.map(x=>`<div class="se-bank-item"><span><strong>${escape(x.title)}</strong><small>${escape(x.category)} · ${x.points} Punkte</small></span><button type="button" data-se-action="reuse-question" data-id="${escape(x.id)}" aria-label="${escape(x.title)} nach ${escape(activeCategory)} kopieren">Übernehmen</button></div>`).join(''):'<p class="se-muted">Keine passenden Fragen in anderen Kategorien.</p>'}</div></details>
    ${selectedQuestions.size?`<div class="se-batch" aria-label="Mehrere Fragen bearbeiten"><strong>${selectedQuestions.size} ausgewählt</strong><label>Kategorie<select data-se-batch-category><option value="">Unverändert</option>${cats.map(name=>`<option value="${escape(name)}">${escape(name)}</option>`).join('')}</select></label><label>Punkte<input data-se-batch-points type="number" min="0" max="10000" step="1" placeholder="Unverändert"></label><div class="se-inline"><button type="button" data-se-action="batch-apply" class="se-primary">Übernehmen</button><button type="button" data-se-action="batch-clear">Auswahl löschen</button></div></div>`:''}`:`<input class="se-search" data-se-search aria-label="Fragen im Quiz suchen" placeholder="Im Quiz suchen …" value="${escape(search)}"><details class="se-advanced-set"><summary>Mehrere Fragen auf einmal</summary><p>Optional: 5 × 5 Felder pro Kategorie.</p><button type="button" class="se-quick" data-se-action="quickset">5 × 5 Schnellset erstellen</button></details>`}
   </aside>
   <main class="se-main">${!activeCategory?overview(all,cats):item?`${editorTabs}${editorPane==='answer'?answerEditor(item):'<section id="se-answer-tabpanel" role="tabpanel" aria-labelledby="se-editor-tab-answer" hidden></section>'}<div class="se-question-pane" id="se-question-tabpanel" role="tabpanel" aria-labelledby="se-editor-tab-question" ${editorPane==='answer'?'hidden':''}><div class="se-canvas-top"><div><button type="button" class="se-back" data-se-action="category-overview">‹ Kategorien</button><span class="se-eyebrow">${escape(activeCategory)}</span><h2>${escape(item.title)} · ${item.points} Punkte</h2><span class="se-muted">${escape(TEMPLATE_NAMES[item.scene.template])}</span></div><div class="se-inline"><label class="se-check"><input type="checkbox" data-se-snap ${snap?'checked':''}> Raster</label><button type="button" data-se-action="preview-device" aria-label="Vorschauformat wechseln">${previewDevice==='desktop'?'Handyansicht':'Desktopansicht'}</button><button type="button" data-se-action="open-menu" aria-label="Elementaktionen als Menü öffnen" aria-haspopup="menu" aria-expanded="${menu?'true':'false'}" title="Rechtsklick oder Menü">⋯ Menü</button><select data-se-reveal aria-label="Vorschaustufe">${Array.from({length:7},(_,i)=>`<option value="${i}" ${reveal===i?'selected':''}>${i===0?'Start':i===6?'Lösung':`Hinweis ${i}`}</option>`).join('')}</select></div></div>
    <div class="se-context-hint">${item.scene.template==='map'?'Tippe auf die Weltkarte, um den richtigen Zielpunkt zu markieren. Der Punkt ist verpflichtend. Die Frage bearbeitest du im Bereich Eigenschaften.':'Dieselbe Fragenfläche wie bei den Zuschauern. Im Bearbeitungsmodus ziehst du Elemente an ihre Position. PNG-, JPG- oder WebP-Dateien kannst du direkt auf die Fragenfläche ziehen. Auf vorhandene Bilder abgelegte Dateien ersetzen das Bild. Rechtsklick für Aktionen.'}</div><div class="se-stage-grid se-stage-grid--single"><section class="se-stage-card"><div class="se-audience-label"><span>${preview?'Live-Zuschauervorschau (nicht bearbeitbar)':'Bearbeitbare Zuschauerfläche'} · ${reveal===6?'Lösung':reveal?'Hinweis '+reveal:'Startansicht'}</span><button type="button" class="se-preview-toggle" data-se-action="toggle-preview" aria-pressed="${preview}">${preview?'✎ Jetzt bearbeiten':'◉ Ohne Markierungen ansehen'}</button></div><div class="se-canvas-wrap se-audience-preview se-audience-${previewDevice}">${preview?renderScene(publicScene(item.scene,reveal,reveal===6),{revealed:reveal===6,correctIndex:item.correct||0,mapView:mapCamera,mapSolution:reveal===6&&item.mapTargetSet?normalizePoint({x:item.mapTargetX,y:item.mapTargetY}):null}):renderScene(item.scene,{editing:true,selected:sel,revealed:false,correctIndex:item.correct||0,mapView:mapCamera,mapCanEdit:item.scene.template==='map',mapEditorPoint:item.mapTargetSet?normalizePoint({x:item.mapTargetX,y:item.mapTargetY}):null})}</div>${!preview&&reveal!==0?'<p class="se-muted">Aufdeckungsstufen kontrollierst du über „Ohne Markierungen ansehen“.</p>':''}</section></div>
    ${item.scene.template==='map'?'':`<div class="se-tools"><span>Hinzufügen:</span>${[['text','Text'],['image','Bild'],['shape','Form'],['choice','Antwort'],['order','Sortierfeld']].map(([kind,label])=>`<button type="button" data-se-action="add-element" data-kind="${kind}">+ ${label}</button>`).join('')}</div>`}
    <div class="se-mini"><span>Aufdecken: 0 = sofort · 1–5 = Hinweise · 6 = Lösung</span>${validateScene(item)?`<strong>${escape(validateScene(item))}</strong>`:'<strong>Layout bereit</strong>'}<span class="se-save-status">${escape(api.saveStatus?.()||'')}</span></div></div>`:`<section class="se-empty-category"><button type="button" class="se-back" data-se-action="category-overview">‹ Kategorien</button><span class="se-eyebrow">Kategorie</span><h2>${escape(activeCategory)}</h2><p>Hier gibt es noch keine Frage. Wähle einen Fragetyp oder lege eine einfache Frage an.</p><div class="se-start-templates">${[['text','Textfrage'],['multiple','Multiple Choice'],['estimate','Schätzfrage'],['image','Bildfrage'],['map','Karte auswählen'],['written','Alle schreiben'],['imposter','Imposter'],['quote','Zitat']].map(([type,label])=>`<button type="button" data-se-action="new" data-template="${type}">+ ${label}</button>`).join('')}</div></section>`}</main>
   ${item&&editorPane==='question'?`<aside class="se-inspector">${propsPanel(item)}</aside>`:''}</div>
   <input type="file" id="import-quiz" accept=".json,.brainquiz" hidden>${contextMenuHTML()}${libraryMenuHTML()}</div>`;
 }
 function draw(){
  if(redrawPending)return;
  redrawPending=true;
  requestAnimationFrame(()=>{
   redrawPending=false;
   const root=document.getElementById('se-root');
   if(!root)return;
   const parent=root.parentElement;
   const scrolling=['.se-questions','.se-category-nav','.se-inspector'].map(selector=>
    [selector,root.querySelector(selector)?.scrollTop||0]);
   const expanded=['.se-extras','.se-more-properties','.se-file-actions','.bq-editor-extras','.se-host-metadata']
    .filter(selector=>root.querySelector(selector+'[open]'));
   root.outerHTML=html();
   const editor=parent.querySelector('#se-root');
   for(const selector of expanded)editor.querySelector(selector)?.setAttribute('open','');
   for(const [selector,top] of scrolling){
    const element=editor.querySelector(selector);
    if(element)element.scrollTop=top;
   }
   mount(editor);
   if(menu)editor.querySelector('.se-context [role=menuitem]')?.focus({preventScroll:true});
  });
 }
 function choose(id,{issue=false}={}){
  flushDraft();
  const problem=issue?quizAudit(quiz()).errors.find(row=>row.id===id)?.reason||'':'';
  api.setSelected(id);mobileTab='canvas';editorPane=problem.includes('Antwort-Tab')?'answer':'question';
  sel='';menu=null;libraryMenu=null;preview=false;reveal=0;draw();
 }
 function updateField(field,value){const item=current(),el=find();if(!item)return;
  if(field==='mapPrompt'&&item.scene?.template==='map'){const heading=item.scene.elements.find(v=>v.kind==='text'&&v.role==='question');if(heading)heading.text=String(value).slice(0,950);item.prompt=String(value).slice(0,950);deferDraft();return;}
  if(field.startsWith('hint-')){const i=Number(field.slice(5));if(Number.isInteger(i)&&i>=0&&i<4){item.hints??=[];item.hints[i]=String(value).slice(0,220);}return;}
  if(field==='category'||field==='title'||field==='points'||field==='answer'||field==='answerText'||field==='answerImageAlt'||field==='acceptedAnswers'||field==='hostNotes'||field==='sourceUrl'||field==='sourcePatch'||field==='sourceCheckedOn'||field==='seconds'||field==='explanation'||field==='estimateTarget'||field==='estimateUnit'||field==='audioStart'||field==='audioDuration'||field==='imposterIndex'||field==='mapTargetX'||field==='mapTargetY'||field==='correct'){
   if(field==='correct')item.correct='ABCD'.indexOf(value);else item[field]=['points','seconds','estimateTarget','audioStart','audioDuration','imposterIndex','mapTargetX','mapTargetY'].includes(field)?Number(value):value;
    if(field==='answerText'&&!['multiple','order','estimate','map','imposter'].includes(item.type))item.answer=value;
  }else if(el){if(['x','y','w','h','font','step'].includes(field))el[field]=Number(value);else if(['text','alt','fill','bg','align','shape','role'].includes(field)){el[field]=value;if(field==='role'&&(value==='question'||value==='clue')){for(const other of item.scene.elements){if(other.id!==el.id&&other.role===value)other.role='content';}}}
   if(field==='x')el.x=Math.min(1000-el.w,Math.max(0,el.x));if(field==='y')el.y=Math.min(560-el.h,Math.max(0,el.y));if(field==='w'){el.w=Math.max(50,Math.min(1000-el.x,el.w));}if(field==='h')el.h=Math.max(30,Math.min(560-el.y,el.h));
   if(['x','y','w','h','font','step'].includes(field)){Object.assign(el,normalizeElement(el));}
  }
  if(field==='category'){activeCategory=item.category;}
  deferDraft();
  const target=document.querySelector(`.se-element[data-se-element="${sel}"]`);
  if(target&&el){if(field==='text'){const dest=target.querySelector('.se-content,.se-shape');if(dest)dest.textContent=el.text;}if(['x','y','w','h'].includes(field)){target.style.left=el.x/10+'%';target.style.top=el.y/5.6+'%';target.style.width=el.w/10+'%';target.style.height=el.h/5.6+'%';}if(field==='fill')target.style.color=el.fill;if(field==='bg')target.style.background=el.bg;if(field==='align')target.style.textAlign=el.align;if(field==='font')target.style.fontSize=`clamp(10px,${el.font/10}cqw,${el.font}px)`;}
 }
 function makeCategoryQuestion(name,template='text'){
  mobileTab='canvas';api.makeQuestion(name,template);sel='';preview=false;reveal=0;search='';draw();
 }
 function addCategory(raw){const name=assertNewCategory(categories(),raw);flushDraft();snapshot();quiz().categories=[...categories(),name];api.save();activeCategory=name;showCategoryForm=false;renamingCategory=false;categoryDraft='';search='';draw();}
 function renameCategory(raw){if(!activeCategory)return;const from=activeCategory;const name=assertNewCategory(categories(),raw,from);flushDraft();snapshot();quiz().categories=categories().map(c=>categoryKey(c)===categoryKey(from)?name:c);for(const question of quiz().questions){if(categoryKey(question.category)===categoryKey(from))question.category=name;}activeCategory=name;showCategoryForm=false;renamingCategory=false;categoryDraft='';api.save();draw();}
 function onAction(action,button){const item=current(),scene=item?.scene;if(action==='menu-close'){menu=null;draw();return;}if(action==='library-menu-close'){libraryMenu=null;draw();return;}if(action==='open-menu'){const r=document.querySelector('.se-canvas-wrap')?.getBoundingClientRect();menu={x:(r?.right||260)-225,y:(r?.top||120)+60};libraryMenu=null;draw();return;}if(!item&& !['audit','open-next-issue','batch-apply','batch-clear','reuse-question','preview-device','toggle-preview','mobile-tab','new','quickset','category-overview','category-form','category-form-cancel','category-select','category-preset','category-new-question','category-rename','category-remove','select','undo','redo','backup','library-open','library-delete','library-new','library-rename'].includes(action))return;menu=null;
 switch(action){
  case 'map-clear':{if(scene?.template!=='map'||!item?.mapTargetSet)return;flushDraft();snapshot();item.mapTargetSet=false;api.save();draw();return;}
  case 'audit':flushDraft();auditOpen=!auditOpen;draw();return;
  case 'open-next-issue':{const issues=quizAudit(quiz()).errors.filter(row=>row.id);if(!issues.length)return;const index=issues.findIndex(row=>row.id===item?.id),target=issues[(index+1)%issues.length];const chosen=quiz().questions.find(q=>q.id===target.id);if(!chosen)return;activeCategory=chosen.category;auditOpen=true;choose(chosen.id,{issue:true});return;}
  case 'batch-clear':selectedQuestions.clear();draw();return;
  case 'batch-apply':{flushDraft();const cat=document.querySelector('[data-se-batch-category]')?.value||undefined;const raw=document.querySelector('[data-se-batch-points]')?.value;const pts=raw?.trim()?Number(raw):undefined;if(cat===undefined&&pts===undefined)throw Error('Kategorie oder Punktzahl für die Auswahl festlegen.');snapshot();const count=changeSelectedQuestions(quiz(),selectedQuestions,{category:cat,points:pts});selectedQuestions.clear();api.save();if(cat&&item?.id&&categoryKey(item.category)!==categoryKey(activeCategory)){const left=questionsInCategory(quiz().questions,activeCategory);if(left.length)api.setSelected(left[0].id);}api.notice?.(`${count} Fragen aktualisiert.`);draw();return;}
  case 'reuse-question':{mobileTab='canvas';flushDraft();if(!activeCategory)throw Error('Wähle erst eine Kategorie.');snapshot();const copy=reuseQuestion(quiz(),button.dataset.id,activeCategory,api.newId());api.setSelected(copy.id);sel='';bankQuery='';api.save();api.notice?.('Frage übernommen. Original unverändert.');draw();return;}
  case 'preview-device':previewDevice=previewDevice==='desktop'?'mobile':'desktop';draw();return;
  case 'mobile-tab':{if(!['categories','canvas','properties'].includes(button.dataset.mobileTab))return;mobileTab=button.dataset.mobileTab;draw();return;}
  case 'editor-pane':{if(!item||!['question','answer'].includes(button.dataset.pane))return;flushDraft();editorPane=button.dataset.pane;mobileTab='canvas';sel='';preview=false;menu=null;libraryMenu=null;draw();requestAnimationFrame(()=>document.querySelector('.se-editor-pane-tabs [data-pane="'+editorPane+'"]')?.focus({preventScroll:true}));return;}
  case 'answer-image-remove':{if(!item?.answerImage)return;flushDraft();snapshot();item.answerImage='';item.answerImageAlt='';persist(true);return;}
  case 'undo':flushDraft();api.undo?.();sel='';draw();return;
  case 'redo':flushDraft();api.redo?.();sel='';draw();return;
  case 'select':{flushDraft();const chosen=quiz().questions.find(x=>x.id===button.dataset.id);if(chosen)activeCategory=chosen.category;choose(button.dataset.id,{issue:!!button.closest?.('.se-audit')});return;}
  case 'category-overview':flushDraft();selectedQuestions.clear();activeCategory='';sel='';menu=null;preview=false;search='';draw();return;
  case 'category-select':{mobileTab='canvas';selectedQuestions.clear();bankQuery='';const name=categories().find(c=>categoryKey(c)===categoryKey(button.dataset.category));if(!name)return;flushDraft();activeCategory=name;showCategoryForm=false;renamingCategory=false;const list=questionsInCategory(quiz().questions,name);if(list.length)api.setSelected(list[0].id);search='';sel='';preview=false;draw();return;}
  case 'category-preset':addCategory(button.dataset.category);return;
  case 'category-form':showCategoryForm=true;renamingCategory=false;categoryDraft='';draw();requestAnimationFrame(()=>document.querySelector('[data-se-category-name]')?.focus());return;
  case 'category-form-cancel':showCategoryForm=false;renamingCategory=false;categoryDraft='';draw();return;
  case 'category-rename':if(!activeCategory)return;renamingCategory=true;showCategoryForm=true;categoryDraft=activeCategory;draw();requestAnimationFrame(()=>document.querySelector('[data-se-category-name]')?.focus());return;
  case 'category-remove':{if(!activeCategory)return;const count=questionsInCategory(quiz().questions,activeCategory).length;if(!confirm(count?`Kategorie „${activeCategory}“ mit ${count} Frage${count===1?'':'n'} endgültig löschen?`:`Leere Kategorie „${activeCategory}“ löschen?`))return;flushDraft();snapshot();quiz().questions=(quiz().questions||[]).filter(q=>categoryKey(q.category)!==categoryKey(activeCategory));quiz().categories=categories().filter(x=>categoryKey(x)!==categoryKey(activeCategory));selectedQuestions=new Set([...selectedQuestions].filter(id=>(quiz().questions||[]).some(q=>q.id===id)));activeCategory='';api.save();draw();return;}
  case 'library-open':{if(libraryMenu?.kind==='category'&&libraryMenu.category){const name=categories().find(c=>categoryKey(c)===categoryKey(libraryMenu.category));libraryMenu=null;if(!name)return;activeCategory=name;const list=questionsInCategory(quiz().questions,name);if(list.length)api.setSelected(list[0].id);draw();return;}if(libraryMenu?.kind==='question'&&libraryMenu.id){const chosen=quiz().questions.find(x=>x.id===libraryMenu.id);libraryMenu=null;if(chosen){activeCategory=chosen.category;choose(chosen.id);}return;}return;}
  case 'library-new':{if(libraryMenu?.kind==='category'&&libraryMenu.category){const name=categories().find(c=>categoryKey(c)===categoryKey(libraryMenu.category));libraryMenu=null;if(name){activeCategory=name;makeCategoryQuestion(name,suggestedTemplate(name));}return;}return;}
  case 'library-rename':{if(libraryMenu?.kind==='category'&&libraryMenu.category){activeCategory=libraryMenu.category;libraryMenu=null;renamingCategory=true;showCategoryForm=true;categoryDraft=activeCategory;draw();requestAnimationFrame(()=>document.querySelector('[data-se-category-name]')?.focus());return;}return;}
  case 'library-delete':{if(libraryMenu?.kind==='question'&&libraryMenu.id){const target=quiz().questions.find(x=>x.id===libraryMenu.id);libraryMenu=null;if(!target)return;if(!confirm(`Frage „${target.title}“ löschen?`))return;flushDraft();snapshot();quiz().questions=(quiz().questions||[]).filter(q=>q.id!==target.id);selectedQuestions.delete(target.id);if(categoryKey(activeCategory)===categoryKey(target.category)){const remaining=questionsInCategory(quiz().questions,activeCategory);if(remaining.length)api.setSelected(remaining[0].id);}api.save();draw();return;}if(libraryMenu?.kind==='category'&&libraryMenu.category){activeCategory=libraryMenu.category;libraryMenu=null;onAction('category-remove',button);return;}return;}
  case 'category-new-question':{const name=categories().find(c=>categoryKey(c)===categoryKey(button.dataset.category));if(!name)return;flushDraft();activeCategory=name;showCategoryForm=false;makeCategoryQuestion(name,suggestedTemplate(name));return;}
  case 'new':{if(!activeCategory){onAction('category-form',button);return;}makeCategoryQuestion(activeCategory,button.dataset.template||suggestedTemplate(activeCategory));return;}
  case 'quickset':{const raw=prompt('Kategorien (durch Kommas getrennt)', categories().join(', ')||'Champions, Lorefragen, Schätzen, Splash-Art, Fähigkeiten');if(raw===null)return;const cats=[...new Set(raw.split(',').map(s=>s.trim()).filter(Boolean))].slice(0,10);if(!cats.length)return;api.quickset(cats);quiz().categories=collectCategories(quiz().categories,quiz().questions);activeCategory=cats[0];sel='';draw();return;}
  case 'copy-q':{const targetId=libraryMenu?.kind==='question'?libraryMenu.id:undefined;libraryMenu=null;api.copyQuestion(targetId);sel='';draw();return;}
  case 'delete-q':if(!confirm(`Frage „${item.title}“ löschen?`))return;api.deleteQuestion();const remaining=questionsInCategory(quiz().questions,activeCategory);if(remaining.length)api.setSelected(remaining[0].id);sel='';draw();return;
  case 'backup':api.backup();return;
  case 'focus-content':{draw();requestAnimationFrame(()=>{const input=document.querySelector('[data-se-field="'+(find()?.kind==='image'?'alt':'text')+'"]');if(input){input.focus();input.select?.();}});return;}
  case 'center-x':case 'center-y':{const el=find();if(!el)return;snapshot();if(action==='center-x')el.x=Math.round((1000-el.w)/2);else el.y=Math.round((560-el.h)/2);persist(true);return;}
  case 'toggle-preview':flushDraft();preview=!preview;sel='';draw();return;
  case 'preview':flushDraft();preview=!preview;draw();return;
  case 'add-element':{if(scene.elements.length>=40)throw Error('Maximal 40 Layoutelemente.');const kind=button.dataset.kind;if(scene.template==='multiple'&&kind==='choice'&&scene.elements.filter(x=>x.kind==='choice').length>=4)throw Error('Die A/B/C/D-Vorlage hat vier Antwortfelder.');snapshot();const n=scene.elements.filter(x=>x.kind===kind).length;const w=kind==='image'?350:kind==='shape'?230:kind==='choice'?350:kind==='order'?350:490,h=kind==='image'?195:kind==='shape'?90:85;const spot=findInsertion(scene.elements,w,h);const itemEl=element(kind,{...spot,w,h,text:kind==='choice'?`Antwort ${'ABCD'[n%4]}`:kind==='order'?`Eintrag ${letterList[n]||'A'}`:kind==='text'?'Neuer Text':'',letter:kind==='choice'?'ABCD'[n%4]:kind==='order'?letterList[n]:''});scene.elements.push(itemEl);if(kind==='order'&&!scene.sortCorrect.includes(itemEl.letter))scene.sortCorrect.push(itemEl.letter);sel=itemEl.id;persist(true);return;}
  case 'remove':{const el=find();if(!el)return;snapshot();scene.elements=scene.elements.filter(x=>x.id!==sel);if(el.kind==='order')scene.sortCorrect=scene.sortCorrect.filter(k=>k!==el.letter);sel='';persist(true);return;}
  case 'duplicate':{const el=find();if(!el)return;if(['choice','order'].includes(el.kind))throw Error('Antwort- und Sortierfelder bitte über die Vorlage verwalten.');snapshot();const copy=element(el.kind,{...el,role:'content',id:undefined,x:Math.min(el.x+25,1000-el.w),y:Math.min(el.y+25,560-el.h)});scene.elements.push(copy);sel=copy.id;persist(true);return;}
  case 'layer-front':{const idx=scene.elements.findIndex(x=>x.id===sel);if(idx<0)return;snapshot();scene.elements.push(scene.elements.splice(idx,1)[0]);persist(true);return;}
  case 'layer-back':{const idx=scene.elements.findIndex(x=>x.id===sel);if(idx<0)return;snapshot();scene.elements.unshift(scene.elements.splice(idx,1)[0]);persist(true);return;}
  case 'sort-up':case 'sort-down':{const i=Number(button.dataset.pos),j=i+(action==='sort-up'?-1:1);if(i<0||j<0||j>=scene.sortCorrect.length)return;snapshot();[scene.sortCorrect[i],scene.sortCorrect[j]]=[scene.sortCorrect[j],scene.sortCorrect[i]];persist(true);return;}
  case 'sort-add':{const known=new Set(scene.elements.filter(v=>v.kind==='order').map(v=>v.letter));const k=letterList.find(l=>!known.has(l));if(!k)return;snapshot();const spot=findInsertion(scene.elements,416,70);scene.elements.push(element('order',{letter:k,text:`Eintrag ${k}`,...spot,w:416,h:70,font:21,bg:'#343644'}));scene.sortCorrect.push(k);persist(true);return;}
  case 'sort-remove':{if(scene.sortCorrect.length<=3)return;snapshot();const last=scene.elements.filter(v=>v.kind==='order').map(v=>v.letter).sort().at(-1);scene.sortCorrect=scene.sortCorrect.filter(key=>key!==last);scene.elements=scene.elements.filter(v=>v.kind!=='order'||v.letter!==last);sel='';persist(true);return;}
 }
 }
 async function applyImageFiles(files,{kind='image',targetId='',point=null}={}){
  const item=current();if(!item||!files?.length)return;
  const questionId=item.id,scene=item.scene;
  if(kind==='answer-image'){
   if(files.length!==1)throw Error('Für die Antwort bitte genau eine Bilddatei auswählen.');
   const converted=await api.optimizeImage(files[0],1200,260000);
   if(current()?.id!==questionId||current()?.scene!==scene)throw Error('Die Frage wurde während des Bild-Uploads gewechselt.');
   flushDraft();snapshot();current().answerImage=converted;if(!current().answerImageAlt?.trim())current().answerImageAlt=String(files[0].name||'Antwortbild').replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').slice(0,140);persist(true);return;
  }
  if(kind==='correct-icon'){
   if(files.length!==1)throw Error('Für das Originalbild bitte genau eine Datei ablegen.');
   const converted=await api.optimizeImage(files[0],500,65000);
   if(current()?.id!==questionId||current()?.scene!==scene)throw Error('Die Frage wurde während des Uploads verändert. Bitte erneut versuchen.');
   flushDraft();snapshot();current().correctIcon=converted;persist(true);
   return;
  }
  if(kind!=='image'||preview||scene.template==='map')throw Error('Bilder bitte in einer bearbeitbaren Frage ablegen.');
  const target=targetId?scene.elements.find(el=>el.id===targetId):null;
  if(targetId&&(!target||target.kind!=='image'))throw Error('Das gewählte Bildelement ist nicht mehr vorhanden.');
  if(scene.elements.length+files.length-(target?1:0)>40)throw Error('Maximal 40 Layoutelemente pro Frage.');
  // Finish all conversions before any mutation: an invalid file must not leave partial images.
  const converted=await Promise.all(files.map(file=>api.optimizeImage(file,1150,125000)));
  if(current()?.id!==questionId||current()?.scene!==scene)throw Error('Die Frage wurde während des Uploads verändert. Bitte erneut versuchen.');
  const resolved=targetId?scene.elements.find(el=>el.id===targetId):null;
  if(targetId&&(!resolved||resolved.kind!=='image'))throw Error('Das Bildelement wurde während des Uploads entfernt.');
  const existing=scene.elements.reduce((sum,el)=>sum+(el.src?.length||0),0);
  const bytes=existing-(resolved?.src?.length||0)+converted.reduce((sum,src)=>sum+src.length,0);
  if(bytes>1200000)throw Error('Zu viele Bilddaten in dieser Frage (maximal 1,2 MB). Bitte kleinere oder weniger Bilder verwenden.');
  flushDraft();snapshot();
  if(resolved){resolved.src=converted[0];resolved.alt=files[0].name.slice(0,100);sel=resolved.id;}
  for(let i=resolved?1:0;i<converted.length;i++){
   const position=i===(resolved?1:0)&&point?point:findInsertion(scene.elements,350,195);
   const created=element('image',{...position,w:350,h:195,src:converted[i],alt:files[i].name.slice(0,100)});
   scene.elements.push(created);sel=created.id;
  }
  persist(true);
 }
 async function onUpload(input){
  const file=input.files?.[0],kind=input.dataset.seUpload;if(!file)return;
  if(kind==='image'||kind==='correct-icon'||kind==='answer-image'){
   await applyImageFiles([file],{kind,targetId:kind==='image'?find()?.id||'':''});
   return;
  }
  if(kind!=='audio')return;
  const item=current();if(!item)return;
  const questionId=item.id,converted=await api.optimizeAudio(file,item.audioStart||0,item.audioDuration||8);
  if(current()?.id!==questionId)throw Error('Die Frage wurde während des Uploads gewechselt. Bitte die Datei erneut auswählen.');
  flushDraft();snapshot();current().audio=converted;persist(true);
 }
 function mount(root){if(!root||root.dataset.bound)return;root.dataset.bound='yes';
  const map=root.querySelector('[data-map-viewport]');
  if(map){
   const questionId=current()?.id;
   mountMapViewport(map,{
    getView:()=>mapCamera,setView:v=>{mapCamera=v;},
    canPick:editorPane==='question'&&!preview&&current()?.scene?.template==='map',
    onPick:point=>{
     const item=current();if(preview||item?.id!==questionId||item.scene?.template!=='map')return;
     flushDraft();snapshot();item.mapTargetX=point.x;item.mapTargetY=point.y;item.mapTargetSet=true;
     api.save();draw();
    }
   });
  }
  // File drag-and-drop is independent of pointer-based element moving and resizing.
  const clearFileDrop=()=>root.querySelectorAll('.is-file-drop').forEach(node=>node.classList.remove('is-file-drop'));
  const fileDropZone=event=>event.target.closest?.('[data-se-upload-zone],.se-scene');
  const canFileDrop=zone=>Boolean(zone&&root.contains(zone)&&current()&&
   (zone.hasAttribute('data-se-upload-zone')||(!preview&&current().scene.template!=='map')));
  root.addEventListener('dragover',event=>{
   if(!hasDraggedFiles(event.dataTransfer))return;
   event.preventDefault();clearFileDrop();
   const zone=fileDropZone(event),allowed=canFileDrop(zone);
   if(allowed)zone.classList.add('is-file-drop');
   if(event.dataTransfer)event.dataTransfer.dropEffect=allowed?'copy':'none';
  });
  root.addEventListener('dragleave',event=>{if(!root.contains(event.relatedTarget))clearFileDrop();});
  root.addEventListener('drop',async event=>{
   if(!hasDraggedFiles(event.dataTransfer))return;
   event.preventDefault();clearFileDrop();
   const zone=fileDropZone(event);
   if(!canFileDrop(zone))return;
   try{
    const files=imageFilesFromDrop(event.dataTransfer);
    if(zone.hasAttribute('data-se-upload-zone')){
     const kind=zone.dataset.seUploadZone;
     await applyImageFiles(files,{kind,targetId:kind==='image'?find()?.id||'':''});
    }else{
     const node=event.target.closest?.('[data-se-element]');
     const existing=current()?.scene?.elements.find(el=>el.id===node?.dataset.seElement);
     const point=imageDropPoint(zone.getBoundingClientRect(),event.clientX,event.clientY);
     await applyImageFiles(files,{targetId:existing?.kind==='image'?existing.id:'',point});
    }
   }catch(error){api.error(error);}
  });
  // Allow screenshots pasted from the clipboard directly into the Answer editor.
  root.addEventListener('paste',async event=>{
   if(editorPane!=='answer'||!current()||!event.target.closest?.('.se-answer-tab-content'))return;
   const image=[...(event.clipboardData?.items||[])].find(item=>item.kind==='file'&&/^(image\/png|image\/jpeg|image\/webp)$/.test(item.type));
   const file=image?.getAsFile?.();if(!file)return;
   event.preventDefault();
   try{await applyImageFiles([file],{kind:'answer-image'});api.notice?.('Bild aus der Zwischenablage eingefügt.');}catch(error){api.error(error);}
  });
  root.addEventListener('contextmenu',event=>{const libraryNode=event.target.closest('[data-se-library]');if(libraryNode){event.preventDefault();const rect=libraryNode.getBoundingClientRect();libraryMenu={kind:libraryNode.dataset.seLibrary,x:event.clientX||rect.left+18,y:event.clientY||rect.top+18,id:libraryNode.dataset.id||'',category:libraryNode.dataset.category||''};if(libraryNode.dataset.id){const chosen=quiz().questions.find(x=>x.id===libraryNode.dataset.id);if(chosen)activeCategory=chosen.category;}draw();requestAnimationFrame(()=>document.querySelector('.se-context [role=menuitem]')?.focus());return;}const canvas=event.target.closest('.se-scene');if(!canvas)return;event.preventDefault();libraryMenu=null;const node=event.target.closest('[data-se-element]');sel=node?.dataset.seElement||'';const rect=(node||canvas).getBoundingClientRect();menu={x:event.clientX||rect.left+Math.min(40,rect.width/2),y:event.clientY||rect.top+Math.min(40,rect.height/2)};draw();});
  root.addEventListener('submit',event=>{if(!event.target.matches('[data-se-category-form]'))return;event.preventDefault();try{const raw=event.target.querySelector('[data-se-category-name]')?.value||'';if(renamingCategory)renameCategory(raw);else addCategory(raw);}catch(err){api.error(err);}});
  root.addEventListener('click',event=>{if((menu||libraryMenu)&&!event.target.closest('.se-context')){menu=null;libraryMenu=null;if(!event.target.closest('[data-se-action],[data-se-element]')){draw();return;}}const elementNode=event.target.closest('[data-se-element]');const control=event.target.closest('[data-se-action]');if(control){event.preventDefault();try{onAction(control.dataset.seAction,control)}catch(err){api.error(err)}return;}if(elementNode&&!preview&&!event.target.closest('[data-se-resize]')){sel=elementNode.dataset.seElement;draw();}});
  root.addEventListener('focusout',event=>{if(event.target===trackedInput)trackedInput=null;});
  root.addEventListener('change',async event=>{const t=event.target;try{if(t.matches('[data-se-multi]')){if(t.checked)selectedQuestions.add(t.dataset.seMulti);else selectedQuestions.delete(t.dataset.seMulti);draw();return;}if(t.matches('.se-question-bank')){bankOpen=t.open;return;}if(t.matches('[data-se-template]')){setType(t.value);return;}if(t.matches('[data-se-roundmode]')){flushDraft();if(!current())return;snapshot();current().roundMode=t.value==='written'?'written':'buzzer';api.save();draw();return;}if(t.matches('[data-se-scoremode]')){flushDraft();snapshot();quiz().scoreMode=t.value==='individual'?'individual':'team';api.save();draw();return;}if(t.matches('[data-se-reveal]')){reveal=Number(t.value);draw();return;}if(t.matches('[data-se-snap]')){snap=t.checked;return;}if(t.matches('[data-se-upload]')){try{await onUpload(t);}finally{t.value='';}return;}if(t.matches('[data-se-field]')){if(trackedInput!==t){snapshot();trackedInput=t;}updateField(t.dataset.seField,t.value);flushDraft();draw();}}catch(err){api.error(err)}});
  root.addEventListener('input',event=>{const t=event.target;if(t.matches('[data-se-search]')){search=t.value;const active=document.activeElement;const pos=active.selectionStart;draw();requestAnimationFrame(()=>{const next=document.querySelector('[data-se-search]');next?.focus();next?.setSelectionRange(pos,pos);});return;}if(t.matches('[data-se-bank-search]')){bankQuery=t.value;bankOpen=true;const position=t.selectionStart;draw();requestAnimationFrame(()=>{const next=document.querySelector('[data-se-bank-search]');next?.focus();next?.setSelectionRange(position,position);});return;}if(t.matches('[data-se-category-name]')){categoryDraft=t.value;return;}if(t.matches('[data-se-quiztitle]')){if(trackedInput!==t){snapshot();trackedInput=t;}quiz().title=t.value.slice(0,100);const heading=root.querySelector('.se-board-context>strong');if(heading){heading.textContent=quiz().title||'Unbenanntes Quizbrett';heading.title=quiz().title;}deferDraft();return;}if(t.matches('[data-se-field]')){if(trackedInput!==t){snapshot();trackedInput=t;}updateField(t.dataset.seField,t.value);refreshAnswerPreview();}});
  // Long press matches the right-click actions on touch/pen, including on an element.
  root.addEventListener('pointerdown',event=>{
   if(preview||!['touch','pen'].includes(event.pointerType)||event.button!==0)return;
   const node=event.target.closest('[data-se-element]'),canvas=event.target.closest('.se-scene');if(!canvas)return;
   clearTimeout(touchTimer);touchStart={x:event.clientX,y:event.clientY,id:node?.dataset.seElement||'',pointerId:event.pointerId};
   touchTimer=setTimeout(()=>{
    touchTimer=null;if(!touchStart)return;
    if(drag){try{drag.node.releasePointerCapture(touchStart.pointerId)}catch{}api.discardSnapshot?.();drag=null;}
    sel=touchStart.id;menu={x:touchStart.x,y:touchStart.y};touchStart=null;draw();
   },620);
  });
  root.addEventListener('pointermove',event=>{if(touchStart&&Math.hypot(event.clientX-touchStart.x,event.clientY-touchStart.y)>10){clearTimeout(touchTimer);touchTimer=null;touchStart=null;}});
  for(const type of ['pointerup','pointercancel'])root.addEventListener(type,()=>{clearTimeout(touchTimer);touchTimer=null;touchStart=null;});
  root.addEventListener('pointerdown',event=>{if(preview||event.button!==0)return;const node=event.target.closest('[data-se-element]');if(!node)return;event.preventDefault();sel=node.dataset.seElement;const el=find();if(!el)return;const rect=root.querySelector('.se-scene').getBoundingClientRect();snapshot();drag={node,el,rect,startX:event.clientX,startY:event.clientY,x:el.x,y:el.y,w:el.w,h:el.h,resizing:!!event.target.closest('[data-se-resize]')};node.setPointerCapture(event.pointerId);node.classList.add('is-selected');});
  root.addEventListener('pointermove',event=>{if(!drag)return;const {node,el,rect,startX,startY}=drag;let dx=(event.clientX-startX)/rect.width*1000,dy=(event.clientY-startY)/rect.height*560;if(snap){dx=Math.round(dx/10)*10;dy=Math.round(dy/10)*10;}if(drag.resizing){el.w=Math.max(50,Math.min(1000-el.x,drag.w+dx));el.h=Math.max(30,Math.min(560-el.y,drag.h+dy));node.style.width=el.w/10+'%';node.style.height=el.h/5.6+'%';}else{el.x=Math.max(0,Math.min(1000-el.w,drag.x+dx));el.y=Math.max(0,Math.min(560-el.h,drag.y+dy));node.style.left=el.x/10+'%';node.style.top=el.y/5.6+'%';}});
  const finish=(cancelled=false)=>{if(!drag)return;const old=drag;drag=null;if(cancelled){old.el.x=old.x;old.el.y=old.y;old.el.w=old.w;old.el.h=old.h;}if(cancelled||(old.el.x===old.x&&old.el.y===old.y&&old.el.w===old.w&&old.el.h===old.h)){api.discardSnapshot?.();draw();return;}persist(true);};root.addEventListener('pointerup',()=>finish(false));root.addEventListener('pointercancel',()=>finish(true));
  root.addEventListener('keydown',event=>{
   if((menu||libraryMenu)&&event.key==='Escape'){event.preventDefault();menu=null;libraryMenu=null;draw();requestAnimationFrame(()=>document.querySelector(sel?`[data-se-element="${sel}"]`:'.se-scene')?.focus({preventScroll:true}));return;}
   if(event.target.matches?.('.se-editor-pane-tabs [role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
     event.preventDefault();const pane=event.key==='Home'?'question':event.key==='End'?'answer':event.target.dataset.pane==='question'?'answer':'question';
     onAction('editor-pane',{dataset:{pane}});return;
    }
   if(menu&&event.target.closest('.se-context')){
    const items=[...root.querySelectorAll('.se-context [role="menuitem"]')],index=items.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&items.length){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();return;}
   }
   if((event.key==='F10'&&event.shiftKey||event.key==='ContextMenu')&&!preview){
    const node=event.target.closest('[data-se-element]'),canvas=event.target.closest('.se-scene');
    if(node||canvas){event.preventDefault();sel=node?.dataset.seElement||'';const r=(node||canvas).getBoundingClientRect();menu={x:r.left+Math.min(48,r.width/2),y:r.top+Math.min(48,r.height/2)};draw();return;}
   }
const editable=['TEXTAREA','INPUT','SELECT'].includes(event.target.tagName);if(!editable&&['Enter',' '].includes(event.key)&&event.target.matches?.('[data-se-element]')){event.preventDefault();sel=event.target.dataset.seElement;draw();return;}if((event.ctrlKey||event.metaKey)&&!editable&&event.key.toLowerCase()==='d'&&sel){event.preventDefault();onAction('duplicate');return;}if((event.key==='Delete'||event.key==='Backspace')&&!editable&&sel){event.preventDefault();onAction('remove');return;}if(event.key==='Escape'&&!editable&&sel){sel='';draw();return;}if((event.ctrlKey||event.metaKey)&&!editable&&event.key.toLowerCase()==='z'){event.preventDefault();onAction(event.shiftKey?'redo':'undo');return;}if(!sel||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)||editable)return;event.preventDefault();const el=find();if(!el)return;snapshot();const n=event.shiftKey?20:5;if(event.key==='ArrowLeft')el.x=Math.max(0,el.x-n);if(event.key==='ArrowRight')el.x=Math.min(1000-el.w,el.x+n);if(event.key==='ArrowUp')el.y=Math.max(0,el.y-n);if(event.key==='ArrowDown')el.y=Math.min(560-el.h,el.y+n);persist(true);});
 }
 return {html,render:()=>html(),mount,flush:flushDraft,
  focusIssue:id=>{const item=quiz()?.questions?.find(v=>v.id===id);if(!item)return;activeCategory=item.category;auditOpen=true;choose(id,{issue:true});},
  reset:()=>{clearTimeout(draftTimer);draftTimer=null;mapCamera={...DEFAULT_MAP_VIEW};mapQuestionId='';clearTimeout(touchTimer);touchTimer=null;touchStart=null;drag=null;trackedInput=null;savePending=false;sel='';reveal=0;preview=false;menu=null;libraryMenu=null;selectedQuestions.clear();bankQuery='';bankOpen=false;activeCategory='';search='';showCategoryForm=false;renamingCategory=false;categoryDraft='';auditOpen=false;mobileTab='canvas';editorPane='question';},getSelected:()=>sel};
}
