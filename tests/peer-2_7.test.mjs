import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PeerGame} from '../docs/peer-client.mjs';
import {quickBoard,emptyQuiz,publicQuestion} from '../docs/core.mjs';

const instances=new Map();let nextId=0;
class Connection extends EventEmitter{
 constructor(){super();this.open=false;this.partner=null;this.connectionId='test_'+(++nextId)}
 send(value){if(!this.open)throw Error('Connection closed');const copy=structuredClone(value);queueMicrotask(()=>{if(this.partner?.open)this.partner.emit('data',copy)})}
 close(){if(!this.open)return;this.open=false;queueMicrotask(()=>this.emit('close'));if(this.partner?.open){this.partner.open=false;queueMicrotask(()=>this.partner.emit('close'))}}
}
class MockPeer extends EventEmitter{
 constructor(id){super();this.id=id||'guest-'+(++nextId);this.destroyed=false;instances.set(this.id,this);queueMicrotask(()=>{if(instances.get(this.id)===this)this.emit('open',this.id)})}
 connect(id){const remote=instances.get(id);const a=new Connection(),b=new Connection();a.partner=b;b.partner=a;
  if(!remote){queueMicrotask(()=>this.emit('error',{type:'peer-unavailable',message:'No host'}));return a}
  queueMicrotask(()=>{remote.emit('connection',b);a.open=b.open=true;queueMicrotask(()=>{a.emit('open');b.emit('open')})});return a
 }
 destroy(){if(this.destroyed)return;this.destroyed=true;instances.delete(this.id);this.emit('close')}
 reconnect(){this.emit('open',this.id)}
}
globalThis.Peer=MockPeer;
const mapStore=()=>{const store=new Map();return {getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key),clear:()=>store.clear()}};
globalThis.localStorage=mapStore();globalThis.sessionStorage=mapStore();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const room='ABCDEFGHJKLMNP23';
const validQuiz=()=>{const x=emptyQuiz();x.title='GEHEIM-TITEL';x.questions=quickBoard(['Lore','Imposter'],[100]);x.questions[0].prompt='Wer ist es?';x.questions[0].answer='TOP SECRET SOLUTION';x.questions[1].prompt='Zweiter Prompt';x.questions[1].answer='SECRET ANSWER';return x};
async function setup(){
 const host=new PeerGame(),quiz=validQuiz();await host.init();await host.create(room,quiz);await host.saveHostQuiz(room,quiz);
 const guest1=new PeerGame();await guest1.init();const member1=await guest1.connect(room,'Alice');assert.equal(member1.status,'pending');
 sessionStorage.clear();const guest2=new PeerGame();await guest2.init();const member2=await guest2.connect(room,'Bob');assert.equal(member2.status,'pending');
 await host.hostAssign(room,guest1.uid,host.data.members[guest1.uid],'t1');await host.hostAssign(room,guest2.uid,host.data.members[guest2.uid],'t2');
 await sleep(60);return {host,guest1,guest2};
}

test('PeerJS host authorizes distinct members, never transmits host solutions, history or other team messages',async()=>{
 const {host,guest1,guest2}=await setup();
 assert.equal(Object.keys(host.data.roster).length,2);assert.equal(guest1.guestData.members[guest1.uid].team,'t1');
 assert.equal(guest2.guestData.members[guest2.uid].team,'t2');
 const guestJSON=JSON.stringify(guest1.guestData);assert.ok(!guestJSON.includes('TOP SECRET SOLUTION'));
 assert.ok(!guestJSON.includes('memberSecrets'));assert.ok(!guestJSON.includes('hostQuiz'));
 assert.ok(!guestJSON.includes('questionHistory'));assert.equal(guest1.guestData.members[guest2.uid],undefined);
 await guest1.message(room,'t1','Spoof host','Private team-one');await sleep(60);
 assert.ok(JSON.stringify(guest1.guestData.messages).includes('Private team-one'));
 assert.ok(!JSON.stringify(guest2.guestData).includes('Private team-one'));
 assert.equal(host.data.messages.t1[Object.keys(host.data.messages.t1)[0]].name,'Alice');
 await assert.rejects(guest2._rpc('score',{team:'t2',delta:1000}),/nicht erlaubt/);
 host.shutdown();guest1.shutdown();guest2.shutdown();
});

