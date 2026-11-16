import {canBuzz,roundMode,scoreMode} from './round-rules.mjs';
import {boardList,createBoard,loadBoard,persistBoard,resumeBoard,selectBoard} from './board-workspace.mjs';
import {normalizePoint,encodePoint,decodePoint,DEFAULT_MAP_VIEW} from './map-tools.mjs';
import {mountMapViewport} from './map-viewport.mjs';
import {createStudioEditor} from './studio-editor.mjs';
import {quizAudit,createActionLease} from './editor-workflows.mjs';
import {collectCategories,categoryKey,cleanCategoryName} from './category-model.mjs';
import {openQuestionState,validQuestionPair,questionMotion} from './question-flow.mjs';
import {startMapDaggerThrow,THROW_ACTORS} from './map-dagger-animation.mjs';
import {MAX_PLAYERS,approvedCount,freeSlots,lobbySnapshot,teamColor,canArrangeLobby} from './lobby-model.mjs';
import {lobbyGuestHTML,hostLobbySummary} from './lobby-view.mjs';
import {createHistoryEntry,historyRows,responseStatus,historyCsv} from './history-model.mjs';
import {participantSnapshot,answerProgress,makeAnswerReview,revealAnswer,reviewIsCurrent,answerCardState} from './answer-review.mjs';
import {renderScene,ensureScene,templateScene,reconcileQuestion,sceneHasStep,publicScene,escape as sceneEscape} from './studio-model.mjs';
import {BLOCK_TYPES,newBlock,blockId,normalizeBlocks,normalizeBlock,renderBlocks,validateBlocks} from './layout.mjs';
import {sceneForPublicState,isBoardCellPlayed,pageBoardColumns,VERSION,MODES,ABILITIES,TEAM_COLORS,escapeHTML as e,roomCode,uid,emptyQuiz,normalizedQuiz,buildPublicBoard,buildTeams,buildScores,publicQuestion,splashPreview,optimizeImage,safeDownload,validateQuestion,isImageData,shuffledItems,splashStageZoom,rankEstimates,optimizeAudio,quickBoard,categoryColumns,STANDARD_POINTS,DEFAULT_CATEGORIES,judgementDelta,updatePlayerScore,manualPlayerLabels} from './core.mjs';
const $=id=>document.getElementById(id),configured=true; // PeerJS/WebRTC requires no Firebase setup.
const hostActionLease=createActionLease();
let service=null,game=null,room='',role='landing',view='start',member=null,guestLobby=null,publicState=null,members={},roster={},presence={},buzzers={},responses={},messages={},myResponse=null,quiz=emptyQuiz(),selected='',chatTeam='ALL',connected=false,guestListeners=[],guestTeam='',responseUnsub=null,watchingRound=-1,renderQueued=false,lastMsgTime=0,loadedSession=false,pickedOrder=[],previewOpen=false,previewRevealed=false,previewSceneStep=0,previewImage='',editingBlock='',editorSearch='',undoStack=[],redoStack=[],lastEditAt=0,saveState='Gespeichert',settingsExpanded=false,inspectorExpanded=false,quizMetaExpanded=false,scoreTarget='',picks={},offlineRound=0,quickSetExpanded=false,reviewStartPending=-1,questionHistory={},historyFilter='',guestChoice='',reviewPointsOpen=false,openingQuestion=false,lastAnimatedQuestion='',mapPick=null;
let cloudTimer=null,cloudInFlight=false,cloudDirty=false,hostCloudReady=false,cloudWriteTail=Promise.resolve();
let boardId='',boardRevision=0,boardConflict=false;
let mapCamera={...DEFAULT_MAP_VIEW},mapCameraQuestion='';
const consumedMapThrows=new Set();let activeMapThrow=null;
let activeQuestionCover=null;
const makeBoardId=()=>'b'+uid().slice(1);
function applyBoardWorkspace(record){boardConflict=false;saveState='Lokal gesichert';boardId=record.id;boardRevision=record.revision;quiz=normalizedQuiz(record.quiz);selected=quiz.questions[0]?.id||'';undoStack=[];redoStack=[];editingBlock='';previewOpen=false;previewRevealed=false;mapPick=null;mapCamera={...DEFAULT_MAP_VIEW};mapCameraQuestion='';pickedOrder=[];boardPage=0;scorePage=0;historyFilter='';try{sessionStorage.setItem('bq-board-current-tab',boardId);}catch{}studio?.reset?.();}
function openStoredBoard(id){if(!isOffline())throw Error('Bitte zuerst den lokalen Editor öffnen. Der laufende Live-Raum bleibt unverändert.');studio.flush?.();if(!saveLocal())throw Error('Aktuelles Quizbrett konnte nicht gesichert werden.');const record=selectBoard(localStorage,id);applyBoardWorkspace(record);loadOfflineBoardState();schedule();notice('Quizbrett „'+quiz.title+'“ geöffnet.');}
function rescueStoredBoard(){if(!isOffline()||!boardId)throw Error('Nur im lokalen Quizbrett verfügbar.');studio.flush?.();const created=createBoard(localStorage,normalizedQuiz(quiz),makeBoardId);applyBoardWorkspace(created);loadOfflineBoardState();schedule();notice('Änderungen als eigenes Quizbrett gerettet. Das ursprüngliche bleibt unverändert.');}
function reloadStoredBoard(){if(!isOffline()||!boardId)throw Error('Nur im lokalen Quizbrett verfügbar.');if(!confirm('Die derzeit ungesicherten Änderungen an diesem Quizbrett verwerfen und den zuletzt gespeicherten Stand öffnen?'))return;const record=selectBoard(localStorage,boardId);applyBoardWorkspace(record);loadOfflineBoardState();schedule();notice('Zuletzt gespeicherte Brettversion geladen.');}
function loadOfflineBoardState(){const session=loadOfflineSession();questionHistory=session.questionHistory||{};publicState={title:quiz.title,scoreMode:quiz.scoreMode||'team',phase:'board',round:session.round||0,board:buildPublicBoard(quiz,session.used),teams:buildTeams(quiz),scores:buildScores(quiz),settings:{buzzerEnabled:true,chatOpen:false,lockOnBuzz:false,timerSeconds:60},manualPlayers:manualPlayerLabels(quiz),playerScores:session.playerScores||{},used:session.used||{},buzzerBlocked:session.buzzerBlocked||{}};}
const pendingTeamChoices=new Map(); // Keep pending team assignments across live re-renders.
let boardPage=0,scorePage=0; // Purely local pagination; never changes host authority.
function serializedCloudWrite(targetRoom,snapshot){
 // A slow autosave must never overwrite a newer published quiz.
 const commit=cloudWriteTail.catch(()=>{}).then(()=>game.saveHostQuiz(targetRoom,snapshot));
 cloudWriteTail=commit.catch(()=>{});
 return commit;
}
function queueHostCloudSave(){
 if(!hostCloudReady||!game||role!=='host'||isOffline()||typeof game.saveHostQuiz!=='function')return;
 cloudDirty=true;clearTimeout(cloudTimer);cloudTimer=setTimeout(()=>void flushHostCloudSave(),1200);
}
async function flushHostCloudSave(){
 clearTimeout(cloudTimer);cloudTimer=null;let failed=false;
 if(!cloudDirty||cloudInFlight||!hostCloudReady||!game||role!=='host'||isOffline())return;
 cloudInFlight=true;cloudDirty=false;const currentRoom=room;const snapshot=normalizedQuiz(quiz);
 try{await serializedCloudWrite(currentRoom,snapshot);if(room===currentRoom)saveState='Im Host-Browser gesichert';}
 catch(err){failed=true;cloudDirty=true;saveState='Lokaler Speicherfehler – Quiz exportieren';error(err);}
 finally{cloudInFlight=false;if(cloudDirty&&!failed&&room===currentRoom&&!cloudTimer)cloudTimer=setTimeout(()=>void flushHostCloudSave(),1500);}
}
async function restoreHostQuiz(){
 hostCloudReady=false;cloudDirty=false;clearTimeout(cloudTimer);cloudTimer=null;
 // Only the host keeps complete questions and solutions; never send to any guest.
 const saved=await game.getHostQuiz(room);
 if(saved){quiz=normalizedQuiz(saved);selected=quiz.questions[0]?.id||'';saveLocal();}
 else{loadLocal();await game.saveHostQuiz(room,normalizedQuiz(quiz));}
 hostCloudReady=true;
}
const roomFromLink=(new URLSearchParams(location.search).get('room')||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,16);
const canHost=()=>role==='host';
// A published live quiz is a committed game, not an editable draft. This flag
// lives in the authoritative shared room state and survives host reconnection.
const isPublished=()=>!isOffline()&&(publicState?.published===true||(()=>{try{return localStorage.getItem('bq-published-'+room)==='1'}catch{return false}})());
const editorOnlyActions=new Set(['quick-add','quick-replace','quickset','new-q','clone-q','delete-q','move-up','move-down','new-board','open-board','new-stored-board','add-block','block-delete','block-clone','block-up','block-down','clone-layout','undo-layout','redo-layout','import','publish','preview-q','preview-reveal']);const activeQuestion=()=>publicState?.current;const roundKey=()=>String(publicState?.round??0);const isOpen=()=>publicState?.phase==='question';const winner=()=>buzzers?.[roundKey()]||null;const teamName=t=>publicState?.teams?.[t]||t||'–';const now=()=>game?game.serverNow():Date.now();const buzzLocks=()=>publicState?.buzzerBlocked?.[roundKey()]||{};const isBuzzLocked=id=>!!(id&&(buzzLocks()?.[id]||(scoreMode(publicState)==='team'&&publicState?.buzzerBlockedTeams?.[roundKey()]?.[member?.team])));const viewerStateLabel=()=>publicState?.phase==='board'?'Quizbrett sichtbar':publicState?.phase==='review'?'Antwortübersicht sichtbar':publicState?.phase==='reveal'?'Lösung sichtbar':publicState?.phase==='paused'?'Frage pausiert':hasLiveQuestion()?'Frage geöffnet':'Warten';
function notice(text){const el=$('toaster');if(!el)return;el.textContent=text;el.classList.add('show');clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.classList.remove('show'),4400);}
function error(err){const message=String(err?.message||err||'Unbekannter Fehler');console.error('[BrainQuiz]',err);notice(message.slice(0,230));}
function preserveForm(draw){
 const focused=document.activeElement,id=focused?.id,value=focused?.value,selection=(()=>{try{return [focused.selectionStart,focused.selectionEnd]}catch{return null}})();
 const previousScene=document.querySelector('#app .bq-session-scene')?.dataset.scene||'';
 const expanded=[...document.querySelectorAll('#app details[data-bq-persist][open]')].map(el=>el.dataset.bqPersist);
 const saved=[...document.querySelectorAll('.questionlist,.studio-list,.studio-tools,.workspace,.chatfeed,.bq-scene-content,.bq-guest-compose,.bq-answers-panel .answer-review')].map((el,i)=>({selector:el.id?'#'+CSS.escape(el.id):'.'+[...el.classList].find(c=>['questionlist','studio-list','studio-tools','workspace','chatfeed','bq-scene-content','bq-guest-compose','answer-review'].includes(c)),top:el.scrollTop,left:el.scrollLeft,index:i,nearBottom:el.classList.contains('chatfeed')&&el.scrollHeight-el.scrollTop-el.clientHeight<60}));
 draw();
 const nextScene=document.querySelector('#app .bq-session-scene')?.dataset.scene||'';
 if(previousScene===nextScene){for(const key of expanded){const item=[...document.querySelectorAll('#app details[data-bq-persist]')].find(x=>x.dataset.bqPersist===key);if(item)item.open=true;}}
 const next=id?document.getElementById(id):null;
 if(next&&['INPUT','TEXTAREA','SELECT'].includes(next.tagName)&&next.type!=='file'){
  if(value!==undefined)next.value=value;
  next.focus({preventScroll:true});try{if(selection&&selection[0]!==null)next.setSelectionRange(selection[0],selection[1])}catch{}
 }
 for(const item of saved){if(!item.selector)continue;const el=document.querySelector(item.selector);if(el){el.scrollTop=item.nearBottom?el.scrollHeight: item.top;el.scrollLeft=item.left;}}
}
function schedule(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;preserveForm(render);updateClock()});}
function btn(label,action,cls='',attrs=''){return `<button type="button" class="btn ${cls}" data-action="${action}" ${attrs}>${label}</button>`;}
function hasValidRoom(value){return /^[A-HJ-NP-Z2-9]{16}$/.test(value);}
async function initialize(){if(game)return game;const module=await import('./peer-client.mjs');game=new module.PeerGame();await game.init();return game;}
function saveLocal(){try{if(isOffline()){if(!boardId)throw Error('Kein Quizbrett geöffnet.');if(boardConflict)throw Error('Ein anderer Tab hat dieses Brett verändert. Bitte Änderungen als Kopie sichern oder gespeicherte Version laden.');boardRevision=persistBoard(localStorage,boardId,boardRevision,normalizedQuiz(quiz));}else{localStorage.setItem('bq-quiz-'+room,JSON.stringify(quiz));queueHostCloudSave();}saveState=isOffline()?'Lokal gesichert':'Im Host-Browser gesichert';return true}catch(err){const message=String(err?.message||'Quizbrett konnte nicht gespeichert werden.');if(/anderen Tab|anderer Tab/.test(message))boardConflict=true;saveState=boardConflict?'KONFLIKT – als Kopie sichern!':'SPEICHERFEHLER – Backup exportieren!';notice(message.slice(0,220));return false;}}
function loadLocal(){try{const val=localStorage.getItem('bq-quiz-'+room);quiz=val?normalizedQuiz(JSON.parse(val)):emptyQuiz()}catch{quiz=emptyQuiz()}selected=quiz.questions[0]?.id||''}
async function promoteOnline(){if(!isOffline())return;await initialize();const source=normalizedQuiz(quiz);const code=roomCode();await game.create(code,source);await game.saveHostQuiz(code,source);room=code;quiz=source;hostCloudReady=true;saveLocal();localStorage.setItem('bq-last-host',room);history.replaceState(null,'',location.pathname+'?room='+room);view='editor';listenRoom();notice('PeerJS-Raum erstellt. Das Hostfenster während des Spielens geöffnet lassen.');}
function backupFilename(prefix='BrainQuiz_Host'){
 const title=String(quiz?.title||'Quizbrett').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,48)||'Quizbrett';
 const location=isOffline()?boardId.slice(1,8):room;
 return prefix+'_'+title+'_'+(location||'LOKAL')+'.brainquiz.json';
}
function saveOfflineSession(){if(!isOffline()||!publicState||!boardId)return;try{localStorage.setItem('bq-session-LOCAL-'+boardId,JSON.stringify({used:publicState.used||{},playerScores:publicState.playerScores||{},round:publicState.round||0,questionHistory,buzzerBlocked:publicState.buzzerBlocked||{}}));}catch{notice('Spielstand konnte nicht gespeichert werden. Bitte Speicherplatz prüfen.');}}
function loadOfflineSession(){try{const raw=JSON.parse(localStorage.getItem('bq-session-LOCAL-'+boardId)||'{}');if(!raw||typeof raw!=='object')return {};const valid=new Set(quiz.questions.map(q=>q.id));const used=Object.fromEntries(Object.entries(raw.used||{}).filter(([id,v])=>valid.has(id)&&v===true));return {used,playerScores:raw.playerScores&&typeof raw.playerScores==='object'?raw.playerScores:{},questionHistory:raw.questionHistory&&typeof raw.questionHistory==='object'?raw.questionHistory:{},buzzerBlocked:raw.buzzerBlocked&&typeof raw.buzzerBlocked==='object'?raw.buzzerBlocked:{},round:Math.max(0,Math.min(999999,Number(raw.round)||0))};}catch{return {};}}
function startOffline(explicitBoardId=''){if(explicitBoardId&&!boardList(localStorage).some(b=>b.id===explicitBoardId))throw Error('Das ausgewählte Quizbrett wurde nicht gefunden. Es wurde kein anderes geöffnet.');let preferred=explicitBoardId;try{if(!preferred)preferred=sessionStorage.getItem('bq-board-current-tab')||'';}catch{}const record=resumeBoard(localStorage,emptyQuiz,makeBoardId,preferred);if(explicitBoardId)selectBoard(localStorage,record.id);room='LOCAL';role='host';view='editor';applyBoardWorkspace(record);loadOfflineBoardState();history.replaceState(null,'',location.pathname);notice('Quizbrett „'+quiz.title+'“ geöffnet.');schedule();}
function isOffline(){return room==='LOCAL';}
function newStoredBoard(){if(!isOffline())throw Error('Ein neues lokales Brett lässt sich nur im lokalen Editor anlegen.');studio.flush?.();if(!saveLocal())throw Error('Das aktuelle Quizbrett konnte nicht gespeichert werden.');const title=prompt('Name des neuen Quizbretts (maximal 100 Zeichen):','Neues Quizbrett')?.trim().slice(0,100);if(!title)return;const next={...emptyQuiz(),title};const created=createBoard(localStorage,next,makeBoardId);applyBoardWorkspace(created);loadOfflineBoardState();schedule();notice('Neues Quizbrett „'+title+'“ angelegt. Das vorherige bleibt erhalten.');}
function snapshotLayout(){const state=JSON.stringify(quiz);undoStack.push(state);let bytes=undoStack.reduce((n,x)=>n+x.length,0);while(undoStack.length>1&&(undoStack.length>35||bytes>12_000_000)){bytes-=undoStack.shift().length;}redoStack=[];}
function undoLayout(direction){const src=direction==='undo'?undoStack:redoStack,dst=direction==='undo'?redoStack:undoStack;if(!src.length)return;dst.push(JSON.stringify(quiz));quiz=normalizedQuiz(JSON.parse(src.pop()));if(!quiz.questions.some(q=>q.id===selected))selected=quiz.questions[0]?.id||'';editingBlock='';saveLocal();schedule();}
function chosenBlock(){return currentQuestion()?.blocks?.find(b=>b.id===editingBlock)||null;}
function blockPropertyUpdate(target){const b=chosenBlock();if(!b||!target.dataset.blockfield)return;const key=target.dataset.blockfield;const editable=['text','alt','caption','width','align','color','size','height','shape','revealOnly'];if(!editable.includes(key))return;if(Date.now()-lastEditAt>650)snapshotLayout();lastEditAt=Date.now();b[key]=key==='revealOnly'?target.checked:key==='width'||key==='height'||key==='size'?Number(target.value):target.value;Object.assign(b,normalizeBlock(b));saveLocal();clearTimeout(blockPropertyUpdate.timer);blockPropertyUpdate.timer=setTimeout(schedule,270);}
async function createRoom(){await initialize();quiz=emptyQuiz();room=roomCode();await game.create(room,quiz);await game.saveHostQuiz(room,normalizedQuiz(quiz));hostCloudReady=true;localStorage.setItem('bq-last-host',room);role='host';view='editor';saveLocal();history.replaceState(null,'',location.pathname+'?room='+room);listenRoom();notice('PeerJS-Raum erstellt. Das Host-Quiz bleibt privat in diesem Browser.');}
async function enterRoom(code,name='',join=false){
 await initialize();code=code.toUpperCase().trim();if(!hasValidRoom(code))throw Error('Der Raumcode muss aus 16 Zeichen bestehen.');
 if(!join&&localStorage.getItem('bq-last-host')===code&&localStorage.getItem('bq-p2p-session-'+code)){
  await game.resumeHost(code);room=code;role='host';view='live';await restoreHostQuiz();localStorage.setItem('bq-last-host',room);
 }else{
  if(join&&!name.trim())throw Error('Bitte deinen Spielernamen eingeben.');
  const record=await game.connect(code,name||'Spieler');room=code;member=record;role='guest';view='play';
 }
 history.replaceState(null,'',location.pathname+'?room='+room);listenRoom();
}
function stopGuestListeners(){for(const unsub of guestListeners){try{unsub()}catch{}}guestListeners=[];if(responseUnsub){try{responseUnsub()}catch{}}responseUnsub=null;guestTeam='';watchingRound=-1;}
// The host is the sole publisher of the common answer review. Until reveal,
// the public room contains only player names + booleans; raw answers stay private.
async function startAnswerReview(automatic=false){
 if(!canHost()||isOffline()||!game||publicState?.phase!=='question'||roundMode(activeQuestion())!=='written')return;
 const currentRound=Number(publicState.round)||0;
 const expected=publicState.answerParticipants||{};
 const submitted=responses?.[String(currentRound)]||{};
 const progress=answerProgress(expected,submitted);
 if(!progress.total){if(!automatic)throw Error('Keine Online-Teilnehmer für diese Frage erfasst.');return;}
 if(automatic&&!progress.complete&&!(activeQuestion()?.type==='map'&&publicState?.deadline&&now()>=publicState.deadline))return;
 const board=makeAnswerReview(expected,submitted,currentRound);
 await game.updateCurrent(room,currentRound,publicState.current.id,{phase:'review',deadline:0,pausedRemaining:0,answerReview:board},['question']);
 if(!automatic)notice('Antwortübersicht für alle Teilnehmer geöffnet.');
}
async function maybeAutoBeginReview(){
 if(!canHost()||isOffline()||!game||publicState?.phase!=='question'||roundMode(activeQuestion())!=='written')return;
 const roundNumber=Number(publicState.round)||0;
 const mapRound=activeQuestion()?.type==='map';
 const expired=mapRound&&!!publicState.deadline&&now()>=publicState.deadline;
 if(mapRound&&!expired)return; // Map pins remain editable until the timer ends; without timer the host closes manually.
 if(reviewStartPending===roundNumber||(!expired&&!answerProgress(publicState.answerParticipants,responses?.[String(roundNumber)]).complete))return;
 reviewStartPending=roundNumber;
 try{await startAnswerReview(true);}catch(err){error(err);}finally{reviewStartPending=-1;}
}
async function publishOneAnswer(uid){
 if(!canHost()||isOffline()||!reviewIsCurrent(publicState)||publicState.phase!=='review')return;
 const review=publicState.answerReview;
 if(review.entries?.[uid]?.revealed)return;
 const privateResponse=responses?.[roundKey()]?.[uid];
 const updated=revealAnswer(review,uid,privateResponse);
 await game.updateCurrent(room,Number(publicState.round),publicState.current.id,{['answerReview/entries/'+uid]:updated.entries[uid]},['review']);
}
async function publishAllAnswers(){
 if(!canHost()||isOffline()||!reviewIsCurrent(publicState)||publicState.phase!=='review')return;
 let board=publicState.answerReview;
 for(const id of Object.keys(board.entries||{})){
  if(board.entries[id].submitted&&!board.entries[id].revealed){
   const raw=responses?.[roundKey()]?.[id];
   if(raw?.text)board=revealAnswer(board,id,raw);
  }
 }
 await game.updateCurrent(room,Number(publicState.round),publicState.current.id,{...Object.fromEntries(Object.entries(board.entries||{}).filter(([key,item])=>item.revealed).map(([key,item])=>['answerReview/entries/'+key,item]))},['review']);
}
function listenRoom(){game.clearWatchers();stopGuestListeners();connected=false;guestLobby=null;publicState=null;members={};roster={};presence={};buzzers={};responses={};messages={};picks={};scoreTarget='';myResponse=null;reviewStartPending=-1;questionHistory={};
 game.watch('.info/connected',v=>{const wasConnected=connected;connected=!!v;if(connected&&!wasConnected&&(canHost()||member?.status==='approved'))game.enterPresence(room).catch(()=>{});if(connected&&!wasConnected&&cloudDirty&&canHost())queueHostCloudSave();schedule();});game.watch('.info/serverTimeOffset',v=>game.offset=v||0);
 if(canHost()){
  game.watchRoom(room,'picks',v=>{picks=v||{};schedule();});
  game.watchRoom(room,'questionHistory',v=>{questionHistory=v||{};schedule();});
  game.watchRoom(room,'public',v=>{publicState=v;schedule();void maybeAutoBeginReview();});
  game.watchRoom(room,'members',v=>{members=v||{};schedule();});
  game.watchRoom(room,'roster',v=>{roster=v||{};schedule();});
  game.watchRoom(room,'presence',v=>{presence=v||{};schedule();});
  game.watchRoom(room,'buzzers',v=>{buzzers=v||{};schedule();});
  game.watchRoom(room,'responses',v=>{responses=v||{};schedule();void maybeAutoBeginReview();});
  game.watchRoom(room,'messages',v=>{messages=v||{};schedule();});
  game.enterPresence(room).catch(()=>{}); // Host has no member record: onDisconnect presence requires host rights.
 }else{
  game.watchRoom(room,'lobby',v=>{guestLobby=v||null;schedule();});
  game.watchRoom(room,'members/'+game.uid,(v,err)=>{if(err){error(err);return;}const old=member?.team;member=v;if(member?.status==='approved'&&(guestTeam!==member.team))startGuestListeners();if(member?.status!=='approved'&&guestTeam)stopGuestListeners();schedule();});
 }
 schedule();}
