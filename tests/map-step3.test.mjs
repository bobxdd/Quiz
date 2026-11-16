import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizePoint,encodePoint,decodePoint,DEFAULT_MAP_VIEW,normalizeMapView,mapScreenPosition,mapWorldPosition,mapZoomAt,mapPanBy,mapViewCss} from '../docs/map-tools.mjs';
import {normalizedQuiz,validateQuestion,publicQuestion} from '../docs/core.mjs';
import {templateScene,renderScene} from '../docs/studio-model.mjs';
const docs=new URL('../docs/',import.meta.url);
const source=path=>readFileSync(new URL(path,docs),'utf8');
const mk=(props={})=>normalizedQuiz({questions:[{id:'map1',category:'Weltkarte',title:'Frage',type:'map',roundMode:'written',prompt:'Wo ist der Ort?',answer:'',scene:templateScene('map',{prompt:'Wo ist der Ort?'}),...props}]}).questions[0];
test('map needs explicit host pin, not default 50/50 or numbers from imported quiz',()=>{
 for(const props of [{},{mapTargetX:50,mapTargetY:50},{mapTargetX:72,mapTargetY:32},{mapTargetSet:false,mapTargetX:24,mapTargetY:65}]){
  assert.match(validateQuestion(mk(props)),/Zielpunkt/);
 }
 assert.equal(validateQuestion(mk({mapTargetSet:true,mapTargetX:72.342,mapTargetY:32.23})), '');
});
test('normalized target flag survives host save/import, but never leaks to guests before reveal',()=>{
 const q=mk({mapTargetSet:true,mapTargetX:62.345,mapTargetY:38.112});
 assert.equal(q.mapTargetSet,true);
 const before=publicQuestion(q,false,'',0,0);
 for(const field of ['mapTargetSet','mapTargetX','mapTargetY','answer'])assert.equal(Object.hasOwn(before,field),false,field);
 const after=publicQuestion(q,true,'',0,6);
 assert.deepEqual({x:after.mapTargetX,y:after.mapTargetY},{x:62.345,y:38.112});
 assert.equal(Object.hasOwn(after,'mapTargetSet'),false);
});
test('map normalizes, encodes and decodes sub-kilometer precision without injection',()=>{
 for(const p of [{x:50.0002,y:22.56789},{x:0,y:0},{x:100,y:100}]){
  const normalized=normalizePoint(p);
  assert.deepEqual(decodePoint(encodePoint(p)),normalized);
 }
 for(const p of [{x:-.01,y:1},{x:1,y:101},{x:null,y:2},{x:'',y:5},null]){
  assert.equal(normalizePoint(p),null);
 }
 assert.equal(decodePoint('@map:50,50<img>'),null);
 assert.equal(decodePoint('@map:1e5,10'),null);
});
test('zoom is anchored beneath pointer; map point does not drift',()=>{
 let view={...DEFAULT_MAP_VIEW};
 const p={x:70,y:20};
 assert.deepEqual(mapWorldPosition(mapScreenPosition(p,view),view),p);
 view=mapZoomAt(view,5.75,{x:70,y:20});
 const screen=mapScreenPosition(p,view);
 assert.ok(Math.abs(screen.x-70)<.03,JSON.stringify(screen));
 assert.ok(Math.abs(screen.y-20)<.03,JSON.stringify(screen));
 assert.deepEqual(mapWorldPosition(screen,view),p);
 const shifted=mapPanBy(view,-20,8);
 const shiftedPoint=mapScreenPosition(p,shifted);
 assert.ok(Number.isFinite(shiftedPoint.x)&&Number.isFinite(shiftedPoint.y));
 assert.equal(mapWorldPosition(shiftedPoint,shifted)?.x,p.x);
});
test('zoom clamps to 1–16 and never exposes empty map edges',()=>{
 for(const raw of [{zoom:-20,x:-90,y:500},{zoom:100,x:500,y:-5},{zoom:NaN,x:NaN,y:NaN}]){
  const v=normalizeMapView(raw),c=mapViewCss(v);
  assert.ok(v.zoom>=1&&v.zoom<=16);
  assert.ok(v.x>=50/v.zoom&&v.x<=100-50/v.zoom);
  assert.ok(v.y>=50/v.zoom&&v.y<=100-50/v.zoom);
  assert.ok(c.left<=0.00001&&c.top<=0.00001);
  assert.ok(c.left+c.width>=100-.00001&&c.top+c.height>=100-.00001);
 }
});
test('map scene uses one clean full-screen surface, white SVG and dagger only when allowed',()=>{
 const scene=templateScene('map',{prompt:'Wo?'});
 const edit=renderScene(scene,{editing:true,mapCanEdit:true,mapEditorPoint:{x:60,y:40}});
 assert.match(edit,/bq-map-viewport/);assert.match(edit,/data-map-choice="true"/);
 assert.match(edit,/dagger-pin\.svg/);assert.match(edit,/Zielpunkt gesetzt/);
 const guest=renderScene(scene,{mapCanPick:true,mapPin:{x:20,y:30}});
 assert.doesNotMatch(guest,/dagger-pin\.svg/);
 assert.doesNotMatch(guest,/mapTargetX|mapTargetSet/);
 const reveal=renderScene(scene,{revealed:true,mapSolution:{x:60,y:40}});
 assert.match(reveal,/dagger-pin\.svg/);
 const white=source('world-map.svg');
 assert.match(white,/fill="#f6f9fa"/);
 assert.match(white,/fill:#ffffff/);
 assert.match(white,/preserveAspectRatio="none"/);
 const view=source('map-viewport.mjs');
 assert.match(view,/pointercancel/);assert.match(view,/wheel/);
 assert.match(view,/mapZoomAt/);assert.match(view,/setPointerCapture/);
});
test('host editor point is mandatory, save and publication paths stay private',()=>{
 const editor=source('studio-editor.mjs'),app=source('app.mjs'),model=source('studio-model.mjs');
 assert.match(editor,/item\.mapTargetSet=true/);
 assert.match(editor,/data-se-action="map-clear"/);
 assert.match(editor,/mapCanEdit:item\.scene\.template==='map'/);
 assert.match(editor,/mapPrompt/);
 assert.match(app,/quizAudit\(quiz\)/);
 assert.match(model,/mapMarkup\(/);
 assert.match(source('sw.js'),/map-viewport\.mjs/);
 assert.match(source('sw.js'),/dagger-pin\.svg/);
});
