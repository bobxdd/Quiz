/* Pure, host-only editor helpers. No public question payload is modified here. */
import {categoryKey,boardRoundOf,boardLayoutIssues,roundQuestions,roundCategories} from './category-model.mjs';
import {validateQuestion} from './core.mjs';
import {jokerSetupSummary} from './joker-system.mjs';

export function selectionSummary(quiz, ids) {
 const unique=new Set(ids||[]);
 const questions=(quiz?.questions||[]).filter(q=>unique.has(q.id));
 return {count:questions.length, ids:questions.map(q=>q.id)};
}
export function changeSelectedQuestions(quiz, ids, {category,points}={}) {
 const selected=new Set(ids||[]);
 if(!selected.size)throw Error('Bitte zuerst mindestens eine Frage auswählen.');
 if(category!==undefined && !(quiz.categories||[]).some(c=>categoryKey(c)===categoryKey(category)))throw Error('Bitte eine vorhandene Kategorie wählen.');
 if(points!==undefined && (!Number.isInteger(Number(points))||Number(points)<0||Number(points)>10000))throw Error('Punkte müssen eine ganze Zahl zwischen 0 und 10.000 sein.');
 if(category!==undefined){
  const rounds=new Set((quiz.questions||[]).filter(q=>selected.has(q.id)).map(boardRoundOf));
  for(const round of rounds){
   const questions=roundQuestions(quiz,round),names=roundCategories(quiz,round);
   const count=questions.filter(q=>selected.has(q.id)||categoryKey(q.category)===categoryKey(category)).length;
   if(count>6)throw Error('Die Zielkategorie würde mehr als sechs Fragen enthalten.');
   if(!names.some(name=>categoryKey(name)===categoryKey(category))&&names.length>=6)throw Error('Pro Spielbrett sind sechs Kategorien möglich.');
  }
 }
 let count=0;
 for(const q of quiz.questions||[]){if(!selected.has(q.id))continue;if(category!==undefined)q.category=category;if(points!==undefined)q.points=Number(points);count++;}
 if(!count)throw Error('Die ausgewählten Fragen sind nicht mehr vorhanden.');
 return count;
}
export function reuseQuestion(quiz, sourceId, destination, newId) {
 const source=quiz.questions?.find(q=>q.id===sourceId);
 if(!source)throw Error('Frage wurde nicht gefunden.');
 if(!(quiz.categories||[]).some(c=>categoryKey(c)===categoryKey(destination)))throw Error('Zielkategorie existiert nicht.');
 if(quiz.questions.length>=180)throw Error('Maximal 180 Fragen pro Quiz.');
 if(!newId||quiz.questions.some(q=>q.id===newId))throw Error('Ungültige neue Fragen-ID.');
 const copy=structuredClone(source);copy.id=newId;copy.title=(source.title||'Frage').slice(0,86)+' (Kopie)';copy.category=destination;
 quiz.questions.push(copy);return copy;
}
export function quizAudit(quiz) {
 const questions=quiz?.questions||[], errors=boardLayoutIssues(quiz), warnings=[];
 if(!questions.length)errors.push({id:null,label:'Quiz',reason:'Noch keine Fragen angelegt.'});
 const seenTitles=new Set(), seenTiles=new Set();
 for(const q of questions){
  const label=`${q.category||'Ohne Kategorie'} · ${q.title||'Unbenannte Frage'}`;
  const problem=validateQuestion(q,quiz.scoreMode);
  if(problem)errors.push({id:q.id,label,reason:problem});
  const titleKey=`${boardRoundOf(q)}|${categoryKey(q.category)}|${String(q.title||'').trim().toLocaleLowerCase('de')}`;
  if(seenTitles.has(titleKey))warnings.push({id:q.id,label,reason:'Fragentitel ist in dieser Kategorie doppelt.'});seenTitles.add(titleKey);
  const tileKey=`${boardRoundOf(q)}|${categoryKey(q.category)}|${q.points}`;
  if(seenTiles.has(tileKey))warnings.push({id:q.id,label,reason:'Mehrere Fragen haben denselben Punktwert in dieser Kategorie.'});seenTiles.add(tileKey);
 }
 const {config:joker,fields:requested,available,missing}=jokerSetupSummary(quiz);
 if(quiz?.balanceBoard&&roundQuestions(quiz,3).length<2*(quiz.teams?.length||0)){
  warnings.push({id:null,label:'Ausgleichs-Board',reason:'Mit '+2*quiz.teams.length+' Feldern hat jedes der '+quiz.teams.length+' Teams eine Frage und ein Feld zum Streichen.'});
 }
 if(joker.enabled){
  if(quiz?.scoreMode==='individual')errors.push({id:null,label:'Joker',reason:'Joker benötigen die Teamwertung.'});
  if(missing)warnings.push({id:null,label:'Joker-Fundfelder',reason:available+' von '+requested+' gewünschten Funden können auf Buzzerfragen in Runde 1 und 2 verteilt werden.'});
  const withoutHint=questions.filter(q=>[1,2].includes(boardRoundOf(q))&&!String(q.oracleHint||'').trim()&&!q.hints?.some(h=>String(h||'').trim()));
  if(withoutHint.length)warnings.push({id:withoutHint[0].id,label:'Oracle Lens',reason:withoutHint.length+' Frage(n) besitzen noch keinen Team- oder allgemeinen Hinweis. Oracle Lens wäre dort nicht nutzbar.'});
 }
 return {errors,warnings,ready:errors.length===0,questionCount:questions.length};
}

// Round- and room-scoped action leases prevent duplicate host clicks while a
// network request is pending. A finally release always permits legitimate retry.
export function createActionLease() {
 const busy=new Set();
 return {async run(key,fn){if(busy.has(key))return false;busy.add(key);try{await fn();return true;}finally{busy.delete(key);}},isBusy:key=>busy.has(key)};
}
function checkEmbeddedMedia(kind,src){
 return new Promise(resolve=>{
  const media=kind==='Audio'?document.createElement('audio'):new Image();
  const finish=ok=>{
   clearTimeout(timeout);
   media.onload=media.onloadeddata=media.onerror=null;
   resolve(ok);
  };
  const timeout=setTimeout(()=>finish(false),6000);
  if(kind==='Audio'){
   media.preload='auto';
   media.onloadeddata=()=>finish(true);
  }else media.onload=()=>finish(true);
  media.onerror=()=>finish(false);
  media.src=src;
 });
}

export async function checkQuizMedia(quiz){
 const checked=new Map(),failures=[];
 for(const question of quiz.questions){
  const images=[question.image,question.answerImage,question.correctIcon,
   ...(question.icons||[]),...(question.blocks||[]).map(block=>block.image),
   ...(question.scene?.elements||[]).map(element=>element.src)];
  const assets=[...images.filter(Boolean).map(src=>['Bild',src])];
  if(question.audio)assets.push(['Audio',question.audio]);
  for(const [kind,src] of assets){
   if(!checked.has(src))checked.set(src,await checkEmbeddedMedia(kind,src));
   if(!checked.get(src))failures.push({title:question.title,kind});
  }
 }
 return {checked:checked.size,failures};
}
