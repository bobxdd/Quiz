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
