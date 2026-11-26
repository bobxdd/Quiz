import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedQuiz,publicQuestion,validateQuestion} from '../docs/core.mjs';
import {advanceTeamEmoji,finishTeamEmoji,emojiGroup,emojiName,emojisFromText,MAX_DRAW_POINTS,MAX_EMOJI_CLUES,newTeamEmojiRound,normalizeTeamEmoji,parseEmojiPalette,playTeamEmoji,publicTeamEmoji,teamEmojiForPlayer} from '../docs/team-emoji.mjs';
import {canBuzz} from '../docs/round-rules.mjs';
import {templateScene,reconcileQuestion} from '../docs/studio-model.mjs';

const question={id:'emoji-test',title:"Kai'Sa",category:'Emoji-Teamrunde',type:'team-emoji',
 answerText:"Kai'Sa",acceptedAnswers:'Tochter der Leere',points:175,
 teamEmoji:{palette:'🐦👩‍🚀 ❄️ 🔥',clueSeconds:8,guessSeconds:5}};
const state={scoreMode:'team',teams:{t1:'Rot',t2:'Blau',t3:'Grün'}};
const roster={a:{team:'t1'},b:{team:'t1'},c:{team:'t2'},d:{team:'t2'},e:{team:'t3'}};

test('palette parsing preserves emoji sequences and rejects text',()=>{
 assert.deepEqual(parseEmojiPalette('👩‍🚀👩‍🚀 🏴‍☠️ #️⃣ ❄️'),['👩‍🚀','🏴‍☠️','#️⃣','❄️']);
 for(const invalid of ['','A 🦊','123','\u200D'])assert.throws(()=>parseEmojiPalette(invalid),/Emojis/);
});

test('legacy palette imports are ignored without changing timers',()=>{
 assert.deepEqual(normalizeTeamEmoji({palette:'👩‍🚀 🦊',clueSeconds:8,guessSeconds:5}),{clueSeconds:8,guessSeconds:5});
 assert.equal(emojiName('⚓'),'Anker');
 assert.equal(emojiGroup('👩‍🚀'),'Weitere');
 assert.equal(MAX_EMOJI_CLUES,3);
});

test('team question imports with private settings and never opens a buzzer',()=>{
 const q=normalizedQuiz({questions:[question]}).questions[0];
 const publicCopy=publicQuestion(q);
 assert.equal(q.roundMode,'team-emoji');
 assert.deepEqual(q.teamEmoji,{clueSeconds:8,guessSeconds:5});
 assert.equal(validateQuestion(q),'');
 assert.match(validateQuestion(q,'individual'),/Teamwertung/);
 assert.match(validateQuestion({...q,answerText:'',answer:''}),/Antwort-Tab/);
 assert.deepEqual(Object.keys(publicCopy).sort(),['category','id','points','roundMode','type']);
 assert.equal(canBuzz({phase:'question',current:publicCopy}, {},'b','t1'),false);
});

test('separate timer phases, private team clues and one final answer per team',()=>{
 const round=newTeamEmojiRound(question,state,roster,'1');
 const view=(team,person)=>teamEmojiForPlayer(round,team,person);
 const act=(team,person,kind,value,time=1000)=>playTeamEmoji(round,team,person,kind,value,time);
 assert.throws(()=>advanceTeamEmoji(round,1000),/Hinweisgeber/);
 act('t1','a','role','clue');
 assert.throws(()=>act('t1','b','role','clue'),/bereits/);
 assert.throws(()=>act('t3','e','role','guess'),/mindestens zwei/);
 act('t1','b','role','guess');
 act('t2','c','role','clue');
 act('t2','d','role','guess');
 assert.equal(view('t1','a').target,undefined,'roles never include the target');
 advanceTeamEmoji(round,1000);
 assert.equal(round.deadline,9000);
 assert.equal(view('t1','a').target,question.answerText);
 assert.equal(view('t2','c').target,question.answerText);
 assert.equal(view('t1','b').target,undefined);
 assert.equal(view('t1','d'),null);
 assert.equal(view('t1','b').palette,undefined);
 assert.throws(()=>act('t1','b','clue',[0]),/Rolle/);
 assert.throws(()=>act('t1','a','clue',[0,4]),/Emojis/);
 assert.equal(finishTeamEmoji(round),false,'no early reveal');
 act('t1','a','clue',['🐦','❄️']);
 act('t2','c','clue',['👩‍🚀']);
 assert.equal(view('t1','b').clues,undefined);
 assert.throws(()=>act('t1','a','clue',[1],9000),/abgelaufen/);
 assert.equal(advanceTeamEmoji(round,8999),false);
 advanceTeamEmoji(round,9000);
 assert.equal(round.deadline,14000);
 assert.deepEqual(view('t1','b').clues,['🐦','❄️']);
 assert.deepEqual(view('t2','d').clues,['👩‍🚀']);
 assert.equal(view('t1','b').target,undefined);
 assert.throws(()=>act('t1','a','guess','KAISA',9001),/Rolle/);
 act('t1','b','guess','Andere Antwort',9001);
 act('t1','b','guess','KAISA',9002);
 assert.equal(view('t1','b').guess,'KAISA');
 assert.throws(()=>act('t1','b','guess','Zu spät',14000),/abgelaufen/);
 act('t2','d','guess','Tochter der Leere',9003);
 assert.equal(round.phase,'awaiting-reveal');
 assert.equal(round.deadline,0);
 assert.equal(teamEmojiForPlayer(round,'t1','b').clues,undefined);
 assert.equal(publicTeamEmoji(round).solution,undefined);
 assert.throws(()=>act('t1','b','guess','Late update',9004),/Rolle/);
 assert.equal(publicTeamEmoji(round).results,undefined);
 assert.equal(advanceTeamEmoji(round,14000),false,'timer cannot reveal');
 assert.equal(finishTeamEmoji(round),true);
 assert.equal(finishTeamEmoji(round),false,'cannot reveal twice');
 assert.deepEqual(publicTeamEmoji(round).results.map(result=>[result.status,result.points]),[
  ['correct',175],['correct',175],['no-roles',0]
 ]);
 assert.equal(publicTeamEmoji(round).solution,question.answerText);
 assert.equal(advanceTeamEmoji(round,15000),false,'the same round cannot pay twice');
});

