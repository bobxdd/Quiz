import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedQuiz,publicQuestion,validateQuestion} from '../docs/core.mjs';
import {advanceTeamEmoji,emojiGroup,emojiName,MAX_EMOJI_PALETTE,newTeamEmojiRound,normalizeTeamEmoji,parseEmojiPalette,playTeamEmoji,publicTeamEmoji,teamEmojiForPlayer} from '../docs/team-emoji.mjs';
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

test('The larger default palette is available without author configuration and custom picks retain their indices',()=>{
 const settings=normalizeTeamEmoji();
 const defaults=parseEmojiPalette(settings.palette);
 assert.ok(defaults.length>=80&&defaults.length<=MAX_EMOJI_PALETTE);
 assert.equal(new Set(defaults.map(emojiGroup)).size,6);
 assert.equal(emojiName('⚓'),'Anker');
 assert.equal(normalizeTeamEmoji({palette:' '}).palette,settings.palette);
 assert.equal(normalizeTeamEmoji({palette:'🔥 ❄️ ⚡ 🌊 🌪️ 🌿 🌙 ☀️ ⭐ ✨ 🌈 🌋 🗡️ 🏹 🛡️ 🔨 ⚙️ 🤖 💣 ☠️ 👻 😈 🎭 👑 🧪 🎵 🔮 💎 ❤️ 🤝 🦊 🐻 🐺 🐱 🐦 🐉 🕷️ 🐍 🦈 🦋 🐵 🍄 👁️ 🩸 ⏳ 🧊 🍌 🏴‍☠️'}).palette,settings.palette);
 assert.deepEqual(parseEmojiPalette(normalizeTeamEmoji({palette:'👩‍🚀 🦊'}).palette),['👩‍🚀','🦊']);
 assert.equal(emojiGroup('👩‍🚀'),'Weitere');
});

test('team question imports with private settings and never opens a buzzer',()=>{
 const q=normalizedQuiz({questions:[question]}).questions[0];
 const publicCopy=publicQuestion(q);
 assert.equal(q.roundMode,'team-emoji');
 assert.deepEqual(q.teamEmoji,question.teamEmoji);
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
 assert.throws(()=>act('t1','a','clue',[0,4]),/vorgegebenen/);
 act('t1','a','clue',[0,2]);
 act('t2','c','clue',[1]);
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
 act('t2','d','guess','Tochter der Leere',9001);
 assert.equal(publicTeamEmoji(round).results,undefined);
 advanceTeamEmoji(round,14000);
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