function startGuestListeners(){stopGuestListeners();if(member?.status!=='approved')return;guestTeam=member.team;
 const w=(path,callback)=>{const fn=game.watchRoom(room,path,callback);guestListeners.push(fn);};
 w('public',v=>{publicState=v;if(publicState?.round!==watchingRound)watchOwnResponse();schedule();});
 w('roster',v=>{roster=v||{};schedule();});w('presence',v=>{presence=v||{};schedule();});w('buzzers',v=>{buzzers=v||{};schedule();});
 w('messages/'+guestTeam,v=>{messages={[guestTeam]:v||{}};schedule();});
 game.enterPresence(room).catch(error);
}
function watchOwnResponse(){if(!game||!room||!guestTeam)return;if(responseUnsub){responseUnsub();responseUnsub=null;}watchingRound=publicState?.round??-1;myResponse=null;pickedOrder=[];guestChoice='';mapPick=null;mapCamera={...DEFAULT_MAP_VIEW};mapCameraQuestion='';if(watchingRound<0)return;responseUnsub=game.watchRoom(room,'responses/'+watchingRound+'/'+game.uid,v=>{myResponse=v;schedule();});}
// The supplied four images are a single, fixed sprite family. Motion never
// changes their face, outfit or artwork: we animate only the surrounding DOM.
const CHARACTER_IDS=['rogue','blades','mage','druid'];
function characterMarkup(index,extra=''){
 const name=CHARACTER_IDS[((index%4)+4)%4];
 return `<span class="bq-actor bq-actor--${name} ${extra}" aria-hidden="true"></span>`;
}
function reducedCharacterMotion(){return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;}
// Deliberately rare: one extra cameo on the board after every seven finished rounds.
function boardPeekRound(){
 const round=Number(publicState?.round||0);
 return Number.isInteger(round)&&round>=3&&round%7===3;
}
function sceneCameos(kind='board'){
 if(kind!=='board'||!boardPeekRound())return '';
 const round=Number(publicState.round);
 return `<div class="bq-scene-cameos" aria-hidden="true"><span class="bq-cameo">${characterMarkup(1+Math.floor(round/7)%3)}</span></div>`;
}
// Only one fixed, tiny and stationary viewer is shown throughout desktop play.
function watcherMarkup(){
 return `<div class="bq-screen-watcher" aria-hidden="true">${characterMarkup(3)}</div>`;
}
function maybeAnimateQuestion(){
 const q=publicState?.current;
 const key=q?.id&&publicState.phase==='question'&&['play','live'].includes(view)
  ?room+':'+publicState.round+':'+q.id:null;
 if(activeQuestionCover&&activeQuestionCover.key!==key){activeQuestionCover.cancel();activeQuestionCover=null;}
 if(!key)return;
 const stage=document.querySelector('.page-live .stage');if(!stage)return;
 if(activeQuestionCover?.key===key){activeQuestionCover.update(stage);return;}
 if(key===lastAnimatedQuestion)return;
 lastAnimatedQuestion=key;
 if(reducedCharacterMotion())return;
 const direction=questionMotion(publicState.round,q.id);
 const who=CHARACTER_IDS[Math.abs(Number(publicState.round)||0)%CHARACTER_IDS.length];
 const curtain=document.createElement('div');
 curtain.className='bq-question-curtain bq-swipe-'+direction+' bq-standalone';
 curtain.setAttribute('aria-hidden','true');
 const handle=document.createElement('span');handle.className='bq-veil-handle';
 const actor=document.createElement('span');actor.className='bq-curtain-helper bq-actor bq-actor--'+who;
 const glove=document.createElement('span');glove.className='bq-curtain-glove';
 curtain.append(handle,actor,glove);document.body.append(curtain);
 let ended=false,timer=null;
 const update=()=>{if(ended)return;const bounds=document.querySelector('.page-live .stage')?.getBoundingClientRect();
  if(bounds)Object.assign(curtain.style,{left:bounds.left+'px',top:bounds.top+'px',width:bounds.width+'px',height:bounds.height+'px'});};
 const cleanup=()=>{if(ended)return;ended=true;clearTimeout(timer);window.removeEventListener('resize',update);
  window.removeEventListener('scroll',update,true);curtain.remove();if(activeQuestionCover?.key===key)activeQuestionCover=null;};
 update();window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
 curtain.addEventListener('animationend',event=>{if(event.target===curtain)cleanup()},{once:true});
 timer=setTimeout(cleanup,3500);
 activeQuestionCover={key,update,cancel:cleanup};
}
function removeMapThrowRail(){
 document.querySelectorAll('.bq-map-question.bq-map-throw-active').forEach(el=>el.classList.remove('bq-map-throw-active'));
}
/** The only world-map animation: the actor visibly throws at solution release. */
function maybeAnimateMapDagger(){
 const q=publicState?.current;
 const key=q?.id&&publicState?.phase==='reveal'&&q.type==='map'&&['play','live'].includes(view)
  ?room+':'+publicState.round+':'+q.id:null;
 if(activeMapThrow&&activeMapThrow.key!==key){activeMapThrow.handle.cancel();activeMapThrow=null;removeMapThrowRail();}
 if(!key)return;
 const marker=document.querySelector('.bq-question-scene .bq-map-pin.is-solution');
 const viewport=marker?.closest('.bq-map-viewport');
 if(!viewport||!marker)return;
 const previouslyShown=consumedMapThrows.has(key)||(()=>{try{return sessionStorage.getItem('bq-map-throw:'+key)==='1'}catch{return false}})();
 if(previouslyShown&&!activeMapThrow){marker.classList.remove('bq-throw-waiting');return;}
 if(activeMapThrow?.key===key){
  viewport.closest('.bq-map-question')?.classList.add('bq-map-throw-active');
  if(!activeMapThrow.handle.landed)marker.classList.add('bq-throw-waiting');
  activeMapThrow.handle.rebind(viewport,marker);return;
 }
 if(reducedCharacterMotion()||window.matchMedia?.('(forced-colors: active)')?.matches){consumedMapThrows.add(key);return;}
 // Keep the real world-space answer unchanged. Only reset an off-screen camera.
 if(marker.hidden)viewport.closest('.bq-map-question')?.querySelector('[data-map-zoom="reset"]')?.click();
 if(marker.hidden)return;
 marker.classList.add('bq-throw-waiting');
 consumedMapThrows.add(key);
 try{sessionStorage.setItem('bq-map-throw:'+key,'1')}catch{}
 const actor=THROW_ACTORS[Math.abs(Number(publicState.round)||0)%THROW_ACTORS.length];
 viewport.closest('.bq-map-question')?.classList.add('bq-map-throw-active');
 const handle=startMapDaggerThrow({viewport,marker,actor,
  onLand:()=>{if(publicState?.phase==='reveal'&&publicState?.current?.id===q.id)
   document.querySelector('.bq-question-scene .bq-map-pin.is-solution')?.classList.remove('bq-throw-waiting');},
  onDone:()=>{removeMapThrowRail();if(activeMapThrow?.key===key)activeMapThrow=null}
 });
 if(handle)activeMapThrow={key,handle};
 else {removeMapThrowRail();marker.classList.remove('bq-throw-waiting');}
}
function render(){if(role==='host'&&view==='editor'&&isPublished())view='live';const app=$('app');document.body.classList.toggle('bq-game-mode',(view==='play'||view==='live')&&role!=='landing');if(role==='landing'){if(activeMapThrow){activeMapThrow.handle.cancel();activeMapThrow=null;}if(activeQuestionCover){activeQuestionCover.cancel();activeQuestionCover=null;}app.innerHTML=landing();return;}
 const nav=role==='host'?(isOffline()?[['editor','✎','Fragen'],['live','▦','Quizbrett'],['history','▤','Fragenverlauf'],['present','▣','Vorschau']]:isPublished()?[['live','◈','Quiz'],['present','▣','Präsentation'],['teams','♙','Lobby'],['history','▤','Verlauf'],['setup','⚙','Einstellungen']]:[['editor','✎','Fragen'],['live','◈','Quizbrett'],['present','▣','Vorschau'],['teams','♙','Lobby'],['setup','⚙','Einstellungen']]):[['play','◈','Quiz']];
 const title=({live:'Live-Raum',editor:'Fragen bearbeiten',history:'Fragenverlauf',present:'Präsentation',teams:'Team-Lobby',setup:'Einstellungen',play:'Teilnehmen'})[view]||'Quiz';
 app.innerHTML=`<div class="shell"><section class="workspace"><header class="topbar glass"><div class="header-primary"><div class="brand"><div class="logo">B</div><div><strong>BRAINQUIZ</strong><small>Version ${VERSION}</small></div></div><nav class="top-nav" aria-label="Hauptnavigation">${nav.map(([name,glyph,label])=>`<button type="button" class="nav ${view===name?'active':''}" data-action="view" data-view="${name}" ${view===name?'aria-current="page"':''}><span class="glyph" aria-hidden="true">${glyph}</span>${label}</button>`).join('')}</nav>${canHost()&&!isOffline()?btn(isPublished()?'Spielraum schließen':'Lobby schließen','leave-host-room','small danger'):''}<div class="header-state"><div class="status" aria-label="Verbindungsstatus"><i class="dot ${connected?'live':''}"></i>${isOffline()?'Lokaler Editor':connected?'Live verbunden':'Verbindung wird geprüft'}</div><span class="role-caption">${role==='host'?'Host':member?.status==='approved'?e(teamName(member.team)):'Team-Lobby'}</span></div></div><div class="header-secondary"><h1>${e(title)}</h1><div class="topright"><div class="roomchip">${isOffline()?'LOKAL':'RAUM'} <strong>${e(room)}</strong></div>${isOffline()?'':btn('Einladung kopieren','invite','small')}</div></div></header><main class="page ${view==='play'||view==='live'?'page-live bq-session-page':''}">${role==='host'?hostPage():guestPage()}</main>${view==='live'||view==='play'?watcherMarkup():''}</section></div>`;
 maybeAnimateQuestion();
 const pointsPanel=document.getElementById('review-points-panel');if(pointsPanel)pointsPanel.addEventListener('toggle',()=>{reviewPointsOpen=pointsPanel.open});
 if(view==='editor'&&role==='host')studio.mount(document.getElementById('se-root'));
 else {
  const viewport=app.querySelector('.bq-question-panel [data-map-viewport]');
  if(viewport)mountMapViewport(viewport,{
   getView:()=>mapCamera,setView:v=>{mapCamera=v;},
   canPick:canMapPick(),onPick:point=>{if(!canMapPick())return;mapPick=point;schedule();}
  });
 }
 maybeAnimateMapDagger();
}
function landing(){
 const hostCode=localStorage.getItem('bq-last-host')||'';
 let drafts=[],workspaceError='';try{drafts=boardList(localStorage);}catch(err){workspaceError=err?.message||'Quizbrett-Verzeichnis konnte nicht gelesen werden.';}
 const invite=hasValidRoom(roomFromLink);
 return `<div class="start-shell"><header class="start-head"><div class="brand"><div class="logo">B</div><div><strong>BrainQuiz Studio</strong><small>Version ${VERSION}</small></div></div></header>
 <main class="start-main"><h1>${invite?'Quiz beitreten':'BrainQuiz Online'}</h1>
 ${invite?`<p class="small muted">Raum ${e(roomFromLink)} · Gib deinen Namen ein, um dem Quiz beizutreten.</p>`:'<p class="small muted">Ein Link für alle. Quiz erstellen und direkt mit bis zu zehn Freunden im Browser spielen.</p>'}
 <div class="start-grid ${invite?'bq-invite-landing':''}">
 ${!invite?`<section class="glass panel start-card"><h2>Quiz hosten</h2><div class="row">${btn('Quizbrett bearbeiten','create-offline','primary')}${btn('Online-Raum erstellen','create','small',configured?'':'disabled')}${hostCode?btn('Live-Raum fortsetzen','resume','small',configured?'':'disabled'):''}</div><p class="small muted">${workspaceError?e(workspaceError):drafts.length?drafts.length+' lokal gespeicherte Quizbretter · Das zuletzt geöffnete wird fortgesetzt.':'Dein Quizbrett wird in diesem Browser gespeichert.'} Ein Live-Raum ist unabhängig vom lokalen Entwurf. Zum Spielen eines vorhandenen Bretts zuerst „Quizbrett bearbeiten“ und dort „Live-Raum starten“ wählen.</p>${drafts.length?`<details class="bq-landing-boards"><summary>Gespeicherte Quizbretter (${drafts.length})</summary><div class="bq-landing-boards-list">${drafts.map(b=>`<button type="button" class="btn small" data-action="open-landing-board" data-board-id="${e(b.id)}">${e(b.title)} <small>· ${e(b.id.slice(1,7).toUpperCase())}</small></button>`).join('')}</div></details>`:''}</section>`:''}
 <section class="glass panel start-card"><h2>${invite?'Einladung annehmen':'Am Quiz teilnehmen'}</h2><form id="join-form" class="formgrid"><label class="field span2">Raumcode<input id="join-room" required maxlength="16" value="${e(roomFromLink)}" placeholder="16 Zeichen" autocomplete="off" ${invite?'readonly':''}></label><label class="field span2">Dein Name<input id="join-name" required maxlength="28" placeholder="Anzeigename" autocomplete="nickname"></label><button type="submit" class="btn primary" ${configured?'':'disabled'}>Beitreten</button></form><p class="small muted">Keine Installation und kein eigenes Konto erforderlich. Danach wählst du dein Team in der Lobby und kannst dich bereit melden.</p></section>
 </div>
 <section class="glass panel bq-online-setup"><h3>PeerJS / WebRTC</h3><p class="small muted">Keine Datenbank und kein eigenes Konto nötig. Für eine Live-Runde muss der Browser des Hosts geöffnet und mit dem Internet verbunden bleiben. Der Verbindungsaufbau erfolgt über PeerJS Cloud; manche restriktiven Netzwerke benötigen einen zusätzlichen TURN-Relayserver.</p></section></main></div>`;
}