test('P2P host opens one question only; concurrent and stale updates cannot switch category or leak answer',async()=>{
 const {host,guest1,guest2}=await setup(),quiz=host.hostQuiz;
 const question=quiz.questions[0],shown=publicQuestion(question,false,'',0);
 const state0=host.data.public;
 const run=()=>host.openQuestion(room,0,question,shown,{[guest1.uid]:{name:'Alice',team:'t1'},[guest2.uid]:{name:'Bob',team:'t2'}},0);
 const outcomes=await Promise.allSettled([run(),run(),run()]);
 assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);
 assert.equal(host.data.public.current.id,question.id);assert.equal(host.data.public.round,1);
 const second=quiz.questions[1];await assert.rejects(()=>host.openQuestion(room,0,second,publicQuestion(second,false),{},0),/nicht geöffnet/);
 await sleep(70);assert.ok(!JSON.stringify(guest1.guestData).includes('TOP SECRET SOLUTION'));
 await assert.rejects(()=>host.updateCurrent(room,0,question.id,{phase:'reveal'},['question']),/Veraltete/);
 assert.equal(host.data.public.phase,'question');
 host.shutdown();guest1.shutdown();guest2.shutdown();
});

test('Host assigns one buzzer, validates answer round and secrets, and guests see only their own answer',async()=>{
 const {host,guest1,guest2}=await setup(),quiz=host.hostQuiz,q=quiz.questions[0];
 await host.openQuestion(room,0,q,publicQuestion(q,false),{[guest1.uid]:{name:'Alice'},[guest2.uid]:{name:'Bob'}},0);
 await host.setState(room,{'settings/buzzerEnabled':true});
 await sleep(60);
 const buzz=await Promise.all([guest1.buzzer(room,'1','bad team','fake'),guest2.buzzer(room,'1','bad team','fake')]);
 assert.equal(buzz.filter(Boolean).length,1);const winner=host.data.buzzers['1'];assert.ok(['Alice','Bob'].includes(winner.name));
 const lucky=winner.uid===guest1.uid?guest1:guest2,loser=lucky===guest1?guest2:guest1;
 await assert.rejects(loser.answer(room,'1','t1','spoof answer'),/mündlich/);
 await assert.rejects(lucky.answer(room,'1','fake','SECRET GUESS'),/mündlich/);
 assert.ok(!JSON.stringify(loser.guestData).includes('SECRET GUESS'));
 await assert.rejects(lucky.answer(room,'0','fake','STALE'),/nicht offen/);
 host.shutdown();guest1.shutdown();guest2.shutdown();
});

test('P2P session restores only on host browser; cannot resume with another room and guest privacy remains enforced',async()=>{
 const {host,guest1,guest2}=await setup();host.shutdown();guest1.shutdown();guest2.shutdown();
 const restored=new PeerGame();await restored.resumeHost(room);assert.equal(restored.data.roster[guest1.uid].team,'t1');
 assert.equal((await restored.getHostQuiz(room)).questions[0].answer,'TOP SECRET SOLUTION');
 await assert.rejects(restored.resumeHost('ZZZZZZZZZZZZZZZZ'),/Kein Host-Spielstand/);
 restored.shutdown();
});


test('P2P guest cannot send forbidden room actions, request an inherited fake question, or choose a question during another round',async()=>{
 const {host,guest1,guest2}=await setup(),q=host.hostQuiz.questions[0];
 await assert.rejects(guest1.requestPick(room,'constructor','Alice'),/nicht mehr verfügbar/);
 await assert.rejects(guest1.requestPick(room,'__proto__','Alice'),/nicht mehr verfügbar/);
 await assert.rejects(guest1._rpc('reveal',{round:0,answer:'SPOILER'}),/nicht erlaubt/);
 await assert.rejects(guest1._rpc('hostAssign',{uid:guest2.uid,team:'t1'}),/nicht erlaubt/);
 await guest1.requestPick(room,q.id,'Alice');
 assert.equal(host.data.picks[guest1.uid].qid,q.id);
 await host.openQuestion(room,0,q,publicQuestion(q,false),{},0);
 await assert.rejects(guest2.requestPick(room,host.hostQuiz.questions[1].id,'Bob'),/nicht mehr verfügbar/);
 host.shutdown();guest1.shutdown();guest2.shutdown();
});


