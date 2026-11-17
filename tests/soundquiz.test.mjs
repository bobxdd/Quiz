import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizedQuiz,publicQuestion,isAudioData} from '../docs/core.mjs';
import {canBuzz} from '../docs/round-rules.mjs';
import {openQuestionState} from '../docs/question-flow.mjs';
import {templateScene} from '../docs/studio-model.mjs';

const src=name=>readFileSync(new URL('../docs/'+name,import.meta.url),'utf8');
const audio='data:audio/wav;base64,UklGRgAAAABXQVZF';
const question=()=>normalizedQuiz({questions:[{id:'sound1',title:'Ability',category:'Sound',type:'audio',
 roundMode:'buzzer',points:200,prompt:'Welcher Sound?',audio,answer:'Nur Host',
 scene:templateScene('audio',{prompt:'Welcher Sound?'})}]}).questions[0];

test('Audio question publishes sound to guests, but keeps solution private until reveal',()=>{
 assert.equal(isAudioData(audio),true);
 const q=question();
 assert.equal(q.audio,audio);
 assert.equal(q.roundMode,'buzzer');
 const pub=publicQuestion(q,false);
 assert.equal(pub.audio,audio);
 assert.equal(pub.answer,undefined);
 assert.equal(publicQuestion(q,true).answer,'Nur Host');
});
test('Each newly opened question discards previous sound playback grant',()=>{
 const q=question();
 const state={round:4,phase:'board',board:{sound1:{id:'sound1',category:'Sound',points:200,used:false}},used:{},
  audioPlayback:{round:3,id:'other',seq:9,at:2}};
 const fresh=openQuestionState(state,{expectedRound:4,question:q,playerQuestion:publicQuestion(q),participants:null});
 assert.equal(fresh.phase,'question');assert.equal(fresh.audioPlayback,null);
});
test('Existing host-authoritative buzzer remains open during and after the audio clip',()=>{
 const q=publicQuestion(question());
 const state={phase:'question',round:1,current:q,settings:{buzzerEnabled:true},
  teams:{t1:'Rot'},scoreMode:'team',audioPlayback:{round:1,id:q.id,seq:1,at:Date.now()}};
 assert.equal(canBuzz(state,{},'player1','t1'),true);
 assert.equal(canBuzz({...state,audioPlayback:{...state.audioPlayback,seq:2}}, {},'player1','t1'),true);
 assert.equal(canBuzz(state,{'1':{uid:'player2'}},'player1','t1'),false);
});
test('Host plays and replays; guests cannot manually seek or repeat sounds',()=>{
 const app=src('app.mjs'),css=src('actor-motion.css'),editor=src('studio-editor.mjs'),sw=src('sw.js');
 assert.match(app,/function syncSoundPlayer\(\)/);
 assert.match(app,/const media=new Audio\(q\.audio\)/);
 assert.match(app,/case 'audio-play':/);
 assert.match(app,/case 'audio-unblock':/);
 assert.match(app,/!canHost\(\)\|\|!q\|\|q\.type!=='audio'/);
 assert.match(app,/soundPlayer\.ended/);
 assert.match(app,/audioPlayback:next/);
 assert.match(app,/attemptSoundPlayback\(soundPlayer,play\)/);
 assert.doesNotMatch(app,/<audio controls preload="metadata" src=/);
 assert.match(editor,/accept="\.mp3,audio\/mpeg,/);
 assert.match(editor,/MP3 wird in einen kompakten Clip umgewandelt/);
 assert.match(sw,/3\.8\.0-host-soundquiz-fast-cover/);
 assert.equal((css.match(/900ms/g)||[]).length,6);
 assert.doesNotMatch(css,/2900ms/);
});