function hostPage(){if(isPublished()&&view==='editor')view='live';if(!publicState){return `<section class="glass panel"><div class="empty">Verbindung zum Raum wird aufgebaut …</div></section>`;}if(view==='editor')return renderEditor();if(view==='history')return renderHistory();if(view==='present')return renderPresenter();if(isOffline()&&view==='live')return renderHostLive();if(isOffline())return renderEditor();if(view==='teams')return renderTeams();if(view==='setup')return renderSetup();return renderHostLive();}
function guestPage(){
 if(member?.status==='removed')return `<section class="glass panel"><h2>Du wurdest aus dem Raum entfernt.</h2><p>Wende dich für eine erneute Freigabe an den Host.</p></section>`;
 if(!member||member.status==='pending')return lobbyGuestHTML(guestLobby,member);
 if(!publicState)return `<section class="glass panel"><div class="empty">Synchronisiere Live-Spielstand …</div></section>`;
 if(publicState.phase==='board'&&Number(publicState.round||0)===0)return `<section class="bq-session-scene bq-lobby-session">${lobbyGuestHTML(guestLobby,member)}<details class="bq-auxiliary bq-shared-team-chat" data-bq-persist="teamchat"><summary>Privater Teamchat</summary>${renderChat()}</details></section>`;
 if(view==='teams')return renderTeams();if(view==='setup')return renderSetup();return renderGuestLive();
}
function renderHistory(){
 const players=Object.fromEntries(participantList().map(([id,name,team])=>[id,{name,team}]));
 const rows=historyRows(questionHistory,responses,publicState?.playerScores,players);
 const visible=rows.filter(r=>[r.category,r.title,r.prompt,...r.participants.map(p=>p.name)].join(' ').toLocaleLowerCase('de').includes(historyFilter.toLocaleLowerCase('de')));
 return `<section class="glass panel history-panel"><div class="panelhead"><div><h2>Gestellte Fragen</h2><p class="small muted">Fragen, abgegebene Antworten und Bewertung · nur für den Host</p></div><div class="row"><span class="pill">${rows.length} Runden</span>${btn('Verlauf exportieren','export-history','small',rows.length?'':'disabled')}</div></div>
 <label class="field history-search">Verlauf durchsuchen<input id="history-search" type="search" value="${e(historyFilter)}" placeholder="Kategorie, Frage oder Person"></label>
 <div class="history-list">${visible.length?visible.map(r=>{
 const q=quiz.questions.find(q=>q.id===r.questionId);
 return `<details class="history-entry" ${r.round===Number(publicState?.round)?'open':''}><summary><span class="history-round">${r.round}</span><span class="history-question"><b>${e(r.category)} · ${e(r.points)} Punkte</b><span>${e(r.prompt||q?.prompt||r.title||'Frage')}</span></span><span class="history-numbers"><span class="history-count good">✓ ${r.correctCount}</span><span class="history-count danger-text">✕ ${r.wrongCount}</span><span class="history-count">${r.submittedCount} Antworten</span></span></summary>
 <div class="history-details">${r.solution?`<div class="history-solution"><span class="sub">Musterlösung</span><strong>${e(r.solution)}</strong></div>`:''}
 ${r.participants.length?`<div class="history-answers">${r.participants.map(p=>{const status=responseStatus(p.status);return `<div class="history-person"><div class="history-person-name"><b>${e(p.name)}</b><span class="status-tag ${e(p.status)}">${status.icon} ${status.label}</span></div><div class="history-person-answer">${p.answer?e(p.answer):'<span class="muted">Keine gespeicherte Antwort</span>'}</div>${p.delta!==null?`<span class="history-delta">${p.delta>0?'+':''}${p.delta.toLocaleString('de-DE')} Punkte</span>`:''}</div>`}).join('')}</div>`:'<p class="small muted">Keine abgegebenen Antworten oder Bewertungen für diese Runde.</p>'}
 </div></details>`;}).join(''):'<div class="empty">Keine passenden Fragerunden vorhanden. Öffne eine Frage aus dem Quizbrett.</div>'}</div></section>`;
}
function boardColumns(){return categoryColumns(Object.values(publicState?.board||{}));}
function boardPages(){return pageBoardColumns(boardColumns(),window.innerWidth||1280,window.innerHeight||800);}
function renderBoard(){
 if(!publicState)return '';
 const pages=boardPages();
 boardPage=Math.min(boardPage,Math.max(0,pages.length-1));if(!pages.length)return '<div class="empty">Noch keine Fragen veröffentlicht.</div>';
 const page=pages[Math.min(boardPage,pages.length-1)];
 const choose=canHost()?'open':'request-pick';
 return `<div class="bq-board-full" aria-label="Fragenübersicht">
 <div class="board-scroll"><div class="board jeopardy-board ${page.rows<4?'bq-board-sparse':''}" style="--board-cols:${page.columns.length};--board-rows:${page.rows}">${page.columns.map(col=>`<div class="column"><div class="coltitle" title="${e(col.category)}">${e(col.category)}</div>${col.items.map(q=>{
 const used=isBoardCellPlayed(q,publicState);
 return `<button type="button" class="tile ${used?'used is-played':''}" data-action="${choose}" data-qid="${e(q.id)}" title="${e(col.category)} · ${e(q.points)} Punkte${used?' · bereits gewählt':''}" aria-label="${e(col.category)} · ${e(q.points)} Punkte${used?' · bereits gespielt':''}" ${used||(!canHost()&&publicState.phase!=='board')?'disabled':''}><span class="tile-points">${used?'✓':e(q.points)}</span></button>`;
 }).join('')}</div>`).join('')}</div></div>
 ${pages.length>1?`<nav class="bq-board-pages" aria-label="Weitere Fragen anzeigen">${btn('← Zurück','board-page','small',boardPage<=0?'disabled':'data-delta="-1"')}<span class="small muted">Seite ${Math.min(boardPage+1,pages.length)} / ${pages.length}</span>${btn('Weiter →','board-page','small',boardPage>=pages.length-1?'disabled':'data-delta="1"')}</nav>`:''}
 </div>`;
}
function editorBoard(){
 const cols=categoryColumns(quiz.questions);if(!cols.length)return '';
 return `<div class="board-scroll"><div class="board jeopardy-board editor-board" style="--board-cols:${cols.length}">${cols.map(col=>`<div class="column"><div class="coltitle">${e(col.category)}</div>${col.items.map(q=>`<button type="button" class="tile ${q.id===selected?'current':''}" data-action="select-q" data-qid="${e(q.id)}" aria-label="${e(col.category)} ${e(q.points)} Punkte bearbeiten" title="${e(q.title)}"><span class="tile-points">${e(q.points)}</span><span class="tile-status">${validateQuestion(q)?'○':'✓'}</span></button>`).join('')}</div>`).join('')}</div></div>`;
}
function participantList(){
 return [...Object.entries(publicState?.manualPlayers||{}).map(([id,name])=>[id,name,'Manuell']),...Object.entries(roster||{}).map(([id,p])=>[id,p.name,teamName(p.team)])];
}
function personScores(){return participantList().map(([id,name,team])=>({id,name,team,points:Number(publicState?.playerScores?.[id]?.total)||0})).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name,'de'));}
function scorePanel(){
 const people=personScores(),question=activeQuestion(),pts=Number(question?.points)||0,choice=people.find(p=>p.id===scoreTarget),locks=buzzLocks();
 return `<section class="glass panel scoring-panel"><div class="panelhead"><h3>Teilnehmer & Punkte</h3><div class="row"><span class="pill">${people.length}</span>${btn('+ Person','add-person','small')}</div></div>${people.length?`<div class="score-people">${people.map(p=>`<button type="button" class="score-person ${p.id===scoreTarget?'selected':''} ${locks[p.id]?'is-locked':''}" data-action="select-player" data-person="${e(p.id)}"><span><b>${e(p.name)}</b><small>${e(p.team)}${locks[p.id]?' · Buzzer gesperrt':''}</small></span><strong>${p.points.toLocaleString('de-DE')}</strong></button>`).join('')}</div>`:'<div class="empty">Noch keine Spieler. Im Editor unter „Quiz-Einstellungen“ manuelle Teilnehmer eintragen oder Online-Spieler freigeben.</div>'}
 ${choice?`<div class="score-actions"><div class="small muted">Ausgewählt: ${e(choice.name)}${locks[choice.id]?' · aktuell für diese Frage gesperrt':''}</div><div class="row">${roundMode(question)==='written'?`${btn('Richtig · +'+pts,'judge-correct','primary',question?'':'disabled')}${btn('Falsch · −'+(pts/2),'judge-wrong','danger',question?'':'disabled')}`:'<p class="small muted">Buzzer direkt in der Hauptleiste bewerten.</p>'}${btn('Buzzer freigeben','unlock-buzz-player','small',locks[choice.id]?'':'disabled')}</div><div class="manual-points"><label class="field">Punkte manuell ändern<input id="person-adjust" type="number" step="0.5" min="-10000" max="10000" value="50"></label>${btn('Hinzufügen / Abziehen','adjust-player','small')}</div><div class="small muted">Bei „Falsch“ verliert der aktuelle Buzzer automatisch die Hälfte der Fragepunkte. Danach wird der Buzzer wieder freigegeben; dieselbe Person bleibt bis zur manuellen Freigabe gesperrt.</div></div>`:''}</section>`;
}
function safeImage(value){return isImageData(value)?value:'';}
function guestCanAnswer(){const q=activeQuestion(),timeUp=!!publicState?.deadline&&publicState.deadline<now();return role==='guest'&&member?.status==='approved'&&!!q&&roundMode(q)==='written'&&!!publicState?.answerParticipants?.[game?.uid]&&isOpen()&&!timeUp;}
function renderReviewGallery(){
 const board=publicState?.answerReview;if(!board)return '';
 const entries=Object.entries(board.entries||{});const visible=entries.filter(([,a])=>a.revealed).length;
 return `<div class="answer-review">
  <div class="review-summary"><span class="pill">${entries.length} Personen</span><span class="pill">${visible} aufgedeckt</span><span class="small muted">Antworten erscheinen erst nach Freigabe durch den Host.</span></div>
  <div class="review-grid" style="--review-columns:${Math.min(4,Math.max(1,Math.ceil(entries.length/2)))}">${entries.map(([id,a])=>{
   const state=answerCardState(a),hidden=state==='hidden',submitted=state!=='missing';
   const display=!submitted?'<span class="small muted">Keine Antwort abgegeben</span>':hidden?`<div class="frosted-shield" aria-label="Antwort verdeckt – wird erst nach Host-Freigabe geladen"><span class="frosted-symbol" aria-hidden="true">◇</span><span class="frosted-title">Antwort verdeckt</span><span class="frosted-bars" aria-hidden="true"><i></i><i></i><i></i></span></div>`:`<span class="review-answer">${e(a.value||'')}</span>`;
   const clickable=canHost()&&publicState.phase==='review'&&submitted&&hidden;
   const verdict=canHost()?publicState?.playerScores?.[id]?.rounds?.[roundKey()]?.result:null;
   return `<article class="review-card ${!submitted?'is-missing':hidden?'is-hidden':'is-revealed'} ${clickable?'bq-selectable review-clickable':''}" data-review-player="${e(id)}" ${clickable?`role="button" tabindex="0" data-action="reveal-answer" data-uid="${e(id)}" aria-label="Antwort von ${e(a.name||'Spieler')} aufdecken"`:''}><div class="review-name">${e(a.name||'Spieler')}</div><div class="review-value">${display}</div><div class="review-footer">${!submitted?'<span class="small muted">Keine Abgabe</span>':hidden?'<span class="small muted">Verdeckt</span>':'<span class="small good">Aufgedeckt</span>'}${clickable?'<span class="small good">Klicken: aufdecken</span>':''}</div>${canHost()&&submitted&&!hidden?`<div class="review-judge"><span class="status-tag ${e(verdict||'open')}">${responseStatus(verdict).icon} ${responseStatus(verdict).label}</span>${btn('✓ Richtig','judge-review-correct','small',`data-person="${e(id)}"`)}${btn('✕ Falsch','judge-review-wrong','small',`data-person="${e(id)}"`)}</div>`:''}</article>`;
  }).join('')}</div>
 </div>`;
}
function sessionFooter(){
 const teams=Object.entries(publicState?.teams||{});
 const players=personScores();
 const list=scoreMode(publicState)==='team'?teams.map(([id,label])=>({label,points:Number(publicState?.scores?.[id]||0)})):(players.length?players.map(p=>({label:p.name,points:p.points})):teams.map(([id,label])=>({label,points:Number(publicState?.scores?.[id]||0)})));
 const width=window.innerWidth||1280,perPage=width<470?2:width<760?3:width<1000?5:8;
 const pages=Math.max(1,Math.ceil(list.length/perPage));scorePage=Math.min(scorePage,pages-1);
 const visible=list.slice(scorePage*perPage,(scorePage+1)*perPage);
 const unit=scoreMode(publicState)==='team'?'Teams':'Personen';
 return `<footer class="bq-score-footer" aria-label="Aktueller Punktestand"><div class="bq-score-heading"><strong>Punktestand</strong><span>${list.length?list.length+' '+unit:'Noch keine '+unit}</span>${pages>1?`<div class="bq-score-pager"><button type="button" data-action="score-page" data-delta="-1" aria-label="Vorherige Punktestände" ${scorePage===0?'disabled':''}>‹</button><span aria-live="polite">${scorePage+1}/${pages}</span><button type="button" data-action="score-page" data-delta="1" aria-label="Weitere Punktestände" ${scorePage===pages-1?'disabled':''}>›</button></div>`:''}</div>
 <div class="bq-score-items">${visible.length?visible.map(p=>`<span class="bq-score-item" title="${e(p.label)}: ${Number(p.points).toLocaleString('de-DE')} Punkte"><span>${e(p.label)}</span><b>${Number(p.points).toLocaleString('de-DE')}</b></span>`).join(''):'<span class="muted">–</span>'}</div>
 </footer>`;
}
function boardScene(host=false){
 const p=publicState;
 const suggestions=host?Object.entries(picks||{}).filter(([,x])=>p.board?.[x.qid]&&!p.board[x.qid]?.used):[];
 return `<section class="bq-session-scene bq-board-scene" data-scene="board"><div class="bq-scene-heading"><div><span class="bq-eyebrow">QUIZ</span><h2>Fragenübersicht</h2></div><span class="pill">${Object.values(p.board||{}).filter(q=>q.used).length} / ${Object.keys(p.board||{}).length} gespielt</span></div>
 ${sceneCameos('board')}${host&&Number(p.round||0)===0?`<div class="bq-host-lobby-mini"><strong>✓ ${lobbySnapshot({public:p,roster,members,presence}).ready}/${approvedCount(roster)} bereit</strong>${btn('Team-Lobby öffnen','view','small','data-view="teams"')}</div>`:''}<section class="glass panel bq-board-panel">${boardPeekRound()?'<span class="bq-peek-fingers" aria-hidden="true"></span>':''}${renderBoard()}</section>
 ${suggestions.length?`<details class="bq-auxiliary"><summary>${suggestions.length} Fragenwunsch${suggestions.length===1?'':'e'} von Teilnehmern</summary><div class="row">${suggestions.slice(-8).map(([,x])=>btn(`${e(x.name||'Spieler')}: ${e(p.board[x.qid]?.category||'')} ${e(p.board[x.qid]?.points||'')}`,'open','small',`data-qid="${e(x.qid)}"`)).join('')}</div></details>`:''}
 ${host?`<details class="bq-auxiliary bq-host-tools" data-bq-persist="hosttools"><summary>Spieler verwalten und Einstellungen</summary>${scorePanel()}${renderChat()}</details>`:`<details class="bq-auxiliary bq-shared-team-chat" data-bq-persist="teamchat"><summary>Teamchat · ${e(teamName(member?.team))}</summary>${renderChat()}</details>`}
 ${sessionFooter()}</section>`;
}
function hasLiveQuestion(){return sceneForPublicState(publicState)==='question';}
function renderReviewView(){
 const p=publicState,q=activeQuestion();
 return `<section class="bq-session-scene bq-question-scene" data-scene="question"><div class="bq-scene-heading"><div><span class="bq-eyebrow">FRAGE ${e(p.round)}</span><h2>${e(q?.category||'Aktuelle Frage')} · ${e(q?.points||0)} Punkte</h2></div><span class="pill ${p.phase==='reveal'?'good':''}">${p.phase==='reveal'?'Lösung sichtbar':'Antworten aufdecken'}</span></div>
 <div class="bq-answer-review-body"><section class="glass panel bq-question-panel"><div class="bq-scene-content">${renderStage()}</div></section>
 <section class="glass panel bq-answers-panel"><h3>Antworten</h3>${renderReviewGallery()}</section></div>
 ${canHost()?`<div class="bq-action-bar bq-host-action-bar" aria-label="Host-Steuerung"><span class="bq-action-step">Antworten prüfen</span>${p.phase==='review'?btn('Alle Antworten aufdecken','reveal-all-answers','primary'):''}${p.phase==='review'?btn('Lösung zeigen','reveal','primary'):''}${btn('Zurück zum Quizbrett','back','small')}
 <details class="bq-auxiliary" data-bq-persist="reviewscore"><summary>Bewertungen & Punkte</summary>${scorePanel()}</details></div>`:''}
 ${sessionFooter()}</section>`;
}
function canMapPick(){const q=activeQuestion();return role==='guest'&&q?.type==='map'&&member?.status==='approved'&&isOpen()&&(!publicState?.deadline||now()<publicState.deadline)&&(roundMode(q)==='written'?!!publicState?.answerParticipants?.[game?.uid]:winner()?.uid===game?.uid)}
function releasedMapPins(){
 if(!reviewIsCurrent(publicState))return [];
 return Object.values(publicState.answerReview?.entries||{})
  .filter(entry=>entry?.revealed&&decodePoint(entry.value))
  .map(entry=>({...decodePoint(entry.value),name:entry.name}));
}
function renderMapFallback(q){return renderScene({template:'map',elements:[]},{mapPrompt:q.prompt,mapView:mapCamera,mapCanPick:canMapPick(),mapPin:!canHost()?(mapPick||decodePoint(myResponse?.text)):null,mapSolution:publicState?.phase==='reveal'?normalizePoint({x:q.mapTargetX,y:q.mapTargetY}):null,mapPublicPins:releasedMapPins(),revealed:publicState?.phase==='reveal'})}
function renderStage(){const q=activeQuestion(),isReveal=publicState.phase==='reveal';if(q?.type==='map'&&mapCameraQuestion!==q.id){mapCamera={...DEFAULT_MAP_VIEW};mapCameraQuestion=q.id;}if(!q)return `<div class="stage"><h2>${canHost()?'Frage auswählen':'Keine Frage aktiv'}</h2></div>`;
 let html=`<div class="stage"><div class="eyebrow">${e(q.category)} · ${isReveal?'AUFLÖSUNG':publicState.phase==='paused'?'PAUSIERT':'FRAGE OFFEN'}</div>${q.scene?'':(q.prompt?`<h2>${e(q.prompt)}</h2>`:'')}${q.scene?renderScene(q.scene,{revealed:isReveal,interactive:!canHost(),canAnswer:guestCanAnswer()&&!myResponse,picked:pickedOrder,correctIndex:q.correct||0,mapCanPick:canMapPick(),mapView:mapCamera,mapPin:!canHost()?(mapPick||decodePoint(myResponse?.text)):null,mapSolution:isReveal&&q.type==='map'?normalizePoint({x:q.mapTargetX,y:q.mapTargetY}):null,mapPublicPins:q.type==='map'?releasedMapPins():[] }):renderBlocks(q.blocks,{reveal:isReveal})}`;
 if(q.type==='map'&&!q.scene)html+=renderMapFallback(q);
 if(!q.scene&&q.type==='splash')html+=safeImage(q.image)?`<img class="media" src="${safeImage(q.image)}" alt="Rätselbild">`:`<p class="hint">Kein Rätselbild hinterlegt.</p>`;
 if(!q.scene&&q.type==='multiple')html+=`<div class="choices">${(q.options||[]).map((opt,i)=>`${guestCanAnswer()?`<button type="button" class="choice ${isReveal&&q.correct===i?'correct':''}" data-action="select-choice" data-choice="${'ABCD'[i]}" ${myResponse?'disabled':''}><b>${'ABCD'[i]}</b>${e(opt)}</button>`:`<div class="choice ${isReveal&&q.correct===i?'correct':''}"><b>${'ABCD'[i]}</b>${e(opt)}</div>`}`).join('')}</div>`;
 if(!q.scene&&q.type==='imposter')html+=`<div class="abilities">${(q.icons||[]).map((icon,i)=>`<div class="ability ${isReveal&&q.imposterIndex===i?'correct':''}">${safeImage(icon)?`<img src="${safeImage(icon)}" alt="Fähigkeit ${i+1}">`:`<div class="preview-placeholder">Icon fehlt</div>`}<b>${e(q.abilityNames?.[i]||ABILITIES[i])}</b>${isReveal&&q.imposterIndex===i?'<span class="pill good">IMPOSTER</span>':''}</div>`).join('')}</div>`;
 if(!q.scene&&(q.type==='quote'||q.type==='emoji'))html+=`<div class="cluebox ${q.type==='emoji'?'emojiclue':''}" aria-label="Rätselhinweis">${e(q.clue||'')}</div>`;
 if(q.type==='estimate')html+=`<div class="cluebox">Schätze den Zahlenwert${q.estimateUnit?' in '+e(q.estimateUnit):''}.</div>`;
 if(!q.scene&&q.type==='order')html+=`<div class="ordergrid" aria-label="Einträge zum Sortieren">${(q.displayItems||[]).map((item,i)=>`<button class="orderitem ${pickedOrder.includes(i)&&!canHost()?'chosen':''}" data-action="pick-order" data-index="${i}" ${guestCanAnswer()&&!myResponse&&!pickedOrder.includes(i)?'':'disabled'}><b>${String.fromCharCode(65+i)}</b><span>${e(item)}</span>${!canHost()&&pickedOrder.includes(i)?`<strong>${pickedOrder.indexOf(i)+1}.</strong>`:''}</button>`).join('')}</div>${!canHost()&&isOpen()&&!myResponse?`<div class="small muted">Klicke die Einträge in deiner gewünschten Reihenfolge an. ${pickedOrder.length}/${(q.displayItems||[]).length} gewählt.</div>`:''}`;
 if(q.type==='audio')html+=q.audio?`<div class="soundstage"><div class="sub">SOUND-RÄTSEL · AUDIOCLIP</div><audio controls preload="metadata" src="${q.audio}">Audio wird von diesem Browser nicht unterstützt.</audio><p class="small muted">Manuell starten, beliebig oft anhören. Der Host gibt die Lösung frei.</p></div>`:`<div class="hint">Audio fehlt.</div>`;
 if((q.hints||[]).length)html+=`<div class="hintlist">${q.hints.map((h,i)=>`<p><b>Tipp ${i+1}:</b> ${e(h)}</p>`).join('')}</div>`;
 if(q.type==='splash'&&!isReveal)html+=`<p class="small muted">Bildstufe ${Number(q.visualStep||0)+1} von 3 · Der Originalausschnitt bleibt bis zur Auflösung beim Host.</p>`;
 if(isReveal&&q.type==='order')html+=`<div class="answer"><b>Richtige Reihenfolge:</b> ${q.orderCorrect?e(q.orderCorrect.join(' → ')):(q.orderItems||[]).map((x,i)=>`${i+1}. ${e(x)}`).join(' → ')}</div>`;
 if(isReveal&&q.type==='estimate')html+=`<div class="answer"><b>Zielwert:</b> ${e(q.estimateTarget)} ${e(q.estimateUnit||'')}</div>`;
 if(isReveal&&q.type==='map')html+='<div class="answer">Dolch = richtiger Zielpunkt.</div>';
 if(isReveal&&q.type!=='order'&&q.type!=='estimate'&&q.type!=='map')html+=`<div class="answer">Lösung: ${e(q.answer||(q.type==='multiple'?q.options?.[q.correct]:'')||'Nicht hinterlegt')}</div>${q.explanation?`<p style="margin-top:12px">${e(q.explanation)}</p>`:''}${q.type==='imposter'&&safeImage(q.correctIcon)?`<div class="row" style="margin-top:12px"><b>Richtiges Symbol:</b><img class="editor-image" src="${safeImage(q.correctIcon)}" alt="Korrektes Fähigkeitssymbol"></div>`:''}`;
 if(isReveal&&(q.type==='order'||q.type==='estimate')&&q.explanation)html+=`<p style="margin-top:12px">${e(q.explanation)}</p>`;
 html+='</div>';return html;}
