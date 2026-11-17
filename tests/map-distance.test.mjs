import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mapDistanceKm,mapAnswerDistances,formatMapDistanceKm,encodePoint,decodePoint} from '../docs/map-tools.mjs';
test('Map distances are Earth great-circle kilometres, not pixel distances',()=>{
 assert.equal(mapDistanceKm({x:50,y:50},{x:50,y:50}),0);
 const east=mapDistanceKm({x:50,y:50},{x:50+1/3.6,y:50});
 const north=mapDistanceKm({x:50,y:50},{x:50,y:50-1/1.8});
 assert.ok(Math.abs(east-111.195)<1,east);
 assert.ok(Math.abs(north-111.195)<1,north);
 const equator=mapDistanceKm({x:50,y:50},{x:60,y:50});
 const arctic=mapDistanceKm({x:50,y:16.667},{x:60,y:16.667});
 assert.ok(arctic<equator,JSON.stringify({arctic,equator}));
});
test('Map distances wrap around the date line and handle antipodes and the poles',()=>{
 const dateline=mapDistanceKm({x:(179+180)/3.6,y:50},{x:(-179+180)/3.6,y:50});
 assert.ok(Math.abs(dateline-222.39)<1,dateline);
 const antipodal=mapDistanceKm({x:0,y:50},{x:50,y:50});
 assert.ok(Math.abs(antipodal-20015.09)<1,antipodal);
 assert.ok(mapDistanceKm({x:1,y:0},{x:90,y:0})<1e-6);
 assert.equal(mapDistanceKm(null,{x:50,y:50}),null);
 assert.equal(mapDistanceKm({x:-1,y:50},{x:50,y:50}),null);
});
test('Only actually published, valid map pins get public distance rows',()=>{
 const solution={x:50,y:50};
 const review={entries:{
  alice:{name:'Alice',submitted:true,revealed:true,value:encodePoint(solution)},
  bob:{name:'Bob',submitted:true,revealed:true,value:encodePoint({x:60,y:50})},
  secret:{name:'Hidden',submitted:true,revealed:false,value:encodePoint(solution)},
  absent:{name:'No submission',submitted:false,revealed:false},
  bogus:{name:'Invalid',submitted:true,revealed:true,value:'@map:<script>'}
 }};
 const list=mapAnswerDistances(review,solution);
 assert.deepEqual(list.map(v=>v.name),['Alice','Bob']);
 assert.equal(list[0].distanceKm,0);
 assert.ok(list[1].distanceKm>3000);
 assert.deepEqual(decodePoint(review.entries.alice.value),solution);
 assert.deepEqual(mapAnswerDistances(review,{x:101,y:50}),[]);
});
test('User-facing German kilometre formatting is safe and readable',()=>{
 assert.equal(formatMapDistanceKm(0),'0 km');
 assert.equal(formatMapDistanceKm(1234.53),'1.234,5 km');
 for(const value of [NaN,Infinity,-1,null,'10'])assert.equal(formatMapDistanceKm(value),'');
});
test('Map solution reveal publishes all valid pins in one state update without choosing a winner',()=>{
 const app=readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');
 const viewport=readFileSync(new URL('../docs/map-viewport.mjs',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../docs/sw.js',import.meta.url),'utf8');
 const begin=app.indexOf('async function hostReveal(){');
 const end=app.indexOf('async function hostHint(){',begin);
 assert.ok(begin>=0&&end>begin);
 const source=app.slice(begin,end);
 assert.match(source,/const patch=\{current:publicQuestion/);
 assert.match(source,/if\(q\.type==='map'\)/);
 assert.match(source,/makeAnswerReview\(expected,answers/);
 assert.match(source,/review=revealAnswer\(review,id,response\)/);
 assert.match(source,/patch\.answerReview=review/);
 assert.match(source,/updateCurrent\(room,Number\(publicState\.round\),q\.id,patch/);
 assert.doesNotMatch(source,/judgeWritten|scorePerson|winner\(|scoreTarget|buzzerResolved/);
 assert.match(app,/const solution=publicState\.phase==='reveal'&&activeQuestion\(\)\?\.type==='map'/);
 assert.match(app,/mapAnswerDistances\(board,solution\)/);
 assert.match(app,/Der Host entscheidet weiterhin selbst/);
 assert.match(viewport,/formatMapDistanceKm\(pin\.distanceKm\)/);
 assert.match(sw,/brainquiz-shell-3\.7\.1-image-drop-map-distance/);
});
