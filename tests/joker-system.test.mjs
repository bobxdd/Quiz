import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedQuiz,buildPublicBoard,publicQuestion} from '../docs/core.mjs';
import {PeerGame} from '../docs/peer-client.mjs';
import {openQuestionState} from '../docs/question-flow.mjs';
import {applyBuzzerJudgement} from '../docs/round-rules.mjs';
import {
 JOKER_TYPES,normalizeJokerConfig,initialJokers,placeJokerDrops,
 jokerCount,changeJokerCharge,drawJokerForQuestion,awardJokerForCorrectAnswer,
 canUseShield,activeChronobreak,CHRONOBREAK_MS,jokerSetupSummary,jokerIconMarkup,oracleHintFor
} from '../docs/joker-system.mjs';

const room='ABCDEFGHJKLM2345';
const quiz=normalizedQuiz({scoreMode:'team',teams:['Jinx','Teemo'],jokerConfig:{
 enabled:true,starting:true,drops:{shield:2,oracle:1,reroll:2,chrono:1}
},questions:[
 {id:'a',category:'Eins',boardRound:1,type:'text',prompt:'Frage A',answer:'A',points:100,oracleHint:'Nur für Teemo'},
 {id:'b',category:'Eins',boardRound:1,type:'text',prompt:'Frage B',answer:'B',points:200},
 {id:'c',category:'Eins',boardRound:2,type:'text',prompt:'Frage C',answer:'C',points:300},
 {id:'d',category:'Eins',boardRound:2,type:'text',prompt:'Frage D',answer:'D',points:400},
 {id:'e',category:'Eins',boardRound:3,type:'text',prompt:'Ausgleich',answer:'E',points:500}
]});
const teams={t1:'Jinx',t2:'Teemo'};
function fixture(){
 const game=new PeerGame();
 game.mode='host';game.room=room;game._changed=()=>Promise.resolve();
 game.hostQuiz=structuredClone(quiz);
 game.data={public:{phase:'board',boardRound:1,round:0,boardSequence:true,scoreMode:'team',
  teams,scores:{t1:0,t2:0},board:buildPublicBoard(quiz),used:{},settings:{buzzerEnabled:true},
  selectionTurn:{order:['t1','t2'],index:0},jokerConfig:quiz.jokerConfig,
  jokers:initialJokers(teams,quiz.jokerConfig)},
  roster:{alice:{uid:'alice',team:'t1',name:'Alice'},bob:{uid:'bob',team:'t2',name:'Bob'}},
  members:{alice:{team:'t1',status:'approved',name:'Alice'},bob:{team:'t2',status:'approved',name:'Bob'}},
  buzzers:{},responses:{},scoreEvents:[],questionHistory:{},jokerPrivateHints:{},jokerDrops:{a:'oracle',b:'shield'}};
 return game;
}
function start(game,id='a'){
 const q=quiz.questions.find(x=>x.id===id),p=game.data.public;
 const ready=openQuestionState(p,{expectedRound:p.round,question:q,playerQuestion:publicQuestion(q),covered:true});
 game.data.public=ready;
 game.data.pendingQuestion={id,round:ready.round,current:{...publicQuestion(q),points:ready.current.points},duration:0};
 return ready;
}
function opened(game,id='a'){
 start(game,id);
 game.data.public.phase='question';
 game.data.public.current.firstAnswerPending=false;
 game.data.public=drawJokerForQuestion(game.data.public,id,game.data.jokerDrops);
 return game.data.public;
}
const ctx=uid=>({uid});
test('settings are backwards compatible and each configured type uses at most two unique ordinary fields',()=>{
 assert.equal(normalizeJokerConfig(null).enabled,false);
 assert.equal(quiz.jokerConfig.drops.shield,2);
 assert.equal(quiz.questions[0].oracleHint,'Nur für Teemo');
 const fields=placeJokerDrops(quiz,()=>0);
 assert.equal(Object.keys(fields).length,4,'not more than number of ordinary questions');
 assert.equal(Object.hasOwn(fields,'e'),false,'balance board never contains drops');
 assert.equal(JOKER_TYPES.length,4);
});
test('per-type starting stock preserves legacy imports and permits mixed setups',()=>{
 const legacy=normalizeJokerConfig({enabled:true,starting:true});
 assert.deepEqual(initialJokers(teams,legacy).t1,{shield:1,oracle:1,reroll:1,chrono:1});
 const mixed=normalizeJokerConfig({enabled:true,starting:true,startingByType:{shield:false,chrono:false}});
 assert.equal(mixed.starting,false);
 assert.deepEqual(initialJokers(teams,mixed).t1,{shield:0,oracle:1,reroll:1,chrono:0});
 assert.deepEqual(initialJokers(teams,normalizeJokerConfig(mixed)).t1,{shield:0,oracle:1,reroll:1,chrono:0});
});
test('a manually removed final shield charge cannot prevent a loss',async()=>{
 const g=fixture(),p=opened(g,'b');
 assert.throws(()=>g._handleGuestAction(ctx('alice'),'joker',{type:'shield',round:1}),/Wertung vom Host/);
 await g.hostAdjustJoker(room,'t1','shield',-1);
 assert.equal(canUseShield(g.data.public,'t1'),false);
 g.data.buzzers['1']={uid:'alice',team:'t1',name:'Alice'};
 assert.throws(()=>applyBuzzerJudgement(g.data.public,g.data.buzzers,{round:1,uid:'alice',result:'wrong',useShield:true}),/nicht eingelöst/);
 const result=applyBuzzerJudgement(g.data.public,g.data.buzzers,{round:1,uid:'alice',result:'wrong'});
 assert.equal(result.delta,-200);
});
test('starter stock, cap and one-time drop awards',()=>{
 let p=fixture().data.public;
 for(const type of JOKER_TYPES)assert.equal(jokerCount(p,'t1',type),1);
 p={...p,round:1,current:{id:'a'},phase:'question'};
 p=drawJokerForQuestion(p,'a',{a:'shield'});
 p=awardJokerForCorrectAnswer(p,'t2');
 assert.equal(jokerCount(p,'t2','shield'),2);
 p=awardJokerForCorrectAnswer(p,'t1');
 assert.equal(jokerCount(p,'t1','shield'),1,'same dropped joker cannot be awarded twice');
 assert.equal(p.jokerEvent.team,'t2');
 assert.equal(changeJokerCharge(p,'t2','shield',-1).jokers.t2.shield,1);
 const full={...p,jokers:{...p.jokers,t1:{...p.jokers.t1,shield:3}},jokerEvent:{type:'shield',round:1,id:'a',awarded:false}};
 const awarded=awardJokerForCorrectAnswer(full,'t1');
 assert.equal(awarded.jokers.t1.shield,3);
 assert.equal(awarded.jokerEvent.full,true);
});
test('shield consumes a charge and prevents a wrong buzzer penalty without opening another chance',()=>{
 const g=fixture(),p=opened(g,'b');
 assert.equal(canUseShield(p,'t1'),true);
 g.data.buzzers['1']={uid:'alice',team:'t1',name:'Alice'};
 const regular=applyBuzzerJudgement(p,g.data.buzzers,{round:1,uid:'alice',result:'wrong'});
 assert.equal(regular.delta,-p.current.points/2);
 assert.equal(jokerCount(regular.state,'t1','shield'),1);
 const result=applyBuzzerJudgement(p,g.data.buzzers,{round:1,uid:'alice',result:'wrong',useShield:true});
 assert.equal(result.delta,0);
 assert.equal(result.state.scores.t1,0);
 assert.equal(jokerCount(result.state,'t1','shield'),0,'shield is spent once when the negative score is prevented');
 assert.equal(result.buzzers['1'],undefined);
 assert.ok(result.state.buzzerBlockedTeams['1'].t1);
});
test('Oracle announces an oral hint without sending text and works without a prepared note',async()=>{
 const g=fixture(),p=opened(g,'b');
 await g.hostAdjustJoker(room,'t2','oracle',1);
 const active=g.data.public;
 g._handleGuestAction(ctx('bob'),'joker',{type:'oracle',round:1});
 assert.deepEqual(active.oracleCalls.t2,{round:1,given:false});
 assert.equal(JSON.stringify(p).includes('Nur für Teemo'),false);
 assert.equal(jokerCount(active,'t2','oracle'),1);
 await g.hostConfirmOracle(room,1,'t2');
 assert.equal(active.oracleCalls.t2.given,true);
 assert.throws(()=>g._handleGuestAction(ctx('bob'),'joker',{type:'oracle',round:1}),/bereits eingesetzt/);
});
test('reroll requested by selecting team returns the covered question without consuming other team turns',async()=>{
 const g=fixture();
 start(g);
 assert.throws(()=>g._handleGuestAction(ctx('bob'),'joker',{type:'reroll',round:1}),/auswählende/);
 g._handleGuestAction(ctx('alice'),'joker',{type:'reroll',round:1});
 assert.equal(jokerCount(g.data.public,'t1','reroll'),1,'request itself is free');
 const completed=await g.hostResolveReroll(room,true);
 assert.equal(completed,true);
 assert.equal(g.data.public.phase,'board');
 assert.equal(g.data.public.board.a.used,false);
 assert.equal(jokerCount(g.data.public,'t1','reroll'),0);
 assert.equal(g.data.public.selectionTurn.index,0);
});
test('Chronobreak allows the buzzer or a teammate, rejects other teams and locks grading for eight seconds',()=>{
 const g=fixture(),p=opened(g);
 g.data.buzzers['1']={uid:'alice',team:'t1',name:'Alice'};
 g.data.roster.ally={team:'t1',name:'Ally'};
 g.data.members.ally={team:'t1',status:'approved',name:'Ally'};
 assert.throws(()=>g._handleGuestAction(ctx('bob'),'joker',{type:'chrono',round:1}),/Team am Buzzer/);
 g._handleGuestAction(ctx('ally'),'joker',{type:'chrono',round:1});
 assert.equal(p.chronoBreak.uid,'ally');
 assert.equal(p.chronoBreak.buzzerUid,'alice');
 assert.equal(activeChronobreak(p),true);
 assert.equal(jokerCount(p,'t1','chrono'),0);
 assert.ok(p.chronoBreak.until>Date.now()+CHRONOBREAK_MS-1500);
 assert.throws(()=>applyBuzzerJudgement(p,g.data.buzzers,{round:1,uid:'alice',result:'wrong'}),/Chronobreak/);
 assert.throws(()=>g._handleGuestAction(ctx('alice'),'joker',{type:'chrono',round:1}),/Aufladung/);
});
test('Chronobreak cannot run without a real team buzz or on a written round',()=>{
 const g=fixture(),p=opened(g);
 assert.throws(()=>g._handleGuestAction(ctx('alice'),'joker',{type:'chrono',round:1}),/Team am Buzzer/);
 g.data.buzzers['1']={uid:'alice',team:'t1',name:'Alice',oral:true};
 assert.throws(()=>g._handleGuestAction(ctx('alice'),'joker',{type:'chrono',round:1}),/Team am Buzzer/);
 delete g.data.buzzers['1'].oral;
 p.current.roundMode='written';
 assert.throws(()=>g._handleGuestAction(ctx('alice'),'joker',{type:'chrono',round:1}),/Team am Buzzer/);
 assert.equal(jokerCount(p,'t1','chrono'),1);
});