function scores(){const teams=Object.entries(publicState?.teams||{}).sort((a,b)=>(publicState?.scores?.[b[0]]||0)-(publicState?.scores?.[a[0]]||0));return teams.map(([id,label],i)=>`<div class="scoreline"><span class="team"><span class="marker" style="background:${TEAM_COLORS[i%TEAM_COLORS.length]}"></span><span>${e(label)}</span></span><b>${Number(publicState?.scores?.[id]||0).toLocaleString('de-DE')}</b></div>`).join('')||'<div class="empty">Keine Teams</div>';}
function scoreControls(){const pts=activeQuestion()?.points||100;return Object.entries(publicState?.teams||{}).map(([id,label])=>`<div class="scoreline"><b>${e(label)}</b><div class="row">${btn('−'+pts,'score','small danger',`data-team="${id}" data-amount="-${pts}"`)}${btn('+'+pts,'score','small primary',`data-team="${id}" data-amount="${pts}"`)}</div></div>`).join('');}
function buzzerStatus(){const b=winner(),locks=Object.values(buzzLocks()),teamLocks=Object.keys(publicState?.buzzerBlockedTeams?.[roundKey()]||{});return `<div class="buzzerbox"><div class="sub">BUZZER / SERVERENTSCHEIDUNG</div>${b?`<h2 style="margin:16px 0 4px">◉ ${e(b.name)}</h2><p>${e(teamName(b.team))} ist zuerst eingegangen und darf antworten.</p>`:`<h2 style="margin:16px 0 4px">○ Noch kein Buzzer</h2><p>${isOpen()?'Frage läuft, Buzzer ist für alle freigegeben.':'Buzzer derzeit nicht aktiv.'}</p>`}<p class="small muted">Gesperrt für diese Runde: ${locks.length?locks.map(x=>e(x.name||x.uid||'Spieler')).join(' · '):'niemand'}${teamLocks.length?' · Teams: '+teamLocks.map(id=>e(teamName(id))).join(', '):''}</p>${canHost()?`<div class="row">${btn('Buzzer zurücksetzen','reset-buzz','small',b?'':'disabled')}${btn('Alle Sperren lösen','unlock-buzz-all','small',locks.length?'':'disabled')}</div>`:''}</div>`;}
function hostVisibilityCard(){const b=winner(),locks=Object.values(buzzLocks());return `<section class="glass panel bq-host-visibility"><div class="panelhead"><h3>Zuschauerzustand</h3><span class="pill good">${e(viewerStateLabel())}</span></div><div class="bq-visibility-grid"><div><div class="sub">Sichtbar für Zuschauer</div><strong>${e(publicState?.phase==='board'?'Quizbrett':publicState?.phase==='review'?'Antwortübersicht':hasLiveQuestion()?'Aktuelle Frage':'Warteansicht')}</strong><p class="small muted">${publicState?.phase==='reveal'?'Die Lösung ist sichtbar.':publicState?.phase==='question'?'Die Frage ist geöffnet, die Lösung noch verborgen.':publicState?.phase==='review'?'Nur die freigegebenen Antworten sind sichtbar.':'Noch keine offene Frage.'}</p></div><div><div class="sub">Buzzerstatus</div><strong>${b?e(b.name)+' · '+e(teamName(b.team)):'Noch frei'}</strong><p class="small muted">${locks.length?locks.length+' gesperrt in dieser Runde':'Niemand gesperrt in dieser Runde'}</p></div></div></section>`;}
function hostPrivateSolution(){const q=quiz.questions.find(x=>x.id===activeQuestion()?.id);if(!q)return '';
 const hint=q.type==='order'?q.orderItems?.join(' → '):q.type==='estimate'?`${q.estimateTarget} ${q.estimateUnit||''}`:q.answer||q.options?.[q.correct]||'Nicht eingetragen';
 return `<details class="bq-host-solution"><summary>🔒 Nur für Host: Lösung ansehen</summary><div class="bq-host-solution-body"><strong>${e(hint)}</strong><p class="small muted">Dieser Bereich wird niemals an Teilnehmer gesendet. Die öffentliche Lösung bleibt verborgen, bis du sie freigibst.</p></div></details>`;
}
function hostBuzzerControl(){const q=activeQuestion(),b=winner(),resolved=publicState?.buzzerResolved?.[roundKey()];if(roundMode(q)==='written')return `<div class="bq-host-main-status">✍️ Alle Teilnehmer schreiben selbst. ${answerProgress(publicState?.answerParticipants,responses?.[roundKey()]).submitted} von ${answerProgress(publicState?.answerParticipants,responses?.[roundKey()]).total} Antworten eingegangen.</div>`;
 if(resolved)return `<div class="bq-host-main-status bq-host-won">✓ ${e(teamName(resolved.team))} richtig bewertet · ${e(q.points)} Punkte. Nächster Schritt: Lösung zeigen.</div>`;
 if(!b)return `<div class="bq-host-main-status"><span>🎙️ Buzzer freigegeben · Wer zuerst buzzert, erhält das Antwortrecht. ${Object.keys(publicState?.buzzerBlockedTeams?.[roundKey()]||{}).length?'Gesperrte Teams bleiben ausgeschlossen.':''}</span>${Object.keys(publicState?.buzzerBlocked?.[roundKey()]||{}).length?btn('Buzzer-Sperren aufheben','unlock-buzz-all','small'):''}</div>`;
 return `<div class="bq-buzzer-winner"><div><span>AM BUZZER</span><strong>${e(b.name)} · ${e(teamName(b.team))}</strong><small>Antwort jetzt mündlich entgegennehmen und bewerten.</small></div><div class="bq-judge-actions">${btn('✓ Richtig · +'+e(q.points),'buzz-correct','primary')}${btn('✕ Falsch · −'+e(q.points/2),'buzz-wrong','danger')}</div></div>`;
}
function chatAllowed(){return !!(publicState?.settings?.chatOpen&&!(publicState?.settings?.lockOnBuzz&&isOpen()&&winner()));}
function renderChat(){const teams=Object.entries(publicState?.teams||{});const host=canHost(),selected=host?chatTeam:member?.team;if(host&&selected!=='ALL'&&!publicState?.teams?.[selected])chatTeam='ALL';let all=[];
 for(const [teamId,items]of Object.entries(messages||{})){if(!host&&teamId!==selected)continue;if(host&&selected!=='ALL'&&teamId!==selected)continue;for(const [id,msg]of Object.entries(items||{})){all.push({...msg,id,teamId});}}
 all.sort((a,b)=>(a.at||0)-(b.at||0));all=all.slice(-80);
 return `<section class="glass panel"><div class="panelhead"><h3>Teamchat</h3><span class="pill ${chatAllowed()?'good':'warn'}">${chatAllowed()?'OFFEN':'GESPERRT'}</span></div>${host?`<label class="field" style="margin-bottom:10px">Kanal<select id="chat-team"><option value="ALL" ${chatTeam==='ALL'?'selected':''}>Alle Teamkanäle</option>${teams.map(([id,name])=>`<option value="${id}" ${chatTeam===id?'selected':''}>${e(name)}</option>`).join('')}</select></label>`:`<p class="small">Nur dein Team und der Host sehen diese Nachrichten.</p>`}<div class="chatfeed" id="chatfeed">${all.length?all.map(m=>`<div class="message ${m.uid===game?.uid?'mine':''}"><small><b>${e(m.name)}</b>${host?` · ${e(teamName(m.teamId))}`:''} · ${m.at?new Date(m.at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):''}</small><p>${e(m.text)}</p></div>`).join(''):'<div class="empty">Noch keine Nachrichten</div>'}</div><form id="chat-form" class="chatinput"><input id="chat-text" maxlength="500" placeholder="Nachricht an dein Team …" autocomplete="off" ${(!host&&!chatAllowed())?'disabled':''}><button type="submit" class="btn small primary" ${(!host&&!chatAllowed())?'disabled':''}>Senden</button></form>${!chatAllowed()?'<p class="small muted" style="margin-top:9px">Chat gesperrt.</p>':''}</section>`;}
