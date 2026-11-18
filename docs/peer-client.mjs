/* BrainQuiz Studio 2.7 — Host-authoritative PeerJS/WebRTC room transport.
 * GitHub Pages serves only static files. PeerJS Cloud provides signaling;
 * the connected host browser keeps the authoritative room in memory.
 * No Firebase, cloud database, or public hosting of private quiz solutions.
 */
import {canBuzz,roundMode,applyBuzzerJudgement} from './round-rules.mjs';
import {decodePoint} from './map-tools.mjs';
import {buildPublicBoard,buildTeams,buildScores,manualPlayerLabels,updatePlayerScore} from './core.mjs';
import {approval,MAX_PLAYERS,MAX_TEAMS,validTeamId,cleanTeamName,addLobbyTeam,canArrangeLobby,lobbySnapshot} from './lobby-model.mjs';
import {openQuestionState,applyQuestionChanges} from './question-flow.mjs';
import {scoreEvent,appendScoreEvent,undoScoreEvent,regradeScoreEvent} from './score-ledger.mjs';
import {saveHostCheckpoint,loadHostCheckpoint,deleteHostCheckpoint,saveLocalHostQuiz,loadBestHostQuiz} from './backup-store.mjs';

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
function peerError(error){const type=String(error?.type||'');if(type==='peer-unavailable'||type==='unavailable-id')return 'Dieser Raumcode ist bereits in Benutzung.';if(type==='network'||type==='server-error')return 'PeerJS-Signalserver nicht erreichbar. Internetverbindung prüfen.';return String(error?.message||error||'WebRTC-Verbindungsfehler').slice(0,220);}
let loadingPeer=null;
export async function loadPeerJS(){
 if(typeof globalThis.Peer==='function')return globalThis.Peer;
 if(loadingPeer)return loadingPeer;
 loadingPeer=new Promise((resolve,reject)=>{
  if(typeof document==='undefined')return reject(Error('PeerJS benötigt einen Browser.'));
  const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';script.async=true;
  script.onload=()=>typeof globalThis.Peer==='function'?resolve(globalThis.Peer):reject(Error('PeerJS wurde nicht geladen.'));
  script.onerror=()=>reject(Error('PeerJS konnte nicht geladen werden. Prüfe den Zugriff auf cdn.jsdelivr.net.'));
  document.head.appendChild(script);
 }).catch(error=>{loadingPeer=null;throw error;});
 return loadingPeer;
}
const TURN_STORAGE='bq-turn-relay-v1';

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
function peerOptions(){
 try{
  const stored=JSON.parse(sessionStorage.getItem(TURN_STORAGE)||'null');
  if(stored){
   const relay=turnServer({url:stored.urls,username:stored.username,credential:stored.credential});
   return {debug:0,config:{iceServers:[{urls:'stun:stun.l.google.com:19302'},relay]}};
  }
 }catch{}
 return {debug:0};
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
   handshakeTimer=setTimeout(()=>retry(candidate),18000);
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
function guestIdentity(room){
 const key='bq-p2p-guest-'+room;let item=null;
 try{item=JSON.parse(sessionStorage.getItem(key)||'null')}catch{}
 if(!item||!safeUid(item.uid)||!TOKEN_RE.test(item.secret||'')){
  item={uid:'p_'+randomHex(12),secret:randomHex(24)};
  try{sessionStorage.setItem(key,JSON.stringify(item))}catch{}
 }
 return item;
}
function roomData(owner,quiz,{published=false}={}){return {owner,access:{title:quiz.title,createdAt:Date.now()},public:{title:quiz.title,published:published===true,started:false,scoreMode:quiz.scoreMode||'team',phase:'board',round:0,board:buildPublicBoard(quiz),teams:buildTeams(quiz),scores:buildScores(quiz),manualPlayers:manualPlayerLabels(quiz),playerScores:{},buzzerBlocked:{},settings:{buzzerEnabled:true,chatOpen:true,lockOnBuzz:false,timerSeconds:60},used:{}},members:{},roster:{},presence:{},buzzers:{},responses:{},messages:{},picks:{},questionHistory:{}};}

export class PeerGame{
 constructor(){this.mode='idle';this.uid='';this.secret='';this.room='';this.peer=null;this.conn=null;this.connected=false;this.offset=0;this.data=null;this.guestData={};this.guestConnections=new Map();this.projectorConnections=new Set();this.projectorFrame=null;this.memberSecrets={};this.listeners=[];this.hostQuiz=null;this.pending=new Map();this.uncertainActions=new Map();this.requestNo=0;this.reconnectTimer=null;this.hostReconnectTimer=null;this.hostReconnectAttempts=0;this.snapshotTimer=null;this.incomingWire=null;this.cachedQuizAudio=null;this.quitting=false;this.netError='';}
 async init(){return this;}
 serverNow(){return Date.now()+this.offset;}
 diagnostics(){
  return {mode:this.mode,connected:!!this.connected,error:String(this.netError||'').slice(0,160),
    lastBackupAt:this.lastBackupAt||0,backupError:this.backupError||'',
    peers:this.mode==='host'?Object.entries(this.data?.members||{}).filter(([,member])=>member.status!=='removed').map(([uid,member])=>{
     const ctx=this.guestConnections.get(uid);
     return {
      uid,name:String(member.name||'Spieler').slice(0,28),
      connected:!!ctx?.conn?.open,lastReceived:ctx?.lastSeenAt||0,lastSent:ctx?.lastSentAt||0,
      lastAck:ctx?.lastAckAt||0,synced:!!ctx?.lastAckAt&&ctx.ackVersion===ctx.snapshotVersion,
      bufferedBytes:Number(ctx?.conn?.dataChannel?.bufferedAmount)||0
     };
    }):[]};
 }
 _emit(){for(const entry of [...this.listeners]){try{entry.cb(this._read(entry.path))}catch(error){console.error('[BrainQuiz Peer watcher]',error)}}}
 _read(path){if(path==='.info/connected')return this.connected;if(path==='.info/serverTimeOffset')return this.offset;const prefix='rooms/'+this.room;if(!path.startsWith(prefix+'/'))return null;return clone(pathValue(this.mode==='host'?this.data:this.guestData,path.slice(prefix.length+1)))??null;}
 watch(path,cb){const entry={path,cb};this.listeners.push(entry);queueMicrotask(()=>{if(this.listeners.includes(entry))cb(this._read(path))});return ()=>{this.listeners=this.listeners.filter(e=>e!==entry)};}
 watchRoom(room,path,cb){if(room!==this.room)throw Error('Falscher Raum.');return this.watch('rooms/'+room+'/'+path,cb)}
 clearWatchers(){this.listeners=[];}
 async _preparePeer(){const Peer=await loadPeerJS();return Peer;}
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
   if(this.mode!=='host'||this.quitting){try{conn.close()}catch{}return}
   const ctx={conn,uid:null,ready:false,lastChat:0,wireSequence:0,sentQuizAudioKey:null,wireChain:Promise.resolve()};
   conn.on('data',msg=>this._receiveFromGuest(ctx,msg));
   const disconnected=()=>{
    if(ctx.display)this.projectorConnections.delete(ctx);
    else this._disconnectGuest(ctx);
   };
   conn.on('close',disconnected);
   conn.on('error',disconnected);
  });
  const lost=()=>{
   if(this.quitting||this.peer!==peer)return;
   this.connected=false;this.netError='Signalserver getrennt. Wiederverbindung läuft …';
   this._emit();this._scheduleHostReconnect();
  };
  peer.on('disconnected',lost);
  peer.on('close',lost);
  peer.on('open',()=>{
   if(this.quitting||this.peer!==peer)return;
   clearTimeout(this.hostReconnectTimer);this.hostReconnectTimer=null;this.hostReconnectAttempts=0;
   this.connected=true;this.netError='';this._emit();
  });
  peer.on('error',error=>{if(peer.destroyed||['network','server-error','socket-error','socket-closed'].includes(error?.type))lost();});
 }
 async _openHostPeer(room){
  const Peer=await this._preparePeer();const peer=new Peer(peerId(room),peerOptions());this.peer=peer;this.quitting=false;
  await new Promise((resolve,reject)=>{let done=false;const timer=setTimeout(()=>{if(!done){done=true;reject(Error('PeerJS konnte den Host-Raum nicht anmelden.'))}},16000);
   peer.on('open',()=>{if(!done){done=true;clearTimeout(timer);resolve()}});
   peer.on('error',error=>{if(!done){done=true;clearTimeout(timer);reject(Error(peerError(error)))}})
  }).catch(err=>{try{peer.destroy()}catch{}throw err});
  this.mode='host';this.room=room;this.connected=true;this.netError='';this.hostReconnectAttempts=0;this._listenHostPeer(peer);this._emit();
 }
 _persist(){if(this.mode!=='host'||!this.data)return;
  // Only the host browser receives this backup. Complete quiz media remain in bq-quiz-<room>.
  const room=this.room,savedAt=this.savedAt=Math.max(Date.now(),(this.savedAt||0)+1);
  const checkpoint={uid:this.uid,data:clone(this.data),secrets:clone(this.memberSecrets),savedAt};
  let localSaved=false;
  try{localStorage.setItem('bq-p2p-session-'+room,JSON.stringify(checkpoint));localSaved=true;this.lastBackupAt=savedAt;}catch{}
  this.checkpointWrites=(this.checkpointWrites||Promise.resolve()).then(async()=>{
   const backedUp=await saveHostCheckpoint('session-'+room,checkpoint).catch(()=>false);
   if(backedUp)this.lastBackupAt=Math.max(savedAt,this.lastBackupAt||0);
   this.backupError=localSaved||backedUp?'':'Spielstand konnte nicht gesichert werden. Speicherplatz im Browser prüfen.';
   return backedUp;
  });
  return localSaved?Promise.resolve(true):this.checkpointWrites;
 }
 _changed(){const saved=this._persist();this._emit();if(!this.snapshotTimer)this.snapshotTimer=setTimeout(()=>{this.snapshotTimer=null;for(const ctx of this.guestConnections.values())this._sendSnapshot(ctx)},25);return saved;}
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
  this.data.presence={};await this._openHostPeer(room);this._persist();return room;
 }
 async saveHostQuiz(room,quiz){this._assertHost(room);if(!quiz||!Array.isArray(quiz.questions)||quiz.questions.length>180)throw Error('Ungültiges Host-Quiz.');
  if(new TextEncoder().encode(JSON.stringify(quiz)).length>8_000_000)throw Error('Host-Quiz überschreitet 8 MB. Medien verkleinern.');
  this.hostQuiz=clone(quiz);
  const savedAt=this.quizSavedAt=Math.max(Date.now(),(this.quizSavedAt||0)+1);
  const localSaved=saveLocalHostQuiz(room,quiz,savedAt);
  const extraSaved=await saveHostCheckpoint('quiz-'+room,{quiz:this.hostQuiz,savedAt}).catch(()=>false);
  if(!localSaved&&!extraSaved)throw Error('Host-Quiz konnte nicht gespeichert werden. Bitte als Datei exportieren.');
 }
 async getHostQuiz(room){this._assertHost(room);if(this.hostQuiz)return clone(this.hostQuiz);
  return loadBestHostQuiz(room);}
 _assertHost(room){if(this.mode!=='host'||this.room!==room||!this.data)throw Error('Nur der Host darf diese Aktion ausführen.');}
 _ensureGuest(room){if(this.mode!=='guest'||this.room!==room||!this.conn?.open||!this.connected)throw Error('Verbindung zum Host unterbrochen.');}
 async connect(room,name=''){if(!/^[A-HJ-NP-Z2-9]{16}$/.test(room))throw Error('Ungültiger Raumcode.');if(this.mode!=='idle')this.shutdown();this.mode='guest';this.room=room;
  this.quitting=false;this.guestReconnectAttempts=0;
  const ident=guestIdentity(room);this.uid=ident.uid;this.secret=ident.secret;this.guestName=safeText(name,28)||this.guestName||'Spieler';
  await this._connectGuestOnce();return this.guestData.members?.[this.uid]||null;
 }
 async _connectGuestOnce(){
  this.incomingWire=null;this.cachedQuizAudio=null;
  const Peer=await this._preparePeer();this.quitting=false;
  const peer=new Peer(undefined,peerOptions());this.peer=peer;
  await new Promise((resolve,reject)=>{
   let done=false,accepted=false,conn=null;const timer=setTimeout(()=>finish(Error('Host nicht erreichbar. Einladung und Internetverbindung prüfen.')),18000);
   const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(error){try{peer.destroy()}catch{}reject(error)}else resolve()};
   peer.on('open',()=>{if(this.peer!==peer||this.quitting||conn)return;conn=peer.connect(peerId(this.room),{reliable:true,serialization:'json'});this.conn=conn;
    conn.on('open',()=>conn.send({t:'hello',uid:this.uid,secret:this.secret,name:this.guestName,room:this.room}));
    conn.on('data',input=>{
     const decoded=nextWirePart(this.incomingWire,input);this.incomingWire=decoded.partial;const msg=decoded.message;
     if(!msg)return;
     if(msg?.t==='welcome'){
      if(this.peer!==peer||this.conn!==conn||accepted)return;
      if(!this._applySnapshot(msg.state)){finish(Error('Spielstand konnte nicht vollständig empfangen werden.'));return;}
      accepted=true;this.connected=true;this.netError='';this.guestReconnectAttempts=0;
      this._ackSnapshot(msg.version);finish();this._emit();
      for(const pending of this.pending.values())this._sendRequest(pending);
     }
     else if(msg?.t==='denied')finish(Error(msg.reason||'Beitritt abgelehnt.'));
     else if(this.peer===peer&&this.conn===conn)this._receiveFromHost(msg);
    });
    conn.on('close',()=>{if(!done)finish(Error('Hostverbindung abgebrochen.'));else if(accepted&&this.peer===peer&&this.conn===conn)this._guestLost()});
    conn.on('error',()=>{if(!done)finish(Error('WebRTC-Datenkanal fehlgeschlagen.'));else if(accepted&&this.peer===peer&&this.conn===conn)this._guestLost()});
   });
   peer.on('error',err=>{if(!done)finish(Error(peerError(err)));else if(accepted&&this.peer===peer&&!conn?.open)this._guestLost();});
   peer.on('disconnected',()=>{if(!this.quitting&&this.peer===peer)try{peer.reconnect()}catch{}});
  });
 }
 _guestLost(){
  if(this.quitting||this.mode!=='guest'||this.reconnectTimer)return;
  this.connected=false;this.netError='Hostverbindung unterbrochen. Wiederverbindung läuft …';this._emit();
  const delay=Math.min(10000,1500+1500*this.guestReconnectAttempts++);
  this.reconnectTimer=setTimeout(async()=>{
   this.reconnectTimer=null;
   const previous=this.peer;this.peer=null;this.conn=null;
   try{previous?.destroy();}catch{}
   try{await this._connectGuestOnce();}catch{this._guestLost();}
  },delay);
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
  this.guestData={
  public:payload.public||null,lobby:payload.lobby||null,roster:payload.roster||{},presence:payload.presence||{},buzzers:payload.buzzers||{},
  members:payload.member?{[this.uid]:payload.member}:{},responses:payload.ownResponse?{[String(payload.public?.round||0)]:{[this.uid]:payload.ownResponse}}:{},
  messages:payload.messages||{}
  };return true;}
 _ackSnapshot(version){
  if(!Number.isSafeInteger(version)||version<1)return;
  try{this.conn.send({t:'snapshot-ack',version});}catch{}
 }
 _receiveFromHost(msg){if(!msg||typeof msg!=='object')return;
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
   this.netError='Der Host hat den Raum geschlossen.';this.quitting=true;this.connected=false;
   for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(this.netError));}
   this.pending.clear();this._emit();
  }
 }
 _snapshotFor(ctx){const member=this.data.members?.[ctx.uid]||null,approved=member?.status==='approved',publicState=approved?this.data.public:null;
  const round=String(this.data.public?.round||0),ownResponse=approved?this.data.responses?.[round]?.[ctx.uid]||null:null;
  const msgs=approved&&member.team?{[member.team]:this.data.messages?.[member.team]||{}}:{};
  return {member:clone(member),lobby:lobbySnapshot(this.data),public:clone(publicState),roster:approved?clone(this.data.roster):{},presence:approved?clone(this.data.presence):{},buzzers:approved?clone(this.data.buzzers):{},ownResponse:clone(ownResponse),messages:clone(msgs)};
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
  if(!this.hasProjector(room)||this.projectorFrame?.html===frame.html&&this.projectorFrame?.deadline===frame.deadline)return;
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
     await this._sendHostMessage(ctx,frame);
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
  ctx.display=true;
  this.projectorConnections.add(ctx);
  try{ctx.conn.send({t:'display-ready'});}catch{}
  this._sendDisplay(ctx);
 }
 _disconnectGuest(ctx){if(this.quitting||!ctx.ready||!this.data||this.mode!=='host')return;const current=this.guestConnections.get(ctx.uid);if(current!==ctx)return;this.guestConnections.delete(ctx.uid);delete this.data.presence[ctx.uid];this._changed()}
 _receiveFromGuest(ctx,msg){if(!msg||typeof msg!=='object'||Array.isArray(msg))return;ctx.lastSeenAt=Date.now();
  try{if(JSON.stringify(msg).length>MAX_MESSAGE_BYTES){ctx.conn.close();return}}catch{return}
  if(ctx.display)return;
  if(!ctx.ready&&msg.t==='display-hello'){this._acceptDisplay(ctx,msg);return;}
  if(!ctx.ready){
   if(msg.t!=='hello'||msg.room!==this.room||!safeUid(msg.uid)||!TOKEN_RE.test(msg.secret||'')){ctx.conn.send({t:'denied',reason:'Ungültiger Beitritt.'});ctx.conn.close();return}
   const prev=this.memberSecrets[msg.uid],member=this.data.members[msg.uid];
   if(prev&&prev!==msg.secret){ctx.conn.send({t:'denied',reason:'Spieleridentität stimmt nicht überein.'});ctx.conn.close();return}
   if(!prev){if(Object.keys(this.data.members).filter(id=>this.data.members[id]?.status==='pending').length>=MAX_WAITING){ctx.conn.send({t:'denied',reason:'Warteraum ist voll.'});ctx.conn.close();return}
    this.memberSecrets[msg.uid]=msg.secret;
    this.data.members[msg.uid]={name:safeText(msg.name,28)||'Spieler',status:'pending',team:'',joinedAt:Date.now()};
   }else if(member?.status==='removed'){ctx.conn.send({t:'denied',reason:'Du wurdest aus dem Raum entfernt.'});ctx.conn.close();return}
   ctx.uid=msg.uid;ctx.ready=true;
   const old=this.guestConnections.get(ctx.uid);if(old&&old!==ctx){try{old.conn.close()}catch{}}
   this.guestConnections.set(ctx.uid,ctx);this.data.presence[ctx.uid]={connectedAt:Date.now()};
   void this._sendHostMessage(ctx,this._snapshotMessage(ctx,'welcome'));this._changed();return;
  }
  if(this.guestConnections.get(ctx.uid)!==ctx||!this.data)return;
  if(msg.t==='snapshot-ack'&&Number.isSafeInteger(msg.version)&&msg.version>(ctx.ackVersion||0)&&msg.version<=ctx.snapshotVersion){
   ctx.ackVersion=msg.version;ctx.lastAckAt=Date.now();this._emit();return;
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
   if(!canArrangeLobby(pub))throw Error('Die Teamaufstellung ist nach Spielbeginn gesperrt.');
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
  switch(action){
   case 'pick':{const qid=safeText(payload.qid,80);if(!Object.hasOwn(pub?.board||{},qid)||pub.board[qid].used||pub.phase!=='board')throw Error('Frage nicht mehr verfügbar.');this.data.picks[ctx.uid]={uid:ctx.uid,qid,name:member.name,at:now};return true}
   case 'buzz':{
    if(round!==String(payload.round))throw Error('Die Buzzer-Runde ist nicht mehr offen.');
    if(this.data.buzzers[round])return false;
    if(!canBuzz(pub,this.data.buzzers,ctx.uid,member.team,now))throw Error('Buzzer ist noch nicht freigegeben oder du bist für diese Runde gesperrt.');
    this.data.buzzers[round]={uid:ctx.uid,team:member.team,name:member.name,at:now};return true;
   }
   case 'answer':{if(pub?.phase!=='question'||String(payload.round)!==round||(pub.deadline&&now>pub.deadline))throw Error('Frage ist nicht offen.');const written=roundMode(pub.current)==='written',map=pub.current?.type==='map';if(!written&&!map)throw Error('Diese Frage wird mündlich beantwortet.');if(written&&!pub.answerParticipants?.[ctx.uid])throw Error('Nicht für diese Schreib-Runde freigegeben.');const b=this.data.buzzers[round];if(map&&!written&&(!b||b.uid!==ctx.uid))throw Error('Nur die Person am Buzzer darf den Kartenpunkt setzen.');const text=safeText(payload.text,800);if(!text)throw Error('Antwort darf nicht leer sein.');if(map&&!decodePoint(text))throw Error('Kartenpunkt liegt außerhalb der Weltkarte.');this.data.responses[round]??={};if(this.data.responses[round][ctx.uid]&&!map)throw Error('Antwort bereits abgegeben.');const original=this.data.responses[round][ctx.uid];this.data.responses[round][ctx.uid]={uid:ctx.uid,team:member.team,text,at:original?.at||now,updatedAt:now};return true}
   case 'message':{if(!pub?.settings?.chatOpen||(pub.settings.lockOnBuzz&&pub.phase==='question'&&this.data.buzzers[round]))throw Error('Teamchat geschlossen.');const text=safeText(payload.text,500);if(!text||now-ctx.lastChat<1000)throw Error('Nachrichtenrate begrenzt.');ctx.lastChat=now;this.data.messages[member.team]??={};const messages=this.data.messages[member.team];messages['m_'+randomHex(9)]={uid:ctx.uid,name:member.name,text,at:now};const keys=Object.keys(messages);for(const key of keys.slice(0,-80))delete messages[key];return true}
   default:throw Error('Aktion nicht erlaubt.');
  }
 }
 _sendRequest(pending){try{this.conn.send(pending.packet);}catch{this._guestLost();}}
 _rpc(action,payload={}){
  const key=JSON.stringify([action,payload]);
  this._ensureGuest(this.room);
  for(const [old,item] of this.uncertainActions)if(Date.now()-item.at>90000)this.uncertainActions.delete(old);
  const id=this.uncertainActions.get(key)?.id||'r'+(++this.requestNo)+'_'+randomHex(4);
  if(this.pending.has(id))return this.pending.get(id).promise;
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
 async hostAssign(room,uid,player,team){
  const d=this._getHostData(room),member=d.members?.[uid];
  if(!member||member.status==='removed')throw Error('Diese Beitrittsanfrage existiert nicht.');
  if(member.status==='pending'&&!canArrangeLobby(d.public))throw Error('Neue Teamaufnahmen sind nach Spielbeginn gesperrt.');
  let destination=team,addition=null;
  if(member.status==='pending'&&member.teamRequest?.kind==='create'&&!team){
   addition=addLobbyTeam(d.public.teams,member.teamRequest.name);
   destination=addition.id;
  }else if(!destination&&member.teamRequest?.kind==='join')destination=member.teamRequest.id;
  if(!destination||!d.public.teams?.[destination]&&!addition)throw Error('Bitte ein vorhandenes Team auswählen.');
  const next=approval(d.roster,uid,member,destination);if(!next.accepted)throw Error(next.reason);
  if(addition){d.public.teams=addition.teams;d.public.scores[addition.id]=0;}
  d.roster=next.roster;
  d.members[uid]={...member,team:destination,status:'approved',teamRequest:null,createdTeam:member.createdTeam===true||!!addition,ready:member.ready===true};
  this._changed();
 }
 async hostRemove(room,uid,player){const d=this._getHostData(room);d.members[uid]={...player,status:'removed',team:'',teamRequest:null,ready:false};delete d.roster[uid];delete d.presence[uid];this._changed();}
 async enterPresence(room){if(this.mode==='host'){this._assertHost(room);this.data.presence[this.uid]={connectedAt:Date.now()};this._changed();}else this._ensureGuest(room)}
 async buzzer(room,round,team,name){if(this.mode==='guest')return this._rpc('buzz',{round});throw Error('Buzzer nur für Teilnehmer.')}
 async answer(room,round,team,text){if(this.mode==='guest')return this._rpc('answer',{round,text});throw Error('Antworten nur für Teilnehmer.')}
 async message(room,team,name,text){if(this.mode==='guest')return this._rpc('message',{text});const d=this._getHostData(room);if(!d.public?.teams?.[team])throw Error('Unbekanntes Team.');const id='m_'+randomHex(9);d.messages[team]??={};d.messages[team][id]={uid:this.uid,name:'HOST',text:safeText(text,500),at:Date.now()};const keys=Object.keys(d.messages[team]);for(const key of keys.slice(0,-80))delete d.messages[team][key];this._changed()}
 async setState(room,changes){const d=this._getHostData(room);for(const [path,value]of Object.entries(changes))setPath(d.public,path,value);this._changed()}
 async openQuestion(room,expectedRound,question,playerQuestion,participants,deadline){const d=this._getHostData(room);const next=openQuestionState(d.public,{expectedRound,question,playerQuestion,participants,deadline});if(!next)throw Error('Die Frage wurde nicht geöffnet: Das Quizbrett oder die Runde hat sich geändert.');d.public=next;this._changed();return clone(next)}
 async updateCurrent(room,round,id,changes,phases=['question','paused','review']){const d=this._getHostData(room);const next=applyQuestionChanges(d.public,round,id,changes,phases);if(!next)throw Error('Die Runde hat sich geändert. Veraltete Aufdeckung verworfen.');d.public=next;this._changed();return clone(next)}
 async recordQuestion(room,round,entry){const d=this._getHostData(room);d.questionHistory[String(round)]=clone(entry);this._changed()}
 async replacePublic(room,state){const d=this._getHostData(room);d.public=clone(state);this._changed()}
 async chooseLobbyTeam(room,team){if(this.mode==='guest')return this._rpc('lobby-join',{team});throw Error('Teamwahl nur für Teilnehmer.')}
 async createLobbyTeam(room,name){if(this.mode==='guest')return this._rpc('lobby-create',{name});throw Error('Teamerstellung nur für Teilnehmer.')}
 async setLobbyReady(room,ready){if(this.mode==='guest')return this._rpc('lobby-ready',{ready});throw Error('Bereitschaft nur für Teilnehmer.')}
 async requestPick(room,qid,name){if(this.mode==='guest')return this._rpc('pick',{qid});throw Error('Nur Teilnehmer können Fragen wünschen.')}
 async clearPicks(room){const d=this._getHostData(room);d.picks={};this._changed()}
 async scorePerson(room,personId,action){const d=this._getHostData(room);if(!safeUid(personId)&&!/^(manual_[0-9]{1,2})$/.test(personId))throw Error('Ungültige Person-ID.');
  const before=clone(d.public);d.public.playerScores??={};
  const result=updatePlayerScore(d.public.playerScores[personId],action);d.public.playerScores[personId]=result;
  this._auditScore(d,before,{kind:'manual-person',person:personId,round:d.public.round});this._changed();return clone(result)}
 async score(room,team,delta){const d=this._getHostData(room);if(!d.public?.teams?.[team])throw Error('Team unbekannt.');
  if(!Number.isFinite(Number(delta))||!Number(delta)||Math.abs(Number(delta))>10000)throw Error('Ungültige Punkteänderung.');
  const before=clone(d.public);d.public.scores[team]=Math.max(-999999,Math.min(999999,(Number(d.public.scores?.[team])||0)+Number(delta)));
  this._auditScore(d,before,{kind:'manual-team',team,round:d.public.round});this._changed()}
 async judgeWritten(room,round,uid,result){const d=this._getHostData(room),p=d.public,before=clone(d.public);const key=String(round);if(String(p?.round)!==key||!['review','reveal'].includes(p?.phase)||p?.current?.roundMode!=='written'||!p?.answerReview?.entries?.[uid]?.revealed||!d.roster?.[uid]||!['correct','wrong'].includes(result))throw Error('Diese schriftliche Antwort ist nicht bewertbar.');const pts=Number(p.current.points),old=Number(p.playerScores?.[uid]?.rounds?.[key]?.delta)||0;const next=updatePlayerScore(p.playerScores?.[uid],{kind:'judgement',round:key,questionId:p.current.id,points:pts,result,at:Date.now()});p.playerScores={...(p.playerScores||{}),[uid]:next};if(p.scoreMode!=='individual'){const team=d.roster[uid].team;if(!p.teams?.[team])throw Error('Spielerteam nicht mehr vorhanden.');p.scores={...(p.scores||{}),[team]:(Number(p.scores?.[team])||0)+(Number(next.rounds[key].delta)||0)-old};}this._auditScore(d,before,{kind:'written-judgement',person:uid,team:p.scoreMode!=='individual'?d.roster[uid].team:'',round:key,questionId:p.current.id,verdict:result});this._changed();return clone(next)}
 async judgeBuzzer(room,round,uid,result,revealPatch=null){
  const d=this._getHostData(room),before=clone(this._getHostData(room).public);
  const next=applyBuzzerJudgement(d.public,d.buzzers,{round,uid,result});
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
   finalState=applyQuestionChanges(next.state,round,d.public.current.id,revealPatch,['question']);
   if(!finalState)throw Error('Lösung und Punkte konnten nicht gemeinsam übernommen werden.');
  }
  d.public=finalState;d.buzzers=next.buzzers;
  this._auditScore(d,before,{kind:'buzzer-judgement',team:d.public.scoreMode==='individual'?'':next.winner.team,
    person:d.public.scoreMode==='individual'?uid:'',actor:uid,round,questionId:d.public.current?.id||'',verdict:result});
  this._changed();
  return {delta:next.delta,winner:next.winner};
 }
 _auditScore(d,before,meta){const event=scoreEvent(before,d.public,{...meta,points:meta.verdict?before.current?.points:undefined,id:randomHex(8),at:Date.now()});if(event)d.scoreEvents=appendScoreEvent(d.scoreEvents,event);}
 hostScoreAudit(room){const d=this._getHostData(room);return clone((d.scoreEvents||[]).slice(-40));}
 async hostUndoScore(room,id){const d=this._getHostData(room);const done=undoScoreEvent(d.public,d.scoreEvents,id);d.public=done.state;d.scoreEvents=done.events;this._changed();return clone(done.event);}
 async hostRegradeScore(room,id){
  const d=this._getHostData(room),target=d.scoreEvents?.find(event=>event.id===id);
  const questionPoints=d.public.board?.[target?.questionId]?.points;
  const done=regradeScoreEvent(d.public,d.scoreEvents,id,{newId:randomHex(8),questionPoints});
  d.public=done.state;d.scoreEvents=done.events;this._changed();return clone(done.event);
 }
 async clearBuzzer(room,round){const d=this._getHostData(room);delete d.buzzers[String(round)];this._changed()}
 async removeResponse(room,round,uid){const d=this._getHostData(room);delete d.responses[String(round)]?.[uid];this._changed()}
 async clearRoomEvents(room){const d=this._getHostData(room);d.buzzers={};d.responses={};d.picks={};d.questionHistory={};d.scoreEvents=[];this._changed()}
 async deleteRoom(room){this._assertHost(room);for(const ctx of this.guestConnections.values()){try{ctx.conn.send({t:'shutdown'});ctx.conn.close()}catch{}}
  for(const ctx of this.projectorConnections){try{ctx.conn.send({t:'closed'});}catch{}}
  this.data=null;this.shutdown();await (this.checkpointWrites||Promise.resolve()).catch(()=>null);
  try{localStorage.removeItem('bq-p2p-session-'+room)}catch{}
  await deleteHostCheckpoint('session-'+room).catch(()=>null);
 }
 shutdown(){
  this.quitting=true;
  for(const timer of [this.reconnectTimer,this.hostReconnectTimer,this.snapshotTimer])clearTimeout(timer);
  this.reconnectTimer=this.hostReconnectTimer=this.snapshotTimer=null;
  for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Verbindung geschlossen.'));}
  this.pending.clear();this.uncertainActions.clear();
  try{this.conn?.close();}catch{}try{this.peer?.destroy();}catch{}
  this.conn=this.peer=null;
  this.connected=false;this.mode='idle';this.guestConnections.clear();this.projectorConnections.clear();this.projectorFrame=null;this._emit();
 }
}
