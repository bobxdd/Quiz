/* BrainQuiz Studio 2.7 — Host-authoritative PeerJS/WebRTC room transport.
 * GitHub Pages serves only static files. PeerJS Cloud provides signaling;
 * the connected host browser keeps the authoritative room in memory.
 * No Firebase, cloud database, or public hosting of private quiz solutions.
 */
import {canBuzz,roundMode,applyBuzzerJudgement,buzzerCoverActive} from './round-rules.mjs';
import {JOKER_TYPES,normalizeJokerConfig,initialJokers,placeJokerDrops,jokerCount,changeJokerCharge,drawJokerForQuestion,awardJokerForCorrectAnswer,activeChronobreak,shieldApplies,CHRONOBREAK_MS} from './joker-system.mjs';
import {decodePoint} from './map-tools.mjs';
import {buildPublicBoard,buildTeams,buildScores,manualPlayerLabels,publicQuestion,updatePlayerScore,judgementDelta,questionSeconds,orderReady,orderResponseIndices} from './core.mjs';
import {approval,MAX_PLAYERS,MAX_TEAMS,validTeamId,cleanTeamName,addLobbyTeam,renameLobbyTeam,canArrangeLobby,canAdmitPlayer,waitsForNextQuestion,lobbySnapshot,participantSnapshot} from './lobby-model.mjs';
import {openQuestionState,applyQuestionChanges,returnToBoardState,advanceBoardState,makeSelectionTurn,selectingTeam,cancelQuestionState,skipSelectionTurn} from './question-flow.mjs';
import {scoreEvent,appendScoreEvent,undoScoreEvent,regradeScoreEvent} from './score-ledger.mjs';
import {saveHostCheckpoint,loadHostCheckpoint,deleteHostCheckpoint,saveLocalHostQuiz,loadBestHostQuiz,isGuestResumeCode,rememberGuestResume} from './backup-store.mjs';
import {TEAM_EMOJI,isTeamChallenge,newTeamEmojiRound,playTeamEmoji,advanceTeamEmoji,finishTeamEmoji,publicTeamEmoji,teamEmojiForPlayer} from './team-emoji.mjs';

const HOST_PREFIX='brainquiz27-';
const UID_RE=/^[a-zA-Z0-9_-]{8,100}$/;
const safeUid=id=>UID_RE.test(id||'')&&!['__proto__','constructor','prototype'].includes(id);
const TOKEN_RE=/^[a-f0-9]{32,128}$/;
const PROJECTOR_TOKEN_RE=/^[a-f0-9]{32}$/;
const MAX_WAITING=24, MAX_MESSAGE_BYTES=18000;

/* PeerJS JSON may exceed RTCDataChannel message limits with embedded WAV/images.
 * Fragment into 8K code-unit packets, preserving Unicode surrogate pairs.
 * Recipients never render a partial snapshot. */
const WIRE_PART_CHARS=8000,WIRE_MAX_CHARS=10_000_000,WIRE_MAX_PARTS=1500;
function wireMessages(message,id){
 const json=JSON.stringify(message);
 if(json.length<=WIRE_PART_CHARS)return [message];
 if(json.length>WIRE_MAX_CHARS)throw Error('Live-Spielstand ist für die Übertragung zu groß.');
 const chunks=[];
 for(let start=0;start<json.length;){
  let end=Math.min(json.length,start+WIRE_PART_CHARS);
  if(end<json.length&&json.charCodeAt(end-1)>=0xD800&&json.charCodeAt(end-1)<=0xDBFF)end--;
  if(end<=start)throw Error('Ungültiges Unicode-Paket.');
  chunks.push(json.slice(start,end));start=end;
 }
 if(chunks.length>WIRE_MAX_PARTS)throw Error('Live-Spielstand überschreitet das Nachrichtenlimit.');
 return chunks.map((data,part)=>({t:'wire-part',id,part,total:chunks.length,data}));
}
function nextWirePart(current,msg){
 if(msg?.t!=='wire-part')return {message:msg,partial:current};
 if(!Number.isInteger(msg.id)||msg.id<1||!Number.isInteger(msg.total)||msg.total<2||msg.total>WIRE_MAX_PARTS||
    !Number.isInteger(msg.part)||msg.part<0||msg.part>=msg.total||
    typeof msg.data!=='string'||!msg.data.length||msg.data.length>WIRE_PART_CHARS){
  return {message:null,partial:null};
 }
 let pending=current;
 if(!pending||pending.id!==msg.id){
  if(msg.part!==0)return {message:null,partial:null};
  pending={id:msg.id,total:msg.total,items:[],size:0,startedAt:Date.now()};
 }
 if(pending.total!==msg.total||pending.items.length!==msg.part||
    Date.now()-pending.startedAt>30000||pending.size+msg.data.length>WIRE_MAX_CHARS){
  return {message:null,partial:null};
 }
 pending.items.push(msg.data);pending.size+=msg.data.length;
 if(pending.items.length<pending.total)return {message:null,partial:pending};
 try{return {message:JSON.parse(pending.items.join('')),partial:null};}
 catch{return {message:null,partial:null};}
}
const wireTick=()=>new Promise(resolve=>setTimeout(resolve,0));

const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const safeText=(value,length)=>String(value??'').trim().slice(0,length);
const randomHex=(bytes=20)=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const peerId=room=>HOST_PREFIX+room.toLowerCase();
const pathValue=(data,path)=>path.split('/').filter(Boolean).reduce((v,key)=>v==null?undefined:v[key],data);
function setPath(data,path,value){const keys=path.split('/').filter(Boolean);if(!keys.length)throw Error('Leerer Datenpfad');let target=data;for(const key of keys.slice(0,-1)){if(!target[key]||typeof target[key]!=='object')target[key]={};target=target[key];}if(value===null||value===undefined)delete target[keys.at(-1)];else target[keys.at(-1)]=clone(value);}
// PeerJS uses DIFFERENT errors for a missing guest destination vs. an
// occupied host ID. Mixing these up previously sent users down the wrong path.
export function peerError(error,role='guest'){
 const type=String(error?.type||'');
 if(type==='peer-unavailable')return 'Der Host ist unter diesem Raumcode derzeit nicht erreichbar. Host-Fenster und Raumcode prüfen.';
 if(type==='unavailable-id')return role==='host'?'Dieser Raumcode ist schon vergeben. Den alten Host-Tab schließen oder einen neuen Raum erstellen.':'Diese Peer-ID wird bereits verwendet.';
 if(['network','server-error','socket-error','socket-closed'].includes(type))return 'Der PeerJS-Signalserver ist nicht erreichbar. Netzwerk prüfen und anschließend erneut verbinden.';
 if(['webrtc','negotiation-failed'].includes(type))return 'Der WebRTC-Datenkanal konnte nicht aufgebaut werden. PeerJS versucht direkte Wege und Standard-Relays; diese sind nicht garantiert verfügbar. Ein erreichbarer eigener TURN-Server kann helfen.';
 return String(error?.message||error||'WebRTC-Verbindungsfehler').slice(0,220);
}
export function connectionAdvice({iceState='unknown',relay=false,phase='connecting'}={}){
 if(iceState==='failed')return relay
   ?'WebRTC-ICE fehlgeschlagen. Eigenen TURN-Server, Port und Zugangsdaten auf Host UND Gast prüfen.'
   :'WebRTC-ICE fehlgeschlagen. Auch die eingebauten PeerJS-Relays haben keine Verbindung ermöglicht. Host erreichbar? Für schwierige Netze ist ein aktiver TURN-Dienst nötig.';
 if(phase==='signaling')return 'Verbindung zum Signalserver wird aufgebaut. Raumcode und Internetzugang prüfen.';
 if(phase==='handshake')return 'Datenkanal offen; der vollständige Spielstand wird vom Host erwartet.';
 return relay?'Eigener TURN-Server für diese Verbindung konfiguriert. Er muss für beide Seiten erreichbar sein.':'PeerJS-Standardverbindung: direkte WebRTC-Route und vorhandene öffentliche Relay-Einträge werden versucht (nicht garantiert verfügbar).';
}
function networkFailure(message,kind='rtc'){const error=new Error(message);error.connectionKind=kind;return error;}
let loadingPeer=null;
export async function loadPeerJS(){
 if(typeof globalThis.Peer==='function')return globalThis.Peer;
 if(loadingPeer)return loadingPeer;
 loadingPeer=new Promise((resolve,reject)=>{
  if(typeof document==='undefined')return reject(Error('PeerJS benötigt einen Browser.'));
  const sources=[
   'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
   'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js'
  ];
  let attempt=0;
  const next=()=>{
   if(typeof globalThis.Peer==='function'){resolve(globalThis.Peer);return;}
   if(attempt>=sources.length){reject(Error('PeerJS konnte über beide CDNs nicht geladen werden. Netzwerk, Adblocker oder DNS prüfen.'));return;}
   const script=document.createElement('script');
   script.src=sources[attempt++];script.async=true;script.crossOrigin='anonymous';
   let done=false;const timeout=setTimeout(()=>finish(false),11000);
   const finish=ok=>{
    if(done)return;done=true;clearTimeout(timeout);
    script.onload=script.onerror=null;
    if(ok&&typeof globalThis.Peer==='function')resolve(globalThis.Peer);
    else{script.remove();next();}
   };
   script.onload=()=>finish(true);script.onerror=()=>finish(false);
   document.head.appendChild(script);
  };
  next();
 }).catch(error=>{loadingPeer=null;throw error;});
 return loadingPeer;
}
const TURN_STORAGE='bq-turn-relay-v1';
const BASE_ICE=[{urls:['stun:stun.cloudflare.com:3478','stun:stun.l.google.com:19302']}];
const CONNECT_TIMEOUT_MS=26000;
export function hasTurnRelay(){
 try{const stored=JSON.parse(sessionStorage.getItem(TURN_STORAGE)||'null');return !!stored&&!!turnServer({url:stored.urls,username:stored.username,credential:stored.credential});}
 catch{return false;}
}

export function turnServer({url,username,credential}){
 const urls=String(url||'').trim();
 const user=String(username||'').trim();
 const pass=String(credential||'');
 if(urls.length>300||!/^turns?:[a-z0-9.[\]:-]+(?:\?transport=(?:udp|tcp))?$/i.test(urls)||
    !user||user.length>512||!pass||pass.length>512)throw Error('Gültige TURN-Adresse, Nutzername und Passwort eingeben.');
 return {urls,username:user,credential:pass};
}
export function configureTurnRelay(input){
 if(!input){sessionStorage.removeItem(TURN_STORAGE);return;}
 const relay=turnServer(input);
 sessionStorage.setItem(TURN_STORAGE,JSON.stringify(relay));
}
export function peerOptions(){
 // Same connection strategy as D0minatxr/strassenbingo: let PeerJS use its
 // built-in ICE configuration, instead of replacing it with a STUN-only list.
 // NOTE: PeerJS discontinued its free TURN service in 2023. Bundled relay
 // addresses are NOT a guaranteed replacement for an actively managed TURN.
 let custom=null;
 try{
  const stored=JSON.parse(sessionStorage.getItem(TURN_STORAGE)||'null');
  if(stored)custom=turnServer({url:stored.urls,username:stored.username,credential:stored.credential});
 }catch{}
 if(!custom)return {debug:0};
 const iceServers=[...BASE_ICE.map(row=>({...row,urls:[...row.urls]})),custom];
 return {debug:0,config:{iceServers,iceCandidatePoolSize:4,iceTransportPolicy:'all'}};
}

/** Verify that the configured TURN server actually allocates a relay candidate.
 * No guest/host connection or candidate IP is exposed by this local probe. */