function renderHostLive(){
 if(!hasLiveQuestion())return boardScene(true);
 if(reviewIsCurrent(publicState))return renderReviewView();
 const p=publicState,q=activeQuestion(),hasQuestion=!!q;
 return `<section class="bq-session-scene bq-question-scene" data-scene="question"><div class="bq-scene-heading"><div><span class="bq-eyebrow">FRAGE ${e(p.round)}</span><h2>${e(q.category)} · ${e(q.points)} Punkte</h2></div><span class="pill ${isOpen()?'good':''}">${p.phase==='paused'?'Pausiert':isOpen()?'Frage offen':'Auflösung'}</span></div>
 ${hostVisibilityCard()}${hostBuzzerControl()}${hostPrivateSolution()}<section class="glass panel bq-question-panel"><div class="bq-scene-content">${renderStage()}</div></section>
 <div class="bq-action-bar bq-host-action-bar" aria-label="Host-Steuerung"><span class="bq-action-step">Spiel steuern</span>${roundMode(q)==='written'&&!isOffline()&&isOpen()&&answerProgress(p.answerParticipants,responses?.[roundKey()]).total?btn('Antwortübersicht öffnen','start-review','primary'):' ' }${btn('Lösung zeigen','reveal',!isOffline()&&isOpen()&&answerProgress(p.answerParticipants,responses?.[roundKey()]).total?'small':'primary',hasQuestion?'':'disabled')}${btn('Zurück zum Quizbrett','back','small')}
 ${q?.scene&&isOpen()&&sceneHasStep(quiz.questions.find(x=>x.id===q.id),Number(q.scene?.step||0))?btn('Inhalt weiter aufdecken','scene-next','small'):''}${q?.type==='splash'&&isOpen()&&Number(q.visualStep||0)<2?btn('Bild weiter aufdecken','splash-next','small'):''}${isOpen()&&quiz.questions.find(x=>x.id===q?.id)?.hints?.slice(Number(q.hintStep||0)).some(Boolean)?btn('Tipp '+Math.min(4,Number(q.hintStep||0)+1)+' freigeben','hint-next','primary'):''}
 <details class="bq-auxiliary" data-bq-persist="hostmore"><summary>Mehr · Timer, Chat, Buzzer & Punkte</summary><div class="bq-host-detail"><section><h3>Timer und Buzzer</h3>${buzzerStatus()}<div class="row">${btn(p.settings?.buzzerEnabled?'Buzzer deaktivieren':'Buzzer aktivieren','toggle-buzz','small')}${btn(p.settings?.chatOpen?'Chat sperren':'Chat öffnen','toggle-chat','small')}</div><div class="row"><select id="time-choice" aria-label="Timerdauer">${[15,30,45,60,90,120,180].map(n=>`<option value="${n}">${n} Sekunden</option>`).join('')}</select>${btn('Timer starten','start-timer','small')}${btn('Timer beenden','stop-timer','small',p.deadline?'':'disabled')}</div></section><section><h3>Antworten</h3>${renderResponses()}${renderChat()}</section>${scorePanel()}</div></details></div>
 ${sessionFooter()}</section>`;
}
function renderResponses(){const list=Object.values(responses?.[roundKey()]||{}).sort((a,b)=>(a.at||0)-(b.at||0));if(!list.length)return '<div class="empty">Noch keine eingegangenen Antworten.</div>';const source=canHost()?quiz.questions.find(q=>q.id===activeQuestion()?.id):null;const ranking=source?.type==='estimate'?rankEstimates(list,source.estimateTarget):[];return `${ranking.length?`<div class="hint"><b>Schätz-Ranking (nur Host):</b> Zielwert ${e(source.estimateTarget)} ${e(source.estimateUnit||'')} · ${ranking.map((r,i)=>`${i+1}. ${e(roster?.[r.uid]?.name||'Spieler')} (${e(r.value)}, Δ${e(Number(r.difference.toFixed(3)))})`).join(' · ')}<br><span class="small">Die Punkte werden bewusst weiterhin vom Host vergeben, damit Gleichstände und Sonderregeln manuell geprüft werden können.</span></div>`:''}<div class="roster">${list.map(r=>`<div class="person"><div><b>${e(roster?.[r.uid]?.name||r.uid.slice(0,7))}</b><small>${e(teamName(r.team))} · ${r.at?new Date(r.at).toLocaleTimeString('de-DE'):''}</small><p style="margin:4px 0 0">${e(r.text)}</p></div><div class="row">${btn('Entfernen','erase-answer','small danger',`data-uid="${e(r.uid)}"`)}</div></div>`).join('')}</div>`;}
function renderGuestLive(){
 if(!hasLiveQuestion())return boardScene(false);
 if(reviewIsCurrent(publicState))return renderReviewView();
 const q=activeQuestion(),open=isOpen(),b=winner(),written=roundMode(q)==='written',timeUp=!!publicState.deadline&&publicState.deadline<now(),lockedOut=isBuzzLocked(game?.uid);
 const allowedBuzz=canBuzz(publicState,buzzers,game?.uid,member?.team,now());
 const canWrite=guestCanAnswer()&&!myResponse;
 const participantHasMap=q.type==='map'&&open&&(written?!!publicState.answerParticipants?.[game?.uid]:b?.uid===game?.uid);
 const mapSubmitAllowed=q.type==='map'&&canMapPick()&&!!mapPick;
 const writtenUI=`<div class="bq-guest-mode"><h3>✍️ Alle antworten</h3><p>Jede Person gibt eine eigene Antwort ab. Der Host öffnet anschließend die Übersicht mit verdeckten Antworten.</p></div><form id="answer-form" class="formgrid">${q.type==='map'?`<div class="bq-map-hint">📍 Tippe auf die Weltkarte, um einen Pin zu setzen.</div><p class="bq-map-result">${mapPick?`Ausgewählt: ${mapPick.x} % Ost / ${mapPick.y} % Süd`:'Noch kein Kartenpunkt gewählt'}</p>`:q.type==='estimate'?`<label class="field span2">Schätzung (${e(q.estimateUnit||'Zahl')})<input id="answer-number" type="number" step="any" inputmode="decimal" ${canWrite?'':'disabled'}></label>`:`<label class="field span2">Deine geheime Antwort<textarea id="answer-text" rows="3" maxlength="800" placeholder="Antwort eingeben" ${canWrite?'':'disabled'}>${e(myResponse?.text||'')}</textarea></label>`}${btn(q.type==='map'?(myResponse?'Pin aktualisieren':'Pin verbindlich senden'):(myResponse?'Antwort abgegeben':'Antwort verbindlich senden'),'submit-answer','primary bq-big-control',(q.type==='map'?mapSubmitAllowed:canWrite)?'':'disabled')}</form><p class="small ${myResponse?'good':'muted'}">${myResponse?(q.type==='map'?'Pin gespeichert. Du kannst ihn bis zum Rundenende ändern und erneut senden.':'Antwort gespeichert. Andere sehen sie erst nach Host-Aufdeckung.'):'Die Antwort bleibt bis zur Aufdeckung verborgen.'}</p>`;
 const buzzUI=`<div class="bq-guest-mode"><h3>🎙️ Buzzerfrage</h3><p>${b?`<b>${e(b.name)} (${e(teamName(b.team))})</b> darf jetzt antworten.`:'Sobald du bereit bist, auf den Buzzer drücken. Das erste gültige Signal gewinnt – unabhängig davon, wer die Frage ausgewählt hat.'}</p><p class="small muted">Die Antwort wird außerhalb von BrainQuiz gegeben. Der Host bewertet direkt im Quiz.</p></div><button type="button" class="btn primary bq-big-buzzer" data-action="buzz" ${allowedBuzz?'':'disabled'}>${lockedOut?'Für diese Runde gesperrt':publicState?.buzzerResolved?.[roundKey()]?'Bereits richtig beantwortet':b?'Buzzer belegt':'◉ JETZT BUZZERN (B)'}</button>${lockedOut?'<p class="small bad">Du bzw. dein Team seid nach einer falschen Antwort bis zur Host-Freigabe gesperrt.</p>':''}${participantHasMap?`<div class="bq-map-hint">📍 Tippe auf die Weltkarte und bestätige deinen Pin.</div><p class="bq-map-result">${mapPick?`Ausgewählt: ${mapPick.x} % / ${mapPick.y} %`:'Noch kein Ort gewählt'}</p>${!written?btn('Kartenpunkt senden','submit-map','primary bq-big-control',mapPick?'':'disabled'):''}`:''}${myResponse&&q.type==='map'?'<p class="small good">Kartenpunkt beim Host eingegangen. Bis zum Rundenende kannst du ihn aktualisieren.</p>':''}`;
 return `<section class="bq-session-scene bq-question-scene" data-scene="question"><div class="bq-scene-heading"><div><span class="bq-eyebrow">FRAGE ${e(publicState.round)}</span><h2>${e(q.category)} · ${e(q.points)} Punkte</h2></div><span class="pill ${open?'good':''}">${open?'Offen':publicState.phase==='paused'?'Pausiert':'Warten'}</span></div><div class="bq-question-body"><section class="glass panel bq-question-panel"><div class="bq-scene-content">${renderStage()}</div></section><section class="glass panel bq-guest-compose"><div class="panelhead"><h3>${written?'Schriftliche Runde':'Dein Buzzer'}</h3>${publicState.deadline?'<span class="pill" id="clock">–:––</span>':''}</div>${written?writtenUI:buzzUI}<details class="bq-auxiliary" data-bq-persist="teamchat"><summary>Privater Teamchat</summary>${renderChat()}</details></section></div>${sessionFooter()}</section>`;
}
function renderTeams(){
 if(!publicState)return '<div class="empty">Lade Lobby …</div>';
 const lobby=lobbySnapshot({public:publicState,roster,members,presence});
 const accepted=Object.entries(roster||{}).filter(([,p])=>p?.name&&p?.team);
 const waiting=Object.entries(members||{}).filter(([,p])=>p?.status==='pending');
 const slots=freeSlots(roster),occupied=approvedCount(roster),canAdmit=slots>0&&canArrangeLobby(publicState);
 const pendingHTML=waiting.map(([id,p])=>{
  const request=p.teamRequest||null;
  const manual=pendingTeamChoices.get(id);
  const choice=manual!==undefined?manual:request?.kind==='join'?request.id:request?.kind==='create'?'':'t1';
  const requestText=request?.kind==='create'?'Neues Team: '+request.name:request?.kind==='join'?'Gewünscht: '+(publicState.teams?.[request.id]||'unbekannt'):'Noch kein Team gewählt';
  const options=(request?.kind==='create'?[['','Team „'+request.name+'“ erstellen']]:[]).concat(Object.entries(publicState.teams||{}));
  return `<div class="person"><div class="bq-lobby-request"><b>${e(p.name)}</b><small>${e(requestText)}</small><span class="bq-lobby-request-ready ${p.ready?'ready':''}">${p.ready?'✓ Bereit':'Noch nicht bereit'}</span></div><div class="row"><select class="input" style="min-width:145px;max-width:190px" id="team-${e(id)}" aria-label="Team für ${e(p.name)} wählen">${options.map(([tid,name])=>`<option value="${e(tid)}" ${choice===tid?'selected':''}>${e(name)}</option>`).join('')}</select>${btn(!slots?'Raum voll':canAdmit?'Zulassen':'Spiel läuft','approve','primary small',`data-uid="${e(id)}" ${canAdmit?'':'disabled title="Aufnahme nur vor Spielbeginn möglich"'}`)}${btn('Ablehnen','kick','small danger',`data-uid="${e(id)}"`)}</div></div>`;
 }).join('');
 return `${hostLobbySummary(lobby)}<div class="grid"><div class="stack"><section class="glass panel"><div class="panelhead"><h3>Beitrittsanfragen</h3><span class="pill ${waiting.length?'warn':''}">${waiting.length} ANFRAGEN</span></div>${waiting.length?`<div class="roster">${pendingHTML}</div>`:'<div class="empty">Aktuell keine wartenden Spieler.</div>'}</section><section class="glass panel"><div class="panelhead"><h3>Teilnehmer</h3><span class="pill ${slots?'good':'warn'}">${occupied}/${MAX_PLAYERS} PLÄTZE</span></div>${!slots?'<p class="small muted">Der Raum ist voll. Entferne einen Spieler, um einen Platz freizugeben.</p>':''}<div class="roster">${accepted.length?accepted.map(([id,p])=>`<div class="person"><div class="row"><span class="dot ${presence?.[id]?'live':''}"></span><div><b>${e(p.name)}</b><small><span class="bq-team-swatch" style="--bq-team-color:${teamColor(p.team)}" aria-hidden="true"></span> ${e(teamName(p.team))} · ${presence?.[id]?'Online':'Nicht verbunden'} · ${members[id]?.ready?'✓ Bereit':'Nicht bereit'}</small></div></div>${btn('Entfernen','kick','small danger',`data-uid="${e(id)}"`)}</div>`).join(''):'<div class="empty">Noch keine Teilnehmer freigegeben.</div>'}</div></section></div><div class="stack"><section class="glass panel"><div class="panelhead"><h3>Teilnehmerpunkte</h3></div>${personScores().map(p=>`<div class="scoreline"><span>${e(p.name)}</span><b>${p.points.toLocaleString('de-DE')}</b></div>`).join('')}</section><section class="glass panel"><div class="panelhead"><h3>Zugriff</h3></div><p>Der Host bestätigt Beitritte. Teams und Bereitschaft werden von Teilnehmern vor Spielbeginn selbst gewählt.</p></section></div></div>`;
}
function renderSetup(){return `<div class="grid"><section class="glass panel"><div class="panelhead"><h3>Spielraum & Einladung</h3><span class="pill good">GITHUB LIVE</span></div><label class="field">Raumcode<input readonly value="${e(room)}" class="mono" style="font-size:20px;letter-spacing:.14em"></label><div class="row" style="margin-top:12px">${btn('Einladungslink kopieren','invite','primary')}${btn('Raum-Link kopieren','copy-room','')}</div><div class="divider"></div><div class="hint">Die Website läuft unabhängig von deinem PC. Während der laufenden Runde muss der Host-Browser verbunden sein; nur die Gäste brauchen keine Installation.</div></section><div class="stack">${canHost()?`<section class="glass panel"><div class="panelhead"><h3>Private Host-Dateien</h3><span class="pill warn">NICHT VERSCHICKEN</span></div><p>Host-Quizdateien enthalten die Lösungen und Originalbilder. Nur der Host sollte sie erhalten.</p><div class="row">${btn('Host-Quiz exportieren','export','primary')}${btn('Quiz importieren','import','')}</div><input type="file" id="import-quiz" accept=".json,.brainquiz" hidden><div class="divider"></div>${btn('Spielstand zurücksetzen','reset-questions','danger small')} ${btn(isPublished()?'Spielraum schließen':'Lobby schließen','leave-host-room','danger small')}</section>`:''}<section class="glass panel"><div class="panelhead"><h3>Verbindungsdetails</h3></div><div class="hint"><b>PeerJS / WebRTC</b><br>Verbindung: ${connected?'Aktiv':'Unterbrochen'}<br>Angemeldet: ${e(game?.uid?.slice(0,14)||'–')}…<br>Der Host-Browser hält den Spielstand. Vor dem Schließen ein Quiz-Backup exportieren.</div></section></div></div>`;}
function currentQuestion(){return quiz.questions.find(q=>q.id===selected)||quiz.questions[0]||null;}
function renderEditor(){return studio.render();}
function renderPresenter(){
 if(reviewIsCurrent(publicState))return renderReviewView();
 const q=isOffline()?currentQuestion():activeQuestion();const live=!isOffline();const idx=quiz.questions.findIndex(x=>x.id===q?.id),n=quiz.questions.length;
 return `<section class="glass panel presenter"><div class="panelhead"><div><h3>${q?e(q.title):'Keine Frage ausgewählt'}</h3></div><div class="row">${btn('Vollbild','fullscreen','small')}${live?btn('Zurück zum Quizbrett','view','small','data-view="live"'):btn('Zurück zum Editor','view','small','data-view="editor"')}</div></div>
 <div class="presenter-stage">${q?(live?renderStage():`<div class="stage"><div class="eyebrow">${e(q.category)}</div>${q.scene?renderScene(publicScene(q.scene,previewRevealed?6:previewSceneStep,previewRevealed),{revealed:previewRevealed,correctIndex:q.correct||0}):`${q.prompt?`<h2>${e(q.prompt)}</h2>`:''}${renderBlocks(q.blocks,{reveal:previewRevealed})}`}${previewRevealed&&q.answer?`<div class="answer">${e(q.answer)}</div>`:''}</div>`):'<div class="empty">Erstelle oder veröffentliche zunächst eine Frage.</div>'}</div>
 <div class="row presenter-controls">${btn('← Vorherige','present-prev','',idx>0?'':'disabled')}<span class="pill">${Math.max(0,idx+1)} / ${n}</span>${btn('Nächste →','present-next','primary',idx<n-1?'':'disabled')}${q?.scene&&!live&&!previewRevealed&&sceneHasStep(q,previewSceneStep)?btn('Nächster Hinweis','present-step','small'):''}${q?btn(live?(publicState.phase==='reveal'?'Aufgelöst':'Lösung zeigen'):(previewRevealed?'Lösung verbergen':'Lösung zeigen'),'present-reveal','') : ''}</div>
 </section>`;
}
async function publish(){if(!canHost()||isOffline())throw Error('Zum Live-Veröffentlichen bitte zuerst einen Online-Raum erstellen.');if(isPublished())throw Error('Dieses Quiz ist bereits veröffentlicht. Neue Fragen können erst in einem neuen Quiz erstellt werden.');quiz.questions.forEach(q=>{if(q.scene)reconcileQuestion(q)});const audit=quizAudit(quiz);if(!audit.ready){view='editor';selected=audit.errors[0]?.id||selected;schedule();throw Error(`Quizcheck: ${audit.errors.length} Fehler. ${audit.errors.slice(0,3).map(x=>x.label+': '+x.reason).join(' | ')}. Öffne „Quizcheck“ im Editor.`);}if(audit.warnings.length&&!confirm(`${audit.warnings.length} Hinweise im Quizcheck. Trotzdem veröffentlichen?`))return;
 if(Object.keys(roster).length&&!confirm('Das Live-Quizbrett wird neu veröffentlicht: aktuelle Frage, Punkte und bisherige gespielte Kacheln werden zurückgesetzt. Fortfahren?'))return;
 clearTimeout(cloudTimer);cloudTimer=null;await serializedCloudWrite(room,normalizedQuiz(quiz));cloudDirty=false;saveState='Im Host-Browser gesichert';
 const teams={...(publicState?.teams||{}),...buildTeams(quiz)};const teamScores=Object.fromEntries(Object.keys(teams).map(id=>[id,0]));
 const p={title:quiz.title,published:true,scoreMode:quiz.scoreMode||'team',phase:'board',current:null,round:0,deadline:0,pausedRemaining:0,teams,scores:teamScores,manualPlayers:manualPlayerLabels(quiz),playerScores:{_empty:true},board:buildPublicBoard(quiz),used:{_empty:true},answerReview:null,answerParticipants:null,buzzerBlocked:{_empty:true},settings:publicState?.settings||{buzzerEnabled:true,chatOpen:true,lockOnBuzz:false,timerSeconds:60}};
 await game.clearRoomEvents(room);await game.replacePublic(room,p);
 const existing=Object.entries(members||{}).filter(([,m])=>m.status==='approved'&&!p.teams[m.team]);for(const [id,m] of existing){await game.hostAssign(room,id,m,'t1');}
 try{localStorage.setItem('bq-published-'+room,'1')}catch{}scoreTarget='';saveLocal();notice('Quizbrett live veröffentlicht. Alle Clients erhalten die neuen Fragenkacheln.');view='live';schedule();}