test('four Ability-Imposter slots share the same decoy and only that slot is replaced',()=>{
 const image=n=>'data:image/png;base64,'+Buffer.from('image-'+n).toString('base64');
 const scene=templateScene('imposter',{prompt:'Finde die fremde Fähigkeit'});
 const slots=scene.elements.filter(element=>element.kind==='image');
 assert.deepEqual(slots.map(element=>element.alt),['Q','W','E','R']);
 slots.forEach((slot,index)=>slot.src=image(index));
 const q=reconcileQuestion({id:'a',type:'imposter',category:'Fähigkeiten',points:200,scene,imposterIndex:2,correctIcon:image(8)});
 const copy=normalizedQuiz({questions:[q]}).questions[0];
 assert.equal(validateQuestion(copy),'');
 const before=publicQuestion(copy);
 assert.deepEqual(before,publicQuestion(copy),'guest snapshots are deterministic');
 assert.equal(JSON.stringify(before).includes(image(8)),false);
 const after=publicQuestion(copy,true);
 // The misleading icon stays visible during the answer reveal. Replacing it
 // here would remove the very mistake the audience must identify.
 const changed=before.scene.elements.flatMap((element,index)=>element.src===after.scene.elements[index].src?[]:[element.id]);
 assert.deepEqual(changed,[]);
 assert.equal(after.scene.elements.find(element=>element.id===slots[2].id).src,image(2));
 assert.deepEqual(after.icons,[image(0),image(1),image(2),image(3)]);
 assert.equal(after.correctIcon,image(8),'the genuine icon is released alongside the answer');
 assert.equal(after.imposterIndex,2,'the answer identifies which wrong slot to outline');
 assert.equal(copy.icons[2],image(2));
});

test('catalogue and operating-system emoji can be used outside the shortcut palette',()=>{
 const round=newTeamEmojiRound(question,state,roster,'full-emoji');
 playTeamEmoji(round,'t1','a','role','clue',10);
 playTeamEmoji(round,'t1','b','role','guess',10);
 advanceTeamEmoji(round,10);
 const symbols=['🐱','🇩🇪','🧑🏾‍🚀'];
 assert.deepEqual(emojisFromText('Text 🐱🇩🇪 🧑🏾‍🚀 🐱'),symbols);
 for(const invalid of [['🐱🇩🇪'],['Antwort'],Array(4).fill('🐱')]){
  assert.throws(()=>playTeamEmoji(round,'t1','a','clue',invalid,100),/Emojis/);
 }
 playTeamEmoji(round,'t1','a','clue',symbols,100);
 advanceTeamEmoji(round,round.deadline);
 assert.deepEqual(teamEmojiForPlayer(round,'t1','b').clues,symbols);
});