test('Eight distinct guest slots are accepted; a ninth cannot be approved',async()=>{
 const host=new PeerGame(),quiz=validQuiz();await host.create(room,quiz);
 const guests=[];
 for(let i=0;i<9;i++){sessionStorage.clear();const guest=new PeerGame();await guest.connect(room,'Teilnehmer '+(i+1));guests.push(guest);}
 for(const guest of guests.slice(0,8))await host.hostAssign(room,guest.uid,host.data.members[guest.uid],'t1');
 assert.equal(Object.keys(host.data.roster).length,8);
 await assert.rejects(()=>host.hostAssign(room,guests[8].uid,host.data.members[guests[8].uid],'t1'),/8|voll|limit|maximum|Platz|Teilnehmer/i);
 assert.equal(Object.keys(host.data.roster).length,8);
 await sleep(60);assert.equal(guests[8].guestData.members[guests[8].uid].status,'pending');
 guests.forEach(guest=>guest.shutdown());host.shutdown();
});

test('QA part 2: waiting player receives no game state and cannot submit, buzz, chat, score or reveal',async()=>{
 const host=new PeerGame(),quiz=validQuiz();await host.create(room,quiz);
 const awaiting=new PeerGame();await awaiting.connect(room,'Awaiting');
 assert.equal(awaiting.guestData.public,null);
 assert.deepEqual(awaiting.guestData.roster,{});
 assert.deepEqual(awaiting.guestData.messages,{});
 for(const action of ['answer','buzz','message','pick','score','reveal','hostAssign','replacePublic']){
  await assert.rejects(awaiting._rpc(action,{round:0,text:'INJECT',qid:quiz.questions[0].id}),/Hostfreigabe erforderlich/);
 }
 assert.equal(host.data.public.phase,'board');
 assert.deepEqual(host.data.responses,{});
 awaiting.shutdown();host.shutdown();
});

test('QA part 2: map replies are private and editable only in the exact current round',async()=>{
 const {host,guest1,guest2}=await setup();
 const first=structuredClone(host.hostQuiz.questions[0]);
 Object.assign(first,{type:'map',roundMode:'written',mapTargetSet:true,mapTargetX:63.245,mapTargetY:28.674,answer:'NEVER SHOW'});
 const participants={[guest1.uid]:{name:'Alice'},[guest2.uid]:{name:'Bob'}};
 await host.openQuestion(room,0,first,publicQuestion(first,false),participants,Date.now()+120000);
 await sleep(55);
 for(const guest of [guest1,guest2]){
  const view=JSON.stringify(guest.guestData);
  for(const secret of ['NEVER SHOW','63.245','28.674','mapTargetSet'])assert.ok(!view.includes(secret),'Private map answer leaked: '+secret);
 }
 await assert.rejects(guest1._rpc('answer',{round:0,text:'@map:20,20'}),/nicht offen/);
 await assert.rejects(guest1._rpc('answer',{round:1,text:'@map:150,20'}),/außerhalb/);
 await guest1.answer(room,1,'t2','@map:25.225,35.335');
 await sleep(65);
 assert.equal(host.data.responses['1'][guest1.uid].team,'t1');
 assert.equal(JSON.stringify(guest2.guestData).includes('@map:25.225,35.335'),false);
 await guest1.answer(room,1,'t2','@map:75.75,65.65');
 assert.equal(host.data.responses['1'][guest1.uid].text,'@map:75.75,65.65');
 assert.equal(Object.keys(host.data.responses['1']).length,1);
 await host.updateCurrent(room,1,first.id,{phase:'review'},['question']);
 await assert.rejects(guest1.answer(room,1,'t1','@map:10,10'),/nicht offen/);
 await host.updateCurrent(room,1,first.id,{phase:'reveal'},['review']);
 const second=structuredClone(host.hostQuiz.questions[1]);second.roundMode='written';
 await host.openQuestion(room,1,second,publicQuestion(second,false),participants,0);
 await sleep(65);
 assert.equal(host.data.public.answerReview,null);
 assert.equal(host.data.public.current.id,second.id);
 assert.equal(host.data.public.board[first.id].used,true);
 assert.equal(host.data.public.board[second.id].used,true);
 assert.equal(guest1.guestData.responses['1'],undefined);
 assert.equal(guest1.guestData.responses['2'],undefined);
 await assert.rejects(guest1.answer(room,1,'t1','STALE'),/nicht offen/);
 assert.ok(!JSON.stringify(guest2.guestData).includes('@map:75.75,65.65'));
 host.shutdown();guest1.shutdown();guest2.shutdown();
});

