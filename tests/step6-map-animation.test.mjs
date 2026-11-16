import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAP_THROW_MS,MAP_FLIGHT_MS,MAP_FLIGHT_DELAY_MS,THROW_ACTORS,mapThrowTarget,mapThrowOrigin} from '../docs/map-dagger-animation.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const app=read('../docs/app.mjs'),css=read('../docs/map-dagger-animation.css');
const questionCss=read('../docs/actor-motion.css'),sw=read('../docs/sw.js'),html=read('../docs/index.html');

test('Step 6: all four original figure skins share one calm throw timeline',()=>{
 assert.deepEqual(THROW_ACTORS,['rogue','blades','mage','druid']);
 assert.ok(MAP_THROW_MS>=3800 && MAP_THROW_MS<=5500);
 assert.ok(MAP_FLIGHT_MS>=800 && MAP_FLIGHT_MS<=1800);
 assert.ok(MAP_FLIGHT_DELAY_MS>1500);
 for(const id of THROW_ACTORS)assert.match(css,new RegExp('bq-map-throw-actor--'+id));
 assert.match(css,/bq-map-original-arm-lift/);
 for(const id of THROW_ACTORS)assert.match(css,new RegExp('\\.bq-map-throw-actor--'+id+'\\{[\\s\\S]*?--bq-arm-outline:polygon'));
 assert.match(css,/bq-map-throw-original-arm/);
 assert.doesNotMatch(css,/bq-map-throw-hand|bq-throw-sleeve|bq-throw-sleeve-highlight/);
 assert.match(css,/bq-map-dagger-flight/);
 assert.match(css,/bq-map-throw-impact/);
 assert.doesNotMatch(css,/infinite/);
});

test('Step 6: target coordinates follow the true marker, not a guessed projectile endpoint',()=>{
 const viewport={getBoundingClientRect:()=>({left:100,top:200,width:800,height:420}),contains:el=>el?.valid===true};
 const good={valid:true,style:{left:'67.321%',top:'34.112%'}};
 assert.deepEqual(mapThrowTarget(viewport,good),{x:638.568,y:343.2704});
 assert.equal(mapThrowTarget(viewport,{...good,style:{left:'NaN%',top:'34.112%'}}),null);
 assert.equal(mapThrowTarget(viewport,{...good,valid:false}),null);
 assert.equal(mapThrowTarget(null,good),null);
 const shifted={...viewport,getBoundingClientRect:()=>({left:5,top:14,width:320,height:500})};
 assert.deepEqual(mapThrowTarget(shifted,good),{x:220.4272,y:184.56});
});

test('Step 6: fixed character origin does not depend on the target',()=>{
 const box={getBoundingClientRect:()=>({left:150,top:410,width:800,height:410})};
 const start=mapThrowOrigin(box,1366,900);
 assert.equal(start.actorX,9);
 assert.equal(start.actorY,428);
 assert.ok(start.scale>.9&&start.scale<=1);
 assert.equal(start.handX,start.actorX+106*start.scale);
 assert.equal(start.handY,start.actorY+88*start.scale);
 assert.match(css,/\.bq-map-question\.bq-map-throw-active/);
 assert.match(read('../docs/map-dagger-animation.mjs'),/bq-map-throw-original-arm bq-actor--/);
 assert.doesNotMatch(read('../docs/map-dagger-animation.mjs'),/bq-map-throw-hand/);
 assert.match(app,/removeMapThrowRail\(\)/);
 const mobile=mapThrowOrigin(box,390,844);
 assert.ok(mobile.actorX>=4&&mobile.actorX<=244);
});

test('Step 6: once at map reveal, hidden until impact, respects reduced motion and privacy',()=>{
 assert.match(app,/publicState\?\.phase==='reveal'&&q\.type==='map'/);
 assert.match(app,/consumedMapThrows\.add\(key\)/);
 assert.match(app,/sessionStorage\.setItem\('bq-map-throw:'/);
 assert.match(app,/bq-throw-waiting/);
 assert.match(app,/onLand:/);
 assert.match(app,/\.handle\.cancel\(\)/);
 assert.match(css,/\.bq-map-pin\.is-solution\.bq-throw-waiting\{visibility:hidden!important\}/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/forced-colors:active/);
 assert.match(css,/pointer-events:none!important/);
 assert.match(sw,/map-dagger-animation\.mjs/);
 assert.match(sw,/map-dagger-animation\.css/);
 assert.match(html,/map-dagger-animation\.css/);
 assert.match(sw,/brainquiz-shell-3\.7\.0/);
});

test('Step 6: question cover shows one character moving one panel with four slow directions',()=>{
 assert.match(app,/bq-curtain-helper bq-actor bq-actor--/);
 for(const d of ['left','right','up','down'])assert.match(questionCss,new RegExp('bq-curtain-'+(d==='left'?'push-left':d==='right'?'push-right':d==='up'?'toss-up':'pull-down')));
 assert.match(questionCss,/2900ms steps/);
 assert.match(app,/lastAnimatedQuestion/);
 assert.doesNotMatch(app,/maybeAnimateGameplay|animateDock|bq-action-actor/);
});