test('drawing rounds keep the reference and artwork private until the appropriate phase',()=>{
 const reference='data:image/png;base64,YWJj';
 const config={type:'team-draw',answerText:'Jinx',answerImage:reference,acceptedAnswers:'Powder',points:125,
  scene:templateScene('team-draw'),teamDraw:{drawSeconds:12,guessSeconds:7}};
 const q=normalizedQuiz({questions:[reconcileQuestion(config)]}).questions[0];
 assert.deepEqual(q.teamDraw,{drawSeconds:12,guessSeconds:7});
 assert.equal(q.type,'team-draw');
 assert.equal(q.roundMode,'team-draw');
 assert.equal(validateQuestion(q,'team'),'');
 assert.match(validateQuestion({...q,answerText:''},'team'),/Antwort-Tab/);
 assert.match(validateQuestion(q,'individual'),/Teamwertung/);
 assert.equal(publicQuestion(q).answerImage,undefined);
 assert.equal(publicQuestion(q,true).answerImage,reference);
 assert.equal(canBuzz({phase:'question',current:publicQuestion(q)}, {},'b','t1'),false);
 const round=newTeamEmojiRound(q,state,roster,'draw');
 const act=(team,who,kind,value,time=50)=>playTeamEmoji(round,team,who,kind,value,time);
 const view=(team,who)=>teamEmojiForPlayer(round,team,who);
 for(const [team,drawer,guesser] of [['t1','a','b'],['t2','c','d']]){
  act(team,drawer,'role','clue');
  act(team,guesser,'role','guess');
 }
 assert.equal(view('t1','a').target,undefined);
 advanceTeamEmoji(round,100);
 assert.equal(round.deadline,12100);
 assert.deepEqual([view('t1','a').target,view('t1','a').reference],['Jinx',reference]);
 assert.equal(view('t1','b').reference,undefined);
 const stroke=[0,1,10,10,100,50],other=[2,0,0,80,44,10];
 assert.throws(()=>act('t1','b','clue',[stroke],101),/Rolle/);
 for(const invalid of [[[0,0,999,0]], [['#000',1,1,0]], [[0,0,...Array(2*(MAX_DRAW_POINTS+1)).fill(20)]]]){
  assert.throws(()=>act('t1','a','clue',invalid,101),/Zeichnung/);
 }
 act('t1','a','clue',[stroke],102);
 act('t1','a','clue',[],103);
 assert.equal(publicTeamEmoji(round).teams[0].clued,false,'clearing is stored on the host');
 act('t1','a','clue',[stroke],104);
 act('t2','c','clue',[other],104);
 assert.equal(view('t1','b').drawing,undefined);
 assert.throws(()=>act('t1','a','clue',[stroke],12100),/abgelaufen/);
 advanceTeamEmoji(round,12100);
 assert.equal(round.deadline,19100);
 assert.deepEqual(view('t1','b').drawing,[stroke]);
 assert.deepEqual(view('t2','d').drawing,[other]);
 assert.equal(view('t1','b').target,undefined);
 assert.equal(publicTeamEmoji(round).results,undefined);
 act('t1','b','guess','Powder',12101);
 advanceTeamEmoji(round,19100);
 assert.equal(round.phase,'awaiting-reveal');
 assert.equal(publicTeamEmoji(round).solution,undefined);
 assert.equal(publicTeamEmoji(round).results,undefined);
 assert.equal(view('t1','b').drawing,undefined);
 assert.equal(advanceTeamEmoji(round,20000),false);
 assert.equal(finishTeamEmoji(round),true);
 assert.equal(finishTeamEmoji(round),false);
 const result=publicTeamEmoji(round);
 assert.equal(result.solution,'Jinx');
 assert.deepEqual(result.results.map(team=>team.status),['correct','no-guess','no-roles']);
 assert.deepEqual(result.results[0].drawing,[stroke]);
 assert.equal(result.results[0].points,125);
 assert.equal(teamEmojiForPlayer(newTeamEmojiRound(q,state,roster,'next'),'t1','a').role,'');
});

