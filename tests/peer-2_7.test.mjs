import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PeerGame,turnServer,peerError,connectionAdvice,peerOptions,configureTurnRelay,hasTurnRelay,testTurnRelay} from '../docs/peer-client.mjs';
import {selectingTeam} from '../docs/question-flow.mjs';
import {quickBoard,emptyQuiz,publicQuestion} from '../docs/core.mjs';

const instances=new Map();let nextId=0;
class Connection extends EventEmitter{
 constructor(){super();this.open=false;this.partner=null;this.connectionId='test_'+(++nextId)}
 send(value){if(!this.open)throw Error('Connection closed');const bytes=new TextEncoder().encode(JSON.stringify(value)).length;if(bytes>24000)throw Error('RTC max-size 24 KB exceeded: '+bytes);this.sentBytes??=[];this.sentBytes.push(bytes);const copy=structuredClone(value);queueMicrotask(()=>{if(this.partner?.open)this.partner.emit('data',copy)})}
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

test('a committed action whose receipt is lost gets replayed once after the host resumes',async()=>{
 const {host,guest1,guest2}=await setup();
 guest2.shutdown();
 const ctx=host.guestConnections.get(guest1.uid);
 const send=ctx.conn.send.bind(ctx.conn);
 let release;
 const disconnected=new Promise(resolve=>{release=resolve;});
 ctx.conn.send=packet=>{
  if(packet.t==='ack'&&packet.ok){ctx.conn.close();release();return;}
  send(packet);
 };
 const sending=guest1.message(room,'t1','Alice','Einmal zustellen');
 await disconnected;
 host.shutdown();
 const resumed=new PeerGame();
 try{
  await resumed.resumeHost(room);
  assert.equal(await sending,true);
  assert.equal(Object.values(resumed.data.messages.t1).filter(m=>m.text==='Einmal zustellen').length,1);
  assert.equal(resumed.data.roster[guest1.uid].team,'t1');
 }finally{
  guest1.shutdown();resumed.shutdown();
 }
});

test('private TURN settings accept UDP, TCP/TLS and IPv6, with separate credentials',()=>{
 const credentials={username:'player',credential:'test-only'};
 for(const url of ['turn:relay.example:3478','turns:relay.example:443?transport=tcp','turn:[2001:db8::1]:3478']){
  assert.deepEqual(turnServer({url,...credentials}),{urls:url,...credentials});
 }
 for(const url of ['stun:relay.example','https://relay.example','turn:user@relay.example','turn:relay.example?transport=ftp']){
  assert.throws(()=>turnServer({url,...credentials}),/TURN-Adresse/);
 }
});

test('concurrent identical guest actions share a receipt without a second mutation',async()=>{
 const {host,guest1,guest2}=await setup();
 try{
  const send=()=>guest1.message(room,'t1','Alice','Einmal trotz Doppelklick');
  assert.deepEqual(await Promise.all([send(),send()]),[true,true]);
  assert.equal(Object.values(host.data.messages.t1).length,1);
 }finally{guest1.shutdown();guest2.shutdown();host.shutdown();}
});

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


test('Ten distinct guest slots are accepted; an eleventh cannot be approved',async()=>{
 const host=new PeerGame(),quiz=validQuiz();await host.create(room,quiz);
 const guests=[];
 for(let i=0;i<11;i++){sessionStorage.clear();const guest=new PeerGame();await guest.connect(room,'Teilnehmer '+(i+1));guests.push(guest);}
 for(const guest of guests.slice(0,10))await host.hostAssign(room,guest.uid,host.data.members[guest.uid],'t1');
 assert.equal(Object.keys(host.data.roster).length,10);
 await assert.rejects(()=>host.hostAssign(room,guests[10].uid,host.data.members[guests[10].uid],'t1'),/10|voll|limit|maximum|Platz|Teilnehmer/i);
 assert.equal(Object.keys(host.data.roster).length,10);
 await sleep(60);assert.equal(guests[10].guestData.members[guests[10].uid].status,'pending');
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
 await sleep(185);
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
 await guest2._rpc('lobby-ready',{ready:true,uid:guest1.uid,team:'t1'});
 await sleep(35);
 assert.equal(host.data.members[guest1.uid].ready,false,'Spoofed uid must not change another member');
 assert.equal(host.data.members[guest2.uid].ready,true);
 await host.openQuestion(room,0,host.hostQuiz.questions[0],publicQuestion(host.hostQuiz.questions[0],false),{},0);
 await assert.rejects(guest1.chooseLobbyTeam(room,'t1'),/gesperrt/);
 await assert.rejects(guest2.setLobbyReady(room,true),/gesperrt/);
 assert.equal(host.data.roster[guest1.uid].team,'t2');
 guest1.shutdown();guest2.shutdown();host.shutdown();
});

test('Host can create teams directly; guest cannot bypass host rights, five-team cap or round locks',async()=>{
 const host=new PeerGame(),quiz=validQuiz();await host.create(room,quiz);
 const extra=await host.hostCreateLobbyTeam(room,'Gold');
 assert.deepEqual({id:extra.id,name:extra.name},{id:'t3',name:'Gold'});
 assert.equal(host.data.public.teams.t3,'Gold');
 assert.equal(host.data.public.scores.t3,0);
 assert.equal(Object.keys(host.data.roster).length,0,'Host must not occupy a player slot');
 const guest=new PeerGame();await guest.connect(room,'Guest');
 await assert.rejects(guest.hostCreateLobbyTeam(room,'Spoof'),/Host|host|nicht berechtigt/i);
 await assert.rejects(guest._rpc('hostCreateLobbyTeam',{name:'Spoof'}),/Hostfreigabe erforderlich|nicht erlaubt/);
 await assert.rejects(host.hostCreateLobbyTeam(room,'gold'),/bereits/);
 await host.hostCreateLobbyTeam(room,'Violett');
 await host.hostCreateLobbyTeam(room,'Smaragd');
 assert.equal(Object.keys(host.data.public.teams).length,5);
 await assert.rejects(host.hostCreateLobbyTeam(room,'Sechstes'),/5 Teams/);
 await assert.rejects(guest.createLobbyTeam(room,'Sechstes'),/5 Teams/);
 await host.openQuestion(room,0,host.hostQuiz.questions[0],publicQuestion(host.hostQuiz.questions[0],false),{},0);
 await assert.rejects(host.hostCreateLobbyTeam(room,'Zu Spät'),/Spielbeginn/);
 assert.equal(Object.keys(host.data.public.teams).length,5);
 guest.shutdown();host.shutdown();
});


test('Correct buzzer judgement reveals the complete answer and score in one host snapshot to all guests',async()=>{
 const {host,guest1,guest2}=await setup();
 try{
  const q=host.hostQuiz.questions[0];
  await host.openQuestion(room,0,q,publicQuestion(q,false),null,0);
  await sleep(70);
  assert.equal(host.data.public.current.answer,undefined,'unanswered solution must remain host-only');
  assert.equal(guest1.guestData.public.current.answer,undefined);
  assert.equal(guest2.guestData.public.current.answer,undefined);
  assert.equal(await guest1.buzzer(room,'1','spoof team','spoof name'),true);
  const buzzer=host.data.buzzers['1'];assert.equal(buzzer.uid,guest1.uid);
  const before=host.data.public.scores.t1;
  await assert.rejects(host.judgeBuzzer(room,1,guest1.uid,'correct',{phase:'reveal'}),/Lösungsfreigabe/);
  assert.equal(host.data.public.phase,'question','failed reveal must not award points');
  assert.equal(host.data.public.scores.t1,before);
  const patch={current:publicQuestion(q,true),phase:'reveal',deadline:0,pausedRemaining:0};
  const out=await host.judgeBuzzer(room,1,guest1.uid,'correct',patch);
  assert.equal(out.delta,100);
  assert.equal(host.data.public.phase,'reveal');
  assert.equal(host.data.public.current.answer,q.answer);
  assert.equal(host.data.public.scores.t1,before+100);
  assert.equal(host.data.public.buzzerResolved['1'].uid,guest1.uid);
  await sleep(95);
  for(const guest of [guest1,guest2]){
   assert.equal(guest.guestData.public.current.answer,q.answer,'guest must see answer after correct host judgement');
   assert.equal(guest.guestData.public.phase,'reveal','phase and solution must arrive together');
   assert.equal(guest.guestData.public.scores.t1,before+100);
  }
  assert.equal(await guest2.buzzer(room,1,'t2','Bob'),false,'Other guests cannot buzz once answer was revealed');
  await assert.rejects(host.judgeBuzzer(room,1,guest1.uid,'correct',patch),/Buzzer nicht mehr aktuell|Buzzer wurde/);
  // The host controls the move to the next question even after auto-reveal.
  await host.updateCurrent(room,1,q.id,{phase:'board',current:null},['reveal']);
  assert.equal(host.data.public.phase,'board');
  assert.equal(host.data.public.current,undefined);
 }finally{host.shutdown();guest1.shutdown();guest2.shutdown();}
});

test('A wrong buzzer decision never exposes the answer and another team can try',async()=>{
 const {host,guest1,guest2}=await setup();
 try{
  const q=host.hostQuiz.questions[0];
  await host.openQuestion(room,0,q,publicQuestion(q,false),null,0);
  await sleep(60);
  assert.equal(await guest1.buzzer(room,1,'t1','Alice'),true);
  const wrong=await host.judgeBuzzer(room,1,guest1.uid,'wrong');
  assert.equal(wrong.delta,-50);
  assert.equal(host.data.public.phase,'question');
  assert.equal(host.data.public.current.answer,undefined);
  await sleep(70);
  assert.equal(guest2.guestData.public.current.answer,undefined);
  assert.equal(await guest2.buzzer(room,1,'t2','Bob'),true);
  const patch={current:publicQuestion(q,true),phase:'reveal',deadline:0,pausedRemaining:0};
  await host.judgeBuzzer(room,1,guest2.uid,'correct',patch);
  assert.equal(host.data.public.current.answer,q.answer);
  assert.equal(host.data.public.scores.t1,-50);
  assert.equal(host.data.public.scores.t2,100);
 }finally{host.shutdown();guest1.shutdown();guest2.shutdown();}
});


test('12-second 512-KB WAV transfers over capped RTC packets; cache and late guests work',async()=>{
 const {host,guest1,guest2}=await setup();let late=null;
 try{
  const original=host.hostQuiz.questions[0];
  const audio='data:audio/wav;base64,'+'A'.repeat(512000);
  const question={...original,type:'audio',roundMode:'buzzer',audio,answer:'Big WAV answer'};
  await host.openQuestion(room,0,question,publicQuestion(question,false),null,0);
  await sleep(550);
  for(const g of [guest1,guest2]){
   assert.equal(g.guestData.public?.current?.audio,audio);
   assert.equal(g.guestData.public?.phase,'question');
  }
  const conn=host.guestConnections.get(guest1.uid).conn;
  assert.ok(conn.sentBytes.length>60,'Long audio should be split into dozens of small packets');
  assert.ok(conn.sentBytes.every(v=>v<=24000));
  const before=conn.sentBytes.length;
  await host.setState(room,{'settings/chatOpen':false});
  await sleep(140);
  assert.equal(guest1.guestData.public.current.audio,audio);
  const bytes=conn.sentBytes.slice(before).reduce((sum,x)=>sum+x,0);
  assert.ok(bytes<40000,'A small update must not retransmit the whole audio: '+bytes);
  // A new pending guest remains unable to read the already-running question.
  sessionStorage.clear();
  const pending=new PeerGame();await pending.init();await pending.connect(room,'Too late');
  assert.equal(pending.guestData.public,null,'Late pending member cannot inspect audio');
  pending.shutdown();
  // Existing, approved participants must recover the complete WAV after reconnect.
  const reconnectIdentity={uid:guest1.uid,secret:guest1.secret};
  guest1.shutdown();
  sessionStorage.setItem('bq-p2p-guest-'+room,JSON.stringify(reconnectIdentity));
  late=new PeerGame();await late.init();await late.connect(room,'Alice');
  await sleep(550);
  assert.equal(late.guestData.members[late.uid]?.status,'approved');
  assert.equal(late.guestData.public?.current?.audio,audio,'Reconnected approved member receives full audio');
  assert.equal(await guest2.buzzer(room,1,'t2','Bob'),true);
  await host.judgeBuzzer(room,1,guest2.uid,'correct',{current:publicQuestion(question,true),phase:'reveal',deadline:0,pausedRemaining:0});
  await sleep(180);
  for(const g of [guest2,late]){
   assert.equal(g.guestData.public?.phase,'reveal');
   assert.equal(g.guestData.public?.current?.answer,'Big WAV answer');
   assert.equal(g.guestData.public?.current?.audio,audio);
  }
 }finally{late?.shutdown();host.shutdown();guest1.shutdown();guest2.shutdown();}
});


test('fixed team turns reserve one field while every team can buzz and only the host can score',async()=>{
 const {host,guest1,guest2}=await setup();
 try{
  await host.setState(room,{published:true,started:true});await sleep(75);
  const [q,next]=host.hostQuiz.questions;
  assert.equal(selectingTeam(host.data.public),'t1');
  await assert.rejects(guest2.requestPick(room,q.id),/anderes Team/);
  await assert.rejects(guest1._rpc('pick',{qid:q.id,round:77}),/früheren Runde/);
  assert.equal(await guest1.requestPick(room,q.id),true);
  await assert.rejects(guest1.requestPick(room,next.id),/bereits eine Frage/);
  await host.openQuestion(room,0,q,publicQuestion(q,false),null,0,{covered:true});
  await sleep(60);
  await assert.rejects(guest2.buzzer(room,1,'t2','Bob'),/nicht freigegeben|gesperrt/,'no buzzer before host uncovering');
  await host.uncoverQuestion(room,1,q.id);await sleep(65);
  assert.equal(await guest2.buzzer(room,1,'t2','Bob'),true,'non-selecting team has the same buzzer rights');
  assert.equal(host.data.public.scores.t2,0,'buzzing must never score automatically');
  await assert.rejects(guest2._rpc('judgeBuzzer',{result:'correct'}),/nicht erlaubt/);
  assert.equal(host.data.public.scores.t2,0);
  await host.judgeBuzzer(room,1,guest2.uid,'wrong');await sleep(65);
  assert.equal(host.data.public.scores.t2,-50);
  assert.equal(selectingTeam(host.data.public),'t1','a wrong answer does not change the choosing turn');
  await assert.rejects(guest2.buzzer(room,1,'t2','Bob'),/gesperrt/);
  assert.equal(await guest1.buzzer(room,1,'t1','Alice'),true);
  assert.equal(host.data.public.scores.t1,0,'the next buzz also waits for host judgement');
  await host.judgeBuzzer(room,1,guest1.uid,'correct',{current:publicQuestion(q,true),phase:'reveal',deadline:0,pausedRemaining:0});
  await host.returnToBoard(room,1,q.id);await sleep(75);
  assert.equal(selectingTeam(host.data.public),'t2');
  assert.equal(host.data.public.scores.t1,100);
  assert.equal(host.data.public.scores.t2,-50);
  await assert.rejects(guest1.requestPick(room,next.id),/anderes Team/);
  assert.equal(await guest2.requestPick(room,next.id),true);
  await assert.rejects(host.returnToBoard(room,1,q.id),/nicht mehr aktiv/);
  assert.equal(selectingTeam(host.data.public),'t2');
 }finally{host.shutdown();guest1.shutdown();guest2.shutdown();}
});

test('connection errors distinguish a missing host from an occupied host peer ID', async()=>{
 assert.match(peerError({type:'peer-unavailable'},'guest'),/Host.*nicht erreichbar/);
 assert.match(peerError({type:'unavailable-id'},'host'),/Raumcode.*vergeben/);
 assert.match(peerError({type:'webrtc'},'guest'),/TURN-Server/);
 assert.match(connectionAdvice({iceState:'failed',relay:false}),/PeerJS-Relays/);
 assert.match(connectionAdvice({iceState:'failed',relay:true}),/Host UND Gast/);
 const missing=new PeerGame();
 try{
  await assert.rejects(missing.connect('ZZZZZZZZZZZZZZZZ','Guest'),/Host.*nicht erreichbar/);
  assert.equal(missing.diagnostics().phase,'failed');
 }finally{missing.shutdown();}
});

test('PeerJS default ICE remains active unless a private TURN was explicitly configured',()=>{
 configureTurnRelay(null);
 const base=peerOptions();
 assert.equal(base.debug,0);
 assert.equal(base.config,undefined,'PeerJS must retain its own default ICE servers, as in Straßenbingo');
 assert.equal(hasTurnRelay(),false);
 configureTurnRelay({url:'turns:relay.example:443?transport=tcp',username:'tester',credential:'VERY_SECRET_DO_NOT_LEAK'});
 try{
  assert.equal(hasTurnRelay(),true);
  const opts=peerOptions();
  assert.ok(opts.config.iceServers.some(server=>server.urls.includes('stun:stun.cloudflare.com:3478')));
  assert.ok(opts.config.iceServers.some(server=>server.username==='tester'&&server.credential==='VERY_SECRET_DO_NOT_LEAK'));
  const data=new PeerGame().diagnostics();
  assert.equal(data.turnConfigured,true);
  assert.ok(!JSON.stringify(data).includes('VERY_SECRET_DO_NOT_LEAK'));
  assert.ok(!JSON.stringify(data).includes('relay.example'));
 }finally{configureTurnRelay(null);}
});

test('TURN probe validates a real relay candidate without needing to send IPs or credentials to peers',async()=>{
 configureTurnRelay({url:'turn:relay.example:3478',username:'test',credential:'test'});
 const initial=globalThis.RTCPeerConnection;
 let configured;
 class FakeConnection{
  constructor(options){configured=options;this.events=new Map();this.closed=false;}
  addEventListener(name,listener){this.events.set(name,listener)}
  createDataChannel(label){assert.equal(label,'brainquiz-turn-test')}
  async createOffer(){return {type:'offer',sdp:'test'}}
  async setLocalDescription(){queueMicrotask(()=>this.events.get('icecandidate')?.({candidate:{type:'relay',candidate:'candidate:fake typ relay'}}))}
  close(){this.closed=true;}
 }
 globalThis.RTCPeerConnection=FakeConnection;
 try{
  assert.equal(await testTurnRelay(1000),true);
  assert.equal(configured.iceTransportPolicy,'relay');
  assert.equal(configured.iceServers.length,1);
 }finally{globalThis.RTCPeerConnection=initial;configureTurnRelay(null);}
});

test('host can restart its transport without wiping scores or guest identities',async()=>{
 const {host,guest1,guest2}=await setup();
 try{
  await host.score(room,'t1',350);
  const oldId=guest1.uid;
  await host.restartHostTransport(room);
  await Promise.all([guest1.retryGuestNow(),guest2.retryGuestNow()]);
  await sleep(80);
  assert.equal(host.connected,true);
  assert.equal(host.data.public.scores.t1,350);
  assert.equal(guest1.uid,oldId);
  assert.equal(guest1.guestData.members[oldId].status,'approved');
  assert.equal(guest2.guestData.public.scores.t1,350);
  assert.equal(host.guestConnections.size,2);
 }finally{guest1.shutdown();guest2.shutdown();host.shutdown();}
});

test('unverified peer channels are removed when they disconnect',async()=>{
 const {host,guest1,guest2}=await setup();
 const anonymous=new MockPeer(),id='brainquiz27-'+room.toLowerCase();
 try{
  const unauthenticated=anonymous.connect(id);
  await sleep(25);
  assert.equal(host.unverifiedConnections.size,1);
  unauthenticated.close();
  await sleep(30);
  assert.equal(host.unverifiedConnections.size,0);
 }finally{anonymous.destroy();guest1.shutdown();guest2.shutdown();host.shutdown();}
});

test('an outstanding buzzer is never bypassed by manual solution or board navigation, but may be reset and canceled',async()=>{
 const {host,guest1,guest2}=await setup();
 try{
  await host.setState(room,{published:true,started:true});
  const q=host.hostQuiz.questions[0];
  await host.openQuestion(room,0,q,publicQuestion(q,false),null,0,{covered:true});
  await host.uncoverQuestion(room,1,q.id);await sleep(80);
  assert.equal(await guest1.buzzer(room,1,'t1','Alice'),true);
  await assert.rejects(
   host.updateCurrent(room,1,q.id,{phase:'reveal',current:publicQuestion(q,true),deadline:0},['question']),
   /Zuerst Richtig oder Falsch/
  );
  await assert.rejects(host.returnToBoard(room,1,q.id),/Offener Buzzer/);
  await assert.rejects(host.cancelQuestion(room,1,q.id),/offenen Buzzer/);
  await host.updateCurrent(room,1,q.id,{phase:'paused',deadline:0,pausedRemaining:12000},['question']);
  await assert.rejects(
   host.updateCurrent(room,1,q.id,{phase:'reveal',current:publicQuestion(q,true),deadline:0},['paused']),
   /Zuerst Richtig oder Falsch/
  );
  await assert.rejects(host.returnToBoard(room,1,q.id),/Offener Buzzer/);
  await host.updateCurrent(room,1,q.id,{phase:'question',deadline:0,pausedRemaining:0},['paused']);
  assert.equal(host.data.public.board[q.id].used,true);
  await host.clearBuzzer(room,1);
  const cancelled=await host.cancelQuestion(room,1,q.id);
  assert.equal(cancelled.phase,'board');
  assert.equal(host.data.public.board[q.id].used,false);
  assert.equal(selectingTeam(host.data.public),'t1');
  assert.equal(host.data.public.round,1,'stale guest packets must not belong to next question');
  await host.openQuestion(room,1,q,publicQuestion(q,false),null,0,{covered:true});
  assert.equal(host.data.public.round,2);
 }finally{host.shutdown();guest1.shutdown();guest2.shutdown();}
});

test('wrong verdict creates a non-refundable scored event, even if the buzzer has been released',async()=>{
 const {host,guest1,guest2}=await setup();
 try{
  await host.setState(room,{published:true,started:true});
  const q=host.hostQuiz.questions[0];
  await host.openQuestion(room,0,q,publicQuestion(q,false),null,0,{covered:true});
  await host.uncoverQuestion(room,1,q.id);await sleep(80);
  assert.equal(await guest1.buzzer(room,1,'t1','Alice'),true);
  await host.judgeBuzzer(room,1,guest1.uid,'wrong');
  assert.equal(host.data.public.scores.t1,-50);
  await assert.rejects(host.cancelQuestion(room,1,q.id),/Antworten oder Punktwertungen/);
  assert.equal(host.data.public.board[q.id].used,true);
  const revealed=await host.updateCurrent(room,1,q.id,{phase:'reveal',current:publicQuestion(q,true),deadline:0,pausedRemaining:0},['question']);
  assert.equal(revealed.phase,'reveal');
  assert.equal(host.data.public.scores.t1,-50);
  await host.returnToBoard(room,1,q.id);
  assert.equal(selectingTeam(host.data.public),'t2');
 }finally{host.shutdown();guest1.shutdown();guest2.shutdown();}
});

test('host may pass selection rights to an absent team without affecting scores or violating a reserved pick',async()=>{
 const {host,guest1,guest2}=await setup();
 try{
  await host.setState(room,{published:true,started:true});await sleep(60);
  const q=host.hostQuiz.questions[0];
  assert.equal(await guest1.requestPick(room,q.id),true);
  await assert.rejects(host.skipSelection(room),/Auswahlrecht/);
  await host.clearPicks(room);
  assert.equal(await host.skipSelection(room),'t2');
  assert.equal(selectingTeam(host.data.public),'t2');
  assert.equal(host.data.public.scores.t1,0);
  assert.equal(host.data.public.scores.t2,0);
  await assert.rejects(guest1.requestPick(room,q.id),/anderes Team/);
  assert.equal(await guest2.requestPick(room,q.id),true);
  assert.equal(host.data.public.questionPick.team,'t2');
 }finally{host.shutdown();guest1.shutdown();guest2.shutdown();}
});

test('A three-player two-team written round awards exactly ONE official answer per team',async()=>{
 const {host,guest1,guest2}=await setup();
 sessionStorage.clear();const guest3=new PeerGame();
 try{
  await guest3.init();
  await guest3.connect(room,'Alina');
  await host.hostAssign(room,guest3.uid,host.data.members[guest3.uid],'t1');
  const question=host.hostQuiz.questions[0];question.roundMode='written';
  const snapshot=Object.fromEntries([[guest1.uid,{name:'Alice'}],[guest2.uid,{name:'Bob'}],[guest3.uid,{name:'Alina'}]]);
  await host.openQuestion(room,0,question,publicQuestion(question,false),snapshot,0,{covered:true});
  await host.uncoverQuestion(room,1,question.id);
  const entries=Object.fromEntries(Object.entries(snapshot).map(([uid,person])=>[uid,{
   name:person.name,submitted:true,revealed:true,value:person.name+' answer'
  }]));
  await host.updateCurrent(room,1,question.id,{phase:'review',answerReview:{round:1,entries}},['question']);
  const one=await host.judgeWritten(room,1,guest1.uid,'correct');
  assert.equal(one.total,100);
  assert.equal(host.data.public.scores.t1,100);
  assert.equal(host.data.public.writtenTeamRepresentatives['1'].t1,guest1.uid);
  await assert.rejects(host.judgeWritten(room,1,guest3.uid,'correct'),/andere Antwort offiziell gewertet/);
  assert.equal(host.data.public.scores.t1,100,'three-member teams must not accumulate extra question values');
  assert.equal(host.data.public.playerScores?.[guest3.uid],undefined,'rejected judgement is atomic');
  const firstEvent=host.hostScoreAudit(room).at(-1);
  await host.hostUndoScore(room,firstEvent.id);
  assert.equal(host.data.public.scores.t1,0);
  assert.equal(host.data.public.writtenTeamRepresentatives['1']?.t1,undefined,'undo allows host to choose a different official team answer');
  await host.judgeWritten(room,1,guest3.uid,'wrong');
  assert.equal(host.data.public.scores.t1,-50);
  await host.judgeWritten(room,1,guest2.uid,'correct');
  assert.equal(host.data.public.scores.t2,100,'other team has its own one-score opportunity');
  await host.judgeWritten(room,1,guest2.uid,'wrong');
  assert.equal(host.data.public.scores.t2,-50,'official response can be corrected without stacking scores');
  assert.equal(host.data.public.scores.t1,-50);
 }finally{guest3.shutdown();guest1.shutdown();guest2.shutdown();host.shutdown();}
});

test('Host cannot secretly skip unanswered round-one fields without an explicit force flag',async()=>{
 const {host,guest1,guest2}=await setup();
 try{
  // The default quiz has only round one; declare a second board field.
  const q=host.hostQuiz.questions[1];
  q.boardRound=2;
  host.data.public.board[q.id].boardRound=2;
  await host.setState(room,{published:true,started:true});
  await assert.rejects(host.advanceBoard(room,0),/Runde 2/);
  assert.equal(host.data.public.boardRound,1);
  const advanced=await host.advanceBoard(room,0,{force:true});
  assert.equal(advanced.boardRound,2);
  assert.equal(host.data.public.scores.t1,0);
  await assert.rejects(host.advanceBoard(room,0,{force:true}),/Runde 2/);
 }finally{guest1.shutdown();guest2.shutdown();host.shutdown();}
});

/** Build a full standard 5x5 board without requiring a second fixture package.
 * Mark nineteen fields played, exactly as if previous turns were completed. */
function makeFinalSixFixture(host,mode='buzzer'){
 const source=host.hostQuiz.questions[0];
 source.roundMode=mode;
 for(let i=0;i<23;i++){
  const q={...source,id:'finalsix-'+i,title:'Bonus '+i};
  host.hostQuiz.questions.push(q);
  host.data.public.board[q.id]={
   id:q.id,boardRound:1,category:q.category,type:q.type,points:q.points,used:false
  };
 }
 const ids=Object.keys(host.data.public.board);
 assert.equal(ids.length,25);
 for(const id of ids.slice(0,19)){
  host.data.public.board[id].used=true;
  host.data.public.used[id]=true;
 }
 return host.hostQuiz.questions.find(q=>q.id===ids[19]);
}

test('Host and guests use the locked double value for final-six buzzers, verdict, reveal and half-value penalty',async()=>{
 const {host,guest1,guest2}=await setup();
 try{
  await host.setState(room,{published:true,started:true});
  const question=makeFinalSixFixture(host);
  const base=question.points;
  await host.openQuestion(room,0,question,publicQuestion(question,false),null,0,{covered:true});
  assert.equal(host.data.public.current.points,base*2,'covered question already announces doubled value');
  assert.equal(host.data.public.current.doublePoints,true);
  await host.uncoverQuestion(room,1,question.id);
  assert.equal(host.data.public.current.points,base*2,'uncover must not lose the multiplier');
  await sleep(80);
  assert.equal(guest1.guestData.public.current.points,base*2,'guest sees the same official question value');
  assert.equal(await guest1.buzzer(room,1,'t1','Alice'),true);
  const reveal={phase:'reveal',deadline:0,pausedRemaining:0,
   current:publicQuestion(question,true)};
  await host.judgeBuzzer(room,1,guest1.uid,'correct',reveal);
  assert.equal(host.data.public.scores.t1,base*2);
  assert.equal(host.data.public.current.points,base*2,'answer reveal must not reset points');
  assert.equal(host.data.public.current.doublePoints,true);
  assert.equal(host.data.public.scores.t2,0);
  await host.returnToBoard(room,1,question.id);
  const next=host.hostQuiz.questions.find(q=>!host.data.public.used[q.id]);
  await host.openQuestion(room,1,next,publicQuestion(next,false),null,0,{covered:true});
  await host.uncoverQuestion(room,2,next.id);
  await sleep(70);
  assert.equal(await guest2.buzzer(room,2,'t2','Bob'),true);
  const wrong=await host.judgeBuzzer(room,2,guest2.uid,'wrong');
  assert.equal(wrong.delta,-next.points,'wrong on ×2 is −base, not −base/2');
  assert.equal(host.data.public.scores.t1,base*2);
  assert.equal(host.data.public.scores.t2,-next.points);
 }finally{guest1.shutdown();guest2.shutdown();host.shutdown();}
});

test('One official TEAM score per doubled written question; extra teammates cannot multiply points',async()=>{
 const {host,guest1,guest2}=await setup();
 sessionStorage.clear();const guest3=new PeerGame();
 try{
  await guest3.init();
  await guest3.connect(room,'Alina');
  await host.hostAssign(room,guest3.uid,host.data.members[guest3.uid],'t1');
  await host.setState(room,{published:true,started:true});
  const question=makeFinalSixFixture(host,'written'),base=question.points;
  const participants=Object.fromEntries([
   [guest1.uid,{name:'Alice'}],[guest2.uid,{name:'Bob'}],[guest3.uid,{name:'Alina'}]
  ]);
  await host.openQuestion(room,0,question,publicQuestion(question,false),participants,0,{covered:true});
  await host.uncoverQuestion(room,1,question.id);
  const entries=Object.fromEntries(Object.entries(participants).map(([uid,p])=>
   [uid,{name:p.name,submitted:true,revealed:true,value:p.name+' answer'}]
  ));
  await host.updateCurrent(room,1,question.id,{phase:'review',answerReview:{round:1,entries}},['question']);
  assert.equal((await host.judgeWritten(room,1,guest1.uid,'correct')).total,base*2);
  assert.equal(host.data.public.scores.t1,base*2);
  await assert.rejects(host.judgeWritten(room,1,guest3.uid,'correct'),/andere Antwort offiziell gewertet/);
  assert.equal(host.data.public.scores.t1,base*2);
  await host.judgeWritten(room,1,guest2.uid,'wrong');
  assert.equal(host.data.public.scores.t2,-base);
  assert.equal(Object.keys(host.data.public.scores).length,2,'exactly one total per team');
  assert.equal(host.data.public.writtenTeamRepresentatives['1'].t1,guest1.uid);
  assert.equal(host.data.public.writtenTeamRepresentatives['1'].t2,guest2.uid);
  await assert.rejects(host.scorePerson(room,guest1.uid,{kind:'manual',delta:100}),/gemeinsamen Punktestand/);
 }finally{guest3.shutdown();guest1.shutdown();guest2.shutdown();host.shutdown();}
});
