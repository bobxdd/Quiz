
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boardList,createBoard,loadBoard,persistBoard,transferCategoryBetweenBoards} from '../docs/board-workspace.mjs';
import {emptyQuiz} from '../docs/core.mjs';

class Store{
 constructor(){this.data=new Map();this.failKey='';}
 getItem(key){return this.data.has(key)?this.data.get(key):null;}
 setItem(key,val){if(this.failKey===key)throw Error('quota');this.data.set(key,String(val));}
 removeItem(key){this.data.delete(key);}
}
const boardId=n=>'b'+n.toString(16).padStart(32,'0');
const questionId=n=>'q'+n.toString(16).padStart(32,'0');
const q=(n,category='Lorefragen',round=1)=>({
 id:questionId(n),type:'text',roundMode:'written',category,
 title:'Frage '+n,prompt:'Welche?',answer:'Antwort '+n,
 answerText:'Spezielle Antwort '+n,answerImage:'data:image/png;base64,AA==',
 scene:{template:'text',version:2,elements:[]},boardRound:round,points:200
});
const sourceQuiz=()=>{
 const quiz=emptyQuiz();
 quiz.title='Mein Original';
 quiz.questions=[q(1),q(2),q(3,'Splash-Art',2)];
 quiz.roundCategories={1:['Lorefragen'],2:['Splash-Art']};
 quiz.categories=['Lorefragen','Splash-Art'];
 return quiz;
};
const destQuiz=()=>{
 const quiz=emptyQuiz();quiz.title='Ziel';quiz.questions=[q(10,'Andere')];
 quiz.roundCategories={1:['Andere'],2:[]};quiz.categories=['Andere'];return quiz;
};
const setup=()=>{
 const store=new Store();
 const a=createBoard(store,sourceQuiz(),()=>boardId(1));
 const b=createBoard(store,destQuiz(),()=>boardId(2));
 return {store,a,b};
};
const copy=(store,a,b,extras={})=>transferCategoryBetweenBoards(store,{
 sourceId:a.id,targetId:b.id,expectedSourceRevision:a.revision,
 sourceRound:1,targetRound:2,category:'Lorefragen',makeQuestionId:(()=>{let i=100;return ()=>questionId(i++);})(),
 ...extras
});
test('copy complete category across saved quizzes preserves original and attachments',()=>{
 const {store,a,b}=setup();
 const result=copy(store,a,b);
 assert.equal(result.move,false);
 assert.equal(result.copiedQuestions,2);
 assert.equal(loadBoard(store,a.id).revision,1);
 assert.deepEqual(loadBoard(store,a.id).quiz.questions.map(v=>v.id),[questionId(1),questionId(2),questionId(3)]);
 const target=loadBoard(store,b.id).quiz;
 assert.deepEqual(target.roundCategories[2],['Lorefragen']);
 const copied=target.questions.filter(v=>v.boardRound===2);
 assert.equal(copied.length,2);
 assert.ok(copied.every(v=>v.category==='Lorefragen'&&v.id!==questionId(1)));
 assert.equal(copied[0].answerText,'Spezielle Antwort 1');
 assert.equal(copied[0].answerImage,'data:image/png;base64,AA==');
 assert.deepEqual(copied[0].scene,sourceQuiz().questions[0].scene);
 assert.equal(boardList(store).length,2);
});
test('move category removes only original round after confirmed target save',()=>{
 const {store,a,b}=setup();
 const result=copy(store,a,b,{move:true,targetRound:1});
 assert.equal(result.move,true);
 const source=loadBoard(store,a.id).quiz;
 assert.deepEqual(source.questions.map(v=>v.id),[questionId(3)]);
 assert.deepEqual(source.roundCategories[1],[]);
 assert.deepEqual(source.roundCategories[2],['Splash-Art']);
 assert.equal(source.categories.includes('Lorefragen'),false);
 const target=loadBoard(store,b.id).quiz;
 assert.deepEqual(target.roundCategories[1],['Andere','Lorefragen']);
 assert.equal(target.questions.length,3);
});
test('merges matching categories but rejects overflow without modifying either board',()=>{
 const {store,a,b}=setup();
 const target=loadBoard(store,b.id);
 target.quiz.questions.push(q(11),q(12),q(13),q(14),q(15));
 target.quiz.roundCategories[1].push('Lorefragen');
 // Reset destination using the public persistence API to keep a valid revision.
 persistBoard(store,b.id,b.revision,target.quiz);
 const srcBefore=JSON.stringify(loadBoard(store,a.id));
 const dstBefore=JSON.stringify(loadBoard(store,b.id));
 assert.throws(()=>copy(store,a,b,{targetRound:1}),/mehr als sechs Fragen/);
 assert.equal(JSON.stringify(loadBoard(store,a.id)),srcBefore);
 assert.equal(JSON.stringify(loadBoard(store,b.id)),dstBefore);
});
test('stale origin revision, duplicate IDs and invalid destination keep all saved data',()=>{
 const {store,a,b}=setup();
 assert.throws(()=>copy(store,a,b,{expectedSourceRevision:0}),/anderen Tab/);
 assert.throws(()=>copy(store,a,b,{makeQuestionId:()=>questionId(10)}),/doppelt/);
 assert.throws(()=>copy(store,a,b,{targetId:boardId(9)}),/nicht gefunden/);
 assert.equal(loadBoard(store,a.id).revision,1);
 assert.equal(loadBoard(store,b.id).revision,1);
});
test('when source removal fails, target copy remains and source is not lost',()=>{
 const {store,a,b}=setup();
 store.failKey='bq-board-workspace-'+a.id;
 assert.throws(()=>copy(store,a,b,{move:true}),/sicher in beiden Brettern/);
 assert.equal(loadBoard(store,a.id).quiz.questions.length,3);
 assert.equal(loadBoard(store,b.id).quiz.questions.length,3);
});
test('destination write failure keeps source and destination untouched',()=>{
 const {store,a,b}=setup();
 store.failKey='bq-board-workspace-'+b.id;
 assert.throws(()=>copy(store,a,b,{move:true}),/quota/);
 assert.equal(loadBoard(store,a.id).revision,1);
 assert.equal(loadBoard(store,b.id).revision,1);
});
test('the editor exposes category transfer only for saved local boards',()=>{
 const editor=readFileSync(new URL('../docs/studio-editor.mjs',import.meta.url),'utf8');
 const app=readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 assert.match(editor,/data-se-action="category-transfer-open"/);
 assert.match(editor,/data-se-category-transfer-form/);
 assert.match(editor,/data-se-action="category-transfer-cancel"/);
 assert.match(editor,/api\.isOffline\(\)/);
 assert.match(app,/transferCategoryBetweenBoards\(boardStore/);
 assert.match(app,/sourceId:boardId,expectedSourceRevision:boardRevision/);
 assert.match(app,/if\(!isOffline\(\)\|\|!boardId\|\|boardConflict\)/);
});

test('board workspace stays self-contained for isolated browser fixtures',async()=>{
 const code=readFileSync(new URL('../docs/board-workspace.mjs',import.meta.url),'utf8');
 const isolated=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 assert.equal(typeof isolated.transferCategoryBetweenBoards,'function');
 assert.equal(typeof isolated.loadBoard,'function');
});