test('emoji guess timeout with missing answer stays private until explicit reveal',()=>{
 const r=newTeamEmojiRound(question,state,roster,'timeout');
 for(const [t,c,g] of [['t1','a','b'],['t2','c','d']]){
  playTeamEmoji(r,t,c,'role','clue',1);playTeamEmoji(r,t,g,'role','guess',1);
 }
 advanceTeamEmoji(r,2);
 playTeamEmoji(r,'t1','a','clue',['👩‍🚀','🇩🇪','❄️'],3);
 playTeamEmoji(r,'t2','c','clue',['🔥'],3);
 advanceTeamEmoji(r,r.deadline);
 playTeamEmoji(r,'t1','b','guess','KAISA',r.deadline-1);
 assert.equal(r.phase,'guess');
 advanceTeamEmoji(r,r.deadline);
 assert.equal(r.phase,'awaiting-reveal');
 assert.equal(publicTeamEmoji(r).results,undefined);
 assert.equal(publicTeamEmoji(r).solution,undefined);
 assert.equal(JSON.stringify(publicTeamEmoji(r)).includes('🇩🇪'),false);
 assert.equal(finishTeamEmoji(r),true);
 const p=publicTeamEmoji(r);
 assert.deepEqual(p.results.map(x=>[x.status,x.points]),[['correct',175],['no-guess',0],['no-roles',0]]);
 assert.deepEqual(p.results[0].clues,['👩‍🚀','🇩🇪','❄️']);
});
test('teams without clues do not prevent waiting; invalid fourth emoji cannot replace a valid clue',()=>{
 const r=newTeamEmojiRound(question,state,roster,'no-clues');
 for(const [t,c,g] of [['t1','a','b'],['t2','c','d']]){
  playTeamEmoji(r,t,c,'role','clue',1);playTeamEmoji(r,t,g,'role','guess',1);
 }
 advanceTeamEmoji(r,2);
 playTeamEmoji(r,'t1','a','clue',['🔥','🔥','🔥'],3);
 assert.throws(()=>playTeamEmoji(r,'t1','a','clue',['🐱','🇩🇪','🧑🏾‍🚀','🔥'],4),/Emojis/);
 assert.deepEqual(r.teams.t1.clues,['🔥','🔥','🔥']);
 advanceTeamEmoji(r,r.deadline);
 playTeamEmoji(r,'t1','b','guess','KAISA',r.deadline-1);
 assert.equal(r.phase,'awaiting-reveal');
 finishTeamEmoji(r);
 assert.equal(r.results[1].status,'no-clues');
});

test('drawing: all eligible teams answering ends the timer but cannot expose artwork or solution until host reveal',()=>{
 const q={type:'team-draw',answerText:'Jinx',points:125,teamDraw:{drawSeconds:5,guessSeconds:5}};
 const r=newTeamEmojiRound(q,state,roster,'draw-all');
 const stroke=[0,1,10,10,100,50],other=[2,0,0,80,44,10];
 for(const [t,c,g] of [['t1','a','b'],['t2','c','d']]){
  playTeamEmoji(r,t,c,'role','clue',1);playTeamEmoji(r,t,g,'role','guess',1);
 }
 advanceTeamEmoji(r,2);
 assert.equal(finishTeamEmoji(r),false);
 playTeamEmoji(r,'t1','a','clue',[stroke],3);
 playTeamEmoji(r,'t2','c','clue',[other],3);
 advanceTeamEmoji(r,r.deadline);
 assert.deepEqual(teamEmojiForPlayer(r,'t1','b').drawing,[stroke]);
 assert.equal(finishTeamEmoji(r),false);
 playTeamEmoji(r,'t1','b','guess','Jinx',r.deadline-2);
 playTeamEmoji(r,'t2','d','guess','Ahri',r.deadline-1);
 assert.equal(r.phase,'awaiting-reveal');assert.equal(r.deadline,0);
 const waiting=publicTeamEmoji(r);
 assert.equal(waiting.solution,undefined);assert.equal(waiting.results,undefined);
 assert.equal(JSON.stringify(waiting).includes('drawing'),false);
 assert.throws(()=>playTeamEmoji(r,'t1','b','guess','Ahri',10001),/Rolle/);
 assert.equal(finishTeamEmoji(r),true);
 assert.deepEqual(r.results.map(x=>[x.status,x.points]),[['correct',125],['wrong',0],['no-roles',0]]);
 assert.deepEqual(r.results[0].drawing,[stroke]);
 assert.deepEqual(r.results[1].drawing,[other]);
 assert.equal(finishTeamEmoji(r),false);
});

test('older browser fallback cannot pack multiple adjacent emojis into a single clue',()=>{
 const original=Intl.Segmenter;
 try{
  Intl.Segmenter=undefined;
  assert.deepEqual(emojisFromText('🔥❄️🇩🇪🧑🏾‍🚀'),['🔥','❄️','🇩🇪']);
  assert.deepEqual(emojisFromText('🧑🏾‍🚀#️⃣🏴‍☠️🔥'),['🧑🏾‍🚀','#️⃣','🏴‍☠️']);
  const r=newTeamEmojiRound(question,state,roster,'fallback');
  playTeamEmoji(r,'t1','a','role','clue',1);
  playTeamEmoji(r,'t1','b','role','guess',1);
  advanceTeamEmoji(r,2);
  assert.throws(()=>playTeamEmoji(r,'t1','a','clue',['🔥🔥🔥🔥'],3),/Emojis/);
  playTeamEmoji(r,'t1','a','clue',['🧑🏾‍🚀','🇩🇪','#️⃣'],3);
  assert.equal(r.teams.t1.clues.length,3);
 }finally{Intl.Segmenter=original;}
});
