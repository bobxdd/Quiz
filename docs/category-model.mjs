// Categories are independent of question types and may be empty.
// Preserve legacy quiz files that stored only question.category strings.
export const CATEGORY_SUGGESTIONS = Object.freeze([
  {name:'Champions',description:'Champions erkennen und zuordnen',template:'text'},
  {name:'Emoji-Teamrunde',description:'Champions im Team mit Emojis erklären und erraten',template:'team-emoji'},
  {name:'Champion zeichnen',description:'Eine Person zeichnet den geheimen Champion, das Team rät',template:'team-draw'},
  {name:'Sortieren',description:'Gemischte Einträge nach einem Sortierauftrag ordnen und abgeben',template:'order'},
  {name:'Lorefragen',description:'Runeterra, Geschichten und Hintergründe',template:'text'},
  {name:'Schätzen',description:'Zahlen und Werte schätzen',template:'estimate'},
  {name:'Splash-Art',description:'Bild- und Detailfragen',template:'image'},
  {name:'Fähigkeiten',description:'Abilities und Imposter',template:'imposter'},
  {name:'Items',description:'Gegenstände und Effekte',template:'text'},
  {name:'Zitate',description:'Champion-Zitate',template:'quote'},
  {name:'Sounds',description:'Audio- und Login-Sounds',template:'audio'},
  {name:'Karten',description:'Auf einer Karte den richtigen Ort markieren',template:'map'},
  {name:'Alle antworten',description:'Jeder schreibt zuerst eine geheime Antwort',template:'written'}
]);
export const MAX_CATEGORIES=180;
export function cleanCategoryName(value){return String(value??'').trim().replace(/\s+/g,' ').slice(0,70);}
export function categoryKey(value){return cleanCategoryName(value).toLocaleLowerCase('de');}
export function collectCategories(stored,questions=[]){
 const entries=[];const seen=new Set();
 const add=value=>{const name=cleanCategoryName(value),key=categoryKey(name);if(!name||seen.has(key)||entries.length>=MAX_CATEGORIES)return;seen.add(key);entries.push(name);};
 if(Array.isArray(stored))stored.forEach(add);
 if(Array.isArray(questions))questions.forEach(q=>add(q?.category));
 return entries;
}
export function questionsInCategory(questions,category){return (questions||[]).filter(q=>categoryKey(q?.category)===categoryKey(category));}
export const boardRoundOf=question=>[2,3].includes(Number(question?.boardRound))?Number(question.boardRound):1;
export const roundQuestions=(quiz,round=1)=>(quiz?.questions||[]).filter(question=>boardRoundOf(question)===Number(round));
export function roundCategories(quiz,round=1){
 const stored=quiz?.roundCategories?.[round]??(Number(round)===1?quiz?.categories:[]);
 return collectCategories(stored,roundQuestions(quiz,round));
}
export function boardLayoutIssues(quiz){
 const issues=[];
 for(const round of [1,2,...(quiz?.balanceBoard?[3]:[])]){
  const categories=roundCategories(quiz,round),questions=roundQuestions(quiz,round);
  if(categories.length>6)issues.push({id:null,label:'Runde '+round,reason:'Maximal sechs Kategorien pro Spielbrett. Kategorien ins andere Brett verschieben.'});
  for(const category of categories){
   const list=questionsInCategory(questions,category);
   if(list.length>6)issues.push({id:list[6].id,label:'Runde '+round+' · '+category,reason:'Maximal sechs Fragen je Kategorie. Fragen ins andere Brett verschieben.'});
  }
 }
 if(quiz?.balanceBoard){
  const third=roundQuestions(quiz,3),teamCount=(quiz?.teams||[]).length;
  if(quiz.scoreMode==='individual')issues.push({id:null,label:'Ausgleichs-Board',reason:'Das Ausgleichs-Board benötigt die Teamwertung.'});
  if(!roundQuestions(quiz,2).length)issues.push({id:null,label:'Ausgleichs-Board',reason:'Zuerst Fragen in Runde 2 anlegen.'});
  if(third.length!==teamCount)issues.push({id:null,label:'Ausgleichs-Board',reason:'Genau eine Frage je Team: '+teamCount+' Fragen für '+teamCount+' Teams erforderlich.'});
  for(const question of third){
   if(['map','order','team-emoji','team-draw'].includes(question.type)||question.roundMode==='written')
    issues.push({id:question.id,label:'Ausgleichs-Board · '+question.category,reason:'Für das Erst-Antwortrecht ist eine Buzzerfrage erforderlich.'});
  }
 }
 if(roundQuestions(quiz,2).length&&!roundQuestions(quiz,1).length)issues.push({id:null,label:'Runde 1',reason:'Zuerst mindestens eine Frage in Runde 1 anlegen.'});
 return issues;
}
export function suggestedTemplate(category){const key=categoryKey(category);return CATEGORY_SUGGESTIONS.find(s=>categoryKey(s.name)===key)?.template||'text';}
export function assertNewCategory(categories,name,except=''){
 const cleaned=cleanCategoryName(name);
 if(!cleaned)throw Error('Bitte einen Kategorienamen eingeben.');
 if(!except&&categories.length>=MAX_CATEGORIES)throw Error(`Maximal ${MAX_CATEGORIES} Kategorien pro Quiz.`);
 const same=categories.some(c=>categoryKey(c)===categoryKey(cleaned)&&categoryKey(c)!==categoryKey(except));
 if(same)throw Error('Diese Kategorie gibt es bereits.');
 return cleaned;
}