function updateDraftField(target){if(!canHost()||view!=='editor'||isPublished())return;const q=currentQuestion(),id=target.id;if(!id)return;
 if(id==='quiz-title')quiz.title=target.value.slice(0,100);else if(id==='quiz-manual-players')quiz.manualPlayers=target.value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,24);else if(id==='quiz-description')quiz.description=target.value.slice(0,400);else if(id==='quiz-teams')quiz.teams=target.value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,5);
 else if(q){const mapping={'q-category':'category','q-title':'title','q-prompt':'prompt','q-answer':'answer','q-explanation':'explanation','q-points':'points','q-correct':'correct','q-zoom':'zoom','q-crop-x':'cropX','q-crop-y':'cropY','q-imposter':'imposterIndex','q-seconds':'seconds','q-clue':'clue','q-estimate-target':'estimateTarget','q-estimate-unit':'estimateUnit','q-audio-start':'audioStart','q-audio-duration':'audioDuration'};
 if(mapping[id])q[mapping[id]]=['points','correct','zoom','cropX','cropY','imposterIndex','seconds','estimateTarget','audioStart','audioDuration'].includes(mapping[id])?Number(target.value):target.value;
 if(id.startsWith('q-option-'))q.options[Number(id.slice(-1))]=target.value;
 if(id==='q-type')q.type=target.value;
 if(id==='q-order-items')q.orderItems=target.value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,6);
 if(id.startsWith('q-hint-'))q.hints[Number(id.slice(-1))]=target.value;}
 saveLocal();}
