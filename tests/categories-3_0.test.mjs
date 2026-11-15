import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyQuiz,normalizedQuiz,buildPublicBoard} from '../docs/core.mjs';
import {createStudioEditor} from '../docs/studio-editor.mjs';
import {CATEGORY_SUGGESTIONS,collectCategories,questionsInCategory,categoryKey,assertNewCategory,suggestedTemplate} from '../docs/category-model.mjs';

test('3.0 Kategorien: Startvorschläge umfassen Champs, Lore, Schätzen und Fähigkeiten',()=>{
 const names=CATEGORY_SUGGESTIONS.map(x=>x.name);
 for(const n of ['Champions','Lorefragen','Schätzen','Splash-Art','Fähigkeiten','Items','Zitate','Sounds'])assert.ok(names.includes(n));
 assert.equal(suggestedTemplate('Schätzen'),'estimate');assert.equal(suggestedTemplate('CHAMPIONS'),'text');
});
test('3.0 Kategorien: Leere Kategorie bleibt nach Export und Import erhalten',()=>{
 const quiz=emptyQuiz();quiz.categories=['Champions','Lorefragen','Schätzen'];
 const again=normalizedQuiz(JSON.parse(JSON.stringify(quiz)));
 assert.deepEqual(again.categories,quiz.categories);assert.equal(again.questions.length,0);
});
test('3.0 Kategorien: Legacy-Quiz erhält seine früher nur in Fragen gespeicherten Kategorien',()=>{
 const raw={questions:[{id:'one',category:'Lore',title:'Welt',answer:'x'},{id:'two',category:'Items',title:'A',answer:'b'}]};
 assert.deepEqual(normalizedQuiz(raw).categories,['Lore','Items']);
});
test('3.0 Kategorien: Neue Kategorien und bisherige Fragen werden ohne Verlust zusammengeführt',()=>{
 const q=normalizedQuiz({categories:['Champions'],questions:[{id:'q1',category:'Schätzen',type:'estimate',points:200,estimateTarget:42,answer:'42'}]});
 assert.deepEqual(q.categories,['Champions','Schätzen']);assert.equal(q.questions[0].estimateTarget,42);
 assert.deepEqual(Object.values(buildPublicBoard(q)).map(x=>x.category),['Schätzen']);
});
test('3.0 Kategorien: Groß-/Kleinschreibung, Leerzeichen und doppelte Namen werden bereinigt',()=>{
 assert.deepEqual(collectCategories([' Champions ','champions','Lorefragen','L  ore'],[{category:'LOREFRAGEN'}]),['Champions','Lorefragen','L ore']);
 assert.equal(categoryKey(' LOREFragen '),categoryKey('lorefragen'));
 assert.equal(questionsInCategory([{category:'items',id:1},{category:'Lore',id:2}], 'ITEMS').length,1);
});
test('3.0 Kategorien: Leere und doppelte Namen sind unzulässig, gültige Umbenennung ist möglich',()=>{
 assert.throws(()=>assertNewCategory(['Champions'],'   '),/Kategorienamen/);
 assert.throws(()=>assertNewCategory(['Champions'],'champions'),/bereits/);
 assert.equal(assertNewCategory(['Champions','Lorefragen'],'LOREFragen','Lorefragen'),'LOREFragen');
 assert.equal(assertNewCategory(['Champions'],'Schätzen'),'Schätzen');
});
test('3.0 Kategorien: Nur Kategorien speichern keine privaten Lösungen im öffentlichen Board',()=>{
 const quiz=normalizedQuiz({categories:['Geheim'],questions:[{id:'q',category:'Geheim',prompt:'Test',answer:'ABSOLUT_GEHEIM'}]});
 assert.equal(JSON.stringify(buildPublicBoard(quiz)).includes('ABSOLUT_GEHEIM'),false);
});
test('3.0 Kategorien: Übersicht zeigt anlegbare Kategorien, ohne Frage oder Inspector vorzutäuschen',()=>{
 const quiz=emptyQuiz(),html=createStudioEditor({getQuiz:()=>quiz,getQuestion:()=>null,isOffline:()=>true,onlineReady:()=>false}).html();
 assert.match(html,/se-category-overview/);assert.match(html,/data-se-action="category-preset"/);
 assert.match(html,/data-se-action="category-form"/);assert.doesNotMatch(html,/class="se-scene/);
});
test('3.0 Kategorien: Kategorieübersicht zeigt vorhandene Kategorien und Anlegen pro Kategorie',()=>{
 const quiz=normalizedQuiz({categories:['Champions','Spezial']});
 const html=createStudioEditor({getQuiz:()=>quiz,getQuestion:()=>null,isOffline:()=>true,onlineReady:()=>false}).html();
 assert.match(html,/data-se-action="category-select"/);assert.match(html,/data-se-action="category-new-question"/);
 assert.match(html,/Spezial/);assert.match(html,/0 Fragen/);
});