test('game reset removes previous private hints and corrections before round numbers are reused',async()=>{
 const g=fixture();opened(g);
 g.data.jokerPrivateHints={'1':{t1:'old private hint'}};
 g.data.chronoCorrections={'1':'old answer'};
 g._scheduleTeamEmojiDeadline=()=>{};
 await g.clearRoomEvents(room);
 assert.equal(g.data.jokerPrivateHints,undefined);
 assert.equal(g.data.chronoCorrections,undefined);
 assert.ok(Object.keys(g.data.jokerDrops).length>0);
});
test('active Chronobreak prevents bypass through the buzzer reset endpoint',async()=>{
 const g=fixture();opened(g);
 g.data.buzzers['1']={uid:'alice',team:'t1',name:'Alice'};
 g._handleGuestAction(ctx('alice'),'joker',{type:'chrono',round:1});
 await assert.rejects(g.clearBuzzer(room,1),/Chronobreak/);
 assert.equal(g.data.buzzers['1'].uid,'alice');
 g.data.public.chronoBreak.until=Date.now()-1;
 await g.clearBuzzer(room,1);
 assert.equal(g.data.buzzers['1'],undefined);
});

test('late-joining player cannot use Joker charges during an ineligible question',()=>{
 const g=fixture();opened(g);
 g.data.members.bob.playFromRound=2;
 assert.throws(()=>g._handleGuestAction(ctx('bob'),'joker',{type:'oracle',round:1}),/nächsten Frage/);
 assert.equal(jokerCount(g.data.public,'t2','oracle'),1);
 assert.deepEqual(g.data.jokerPrivateHints,{});
});