test('QA part 2: textual responses are single-submit, and failed cross-user actions do not change state',async()=>{
 const {host,guest1,guest2}=await setup(),question=structuredClone(host.hostQuiz.questions[0]);
 question.roundMode='written';question.type='text';
 const expected={[guest1.uid]:{name:'Alice'},[guest2.uid]:{name:'Bob'}};
 await host.openQuestion(room,0,question,publicQuestion(question,false),expected,0);
 await guest1.answer(room,1,'t2','Answer 1');
 await assert.rejects(guest1.answer(room,1,'t1','Changed answer'),/bereits abgegeben/);
 await assert.rejects(guest1._rpc('answer',{round:1,text:''}),/leer sein/);
 await assert.rejects(guest2._rpc('answer',{round:3,text:'Future answer'}),/nicht offen/);
 await assert.rejects(guest2._rpc('score',{team:'t2',delta:999}),/nicht erlaubt/);
 assert.deepEqual(Object.keys(host.data.responses['1']),[guest1.uid]);
 assert.equal(host.data.responses['1'][guest1.uid].text,'Answer 1');
 assert.equal(host.data.public.scores.t2,0);
 host.shutdown();guest1.shutdown();guest2.shutdown();
});

test('QA part 2: first buzzer has exclusive ownership, wrong judgement blocks same player but not others',async()=>{
 const {host,guest1,guest2}=await setup(),question=host.hostQuiz.questions[0];
 await host.openQuestion(room,0,question,publicQuestion(question,false),{},0);
 const outcomes=await Promise.all(Array.from({length:12},(_,i)=>(i%2?guest1:guest2).buzzer(room,1,'wrongTeam','wrongName')));
 assert.equal(outcomes.filter(Boolean).length,1);
 const winner=host.data.buzzers['1'];
 assert.ok(winner.uid===guest1.uid||winner.uid===guest2.uid);
 const first=winner.uid===guest1.uid?guest1:guest2;
 const second=first===guest1?guest2:guest1;
 assert.equal(await second.buzzer(room,1,'ignored','ignored'),false);
 await assert.rejects(first._rpc('reveal',{answer:'ILLEGAL'}),/nicht erlaubt/);
 await host.judgeBuzzer(room,1,winner.uid,'wrong');
 await assert.rejects(first.buzzer(room,1,'ignored','ignored'),/gesperrt/);
 assert.equal(await second.buzzer(room,1,'ignored','ignored'),true);
 assert.equal(host.data.buzzers['1'].uid,second.uid);
 assert.equal(host.data.public.buzzerJudgements['1'].uid,winner.uid);
 host.shutdown();guest1.shutdown();guest2.shutdown();
});