async function hostOpen(id){
 if(openingQuestion)throw Error('Eine Frage wird bereits geöffnet.');
 if(!canHost()||!publicState||!['board','reveal'].includes(publicState.phase))throw Error('Beende zuerst die aktuelle Frage.');
 const q=quiz.questions.find(x=>x.id===id);
 if(!q||!validQuestionPair(publicState,q))throw Error('Dieses Fragenfeld ist nicht mehr verfügbar oder gehört nicht zum aktuellen Quizbrett.');
 const invalid=validateQuestion(q);if(invalid)throw Error('Diese Frage ist noch unvollständig: '+invalid);
 const expectedRound=Number(publicState.round)||0;
 openingQuestion=true;
 try{
  let visual='';if(q.type==='splash')visual=await splashPreview(q.image,q,false);
  if(q.type==='order')visual=q.scene?.template==='order'?(q.orderDisplayItems||[]):shuffledItems(q.orderItems);
  const playerQuestion=publicQuestion(q,false,visual,0);if(q.type==='splash')playerQuestion.visualStep=0;
  const participants=isOffline()||q.roundMode!=='written'?null:participantSnapshot(roster);
  const deadline=!isOffline()&&q.seconds>0?now()+q.seconds*1000:0;
  if(isOffline()){
   const next=openQuestionState(publicState,{expectedRound,question:q,playerQuestion,participants,deadline});
   if(!next)throw Error('Das Fragenfeld wurde inzwischen geöffnet.');
   publicState=next;questionHistory[String(next.round)]=createHistoryEntry(q,next.round,now());saveOfflineSession();schedule();return;
  }
  const next=await game.openQuestion(room,expectedRound,q,playerQuestion,participants,deadline);
  // The round is published atomically. Noncritical side effects are deliberately
  // scoped to the committed round and cannot replace another current question.
  await game.clearPicks(room).catch(error);
  await game.recordQuestion(room,next.round,createHistoryEntry(q,next.round,now())).catch(error);
 }finally{openingQuestion=false;}
}
async function hostReveal(){const q=quiz.questions.find(x=>x.id===publicState?.current?.id);if(!q)throw Error('Originalfrage im Host-Quiz fehlt. Eine Host-Quizdatei importieren.');
 const v=q.type==='order'?publicState.current.displayItems:q.image||'';
 await game.updateCurrent(room,Number(publicState.round),q.id,{current:publicQuestion(q,true,v,publicState.current.hintStep||0,6),phase:'reveal',deadline:0,pausedRemaining:0},['question','paused','review']);
}
async function hostHint(){const q=quiz.questions.find(x=>x.id===activeQuestion()?.id);if(!q||!isOpen())return;const current=Number(activeQuestion()?.hintStep||0);if(current>=4)return;const next=(q.hints||[]).findIndex((h,i)=>i>=current&&h.trim());if(next<0)return;const v=q.type==='order'?activeQuestion().displayItems:activeQuestion().image||'';const pub=publicQuestion(q,false,v,next+1,Number(activeQuestion()?.scene?.step||0));if(q.type==='splash')pub.visualStep=Number(activeQuestion().visualStep||0);await game.updateCurrent(room,Number(publicState.round),q.id,{current:pub},['question']);}
async function hostSplashNext(){const q=quiz.questions.find(x=>x.id===activeQuestion()?.id);if(!q||q.type!=='splash'||!isOpen())return;const expectedRound=Number(publicState.round);const next=Math.min(2,Number(activeQuestion().visualStep||0)+1);const visual=await splashPreview(q.image,{...q,zoom:splashStageZoom(q.zoom,next)},false);const pub=publicQuestion(q,false,visual,Number(activeQuestion().hintStep)||0,Number(activeQuestion()?.scene?.step||0));pub.visualStep=next;await game.updateCurrent(room,expectedRound,q.id,{current:pub},['question']);}
async function hostSceneNext(){const source=quiz.questions.find(x=>x.id===activeQuestion()?.id);if(!source?.scene||!isOpen())return;const step=Number(activeQuestion()?.scene?.step||0);if(step>=5)return;const next=step+1;const v=source.type==='order'?activeQuestion().displayItems:activeQuestion().image||'';const pub=publicQuestion(source,false,v,Number(activeQuestion()?.hintStep||0),next);if(source.type==='splash')pub.visualStep=Number(activeQuestion().visualStep||0);if(isOffline()){publicState.current=pub;schedule();}else await game.updateCurrent(room,Number(publicState.round),source.id,{current:pub},['question']);}
async function hostPause(){let remains=publicState.deadline?Math.max(0,publicState.deadline-now()):0;await game.updateCurrent(room,Number(publicState.round),publicState.current.id,{phase:'paused',deadline:0,pausedRemaining:remains},['question']);}
async function hostResume(){const ms=publicState.pausedRemaining||0;await game.updateCurrent(room,Number(publicState.round),publicState.current.id,{phase:'question',deadline:ms?now()+ms:0,pausedRemaining:0},['paused']);}
function makeQuestion(){return normalizedQuiz({questions:[{id:uid(),roundMode:'buzzer',category:'Neue Kategorie',title:'Neue Frage',type:'text',points:100,prompt:'',answer:'',explanation:'',cropX:50,cropY:50,zoom:3,icons:['','','','',''],abilityNames:ABILITIES,orderItems:[],seconds:0,hints:['','','','']}] ,teams:quiz.teams,title:quiz.title}).questions[0]}
const studio=createStudioEditor({
 getQuiz:()=>quiz,getQuestion:()=>currentQuestion(),setSelected:id=>{selected=id},
 boardInfo:()=>({id:boardId,title:quiz.title,isLocal:isOffline(),conflict:boardConflict,boards:isOffline()?boardList(localStorage):[]}),
 save:()=>saveLocal(),saveStatus:()=>saveState,notice,newId:uid,snapshot:()=>snapshotLayout(),discardSnapshot:()=>{undoStack.pop();},undo:()=>undoLayout('undo'),redo:()=>undoLayout('redo'),error:error,isOffline,onlineReady:()=>configured,
 optimizeImage,optimizeAudio,backup:()=>safeDownload(backupFilename('BrainQuiz_Backup'),JSON.stringify(normalizedQuiz(quiz),null,2)),
 makeQuestion:(category,template='text')=>{if(quiz.questions.length>=180)throw Error('Maximal 180 Fragen pro Quiz.');snapshotLayout();const q=makeQuestion();q.category=category;q.title=category+' '+q.points;quiz.categories=collectCategories(quiz.categories,quiz.questions.concat(q));if(template!=='text'){const names={multiple:'multiple',order:'order',estimate:'estimate',imposter:'imposter',quote:'quote',audio:'audio',map:'map'};q.type=names[template]||'text';if(template==='image'||template==='map')q.scene=templateScene(template,q);if(template==='written'||template==='map')q.roundMode='written';}quiz.questions.push(q);selected=q.id;saveLocal();},
 quickset:cats=>{const items=quickBoard(cats);if(quiz.questions.length+items.length>180)throw Error('Maximal 180 Fragen.');snapshotLayout();quiz.questions.push(...items);quiz.categories=collectCategories(quiz.categories,quiz.questions);selected=items[0]?.id||selected;saveLocal();},
 copyQuestion:(targetId)=>{const q=(targetId?quiz.questions.find(x=>x.id===targetId):null)||currentQuestion();if(!q)return;if(quiz.questions.length>=180)throw Error('Maximal 180 Fragen pro Quiz.');snapshotLayout();const next=JSON.parse(JSON.stringify(q));next.id=uid();next.title+=' (Kopie)';quiz.questions.push(next);selected=next.id;saveLocal();},
 deleteQuestion:()=>{const old=currentQuestion();if(!old)return;snapshotLayout();quiz.questions=quiz.questions.filter(x=>x.id!==old.id);selected=quiz.questions[0]?.id||'';saveLocal();}
});
async function doAction(action,button){if(isPublished()&&editorOnlyActions.has(action))throw Error('Das veröffentlichte Quiz ist gesperrt. Erstelle für weitere Fragen ein neues Quiz.');switch(action){
 case 'create-offline':startOffline();return;
 case 'open-landing-board':startOffline(button.dataset.boardId);return;
 case 'new-board':newStoredBoard();return;
 case 'open-board':openStoredBoard(button.dataset.boardId);return;
 case 'rescue-board':rescueStoredBoard();return;
 case 'reload-board':reloadStoredBoard();return;
 case 'toggle-quickset':quickSetExpanded=!quickSetExpanded;schedule();return;
 case 'quick-add':case 'quick-replace':{const text=$('quick-categories')?.value||DEFAULT_CATEGORIES.join('\n');const cats=[...new Set(text.split(/\n|,/).map(x=>x.trim()).filter(Boolean))].slice(0,10);if(!cats.length)throw Error('Mindestens eine Kategorie eintragen.');let newItems=quickBoard(cats);if(action==='quick-add'){const present=new Set(quiz.questions.map(q=>q.category.trim().toLocaleLowerCase('de')+'|'+q.points));newItems=newItems.filter(q=>!present.has(q.category.trim().toLocaleLowerCase('de')+'|'+q.points));}if(!newItems.length){notice('Alle Felder dieser Kategorien sind bereits vorhanden.');return;}if(action==='quick-replace'&&quiz.questions.length&&!confirm('Alle bestehenden Fragen durch das neue Raster ersetzen?'))return;if(action==='quick-add'&&quiz.questions.length+newItems.length>180)throw Error('Das Limit von 180 Fragen wäre überschritten.');snapshotLayout();quiz.questions=action==='quick-replace'?newItems:[...quiz.questions,...newItems];quiz.categories=collectCategories(quiz.categories,quiz.questions);selected=newItems[0]?.id||selected;saveLocal();quickSetExpanded=false;schedule();notice(newItems.length+' Fragenfelder angelegt.');return;}
 case 'add-person':{if(!canHost())return;const name=prompt('Spielername (maximal 28 Zeichen):')?.trim().slice(0,28);if(!name)return;if((quiz.manualPlayers||[]).length>=24)throw Error('Maximal 24 manuell angelegte Spieler.');if(!quiz.manualPlayers)quiz.manualPlayers=[];quiz.manualPlayers.push(name);const id='manual_'+quiz.manualPlayers.length;saveLocal();scoreTarget=id;if(isOffline()){publicState.manualPlayers=manualPlayerLabels(quiz);schedule();}else await game.setState(room,{['manualPlayers/'+id]:name});return;}
 case 'next-incomplete':{const from=quiz.questions.findIndex(q=>q.id===selected);const ordered=[...quiz.questions.slice(from+1),...quiz.questions.slice(0,from+1)];const candidate=ordered.find(q=>validateQuestion(q));if(!candidate){notice('Alle Fragen vollständig.');return;}selected=candidate.id;settingsExpanded=false;editingBlock='';schedule();requestAnimationFrame(()=>$('q-prompt')?.focus());return;}
 case 'select-player':scoreTarget=button.dataset.person;schedule();return;
 case 'unlock-buzz-player':{if(!canHost()||!scoreTarget)throw Error('Person auswählen.');if(isOffline()){if(publicState?.buzzerBlocked?.[roundKey()])delete publicState.buzzerBlocked[roundKey()][scoreTarget];saveOfflineSession();schedule();}else await game.setState(room,{['buzzerBlocked/'+roundKey()+'/'+scoreTarget]:null,['buzzerBlockedTeams/'+roundKey()+'/'+(roster?.[scoreTarget]?.team||'')]:null});notice('Buzzer-Freigabe aktualisiert.');return;}
 case 'unlock-buzz-all':{if(!canHost())return;if(isOffline()){if(publicState?.buzzerBlocked)publicState.buzzerBlocked[roundKey()]={};saveOfflineSession();schedule();}else await game.setState(room,{['buzzerBlocked/'+roundKey()]:null,['buzzerBlockedTeams/'+roundKey()]:null});notice('Alle Sperren entfernt.');return;}
 case 'buzz-correct':case 'buzz-wrong':{if(!canHost()||!isOpen()||roundMode(activeQuestion())!=='buzzer'||!winner())throw Error('Kein aktiver Buzzer zu bewerten.');const b=winner(),verdict=action==='buzz-correct'?'correct':'wrong';if(isOffline())throw Error('Buzzerbewertung nur in einem Online-Raum verfügbar.');const result=await game.judgeBuzzer(room,roundKey(),b.uid,verdict);notice(verdict==='correct'?`${b.name} richtig: +${result.delta} Punkte.`:`Falsch: ${result.delta} Punkte. Buzzer für andere wieder offen.`);return;}
 case 'judge-review-correct':case 'judge-review-wrong':case 'judge-correct':case 'judge-wrong':{
  const person=action.startsWith('judge-review-')?button.dataset.person:scoreTarget;
  if(!canHost()||!person||!activeQuestion()||roundMode(activeQuestion())!=='written')throw Error('Bewerte schriftliche Antworten in der Antwortübersicht.');
  const result=action.endsWith('correct')?'correct':'wrong';
  if(!publicState?.answerReview?.entries?.[person]?.revealed)throw Error('Antwort vor Bewertung zuerst aufdecken.');
  if(isOffline()){
   publicState.playerScores??={};const previous=Number(publicState.playerScores[person]?.rounds?.[roundKey()]?.delta)||0;
   const next=updatePlayerScore(publicState.playerScores[person],{kind:'judgement',round:roundKey(),questionId:activeQuestion().id,points:Number(activeQuestion().points),result,at:now()});
   publicState.playerScores[person]=next;if(scoreMode(publicState)==='team'){const team=roster?.[person]?.team;if(team&&publicState.teams?.[team])publicState.scores[team]=(Number(publicState.scores?.[team])||0)+(Number(next.rounds[roundKey()].delta)||0)-previous;}
   saveOfflineSession();schedule();
  }else await game.judgeWritten(room,roundKey(),person,result);
  scoreTarget=person;notice(result==='correct'?'Antwort richtig bewertet.':'Antwort falsch bewertet: halbe Fragepunkte abgezogen.');return;
 }
 case 'adjust-player':{if(!canHost()||!scoreTarget)throw Error('Person auswählen.');const delta=Number($('person-adjust')?.value);const actionData={kind:'manual',delta,at:now()};if(isOffline()){publicState.playerScores??={};publicState.playerScores[scoreTarget]=updatePlayerScore(publicState.playerScores[scoreTarget],actionData);saveOfflineSession();schedule();}else await game.scorePerson(room,scoreTarget,actionData);notice('Punkte korrigiert.');return;}
 case 'score-page':{scorePage=Math.max(0,scorePage+Number(button.dataset.delta||0));schedule();return;}
 case 'board-page':{boardPage=Math.max(0,Math.min(boardPages().length-1,boardPage+Number(button.dataset.delta||0)));schedule();return;}
 case 'request-pick':{if(role!=='guest'||member?.status!=='approved')return;await game.requestPick(room,button.dataset.qid,member.name);notice('Fragenwunsch an den Host gesendet.');return;}
 case 'promote-online':await promoteOnline();return;
 case 'add-block':{const q=currentQuestion();if(!q)return;if(q.blocks.length>=18)throw Error('Maximal 18 Layout-Elemente pro Frage.');snapshotLayout();const b=newBlock(button.dataset.blockType||'text');q.blocks.push(b);editingBlock=b.id;saveLocal();schedule();return;}
 case 'select-block':editingBlock=button.dataset.blockId;inspectorExpanded=false;lastEditAt=0;schedule();return;
 case 'block-up':case 'block-down':{const q=currentQuestion(),i=q?.blocks.findIndex(x=>x.id===editingBlock),j=i+(action==='block-up'?-1:1);if(i<0||j<0||j>=q.blocks.length)return;snapshotLayout();[q.blocks[i],q.blocks[j]]=[q.blocks[j],q.blocks[i]];saveLocal();schedule();return;}
 case 'block-delete':{const q=currentQuestion();if(!q)return;snapshotLayout();q.blocks=q.blocks.filter(x=>x.id!==editingBlock);editingBlock=q.blocks[0]?.id||'';saveLocal();schedule();return;}
 case 'block-clone':{const q=currentQuestion(),b=chosenBlock();if(!b)return;if(q.blocks.length>=18)throw Error('Maximal 18 Layout-Elemente.');snapshotLayout();const copy={...b,id:blockId()};q.blocks.splice(q.blocks.indexOf(b)+1,0,copy);editingBlock=copy.id;saveLocal();schedule();return;}
 case 'clone-layout':{const q=currentQuestion();if(!q)return;if(!q.blocks.length)throw Error('Noch kein Layout vorhanden.');snapshotLayout();q.blocks=q.blocks.map(b=>({...b,id:blockId()}));editingBlock=q.blocks[0].id;saveLocal();schedule();notice('Layout-Elemente mit neuen IDs versehen.');return;}
 case 'undo-layout':undoLayout('undo');return;
 case 'redo-layout':undoLayout('redo');return;
 case 'fullscreen':{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();return;}
 case 'present-next':case 'present-prev':{const index=quiz.questions.findIndex(x=>x.id===(isOffline()?selected:activeQuestion()?.id)),next=index+(action==='present-next'?1:-1);if(next<0||next>=quiz.questions.length)return;selected=quiz.questions[next].id;if(isOffline()){previewRevealed=false;previewSceneStep=0;schedule()}else await hostOpen(selected);return;}
 case 'present-step':{if(isOffline()){previewSceneStep=Math.min(5,previewSceneStep+1);schedule();}return;}
 case 'present-reveal':{if(isOffline()){previewRevealed=!previewRevealed;schedule()}else if(publicState?.phase!=='reveal')await hostReveal();return;}

 case 'lobby-join':{if(role!=='guest')return;await game.chooseLobbyTeam(room,button.dataset.team);notice('Team ausgewählt.');return;}
 case 'lobby-ready':{if(role!=='guest')return;await game.setLobbyReady(room,button.dataset.ready==='true');notice(button.dataset.ready==='true'?'Bereit gemeldet.':'Bereitschaft zurückgenommen.');return;}
 case 'create':await createRoom();return;
 case 'leave-host-room':{if(!canHost()||isOffline())return;const active=isPublished();const msg=active?'Dieses laufende Quiz für alle Teilnehmer beenden und den Raum verlassen? Der Spielstand ist danach nicht mehr fortsetzbar.':'Diese Lobby ohne Quizstart schließen? Alle Teilnehmer werden getrennt; dein Entwurf bleibt als Host-Sicherung erhalten.';if(!confirm(msg))return;const oldRoom=room;let copiedDraft=false;if(!active&&quiz.questions.length){try{createBoard(localStorage,normalizedQuiz(quiz),makeBoardId);copiedDraft=true;}catch(err){throw Error('Entwurf konnte nicht als lokales Quizbrett gesichert werden. Die Lobby bleibt geöffnet: '+(err?.message||err));}}clearTimeout(cloudTimer);cloudTimer=null;cloudDirty=false;hostCloudReady=false;try{await cloudWriteTail}catch{}await game.deleteRoom(oldRoom);stopGuestListeners();game.clearWatchers();game=null;localStorage.removeItem('bq-last-host');localStorage.removeItem('bq-published-'+oldRoom);room='';role='landing';view='start';publicState=null;members={};roster={};presence={};responses={};buzzers={};messages={};connected=false;history.replaceState(null,'',location.pathname);schedule();notice(active?'Spielraum geschlossen.':copiedDraft?'Lobby geschlossen. Der Entwurf liegt unter deinen lokalen Quizbrettern.':'Lobby geschlossen.');return;}
  case 'resume':{const code=localStorage.getItem('bq-last-host');if(!code)throw Error('Kein vorheriger Hostraum gespeichert.');await enterRoom(code);return;}
 case 'view':if(isPublished()&&button.dataset.view==='editor'){notice('Dieses Quiz ist bereits veröffentlicht. Der Frageneditor bleibt geschlossen.');return;}view=button.dataset.view;if(isOffline()&&view==='live'){const board=buildPublicBoard(quiz,publicState?.used||{});publicState={...publicState,board,manualPlayers:manualPlayerLabels(quiz)};}schedule();return;
 case 'invite':{const link=location.origin+location.pathname+'?room='+room;await navigator.clipboard.writeText(`BrainQuiz Live\n${link}\nRaumcode: ${room}`);notice('Einladung kopiert.');return;}
 case 'copy-room':await navigator.clipboard.writeText(room);notice('Raumcode kopiert.');return;
 case 'select-q':selected=button.dataset.qid;editingBlock='';previewRevealed=false;previewImage='';lastEditAt=0;schedule();return;
 case 'new-q':{snapshotLayout();const q=makeQuestion();quiz.questions.push(q);selected=q.id;previewOpen=false;saveLocal();schedule();return;}
 case 'move-up':case 'move-down':{snapshotLayout();const i=quiz.questions.findIndex(x=>x.id===selected),j=i+(action==='move-up'?-1:1);if(i<0||j<0||j>=quiz.questions.length)return;[quiz.questions[i],quiz.questions[j]]=[quiz.questions[j],quiz.questions[i]];saveLocal();schedule();return;}
 case 'clone-q':{const q=currentQuestion();if(!q)return;snapshotLayout();const copy=JSON.parse(JSON.stringify(q));copy.id=uid();copy.title+=' (Kopie)';quiz.questions.push(copy);selected=copy.id;saveLocal();schedule();return;}
 case 'delete-q':{const q=currentQuestion();if(!q||!confirm(`Frage „${q.title}“ wirklich löschen?`))return;snapshotLayout();quiz.questions=quiz.questions.filter(x=>x.id!==q.id);selected=quiz.questions[0]?.id||'';saveLocal();schedule();return;}
 case 'preview-q':{previewOpen=!previewOpen;previewRevealed=false;previewImage='';const q=currentQuestion();if(previewOpen&&q?.type==='splash')previewImage=await splashPreview(q.image,q,false);schedule();return;}
 case 'preview-reveal':previewRevealed=!previewRevealed;schedule();return;
 case 'reset-order':pickedOrder=[];schedule();return;
 case 'pick-order':{const q=activeQuestion(),i=Number(button.dataset.index);if(q?.type!=='order'||!guestCanAnswer()||myResponse||pickedOrder.includes(i)||!Number.isInteger(i)||i<0||i>=q.displayItems?.length)return;pickedOrder.push(i);schedule();return;}
 case 'splash-next':if(!canHost())return;await hostSplashNext();return;
 case 'hint-next':if(!canHost())return;await hostHint();return;
 case 'scene-next':if(!canHost())return;await hostSceneNext();return;
 case 'save-q':saveLocal();if(!isOffline()){cloudDirty=true;await flushHostCloudSave();notice('Frage privat im Host-Browser gesichert.');}else notice('Frage lokal gespeichert.');return;
 case 'import':$('import-quiz')?.click();return;
 case 'export':safeDownload(backupFilename(),JSON.stringify(normalizedQuiz(quiz),null,2));notice('Quizbrett als privates Backup exportiert. Nicht an Teilnehmer weitergeben!');return;
 case 'publish':await publish();return;
 case 'select-choice':{if(!canHost()&&isOpen()&&!myResponse){guestChoice=button.dataset.choice||'';const target=$('answer-text');if(target)target.value=guestChoice;schedule();}return;}
 case 'custom-score':{const team=$('custom-team')?.value,amount=Number($('custom-points')?.value);if(!canHost()||!publicState.teams[team]||!Number.isInteger(amount)||Math.abs(amount)>10000||!amount)throw Error('Bitte gültige Punktkorrektur zwischen -10.000 und +10.000 eingeben.');if(isOffline()){publicState.scores[team]=(Number(publicState.scores[team])||0)+amount;schedule();}else await game.score(room,team,amount);notice('Punkte korrigiert.');return;}
 case 'open':if(!canHost())return;await hostOpen(button.dataset.qid);return;
 case 'start-review':if(roundMode(activeQuestion())!=='written')throw Error('Antwortübersicht ist nur für Schreib-Runden.');await startAnswerReview(false);return;
 case 'reveal-answer':await publishOneAnswer(button.dataset.uid);return;
 case 'reveal-all-answers':await publishAllAnswers();return;
 case 'reveal':if(!canHost()||!activeQuestion())return;if(isOffline()){const q=quiz.questions.find(x=>x.id===activeQuestion()?.id);publicState={...publicState,phase:'reveal',current:publicQuestion(q,true,q.image||'',3)};schedule();}else await hostReveal();return;
 case 'pause':if(isOffline()){publicState.pausedRemaining=publicState.deadline?Math.max(0,publicState.deadline-now()):0;publicState.deadline=0;publicState.phase='paused';schedule();}else await hostPause();return;
 case 'resume-round':if(isOffline()){publicState.deadline=publicState.pausedRemaining?now()+publicState.pausedRemaining:0;publicState.pausedRemaining=0;publicState.phase='question';schedule();}else await hostResume();return;
 case 'back':if(publicState?.phase==='question'&&Object.keys(responses?.[roundKey()]||{}).length&&!confirm('Es liegen Antworten vor. Trotzdem zurück zum Quizbrett?'))return;if(isOffline()){publicState={...publicState,phase:'board',current:null,deadline:0};saveOfflineSession();schedule();}else if(publicState?.current?.id)await game.updateCurrent(room,Number(publicState.round),publicState.current.id,{phase:'board',current:null,deadline:0,pausedRemaining:0,answerReview:null,answerParticipants:null},['question','paused','review','reveal']);return;
 case 'reset-buzz':if(isOffline()){buzzers={};schedule();}else await game.clearBuzzer(room,roundKey());return;
 case 'toggle-buzz':if(isOffline()){publicState.settings.buzzerEnabled=!publicState.settings.buzzerEnabled;schedule();}else await game.setState(room,{'settings/buzzerEnabled':!publicState.settings.buzzerEnabled});return;
 case 'toggle-chat':if(isOffline()){publicState.settings.chatOpen=!publicState.settings.chatOpen;schedule();}else await game.setState(room,{'settings/chatOpen':!publicState.settings.chatOpen});return;
 case 'toggle-lock':if(isOffline()){publicState.settings.lockOnBuzz=!publicState.settings.lockOnBuzz;schedule();}else await game.setState(room,{'settings/lockOnBuzz':!publicState.settings.lockOnBuzz});return;
 case 'start-timer':{const seconds=Number($('time-choice')?.value||60);if(isOffline()){publicState={...publicState,deadline:now()+seconds*1000,phase:'question'};schedule();return;}await game.setState(room,{'settings/timerSeconds':seconds,deadline:now()+seconds*1000,phase:'question'});return;}
 case 'stop-timer':if(isOffline()){publicState.deadline=0;schedule();}else await game.setState(room,{deadline:0});return;
 case 'jump-answers':$('responses-panel')?.scrollIntoView({behavior:'smooth'});return;
 case 'approve':{
  const target=button.dataset.uid,player=members[target];
  if(!player||player.status!=='pending')throw Error('Beitrittsanfrage nicht verfügbar.');
  const team=pendingTeamChoices.has(target)?pendingTeamChoices.get(target):$('team-'+target)?.value||'';
  if(!team&&player.teamRequest?.kind!=='create')throw Error('Bitte ein Team auswählen.');
  if(team&&!publicState.teams?.[team])throw Error('Das Team existiert nicht.');
  if(freeSlots(roster)===0)throw Error(`Alle ${MAX_PLAYERS} Spielerplätze sind belegt.`);
  await game.hostAssign(room,target,player,team);pendingTeamChoices.delete(target);
  notice(player.name+' wurde freigegeben.');return;
 }
 case 'kick':{const target=button.dataset.uid;if(!members[target])return;if(!confirm('Teilnehmer aus Raum entfernen?'))return;await game.hostRemove(room,target,members[target]);return;}
 case 'score':{const amount=Number(button.dataset.amount),team=button.dataset.team;if(!canHost()||!publicState.teams[team]||!Number.isFinite(amount))throw Error('Ungültige Punktevergabe.');await game.score(room,team,amount);return;}
 case 'erase-answer':{if(!canHost())return;await game.removeResponse(room,roundKey(),button.dataset.uid);return;}
 case 'buzz':{if(canHost()||!member||!isOpen()||winner())return;const wasFirst=await game.buzzer(room,roundKey(),member.team,member.name);notice(wasFirst?'Buzzer angekommen! Du bist zuerst gewesen.':'Ein anderer Buzzer war schneller.');return;}
 case 'submit-map':{if(canHost()||!member||activeQuestion()?.type!=='map'||!mapPick||winner()?.uid!==game?.uid||!isOpen())return;await game.answer(room,roundKey(),member.team,encodePoint(mapPick));notice('Kartenpunkt an den Host gesendet.');return;}
 case 'submit-answer':{if(canHost()||!member||!guestCanAnswer()||(myResponse&&activeQuestion()?.type!=='map')||roundMode(activeQuestion())!=='written')return;const q=activeQuestion();let text='';if(q?.type==='map'){text=encodePoint(mapPick)}else if(q?.type==='order'){if(pickedOrder.length!==q.displayItems?.length)throw Error('Bitte alle Sortiereinträge auswählen.');text=pickedOrder.map(i=>String.fromCharCode(65+i)).join(' → ');}else if(q?.type==='estimate'){const raw=$('answer-number')?.value||'';if(!raw.trim()||!Number.isFinite(Number(raw)))throw Error('Bitte einen gültigen Zahlenwert eingeben.');text=String(Number(raw));}else{text=$('answer-text')?.value?.trim()||'';}if(!text)throw Error('Bitte eine Antwort eingeben.');await game.answer(room,roundKey(),member.team,text);notice('Antwort gesendet.');return;}
 case 'export-history':{if(!canHost())return;const players=Object.fromEntries(participantList().map(([id,name])=>[id,{name}]));const rows=historyRows(questionHistory,responses,publicState?.playerScores,players);if(!rows.length)throw Error('Noch keine Fragerunden im Verlauf.');const solutions=Object.fromEntries(quiz.questions.map(q=>[q.id,q.answer]));const blob=new Blob([historyCsv(rows,solutions)],{type:'text/csv;charset=utf-8'});const href=URL.createObjectURL(blob);const link=document.createElement('a');link.href=href;link.download='BrainQuiz_Fragenverlauf.csv';link.click();setTimeout(()=>URL.revokeObjectURL(href),500);return;}
 case 'reset-questions':{boardPage=0;scorePage=0;if(!confirm('Alle Buzzer, Antworten, Spielrunden und Punkte zurücksetzen? Das Quiz im Editor bleibt erhalten.'))return;if(isOffline()){localStorage.removeItem('bq-session-LOCAL-'+boardId);questionHistory={};publicState={...publicState,current:null,phase:'board',round:0,deadline:0,playerScores:{},used:{},board:buildPublicBoard(quiz)};schedule();return;}await game.clearRoomEvents(room);await game.replacePublic(room,{...publicState,current:null,phase:'board',deadline:0,round:0,pausedRemaining:0,used:{_empty:true},board:buildPublicBoard(quiz),scores:Object.fromEntries(Object.keys(publicState?.teams||{}).map(id=>[id,0])),answerReview:null,answerParticipants:null});return;}
 default:return;}}