test('quiz-wide editor totals include both normal boards, exclude balance and flag missing slots',()=>{
 const summary=jokerSetupSummary(quiz);
 assert.equal(summary.fields,6);
 assert.equal(summary.available,4);
 assert.equal(summary.missing,2);
 assert.equal(summary.starters,4);
 assert.equal(summary.missingHints,3);
 const six=normalizedQuiz({...quiz,questions:[...quiz.questions,{id:'f',boardRound:2},{id:'g',boardRound:1}]});
 const fit=jokerSetupSummary(six);
 assert.equal(fit.missing,0);
 const drops=placeJokerDrops(six,()=>0);
 for(const type of JOKER_TYPES)assert.equal(Object.values(drops).filter(value=>value===type).length,fit.config.drops[type]);
 assert.equal(Object.hasOwn(drops,'e'),false);
 assert.match(jokerIconMarkup('oracle'),/<svg/);
});

test('bonus drops use the actual question mode across both ordinary boards',()=>{
 const mixed=normalizedQuiz({...quiz,questions:[
  {id:'spoken',type:'text',roundMode:'buzzer',boardRound:1},
  {id:'audio',type:'audio',boardRound:2},
  {id:'typed',type:'text',roundMode:'written',boardRound:1},
  {id:'map',type:'map',roundMode:'buzzer',boardRound:2},
  {id:'sort',type:'order',boardRound:2},
  {id:'emoji',type:'team-emoji',boardRound:1},
  {id:'draw',type:'team-draw',boardRound:2},
  {id:'balance',type:'text',boardRound:3}
 ]});
 const placements=placeJokerDrops(mixed,()=>0);
 assert.deepEqual(Object.keys(placements).sort(),['audio','spoken']);
 assert.equal(jokerSetupSummary(mixed).available,2);
 assert.deepEqual(placeJokerDrops({...mixed,questions:mixed.questions.slice(2)},()=>0),{});
 for(const q of mixed.questions.slice(2)){
  const state={phase:'question',round:1,boardRound:q.boardRound,current:q};
  assert.equal(drawJokerForQuestion(state,q.id,{[q.id]:'shield'}).jokerEvent,null);
 }
});