export async function testTurnRelay(timeoutMs=8500){
 if(!hasTurnRelay())throw Error('Zuerst vollständige TURN-Zugangsdaten speichern.');
 if(typeof RTCPeerConnection!=='function')throw Error('Dieser Browser unterstützt den WebRTC-Verbindungstest nicht.');
 let relay;
 try{
  const stored=JSON.parse(sessionStorage.getItem(TURN_STORAGE)||'null');
  relay=turnServer({url:stored?.urls,username:stored?.username,credential:stored?.credential});
 }catch{throw Error('TURN-Konfiguration ist ungültig. Bitte neu speichern.');}
 const pc=new RTCPeerConnection({iceServers:[relay],iceTransportPolicy:'relay'});
 let timer=null,done=false,lastCode=0;
 const result=new Promise((resolve,reject)=>{
  const finish=(worked)=>{
   if(done)return;done=true;clearTimeout(timer);
   worked?resolve(true):reject(Error('TURN-Test: kein Relay-Kandidat empfangen'+(lastCode?' (ICE '+lastCode+')':'')+'. Adresse, Port, Transport und Zugangsdaten prüfen.'));
  };
  timer=setTimeout(()=>finish(false),Math.max(1500,Math.min(20000,Number(timeoutMs)||8500)));
  pc.addEventListener('icecandidate',event=>{
   if(event.candidate?.type==='relay'||/ typ relay(?: |$)/.test(event.candidate?.candidate||''))finish(true);
   else if(event.candidate===null)finish(false);
  });
  pc.addEventListener('icecandidateerror',event=>{lastCode=Number(event?.errorCode)||0;});
  pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete')finish(false);});
 });
 try{
  pc.createDataChannel('brainquiz-turn-test');
  const offer=await pc.createOffer();
  await pc.setLocalDescription(offer);
  return await result;
 }finally{clearTimeout(timer);pc.close();}
}

export function watchProjector(room,token,onFrame,onStatus){
 if(!/^[A-HJ-NP-Z2-9]{16}$/.test(room)||!PROJECTOR_TOKEN_RE.test(token))throw Error('Ungültiger Beamer-Link.');
 let stopped=false,peer=null,retryTimer=null,handshakeTimer=null,attempt=0;
 function stop(){
  stopped=true;clearTimeout(retryTimer);clearTimeout(handshakeTimer);
  const closing=peer;peer=null;closing?.destroy();
 }
 function retry(candidate){
  if(stopped||peer!==candidate)return;
  clearTimeout(handshakeTimer);peer=null;candidate?.destroy();
  onStatus('Beamer-Verbindung unterbrochen. Wiederverbindung läuft …');
  retryTimer=setTimeout(start,Math.min(10000,1500+1500*attempt++));
 }
 async function start(){
  if(stopped)return;
  try{
   const Peer=await loadPeerJS();if(stopped)return;
   const candidate=peer=new Peer(undefined,peerOptions());
   let conn=null,ready=false,partial=null;
   handshakeTimer=setTimeout(()=>retry(candidate),CONNECT_TIMEOUT_MS);
   candidate.on('open',()=>{
    if(peer!==candidate||conn)return;
    conn=candidate.connect(peerId(room),{reliable:true,serialization:'json'});
    conn.on('open',()=>{try{conn.send({t:'display-hello',room,token});}catch{retry(candidate);}});
    conn.on('close',()=>retry(candidate));
    conn.on('error',()=>retry(candidate));
    conn.on('data',input=>{
     if(peer!==candidate)return;
     const decoded=nextWirePart(partial,input);partial=decoded.partial;
     const msg=decoded.message;
     if(msg?.t==='denied'||msg?.t==='closed'){
      stop();onStatus(msg.reason||'Der Host hat den Raum geschlossen.');return;
     }
     if(msg?.t==='display-ready'){ready=true;attempt=0;clearTimeout(handshakeTimer);}
     if(ready&&msg?.t==='frame')onFrame(msg);
    });
   });
   candidate.on('disconnected',()=>{if(peer===candidate)try{candidate.reconnect();}catch{}});
   candidate.on('error',()=>{if(!conn?.open)retry(candidate);});
  }catch{retry(peer);}
 }
 void start();
 return stop;
}
function guestIdentity(room,restoreCode=''){
 const key='bq-p2p-guest-'+room;let item=null;
 if(isGuestResumeCode(restoreCode)){
  const [uid,secret]=restoreCode.split('.');
  return {uid,secret};
 }
 try{item=JSON.parse(sessionStorage.getItem(key)||'null')}catch{}
 if(!item||!safeUid(item.uid)||!TOKEN_RE.test(item.secret||'')){
  item={uid:'p_'+randomHex(12),secret:randomHex(24)};
  try{sessionStorage.setItem(key,JSON.stringify(item))}catch{}
 }
 return item;
}
function roomData(owner,quiz,{published=false}={}){const jokerConfig=normalizeJokerConfig(quiz.jokerConfig),teams=buildTeams(quiz);return {owner,jokerDrops:placeJokerDrops(quiz),jokerPrivateHints:{},access:{title:quiz.title,createdAt:Date.now()},public:{title:quiz.title,published:published===true,started:false,scoreMode:quiz.scoreMode||'team',phase:'board',round:0,boardRound:1,board:buildPublicBoard(quiz),teams,scores:buildScores(quiz),jokers:initialJokers(teams,jokerConfig),jokerConfig,manualPlayers:manualPlayerLabels(quiz),playerScores:{},buzzerBlocked:{},writtenTeamRepresentatives:{},settings:{buzzerEnabled:true,chatOpen:true,lockOnBuzz:false,timerSeconds:60},used:{}},members:{},roster:{},presence:{},buzzers:{},responses:{},messages:{},picks:{},questionHistory:{}};}

function writtenParticipants(data,round=data.public.round){
 const eligible=Object.entries(data.roster||{}).filter(([uid])=>!waitsForNextQuestion({round},data.members?.[uid]));
 return participantSnapshot(Object.fromEntries(eligible));
}

