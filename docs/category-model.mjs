// Categories are independent of question types and may be empty.
// Preserve legacy quiz files that stored only question.category strings.
export const CATEGORY_SUGGESTIONS = Object.freeze([
  {name:'Champions',description:'Champions erkennen und zuordnen',template:'text'},
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
export function suggestedTemplate(category){const key=categoryKey(category);return CATEGORY_SUGGESTIONS.find(s=>categoryKey(s.name)===key)?.template||'text';}
export function assertNewCategory(categories,name,except=''){
 const cleaned=cleanCategoryName(name);
 if(!cleaned)throw Error('Bitte einen Kategorienamen eingeben.');
 if(!except&&categories.length>=MAX_CATEGORIES)throw Error(`Maximal ${MAX_CATEGORIES} Kategorien pro Quiz.`);
 const same=categories.some(c=>categoryKey(c)===categoryKey(cleaned)&&categoryKey(c)!==categoryKey(except));
 if(same)throw Error('Diese Kategorie gibt es bereits.');
 return cleaned;
}