test('repeated wrong written verdict preserves shield, and undo restores protection',async()=>{
 const g=fixture(),p=opened(g);
 p.current.roundMode='written';
 p.phase='review';
 p.answerReview={entries:{alice:{submitted:true,revealed:true}}};
 await g.judgeWritten(room,1,'alice','wrong',{useShield:true});
 await g.judgeWritten(room,1,'alice','wrong');
 assert.equal(g.data.public.scores.t1,0);
 assert.equal(jokerCount(g.data.public,'t1','shield'),0);
 assert.equal(g.data.scoreEvents.length,1);
 await g.hostUndoScore(room,g.data.scoreEvents[0].id);
 assert.equal(jokerCount(g.data.public,'t1','shield'),1);
 assert.equal(canUseShield(g.data.public,'t1'),true);
 await g.judgeWritten(room,1,'alice','wrong',{useShield:true});
 assert.equal(g.data.public.scores.t1,0);
});

test('a zero-point buzzer penalty does not spend a shield',()=>{
 const g=fixture(),p=opened(g);
 p.current.points=0;
 const buzzers={'1':{uid:'alice',team:'t1',name:'Alice'}};
 const result=applyBuzzerJudgement(p,buzzers,{round:1,uid:'alice',result:'wrong'});
 assert.ok(result.delta===0);
 assert.equal(jokerCount(result.state,'t1','shield'),1);
});
test('Oracle only falls back to hints that have yet to be revealed',()=>{
 const q={oracleHint:'  ',hints:['Schon gezeigt','','Neuer Hinweis']};
 assert.equal(oracleHintFor(q,1),'Neuer Hinweis');
 assert.equal(oracleHintFor(q,3),'');
 assert.equal(oracleHintFor({...q,oracleHint:'Privat'},3),'Privat');
});
