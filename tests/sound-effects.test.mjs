import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SFX_SETTINGS,SFX_STORAGE_KEY,normalizeSfxSettings,loadSfxSettings,saveSfxSettings,createSoundEffects} from '../docs/sound-effects.mjs';
import {readFileSync} from 'node:fs';

const source=p=>readFileSync(new URL('../docs/'+p,import.meta.url),'utf8');
const store=()=>{const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};

test('Sound settings have a low default volume and reject corrupt stored preferences',()=>{
 const first=normalizeSfxSettings(null);
 assert.deepEqual(first,DEFAULT_SFX_SETTINGS);
 assert.ok(first.master<=40&&first.buzz<=45&&first.correct<=45&&first.wrong<=45);
 assert.deepEqual(normalizeSfxSettings({master:-50,buzz:300,correct:'20',wrong:'oops',muted:true}),{master:0,buzz:100,correct:20,wrong:38,muted:true});
 const storage=store();storage.setItem(SFX_STORAGE_KEY,'not-json');
 assert.deepEqual(loadSfxSettings(storage),DEFAULT_SFX_SETTINGS);
});

test('Browser-local settings persist, reset gracefully and allow independent mute/zero',()=>{
 const storage=store();const fx=createSoundEffects({storage,AudioContextClass:null});
 assert.equal(fx.values().master,35);
 fx.setVolume('buzz',0);fx.setVolume('master',22);fx.setVolume('correct',78);
 fx.setMuted(true);
 assert.deepEqual(JSON.parse(storage.getItem(SFX_STORAGE_KEY)),{muted:true,master:22,buzz:0,correct:78,wrong:38});
 assert.equal(fx.play('buzz'),false);
 assert.equal(fx.play('correct'),false);
 assert.deepEqual(loadSfxSettings(storage),fx.values());
 assert.equal(saveSfxSettings(storage,{master:97,muted:false}),true);
 assert.equal(loadSfxSettings(storage).master,97);
});

test('Synthesizer plays three distinct short effects only with browser gesture and honors mute',()=>{
 const events=[];
 class FakeOscillator{
  constructor(){this.frequency={setValueAtTime:(...x)=>events.push(['frequency',...x]),exponentialRampToValueAtTime:(...x)=>events.push(['slide',...x])};}
  set type(x){events.push(['wave',x]);}
  connect(){}
  start(at){events.push(['start',at]);}
  stop(at){events.push(['stop',at]);}
 }
 class FakeGain{
  constructor(){this.gain={setValueAtTime:(...x)=>events.push(['gain',...x]),exponentialRampToValueAtTime:(...x)=>events.push(['fade',...x])};}
  connect(){}
 }
 class FakeContext{
  constructor(){this.state='suspended';this.currentTime=1;this.destination={};}
  resume(){this.state='running';return Promise.resolve();}
  createOscillator(){return new FakeOscillator();}
  createGain(){return new FakeGain();}
 }
 const fx=createSoundEffects({storage:store(),AudioContextClass:FakeContext});
 assert.equal(fx.play('buzz'),false);
 fx.unlock();
 assert.equal(fx.play('buzz'),true);
 assert.equal(events.filter(x=>x[0]==='start').length,1);
 assert.equal(fx.play('correct'),true);
 assert.equal(events.filter(x=>x[0]==='start').length,3);
 assert.equal(fx.play('wrong'),true);
 assert.equal(events.filter(x=>x[0]==='start').length,5);
 assert.ok(events.filter(x=>x[0]==='fade').every(x=>x[1]>0&&x[1]<.05),'Default effect amplitude must be quiet');
 fx.setMuted(true);
 assert.equal(fx.play('correct'),false);
 assert.equal(events.filter(x=>x[0]==='start').length,5);
 fx.setMuted(false);
 fx.setVolume('master',0);
 assert.equal(fx.play('buzz'),false);
});

test('SFX integrate with host-replicated buzzer/feedback events, not arbitrary screen renders',()=>{
 const app=source('app.mjs'),sw=source('sw.js'),css=source('session-ui.css');
 assert.match(app,/function publicAudioEvents\(next\)/);
 assert.match(app,/function buzzerAudioEvents\(v\)/);
 assert.match(app,/buzzerJudgements\?\.\[r\]/);
 assert.match(app,/before\?\.at!==after\.at/);
 assert.match(app,/buzzWatchReady&&canHost\(\)/);
 assert.match(app,/case 'sfx-preview'/);
 assert.match(app,/case 'sfx-mute'/);
 assert.match(app,/data-bq-persist="soundfx"/);
 assert.match(app,/data-sfx-volume/);
 assert.match(app,/sfx\.play\('buzz'\)/);
 assert.match(sw,/sound-effects\.mjs/);
 assert.match(css,/bq-sfx-panel/);
});