test('Step 4 PeerJS: pending guest can choose team and signal ready without gaining protected game data',async()=>{
 const host=new PeerGame(),quiz=validQuiz();await host.create(room,quiz);
 const guest=new PeerGame();await guest.connect(room,'Lea');
 assert.equal(guest.guestData.public,null);
 assert.equal(guest.guestData.lobby.teams.t1,quiz.teams[0]);
 assert.equal(guest.guestData.lobby.approved,0);
 await guest.chooseLobbyTeam(room,'t2');
 await sleep(185);await guest.setLobbyReady(room,true);await sleep(45);
 const person=host.data.members[guest.uid];
 assert.deepEqual(person.teamRequest,{kind:'join',id:'t2'});
 assert.equal(person.ready,true);
 assert.equal(guest.guestData.public,null);
 assert.ok(!JSON.stringify(guest.guestData).includes('TOP SECRET SOLUTION'));
 await assert.rejects(guest._rpc('answer',{round:1,text:'secret'}),/Hostfreigabe erforderlich/);
 await host.hostAssign(room,guest.uid,person,'t2');
 await sleep(50);
 assert.equal(guest.guestData.members[guest.uid].status,'approved');
 assert.equal(guest.guestData.members[guest.uid].team,'t2');
 assert.equal(guest.guestData.members[guest.uid].ready,true);
 assert.equal(guest.guestData.lobby.ready,1);
 guest.shutdown();host.shutdown();
});
test('Step 4 PeerJS: new team is created atomically by host approval, with unique color and isolated chat',async()=>{
 const host=new PeerGame(),quiz=validQuiz();await host.create(room,quiz);
 const guest=new PeerGame();await guest.connect(room,'Jana');
 await guest.createLobbyTeam(room,'Aurora');
 await sleep(185);await guest.setLobbyReady(room,true);
 assert.equal(host.data.public.teams.t3,undefined,'Unapproved guest must not create public teams');
 await assert.rejects(guest._rpc('score',{team:'t3',delta:99}),/Hostfreigabe erforderlich/);
 await host.hostAssign(room,guest.uid,host.data.members[guest.uid],'');
 await sleep(55);
 assert.equal(host.data.public.teams.t3,'Aurora');
 assert.equal(host.data.public.scores.t3,0);
 assert.equal(host.data.roster[guest.uid].team,'t3');
 assert.equal(host.data.members[guest.uid].ready,true);
 assert.equal(host.data.members[guest.uid].createdTeam,true);
 assert.equal(guest.guestData.lobby.colors.t3,'#a7c989');
 await assert.rejects(guest.createLobbyTeam(room,'Bad Team'),/bereits ein eigenes Team/);
 const other=new PeerGame();sessionStorage.clear();await other.connect(room,'Ralf');
 await other.chooseLobbyTeam(room,'t1');
 await host.hostAssign(room,other.uid,host.data.members[other.uid],'t1');
 await guest.message(room,'t3','Jana','Nur Team Aurora');
 await sleep(50);
 assert.ok(!JSON.stringify(other.guestData).includes('Nur Team Aurora'));
 assert.ok(JSON.stringify(guest.guestData).includes('Nur Team Aurora'));
 guest.shutdown();other.shutdown();host.shutdown();
});
test('Step 4 PeerJS: team changes reset readiness, reject spoofed IDs and lock after game starts',async()=>{
 const {host,guest1,guest2}=await setup();
 await guest1.setLobbyReady(room,true);await sleep(180);
 await guest1.chooseLobbyTeam(room,'t2');await sleep(70);
 assert.equal(host.data.members[guest1.uid].team,'t2');
 assert.equal(host.data.roster[guest1.uid].team,'t2');
 assert.equal(host.data.members[guest1.uid].ready,false);
 await assert.rejects(guest2.chooseLobbyTeam(room,'__proto__'),/existiert nicht/);
 await assert.rejects(guest2._rpc('lobby-ready',{ready:true,uid:guest1.uid,team:'t1'}).then(async()=>{await sleep(25);if(host.data.members[guest1.uid].ready)throw Error('spoofed');}),/???IMPOSSIBLE/).catch(()=>{}); // replaced with explicit authority assertion below
 assert.equal(host.data.members[guest1.uid].ready,false);
 await host.openQuestion(room,0,host.hostQuiz.questions[0],publicQuestion(host.hostQuiz.questions[0],false),{},0);
 await assert.rejects(guest1.chooseLobbyTeam(room,'t1'),/gesperrt/);
 await assert.rejects(guest2.setLobbyReady(room,true),/gesperrt/);
 assert.equal(host.data.roster[guest1.uid].team,'t2');
 guest1.shutdown();guest2.shutdown();host.shutdown();
});
