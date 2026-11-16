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

const HOST_PREFIX='brainquiz27-';
const UID_RE=/^[a-zA-Z0-9_-]{8,100}$/;
const safeUid=id=>UID_RE.test(id||'')&&!['__proto__','constructor','prototype'].includes(id);
const TOKEN_RE=/^[a-f0-9]{32,128}$/;
const MAX_WAITING=24, MAX_MESSAGE_BYTES=18000;
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
 constructor(){this.mode='idle';this.uid='';this.secret='';this.room='';this.peer=null;this.conn=null;this.connected=false;this.offset=0;this.data=null;this.guestData={};this.guestConnections=new Map();this.memberSecrets={};this.listeners=[];this.hostQuiz=null;this.pending=new Map();this.requestNo=0;this.reconnectTimer=null;this.snapshotTimer=null;this.quitting=false;this.netError='';}
 async init(){return this;}
 serverNow(){return Date.now()+this.offset;}
 _emit(){for(const entry of [...this.listeners]){try{entry.cb(this._read(entry.path))}catch(error){console.error('[BrainQuiz Peer watcher]',error)}}}
 _read(path){if(path==='.info/connected')return this.connected;if(path==='.info/serverTimeOffset')return this.offset;const prefix='rooms/'+this.room;if(!path.startsWith(prefix+'/'))return null;return clone(pathValue(this.mode==='host'?this.data:this.guestData,path.slice(prefix.length+1)))??null;}
 watch(path,cb){const entry={path,cb};this.listeners.push(entry);queueMicrotask(()=>{if(this.listeners.includes(entry))cb(this._read(path))});return ()=>{this.listeners=this.listeners.filter(e=>e!==entry)};}
 watchRoom(room,path,cb){if(room!==this.room)throw Error('Falscher Raum.');return this.watch('rooms/'+room+'/'+path,cb)}
 clearWatchers(){this.listeners=[];}
 async _preparePeer(){const Peer=await loadPeerJS();return Peer;}
 _listenHostPeer(peer){
  peer.on('connection',conn=>{
   if(this.mode!=='host'||this.quitting){try{conn.close()}catch{}return}
   const ctx={conn,uid:null,ready:false,lastChat:0};
   conn.on('data',msg=>this._receiveFromGuest(ctx,msg));
   conn.on('close',()=>this._disconnectGuest(ctx));
   conn.on('error',()=>this._disconnectGuest(ctx));
  });
  peer.on('disconnected',()=>{if(!this.quitting){this.connected=false;this._emit();try{peer.reconnect()}catch{}}});
  peer.on('open',()=>{this.connected=true;this.netError='';this._emit()});
  peer.on('error',error=>{this.netError=peerError(error);if(error?.type==='network'||error?.type==='server-error'){this.connected=false;this._emit()}});
 }
 async _openHostPeer(room){
  const Peer=await this._preparePeer();const peer=new Peer(peerId(room),{debug:0});this.peer=peer;this.quitting=false;
  await new Promise((resolve,reject)=>{let done=false;const timer=setTimeout(()=>{if(!done){done=true;reject(Error('PeerJS konnte den Host-Raum nicht anmelden.'))}},16000);
   peer.on('open',()=>{if(!done){done=true;clearTimeout(timer);resolve()}});
   peer.on('error',error=>{if(!done){done=true;clearTimeout(timer);reject(Error(peerError(error)))}})
  }).catch(err=>{try{peer.destroy()}catch{}throw err});
  this.mode='host';this.room=room;this.connected=true;this._listenHostPeer(peer);this._emit();
 }
 _persist(){if(this.mode!=='host'||!this.data)return;
  // Only the host browser receives this backup. Complete quiz media remain in bq-quiz-<room>.
  try{localStorage.setItem('bq-p2p-session-'+this.room,JSON.stringify({uid:this.uid,data:this.data,secrets:this.memberSecrets,savedAt:Date.now()}));}
  catch{this.netError='Lokaler Spielstand konnte nicht gesichert werden. Host-Quiz als Datei exportieren.';}
 }
 _changed(){this._persist();this._emit();if(!this.snapshotTimer)this.snapshotTimer=setTimeout(()=>{this.snapshotTimer=null;for(const ctx of this.guestConnections.values())this._sendSnapshot(ctx)},25)}
 async create(room,quiz,options={}){if(this.mode!=='idle')this.shutdown();if(!/^[A-HJ-NP-Z2-9]{16}$/.test(room))throw Error('Ungültiger Raumcode.');
  this.uid='h_'+randomHex(12);this.hostQuiz=clone(quiz);this.data=roomData(this.uid,quiz,options);this.memberSecrets={};
  await this._openHostPeer(room);this._persist();return room;
 }
 async resumeHost(room){if(this.mode!=='idle')this.shutdown();let previous=null;
  try{previous=JSON.parse(localStorage.getItem('bq-p2p-session-'+room)||'null')}catch{}
  if(!previous||!previous.data||!safeUid(previous.uid)||previous.data.owner!==previous.uid)throw Error('Kein Host-Spielstand in diesem Browser vorhanden.');
  this.uid=previous.uid;this.data=previous.data;this.memberSecrets=previous.secrets||{};
  try{const q=JSON.parse(localStorage.getItem('bq-quiz-'+room)||'null');this.hostQuiz=q?.questions?q:null}catch{this.hostQuiz=null}
  this.data.presence={};await this._openHostPeer(room);this._persist();return room;
 }
 async saveHostQuiz(room,quiz){this._assertHost(room);if(!quiz||!Array.isArray(quiz.questions)||quiz.questions.length>180)throw Error('Ungültiges Host-Quiz.');
  if(new TextEncoder().encode(JSON.stringify(quiz)).length>8_000_000)throw Error('Host-Quiz überschreitet 8 MB. Medien verkleinern.');
  this.hostQuiz=clone(quiz);try{localStorage.setItem('bq-quiz-'+room,JSON.stringify(quiz))}catch{throw Error('Lokaler Host-Speicher voll. Host-Quiz bitte als Datei exportieren.')}
 }
 async getHostQuiz(room){this._assertHost(room);if(this.hostQuiz)return clone(this.hostQuiz);try{return JSON.parse(localStorage.getItem('bq-quiz-'+room)||'null')}catch{return null}}
 _assertHost(room){if(this.mode!=='host'||this.room!==room||!this.data)throw Error('Nur der Host darf diese Aktion ausführen.');}
 _ensureGuest(room){if(this.mode!=='guest'||this.room!==room||!this.conn?.open||!this.connected)throw Error('Verbindung zum Host unterbrochen.');}
 async connect(room,name=''){if(!/^[A-HJ-NP-Z2-9]{16}$/.test(room))throw Error('Ungültiger Raumcode.');if(this.mode!=='idle')this.shutdown();this.mode='guest';this.room=room;
  const ident=guestIdentity(room);this.uid=ident.uid;this.secret=ident.secret;this.guestName=safeText(name,28)||this.guestName||'Spieler';
  await this._connectGuestOnce();return this.guestData.members?.[this.uid]||null;
 }
 async _connectGuestOnce(){
  const Peer=await this._preparePeer();this.quitting=false;
  const peer=new Peer(undefined,{debug:0});this.peer=peer;
  await new Promise((resolve,reject)=>{
   let done=false,accepted=false,conn=null;const timer=setTimeout(()=>finish(Error('Host nicht erreichbar. Einladung und Internetverbindung prüfen.')),18000);
   const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(error){try{peer.destroy()}catch{}reject(error)}else resolve()};
   peer.on('open',()=>{conn=peer.connect(peerId(this.room),{reliable:true,serialization:'json'});this.conn=conn;
    conn.on('open',()=>conn.send({t:'hello',uid:this.uid,secret:this.secret,name:this.guestName,room:this.room}));
    conn.on('data',msg=>{
     if(msg?.t==='welcome'){if(this.peer!==peer||this.conn!==conn)return;accepted=true;this._applySnapshot(msg.state);this.connected=true;this.netError='';finish();this._emit();}
     else if(msg?.t==='denied')finish(Error(msg.reason||'Beitritt abgelehnt.'));
     else if(this.peer===peer&&this.conn===conn)this._receiveFromHost(msg);
    });
    conn.on('close',()=>{if(!done)finish(Error('Hostverbindung abgebrochen.'));else if(accepted&&this.peer===peer&&this.conn===conn)this._guestLost()});
    conn.on('error',()=>{if(!done)finish(Error('WebRTC-Datenkanal fehlgeschlagen.'));else if(accepted&&this.peer===peer&&this.conn===conn)this._guestLost()});
   });
   peer.on('error',err=>{if(!done)finish(Error(peerError(err)));else if(accepted&&this.peer===peer&&err?.type==='network')this._guestLost()});
   peer.on('disconnected',()=>{if(!this.quitting&&this.peer===peer)try{peer.reconnect()}catch{}});
  });
 }
 _guestLost(){if(this.quitting||this.mode!=='guest')return;this.connected=false;this.netError='Hostverbindung unterbrochen. Wiederverbindung läuft …';for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(Error('Hostverbindung unterbrochen.'))}this.pending.clear();this._emit();
  if(!this.reconnectTimer)this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null;try{this.peer?.destroy()}catch{}this._connectGuestOnce().catch(()=>{if(!this.quitting)this._guestLost()})},3500);
 }
 _applySnapshot(payload){if(!payload||typeof payload!=='object')return;this.guestData={
  public:payload.public||null,lobby:payload.lobby||null,roster:payload.roster||{},presence:payload.presence||{},buzzers:payload.buzzers||{},
  members:payload.member?{[this.uid]:payload.member}:{},responses:payload.ownResponse?{[String(payload.public?.round||0)]:{[this.uid]:payload.ownResponse}}:{},
  messages:payload.messages||{}
 };this._emit();}
 _receiveFromHost(msg){if(!msg||typeof msg!=='object')return;
  if(msg.t==='snapshot'){this._applySnapshot(msg.state)}
  if(msg.t==='ack'){const p=this.pending.get(msg.id);if(!p)return;this.pending.delete(msg.id);clearTimeout(p.timer);msg.ok?p.resolve(msg.result):p.reject(Error(msg.error||'Aktion nicht erlaubt.'))}
  if(msg.t==='shutdown'){this.netError='Der Host hat den Raum geschlossen.';this.quitting=true;this.connected=false;this._emit()}
 }
 _snapshotFor(ctx){const member=this.data.members?.[ctx.uid]||null,approved=member?.status==='approved',publicState=approved?this.data.public:null;
  const round=String(this.data.public?.round||0),ownResponse=approved?this.data.responses?.[round]?.[ctx.uid]||null:null;
  const msgs=approved&&member.team?{[member.team]:this.data.messages?.[member.team]||{}}:{};
  return {member:clone(member),lobby:lobbySnapshot(this.data),public:clone(publicState),roster:approved?clone(this.data.roster):{},presence:approved?clone(this.data.presence):{},buzzers:approved?clone(this.data.buzzers):{},ownResponse:clone(ownResponse),messages:clone(msgs)};
 }
 _sendSnapshot(ctx){if(!ctx?.ready||!ctx.conn?.open)return;try{ctx.conn.send({t:'snapshot',state:this._snapshotFor(ctx)})}catch(error){console.warn('[BrainQuiz] Snapshot nicht übertragbar:',error)}}
 _disconnectGuest(ctx){if(!ctx.ready||!this.data||this.mode!=='host')return;const current=this.guestConnections.get(ctx.uid);if(current!==ctx)return;this.guestConnections.delete(ctx.uid);delete this.data.presence[ctx.uid];this._changed()}
 _receiveFromGuest(ctx,msg){if(!msg||typeof msg!=='object'||Array.isArray(msg))return;
  try{if(JSON.stringify(msg).length>MAX_MESSAGE_BYTES){ctx.conn.close();return}}catch{return}
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
   ctx.conn.send({t:'welcome',state:this._snapshotFor(ctx)});this._changed();return;
  }
  if(ctx.ready&&msg.t==='action'&&typeof msg.id==='string'&&msg.id.length<=90){
   if(this.guestConnections.get(ctx.uid)!==ctx)return; // A replaced/reconnected data channel cannot issue actions.
   let ok=true,result=null,error='';try{result=this._handleGuestAction(ctx,msg.action,msg.payload||{})}catch(e){ok=false;error=String(e?.message||'Aktion nicht erlaubt.').slice(0,200)}
   try{ctx.conn.send({t:'ack',id:msg.id,ok,result,error})}catch{};
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
   this._changed();
   return true;
  }
  if(member?.status!=='approved'||this.data.roster?.[ctx.uid]?.team!==member.team)throw Error('Hostfreigabe erforderlich.');
  switch(action){
   case 'pick':{const qid=safeText(payload.qid,80);if(!Object.hasOwn(pub?.board||{},qid)||pub.board[qid].used||pub.phase!=='board')throw Error('Frage nicht mehr verfügbar.');this.data.picks[ctx.uid]={uid:ctx.uid,qid,name:member.name,at:now};this._changed();return true}
   case 'buzz':{if(this.data.buzzers[round])return false;if(round!==String(payload.round)||!canBuzz(pub,this.data.buzzers,ctx.uid,member.team,now))throw Error('Buzzer ist belegt oder du bist für diese Runde gesperrt.');this.data.buzzers[round]={uid:ctx.uid,team:member.team,name:member.name,at:now};this._changed();return true}
   case 'answer':{if(pub?.phase!=='question'||String(payload.round)!==round||(pub.deadline&&now>pub.deadline))throw Error('Frage ist nicht offen.');const written=roundMode(pub.current)==='written',map=pub.current?.type==='map';if(!written&&!map)throw Error('Diese Frage wird mündlich beantwortet.');if(written&&!pub.answerParticipants?.[ctx.uid])throw Error('Nicht für diese Schreib-Runde freigegeben.');const b=this.data.buzzers[round];if(map&&!written&&(!b||b.uid!==ctx.uid))throw Error('Nur die Person am Buzzer darf den Kartenpunkt setzen.');const text=safeText(payload.text,800);if(!text)throw Error('Antwort darf nicht leer sein.');if(map&&!decodePoint(text))throw Error('Kartenpunkt liegt außerhalb der Weltkarte.');this.data.responses[round]??={};if(this.data.responses[round][ctx.uid]&&!map)throw Error('Antwort bereits abgegeben.');const original=this.data.responses[round][ctx.uid];this.data.responses[round][ctx.uid]={uid:ctx.uid,team:member.team,text,at:original?.at||now,updatedAt:now};this._changed();return true}
   case 'message':{if(!pub?.settings?.chatOpen)throw Error('Teamchat geschlossen.');const text=safeText(payload.text,500);if(!text||now-ctx.lastChat<1000)throw Error('Nachrichtenrate begrenzt.');ctx.lastChat=now;this.data.messages[member.team]??={};const messages=this.data.messages[member.team];messages['m_'+randomHex(9)]={uid:ctx.uid,name:member.name,text,at:now};const keys=Object.keys(messages);for(const key of keys.slice(0,-80))delete messages[key];this._changed();return true}
   default:throw Error('Aktion nicht erlaubt.');
  }
 }
 _rpc(action,payload={}){this._ensureGuest(this.room);const id='r'+(++this.requestNo)+'_'+randomHex(4);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Antwort des Hosts ausgeblieben.'))},9000);this.pending.set(id,{timer,resolve,reject});try{this.conn.send({t:'action',id,action,payload})}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e)}})}
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
 async scorePerson(room,personId,action){const d=this._getHostData(room);if(!safeUid(personId)&&!/^(manual_[0-9]{1,2})$/.test(personId))throw Error('Ungültige Person-ID.');d.public.playerScores??={};const result=updatePlayerScore(d.public.playerScores[personId],action);d.public.playerScores[personId]=result;this._changed();return clone(result)}
 async score(room,team,delta){const d=this._getHostData(room);if(!d.public?.teams?.[team])throw Error('Team unbekannt.');d.public.scores[team]=Math.max(-999999,Math.min(999999,(Number(d.public.scores?.[team])||0)+Number(delta)));this._changed()}
 async judgeWritten(room,round,uid,result){const d=this._getHostData(room),p=d.public;const key=String(round);if(String(p?.round)!==key||!['review','reveal'].includes(p?.phase)||p?.current?.roundMode!=='written'||!p?.answerReview?.entries?.[uid]?.revealed||!d.roster?.[uid]||!['correct','wrong'].includes(result))throw Error('Diese schriftliche Antwort ist nicht bewertbar.');const pts=Number(p.current.points),old=Number(p.playerScores?.[uid]?.rounds?.[key]?.delta)||0;const next=updatePlayerScore(p.playerScores?.[uid],{kind:'judgement',round:key,questionId:p.current.id,points:pts,result,at:Date.now()});p.playerScores={...(p.playerScores||{}),[uid]:next};if(p.scoreMode!=='individual'){const team=d.roster[uid].team;if(!p.teams?.[team])throw Error('Spielerteam nicht mehr vorhanden.');p.scores={...(p.scores||{}),[team]:(Number(p.scores?.[team])||0)+(Number(next.rounds[key].delta)||0)-old};}this._changed();return clone(next)}
 async judgeBuzzer(room,round,uid,result){const d=this._getHostData(room);const next=applyBuzzerJudgement(d.public,d.buzzers,{round,uid,result});d.public=next.state;d.buzzers=next.buzzers;this._changed();return {delta:next.delta,winner:next.winner};}
 async clearBuzzer(room,round){const d=this._getHostData(room);delete d.buzzers[String(round)];this._changed()}
 async removeResponse(room,round,uid){const d=this._getHostData(room);delete d.responses[String(round)]?.[uid];this._changed()}
 async clearRoomEvents(room){const d=this._getHostData(room);d.buzzers={};d.responses={};d.picks={};d.questionHistory={};this._changed()}
 async deleteRoom(room){this._assertHost(room);for(const ctx of this.guestConnections.values()){try{ctx.conn.send({t:'shutdown'});ctx.conn.close()}catch{}}this.data=null;this.shutdown();try{localStorage.removeItem('bq-p2p-session-'+room)}catch{}}
 shutdown(){this.quitting=true;clearTimeout(this.reconnectTimer);clearTimeout(this.snapshotTimer);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Verbindung geschlossen.'))}this.pending.clear();try{this.conn?.close()}catch{};try{this.peer?.destroy()}catch{};this.connected=false;this.mode='idle';this.guestConnections.clear();this._emit()}
}