async function handleMessage(form){const text=$('chat-text')?.value.trim();if(!text)return;if(Date.now()-lastMsgTime<1100)throw Error('Bitte zwischen zwei Nachrichten kurz warten.');if(!canHost()&&!chatAllowed())throw Error('Teamchat wurde vorübergehend gesperrt.');
 const target=canHost()?chatTeam:member?.team,targets=target==='ALL'?Object.keys(publicState.teams||{}):[target],name=canHost()?'HOST':member.name;
 await Promise.all(targets.map(t=>game.message(room,t,name,text)));lastMsgTime=Date.now();$('chat-text').value='';}
async function handleUpload(input){const kind=input.dataset.image,file=input.files?.[0],q=currentQuestion();if(!file||!q)return;
 const data=await optimizeImage(file,kind==='main'?1350:500,kind==='main'?350000:65000);
 if(kind==='main')q.image=data;else if(kind==='icon')q.icons[Number(input.dataset.index)]=data;else if(kind==='correct-icon')q.correctIcon=data;
 saveLocal();schedule();notice('Bild verarbeitet und lokal gespeichert.');}
async function handleBlockUpload(input){const b=chosenBlock(),file=input.files?.[0];if(!b||b.type!=='image'||!file)return;const q=currentQuestion();snapshotLayout();const data=await optimizeImage(file,850,120000);b.image=data;b.alt=b.alt||file.name.replace(/\.[^.]+$/,'').slice(0,120);const total=q.blocks.reduce((sum,x)=>sum+(x.image?.length||0),0);if(total>780000){undoLayout('undo');throw Error('Bildmenge für eine Frage überschreitet 780 KB. Bitte weniger oder kleinere Bilder nutzen.');}saveLocal();schedule();notice('Bild optimiert und im Fragenlayout gespeichert.');}
async function handleAudioUpload(input){const q=currentQuestion(),file=input.files?.[0];if(!q||!file)return;notice('Audio wird lokal verarbeitet …');q.audio=await optimizeAudio(file,q.audioStart,q.audioDuration);saveLocal();schedule();notice('Audioclip verarbeitet, ohne Original-Metadaten gespeichert.');}
async function handleImport(input){if(isPublished())throw Error('Nach der Veröffentlichung können keine weiteren Fragen importiert werden.');const file=input.files?.[0];if(!file)return;if(file.size>8_000_000)throw Error('Host-Quizdatei zu groß (max. 8 MB).');const raw=JSON.parse(await file.text());if(!Array.isArray(raw.questions))throw Error('Datei enthält keine gültige Quiz-Fragensammlung.');const imported=normalizedQuiz(raw);if(isOffline()){studio.flush?.();if(!saveLocal())throw Error('Das aktuelle Quizbrett konnte nicht gespeichert werden.');const created=createBoard(localStorage,imported,makeBoardId);applyBoardWorkspace(created);loadOfflineBoardState();editorSearch='';view='editor';schedule();notice('Host-Quiz als eigenes Quizbrett importiert. Vorheriges Brett bleibt erhalten.');return;}if(!confirm('Quizbrett „'+quiz.title+'“ im aktuellen Live-Raum durch diese Datei ersetzen? Vorher wird automatisch ein Backup heruntergeladen.'))return;safeDownload(backupFilename('BrainQuiz_Vor_Import'),JSON.stringify(normalizedQuiz(quiz),null,2));snapshotLayout();quiz=imported;selected=quiz.questions[0]?.id||'';editingBlock='';previewOpen=false;previewRevealed=false;editorSearch='';if(!saveLocal())throw Error('Importiert, aber Speichern fehlgeschlagen. Quiz als Datei exportieren.');view='editor';schedule();notice('Host-Quiz importiert. Für Teilnehmer muss es noch live veröffentlicht werden.');}
function updateClock(){const el=$('clock');if(!el)return;const deadline=publicState?.deadline||0;if(!deadline){el.textContent='–:––';return;}const s=Math.max(0,Math.ceil((deadline-now())/1000));el.textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
const CRITICAL_HOST_ACTIONS=new Set(['open','reveal','start-review','reveal-all-answers','reveal-answer','back','score','judge-correct','judge-wrong','judge-review-correct','judge-review-wrong','publish','start-timer','stop-timer']);
const HOST_ACTION_FEEDBACK={open:'Frage geöffnet.',reveal:'Lösung freigegeben.','start-review':'Antwortübersicht geöffnet.','reveal-all-answers':'Antworten aufgedeckt.',score:'Punkte aktualisiert.'};
document.addEventListener('click',async ev=>{if(ev.target.closest('.question-settings summary'))settingsExpanded=!ev.target.closest('details').open;if(ev.target.closest('.inspector-advanced summary'))inspectorExpanded=!ev.target.closest('details').open;if(ev.target.closest('.quiz-metadata summary'))quizMetaExpanded=!ev.target.closest('details').open;const b=ev.target.closest('[data-action]');if(!b)return;ev.preventDefault();if(b.disabled)return;try{b.disabled=true;const action=b.dataset.action;if(canHost()&&CRITICAL_HOST_ACTIONS.has(action)){const key=[room,publicState?.round??0,action,b.dataset.uid||b.dataset.person||b.dataset.team||b.dataset.qid||''].join(':');await hostActionLease.run(key,async()=>{await doAction(action,b);if(HOST_ACTION_FEEDBACK[action])notice(HOST_ACTION_FEEDBACK[action]);});}else await doAction(action,b);}catch(err){error(err);}finally{if(document.contains(b))b.disabled=false;}});
document.addEventListener('submit',async ev=>{if(!['join-form','chat-form','answer-form','lobby-create-form','host-team-create-form'].includes(ev.target.id))return;ev.preventDefault();try{if(ev.target.id==='host-team-create-form'){if(!canHost()||isOffline())throw Error('Nur der Host des Live-Raums kann Teams erstellen.');const input=$('bq-host-team-name');const created=await game.hostCreateLobbyTeam(room,input?.value||'');if(input){input.value='';input.blur();input.closest('details')?.removeAttribute('open');}notice('Team „'+created.name+'“ erstellt.');}if(ev.target.id==='lobby-create-form'&&role==='guest'){const name=$('bq-new-team')?.value||'';await game.createLobbyTeam(room,name);notice('Teamname übernommen. Der Host bestätigt deine Auswahl.');}if(ev.target.id==='join-form')await enterRoom($('join-room').value,$('join-name').value,true);if(ev.target.id==='chat-form')await handleMessage(ev.target);if(ev.target.id==='answer-form'&&!canHost()&&(!myResponse||activeQuestion()?.type==='map'))await doAction('submit-answer',ev.target);}catch(err){error(err);}});
document.addEventListener('input',ev=>{const input=ev.target;if(input.dataset.blockfield){blockPropertyUpdate(input);return;}if(input.id==='history-search'){historyFilter=input.value;schedule();return;}if(input.id==='editor-search'){editorSearch=input.value;schedule();return;}if(input.id?.startsWith('q-')||['quiz-title','quiz-description','quiz-teams','quiz-manual-players'].includes(input.id)){updateDraftField(input);clearTimeout(updateDraftField.timer);updateDraftField.timer=setTimeout(schedule,350);}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&cloudDirty)void flushHostCloudSave();});
window.addEventListener('storage',event=>{
 if(!isOffline()||!boardId||event.key!=='bq-board-workspace-'+boardId)return;
 try{const current=loadBoard(localStorage,boardId);if(current.revision===boardRevision)return;}catch{}
 boardConflict=true;saveState='KONFLIKT – als Kopie sichern!';schedule();notice('Ein anderer Tab hat dieses Quizbrett geändert. Deine Änderungen werden nicht überschrieben.');
});
window.addEventListener('beforeunload',event=>{
 if(role==='host'&&(boardConflict||/SPEICHERFEHLER|KONFLIKT/.test(saveState))){event.preventDefault();event.returnValue='';}
});
document.addEventListener('change',async ev=>{const target=ev.target;try{if(target.id==='import-quiz')await handleImport(target);else if(target.dataset.blockimage)await handleBlockUpload(target);else if(target.dataset.blockfield){blockPropertyUpdate(target);schedule();}else if(target.dataset.image)await handleUpload(target);else if(target.dataset.audio)await handleAudioUpload(target);else if(target.id==='q-type'){updateDraftField(target);schedule();}else if(target.id?.startsWith('team-')){pendingTeamChoices.set(target.id.slice(5),target.value);}else if(target.id==='chat-team'){chatTeam=target.value;schedule();}else if(target.id?.startsWith('q-'))updateDraftField(target);}catch(err){error(err);}});
document.addEventListener('keydown',ev=>{if((ev.key==='Enter'||ev.key===' ')&&document.activeElement?.classList.contains('bq-selectable')){ev.preventDefault();document.activeElement.click();return;}const input=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);if((ev.ctrlKey||ev.metaKey)&&ev.code==='KeyS'&&canHost()){ev.preventDefault();safeDownload(backupFilename('BrainQuiz_Autosicherung'),JSON.stringify(normalizedQuiz(quiz),null,2));notice('Quiz-Backup heruntergeladen.');return;}if((ev.ctrlKey||ev.metaKey)&&!input&&canHost()&&ev.code==='KeyZ'){ev.preventDefault();undoLayout(ev.shiftKey?'redo':'undo');return;}if(!input&&canHost()&&view==='present'&&['ArrowRight','ArrowLeft'].includes(ev.key)){ev.preventDefault();const action=ev.key==='ArrowRight'?'present-next':'present-prev';document.querySelector(`[data-action="${action}"]`)?.click();}});

document.addEventListener('keydown',ev=>{if(ev.code!=='KeyB'||ev.ctrlKey||ev.altKey||ev.metaKey||canHost()||role!=='guest')return;const el=document.activeElement;if(el&&['INPUT','TEXTAREA','SELECT'].includes(el.tagName))return;ev.preventDefault();const b=document.querySelector('[data-action="buzz"]');if(b&&!b.disabled)b.click();});
setInterval(()=>{updateClock();if(publicState?.phase==='question'&&activeQuestion()?.type==='map'&&publicState.deadline&&now()>=publicState.deadline)void maybeAutoBeginReview();},350);
render();
// A host may restore a previous session from its own browser; returning guests
// need the per-tab identity/secret created on their original visit.
if(hasValidRoom(roomFromLink))void (async()=>{
 try{
  const isHost=localStorage.getItem('bq-last-host')===roomFromLink&&!!localStorage.getItem('bq-p2p-session-'+roomFromLink);
  const isGuest=!!sessionStorage.getItem('bq-p2p-guest-'+roomFromLink);
  if(isHost||isGuest)await enterRoom(roomFromLink);
 }catch(err){console.warn('[BrainQuiz] PeerJS-Wiederverbindung fehlgeschlagen:',err?.message||err)}
})();
if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});

window.addEventListener('resize',()=>{if(['play','live'].includes(view))schedule();},{passive:true});