export class PeerGame{
 constructor(){this.mode='idle';this.uid='';this.secret='';this.room='';this.peer=null;this.conn=null;this.connected=false;this.offset=0;this.data=null;this.guestData={};this.guestConnections=new Map();this.unverifiedConnections=new Set();this.projectorConnections=new Set();this.projectorFrame=null;this.memberSecrets={};this.listeners=[];this.hostQuiz=null;this.pending=new Map();this.uncertainActions=new Map();this.requestNo=0;this.reconnectTimer=null;this.hostReconnectTimer=null;this.hostReconnectAttempts=0;this.snapshotTimer=null;this.cachedQuizAudio=null;this.quitting=false;this.netError='';this.connectionPhase='idle';this.iceState='unknown';this.iceErrorCode=0;this.retryPromise=null;this.connectAttempt=null;}
 async init(){return this;}
 serverNow(){
  const sample=this.mode==='guest'&&this.clockSample;
  return sample?sample.hostTime+(performance.now()-sample.received):Date.now();
 }
 refreshClock(burst=3){
  clearTimeout(this.clockTimer);
  if(this.mode!=='guest'||!this.connected||!this.conn?.open)return;
  const seq=this.clockSequence=(this.clockSequence||0)+1;
  this.clockProbe={seq,sent:performance.now()};
  try{this.conn.send({t:'clock-ping',seq});}catch{}
  this.clockTimer=setTimeout(()=>this.refreshClock(burst>1?burst-1:3),burst>1?300:12000);
  this.clockTimer.unref?.();
 }
 _readClockSample(message){
  const probe=this.clockProbe;
  if(!probe||message.seq!==probe.seq||!Number.isFinite(message.received)||!Number.isFinite(message.sent))return;
  const received=performance.now();
  const transit=Math.max(0,received-probe.sent-Math.max(0,message.sent-message.received));
  if(transit>2000)return;
  // Estimate the host time at receipt from the round trip and retain the
  // least delayed recent sample. The local wall clock never gates a vote.
  const samples=(this.clockSamples||[]).filter(sample=>received-sample.received<25000);
  samples.push({received,hostTime:message.sent+transit/2,transit});
  this.clockSamples=samples.slice(-8);
  this.clockSample=this.clockSamples.reduce((best,sample)=>sample.transit<=best.transit?sample:best);
 }
 diagnostics(){
  return {mode:this.mode,connected:!!this.connected,error:String(this.netError||'').slice(0,160),
    phase:this.connectionPhase||'idle',iceState:this.iceState||'unknown',
    iceErrorCode:Number(this.iceErrorCode)||0,turnConfigured:hasTurnRelay(),
     transportProfile:hasTurnRelay()?'custom-turn':'peerjs-default',
    reconnectAttempts:this.mode==='host'?this.hostReconnectAttempts||0:this.guestReconnectAttempts||0,
    guidance:connectionAdvice({iceState:this.iceState,relay:hasTurnRelay(),phase:this.connectionPhase}),
    lastBackupAt:this.lastBackupAt||0,backupError:this.backupError||'',
    peers:this.mode==='host'?Object.entries(this.data?.members||{}).filter(([,member])=>member.status!=='removed').map(([uid,member])=>{
     const ctx=this.guestConnections.get(uid);
     return {
      uid,name:String(member.name||'Spieler').slice(0,28),
      connected:!!ctx?.conn?.open,lastReceived:ctx?.lastSeenAt||0,lastSent:ctx?.lastSentAt||0,
      lastAck:ctx?.lastAckAt||0,synced:!!ctx?.lastAckAt&&ctx.ackVersion===ctx.snapshotVersion,
      bufferedBytes:Number(ctx?.conn?.dataChannel?.bufferedAmount)||0,iceState:ctx?.iceState||'unknown'
     };
    }):[]};
 }
 _emit(path){
  for(const entry of [...this.listeners]){
   if(path&&entry.path!==path)continue;
   try{entry.cb(this._read(entry.path));}catch(error){console.error('[BrainQuiz Peer watcher]',error);}
  }
 }
 _read(path){if(path==='.info/diagnostics')return this.diagnostics();if(path==='.info/connected')return this.connected;if(path==='.info/serverTimeOffset')return this.offset;const prefix='rooms/'+this.room;if(!path.startsWith(prefix+'/'))return null;return clone(pathValue(this.mode==='host'?this.data:this.guestData,path.slice(prefix.length+1)))??null;}
 watch(path,cb){const entry={path,cb};this.listeners.push(entry);queueMicrotask(()=>{if(this.listeners.includes(entry))cb(this._read(path))});return ()=>{this.listeners=this.listeners.filter(e=>e!==entry)};}
 watchRoom(room,path,cb){if(room!==this.room)throw Error('Falscher Raum.');return this.watch('rooms/'+room+'/'+path,cb)}
 clearWatchers(){this.listeners=[];}
 async _preparePeer(){const Peer=await loadPeerJS();return Peer;}
 _health(phase,issue){
  this.connectionPhase=phase;
  if(typeof issue==='string')this.netError=issue;
  this._emit('.info/diagnostics');
 }
 _watchIce(conn,ctx=null){
  // Connection health is only metadata. NEVER include gathered ICE addresses,
  // local/network IPs, TURN passwords or full getStats() in guest snapshots.
  const attach=()=>{
   const pc=conn?.peerConnection;
   if(!pc||typeof pc.addEventListener!=='function')return;
   const current=()=>{
    const state=String(pc.iceConnectionState||'unknown');
    if(ctx){ctx.iceState=state;}else{
     if(conn!==this.conn)return;
     this.iceState=state;
     if(state==='failed')this.netError=connectionAdvice({iceState:state,relay:hasTurnRelay()});
     this._emit('.info/diagnostics');
    }
   };
   pc.addEventListener('iceconnectionstatechange',current);
   pc.addEventListener('icecandidateerror',event=>{
    const code=Number(event?.errorCode)||0;
    if(ctx){ctx.iceErrorCode=code;}else if(conn===this.conn){
     this.iceErrorCode=code;this._emit('.info/diagnostics');
    }
   });
   current();
  };
  // PeerJS may assign peerConnection shortly after connect(), but mocked
  // peers in the Node test suite have no RTC implementation.
  queueMicrotask(attach);
  if(typeof RTCPeerConnection==='function'&&!conn?.peerConnection)setTimeout(attach,180);
 }
 _scheduleHostReconnect(){
  if(this.hostReconnectTimer||this.quitting||this.mode!=='host'||this.connected)return;
  const delay=Math.min(10000,800*2**Math.min(this.hostReconnectAttempts++,4));
  this.hostReconnectTimer=setTimeout(async()=>{
   this.hostReconnectTimer=null;
   if(this.quitting||this.mode!=='host'||this.connected)return;
   try{
    if(this.peer?.destroyed)await this._openHostPeer(this.room);
    else this.peer?.reconnect();
   }catch(error){this.netError=peerError(error);this._emit();}
   this._scheduleHostReconnect();
  },delay);
 }
 _listenHostPeer(peer){
  peer.on('connection',conn=>{
   if(this.mode!=='host'||this.quitting||this.unverifiedConnections.size>=MAX_WAITING){
    try{conn.close()}catch{}return;
   }
   const ctx={conn,uid:null,ready:false,lastChat:0,wireSequence:0,sentQuizAudioKey:null,wireChain:Promise.resolve()};
   this.unverifiedConnections.add(ctx);
   ctx.helloTimer=setTimeout(()=>{
    if(!ctx.ready){this.unverifiedConnections.delete(ctx);try{conn.close()}catch{}}
   },12000);
   this._watchIce(conn,ctx);
   conn.on('data',msg=>this._receiveFromGuest(ctx,msg));
   const disconnected=()=>{
    clearTimeout(ctx.helloTimer);this.unverifiedConnections.delete(ctx);
    if(ctx.display)this.projectorConnections.delete(ctx);
    else this._disconnectGuest(ctx);
   };
   conn.on('close',disconnected);
   conn.on('error',disconnected);
  });
  const lost=()=>{
   if(this.quitting||this.peer!==peer)return;
   this.connected=false;this.netError='Signalserver getrennt. Wiederverbindung läuft …';this.connectionPhase='reconnecting';
   this._emit();this._scheduleHostReconnect();
  };
  peer.on('disconnected',lost);
  peer.on('close',lost);
  peer.on('open',()=>{
   if(this.quitting||this.peer!==peer)return;
   clearTimeout(this.hostReconnectTimer);this.hostReconnectTimer=null;this.hostReconnectAttempts=0;
   this.connected=true;this.netError='';this.connectionPhase='connected';this._emit();
  });
  peer.on('error',error=>{if(peer.destroyed||['network','server-error','socket-error','socket-closed'].includes(error?.type))lost();});
 }
 async _openHostPeer(room){
  const Peer=await this._preparePeer();const peer=new Peer(peerId(room),peerOptions());
  this.peer=peer;this.quitting=false;this.mode='host';this.room=room;
  // Listen BEFORE signaling 'open': quick guests must not vanish in the
  // microtask gap between registration and the connection listener.
  this._listenHostPeer(peer);
  this._health('signaling','');
  await new Promise((resolve,reject)=>{
   let done=false;const timer=setTimeout(()=>{if(!done){done=true;reject(Error('PeerJS konnte den Host-Raum nicht anmelden.'))}},16000);
   peer.on('open',()=>{if(!done){done=true;clearTimeout(timer);resolve()}});
   peer.on('error',error=>{if(!done){done=true;clearTimeout(timer);reject(Error(peerError(error,'host'))) }});
  }).catch(err=>{
   if(this.peer===peer)this.peer=null;
   this.connected=false;this.netError=err.message;this.connectionPhase='failed';
   try{peer.destroy()}catch{}this._emit();throw err;
  });
  this.connected=true;this.netError='';this.connectionPhase='connected';this.hostReconnectAttempts=0;this._emit();
 }
 /** Reopen only the transport; retain the whole authoritative quiz and its scores.
     Existing guests/projectors reconnect with their original identities. */
 async restartHostTransport(room){
  this._assertHost(room);
  if(this.restartingHost)return this.restartingHost;
  const work=(async()=>{
   this.connected=false;this.connectionPhase='reconnecting';
   this.netError='Host-Netzwerkverbindung wird neu eingerichtet …';this._emit();
   clearTimeout(this.hostReconnectTimer);this.hostReconnectTimer=null;
   const previous=this.peer;this.peer=null;
   for(const ctx of this.guestConnections.values())try{ctx.conn?.close()}catch{}
   for(const ctx of this.projectorConnections)try{ctx.conn?.close()}catch{}
   for(const ctx of this.unverifiedConnections){clearTimeout(ctx.helloTimer);try{ctx.conn?.close()}catch{}}
   this.guestConnections.clear();this.projectorConnections.clear();this.unverifiedConnections.clear();
   this.data.presence={};
   try{previous?.destroy()}catch{}
   // PeerJS Cloud needs a brief release window before the old host ID
   // can be re-registered by this same host browser.
   await new Promise(resolve=>setTimeout(resolve,700));
   let lastError;
   for(let attempt=0;attempt<3&&!this.quitting;attempt++){
    try{
     await this._openHostPeer(room);
     this.data.presence[this.uid]={connectedAt:Date.now()};
     this._changed();return true;
    }catch(error){
     lastError=error;this.connected=false;this.netError=error.message;
     this.connectionPhase='failed';this._emit();
     if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1200*(attempt+1)));
    }
   }
   if(!this.quitting)this._scheduleHostReconnect();
   throw lastError||Error('Hostverbindung wurde geschlossen.');
  })();
  this.restartingHost=work;
  try{return await work;}finally{if(this.restartingHost===work)this.restartingHost=null;}
 }
 _persist(){if(this.mode!=='host'||!this.data)return;
  // Only the host browser receives this backup. Complete quiz media remain in bq-quiz-<room>.
  const room=this.room,savedAt=this.savedAt=Math.max(Date.now(),(this.savedAt||0)+1);
  const checkpoint={uid:this.uid,data:clone(this.data),secrets:clone(this.memberSecrets),savedAt};
  let localSaved=false;
  try{localStorage.setItem('bq-p2p-session-'+room,JSON.stringify(checkpoint));localSaved=true;this.lastBackupAt=savedAt;}catch{}
  this.checkpointWrites=(this.checkpointWrites||Promise.resolve()).then(async()=>{
   const backedUp=await saveHostCheckpoint('session-'+room,checkpoint).catch(()=>false);
   if(this.room!==room||this.mode!=='host')return backedUp;
   if(backedUp)this.lastBackupAt=Math.max(savedAt,this.lastBackupAt||0);
   const previousError=this.backupError||'';
   this.backupError=localSaved||backedUp?'':'Spielstand konnte nicht gesichert werden. Speicherplatz im Browser prüfen.';
   if(!localSaved||previousError!==this.backupError)this._emit('.info/diagnostics');
   return backedUp;
  });
  return localSaved?Promise.resolve(true):this.checkpointWrites;
 }
 _changed(){if(this.mode==='host'&&this.data?.public?.jokerConfig?.enabled){
  const p=this.data.public;
  for(const team of Object.keys(p.teams||{}))if(!p.jokers?.[team]){
   p.jokers??={};p.jokers[team]=initialJokers({[team]:p.teams[team]},p.jokerConfig)[team];
  }
 }const saved=this._persist();this._emit();if(!this.snapshotTimer)this.snapshotTimer=setTimeout(()=>{this.snapshotTimer=null;for(const ctx of this.guestConnections.values())this._sendSnapshot(ctx)},25);return saved;}
 async create(room,quiz,options={}){if(this.mode!=='idle')this.shutdown();if(!/^[A-HJ-NP-Z2-9]{16}$/.test(room))throw Error('Ungültiger Raumcode.');
  this.uid='h_'+randomHex(12);this.hostQuiz=clone(quiz);this.data=roomData(this.uid,quiz,options);this.memberSecrets={};
  await this._openHostPeer(room);this._persist();return room;
 }
 async _hostCheckpoint(room){let previous=null;
  try{previous=JSON.parse(localStorage.getItem('bq-p2p-session-'+room)||'null')}catch{}
  const valid=value=>!!value?.data&&safeUid(value.uid)&&value.data.owner===value.uid;
  const checkpoint=await loadHostCheckpoint('session-'+room).catch(()=>null);
  if(valid(checkpoint)&&(!valid(previous)||Number(checkpoint.savedAt)>Number(previous.savedAt||0)))return checkpoint;
  return valid(previous)?previous:null;
 }
 async hasHostSession(room){return !!await this._hostCheckpoint(room);}
 async resumeHost(room){if(this.mode!=='idle')this.shutdown();
  const previous=await this._hostCheckpoint(room);
  if(!previous)throw Error('Kein Host-Spielstand in diesem Browser vorhanden.');
  this.uid=previous.uid;this.data=previous.data;this.memberSecrets=previous.secrets||{};
  this.savedAt=Number(previous.savedAt)||0;
  this.hostQuiz=await loadBestHostQuiz(room);
  const active=this.data.public;
  if(active.current?.type==='map'&&active.current.roundMode!=='written'&&['question','paused'].includes(active.phase)){
   active.current.roundMode='written';
   active.answerParticipants=writtenParticipants(this.data);
  }
  this.data.presence={};await this._openHostPeer(room);this._scheduleTeamEmojiDeadline();this._persist();return room;
 }
 async saveHostQuiz(room,quiz){this._assertHost(room);if(!quiz||!Array.isArray(quiz.questions)||quiz.questions.length>180)throw Error('Ungültiges Host-Quiz.');
  this.hostQuiz=clone(quiz);
  if(!this.data.public?.started&&Number(this.data.public?.round||0)===0){
   const cfg=normalizeJokerConfig(quiz.jokerConfig);
   this.data.jokerDrops=placeJokerDrops(quiz);
   this.data.public.jokerConfig=cfg;
   this.data.public.jokers=initialJokers(this.data.public.teams,cfg);
  }
  const savedAt=this.quizSavedAt=Math.max(Date.now(),(this.quizSavedAt||0)+1);
  const localSaved=saveLocalHostQuiz(room,quiz,savedAt);
  const extraSaved=await saveHostCheckpoint('quiz-'+room,{quiz:this.hostQuiz,savedAt}).catch(()=>false);
  if(!localSaved&&!extraSaved)throw Error('Host-Quiz konnte nicht gespeichert werden. Bitte als Datei exportieren.');
 }
 async getHostQuiz(room){this._assertHost(room);if(this.hostQuiz)return clone(this.hostQuiz);
  return loadBestHostQuiz(room);}
 _assertHost(room){if(this.mode!=='host'||this.room!==room||!this.data)throw Error('Nur der Host darf diese Aktion ausführen.');}
 _ensureGuest(room){if(this.mode!=='guest'||this.room!==room||!this.conn?.open||!this.connected)throw Error('Verbindung zum Host unterbrochen.');}
 async connect(room,name='',restoreCode=''){if(!/^[A-HJ-NP-Z2-9]{16}$/.test(room))throw Error('Ungültiger Raumcode.');if(restoreCode&&!isGuestResumeCode(restoreCode))throw Error('Ungültiger Wiedereinstiegslink.');if(this.mode!=='idle')this.shutdown();this.mode='guest';this.room=room;
  this.quitting=false;this.guestReconnectAttempts=0;
  const ident=guestIdentity(room,restoreCode);this.uid=ident.uid;this.secret=ident.secret;this.guestName=safeText(name,28)||this.guestName||'Spieler';
  this.restoringGuest=!!restoreCode;this.rememberedGuest='';
  let last;
  for(let attempt=0;attempt<2;attempt++){
   if(attempt){this._health('retrying',last?.message||'Wiederholter Verbindungsversuch …');
    await new Promise(resolve=>setTimeout(resolve,900));}
   try{await this._connectGuestOnce();return this.guestData.members?.[this.uid]||null;}
   catch(error){
    last=error;
    if(this.quitting||!['rtc','timeout','network'].includes(error?.connectionKind)||attempt===1)break;
   }
  }
  throw last;
 }
 async _connectGuestOnce(){
  if(this.connectAttempt)return this.connectAttempt;
  const attempt=this._connectGuestAttempt();
  this.connectAttempt=attempt;
  try{return await attempt;}finally{if(this.connectAttempt===attempt)this.connectAttempt=null;}
 }
 async _connectGuestAttempt(){
  this.cachedQuizAudio=null;
  this.iceState='new';this.iceErrorCode=0;this._health('signaling','');
  const Peer=await this._preparePeer();this.quitting=false;
  const peer=new Peer(undefined,peerOptions());this.peer=peer;
  await new Promise((resolve,reject)=>{
   let done=false,accepted=false,conn=null,partial=null;
   const timer=setTimeout(()=>finish(networkFailure(
    connectionAdvice({iceState:this.iceState,relay:hasTurnRelay(),phase:'timeout'})+
    ' Host-Verbindungsaufbau hat zu lange gedauert.', 'timeout')),CONNECT_TIMEOUT_MS);
   const finish=error=>{
    if(done)return;
    done=true;clearTimeout(timer);
    if(error){
     this.netError=String(error.message||error);this.connectionPhase='failed';
     this._emit('.info/diagnostics');
     try{conn?.close()}catch{}try{peer.destroy()}catch{}
     reject(error);
    }else resolve();
   };
   peer.on('open',()=>{if(this.peer!==peer||this.quitting||conn)return;conn=peer.connect(peerId(this.room),{reliable:true,serialization:'json'});this.conn=conn;
    this._health('ice');this._watchIce(conn);
    conn.on('open',()=>{
     if(this.peer!==peer||this.conn!==conn||this.quitting)return;
      try{this._health('handshake');conn.send({t:'hello',uid:this.uid,secret:this.secret,name:this.guestName,room:this.room,restore:this.restoringGuest});}
     catch{finish(networkFailure('Verbindung zum Host konnte nicht bestätigt werden.','rtc'));}
    });
    conn.on('data',input=>{
     if(this.peer!==peer||this.conn!==conn||this.quitting)return;
     const decoded=nextWirePart(partial,input);partial=decoded.partial;const msg=decoded.message;
     if(!msg)return;
     if(msg?.t==='welcome'){
      if(accepted)return;
      if(!this._applySnapshot(msg.state)){finish(networkFailure('Spielstand konnte nicht vollständig empfangen werden.','rtc'));return;}
      accepted=true;this.connected=true;this.netError='';this.connectionPhase='connected';this.guestReconnectAttempts=0;
       this.clockSamples=[];this.refreshClock();
       if(this.restoringGuest){
        try{sessionStorage.setItem('bq-p2p-guest-'+this.room,JSON.stringify({uid:this.uid,secret:this.secret}));}catch{}
        this.restoringGuest=false;
       }
      this._ackSnapshot(msg.version);finish();this._emit();
      for(const pending of this.pending.values())this._sendRequest(pending);
     }
     else if(msg?.t==='denied')finish(networkFailure(msg.reason||'Beitritt abgelehnt.','denied'));
     else if(accepted)this._receiveFromHost(msg);
    });
    conn.on('close',()=>{if(!done)finish(networkFailure(this.iceState==='failed'?
     connectionAdvice({iceState:this.iceState,relay:hasTurnRelay()}):'Hostverbindung vor der Anmeldung abgebrochen.','rtc'));
     else if(accepted&&this.peer===peer&&this.conn===conn)this._guestLost()});
    conn.on('error',err=>{if(!done)finish(networkFailure(this.iceState==='failed'?
     connectionAdvice({iceState:this.iceState,relay:hasTurnRelay()}):peerError(err?.type?err:{type:'webrtc'}),'rtc'));
     else if(accepted&&this.peer===peer&&this.conn===conn)this._guestLost()});
   });
   peer.on('error',err=>{if(!done)finish(networkFailure(peerError(err,'guest'),
    err?.type==='peer-unavailable'?'offline':['network','server-error','socket-error','socket-closed'].includes(err?.type)?'network':'rtc'));
    else if(accepted&&this.peer===peer&&!conn?.open)this._guestLost();});
   peer.on('disconnected',()=>{if(!this.quitting&&this.peer===peer)try{peer.reconnect()}catch{}});
  });
 }
 _guestLost(){
  if(this.quitting||this.mode!=='guest'||this.reconnectTimer)return;
  clearTimeout(this.clockTimer);this.clockProbe=null;
  this.connected=false;this.netError=this.iceState==='failed'
   ?connectionAdvice({iceState:this.iceState,relay:hasTurnRelay()})
   :'Hostverbindung unterbrochen. Wiederverbindung läuft …';
  this.connectionPhase='reconnecting';this._emit();
  const delay=Math.min(10000,1500+1500*this.guestReconnectAttempts++);
  this.reconnectTimer=setTimeout(()=>{
   this.reconnectTimer=null;
   void this.retryGuestNow().catch(()=>{});
  },delay);
 }
 async retryGuestNow(){
  if(this.mode!=='guest'||this.quitting)throw Error('Kein Gast-Raum aktiv.');
  if(this.connected)return true;
  if(this.connectAttempt)return this.connectAttempt;
  if(this.retryPromise)return this.retryPromise;
  clearTimeout(this.reconnectTimer);this.reconnectTimer=null;
  const work=(async()=>{
   const old=this.peer;
   this.peer=null;this.conn=null;
   try{old?.destroy()}catch{}
   try{await this._connectGuestOnce();return true;}
   catch(error){this.netError=error.message;this.connectionPhase='failed';this._guestLost();throw error;}
  })();
  this.retryPromise=work;
  try{return await work;}finally{if(this.retryPromise===work)this.retryPromise=null;}
 }
 _applySnapshot(payload){if(!payload||typeof payload!=='object')return;
  // Hydrate previously delivered audio before publishing this new room state.
  const q=payload.public?.current;
  if(q?.type==='audio'&&q._wireAudioKey){
   if(typeof q.audio==='string'&&q.audio.startsWith('data:audio/')){
    this.cachedQuizAudio={key:q._wireAudioKey,data:q.audio};
   }else if(this.cachedQuizAudio?.key===q._wireAudioKey){
    q.audio=this.cachedQuizAudio.data;
   }else{
    console.warn('[BrainQuiz] Audioclip nicht im lokalen Cache. Spielstand verwerfen und erneut verbinden.');
    return;
   }
   delete q._wireAudioKey;
  }else if(q?.type!=='audio')this.cachedQuizAudio=null;
  const hostTime=payload.hostTime??payload.emojiClock;
  if(!this.clockSample&&Number.isFinite(hostTime))this.clockSample={hostTime,received:performance.now()};
   if(payload.member?.status==='approved'&&this.rememberedGuest!==this.uid){
    this.rememberedGuest=this.uid;rememberGuestResume(this.room,this.uid+'.'+this.secret,payload.member.name);
   }
   this.guestData={
  public:payload.public||null,lobby:payload.lobby||null,roster:payload.roster||{},presence:payload.presence||{},buzzers:payload.buzzers||{},
  members:payload.member?{[this.uid]:payload.member}:{},responses:payload.ownResponse?{[String(payload.public?.round||0)]:{[this.uid]:payload.ownResponse}}:{},
  messages:payload.messages||{},teamEmoji:payload.teamEmoji||null,jokerPrivateHint:typeof payload.jokerPrivateHint==='string'?payload.jokerPrivateHint:''
  };return true;}
 _ackSnapshot(version){
  if(!Number.isSafeInteger(version)||version<1)return;
  try{this.conn.send({t:'snapshot-ack',version});}catch{}
 }
 _receiveFromHost(msg){if(!msg||typeof msg!=='object')return;
  if(msg.t==='clock-pong'){this._readClockSample(msg);return;}
  if(msg.t==='snapshot'){
   if(this._applySnapshot(msg.state)){this._ackSnapshot(msg.version);this._emit();}
   else this._guestLost();
  }
  if(msg.t==='ack'){
   const p=this.pending.get(msg.id);if(!p)return;
   this.pending.delete(msg.id);this.uncertainActions.delete(p.key);clearTimeout(p.timer);
   msg.ok?p.resolve(msg.result):p.reject(Error(msg.error||'Aktion nicht erlaubt.'));
  }
  if(msg.t==='shutdown'){
   clearTimeout(this.clockTimer);
   this.netError='Der Host hat den Raum geschlossen.';this.quitting=true;this.connected=false;
   for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(this.netError));}
   this.pending.clear();this._emit();
  }
 }
 _snapshotFor(ctx){const member=this.data.members?.[ctx.uid]||null,approved=member?.status==='approved',publicState=approved?this.data.public:null;
  const round=String(this.data.public?.round||0),ownResponse=approved?this.data.responses?.[round]?.[ctx.uid]||null:null;
  const msgs=approved&&member.team?{[member.team]:this.data.messages?.[member.team]||{}}:{};
  const privateEmoji=approved?teamEmojiForPlayer(this.data.teamEmoji,member.team,ctx.uid):null;
  const emojiClock=publicState?.teamEmoji&&publicState.deadline?Date.now():null;
   const display=clone(publicState);
   const jokerPrivateHint=approved?this.data.jokerPrivateHints?.[round]?.[member?.team]||'':'';
   const waiting=waitsForNextQuestion(publicState,member);
   if(waiting){
    display.current=null;display.answerParticipants=null;display.answerReview=null;display.teamEmoji=null;
    display.preRevealDisplay=null;display.buzzerAnnouncement=null;display.audioPlayback=null;
   }else if(buzzerCoverActive(publicState,this.data.buzzers)){
    const {id,category,type,points,roundMode,basePoints,doublePoints}=publicState.current;
    display.current={id,category,type,points,roundMode,basePoints,doublePoints};
    display.audioPlayback=null;
   }
   return {member:clone(member),lobby:lobbySnapshot(this.data),jokerPrivateHint,public:display,roster:approved?clone(this.data.roster):{},presence:approved?clone(this.data.presence):{},buzzers:approved&&!waiting?clone(this.data.buzzers):{},ownResponse:clone(ownResponse),messages:clone(msgs),teamEmoji:waiting?null:clone(privateEmoji),emojiClock,hostTime:Date.now()};
 }
 async _sendHostMessage(ctx,message){
  if(!ctx.conn?.open)return;
  // Every receiver gets ordered packets, including its welcome handshake.
  const previous=ctx.wireChain||Promise.resolve();
  const sent=previous.then(async()=>{
   if(!ctx.conn?.open)return;
   const q=message?.state?.public?.current;
   let audioKey=null;
   if(q?.type==='audio'&&typeof q.audio==='string'&&q.audio.length>WIRE_PART_CHARS){
    audioKey=message.state.public.round+':'+q.id+':'+q.audio.length;
    q._wireAudioKey=audioKey;
    if(ctx.sentQuizAudioKey===audioKey)q.audio='';
   }
   const packets=wireMessages(message,++ctx.wireSequence);
   for(let i=0;i<packets.length;i++){
    if(!ctx.conn?.open)throw Error('Datenkanal während Übertragung geschlossen.');
    let attempts=0;
    while(ctx.conn.dataChannel?.bufferedAmount>160000&&attempts++<160){
     if(!ctx.conn.open)throw Error('Datenkanal geschlossen.');
     await new Promise(resolve=>setTimeout(resolve,10));
    }
    ctx.conn.send(packets[i]);
    if(i%8===7)await wireTick();
   }
   if(audioKey)ctx.sentQuizAudioKey=audioKey;
   ctx.lastSentAt=Date.now();
  });
  ctx.wireChain=sent.catch(error=>{
   console.warn('[BrainQuiz] Live-Spielstand nicht vollständig übertragen:',error);
   if(ctx.conn?.open)try{ctx.conn.close()}catch{}
  });
  return sent;
 }
 _sendSnapshot(ctx){
  if(!ctx?.ready||!ctx.conn?.open)return;
  ctx.wantSnapshot=true;
  if(ctx.sendingSnapshot)return;
  ctx.sendingSnapshot=true;
  void (async()=>{
   try{
    while(ctx.wantSnapshot&&ctx.conn?.open&&ctx.ready){
     ctx.wantSnapshot=false;
     await this._sendHostMessage(ctx,this._snapshotMessage(ctx,'snapshot'));
    }
   }catch(error){console.warn('[BrainQuiz] Snapshot nicht übertragbar:',error);}
   finally{ctx.sendingSnapshot=false;}
  })();
 }
 _snapshotMessage(ctx,type){
  ctx.snapshotVersion=(ctx.snapshotVersion||0)+1;
  return {t:type,version:ctx.snapshotVersion,state:this._snapshotFor(ctx)};
 }
 hasProjector(room){return this.mode==='host'&&this.room===room&&PROJECTOR_TOKEN_RE.test(this.data?.projectorToken||'');}
 enableProjector(room){
  const data=this._getHostData(room);
  if(!this.hasProjector(room)){data.projectorToken=randomHex(16);this._persist();}
  return data.projectorToken;
 }
 publishProjector(room,frame){
  if(!this.hasProjector(room)||this.projectorFrame?.html===frame.html&&this.projectorFrame?.deadline===frame.deadline&&this.projectorFrame?.pausedRemaining===frame.pausedRemaining)return;
  this.projectorFrame=frame;
  for(const ctx of this.projectorConnections)this._sendDisplay(ctx);
 }
 _sendDisplay(ctx){
  if(ctx.sendingDisplay||!ctx.conn.open||!this.projectorFrame)return;
  ctx.sendingDisplay=true;
  void (async()=>{
   try{
    while(ctx.conn.open&&this.projectorFrame&&ctx.sentDisplay!==this.projectorFrame){
     const frame=this.projectorFrame;
     await this._sendHostMessage(ctx,{...frame,hostTime:Date.now()});
     ctx.sentDisplay=frame;
    }
   }catch{}finally{ctx.sendingDisplay=false;}
  })();
 }
 _acceptDisplay(ctx,msg){
  const valid=msg.room===this.room&&this.hasProjector(this.room)&&msg.token===this.data.projectorToken;
  if(!valid||this.projectorConnections.size>=4){
   try{ctx.conn.send({t:'denied',reason:valid?'Alle Beamer-Verbindungen sind belegt.':'Dieser Beamer-Link ist ungültig.'});}catch{}
   ctx.display=true;setTimeout(()=>ctx.conn.close(),200);
   return;
  }
  ctx.display=true;clearTimeout(ctx.helloTimer);this.unverifiedConnections.delete(ctx);
  this.projectorConnections.add(ctx);
  try{ctx.conn.send({t:'display-ready'});}catch{}
  this._sendDisplay(ctx);
 }
 _disconnectGuest(ctx){if(this.quitting||!ctx.ready||!this.data||this.mode!=='host')return;const current=this.guestConnections.get(ctx.uid);if(current!==ctx)return;this.guestConnections.delete(ctx.uid);delete this.data.presence[ctx.uid];this._changed()}
 _receiveFromGuest(ctx,msg){if(!msg||typeof msg!=='object'||Array.isArray(msg))return;ctx.lastSeenAt=Date.now();
  const deny=reason=>{
   clearTimeout(ctx.helloTimer);this.unverifiedConnections.delete(ctx);
   try{ctx.conn.send({t:'denied',reason});}catch{}
   // Give the denial frame time to leave the channel before closing it.
   setTimeout(()=>{try{ctx.conn.close()}catch{}},180);
  };
  try{if(JSON.stringify(msg).length>MAX_MESSAGE_BYTES){ctx.conn.close();return}}catch{return}
  if(ctx.display)return;
  if(!ctx.ready&&msg.t==='display-hello'){this._acceptDisplay(ctx,msg);return;}
  if(!ctx.ready){
   if(msg.t!=='hello'||msg.room!==this.room||!safeUid(msg.uid)||!TOKEN_RE.test(msg.secret||'')){deny('Ungültiger Beitritt.');return}
   const prev=this.memberSecrets[msg.uid],member=this.data.members[msg.uid];
    if(msg.restore===true&&(!prev||member?.status!=='approved')){deny('Für diesen Wiedereinstieg gibt es keine aktive Freigabe.');return;}
   if(prev&&prev!==msg.secret){deny('Spieleridentität stimmt nicht überein.');return}
   if(!prev){if(Object.keys(this.data.members).filter(id=>this.data.members[id]?.status==='pending').length>=MAX_WAITING){deny('Warteraum ist voll.');return}
    this.memberSecrets[msg.uid]=msg.secret;
    this.data.members[msg.uid]={name:safeText(msg.name,28)||'Spieler',status:'pending',team:'',joinedAt:Date.now()};
   }else if(member?.status==='removed'){deny('Du wurdest aus dem Raum entfernt.');return}
   ctx.uid=msg.uid;ctx.ready=true;clearTimeout(ctx.helloTimer);this.unverifiedConnections.delete(ctx);
   const old=this.guestConnections.get(ctx.uid);if(old&&old!==ctx){try{old.conn.close()}catch{}}
   this.guestConnections.set(ctx.uid,ctx);this.data.presence[ctx.uid]={connectedAt:Date.now()};
   void this._sendHostMessage(ctx,this._snapshotMessage(ctx,'welcome')).catch(()=>{});
   this._changed();return;
  }
  if(this.guestConnections.get(ctx.uid)!==ctx||!this.data)return;
   if(msg.t==='clock-ping'){
    const received=Date.now();
    if(Number.isSafeInteger(msg.seq)&&msg.seq>0&&received-(ctx.lastClockPing||0)>=100){
     ctx.lastClockPing=received;
     try{ctx.conn.send({t:'clock-pong',seq:msg.seq,received,sent:Date.now()});}catch{}
    }
    return;
   }
  if(msg.t==='snapshot-ack'&&Number.isSafeInteger(msg.version)&&msg.version>(ctx.ackVersion||0)&&msg.version<=ctx.snapshotVersion){
   ctx.ackVersion=msg.version;ctx.lastAckAt=Date.now();this._emit('.info/diagnostics');return;
  }
  if(ctx.ready&&msg.t==='action'&&typeof msg.id==='string'&&msg.id.length<=90){
   if(!/^r[0-9]{1,12}_[a-f0-9]{8}$/.test(msg.id)){
    try{ctx.conn.send({t:'ack',id:msg.id,ok:false,error:'Ungültige Anfrage-ID.'})}catch{}return;
   }
   const cache=this.data.actionAcks??=(Object.create(null)),key=ctx.uid+':'+msg.id;
   // Reconnect/replay must never perform the same authoritative action twice.
   if(Object.hasOwn(cache,key)){try{ctx.conn.send(cache[key])}catch{}return;}
   if(Date.now()-(ctx.actionWindow||0)>2000){ctx.actionWindow=Date.now();ctx.actionCount=0;}
   if(++ctx.actionCount>24){
    try{ctx.conn.send({t:'ack',id:msg.id,ok:false,error:'Bitte kurz warten und erneut versuchen.'});}catch{}
    return;
   }
   let ok=true,result=null,error='';
   try{result=this._handleGuestAction(ctx,msg.action,msg.payload||{})}
   catch(e){ok=false;error=String(e?.message||'Aktion nicht erlaubt.').slice(0,200)}
   const ack={t:'ack',id:msg.id,ok,result,error};cache[key]=ack;
   // Compact private replay receipts to prevent unbounded growth during long events.
   const keys=Object.keys(cache);if(keys.length>1500)for(const old of keys.slice(0,keys.length-1250))delete cache[old];
   // Store the mutation and its replay receipt in one checkpoint.
   void this._changed().then(()=>{try{ctx.conn.send(ack);}catch{}});
  }
 }
 _handleGuestAction(ctx,action,payload){
  const member=this.data.members?.[ctx.uid],pub=this.data.public,round=String(pub?.round||0),now=Date.now();
  // Lobby requests are deliberately available BEFORE approval. They never grant
  // access to the quiz, to another player's private team chat, or to host actions.
  if(['lobby-join','lobby-create','lobby-ready'].includes(action)){
   if(!member||!['pending','approved'].includes(member.status))throw Error('Diese Person darf die Lobby nicht verändern.');
   const lateTeamChoice=member.status==='pending'&&action==='lobby-join'&&canAdmitPlayer(pub);
   if(!canArrangeLobby(pub)&&!lateTeamChoice)throw Error('Die Teamaufstellung ist nach Spielbeginn gesperrt.');
   if(now-(ctx.lastLobbyChange||0)<160&&!(action==='lobby-ready'&&['lobby-join','lobby-create'].includes(ctx.lastLobbyAction)))throw Error('Bitte vor der nächsten Änderung kurz warten.');
   if(action==='lobby-join'){
    const id=payload.team;
    if(!validTeamId(id)||!Object.hasOwn(pub.teams||{},id))throw Error('Dieses Team existiert nicht.');
    if(member.status==='approved'){
     if(this.data.roster?.[ctx.uid]?.team!==member.team)throw Error('Teamzuordnung nicht bestätigt.');
     this.data.roster[ctx.uid].team=id;member.team=id;
    }else member.teamRequest={kind:'join',id};
    member.ready=false;
   }else if(action==='lobby-create'){
    if(member.createdTeam)throw Error('Du hast bereits ein eigenes Team erstellt.');
    const name=cleanTeamName(payload.name);
    const addition=addLobbyTeam(pub.teams,name);
    if(member.status==='approved'){
     if(this.data.roster?.[ctx.uid]?.team!==member.team)throw Error('Teamzuordnung nicht bestätigt.');
     pub.teams=addition.teams;pub.scores[addition.id]=0;this.data.roster[ctx.uid].team=addition.id;
     member.team=addition.id;member.createdTeam=true;
    }else member.teamRequest={kind:'create',name};
    member.ready=false;
   }else{
    if(typeof payload.ready!=='boolean')throw Error('Ungültiger Bereitschaftsstatus.');
    if(member.status==='approved'&&!this.data.roster?.[ctx.uid]?.team)throw Error('Bitte zuerst ein Team wählen.');
    if(member.status==='pending'&&!member.teamRequest)throw Error('Bitte zuerst ein Team wählen.');
    member.ready=payload.ready;
   }
   ctx.lastLobbyChange=now;ctx.lastLobbyAction=action;
   return true;
  }
  if(member?.status!=='approved'||this.data.roster?.[ctx.uid]?.team!==member.team)throw Error('Hostfreigabe erforderlich.');
   if(waitsForNextQuestion(pub,member)&&['buzz','answer',TEAM_EMOJI].includes(action))
    throw Error('Deine Teilnahme beginnt mit der nächsten Frage.');
  switch(action){
   case TEAM_EMOJI:{
    const emoji=this.data.teamEmoji;
    if(!emoji||emoji.id!==payload.id||pub.phase!=='question')throw Error('Diese Teamrunde ist nicht mehr offen.');
    playTeamEmoji(emoji,member.team,ctx.uid,payload.kind,payload.value,now);
    this._syncTeamEmoji();
    return true;
   }
   case 'joker':return this._handleGuestJoker(ctx,member,payload,now);
   case 'pick':throw Error('Nur der Host darf Fragen auswählen.');
   case 'buzz':{
    if(round!==String(payload.round))throw Error('Die Buzzer-Runde ist nicht mehr offen.');
    if(this.data.buzzers[round])return false;
    if(!canBuzz(pub,this.data.buzzers,ctx.uid,member.team,now))throw Error('Buzzer ist noch nicht freigegeben oder du bist für diese Runde gesperrt.');
    const accepted={uid:ctx.uid,team:member.team,name:member.name,at:now};
    this.data.buzzers[round]=accepted;
    pub.buzzerAnnouncement={...accepted,round:pub.round};
    return true;
   }
   case 'answer':{
    if(pub?.phase!=='question'||String(payload.round)!==round||(pub.deadline&&now>=pub.deadline))throw Error('Frage ist nicht offen.');
    const map=pub.current?.type==='map';
    if(roundMode(pub.current)!=='written')throw Error('Diese Frage wird mündlich beantwortet.');
    if(!pub.answerParticipants?.[ctx.uid])throw Error('Du bist für diese Runde noch nicht freigegeben.');
    const text=safeText(payload.text,800);
    if(!text)throw Error('Antwort darf nicht leer sein.');
    if(map&&!decodePoint(text))throw Error('Kartenpunkt liegt außerhalb der Weltkarte.');
    if(pub.current.type==='order'&&(!orderReady(pub.current)||!orderResponseIndices(text,pub.current.displayItems.length)))throw Error('Ordne alle Einträge genau einmal an.');
    this.data.responses[round]??={};
    const original=this.data.responses[round][ctx.uid];
    this.data.responses[round][ctx.uid]={uid:ctx.uid,team:member.team,text,at:original?.at||now,updatedAt:now};
    return true;
   }
   case 'message':{if(isTeamChallenge(pub?.current?.type)&&pub.phase==='question')throw Error('Während der Teamrunde ist der Teamchat geschlossen.');if(!pub?.settings?.chatOpen||(pub.settings.lockOnBuzz&&pub.phase==='question'&&this.data.buzzers[round]))throw Error('Teamchat geschlossen.');const text=safeText(payload.text,500);if(!text||now-ctx.lastChat<1000)throw Error('Nachrichtenrate begrenzt.');ctx.lastChat=now;this.data.messages[member.team]??={};const messages=this.data.messages[member.team];messages['m_'+randomHex(9)]={uid:ctx.uid,name:member.name,text,at:now};const keys=Object.keys(messages);for(const key of keys.slice(0,-80))delete messages[key];return true}
   default:throw Error('Aktion nicht erlaubt.');
  }
 }
 _handleGuestJoker(ctx,member,payload,at){
  const d=this.data,p=d.public,team=member.team,type=payload?.type,round=Number(payload?.round);
  if(p.scoreMode!=='team'||p.jokerConfig?.enabled!==true||round!==p.round||
     !Object.hasOwn(p.teams||{},team))throw Error('Joker sind in dieser Runde nicht verfügbar.');
  if(type==='chrono-answer'){
   if(!activeChronobreak(p,at)||p.chronoBreak.uid!==ctx.uid)throw Error('Chronobreak ist nicht mehr aktiv.');
   const value=safeText(payload.text,160);
   if(!value)throw Error('Bitte eine korrigierte Antwort eingeben.');
   d.chronoCorrections??={};d.chronoCorrections[String(round)]=value;
   return true;
  }
  if(!JOKER_TYPES.includes(type)||jokerCount(p,team,type)<=0)throw Error('Für diesen Joker ist keine Aufladung verfügbar.');
  if(type==='reroll'){
   if(p.phase!=='ready'||!p.current?.id||selectingTeam(p)!==team||p.jokerRerollRequest||
      !Object.values(p.board||{}).some(cell=>cell.id!==p.current.id&&cell.boardRound===p.boardRound&&!cell.used&&!p.used?.[cell.id]))
    throw Error('Reroll nur vor dem Aufdecken für das auswählende Team verfügbar.');
   p.jokerRerollRequest={round,id:p.current.id,team,uid:ctx.uid,name:member.name};
   return true;
  }
  if(type==='shield'){
   if(p.phase!=='question'||!p.current?.id||p.jokerShields?.[team]===round||
      p.buzzerBlockedTeams?.[String(round)]?.[team]||p.writtenTeamRepresentatives?.[String(round)]?.[team])
    throw Error('Schutz kann für diese Frage nicht mehr aktiviert werden.');
   // Arming is free; consume the charge only if the team actually loses points.
   p.jokerShields={...(p.jokerShields||{}),[team]:round};
  }else if(type==='oracle'){
   if(p.phase!=='question'||!p.current?.id)throw Error('Der Hinweis ist nur während einer offenen Frage verfügbar.');
   if(d.jokerPrivateHints?.[String(round)]?.[team])throw Error('Das Team hat den Orakel-Hinweis schon erhalten.');
   const source=this.hostQuiz?.questions.find(q=>q.id===p.current.id);
   const hint=String(source?.oracleHint||source?.hints?.find(h=>String(h||'').trim())||'').trim().slice(0,220);
   if(!hint)throw Error('Der Host hat für diese Frage noch keinen Orakel-Hinweis hinterlegt.');
   p.jokers=changeJokerCharge(p,team,type,-1).jokers;
   d.jokerPrivateHints??={};d.jokerPrivateHints[String(round)]??={};d.jokerPrivateHints[String(round)][team]=hint;
  }else if(type==='chrono'){
   const buzz=d.buzzers?.[String(round)];
   if(p.phase!=='question'||roundMode(p.current)!=='buzzer'||!buzz||buzz.uid!==ctx.uid||
      p.current?.firstAnswerPending||p.buzzerResolved?.[String(round)]||p.chronoBreak?.round===round)
    throw Error('Chronobreak ist nur für die Person möglich, die gerade gebuzzert hat.');
   p.jokers=changeJokerCharge(p,team,type,-1).jokers;
   p.chronoBreak={round,uid:ctx.uid,team,name:member.name,until:at+CHRONOBREAK_MS};
   if(p.deadline)p.deadline+=CHRONOBREAK_MS;
  }
  p.jokerNotice={round,team,type,at};
  return true;
 }
 async guestJoker(room,type,extra={}){this._ensureGuest(room);return this._rpc('joker',{type,round:Number(this.guestData?.public?.round||0),...extra});}
 async hostAdjustJoker(room,team,type,delta){
  const d=this._getHostData(room),p=d.public;
  if(!p.jokerConfig?.enabled)throw Error('Joker sind nicht aktiviert.');
  const next=changeJokerCharge(p,team,type,delta);
  if(!next)throw Error('Jokerstand muss zwischen 0 und 3 liegen.');
  d.public=next;this._changed();return next.jokers[team][type];
 }
 async hostResolveReroll(room,accept){
  const d=this._getHostData(room),p=d.public,request=p.jokerRerollRequest;
  if(p.phase!=='ready'||!request||request.id!==p.current?.id||request.round!==p.round)
   throw Error('Es gibt keine aktuelle Reroll-Anfrage.');
  if(accept!==true){p.jokerRerollRequest=null;this._changed();return false;}
  const charged=changeJokerCharge(p,request.team,'reroll',-1);
  if(!charged)throw Error('Reroll-Aufladung nicht verfügbar.');
  const next=cancelQuestionState(charged);
  if(!next)throw Error('Frage konnte nicht zurückgelegt werden.');
  d.public={...next,jokerEvent:null,jokerRerollRequest:null,jokerRerollExclude:request.id,jokerShields:{},chronoBreak:null};
  delete d.pendingQuestion;delete d.teamEmoji;delete d.questionHistory[String(request.round)];
  d.picks={};this._changed();return true;
 }
 hostChronoAnswer(room,round){const d=this._getHostData(room);return String(d.chronoCorrections?.[String(round)]||'');}
 _sendRequest(pending){try{this.conn.send(pending.packet);}catch{this._guestLost();}}
 _rpc(action,payload={}){
  const key=JSON.stringify([action,payload]);
  this._ensureGuest(this.room);
  const inFlight=action==='buzz'?null:[...this.pending.values()].find(request=>request.key===key);
  if(inFlight)return inFlight.promise;
  for(const [old,item] of this.uncertainActions)if(Date.now()-item.at>90000)this.uncertainActions.delete(old);
  const id=this.uncertainActions.get(key)?.id||'r'+(++this.requestNo)+'_'+randomHex(4);
  const retry=this.pending.get(id);
  if(retry)return retry.promise;
  const packet={t:'action',id,action,payload};
  let pending;
  const promise=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{
    this.pending.delete(id);
    if(this.uncertainActions.size>=20)this.uncertainActions.delete(this.uncertainActions.keys().next().value);
    this.uncertainActions.set(key,{id,at:Date.now()});
    reject(Error('Keine Bestätigung vom Host. Du kannst die Aktion erneut senden.'));
   },20000);
   pending={key,packet,timer,resolve,reject};
  });
  pending.promise=promise;
  this.pending.set(id,pending);this._sendRequest(pending);
  return promise;
 }
 _getHostData(room){this._assertHost(room);return this.data;}
 async join(room,name){this._ensureGuest(room);return clone(this.guestData.members?.[this.uid]||null)}
 /** A host may create a team directly, without becoming a player or bypassing the lobby lock. */
 async hostCreateLobbyTeam(room,name){
  const d=this._getHostData(room);
  if(!canArrangeLobby(d.public))throw Error('Teams können nur vor Spielbeginn erstellt werden.');
  const added=addLobbyTeam(d.public.teams,name);
  d.public.teams=added.teams;
  d.public.scores={...(d.public.scores||{}),[added.id]:0};
  this._changed();
  return {id:added.id,name:added.teams[added.id],color:added.color};
 }
 async hostRenameTeam(room,id,name){
  const d=this._getHostData(room);
  d.public.teams=renameLobbyTeam(d.public.teams,id,name);
  this._changed();
  return d.public.teams[id];
 }
 async hostAssign(room,uid,player,team){
  const d=this._getHostData(room),member=d.members?.[uid];
  if(!member||member.status==='removed')throw Error('Diese Beitrittsanfrage existiert nicht.');
  if(member.status==='pending'&&!canAdmitPlayer(d.public))throw Error('Das Quiz ist beendet.');
  const late=member.status==='pending'&&!canArrangeLobby(d.public);
  let destination=team,addition=null;
  if(member.status==='pending'&&!late&&member.teamRequest?.kind==='create'&&!team){
   addition=addLobbyTeam(d.public.teams,member.teamRequest.name);
   destination=addition.id;
  }else if(!destination&&member.teamRequest?.kind==='join')destination=member.teamRequest.id;
  if(!destination||!d.public.teams?.[destination]&&!addition)throw Error('Bitte ein vorhandenes Team auswählen.');
  const next=approval(d.roster,uid,member,destination);if(!next.accepted)throw Error(next.reason);
  if(addition){d.public.teams=addition.teams;d.public.scores[addition.id]=0;}
  d.roster=next.roster;
  if(late&&d.public.current&&d.public.phase!=='ready')member.playFromRound=d.public.round+1;
  d.members[uid]={...member,team:destination,status:'approved',teamRequest:null,createdTeam:member.createdTeam===true||!!addition,ready:member.ready===true};
  this._changed();
 }
 async hostRemove(room,uid,player){
  const d=this._getHostData(room);
  const emoji=d.teamEmoji;
  const team=emoji?.teams[d.roster[uid]?.team];
  if(emoji?.phase==='roles'&&team){team.players=team.players.filter(id=>id!==uid);delete team.roles[uid];this._syncTeamEmoji();}
  d.members[uid]={...player,status:'removed',team:'',teamRequest:null,ready:false};
  delete d.roster[uid];delete d.presence[uid];this._changed();
 }
 async enterPresence(room){if(this.mode==='host'){this._assertHost(room);this.data.presence[this.uid]={connectedAt:Date.now()};this._changed();}else this._ensureGuest(room)}
 async buzzer(room,round,team,name){if(this.mode==='guest')return this._rpc('buzz',{round});throw Error('Buzzer nur für Teilnehmer.')}
 async answer(room,round,team,text){if(this.mode==='guest')return this._rpc('answer',{round,text});throw Error('Antworten nur für Teilnehmer.')}
 async message(room,team,name,text){if(this.mode==='guest')return this._rpc('message',{text});const d=this._getHostData(room);if(!d.public?.teams?.[team])throw Error('Unbekanntes Team.');const id='m_'+randomHex(9);d.messages[team]??={};d.messages[team][id]={uid:this.uid,name:'HOST',text:safeText(text,500),at:Date.now()};const keys=Object.keys(d.messages[team]);for(const key of keys.slice(0,-80))delete d.messages[team][key];this._changed()}
 async setState(room,changes){const d=this._getHostData(room);if(changes.started===true&&!d.public.started){d.public.selectionTurn=makeSelectionTurn(d.public,d.roster);d.public.boardSequence=true;}for(const [path,value]of Object.entries(changes))setPath(d.public,path,value);this._changed()}
 async openQuestion(room,expectedRound,question,playerQuestion,participants,deadline,{covered=false}={}){
  const d=this._getHostData(room);
  const state=covered&&!d.public.selectionTurn?{...d.public,selectionTurn:makeSelectionTurn(d.public,d.roster),boardSequence:true}:d.public;
  const emoji=isTeamChallenge(question.type)?newTeamEmojiRound(question,d.public,d.roster,randomHex(12)):null;
  const expected=emoji?null:participants??(question.type==='map'?writtenParticipants(d,Number(expectedRound)+1):null);
  const next=openQuestionState(state,{expectedRound,question,playerQuestion:emoji?publicQuestion(question):playerQuestion,
   participants:expected,deadline:emoji?0:deadline,covered});
  if(!next)throw Error('Die Frage wurde nicht geöffnet: Das Quizbrett oder die Runde hat sich geändert.');
  d.public={...next,jokerEvent:null,jokerRerollRequest:null,jokerRerollExclude:null,chronoBreak:null,jokerShields:{}};
  if(emoji)emoji.points=next.current.points;
  if(covered){
   delete d.teamEmoji;delete next.teamEmoji;
   d.pendingQuestion={round:next.round,id:question.id,
     current:{...clone(playerQuestion),roundMode:next.current.roundMode,points:next.current.points,basePoints:next.current.basePoints,doublePoints:next.current.doublePoints,...(next.current.firstAnswerTeam?{firstAnswerTeam:next.current.firstAnswerTeam,firstAnswerPending:true}:{})},
     duration:deadline?(questionSeconds(question.seconds)*1000||Math.max(0,deadline-Date.now())):0};
  }
  else if(emoji){d.teamEmoji=emoji;this._syncTeamEmoji();}
  else{delete d.teamEmoji;delete next.teamEmoji;}
  this._scheduleTeamEmojiDeadline();
  this._changed();return clone(next);
 }
 questionPreview(room,round,id){
  const d=this._getHostData(room),pending=d.pendingQuestion;
  return d.public.phase==='ready'&&pending?.round===Number(round)&&pending.id===id?pending.current:null;
 }
 async releaseBuzzers(room,round,uid=''){
  const d=this._getHostData(room),p=d.public,key=String(round);
  if(key!==String(p.round)||!['question','paused'].includes(p.phase)||roundMode(p.current)!=='buzzer'||p.buzzerResolved?.[key])
   throw Error('Die Buzzerfrage ist nicht mehr aktiv.');
  if(p.current?.firstAnswerPending)throw Error('Erst das auswählende Team bewerten.');
  if(uid){
   if(!Object.hasOwn(d.roster,uid))throw Error('Person ist nicht im Spiel.');
   (p.buzzerReleased??={})[key]??={};
   p.buzzerReleased[key][uid]=true;
   if(p.buzzerBlocked?.[key])delete p.buzzerBlocked[key][uid];
  }else{
   if(p.buzzerBlocked)delete p.buzzerBlocked[key];
   if(p.buzzerBlockedTeams)delete p.buzzerBlockedTeams[key];
   if(p.buzzerReleased)delete p.buzzerReleased[key];
   p.buzzerArmed=true;
  }
  (p.settings??={}).buzzerEnabled=true;
  this._changed();
 }
 async uncoverQuestion(room,round,id,seconds){
  const d=this._getHostData(room),pending=d.pendingQuestion;
  if(d.public.phase!=='ready'||d.public.round!==Number(round)||d.public.current?.id!==id||pending?.round!==Number(round)||pending.id!==id)throw Error('Die ausgewählte Frage hat sich geändert.');
  if(d.public.jokerRerollRequest)throw Error('Zuerst die offene Reroll-Anfrage annehmen oder ablehnen.');
  const question=this.hostQuiz?.questions.find(item=>item.id===id);
  if(!question)throw Error('Die Originalfrage fehlt im Host-Quiz.');
  const emoji=isTeamChallenge(question.type)?newTeamEmojiRound(question,d.public,d.roster,randomHex(12)):null;
  if(emoji)emoji.points=d.public.current.points;
   const duration=seconds===undefined?pending.duration:questionSeconds(seconds)*1000;
   const mode=roundMode(question);
   d.public={...d.public,phase:'question',current:{...clone(pending.current),roundMode:mode},jokerShields:{},chronoBreak:null,
    answerParticipants:mode==='written'?writtenParticipants(d):null,
    deadline:!emoji&&duration?Date.now()+duration:0,buzzerArmed:!d.public.current?.firstAnswerPending&&!d.public.settings?.manualBuzzer};
  if(emoji){d.teamEmoji=emoji;this._syncTeamEmoji();}
  d.public=drawJokerForQuestion(d.public,id,d.jokerDrops);
  delete d.pendingQuestion;
  this._changed();return clone(d.public);
 }
 async cancelQuestion(room,round,id){
  const d=this._getHostData(room),p=d.public,key=String(round);
  if(p.round!==Number(round)||p.current?.id!==id)throw Error('Diese Frage ist nicht mehr aktiv.');
  if(d.buzzers[key])throw Error('Zuerst den offenen Buzzer bewerten oder zurücksetzen.');
  if(p.buzzerJudgements?.[key]||p.buzzerResolved?.[key]||
     Object.keys(d.responses?.[key]||{}).length||
     (d.scoreEvents||[]).some(event=>event.round===key))
   throw Error('Bereits Antworten oder Punktwertungen vorhanden. Frage nicht ohne Wertungsverlust zurücklegen. Als gespielt beenden.');
  const next=cancelQuestionState(p);
  if(!next)throw Error('Diese Frage kann in der aktuellen Phase nicht zurückgelegt werden.');
  d.public={...next,jokerEvent:null,jokerRerollRequest:null,chronoBreak:null,jokerShields:{}};delete d.questionHistory[key];delete d.responses[key];delete d.buzzers[key];
  d.picks={};delete d.pendingQuestion;delete d.teamEmoji;
  this._scheduleTeamEmojiDeadline();this._changed();return clone(next);
 }
 async skipSelection(room){
  const d=this._getHostData(room);
  const next=skipSelectionTurn(d.public);
  if(!next)throw Error('Das Auswahlrecht kann nur auf einem freien Spielbrett mit mehreren Teams weitergegeben werden.');
  d.public=next;this._changed();return selectingTeam(next);
 }
 async returnToBoard(room,round,id){
  const d=this._getHostData(room);
  if(activeChronobreak(d.public))throw Error('Chronobreak ist noch aktiv.');
  if(d.public.round!==Number(round)||d.public.current?.id!==id)throw Error('Diese Frage ist nicht mehr aktiv.');
  if(d.public?.current?.firstAnswerPending&&!['ready'].includes(d.public.phase))throw Error('Das Ausgleichs-Team muss zuerst bewertet werden.');
  if(d.buzzers[String(round)]&&!d.public?.buzzerResolved?.[String(round)])
   throw Error('Offener Buzzer: erst Richtig oder Falsch entscheiden oder den Buzzer zurücksetzen.');
  const previous=d.public,next=returnToBoardState(previous);
  if(!next)throw Error('Keine aktive Frage.');
  if(previous.phase==='ready')delete d.questionHistory[String(previous.round)];
  d.public={...next,jokerEvent:null,jokerRerollRequest:null,chronoBreak:null,jokerShields:{}};d.picks={};delete d.pendingQuestion;delete d.teamEmoji;
  this._scheduleTeamEmojiDeadline();this._changed();
  return clone(next);
 }
 async advanceBoard(room,round,{force=false}={}){
  const d=this._getHostData(room);
  if(d.public.round!==Number(round))throw Error('Das Spielbrett hat sich geändert.');
  if(force!==true&&force!==false)throw Error('Ungültige Rundenfreigabe.');
  const next=advanceBoardState(d.public,{force});
  if(!next)throw Error('Runde 2 bzw. das Ausgleichs-Board kann nur aus der Übersicht bei freien Fragen gestartet werden.');
  d.public=next;this._changed();return clone(next);
 }
 async updateCurrent(room,round,id,changes,phases=['question','paused','review']){const d=this._getHostData(room);if(activeChronobreak(d.public)&&changes?.phase==='reveal')throw Error('Chronobreak läuft noch.');if(d.teamEmoji)throw Error('Diese Teamrunde hat eine eigene Phasensteuerung.');
  if(changes?.phase==='reveal'&&d.public?.current?.firstAnswerPending)throw Error('Erst die Erstantwort bewerten.');
  if(changes?.phase==='reveal'&&['question','paused','review','answered'].includes(d.public?.phase)&&
    d.public?.current?.roundMode==='buzzer'&&d.buzzers[String(round)]&&!d.public?.buzzerResolved?.[String(round)])
   throw Error('Ein Buzzer ist noch offen. Zuerst Richtig oder Falsch bestätigen oder den Buzzer zurücksetzen.');
  const next=applyQuestionChanges(d.public,round,id,changes,phases);if(!next)throw Error('Die Runde hat sich geändert. Veraltete Aufdeckung verworfen.');d.public=next;this._changed();return clone(next)}
 async recordQuestion(room,round,entry){const d=this._getHostData(room);d.questionHistory[String(round)]=clone(entry);this._changed()}
 async replacePublic(room,state){const d=this._getHostData(room);d.public=clone(state);if(!d.teamEmoji)delete d.public.teamEmoji;this._changed()}
 _syncTeamEmoji(){
  const d=this.data;
  d.public.teamEmoji=publicTeamEmoji(d.teamEmoji);
  d.public.deadline=d.teamEmoji.deadline;
 }
 _scheduleTeamEmojiDeadline(){
  clearTimeout(this.teamEmojiTimer);
  this.teamEmojiTimer=null;
  const round=this.data?.teamEmoji;
  if(this.mode!=='host'||this.data?.public?.phase!=='question'||!round?.deadline)return;
  const {id,phase,deadline}=round;
  this.teamEmojiTimer=setTimeout(()=>{
   this.teamEmojiTimer=null;
   if(!this._advanceTeamEmoji(id,phase))this._scheduleTeamEmojiDeadline();
  },Math.max(0,deadline-Date.now()));
 }
 _advanceTeamEmoji(id,phase,forceFinish=false){
  const d=this.data,round=d?.teamEmoji;
  if(this.mode!=='host'||!round||round.id!==id||round.phase!==phase||d.public.phase!=='question')return false;
  if(forceFinish)finishTeamEmoji(round);
  else if(!advanceTeamEmoji(round,Date.now()))return false;
  if(round.phase==='reveal'){
   const p=d.public;
   for(const result of round.results){
    if(!result.points)continue;
    const before={scores:{...p.scores}};
    p.scores[result.id]=(Number(p.scores[result.id])||0)+result.points;
    this._auditScore(d,before,{kind:TEAM_EMOJI,team:result.id,round:p.round,questionId:p.current.id});
   }
   const question=this.hostQuiz?.questions.find(item=>item.id===p.current.id);
   p.current=question?{...publicQuestion(question,true),points:p.current.points,basePoints:p.current.basePoints,doublePoints:p.current.doublePoints}:{...p.current,answerText:round.target};
   p.phase='reveal';
    const earningTeam=round.results.find(row=>Number(row.points)>0)?.id;
    if(earningTeam)d.public=awardJokerForCorrectAnswer(p,earningTeam);
    const entry=d.questionHistory?.[String(p.round)];
   if(entry)entry.emojiResults=round.results.map(result=>({...result,name:p.teams[result.id]}));
  }
  this._syncTeamEmoji();
  this._scheduleTeamEmojiDeadline();
  this._changed();
  return true;
 }
 async startTeamEmoji(room,id){
  this._assertHost(room);
  return this._advanceTeamEmoji(id,'roles');
 }
 async reviewTeamEmoji(room,id,phase){
  this._assertHost(room);
  if(phase==='reveal'||!this._advanceTeamEmoji(id,phase,true))throw Error('Diese Teamrunde ist nicht mehr offen.');
 }
 async judgeTeamEmoji(room,id,team,verdict){
  const d=this._getHostData(room),round=d.teamEmoji,p=d.public;
  const row=round?.results?.find(result=>result.id===team);
  if(round?.id!==id||round.phase!=='reveal'||!row||!['correct','wrong'].includes(verdict))throw Error('Dieses Teamergebnis fehlt.');
  const before=clone(p),points=verdict==='correct'?round.points:0;
  p.scores[team]=(Number(p.scores[team])||0)+points-row.points;
  row.status=verdict;row.points=points;
   if(verdict==='correct')d.public=awardJokerForCorrectAnswer(p,team);
   this._auditScore(d,before,{kind:TEAM_EMOJI,team,round:p.round,questionId:p.current.id});
  const entry=d.questionHistory?.[String(p.round)];
  if(entry)entry.emojiResults=round.results.map(result=>({...result,name:p.teams[result.id]}));
  this._syncTeamEmoji();this._changed();
 }
 async closeTeamEmoji(room,id,phase){
  const d=this._getHostData(room),emoji=d.teamEmoji,p=d.public;
  if(!emoji||emoji.id!==id||emoji.phase!==phase)return false;
  const questionId=p.current.id;
  const next=returnToBoardState(emoji.phase==='roles'?{...p,phase:'ready'}:p);
  if(!next)return false;
  if(emoji.phase==='roles'){
   delete d.questionHistory[String(p.round)];
  }
  delete d.teamEmoji;d.public=next;
  this._scheduleTeamEmojiDeadline();
  this._changed();return true;
 }
 async submitTeamEmoji(room,id,kind,value){
  this._ensureGuest(room);
  return this._rpc(TEAM_EMOJI,{id,kind,value});
 }
 async chooseLobbyTeam(room,team){if(this.mode==='guest')return this._rpc('lobby-join',{team});throw Error('Teamwahl nur für Teilnehmer.')}
 async createLobbyTeam(room,name){if(this.mode==='guest')return this._rpc('lobby-create',{name});throw Error('Teamerstellung nur für Teilnehmer.')}
 async setLobbyReady(room,ready){if(this.mode==='guest')return this._rpc('lobby-ready',{ready});throw Error('Bereitschaft nur für Teilnehmer.')}
 async requestPick(room,qid,name){throw Error('Nur der Host darf Fragen auswählen.');}
 async clearPicks(room){const d=this._getHostData(room);d.picks={};d.public.questionPick=null;this._changed()}
 async scorePerson(room,personId,action){const d=this._getHostData(room);
  if(d.public?.scoreMode!=='individual')throw Error('Im Teammodus gibt es ausschließlich einen gemeinsamen Punktestand pro Team. Korrigiere stattdessen die Teamwertung.');
  if(!safeUid(personId)&&!/^(manual_[0-9]{1,2})$/.test(personId))throw Error('Ungültige Person-ID.');
  const before=clone(d.public);d.public.playerScores??={};
  const result=updatePlayerScore(d.public.playerScores[personId],action);d.public.playerScores[personId]=result;
  this._auditScore(d,before,{kind:'manual-person',person:personId,round:d.public.round});this._changed();return clone(result)}
 async score(room,team,delta){const d=this._getHostData(room);if(!d.public?.teams?.[team])throw Error('Team unbekannt.');
  if(!Number.isFinite(Number(delta))||!Number(delta)||Math.abs(Number(delta))>10000)throw Error('Ungültige Punkteänderung.');
  const after=(Number(d.public.scores?.[team])||0)+Number(delta);
  if(!Number.isFinite(after)||Math.abs(after)>999999)throw Error('Punktelimit von ±999.999 überschritten.');
  const before=clone(d.public);d.public.scores={...(d.public.scores||{}),[team]:after};
  this._auditScore(d,before,{kind:'manual-team',team,round:d.public.round});this._changed();return after;}
 async judgeWritten(room,round,uid,result){
  const d=this._getHostData(room),p=d.public,key=String(round);
   const entry=p?.answerReview?.entries?.[uid];
   if(String(p?.round)!==key||!['review','reveal'].includes(p?.phase)||roundMode(p.current)!=='written'||p.buzzerResolved?.[key]||
      !entry||(entry.submitted&&!entry.revealed)||!d.roster?.[uid]||!['correct','wrong'].includes(result))
   throw Error('Diese schriftliche Antwort ist nicht bewertbar.');
  const teamMode=p.scoreMode!=='individual',team=teamMode?d.roster[uid].team:'';
  if(teamMode){
   if(!Object.hasOwn(p.teams||{},team))throw Error('Spielerteam nicht mehr vorhanden.');
   const official=p.writtenTeamRepresentatives?.[key]?.[team];
   if(official&&official!==uid)
    throw Error('Für dieses Team ist bereits eine andere Antwort offiziell gewertet. Bitte deren Bewertung korrigieren oder die letzte Wertung zurücknehmen.');
  }
  // Work on a copy: rejecting a second team's answer must not leave partial
  // personal points or team scores behind in the host checkpoint.
  const before=clone(p),nextPublic=clone(p),pts=Number(p.current.points);
  const previous=Number(nextPublic.playerScores?.[uid]?.rounds?.[key]?.delta)||0;
  const nextScore=updatePlayerScore(nextPublic.playerScores?.[uid],{
   kind:'judgement',round:key,questionId:p.current.id,points:pts,result,at:Date.now()
  });
  if(teamMode&&result==='wrong'&&shieldApplies(p,team)){
   const blocked=Number(nextScore.rounds[key].delta)||0;
   nextScore.rounds[key].delta=0;nextScore.total-=blocked;
   const charged=changeJokerCharge(nextPublic,team,'shield',-1);
   if(charged){nextPublic.jokers=charged.jokers;delete nextPublic.jokerShields?.[team];}
  }
  nextPublic.playerScores={...(nextPublic.playerScores||{}),[uid]:nextScore};
  if(teamMode){
   nextPublic.writtenTeamRepresentatives={...(nextPublic.writtenTeamRepresentatives||{}),
    [key]:{...(nextPublic.writtenTeamRepresentatives?.[key]||{}),[team]:uid}};
   nextPublic.scores={...(nextPublic.scores||{}),
    [team]:(Number(nextPublic.scores?.[team])||0)+(Number(nextScore.rounds[key].delta)||0)-previous};
  }
  d.public=result==='correct'&&teamMode?awardJokerForCorrectAnswer(nextPublic,team):nextPublic;
  this._auditScore(d,before,{kind:'written-judgement',person:uid,team,round:key,
   questionId:nextPublic.current.id,verdict:result});
  this._changed();return clone(nextScore);
 }
 async judgeFirstAnswer(room,round,team,result,revealPatch=null){
   const d=this._getHostData(room),p=d.public,key=String(round);
   if(Number(p.round)!==Number(round)||!['question','paused'].includes(p.phase)||
      p.boardRound!==3||p.scoreMode!=='team'||p.current?.roundMode!=='buzzer'||
      p.current?.firstAnswerPending!==true||p.current.firstAnswerTeam!==team||
      p.selectionTurn?.order?.[p.selectionTurn.index]!==team||
      d.buzzers?.[key]||p.buzzerResolved?.[key]||!['correct','wrong'].includes(result))
    throw Error('Das Erst-Antwortrecht ist nicht mehr aktuell. Bitte Spielstand aktualisieren.');
   if(!Object.hasOwn(p.teams||{},team))throw Error('Das Team ist nicht mehr aktiv.');
   const before=clone(p),next=clone(p),delta=result==='wrong'&&shieldApplies(p,team)?0:judgementDelta(p.current.points,result);
   if(result==='wrong'&&shieldApplies(p,team)){
    const after=changeJokerCharge(next,team,'shield',-1);
    if(after){next.jokers=after.jokers;delete next.jokerShields?.[team];}
   }
   const total=(Number(next.scores?.[team])||0)+delta,at=Date.now();
   if(!Number.isFinite(total)||Math.abs(total)>999999)throw Error('Punktelimit überschritten.');
   next.scores={...(next.scores||{}),[team]:total};
   next.current={...next.current,firstAnswerPending:false,firstAnswerResult:result};
   let finalState=next;
   if(result==='correct'){
    if(!revealPatch||revealPatch.phase!=='reveal'||revealPatch.deadline!==0||
       revealPatch.current?.id!==p.current.id||revealPatch.current?.roundMode!=='buzzer'||
       !Object.hasOwn(revealPatch.current,'answer'))
     throw Error('Für die richtige Erstantwort fehlt die vollständige Lösungsfreigabe.');
    next.buzzerResolved={...(next.buzzerResolved||{}),[key]:{team,uid:'',result,at,firstAnswer:true}};
    finalState=applyQuestionChanges(next,round,p.current.id,revealPatch,['question','paused']);
    if(!finalState)throw Error('Erstantwort und Lösung konnten nicht gemeinsam übernommen werden.');
   }else{
    next.buzzerArmed=true;next.deadline=0;
    next.buzzerBlockedTeams={...(next.buzzerBlockedTeams||{}),
      [key]:{...(next.buzzerBlockedTeams?.[key]||{}),[team]:{team,name:p.teams[team],at}}};
    next.buzzerJudgements={...(next.buzzerJudgements||{}),[key]:{uid:'',team,result,delta,at,firstAnswer:true}};
   }
   d.public=result==='correct'?awardJokerForCorrectAnswer(finalState,team):finalState;
   this._auditScore(d,before,{kind:'balance-first-answer',team,actor:team,round:key,questionId:p.current.id,verdict:result});
   this._changed();
   return {delta,team,result};
  }
  async judgeBuzzer(room,round,uid,result,revealPatch=null,{oral=false}={}){
   const d=this._getHostData(room),before=clone(d.public),key=String(round);
   if(activeChronobreak(d.public))throw Error('Chronobreak läuft: erst nach dem Countdown bewerten.');
   let judgedBuzzers=d.buzzers;
   if(oral){
    const person=d.roster?.[uid];
    if(d.buzzers[key]||!person||!Object.hasOwn(d.public.teams||{},person.team))throw Error('Wähle eine Person für die mündliche Wertung.');
    judgedBuzzers={...d.buzzers,[key]:{uid,team:person.team,name:person.name,at:Date.now(),oral:true}};
   }
   const next=applyBuzzerJudgement(d.public,judgedBuzzers,{round,uid,result});
  let finalState=next.state;
  if(result==='correct'){
   // Publish the score, winning buzzer, question answer and closing phase as ONE
   // authoritative snapshot. No intermediate "correct points, hidden answer".
   if(!revealPatch||revealPatch.phase!=='reveal'||revealPatch.deadline!==0||
      revealPatch.current?.id!==d.public.current?.id||
      revealPatch.current?.roundMode!=='buzzer'||
      !Object.hasOwn(revealPatch.current,'answer')){
    throw Error('Für die richtige Buzzer-Bewertung fehlt die vollständige Lösungsfreigabe.');
   }
    finalState=applyQuestionChanges(next.state,round,d.public.current.id,revealPatch,['question','paused']);
   if(!finalState)throw Error('Lösung und Punkte konnten nicht gemeinsam übernommen werden.');
  }
  d.public=result==='correct'?awardJokerForCorrectAnswer(finalState,next.winner.team):finalState;d.buzzers=next.buzzers;
  this._auditScore(d,before,{kind:'buzzer-judgement',team:d.public.scoreMode==='individual'?'':next.winner.team,
    person:d.public.scoreMode==='individual'?uid:'',actor:uid,round,questionId:d.public.current?.id||'',verdict:result});
  this._changed();
  return {delta:next.delta,winner:next.winner};
 }
 _auditScore(d,before,meta){const event=scoreEvent(before,d.public,{...meta,points:meta.verdict?before.current?.points:undefined,id:randomHex(8),at:Date.now()});if(event)d.scoreEvents=appendScoreEvent(d.scoreEvents,event);}
 hostScoreAudit(room){const d=this._getHostData(room);return clone((d.scoreEvents||[]).slice(-40));}
 async hostUndoScore(room,id){
  const d=this._getHostData(room),done=undoScoreEvent(d.public,d.scoreEvents,id);
  const event=done.event,team=event.changes?.team?.id,person=event.changes?.person?.id;
  // Undoing the FIRST official written answer releases this team's official
  // slot only if the original per-round verdict was actually removed.
  if(event.kind==='written-judgement'&&team&&person&&
     done.state.writtenTeamRepresentatives?.[event.round]?.[team]===person&&
     !done.state.playerScores?.[person]?.rounds?.[event.round]){
   const reps=structuredClone(done.state.writtenTeamRepresentatives);
   delete reps[event.round][team];
   if(!Object.keys(reps[event.round]).length)delete reps[event.round];
   done.state.writtenTeamRepresentatives=reps;
  }
  d.public=done.state;d.scoreEvents=done.events;this._changed();return clone(done.event);
 }
 async hostRegradeScore(room,id){
  const d=this._getHostData(room),target=d.scoreEvents?.find(event=>event.id===id);
  const questionPoints=d.public.board?.[target?.questionId]?.points;
  const done=regradeScoreEvent(d.public,d.scoreEvents,id,{newId:randomHex(8),questionPoints});
  d.public=done.state;d.scoreEvents=done.events;this._changed();return clone(done.event);
 }
 async clearBuzzer(room,round){const d=this._getHostData(room);delete d.buzzers[String(round)];this._changed()}
 async removeResponse(room,round,uid){const d=this._getHostData(room);delete d.responses[String(round)]?.[uid];this._changed()}
 async clearRoomEvents(room){const d=this._getHostData(room);d.buzzers={};d.responses={};d.picks={};d.questionHistory={};d.scoreEvents=[];d.public.questionPick=null;delete d.pendingQuestion;delete d.teamEmoji;delete d.public.teamEmoji;this._scheduleTeamEmojiDeadline();this._changed()}
 async deleteRoom(room){this._assertHost(room);for(const ctx of this.guestConnections.values()){try{ctx.conn.send({t:'shutdown'});ctx.conn.close()}catch{}}
  for(const ctx of this.projectorConnections){try{ctx.conn.send({t:'closed'});}catch{}}
  this.data=null;this.shutdown();await (this.checkpointWrites||Promise.resolve()).catch(()=>null);
  try{localStorage.removeItem('bq-p2p-session-'+room)}catch{}
  await deleteHostCheckpoint('session-'+room).catch(()=>null);
 }
 shutdown(){
  this.quitting=true;
  for(const timer of [this.reconnectTimer,this.hostReconnectTimer,this.snapshotTimer,this.teamEmojiTimer,this.clockTimer])clearTimeout(timer);
  this.clockSample=this.clockProbe=null;this.clockSamples=[];
  this.reconnectTimer=this.hostReconnectTimer=this.snapshotTimer=this.teamEmojiTimer=null;
  for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Verbindung geschlossen.'));}
  for(const ctx of this.unverifiedConnections){clearTimeout(ctx.helloTimer);try{ctx.conn.close()}catch{}}
  this.unverifiedConnections.clear();
  this.pending.clear();this.uncertainActions.clear();
  try{this.conn?.close();}catch{}try{this.peer?.destroy();}catch{}
  this.conn=this.peer=null;
  this.connected=false;this.mode='idle';this.connectionPhase='idle';this.iceState='unknown';this.guestConnections.clear();this.projectorConnections.clear();this.projectorFrame=null;this._emit();
 }
}
