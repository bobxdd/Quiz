import {canBuzz,roundMode,scoreMode,applyBuzzerJudgement} from './round-rules.mjs';
import {renderAnswerView,answerViewContent} from './answer-view.mjs';
import {TEAM_EMOJI,MAX_EMOJI_CLUES,emojiName,normalizeTeamEmoji,parseEmojiPalette,newTeamEmojiRound,playTeamEmoji,advanceTeamEmoji,publicTeamEmoji,teamEmojiForPlayer} from './team-emoji.mjs';
import {finalStandings,mayFinishGame,podiumRanks} from './final-results.mjs';
import {latestUndoableEvent,mayRegradeScore} from './score-ledger.mjs';
import {loadLocalHostQuiz,saveLocalHostQuiz} from './backup-store.mjs';
import {createSoundEffects} from './sound-effects.mjs';
import {boardList,createBoard,loadBoard,persistBoard,resumeBoard,selectBoard} from './board-workspace.mjs';
import {normalizePoint,encodePoint,decodePoint,DEFAULT_MAP_VIEW,mapAnswerDistances,formatMapDistanceKm} from './map-tools.mjs';
import {mountMapViewport} from './map-viewport.mjs';
import {createStudioEditor} from './studio-editor.mjs';
import {quizAudit,createActionLease,checkQuizMedia} from './editor-workflows.mjs';
import {collectCategories,categoryKey,cleanCategoryName,boardRoundOf,roundCategories,roundQuestions} from './category-model.mjs';
import {openQuestionState,validQuestionPair,questionMotion,returnToBoardState,canAdvanceBoard,advanceBoardState,remainingBoardQuestions,finalSixActive,boardQuestionPoints,makeSelectionTurn,selectingTeam,resetBoardGameState,cancelQuestionState,skipSelectionTurn} from './question-flow.mjs';
import {startMapDaggerThrow,THROW_ACTORS} from './map-dagger-animation.mjs';
import {MAX_PLAYERS,approvedCount,freeSlots,lobbySnapshot,teamColor,canArrangeLobby} from './lobby-model.mjs';
import {lobbyGuestHTML,hostLobbySummary} from './lobby-view.mjs';
import {createHistoryEntry,historyRows,responseStatus,historyCsv,csvSafeCell} from './history-model.mjs';
import {participantSnapshot,answerProgress,makeAnswerReview,revealAnswer,reviewIsCurrent,answerCardState,shouldAutoBeginAnswerReview} from './answer-review.mjs';
import {renderScene,ensureScene,templateScene,reconcileQuestion,sceneHasStep,publicScene,imposterPublicScene,escape as sceneEscape} from './studio-model.mjs';
import {BLOCK_TYPES,newBlock,blockId,normalizeBlocks,normalizeBlock,renderBlocks,validateBlocks} from './layout.mjs';
import {sceneForPublicState,isBoardCellPlayed,pageBoardColumns,VERSION,MODES,ABILITIES,TEAM_COLORS,escapeHTML as e,roomCode,uid,emptyQuiz,normalizedQuiz,buildPublicBoard,buildTeams,buildScores,publicQuestion,splashPreview,optimizeImage,safeDownload,validateQuestion,isImageData,isAudioData,shuffledItems,splashStageZoom,rankEstimates,optimizeAudio,quickBoard,categoryColumns,STANDARD_POINTS,DEFAULT_CATEGORIES,judgementDelta,updatePlayerScore,manualPlayerLabels} from './core.mjs';
const $=id=>document.getElementById(id),configured=true; // PeerJS/WebRTC requires no Firebase setup.
const hostActionLease=createActionLease();
const sfx=createSoundEffects();let buzzWatchReady=false;
let service=null,game=null,room='',role='landing',view='start',member=null,guestLobby=null,publicState=null,members={},roster={},presence={},buzzers={},responses={},messages={},myResponse=null,quiz=emptyQuiz(),selected='',chatTeam='ALL',connected=false,guestListeners=[],guestTeam='',responseUnsub=null,watchingRound=-1,renderQueued=false,lastMsgTime=0,loadedSession=false,pickedOrder=[],previewOpen=false,previewRevealed=false,previewSceneStep=0,previewImage='',editingBlock='',editorSearch='',undoStack=[],redoStack=[],lastEditAt=0,saveState='Gespeichert',settingsExpanded=false,inspectorExpanded=false,quizMetaExpanded=false,scoreTarget='',picks={},offlineRound=0,quickSetExpanded=false,reviewStartPending=-1,questionHistory={},historyFilter='',guestChoice='',reviewPointsOpen=false,openingQuestion=false,lastAnimatedQuestion='',mapPick=null;
let cloudTimer=null,cloudInFlight=false,cloudDirty=false,hostCloudReady=false,cloudWriteTail=Promise.resolve();
let projectorChannel=null,projectorRoom='',projectorToken='';
let guestReceipt=null;
let playerEmoji=null,emojiDraft=null;
let rehearsal=null;
let boardId='',boardRevision=0,boardConflict=false;
let mapCamera={...DEFAULT_MAP_VIEW},mapCameraQuestion='';
const consumedMapThrows=new Set();let activeMapThrow=null;
let activeQuestionCover=null;
let soundPlayer=null; // Detached audio survives regular host/guest redraws.
const makeBoardId=()=>'b'+uid().slice(1);
function applyBoardWorkspace(record){boardConflict=false;saveState='Lokal gesichert';boardId=record.id;boardRevision=record.revision;quiz=normalizedQuiz(record.quiz);selected=quiz.questions[0]?.id||'';undoStack=[];redoStack=[];editingBlock='';previewOpen=false;previewRevealed=false;mapPick=null;mapCamera={...DEFAULT_MAP_VIEW};mapCameraQuestion='';pickedOrder=[];boardPage=0;scorePage=0;historyFilter='';try{sessionStorage.setItem('bq-board-current-tab',boardId);}catch{}studio?.reset?.();}
function openStoredBoard(id){if(!isOffline())throw Error('Bitte zuerst den lokalen Editor öffnen. Der laufende Live-Raum bleibt unverändert.');studio.flush?.();if(!saveLocal())throw Error('Aktuelles Quizbrett konnte nicht gesichert werden.');const record=selectBoard(localStorage,id);applyBoardWorkspace(record);loadOfflineBoardState();schedule();notice('Quizbrett „'+quiz.title+'“ geöffnet.');}
function rescueStoredBoard(){if(!isOffline()||!boardId)throw Error('Nur im lokalen Quizbrett verfügbar.');studio.flush?.();const created=createBoard(localStorage,normalizedQuiz(quiz),makeBoardId);applyBoardWorkspace(created);loadOfflineBoardState();schedule();notice('Änderungen als eigenes Quizbrett gerettet. Das ursprüngliche bleibt unverändert.');}
function reloadStoredBoard(){if(!isOffline()||!boardId)throw Error('Nur im lokalen Quizbrett verfügbar.');if(!confirm('Die derzeit ungesicherten Änderungen an diesem Quizbrett verwerfen und den zuletzt gespeicherten Stand öffnen?'))return;const record=selectBoard(localStorage,boardId);applyBoardWorkspace(record);loadOfflineBoardState();schedule();notice('Zuletzt gespeicherte Brettversion geladen.');}
function loadOfflineBoardState(){const session=loadOfflineSession();questionHistory=session.questionHistory||{};publicState={title:quiz.title,scoreMode:quiz.scoreMode||'team',phase:'board',boardRound:boardRoundOf(session),boardSequence:true,round:session.round||0,board:buildPublicBoard(quiz,session.used),teams:buildTeams(quiz),scores:{...buildScores(quiz),...session.scores},settings:{buzzerEnabled:true,chatOpen:false,lockOnBuzz:false,timerSeconds:60},manualPlayers:manualPlayerLabels(quiz),playerScores:session.playerScores||{},used:session.used||{},buzzerBlocked:session.buzzerBlocked||{}};}
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
 hostCloudReady=true;void maybeOpenSelectedQuestion();
}
const roomFromLink=(new URLSearchParams(location.search).get('room')||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,16);
const canHost=()=>role==='host';
const isGameView=()=>['play','live'].includes(view)||view==='present'&&!!rehearsal;
// A published live quiz is a committed game, not an editable draft. This flag
// lives in the authoritative shared room state and survives host reconnection.
const isPublished=()=>!isOffline()&&(publicState?.published===true||(()=>{try{return localStorage.getItem('bq-published-'+room)==='1'}catch{return false}})());
const waitingInLobby=()=>canHost()&&!isOffline()&&canArrangeLobby(publicState);
const roomCloseLabel=()=>waitingInLobby()||!isPublished()?'Lobby schließen':'Spielraum schließen';
const editorOnlyActions=new Set(['quick-add','quick-replace','quickset','new-q','clone-q','delete-q','move-up','move-down','new-board','open-board','new-stored-board','add-block','block-delete','block-clone','block-up','block-down','clone-layout','undo-layout','redo-layout','import','publish','preview-q','preview-reveal']);const activeQuestion=()=>publicState?.current;const roundKey=()=>String(publicState?.round??0);const isOpen=()=>publicState?.phase==='question';const winner=()=>buzzers?.[roundKey()]||null;const teamName=t=>publicState?.teams?.[t]||t||'–';const now=()=>game?game.serverNow():Date.now();const buzzLocks=()=>publicState?.buzzerBlocked?.[roundKey()]||{};const isBuzzLocked=id=>!!(id&&(buzzLocks()?.[id]||(scoreMode(publicState)==='team'&&publicState?.buzzerBlockedTeams?.[roundKey()]?.[member?.team])));const viewerStateLabel=()=>publicState?.phase==='board'?'Quizbrett sichtbar':publicState?.phase==='review'?'Antwortübersicht sichtbar':publicState?.phase==='reveal'?'Lösung sichtbar':publicState?.phase==='paused'?'Frage pausiert':hasLiveQuestion()?'Frage geöffnet':'Warten';
function notice(text){const el=$('toaster');if(!el)return;el.textContent=text;el.classList.add('show');clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.classList.remove('show'),4400);}
function error(err){const message=String(err?.message||err||'Unbekannter Fehler');console.error('[BrainQuiz]',err);notice(message.slice(0,230));}
async function sendGuestAction(label,send){
 const pending={tone:'pending',text:label+' wird gesendet …'};
 guestReceipt=pending;schedule();
 try{
  const result=await send();
  if(guestReceipt===pending)guestReceipt={tone:'good',text:result===false?'Buzzer bestätigt. Ein anderes Signal war zuerst da.':label+' vom Host bestätigt.'};
  return result;
 }catch(error){
  if(guestReceipt===pending)guestReceipt={tone:'bad',text:error.message||'Aktion konnte nicht bestätigt werden.'};
  throw error;
 }finally{schedule();}
}
function guestReceiptMarkup(){
 const retry=!connected&&game?.mode==='guest';
 const diagnostic=game?.diagnostics?.();
 const status=connected?guestReceipt?.text||'':diagnostic?.error||'Verbindung unterbrochen. Wiederverbindung läuft …';
 return `<div class="bq-guest-receipt ${guestReceipt?.tone||''}" role="status" aria-atomic="true">${e(status)}
  ${retry?`<span class="bq-reconnect-actions">${btn('Erneut verbinden','retry-connect','small primary')}${btn('Fehlerbericht kopieren','copy-connection-report','small')}</span>`:''}</div>`;
}
function connectionReport(){
 const d=game?.diagnostics?.()||{};
 // No room tokens, member secrets, IP addresses or TURN credentials.
 return JSON.stringify({application:'BrainQuiz Studio',at:new Date().toISOString(),
  browser:navigator.userAgent.slice(0,180),online:navigator.onLine,
  role:d.mode||role,connected:!!d.connected,phase:d.phase||'unknown',
  iceState:d.iceState||'unknown',iceErrorCode:d.iceErrorCode||0,
  turnConfigured:!!d.turnConfigured,reconnectAttempts:d.reconnectAttempts||0,
  message:d.error||'',advice:d.guidance||'',participantCount:d.peers?.length||0},null,2);
}
function preserveForm(draw){
 const focused=document.activeElement,id=focused?.id,value=focused?.value,selection=(()=>{try{return [focused.selectionStart,focused.selectionEnd]}catch{return null}})();
 const previousScene=document.querySelector('#app .bq-session-scene')?.dataset.scene||'';
 const actionSelector=focused?.matches('#app button[data-action]')?
  'button'+[...focused.attributes].filter(attr=>attr.name.startsWith('data-'))
   .map(({name,value})=>`[${name}="${CSS.escape(value)}"]`).join(''):'';
 const expanded=[...document.querySelectorAll('#app details[data-bq-persist][open]')].map(el=>el.dataset.bqPersist);
 const saved=[...document.querySelectorAll('.questionlist,.studio-list,.studio-tools,.workspace,.chatfeed,.bq-scene-content,.bq-guest-compose,.bq-answers-panel .answer-review')].map((el,i)=>({selector:el.id?'#'+CSS.escape(el.id):'.'+[...el.classList].find(c=>['questionlist','studio-list','studio-tools','workspace','chatfeed','bq-scene-content','bq-guest-compose','answer-review'].includes(c)),top:el.scrollTop,left:el.scrollLeft,index:i,nearBottom:el.classList.contains('chatfeed')&&el.scrollHeight-el.scrollTop-el.clientHeight<60}));
 draw();
 const nextScene=document.querySelector('#app .bq-session-scene')?.dataset.scene||'';
 if(previousScene===nextScene){for(const key of expanded){const item=[...document.querySelectorAll('#app details[data-bq-persist]')].find(x=>x.dataset.bqPersist===key);if(item)item.open=true;}}
 const next=id?document.getElementById(id):null;
 if(next&&['INPUT','TEXTAREA','SELECT'].includes(next.tagName)&&next.type!=='file'){
  if(value!==undefined)next.value=value;
  next.focus({preventScroll:true});try{if(selection&&selection[0]!==null)next.setSelectionRange(selection[0],selection[1])}catch{}
 }else if(previousScene===nextScene&&actionSelector){
  document.querySelector('#app '+actionSelector+':enabled')?.focus({preventScroll:true});
 }
 for(const item of saved){if(!item.selector)continue;const el=document.querySelector(item.selector);if(el){el.scrollTop=item.nearBottom?el.scrollHeight: item.top;el.scrollLeft=item.left;}}
}
// The display gets an explicit public-only frame, never a host or guest page.
const PROJECTOR_SLIDES={
 welcome:'Willkommen',break:'Pause',scores:'Zwischenstand',last:'Letzte Runde'
};
function projectorScoreboard(){
 const entries=finalStandings(publicState,roster);
 return `<aside class="bq-projector-scores" aria-label="Aktueller Punktestand"><h2>Punktestand</h2>
  ${entries.map(row=>`<div class="scoreline"><span>${e(row.name)}</span><b>${e(row.points.toLocaleString('de-DE'))}</b></div>`).join('')}</aside>`;
}
function projectorFrame(){
 if(!publicState)return '';
 const p=publicState;
 if(p.phase==='finished')return renderFinalResults(false);
 const slide=p.presentation||(!p.started&&Number(p.round||0)===0?'welcome':'');
 let stage='';
 if(PROJECTOR_SLIDES[slide]){
  stage=`<section class="glass panel bq-projector-slide"><h1>${PROJECTOR_SLIDES[slide]}</h1>
   ${slide==='welcome'?`<p>${e(p.title||'BrainQuiz Studio')}</p><p>Raumcode <strong>${e(room)}</strong></p>
    <p>Bei Buzzerfragen zählt das erste gültige Signal. Eine falsche Antwort kostet die Hälfte der Fragepunkte.</p>`:''}</section>`;
 }else if(hasLiveQuestion()){
  stage=`<section class="bq-session-scene bq-question-scene" data-scene="question">
   <div class="glass panel bq-question-panel"><div class="bq-scene-content">${renderStage(true)}</div></div>
   ${reviewIsCurrent(p)?`<section class="glass panel bq-answers-panel"><h2>Antworten</h2>${renderReviewGallery(true)}</section>`:''}</section>`;
 }else{
  stage=`<section class="bq-session-scene bq-board-scene" data-scene="board"><h1>Runde ${boardRoundOf(p)} · Fragenübersicht</h1>${selectingTeam(p)?`<p>${e(teamName(selectingTeam(p)))} wählt die nächste Frage.</p>`:''}
   <div class="glass panel bq-board-panel">${renderBoard(true)}</div></section>`;
 }
 return `<div class="bq-projector-scene">${stage}${projectorScoreboard()}</div>`;
}
let lastProjectorFrame=null;
function pushProjector(force=false){
 if(role!=='host'||isOffline()||!publicState||(!projectorChannel&&!game?.hasProjector?.(room)))return;
 const html=projectorFrame();
 const deadline=hasLiveQuestion()&&!publicState.presentation&&isOpen()?publicState.deadline||0:0;
 if(html.length>3_000_000)return;
 const frame={t:'frame',html,deadline};
 if(projectorChannel&&room===projectorRoom&&(force||lastProjectorFrame?.html!==html||lastProjectorFrame?.deadline!==deadline)){
  projectorChannel.postMessage(frame);
 }
 lastProjectorFrame=frame;
 game?.publishProjector?.(room,frame);
}
function projectorLink(remote=false){
 if(role!=='host'||isOffline()||!publicState)throw Error('Der Beamer ist im Online-Hostraum verfügbar.');
 const link=new URL('./projector.html',location.href);
 link.searchParams.set('room',room);
 if(remote)link.searchParams.set('remote','1');
 link.hash=game.enableProjector(room);
 return link.href;
}
function bindLocalProjector(key){
 if(typeof BroadcastChannel==='undefined')return;
 if(projectorChannel&&projectorRoom===room&&projectorToken===key)return;
 projectorChannel?.close();
 projectorRoom=room;projectorToken=key;
 projectorChannel=new BroadcastChannel('brainquiz-projector-'+room+'-'+key);
 projectorChannel.onmessage=event=>{if(event.data?.t==='ready')pushProjector(true);};
}
function openProjector(){
 if(typeof BroadcastChannel==='undefined')throw Error('Dieser Browser unterstützt kein lokales Beamerfenster. Öffne stattdessen den Zuschauerlink.');
 const href=projectorLink();
 bindLocalProjector(new URL(href).hash.slice(1));
 const windowRef=window.open(href,'BrainQuizProjector','width=1300,height=830');
 if(!windowRef)throw Error('Das Beamerfenster wurde blockiert. Du kannst den Zuschauerlink kopieren und in einem neuen Tab öffnen.');
 try{windowRef.opener=null;}catch{}
 pushProjector(true);
}
function presentationControls(){
 const choices=[['','Live-Ansicht'],...Object.entries(PROJECTOR_SLIDES)];
 return `<details class="bq-auxiliary" data-bq-persist="projector-controls">
  <summary>Beamer und Einblendungen</summary>
  <div class="row">${btn('Beamerfenster öffnen','open-projector','small')}${btn('Zuschauerlink kopieren','copy-projector','small')}</div>
  ${publicState?.phase!=='finished'?`<div class="row" aria-label="Beamer-Szene">${choices.map(([key,label])=>btn(label,'projector-scene','small'+((publicState?.presentation||'')===key?' primary':''),`data-slide="${key}" aria-pressed="${(publicState?.presentation||'')===key}"`)).join('')}</div>`:''}</details>`;
}
function schedule(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;preserveForm(render);updateClock();pushProjector()});}
function btn(label,action,cls='',attrs=''){return `<button type="button" class="btn ${cls}" data-action="${action}" ${attrs}>${label}</button>`;}
function hasValidRoom(value){return /^[A-HJ-NP-Z2-9]{16}$/.test(value);}
async function initialize(){if(game)return game;const module=await import('./peer-client.mjs');game=new module.PeerGame();await game.init();return game;}
function saveLocal(){try{if(isOffline()){if(!boardId)throw Error('Kein Quizbrett geöffnet.');if(boardConflict)throw Error('Ein anderer Tab hat dieses Brett verändert. Bitte Änderungen als Kopie sichern oder gespeicherte Version laden.');boardRevision=persistBoard(localStorage,boardId,boardRevision,normalizedQuiz(quiz));}else{queueHostCloudSave();if(!saveLocalHostQuiz(room,quiz))throw Error('Lokale Sofortsicherung fehlgeschlagen. Zweite Sicherung wird versucht.');}saveState=isOffline()?'Lokal gesichert':'Im Host-Browser gesichert';return true}catch(err){const message=String(err?.message||'Quizbrett konnte nicht gespeichert werden.');if(/anderen Tab|anderer Tab/.test(message))boardConflict=true;saveState=boardConflict?'KONFLIKT – als Kopie sichern!':'SPEICHERFEHLER – Backup exportieren!';notice(message.slice(0,220));return false;}}
function loadLocal(){const saved=loadLocalHostQuiz(room);quiz=saved?normalizedQuiz(saved.quiz):emptyQuiz();selected=quiz.questions[0]?.id||'';}
/* The saved board is the only source of truth for a newly hosted quiz.
 * Never replace the local board with an empty online draft or edit it from the lobby. */
let hostingSavedBoard=false;
function saveCurrentBoard(){
 if(!isOffline()||!boardId)throw Error('Quiz speichern ist nur im lokalen Frageneditor möglich.');
 studio.flush?.();
 if(!saveLocal())throw Error('Quiz konnte nicht gespeichert werden. Speicherplatz oder Konflikt prüfen; alternativ Backup exportieren.');
 schedule();notice('Quiz „'+quiz.title+'“ gespeichert. Du kannst jetzt eine Lobby damit hosten.');
}
function backToSavedQuizzes(){
 if(!isOffline())throw Error('Die Quizbibliothek ist während einer laufenden Lobby nicht verfügbar.');
 studio.flush?.();
 if(!saveLocal())throw Error('Das Quiz konnte nicht gespeichert werden. Du bleibst im Editor, damit keine Änderungen verloren gehen.');
 room='';role='landing';view='start';publicState=null;
 history.replaceState(null,'',location.pathname);schedule();
}
function createNewLocalQuiz(){
 if(role!=='landing'&&!isOffline())throw Error('Ein neues Quiz kann nur außerhalb eines laufenden Spielraums erstellt werden.');
 if(isOffline()){studio.flush?.();if(!saveLocal())throw Error('Das bisherige Quiz konnte nicht gespeichert werden.');}
 const created=createBoard(localStorage,emptyQuiz(),makeBoardId);
 room='LOCAL';role='host';view='editor';
 applyBoardWorkspace(created);loadOfflineBoardState();
 history.replaceState(null,'',location.pathname);schedule();notice('Neues Quiz angelegt. Fragen erstellen und anschließend speichern.');
}
async function hostSavedQuiz(id){
 if(hostingSavedBoard)return;
 if(role!=='landing'&&!isOffline())throw Error('Ein weiterer Raum kann erst nach Schließen des laufenden Spielraums gestartet werden.');
 hostingSavedBoard=true;
 try{
  if(isOffline()){
   studio.flush?.();
   if(!saveLocal())throw Error('Das Quiz konnte nicht sicher gespeichert werden. Lobby wurde nicht erstellt.');
  }
  // loadBoard validates the selected stable id, directory and revision. Do not
  // silently host the last edited quiz if the requested saved board is missing.
  const record=loadBoard(localStorage,id);
  const source=normalizedQuiz(record.quiz);
  for(const question of source.questions){if(question.scene)reconcileQuestion(question);}
  const audit=quizAudit(source);
  if(!audit.ready)throw Error('Quiz „'+source.title+'“ ist noch nicht bereit: '+audit.errors.slice(0,3).map(x=>x.label+': '+x.reason).join(' | ')+'. Bitte zuerst bearbeiten und speichern.');
  if(audit.warnings.length&&!confirm(audit.warnings.length+' Hinweise bei „'+source.title+'“. Trotzdem mit diesem Quiz eine Lobby hosten?'))return;
  await initialize();
  const code=roomCode();
  let created=false;
  try{
   // The very first room snapshot already owns the published board. Guests can
   // join the team lobby without ever seeing unpublished/editable question data.
   await game.create(code,source,{published:true});created=true;
   await game.saveHostQuiz(code,source);
   localStorage.setItem('bq-last-host',code);
   localStorage.setItem('bq-published-'+code,'1');
  }catch(err){
   try{if(created)await game.deleteRoom(code);else game.shutdown();}catch{}
   try{if(localStorage.getItem('bq-last-host')===code)localStorage.removeItem('bq-last-host');localStorage.removeItem('bq-published-'+code);}catch{}
   game=null;
   throw err;
  }
  room=code;role='host';view='teams';quiz=source;selected=source.questions[0]?.id||'';
  hostCloudReady=true;cloudDirty=false;clearTimeout(cloudTimer);
  history.replaceState(null,'',location.pathname+'?room='+room);
  listenRoom();notice('Lobby für „'+source.title+'“ gestartet. Lade deine Mitspieler ein.');
 }finally{hostingSavedBoard=false;}
}
async function promoteOnline(){if(!isOffline())return;await hostSavedQuiz(boardId);}
function backupFilename(prefix='BrainQuiz_Host'){
 const title=String(quiz?.title||'Quizbrett').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,48)||'Quizbrett';
 const location=isOffline()?boardId.slice(1,8):room;
 return prefix+'_'+title+'_'+(location||'LOKAL')+'.brainquiz.json';
}
function saveOfflineSession(){if(rehearsal||!isOffline()||!publicState||!boardId)return;try{localStorage.setItem('bq-session-LOCAL-'+boardId,JSON.stringify({used:publicState.used||{},boardRound:boardRoundOf(publicState),scores:publicState.scores||{},playerScores:publicState.playerScores||{},round:publicState.round||0,questionHistory,buzzerBlocked:publicState.buzzerBlocked||{}}));}catch{notice('Spielstand konnte nicht gespeichert werden. Bitte Speicherplatz prüfen.');}}
function loadOfflineSession(){try{const raw=JSON.parse(localStorage.getItem('bq-session-LOCAL-'+boardId)||'{}');if(!raw||typeof raw!=='object')return {};const valid=new Set(quiz.questions.map(q=>q.id));const used=Object.fromEntries(Object.entries(raw.used||{}).filter(([id,v])=>valid.has(id)&&v===true));return {used,boardRound:boardRoundOf(raw),scores:raw.scores||{},playerScores:raw.playerScores&&typeof raw.playerScores==='object'?raw.playerScores:{},questionHistory:raw.questionHistory&&typeof raw.questionHistory==='object'?raw.questionHistory:{},buzzerBlocked:raw.buzzerBlocked&&typeof raw.buzzerBlocked==='object'?raw.buzzerBlocked:{},round:Math.max(0,Math.min(999999,Number(raw.round)||0))};}catch{return {};}}
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
 if(!join&&await game.hasHostSession(code)){
  await game.resumeHost(code);room=code;role='host';view='live';await restoreHostQuiz();localStorage.setItem('bq-last-host',room);
  if(game.hasProjector(room))bindLocalProjector(game.enableProjector(room));
 }else{
  if(join&&!name.trim())throw Error('Bitte deinen Spielernamen eingeben.');
  const record=await game.connect(code,name||'Spieler');guestReceipt=null;room=code;member=record;role='guest';view='play';
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
 if(automatic&&!shouldAutoBeginAnswerReview(publicState,submitted,now()))return;
 const board=makeAnswerReview(expected,submitted,currentRound);
 await game.updateCurrent(room,currentRound,publicState.current.id,{phase:'review',deadline:0,pausedRemaining:0,answerReview:board},['question']);
 if(!automatic)notice('Antwortübersicht für alle Teilnehmer geöffnet.');
}
async function maybeAutoBeginReview(){
 if(!canHost()||isOffline()||!game||publicState?.phase!=='question'||roundMode(activeQuestion())!=='written')return;
 const roundNumber=Number(publicState.round)||0;
 if(reviewStartPending===roundNumber||!shouldAutoBeginAnswerReview(publicState,responses?.[String(roundNumber)]||{},now()))return;
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

function publicAudioEvents(next){
 const prev=publicState,r=String(next?.round??'');
 if(prev&&next&&Number(prev.round)===Number(next.round)){
  const before=prev.buzzerJudgements?.[r],after=next.buzzerJudgements?.[r];
  if(after&&['correct','wrong'].includes(after.result)&&
     (before?.at!==after.at||before?.uid!==after.uid||before?.result!==after.result))sfx.play(after.result);
  else if(next.current?.roundMode==='written')for(const [uid,record] of Object.entries(next.playerScores||{})){
   const val=record?.rounds?.[r],earlier=prev.playerScores?.[uid]?.rounds?.[r];
   if(['correct','wrong'].includes(val?.result)&&(val.at!==earlier?.at||val.result!==earlier?.result)&&
      (canHost()||uid===game?.uid))sfx.play(val.result);
  }
 }
 if(prev&&next&&((prev.phase!=='board'&&next.phase==='board')||(prev.round!==next.round&&next.phase==='ready')))view=canHost()?'live':'play';
 publicState=next;
}
function buzzerAudioEvents(v){
 const current=v||{},r=roundKey(),b=current[r],before=buzzers?.[r];
 if(buzzWatchReady&&canHost()&&publicState?.phase==='question'&&b?.uid&&
    (before?.uid!==b.uid||before?.at!==b.at))sfx.play('buzz');
 buzzWatchReady=true;buzzers=current;schedule();
}
function soundMenu(){
 const v=sfx.values(),types=[['master','Gesamt'],['buzz','Buzzer'],['correct','Richtig'],['wrong','Falsch']];
 const sliders=types.map(([key,label])=>'<label class="bq-sfx-row"><span>'+label+'</span><output>'+v[key]+' %</output>'
  +'<input type="range" min="0" max="100" step="1" value="'+v[key]+'" data-sfx-volume="'+key+'" aria-label="'+label+'"></label>').join('');
 const samples=['buzz','correct','wrong'].map(k=>btn(k==='buzz'?'▶ Buzzer':k==='correct'?'▶ Richtig':'▶ Falsch',
    'sfx-preview','small','data-sfx="'+k+'"')).join('');
 return '<details class="bq-sfx-menu" data-bq-persist="soundfx"><summary aria-label="Audioeinstellungen" title="Audioeinstellungen">'
  +(v.muted?'🔇':'🔉')+'</summary><div class="bq-sfx-panel"><strong>Audioeinstellungen</strong>'
  +'<p class="small muted">Nur auf deinem Gerät · MP3-Soundquiz unabhängig</p>'
  +btn(v.muted?'Ton einschalten':'Effekte stummschalten','sfx-mute','small')
  +sliders+'<div class="bq-sfx-previews">'+samples+'</div>'
  +'<p class="small muted">Sound-Vorschau startet auch den Ton im Browser.</p></div></details>';
}

async function maybeOpenSelectedQuestion(){
 const state=publicState,pick=state?.questionPick;
 if(!canHost()||isOffline()||!hostCloudReady||openingQuestion||state?.phase!=='board'||!pick||pick.round!==state.round||pick.team!==selectingTeam(state))return;
 view='live';
 try{await hostOpen(pick.qid);}
 catch(err){
  if(publicState?.phase==='board'&&publicState.questionPick?.qid===pick.qid)await game.clearPicks(room).catch(()=>{});
  error(err);
 }
}
function listenRoom(){buzzWatchReady=false;game.clearWatchers();stopGuestListeners();connected=false;guestLobby=null;publicState=null;members={};roster={};presence={};buzzers={};responses={};messages={};picks={};scoreTarget='';myResponse=null;playerEmoji=null;emojiDraft=null;reviewStartPending=-1;questionHistory={};
 game.watch('.info/connected',v=>{const wasConnected=connected;connected=!!v;if(connected&&!wasConnected&&(canHost()||member?.status==='approved'))game.enterPresence(room).catch(()=>{});if(connected&&!wasConnected&&cloudDirty&&canHost())queueHostCloudSave();schedule();});game.watch('.info/serverTimeOffset',v=>game.offset=v||0);
 game.watch('.info/diagnostics',()=>{if(!connected||view==='setup')schedule();});
 if(canHost()){
  game.watch('.info/diagnostics',()=>{if(view==='setup')schedule();});
  game.watchRoom(room,'picks',v=>{picks=v||{};schedule();});
  game.watchRoom(room,'questionHistory',v=>{questionHistory=v||{};schedule();});
  game.watchRoom(room,'public',v=>{publicAudioEvents(v);schedule();void maybeAutoBeginReview();void maybeOpenSelectedQuestion();});
  game.watchRoom(room,'members',v=>{members=v||{};schedule();});
  game.watchRoom(room,'roster',v=>{roster=v||{};schedule();});
  game.watchRoom(room,'presence',v=>{presence=v||{};schedule();});
  game.watchRoom(room,'buzzers',buzzerAudioEvents);
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
 w('public',v=>{publicAudioEvents(v);if(publicState?.round!==watchingRound)watchOwnResponse();schedule();});
 w('roster',v=>{roster=v||{};schedule();});w('presence',v=>{presence=v||{};schedule();});w('buzzers',buzzerAudioEvents);
 w('teamEmoji',v=>{playerEmoji=v||null;schedule();});
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
 const key=q?.id&&publicState.phase==='question'&&isGameView()
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
 timer=setTimeout(cleanup,1300);
 activeQuestionCover={key,update,cancel:cleanup};
}
function removeMapThrowRail(){
 document.querySelectorAll('.bq-map-question.bq-map-throw-active').forEach(el=>el.classList.remove('bq-map-throw-active'));
}
/** The only world-map animation: the actor visibly throws at solution release. */
function maybeAnimateMapDagger(){
 const q=publicState?.current;
 const key=q?.id&&publicState?.phase==='reveal'&&q.type==='map'&&isGameView()
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

/* Host-authorized one-shot soundquiz: native controls and user replays are absent. */
function soundEvent(){
 const q=activeQuestion(),play=publicState?.audioPlayback;
 return q?.type==='audio'&&play?.id===q.id&&Number(play.round)===Number(publicState?.round)
  &&Number.isSafeInteger(play.seq)&&play.seq>0?play:null;
}
function soundElapsed(play){return Math.max(0,(now()-Number(play.at||now()))/1000);}
function soundExpired(player,play){
 return !!(player?.audio&&Number.isFinite(player.audio.duration)&&player.audio.duration>0
  &&soundElapsed(play)>=player.audio.duration+0.15);
}
function stopSoundPlayer(){
 if(!soundPlayer)return;
 soundPlayer.audio.pause();
 soundPlayer.audio.removeAttribute('src');
 soundPlayer.audio.load();
 soundPlayer=null;
}
async function attemptSoundPlayback(player,play){
 if(player!==soundPlayer||!play||player.seq!==play.seq||player.ended||player.played)return;
 if(soundExpired(player,play)){player.ended=true;player.blocked=false;schedule();return;}
 player.blocked=false;
 try{
  const delay=soundElapsed(play),audio=player.audio;
  if(Number.isFinite(audio.duration)&&audio.duration>0&&delay<audio.duration){
   audio.currentTime=delay;
  }else if(delay>0){try{audio.currentTime=delay;}catch{}}
  await audio.play();
  if(player===soundPlayer&&player.seq===play.seq){
   player.played=true;player.blocked=false;player.playing=!audio.paused;
   schedule();
  }
 }catch(err){
  if(player!==soundPlayer||player.seq!==play.seq)return;
  if(soundExpired(player,play)){player.ended=true;player.blocked=false;}
  else{player.blocked=true;player.playing=false;}
  schedule();
 }
}
function syncSoundPlayer(){
 const q=activeQuestion(),key=q?.type==='audio'&&publicState?.phase==='question'&&isAudioData(q.audio)
  ?room+':'+publicState.round+':'+q.id:'';
 if(!key){stopSoundPlayer();return;}
 if(soundPlayer?.key!==key){
  stopSoundPlayer();
  const media=new Audio(q.audio);
  media.preload='auto';media.autoplay=false;media.controls=false;media.loop=false;
  const player={key,audio:media,seq:0,ended:false,blocked:false,playing:false,played:false};
  media.addEventListener('ended',()=>{
   if(soundPlayer!==player)return;
   player.ended=true;player.playing=false;player.blocked=false;schedule();
  });
  soundPlayer=player;
 }
 const play=soundEvent();
 if(!play)return;
 if(play.seq>soundPlayer.seq){
  const player=soundPlayer;
  player.audio.pause();player.seq=play.seq;
  player.ended=false;player.blocked=false;player.playing=false;player.played=false;
  void attemptSoundPlayback(player,play);
 }else if(soundPlayer.seq===play.seq&&soundPlayer.blocked&&soundExpired(soundPlayer,play)){
  soundPlayer.ended=true;soundPlayer.blocked=false;schedule();
 }
}
function soundQuizMarkup(q){
 if(!isAudioData(q.audio))return '<div class="hint">Audio fehlt.</div>';
 const play=soundEvent(),player=soundPlayer;
 const same=player?.key===room+':'+publicState.round+':'+q.id&&play?.seq===player.seq;
 const ended=same&&player.ended,blocked=same&&player.blocked,started=same&&player.played&&!ended;
 const waiting=!play,stopped=publicState.phase!=='question';
 const status=stopped?'Die Sound-Runde ist beendet.':waiting?'Der Host startet den Sound.':
  ended?'Sound beendet – nur der Host kann eine neue Wiedergabe freigeben.':
  blocked?'Dieser Browser benötigt einen Klick, um den freigegebenen Sound zu hören.':
  started?'Sound läuft – Buzzer bleibt aktiv.':'Sound wird geladen …';
 const hostAction=!stopped&&canHost()?(waiting?btn('▶ Sound abspielen','audio-play','primary bq-sound-host-control'):
  ended?btn('↻ Sound erneut abspielen','audio-play','primary bq-sound-host-control'):
  '<p class="small muted">Wiederholen erst nach vollständigem Abspielen.</p>'):'';
 const userAction=!stopped&&play&&blocked&&!ended?
  btn('▶ Freigegebenen Sound einmal starten','audio-unblock','primary bq-sound-allow'):'';
 return '<div class="soundstage bq-soundquiz" aria-label="Soundquiz">'
  +'<div class="sub">SOUNDQUIZ · EINMAL PRO HOST-FREIGABE</div>'
  +'<div class="bq-sound-symbol" aria-hidden="true">♫</div>'
  +'<p class="bq-sound-status" role="status">'+e(status)+'</p>'
  +hostAction+userAction
  +'<p class="small muted">'+(canHost()?'Nur der Host startet oder wiederholt den Sound.':'Nur der Host gibt weitere Wiedergaben frei.')
  +' Du kannst jederzeit während des Sounds buzzern.</p></div>';
}

function render(){if(role==='host'&&view==='editor'&&isPublished())view='live';const app=$('app');const liveView=isGameView();document.body.classList.toggle('bq-game-mode',liveView&&role!=='landing');if(role==='landing'){if(activeMapThrow){activeMapThrow.handle.cancel();activeMapThrow=null;}if(activeQuestionCover){activeQuestionCover.cancel();activeQuestionCover=null;}app.innerHTML=landing();return;}
 const waiting=Object.values(members||{}).filter(p=>p?.status==='pending').length;
 const nav=role==='host'?(isOffline()?[['editor','✎','Fragen bearbeiten'],['live','▦','Vorschau']]:!isPublished()?[['editor','✎','Fragen bearbeiten'],['teams','♙','Lobby'],['live','◈','Quizbrett'],['setup','⚙','Optionen']]:waitingInLobby()?[['teams','♙',waiting?'Lobby · '+waiting+' Anfrage'+(waiting===1?'':'n'):'Lobby'],['live','◈','Quizbrett'],['setup','⚙','Optionen']]:[['live','◈','Quiz'],['teams','♙','Teilnehmer'],['present','▣','Präsentation'],['history','▤','Verlauf'],['setup','⚙','Optionen']]):[['play','◈','Quiz']];
 const title=({live:'Live-Raum',editor:'Fragen bearbeiten',history:'Fragenverlauf',present:rehearsal?'Generalprobe':'Präsentation',teams:'Team-Lobby',setup:'Einstellungen',play:'Teilnehmen'})[view]||'Quiz';
 app.innerHTML=`<div class="shell"><section class="workspace"><header class="topbar glass"><div class="header-primary"><div class="brand"><div class="logo">B</div><div><strong>BRAINQUIZ</strong><small>Version ${VERSION}</small></div></div><nav class="top-nav" aria-label="Hauptnavigation">${nav.map(([name,glyph,label])=>`<button type="button" class="nav ${view===name?'active':''}" data-action="view" data-view="${name}" ${view===name?'aria-current="page"':''}><span class="glyph" aria-hidden="true">${glyph}</span>${label}</button>`).join('')}</nav>${canHost()&&!isOffline()?btn(roomCloseLabel(),'leave-host-room','small danger'):''}<div class="header-state">${soundMenu()}<div class="status" aria-label="Verbindungsstatus"><i class="dot ${connected?'live':''}"></i>${isOffline()?'Lokaler Editor':connected?'Live verbunden':'Verbindung wird geprüft'}</div><span class="role-caption">${role==='host'?'Host':member?.status==='approved'?e(teamName(member.team)):'Team-Lobby'}</span></div></div><div class="header-secondary"><h1>${e(title)}</h1><div class="topright"><div class="roomchip">${isOffline()?'LOKAL':'RAUM'} <strong>${e(room)}</strong></div>${isOffline()||view==='teams'?'':btn('Einladung kopieren','invite','small')}</div></div></header><main class="page ${liveView?'page-live bq-session-page':''}">${role==='host'?hostPage():guestReceiptMarkup()+guestPage()}</main>${liveView?watcherMarkup():''}</section></div>`;
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
 syncSoundPlayer();
}
function savedQuizzesStart(drafts,workspaceError,hostCode){
 const rows=drafts.map(b=>`<article class="bq-saved-quiz" data-saved-quiz-id="${e(b.id)}">
  <div class="bq-saved-quiz-info"><strong>${e(b.title)}</strong>
   <small>${b.updatedAt?'Gespeichert: '+new Date(b.updatedAt).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Lokal gespeichert'}</small></div>
  <div class="bq-saved-quiz-actions">
   ${btn('Bearbeiten','open-landing-board','small',`data-board-id="${e(b.id)}"`)}
   ${btn('Lobby hosten','host-saved-board','primary small',`data-board-id="${e(b.id)}" title="${e(b.title)} als Lobby hosten"`)}
  </div>
 </article>`).join('');
 return `<section class="glass panel start-card bq-saved-quiz-home">
  <div class="bq-saved-quiz-home-head"><div><h2>Meine Quizze</h2><p class="small muted">Quiz auswählen oder ein neues erstellen. Die Lobby startet mit genau diesem Quiz.</p></div>
   ${btn('+ Neues Quiz erstellen','create-new-quiz','primary')}</div>
  ${workspaceError?`<p class="small muted" role="alert">${e(workspaceError)}</p>`:''}
  ${drafts.length?`<details class="bq-landing-boards" open><summary>Gespeicherte Quizze (${drafts.length})</summary><div class="bq-landing-boards-list">${rows}</div></details>`:
   '<p class="small muted">Noch kein Quiz gespeichert. Erstelle dein erstes Quiz und klicke im Editor auf „Quiz speichern“.</p>'}
  <div class="bq-saved-quiz-secondary">${hostCode?btn('Letzten Live-Raum fortsetzen','resume','small'):''}
   <details class="bq-legacy-options"><summary>Weitere Optionen</summary><div class="bq-legacy-options-content">${btn('Quizbrett bearbeiten','create-offline','small')}${btn('Online-Raum erstellen','create','small')}<p class="small muted">Diese Funktionen sind für ältere Quizbretter. Einfacher: oben ein Quiz erstellen und daraus eine Lobby hosten.</p></div></details>
  </div>
 </section>`;
}
function landing(){
 const hostCode=localStorage.getItem('bq-last-host')||'';
 let drafts=[],workspaceError='';try{drafts=boardList(localStorage);}catch(err){workspaceError=err?.message||'Quizbrett-Verzeichnis konnte nicht gelesen werden.';}
 const invite=hasValidRoom(roomFromLink);
 return `<div class="start-shell"><header class="start-head"><div class="brand"><div class="logo">B</div><div><strong>BrainQuiz Studio</strong><small>Version ${VERSION}</small></div></div></header>
 <main class="start-main"><h1>${invite?'Quiz beitreten':'Quiz erstellen oder beitreten'}</h1>
 ${invite?`<p class="small muted">Raum ${e(roomFromLink)} · Gib deinen Namen ein, um dem Quiz beizutreten.</p>`:'<p class="small muted">Erstelle dein Quiz. Klicke anschließend auf „Lobby hosten“ und teile den Code mit deinen Mitspielern.</p>'}
 <div class="start-grid ${invite?'bq-invite-landing':''}">
 ${!invite?savedQuizzesStart(drafts,workspaceError,hostCode):''}
  <section class="glass panel start-card"><h2>${invite?'Einladung annehmen':'Am Quiz teilnehmen'}</h2><form id="join-form" class="formgrid"><label class="field span2">Raumcode<input id="join-room" required maxlength="16" value="${e(roomFromLink)}" placeholder="16 Zeichen" autocomplete="off" ${invite?'readonly':''}></label><label class="field span2">Dein Name<input id="join-name" required maxlength="28" placeholder="Anzeigename" autocomplete="nickname"></label><button type="submit" class="btn primary" ${configured?'':'disabled'}>Beitreten</button></form><p class="small muted">Keine Installation und kein eigenes Konto erforderlich. Danach wählst du dein Team in der Lobby und kannst dich bereit melden.</p></section>
 </div>
 <details class="bq-online-setup bq-start-connectivity"><summary>Verbindung & Datenschutz</summary><div class="glass panel"><h3>PeerJS / WebRTC</h3>${turnRelaySetup()}<p class="small muted">Host-Browser muss geöffnet bleiben. PeerJS Cloud vermittelt nur die Verbindung, nicht den Spielstand. Bei CGNAT/Firewalls ist ein eigener TURN-Dienst für eine verlässliche Verbindung erforderlich; das Quiz kann keinen TURN-Zugang automatisch bereitstellen.</p></div></details></main></div>`;
}

function turnRelaySetup(){
 return `<details class="bq-auxiliary" data-bq-persist="turnsetup"><summary>Eigenen TURN-Relay einrichten</summary>
  <p>Bei CGNAT oder restriktiven Firewalls müssen Host und Gäste einen erreichbaren TURN-Server mit gültigen Zugangsdaten konfigurieren. Die Einstellung wird nur in diesem Browser-Tab gespeichert und gilt für neue Peer-Verbindungen. Ein normaler STUN-Server allein ersetzt TURN nicht.</p>
  <form id="turn-relay-form" class="formgrid">
   <label class="field span2">TURN-Adresse<input name="url" type="text" placeholder="turns:relay.example:443?transport=tcp" maxlength="300" required></label>
   <label class="field">Nutzername<input name="username" type="text" maxlength="512" autocomplete="off" required></label>
   <label class="field">Passwort<input name="credential" type="password" maxlength="512" autocomplete="off" required></label>
   <div class="row span2"><button type="submit" class="btn primary">TURN-Daten übernehmen</button>${btn('TURN-Daten entfernen','clear-turn-relay','small')}${btn('TURN-Verbindung prüfen','test-turn-relay','small')}</div>
  </form></details>`;
}
function hostPage(){if(isPublished()&&view==='editor')view='live';if(!publicState){return `<section class="glass panel"><div class="empty">Verbindung zum Raum wird aufgebaut …</div></section>`;}if(view==='editor')return renderEditor();if(view==='history')return renderHistory();if(view==='present')return (isOffline()?'':presentationControls())+renderPresenter();if(isOffline()&&view==='live')return renderHostLive();if(isOffline())return renderEditor();if(view==='teams')return renderTeams();if(view==='setup')return renderSetup();return renderHostLive();}
function guestPage(){
 if(member?.status==='removed')return `<section class="glass panel"><h2>Du wurdest aus dem Raum entfernt.</h2><p>Wende dich für eine erneute Freigabe an den Host.</p></section>`;
 if(!member||member.status==='pending')return lobbyGuestHTML(guestLobby,member);
 if(!publicState)return `<section class="glass panel"><div class="empty">Synchronisiere Live-Spielstand …</div></section>`;
 if(publicState.phase==='board'&&Number(publicState.round||0)===0&&!publicState.started)return `<section class="bq-session-scene bq-lobby-session">${lobbyGuestHTML(guestLobby,member)}<details class="bq-auxiliary bq-shared-team-chat" data-bq-persist="teamchat"><summary>Privater Teamchat</summary>${renderChat()}</details></section>`;
 if(view==='teams')return renderTeams();if(view==='setup')return renderSetup();return renderGuestLive();
}
function renderHistory(){
 const players=Object.fromEntries(participantList().map(([id,name,team])=>[id,{name,team}]));
 const rows=historyRows(questionHistory,responses,publicState?.playerScores,players);
 const visible=rows.filter(r=>[r.category,r.title,r.prompt,...r.participants.map(p=>p.name)].join(' ').toLocaleLowerCase('de').includes(historyFilter.toLocaleLowerCase('de')));
 const scoreLog=!isOffline()&&canHost()&&game?.hostScoreAudit?game.hostScoreAudit(room):[];
 const lastChange=latestUndoableEvent(scoreLog);
 const auditPanel=scoreLog.length?`<details class="glass panel bq-score-ledger" data-bq-persist="score-ledger"><summary>Wertungsprotokoll · ${scoreLog.length} Aktionen</summary>
 <p class="small muted">Änderungen bleiben nachvollziehbar. Rückgängig setzt nur die zuletzt aktive Punkteänderung zurück; die Frage oder bereits veröffentlichte Lösung bleibt unverändert.</p>
 ${lastChange?btn('Letzte Punkteänderung rückgängig','undo-last-score','small danger',`data-event="${e(lastChange.id)}"`):''}
 <ol>${scoreLog.slice().reverse().map(entry=>`<li class="${entry.undoneAt||entry.supersededBy?'muted':''}">
 <strong>${e(entry.corrects?'Neubewertung':entry.kind==='manual-team'?'Teamkorrektur':entry.kind==='manual-person'?'Spielerkorrektur':entry.kind==='buzzer-judgement'?'Buzzerbewertung':entry.kind===TEAM_EMOJI?'Emoji-Teamrunde':'Schriftliche Bewertung')}</strong>
 <span>${e(entry.changes?.team?.id?teamName(entry.changes.team.id):entry.changes?.person?.id?roster?.[entry.changes.person.id]?.name||entry.changes.person.id:'')}</span>
 <span>${entry.changes?.team?`${e(entry.changes.team.before??0)} → ${e(entry.changes.team.after??0)}`:entry.changes?.person?`${e(entry.changes.person.before?.total??0)} → ${e(entry.changes.person.after?.total??0)}`:''}</span>
  ${entry.round?`<small>Runde ${e(entry.round)} · ${e(new Date(entry.at).toLocaleTimeString('de-DE'))}</small>`:''}
  ${entry.actor&&entry.changes?.team?.id?`<span>${e(roster?.[entry.actor]?.name||publicState?.manualPlayers?.[entry.actor]||'Teilnehmer')}</span>`:''}
  ${entry.verdict?`<span>${entry.verdict==='correct'?'Richtig':'Falsch'}</span>`:''}
  ${entry.undoneAt?'<span>↶ zurückgenommen</span>':entry.supersededBy?'<span>Neu bewertet</span>':''}
  ${mayRegradeScore(publicState,entry)?btn(entry.verdict==='correct'?'Als falsch werten':'Als richtig werten','regrade-score','small',`data-event="${e(entry.id)}"`):''}</li>`).join('')}</ol></details>`:'';

 return `<section class="glass panel history-panel"><div class="panelhead"><div><h2>Gestellte Fragen</h2><p class="small muted">Fragen, abgegebene Antworten und Bewertung · nur für den Host</p></div><div class="row"><span class="pill">${rows.length} Runden</span>${btn('Verlauf exportieren','export-history','small',rows.length?'':'disabled')}</div></div>
 ${auditPanel}<label class="field history-search">Verlauf durchsuchen<input id="history-search" type="search" value="${e(historyFilter)}" placeholder="Kategorie, Frage oder Person"></label>
 <div class="history-list">${visible.length?visible.map(r=>{
 const q=quiz.questions.find(q=>q.id===r.questionId);
 return `<details class="history-entry" ${r.round===Number(publicState?.round)?'open':''}><summary><span class="history-round">${r.round}</span><span class="history-question"><b>${e(r.category)} · ${e(r.points)} Punkte</b><span>${e(r.prompt||q?.prompt||r.title||'Frage')}</span></span><span class="history-numbers"><span class="history-count good">✓ ${r.correctCount}</span><span class="history-count danger-text">✕ ${r.wrongCount}</span><span class="history-count">${r.submittedCount} Antworten</span></span></summary>
 <div class="history-details">${r.solution?`<div class="history-solution"><span class="sub">Musterlösung</span><strong>${e(r.solution)}</strong></div>`:''}
 ${r.participants.length?`<div class="history-answers">${r.participants.map(p=>{const status=responseStatus(p.status);return `<div class="history-person"><div class="history-person-name"><b>${e(p.name)}</b><span class="status-tag ${e(p.status)}">${status.icon} ${status.label}</span></div><div class="history-person-answer">${p.answer?e(p.answer):'<span class="muted">Keine gespeicherte Antwort</span>'}</div>${p.delta!==null?`<span class="history-delta">${p.delta>0?'+':''}${p.delta.toLocaleString('de-DE')} Punkte</span>`:''}</div>`}).join('')}</div>`:'<p class="small muted">Keine abgegebenen Antworten oder Bewertungen für diese Runde.</p>'}
 </div></details>`;}).join(''):'<div class="empty">Keine passenden Fragerunden vorhanden. Öffne eine Frage aus dem Quizbrett.</div>'}</div></section>`;
}
function boardColumns(){return categoryColumns(Object.values(publicState?.board||{}).filter(cell=>boardRoundOf(cell)===boardRoundOf(publicState)));}
function boardPages(){return pageBoardColumns(boardColumns(),window.innerWidth||1280,window.innerHeight||800);}
function renderBoard(readOnly=false){
 if(!publicState)return '';
 const columns=readOnly?boardColumns():null;
 const pages=readOnly&&columns.length?[{columns:columns.slice(0,6).map(column=>({...column,items:column.items.slice(0,6)})),rows:Math.min(6,Math.max(...columns.map(column=>column.items.length)))}]:boardPages();
 if(!readOnly)boardPage=Math.min(boardPage,Math.max(0,pages.length-1));
 if(!pages.length)return '<div class="empty">Noch keine Fragen veröffentlicht.</div>';
 const page=pages[readOnly?0:Math.min(boardPage,pages.length-1)];
 const choose=canHost()?'open':'request-pick';
 const reserved=publicState.questionPick?.qid||'';
 const canSelect=canHost()||(!reserved&&(!selectingTeam(publicState)||selectingTeam(publicState)===member?.team));
 return `<div class="bq-board-full" aria-label="Fragenübersicht">
 <div class="board-scroll"><div class="board jeopardy-board ${page.rows<4?'bq-board-sparse':''}" style="--board-cols:${page.columns.length};--board-rows:${page.rows}">${page.columns.map(col=>`<div class="column"><div class="coltitle" title="${e(col.category)}">${e(col.category)}</div>${col.items.map(q=>{
 const used=isBoardCellPlayed(q,publicState),points=used?Number(q.points):boardQuestionPoints(publicState,q);
 const doubled=!used&&points===Number(q.points)*2&&finalSixActive(publicState);
 const bonusText=doubled?' · doppelte Punkte (×2)':'';
 if(readOnly)return `<div class="tile ${used?'used is-played':''} ${doubled?'bq-double-points':''}" aria-label="${e(points)} Punkte${bonusText}${used?', bereits gespielt':''}"><span class="tile-points">${used?'✓':e(points)}</span></div>`;
 return `<button type="button" class="tile ${used?'used is-played':''} ${reserved===q.id?'bq-tile-reserved':''} ${doubled?'bq-double-points':''}" data-action="${choose}" data-qid="${e(q.id)}" title="${e(col.category)} · ${e(points)} Punkte${bonusText}${used?' · bereits gewählt':reserved===q.id?' · vom Team gewählt':''}" aria-label="${e(col.category)} · ${e(points)} Punkte${bonusText}${used?' · bereits gespielt':reserved===q.id?' · vorgemerkt':''}" ${used||!canSelect||(canHost()&&reserved&&reserved!==q.id)||(!canHost()&&publicState.phase!=='board')?'disabled':''}><span class="tile-points">${used?'✓':e(points)}</span></button>`;
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
 const official=choice&&publicState?.writtenTeamRepresentatives?.[roundKey()]?.[roster?.[choice.id]?.team];
 const teamAlreadyJudged=scoreMode(publicState)==='team'&&!!official&&official!==choice?.id;
 const judgeDisabled=teamAlreadyJudged?'disabled title="Pro Team wird nur eine offizielle Antwort je Frage gewertet"':question?'':'disabled';
 return `<section class="glass panel scoring-panel"><div class="panelhead"><h3>Teilnehmer & Punkte</h3><div class="row"><span class="pill">${people.length}</span>${btn('+ Person','add-person','small')}</div></div>${people.length?`<div class="score-people">${people.map(p=>`<button type="button" class="score-person ${p.id===scoreTarget?'selected':''} ${locks[p.id]?'is-locked':''}" data-action="select-player" data-person="${e(p.id)}"><span><b>${e(p.name)}</b><small>${e(p.team)}${locks[p.id]?' · Buzzer gesperrt':''}</small></span><strong>${p.points.toLocaleString('de-DE')}</strong></button>`).join('')}</div>`:'<div class="empty">Noch keine Spieler. Im Editor unter „Quiz-Einstellungen“ manuelle Teilnehmer eintragen oder Online-Spieler freigeben.</div>'}
 ${choice?`<div class="score-actions"><div class="small muted">Ausgewählt: ${e(choice.name)}${locks[choice.id]?' · aktuell für diese Frage gesperrt':''}</div><div class="row">${roundMode(question)==='written'?`${teamAlreadyJudged?'<span class="small muted">Eine andere Person dieses Teams wurde bereits offiziell bewertet.</span>':''}${btn('Richtig · +'+pts,'judge-correct','primary',judgeDisabled)}${btn('Falsch · −'+(pts/2),'judge-wrong','danger',judgeDisabled)}`:'<p class="small muted">Buzzer direkt in der Hauptleiste bewerten.</p>'}${btn('Buzzer freigeben','unlock-buzz-player','small',locks[choice.id]?'':'disabled')}</div><div class="manual-points"><label class="field">Punkte manuell ändern<input id="person-adjust" type="number" step="0.5" min="-10000" max="10000" value="50"></label>${btn('Hinzufügen / Abziehen','adjust-player','small')}</div><div class="small muted">Bei „Falsch“ verliert der aktuelle Buzzer automatisch die Hälfte der Fragepunkte. Danach wird der Buzzer wieder freigegeben; dieselbe Person bleibt bis zur manuellen Freigabe gesperrt.</div></div>`:''}</section>`;
}
function safeImage(value){return isImageData(value)?value:'';}
function guestCanAnswer(){const q=activeQuestion(),timeUp=!!publicState?.deadline&&publicState.deadline<now();return role==='guest'&&member?.status==='approved'&&!!q&&roundMode(q)==='written'&&!!publicState?.answerParticipants?.[game?.uid]&&isOpen()&&!timeUp;}
function renderReviewGallery(readOnly=false){
 const host=canHost()&&!readOnly;
 const board=publicState?.answerReview;if(!board)return '';
 const entries=Object.entries(board.entries||{});const visible=entries.filter(([,a])=>a.revealed).length;
 const mapQuestion=activeQuestion()?.type==='map';
 const solution=mapQuestion&&publicState?.phase==='reveal'&&publicState?.solutionVisible!==false?normalizePoint({x:activeQuestion().mapTargetX,y:activeQuestion().mapTargetY}):null;
 const mapDistances=new Map(mapAnswerDistances(board,solution).map(row=>[row.id,row.distanceKm]));
 return `<div class="answer-review ${mapQuestion?'bq-map-answer-review':''}">
  <div class="review-summary"><span class="pill">${entries.length} Personen</span><span class="pill">${visible} aufgedeckt</span><span class="small muted">${solution?(roundMode(activeQuestion())==='buzzer'&&publicState?.buzzerResolved?.[roundKey()]?'Entfernungen in km Luftlinie. Die Buzzerentscheidung und Punktevergabe sind abgeschlossen.':'Entfernungen in km Luftlinie. Der Host entscheidet weiterhin selbst über die Gewinner und Punkte.'):'Antworten erscheinen erst nach Freigabe durch den Host.'}</span></div>
  <div class="review-grid" style="--review-columns:${Math.min(4,Math.max(1,Math.ceil(entries.length/2)))}">${entries.map(([id,a])=>{
   const state=answerCardState(a),hidden=state==='hidden',submitted=state!=='missing';
   const display=!submitted?'<span class="small muted">Keine Antwort abgegeben</span>':hidden?`<div class="frosted-shield" aria-label="Antwort verdeckt – wird erst nach Host-Freigabe geladen"><span class="frosted-symbol" aria-hidden="true">◇</span><span class="frosted-title">Antwort verdeckt</span><span class="frosted-bars" aria-hidden="true"><i></i><i></i><i></i></span></div>`:`<span class="review-answer">${e(a.value||'')}</span>`;
   const distanceKm=mapDistances.get(id);
   const distance=distanceKm===undefined?'':`<div class="bq-review-map-distance" aria-label="Entfernung von ${e(a.name||'Spieler')} zum Lösungs-Pin"><span>Zum Lösungs-Pin</span><strong>${e(formatMapDistanceKm(distanceKm))}</strong><small>Luftlinie</small></div>`;
   const clickable=host&&publicState.phase==='review'&&submitted&&hidden;
   const verdict=host?publicState?.playerScores?.[id]?.rounds?.[roundKey()]?.result:null;
   const team=roster?.[id]?.team;
   const official=host&&scoreMode(publicState)==='team'&&team?publicState?.writtenTeamRepresentatives?.[roundKey()]?.[team]:null;
   const teamAlreadyJudged=!!official&&official!==id;
   const judgeAttrs=teamAlreadyJudged?`data-person="${e(id)}" disabled title="Für dieses Team zählt bereits die offiziell bewertete Antwort von ${e(roster?.[official]?.name||'einem anderen Mitglied')}"`:`data-person="${e(id)}"`;
   return `<article class="review-card ${!submitted?'is-missing':hidden?'is-hidden':'is-revealed'} ${clickable?'bq-selectable review-clickable':''}" data-review-player="${e(id)}" ${clickable?`role="button" tabindex="0" data-action="reveal-answer" data-uid="${e(id)}" aria-label="Antwort von ${e(a.name||'Spieler')} aufdecken"`:''}><div class="review-name">${e(a.name||'Spieler')}</div><div class="review-value">${display}</div>${distance}<div class="review-footer">${!submitted?'<span class="small muted">Keine Abgabe</span>':hidden?'<span class="small muted">Verdeckt</span>':'<span class="small good">Aufgedeckt</span>'}${clickable?'<span class="small good">Klicken: aufdecken</span>':''}</div>${host&&submitted&&!hidden&&roundMode(activeQuestion())==='written'?`<div class="review-judge"><span class="status-tag ${e(verdict||'open')}">${responseStatus(verdict).icon} ${responseStatus(verdict).label}</span>${official===id?'<span class="small good">Offizielle Teamantwort</span>':teamAlreadyJudged?'<span class="small muted">Andere Teamantwort zählt bereits</span>':''}${btn('✓ Richtig','judge-review-correct','small',judgeAttrs)}${btn('✕ Falsch','judge-review-wrong','small',judgeAttrs)}</div>`:''}</article>`;
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
 const cells=boardColumns().flatMap(column=>column.items);
 const suggestions=host?Object.entries(picks||{}).filter(([,x])=>p.board?.[x.qid]&&!p.board[x.qid]?.used):[];
 const hasRoundTwo=boardRoundOf(p)===1&&Object.values(p.board||{}).some(cell=>boardRoundOf(cell)===2);
 const remainingFirst=hasRoundTwo?remainingBoardQuestions(p,1).length:0;
 return `<section class="bq-session-scene bq-board-scene" data-scene="board"><div class="bq-scene-heading"><div><span class="bq-eyebrow">RUNDE ${boardRoundOf(p)}${Object.values(p.board||{}).some(cell=>boardRoundOf(cell)===2)?' VON 2':''}</span><h2>Fragenübersicht</h2></div><span class="pill">${cells.filter(q=>q.used).length} / ${cells.length} gespielt</span></div>
 ${finalSixActive(p)?`<div class="bq-final-six-banner" role="status"><strong>⚡ Endspurt: letzte 6 Fragen</strong><span>Alle verbleibenden Felder auf diesem Brett zählen doppelt (×2). Die Wertung gilt nur für Runde ${boardRoundOf(p)}.</span></div>`:''}
 ${selectingTeam(p)?`<div class="glass bq-selection-turn" role="status" aria-atomic="true"><strong>${e(teamName(selectingTeam(p)))} wählt die nächste Frage</strong><span>${p.questionPick?'Frage vorgemerkt: der Host öffnet sie oder gibt die Auswahl wieder frei.':host?'Der Host kann das Feld auch für dieses Team öffnen.':selectingTeam(p)===member?.team?'Wähle ein Feld. Die Frage bleibt bis zur Host-Aufdeckung verdeckt.':'Warte auf die Auswahl. Danach dürfen alle Teams buzzern.'}</span>${host&&p.questionPick?btn('Auswahl freigeben','clear-pick','small'):host&&p.selectionTurn?.order?.length>1?btn('Auswahlrecht weitergeben','skip-turn','small'):''}</div>`:''}
 ${host&&canArrangeLobby(p)?`<div class="bq-host-lobby-mini"><strong>✓ ${lobbySnapshot({public:p,roster,members,presence}).ready}/${approvedCount(roster)} bereit</strong>${btn('Team-Lobby öffnen','view','small','data-view="teams"')}</div>`:''}<div class="bq-board-frame ${boardPeekRound()?'has-cameo':''}">${sceneCameos('board')}<section class="glass panel bq-board-panel">${boardPeekRound()?'<span class="bq-peek-fingers" aria-hidden="true"></span>':''}${renderBoard()}</section></div>
 ${suggestions.length?`<details class="bq-auxiliary"><summary>${suggestions.length} Fragenwunsch${suggestions.length===1?'':'e'} von Teilnehmern</summary><div class="row">${suggestions.slice(-8).map(([,x])=>btn(`${e(x.name||'Spieler')}: ${e(p.board[x.qid]?.category||'')} ${e(p.board[x.qid]?.points||'')}`,'open','small',`data-qid="${e(x.qid)}"`)).join('')}</div></details>`:''}
 ${rehearsal?'':host?`<details class="bq-auxiliary bq-host-tools" data-bq-persist="hosttools"><summary>Spieler verwalten und Einstellungen</summary>${scorePanel()}${renderChat()}</details>`:`<details class="bq-auxiliary bq-shared-team-chat" data-bq-persist="teamchat"><summary>Teamchat · ${e(teamName(member?.team))}</summary>${renderChat()}</details>`}
 ${host&&canAdvanceBoard(p)?`<div class="bq-round-transition">${btn('Runde 2 starten','next-board','primary')}</div>`:''}
 ${host&&hasRoundTwo&&remainingFirst? `<details class="bq-auxiliary bq-round-override"><summary>Ausnahme: Runde 1 vorzeitig beenden</summary><p class="small muted">Noch ${remainingFirst} Frage${remainingFirst===1?'':'n'} offen. Üblicherweise startet Runde 2 erst, wenn alle Fragen aus Runde 1 gespielt wurden. Nur bei einem bewusst verkürzten Spiel verwenden.</p>${btn('Offene Felder überspringen und Runde 2 starten','skip-board','small danger')}</details>`:''}
 ${sessionFooter()}</section>`;
}
function hasLiveQuestion(){return sceneForPublicState(publicState)==='question';}
function renderReviewView(){
 const p=publicState,q=activeQuestion(),buzzerWinner=p.phase==='reveal'&&roundMode(q)==='buzzer'?p.buzzerResolved?.[roundKey()]:null;
 const winnerBanner=buzzerWinner?`<div class="bq-quiz-verdict is-right bq-review-winner" role="status"><strong>✓ Richtig beantwortet!</strong><span>${e(roster?.[buzzerWinner.uid]?.name||winner()?.name||'Teilnehmer')} · ${e(teamName(buzzerWinner.team))} · +${e(q?.points||0)} Punkte</span><small>Die Lösung ist aufgedeckt. Der Host wählt die nächste Frage.</small></div>`:'';
 return `<section class="bq-session-scene bq-question-scene" data-scene="question"><div class="bq-scene-heading"><div><span class="bq-eyebrow">FRAGE ${e(p.round)}</span><h2>${e(q?.category||'Aktuelle Frage')} · ${e(q?.points||0)} Punkte</h2></div><span class="pill ${p.phase==='reveal'?'good':''}">${p.phase==='reveal'?(p.solutionVisible===false?'Frage im Rückblick':'Lösung sichtbar'):'Antworten aufdecken'}</span></div>
 ${winnerBanner}<div class="bq-answer-review-body"><section class="glass panel bq-question-panel"><div class="bq-scene-content">${renderStage()}</div></section>
 <section class="glass panel bq-answers-panel"><h3>Antworten</h3>${renderReviewGallery()}</section></div>
 ${canHost()?`<div class="bq-action-bar bq-host-action-bar" aria-label="Host-Steuerung"><span class="bq-action-step">${buzzerWinner?'Runde abgeschlossen':'Antworten prüfen'}</span>${p.phase==='review'?btn('Alle Antworten aufdecken','reveal-all-answers','primary'):''}${p.phase==='review'?btn('Lösung zeigen','reveal','primary'):(p.solutionVisible===false?btn('Lösung erneut zeigen','solution-forward','primary'):btn('Schritt zurück · Frage ansehen','reveal-prev','small'))}${btn(p.phase==='reveal'?'Weiter zum Quizbrett':'Zurück zum Quizbrett','back',p.phase==='reveal'?'primary':'small')}
 <details class="bq-auxiliary" data-bq-persist="reviewscore"><summary>Bewertungen & Punkte</summary>${scorePanel()}</details></div>`:''}
 ${sessionFooter()}</section>`;
}
function canMapPick(){const q=activeQuestion();return role==='guest'&&q?.type==='map'&&member?.status==='approved'&&isOpen()&&(!publicState?.deadline||now()<publicState.deadline)&&(roundMode(q)==='written'?!!publicState?.answerParticipants?.[game?.uid]:winner()?.uid===game?.uid)}
function releasedMapPins(){
 if(!reviewIsCurrent(publicState))return [];
 const solution=publicState.phase==='reveal'&&publicState.solutionVisible!==false&&activeQuestion()?.type==='map'
  ?normalizePoint({x:activeQuestion().mapTargetX,y:activeQuestion().mapTargetY}):null;
 const distances=new Map(mapAnswerDistances(publicState.answerReview,solution).map(row=>[row.id,row.distanceKm]));
 return Object.entries(publicState.answerReview?.entries||{})
  .filter(([,entry])=>entry?.revealed&&decodePoint(entry.value))
  .map(([id,entry])=>({...decodePoint(entry.value),name:entry.name,distanceKm:distances.get(id)??null}));
}
function renderMapFallback(q){return renderScene({template:'map',elements:[]},{mapPrompt:q.prompt,mapView:mapCamera,mapCanPick:canMapPick(),mapPin:!canHost()?(mapPick||decodePoint(myResponse?.text)):null,mapSolution:publicState?.phase==='reveal'&&publicState.solutionVisible!==false?normalizePoint({x:q.mapTargetX,y:q.mapTargetY}):null,mapPublicPins:releasedMapPins(),revealed:publicState?.phase==='reveal'&&publicState.solutionVisible!==false})}
function renderStage(readOnly=false){let q=activeQuestion();const isReveal=publicState.phase==='reveal';if(q?.type==='map'&&mapCameraQuestion!==q.id){mapCamera={...DEFAULT_MAP_VIEW};mapCameraQuestion=q.id;}if(!q)return `<div class="stage"><h2>${canHost()?'Frage auswählen':'Keine Frage aktiv'}</h2></div>`;
 if(publicState.phase==='ready')return readyQuestionContent(false);
 if(q.type===TEAM_EMOJI&&publicState.teamEmoji)return renderTeamEmoji(readOnly);
 const showAnswer=isReveal&&publicState.solutionVisible!==false;
 // For a step back, reproduce the previous public question display without
 // duplicating its media in network snapshots or changing the scored round.
 const previous=!showAnswer&&isReveal?publicState.preRevealDisplay:null;
 if(previous&&q){
  const sceneStep=Math.max(0,Math.min(5,Number(previous.sceneStep)||0));
  q={...q,
   scene:q.scene?{...q.scene,step:sceneStep,elements:(q.scene.elements||[]).filter(element=>Number(element.step||0)<=sceneStep)}:q.scene,
   hints:(q.hints||[]).slice(0,Math.max(0,Number(previous.hintStep)||0)),
   image:previous.image||q.image,
   visualStep:Math.max(0,Number(previous.visualStep)||0)};
 }
 let html=`<div class="stage ${showAnswer?'bq-stage-is-answer':''}">${showAnswer?renderAnswerView(q)+'<section class="bq-answer-context" aria-label="Frage im Rückblick">':''}<div class="eyebrow">${e(q.category)} · ${isReveal?(showAnswer?'FRAGE IM RÜCKBLICK':'FRAGE OFFEN'):publicState.phase==='paused'?'PAUSIERT':'FRAGE OFFEN'}</div>${q.scene?'':(q.prompt?`<h2>${e(q.prompt)}</h2>`:'')}${q.scene?renderScene(q.scene,{revealed:showAnswer,interactive:!canHost(),canAnswer:guestCanAnswer()&&!myResponse,picked:pickedOrder,correctIndex:q.type==='imposter'?(q.imposterIndex||0):(q.correct||0),mapCanPick:canMapPick(),mapView:mapCamera,mapPin:!canHost()?(mapPick||decodePoint(myResponse?.text)):null,mapSolution:showAnswer&&q.type==='map'?normalizePoint({x:q.mapTargetX,y:q.mapTargetY}):null,mapPublicPins:q.type==='map'?releasedMapPins():[] }):renderBlocks(q.blocks,{reveal:showAnswer})}`;
 if(q.type==='map'&&!q.scene)html+=renderMapFallback(q);
 if(!q.scene&&q.type==='splash')html+=safeImage(q.image)?`<img class="media" src="${safeImage(q.image)}" alt="Rätselbild">`:`<p class="hint">Kein Rätselbild hinterlegt.</p>`;
 if(!q.scene&&q.type==='multiple')html+=`<div class="choices">${(q.options||[]).map((opt,i)=>`${guestCanAnswer()?`<button type="button" class="choice ${showAnswer&&q.correct===i?'correct':''}" data-action="select-choice" data-choice="${'ABCD'[i]}" ${myResponse?'disabled':''}><b>${'ABCD'[i]}</b>${e(opt)}</button>`:`<div class="choice ${showAnswer&&q.correct===i?'correct':''}"><b>${'ABCD'[i]}</b>${e(opt)}</div>`}`).join('')}</div>`;
 if(!q.scene&&q.type==='imposter')html+=`<div class="abilities">${(q.icons||[]).map((icon,i)=>`<div class="ability ${showAnswer&&q.imposterIndex===i?'is-imposter':''}" ${showAnswer&&q.imposterIndex===i?'aria-label="Falsches Bild – ausgetauschter Slot"':''}>${safeImage(icon)?`<img src="${safeImage(icon)}" alt="${e(q.abilityNames?.[i]||'Fähigkeit '+(i+1))}">`:`<div class="preview-placeholder">Icon fehlt</div>`}<b>${e(q.abilityNames?.[i]||ABILITIES[i])}</b>${showAnswer&&q.imposterIndex===i?'<span class="bq-imposter-wrong-label">FALSCHES BILD</span>':''}</div>`).join('')}</div>`;
 if(!q.scene&&(q.type==='quote'||q.type==='emoji'))html+=`<div class="cluebox ${q.type==='emoji'?'emojiclue':''}" aria-label="Rätselhinweis">${e(q.clue||'')}</div>`;
 if(q.type==='estimate')html+=`<div class="cluebox">Schätze den Zahlenwert${q.estimateUnit?' in '+e(q.estimateUnit):''}.</div>`;
 if(!q.scene&&q.type==='order')html+=`<div class="ordergrid" aria-label="Einträge zum Sortieren">${(q.displayItems||[]).map((item,i)=>`<button class="orderitem ${pickedOrder.includes(i)&&!canHost()?'chosen':''}" data-action="pick-order" data-index="${i}" ${guestCanAnswer()&&!myResponse&&!pickedOrder.includes(i)?'':'disabled'}><b>${String.fromCharCode(65+i)}</b><span>${e(item)}</span>${!canHost()&&pickedOrder.includes(i)?`<strong>${pickedOrder.indexOf(i)+1}.</strong>`:''}</button>`).join('')}</div>${!canHost()&&isOpen()&&!myResponse?`<div class="small muted">Klicke die Einträge in deiner gewünschten Reihenfolge an. ${pickedOrder.length}/${(q.displayItems||[]).length} gewählt.</div>`:''}`;
 if(q.type==='audio')html+=readOnly?'<p class="small muted">Der Host steuert die Wiedergabe.</p>':soundQuizMarkup(q);
 if((q.hints||[]).length)html+=`<div class="hintlist">${q.hints.map((h,i)=>`<p><b>Tipp ${i+1}:</b> ${e(h)}</p>`).join('')}</div>`;
 if(q.type==='splash'&&!showAnswer)html+=`<p class="small muted">Bildstufe ${Number(q.visualStep||0)+1} von 3 · Der Originalausschnitt bleibt bis zur Auflösung beim Host.</p>`;
 html+=showAnswer?'</section></div>':'</div>';return html;}
function scores(){const teams=Object.entries(publicState?.teams||{}).sort((a,b)=>(publicState?.scores?.[b[0]]||0)-(publicState?.scores?.[a[0]]||0));return teams.map(([id,label])=>`<div class="scoreline"><span class="team"><span class="marker" style="background:${teamColor(id)}"></span><span>${e(label)}</span></span><b>${Number(publicState?.scores?.[id]||0).toLocaleString('de-DE')}</b></div>`).join('')||'<div class="empty">Keine Teams</div>';}
function scoreControls(){const pts=activeQuestion()?.points??100;return Object.entries(publicState?.teams||{}).map(([id,label])=>`<div class="scoreline"><b>${e(label)}</b><div class="row">${btn('−'+pts,'score','small danger',`data-team="${id}" data-amount="-${pts}"`)}${btn('+'+pts,'score','small primary',`data-team="${id}" data-amount="${pts}"`)}</div></div>`).join('');}
function buzzerStatus(){const b=winner(),locks=Object.values(buzzLocks()),teamLocks=Object.keys(publicState?.buzzerBlockedTeams?.[roundKey()]||{});return `<div class="buzzerbox"><div class="sub">BUZZER / SERVERENTSCHEIDUNG</div>${b?`<h2 style="margin:16px 0 4px">◉ ${e(b.name)}</h2><p>${e(teamName(b.team))} ist zuerst eingegangen und darf antworten.</p>`:`<h2 style="margin:16px 0 4px">○ Noch kein Buzzer</h2><p>${isOpen()?'Frage läuft, Buzzer ist für alle freigegeben.':'Buzzer derzeit nicht aktiv.'}</p>`}<p class="small muted">Gesperrt für diese Runde: ${locks.length?locks.map(x=>e(x.name||x.uid||'Spieler')).join(' · '):'niemand'}${teamLocks.length?' · Teams: '+teamLocks.map(id=>e(teamName(id))).join(', '):''}</p>${canHost()?`<div class="row">${btn('Buzzer zurücksetzen','reset-buzz','small',b?'':'disabled')}${btn('Alle Sperren lösen','unlock-buzz-all','small',locks.length?'':'disabled')}</div>`:''}</div>`;}
function hostVisibilityCard(){const b=winner(),locks=Object.values(buzzLocks());return `<section class="glass panel bq-host-visibility"><div class="panelhead"><h3>Zuschauerzustand</h3><span class="pill good">${e(viewerStateLabel())}</span></div><div class="bq-visibility-grid"><div><div class="sub">Sichtbar für Zuschauer</div><strong>${e(publicState?.phase==='board'?'Quizbrett':publicState?.phase==='review'?'Antwortübersicht':hasLiveQuestion()?'Aktuelle Frage':'Warteansicht')}</strong><p class="small muted">${publicState?.phase==='reveal'?'Die Lösung ist sichtbar.':publicState?.phase==='question'?'Die Frage ist geöffnet, die Lösung noch verborgen.':publicState?.phase==='review'?'Nur die freigegebenen Antworten sind sichtbar.':'Noch keine offene Frage.'}</p></div><div><div class="sub">Buzzerstatus</div><strong>${b?e(b.name)+' · '+e(teamName(b.team)):'Noch frei'}</strong><p class="small muted">${locks.length?locks.length+' gesperrt in dieser Runde':'Niemand gesperrt in dieser Runde'}</p></div></div></section>`;}
function hostPrivateSolution(){const q=quiz.questions.find(x=>x.id===activeQuestion()?.id);if(!q)return '';
 const answer=answerViewContent(q),hint=answer.text||(!answer.image?'Nicht eingetragen':'Antwortbild hinterlegt');
 return `<details class="bq-host-solution"><summary>🔒 Nur für Host: Lösung ansehen</summary><div class="bq-host-solution-body"><strong>${e(hint)}</strong>${q.acceptedAnswers?`<p><b>Akzeptierte Varianten:</b> ${e(q.acceptedAnswers)}</p>`:''}${q.hostNotes?`<p><b>Host-Notizen:</b> ${e(q.hostNotes)}</p>`:''}${q.sourceUrl?`<p><b>Quelle:</b> ${e(q.sourceUrl)}</p>`:''}${q.sourcePatch?`<p><b>Patch / Bezugsjahr:</b> ${e(q.sourcePatch)}</p>`:''}${q.sourceCheckedOn?`<p>Geprüft am ${e(q.sourceCheckedOn)}</p>`:''}<p class="small muted">Dieser Bereich wird niemals an Teilnehmer gesendet. Die öffentliche Lösung bleibt verborgen, bis du sie freigibst.</p></div></details>`;
}
function hostBuzzerControl(){const q=activeQuestion(),b=winner(),resolved=publicState?.buzzerResolved?.[roundKey()];
 const participantIds=Object.keys(roster||{});
 const eligibleTeams=[...new Set(Object.values(roster||{}).map(player=>player?.team).filter(team=>publicState?.teams?.[team]))];
 const noBuzzerRights=publicState?.scoreMode==='individual'
  ?participantIds.length>0&&participantIds.every(uid=>publicState?.buzzerBlocked?.[roundKey()]?.[uid])
  :eligibleTeams.length>0&&eligibleTeams.every(team=>publicState?.buzzerBlockedTeams?.[roundKey()]?.[team]);
 if(roundMode(q)==='written')return `<div class="bq-host-main-status">✍️ Alle Teilnehmer schreiben selbst. ${answerProgress(publicState?.answerParticipants,responses?.[roundKey()]).submitted} von ${answerProgress(publicState?.answerParticipants,responses?.[roundKey()]).total} Antworten eingegangen.</div>`;
 if(resolved)return `<div class="bq-host-main-status bq-host-won" role="status">✓ ${e(teamName(resolved.team))} richtig bewertet · +${e(q.points)} Punkte. ${publicState.phase==='reveal'?'Weiter mit der Fragenübersicht.':'Die Lösung über „Lösung zeigen“ aufdecken.'}</div>`;
 if(publicState?.phase==='reveal')return '<div class="bq-host-main-status bq-host-won" role="status">Lösung wurde aufgedeckt. Diese Runde ist beendet – nächstes Feld über das Quizbrett auswählen.</div>';
 if(!b&&isOpen()&&publicState?.settings?.buzzerEnabled!==false&&publicState?.buzzerArmed===false){
  return `<div class="bq-host-main-status"><span>Die Frage ist offen. Der Buzzer wartet auf deine Freigabe.</span>${btn('Buzzer freigeben','arm-buzzer','primary','data-armed="true"')}</div>`;
 }
 if(!b&&noBuzzerRights&&isOpen())return `<div class="bq-host-main-status" role="status"><strong>Keine Buzzer mehr möglich.</strong> Alle Teams bzw. Spieler sind für diese Frage gesperrt. Der Host kann die Lösung zeigen oder bewusst alle Sperren aufheben. ${btn('Buzzer-Sperren aufheben','unlock-buzz-all','small')}</div>`;
 if(!b){const last=publicState?.buzzerJudgements?.[roundKey()],lastName=last?.result==='wrong'?(publicState?.buzzerBlocked?.[roundKey()]?.[last.uid]?.name||roster?.[last.uid]?.name||'Teilnehmer'):'';return `<div class="bq-host-main-status" role="status"><span>${last?.result==='wrong'?`✕ ${e(lastName)} lag falsch (${e(last.delta)} Punkte). Die Lösung bleibt verborgen, die übrigen Teams können buzzern.`:'🎙️ Buzzer freigegeben · Wer zuerst buzzert, erhält das Antwortrecht.'} ${Object.keys(publicState?.buzzerBlockedTeams?.[roundKey()]||{}).length?'Gesperrte Teams bleiben ausgeschlossen.':''}</span>${Object.keys(publicState?.buzzerBlocked?.[roundKey()]||{}).length?btn('Buzzer-Sperren aufheben','unlock-buzz-all','small'):''}</div>`;}
 return `<div class="bq-buzzer-winner"><div><span>AM BUZZER</span><strong>${e(b.name)} · ${e(teamName(b.team))}</strong><small>Antwort jetzt mündlich entgegennehmen und bewerten.</small></div><div class="bq-judge-actions">${btn('✓ Richtig · +'+e(q.points),'buzz-correct','primary')}${btn('✕ Falsch · −'+e(q.points/2),'buzz-wrong','danger')}${btn('Irrtümlichen Buzzer zurücksetzen','reset-buzz','small')}</div></div>`;
}
function chatAllowed(){return !!(publicState?.settings?.chatOpen&&!(isOpen()&&(activeQuestion()?.type===TEAM_EMOJI||publicState.settings.lockOnBuzz&&winner())));}
function renderChat(){const teams=Object.entries(publicState?.teams||{});const host=canHost(),selected=host?chatTeam:member?.team;if(host&&selected!=='ALL'&&!publicState?.teams?.[selected])chatTeam='ALL';let all=[];
 for(const [teamId,items]of Object.entries(messages||{})){if(!host&&teamId!==selected)continue;if(host&&selected!=='ALL'&&teamId!==selected)continue;for(const [id,msg]of Object.entries(items||{})){all.push({...msg,id,teamId});}}
 all.sort((a,b)=>(a.at||0)-(b.at||0));all=all.slice(-80);
 return `<section class="glass panel"><div class="panelhead"><h3>Teamchat</h3><span class="pill ${chatAllowed()?'good':'warn'}">${chatAllowed()?'OFFEN':'GESPERRT'}</span></div>${host?`<label class="field" style="margin-bottom:10px">Kanal<select id="chat-team"><option value="ALL" ${chatTeam==='ALL'?'selected':''}>Alle Teamkanäle</option>${teams.map(([id,name])=>`<option value="${id}" ${chatTeam===id?'selected':''}>${e(name)}</option>`).join('')}</select></label>`:`<p class="small">Nur dein Team und der Host sehen diese Nachrichten.</p>`}<div class="chatfeed" id="chatfeed">${all.length?all.map(m=>`<div class="message ${m.uid===game?.uid?'mine':''}"><small><b>${e(m.name)}</b>${host?` · ${e(teamName(m.teamId))}`:''} · ${m.at?new Date(m.at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):''}</small><p>${e(m.text)}</p></div>`).join(''):'<div class="empty">Noch keine Nachrichten</div>'}</div><form id="chat-form" class="chatinput"><input id="chat-text" maxlength="500" placeholder="Nachricht an dein Team …" autocomplete="off" ${(!host&&!chatAllowed())?'disabled':''}><button type="submit" class="btn small primary" ${(!host&&!chatAllowed())?'disabled':''}>Senden</button></form>${!chatAllowed()?'<p class="small muted" style="margin-top:9px">Chat gesperrt.</p>':''}</section>`;}
function renderFinalResults(host=false){
 const standing=finalStandings(publicState,roster);
 const ranks=podiumRanks(standing);
 const step=publicState.finaleStep;
 const rank=Number.isInteger(step)?ranks[step]:null;
 const visible=rank?standing.filter(row=>row.rank>=rank&&row.rank<=3):standing;
 const first=visible.filter(row=>row.rank===1);
 const heading=rank?'Platz '+rank:'Das Quiz ist beendet!';
 const names=first.map(row=>e(row.name)).join(' · ');
 const subtitle=first.length>1?names+' teilen sich Platz 1.':first.length?names+' gewinnt!':rank?'Siegerehrung':'Danke fürs Mitmachen!';
 const showNext=Number.isInteger(step)&&step<ranks.length-1;
 return `<section class="bq-finale" data-scene="finale" aria-label="Quiz abgeschlossen">
  <header class="bq-finale-head"><h1>${heading}</h1><p>${subtitle}</p></header>
  <ol class="bq-finale-results">${visible.map((row,i)=>`<li class="bq-finale-place ${row.rank===1?'is-winner':''}" style="--place-index:${Math.min(12,i)}">
    <span class="bq-final-rank">#${row.rank}</span><strong>${e(row.name)}</strong>
    <span class="bq-final-points">${row.points.toLocaleString('de-DE')} Punkte</span>
    ${row.tied?'<small>Geteilter Platz</small>':''}</li>`).join('')||'<li>Noch keine Ergebnisse vorhanden.</li>'}</ol>
  ${host?`<div class="row bq-finale-controls">
   ${showNext?btn('Nächsten Platz zeigen','finale-next','primary',`data-step="${step+1}"`):''}
   ${rank?btn('Gesamtrangliste zeigen','finale-all',showNext?'small':'primary'):''}
   ${btn('Quizbrett erneut öffnen','resume-final','small')}${btn('Vollbild','fullscreen','small')}${btn('Endstand exportieren','export-final-results','small')}
  </div>`:''}</section>`;
}

const emojiPhases={
 roles:['Rollen wählen','Pro Team erklärt eine Person. Die übrigen Teammitglieder können raten.'],
 clues:['Emoji-Hinweise legen','Die Hinweisgeber verwenden die vorgegebenen Emojis für denselben Begriff.'],
 guess:['Jetzt raten','Jedes Team hat einen gemeinsamen Rateversuch.'],
 reveal:['Alle Team-Ergebnisse','']
};
function readyQuestionContent(host){
 const q=activeQuestion();
 return `<section class="glass panel bq-question-covered" aria-label="Verdeckte Frage">
  <p class="bq-eyebrow">RUNDE ${boardRoundOf(publicState)}</p><h2>${e(q.category)} · ${e(q.points)} Punkte</h2>
  <p>Die Frage ist ausgewählt. Der Host deckt sie für alle auf.</p>
  ${host?`<div class="row">${btn('Frage aufdecken','uncover-question','primary bq-big-control')}${btn('Zurück zur Übersicht','back','small')}</div>`:''}
 </section>`;
}
function readyQuestionScene(){
 return `<section class="bq-session-scene bq-question-scene" data-scene="ready">${readyQuestionContent(canHost())}${sessionFooter()}</section>`;
}
async function uncoverSelectedQuestion(){
 if(!canHost()||publicState?.phase!=='ready')return;
 const q=quiz.questions.find(question=>question.id===activeQuestion()?.id);
 if(!q)throw Error('Die Originalfrage fehlt.');
 if(!isOffline()){await game.uncoverQuestion(room,publicState.round,q.id);return;}
 let visual=q.type==='order'?(q.orderDisplayItems?.length?q.orderDisplayItems:shuffledItems(q.orderItems)):q.image||'';
 if(q.type==='splash')visual=await splashPreview(q.image,q,false);
 publicState={...publicState,phase:'question',current:{...publicQuestion(q,false,visual),points:publicState.current.points,basePoints:publicState.current.basePoints,doublePoints:publicState.current.doublePoints},deadline:q.seconds?now()+q.seconds*1000:0,buzzerArmed:true};
 if(rehearsal)startRehearsalQuestion(q);
 schedule();
}
const emojiStatus={correct:'Richtig',wrong:'Falsch','no-roles':'Kein Rollenpaar','no-clues':'Kein Hinweis','no-guess':'Keine Antwort'};

function emojiSelection(own){
 if(emojiDraft?.id!==own.id)emojiDraft={id:own.id,indices:[...(own.selected||[])]};
 return emojiDraft.indices;
}

function renderPlayerEmoji(round,own=playerEmoji?.id===round.id?playerEmoji:null,local=false){
 const disabled=!local&&!connected?'disabled':'';
 if(!own||own.players<2)return '<p>Für diese Teamrunde braucht dein Team mindestens zwei Spieler.</p>';
 if(round.phase==='roles')return `<div class="stack">
  <div class="row" role="group" aria-label="Deine Rolle">
   ${btn('Emojis legen','emoji-role',own.role==='clue'?'primary':'',`data-emoji-role="clue" aria-pressed="${own.role==='clue'}" ${own.clueTaken?'disabled':disabled}`)}
   ${btn('Raten','emoji-role',own.role==='guess'?'primary':'',`data-emoji-role="guess" aria-pressed="${own.role==='guess'}" ${disabled}`)}
  </div><p role="status">${own.ready?'Euer Rollenpaar ist bereit.':own.clueTaken?'Die Hinweisrolle ist belegt. Du kannst raten.':'Wählt mindestens je eine Person für beide Rollen.'}</p></div>`;
 if(!own.active||!own.role)return '<p>Du schaust in dieser Runde zu.</p>';
 if(round.phase==='clues'){
  if(own.role!=='clue')return '<p>Euer Hinweisgeber legt einen Hinweis. Die Emojis erscheinen in der Ratephase.</p>';
  const picks=emojiSelection(own);
  const saved=JSON.stringify(picks)===JSON.stringify(own.selected)&&picks.length;
  return `<p class="bq-emoji-target">Dein geheimer Begriff <strong>${e(own.target)}</strong></p>
   <div class="bq-emoji-selection" role="group" aria-label="Dein Hinweis in Reihenfolge">
    ${picks.map((index,i)=>btn(e(own.palette[index]),'emoji-remove','small',`data-emoji-index="${i}" aria-label="${e(emojiName(own.palette[index]))} an Position ${i+1} entfernen" ${disabled}`)).join('')||'<span>Wähle bis zu fünf Emojis.</span>'}
   </div>
   <div class="bq-emoji-palette" role="group" aria-label="Vorgegebene Emojis">
    ${own.palette.map((symbol,i)=>btn(e(symbol),'emoji-add','small',`data-emoji-index="${i}" aria-label="${e(emojiName(symbol))}" ${picks.length>=MAX_EMOJI_CLUES?'disabled':disabled}`)).join('')}
   </div>
   <div class="row">${btn('Hinweis speichern','emoji-clue','primary',saved||!picks.length?'disabled':disabled)}
    <span role="status">${saved?'Hinweis gespeichert.':picks.length?picks.length+' von '+MAX_EMOJI_CLUES+' gewählt':''}</span></div>`;
 }
 if(own.role!=='guess')return '<p>Dein Team rät jetzt anhand deines Hinweises.</p>';
 if(!own.clues?.length)return '<p>Für euer Team wurde kein Hinweis gespeichert.</p>';
 return `<p class="bq-emoji-hint" aria-label="Emoji-Hinweis">${e(own.clues.join(' '))}</p>
  ${own.answered?'<p role="status">Euer Team hat geantwortet. Die Ergebnisse erscheinen nach Ablauf der Zeit.</p>':
   `<form id="team-emoji-guess-form" class="stack">
     <label class="field">Euer Rateversuch<input id="team-emoji-guess" required maxlength="100" autocomplete="off" spellcheck="false" ${disabled}></label>
     <button type="submit" class="btn primary" ${disabled}>Antwort fürs Team abgeben</button>
    </form>`}`;
}

function renderTeamEmoji(readOnly=false){
 const round=publicState.teamEmoji;
 const host=!readOnly&&canHost();
 const [heading,message]=emojiPhases[round.phase];
 if(round.phase==='reveal')return `<section class="glass panel bq-team-emoji">
  ${renderAnswerView(activeQuestion())}
  <h3>${heading}</h3>
  <ul class="bq-emoji-results">
   ${round.results.map(result=>`<li><strong>${e(teamName(result.id))}</strong>
    ${result.clues.length?`<span class="bq-emoji-result-icons">${e(result.clues.join(' '))}</span>`:''}
    ${result.guess?`<span>${e(result.guess)}</span>`:''}
    <span class="${result.status==='correct'?'good':'muted'}">${emojiStatus[result.status]} · ${result.points?'+':''}${e(result.points)} Punkte</span></li>`).join('')}
  </ul>${host?btn('Zurück zum Quizbrett','emoji-close','primary'):''}
 </section>`;
 const progress=host?`<ul class="bq-emoji-progress" aria-label="Fortschritt pro Team">
  ${round.teams.map(team=>`<li><strong>${e(teamName(team.id))}</strong><span>${team.players<2?'Mindestens zwei Spieler nötig':
   round.phase==='roles'?(team.ready?'Rollen bereit':'Rollenwahl läuft'):
   !team.ready?'Kein Rollenpaar':round.phase==='clues'?(team.clued?'Hinweis gespeichert':'Hinweis ausstehend'):
   !team.clued?'Kein Hinweis':team.guessed?'Antwort abgegeben':'Antwort ausstehend'}</span></li>`).join('')}
 </ul><div class="row">
  ${round.phase==='roles'?btn('Emoji-Phase starten','emoji-start','primary',round.teams.some(team=>team.ready)?'':'disabled'):''}
  ${btn(round.phase==='roles'?'Zurück zum Quizbrett':'Runde abbrechen','emoji-close','small')}
 </div>`:'';
 return `<section class="glass panel bq-team-emoji"><div class="panelhead">
  <div><h3>${heading}</h3><p>${message}</p></div>
  ${!readOnly&&publicState.deadline?'<span class="pill" id="clock" role="timer" aria-label="Verbleibende Zeit">–:––</span>':''}
  </div>${host?progress:readOnly?'':renderPlayerEmoji(round)}</section>`;
}

function teamEmojiScene(){
 const q=activeQuestion();
 return `<section class="bq-session-scene bq-question-scene" data-scene="team-emoji-${publicState.teamEmoji.phase}">
  <div class="bq-scene-heading"><div><span class="bq-eyebrow">FRAGE ${e(publicState.round)}</span><h2>${e(q.category)} · ${e(q.points)} Punkte</h2></div></div>
  ${renderTeamEmoji()}${sessionFooter()}
 </section>`;
}

function renderHostLive(){
 if(publicState?.phase==='finished')return renderFinalResults(true);
 if(publicState?.phase==='ready')return readyQuestionScene();
 if(activeQuestion()?.type===TEAM_EMOJI&&publicState.teamEmoji)return teamEmojiScene();
 if(!hasLiveQuestion()){
  const roundTwoPending=boardRoundOf(publicState)===1&&Object.values(publicState?.board||{}).some(cell=>boardRoundOf(cell)===2);
  return boardScene(true)+(mayFinishGame(publicState)&&!roundTwoPending?`<div class="bq-finale-entry">${btn('Quiz beenden & Siegerehrung anzeigen','finish-game','primary')}</div>`:'');
 }
 if(reviewIsCurrent(publicState))return renderReviewView();
 const p=publicState,q=activeQuestion(),hasQuestion=!!q;
 const awaitingVerdict=!!winner()&&['question','paused'].includes(p.phase)&&roundMode(q)==='buzzer'&&!p.buzzerResolved?.[roundKey()];
 const canCancelQuestion=['question','paused'].includes(p.phase)&&!winner()&&!Object.keys(responses?.[roundKey()]||{}).length&&!p.buzzerJudgements?.[roundKey()]&&!p.buzzerResolved?.[roundKey()];
 return `<section class="bq-session-scene bq-question-scene" data-scene="question"><div class="bq-scene-heading"><div><span class="bq-eyebrow">FRAGE ${e(p.round)}</span><h2>${e(q.category)} · ${e(q.points)} Punkte</h2></div><span class="pill ${isOpen()?'good':''}">${p.phase==='paused'?'Pausiert':isOpen()?'Frage offen':'Auflösung'}</span></div>
 ${p.phase==='reveal'?'':hostBuzzerControl()}<section class="glass panel bq-question-panel"><div class="bq-scene-content">${renderStage()}</div></section>
 <div class="bq-action-bar bq-host-action-bar" aria-label="Host-Steuerung"><span class="bq-action-step">Spiel steuern</span>${roundMode(q)==='written'&&!isOffline()&&isOpen()&&answerProgress(p.answerParticipants,responses?.[roundKey()]).total?btn('Antwortübersicht öffnen','start-review','primary'):' ' }${p.phase==='reveal'?(p.solutionVisible===false?btn('Lösung erneut zeigen','solution-forward','primary'):btn('Schritt zurück · Frage ansehen','reveal-prev','small')):btn(awaitingVerdict?'Erst Buzzer bewerten':'Lösung zeigen','reveal',!isOffline()&&isOpen()&&answerProgress(p.answerParticipants,responses?.[roundKey()]).total?'small':'primary',hasQuestion&&!awaitingVerdict?'':'disabled title="Erst den offenen Buzzer bewerten"')}${btn(p.phase==='reveal'?'Weiter zum Quizbrett':'Frage als gespielt beenden','back',p.phase==='reveal'?'primary':'small',awaitingVerdict?'disabled title="Buzzerentscheidung ausstehend"':'')}${canCancelQuestion?btn('Ungespielt zurücklegen','cancel-question','small'):''}
 ${canHost()&&isOpen()&&(Number(q?.scene?.step||0)>0||Number(q?.hintStep||0)>0||Number(q?.visualStep||0)>0)?btn('Schritt zurück','reveal-prev','small'):''}${q?.scene&&isOpen()&&sceneHasStep(quiz.questions.find(x=>x.id===q.id),Number(q.scene?.step||0))?btn('Inhalt weiter aufdecken','scene-next','small'):''}${q?.type==='splash'&&isOpen()&&Number(q.visualStep||0)<2?btn('Bild weiter aufdecken','splash-next','small'):''}${isOpen()&&quiz.questions.find(x=>x.id===q?.id)?.hints?.slice(Number(q.hintStep||0)).some(Boolean)?btn('Tipp '+Math.min(4,Number(q.hintStep||0)+1)+' freigeben','hint-next','primary'):''}
 <details class="bq-auxiliary" data-bq-persist="hostmore"><summary>Mehr · Timer, Chat, Buzzer & Punkte</summary><div class="bq-host-detail"><section><h3>Timer und Buzzer</h3>${buzzerStatus()}<div class="row">${btn(p.settings?.buzzerEnabled?'Buzzer deaktivieren':'Buzzer aktivieren','toggle-buzz','small')}${btn(p.settings?.chatOpen?'Chat sperren':'Chat öffnen','toggle-chat','small')}</div><div class="row"><select id="time-choice" aria-label="Timerdauer">${[15,30,45,60,90,120,180].map(n=>`<option value="${n}">${n} Sekunden</option>`).join('')}</select>${btn('Timer starten','start-timer','small')}${btn('Timer beenden','stop-timer','small',p.deadline?'':'disabled')}</div></section><section><h3>Antworten</h3>${renderResponses()}${renderChat()}</section><section class="bq-host-info-wrap">${hostVisibilityCard()}${hostPrivateSolution()}</section>${scorePanel()}</div></details></div>
 ${sessionFooter()}</section>`;
}
function renderResponses(){const list=Object.values(responses?.[roundKey()]||{}).sort((a,b)=>(a.at||0)-(b.at||0));if(!list.length)return '<div class="empty">Noch keine eingegangenen Antworten.</div>';const source=canHost()?quiz.questions.find(q=>q.id===activeQuestion()?.id):null;const ranking=source?.type==='estimate'?rankEstimates(list,source.estimateTarget):[];return `${ranking.length?`<div class="hint"><b>Schätz-Ranking (nur Host):</b> Zielwert ${e(source.estimateTarget)} ${e(source.estimateUnit||'')} · ${ranking.map((r,i)=>`${i+1}. ${e(roster?.[r.uid]?.name||'Spieler')} (${e(r.value)}, Δ${e(Number(r.difference.toFixed(3)))})`).join(' · ')}<br><span class="small">Die Punkte werden bewusst weiterhin vom Host vergeben, damit Gleichstände und Sonderregeln manuell geprüft werden können.</span></div>`:''}<div class="roster">${list.map(r=>`<div class="person"><div><b>${e(roster?.[r.uid]?.name||r.uid.slice(0,7))}</b><small>${e(teamName(r.team))} · ${r.at?new Date(r.at).toLocaleTimeString('de-DE'):''}</small><p style="margin:4px 0 0">${e(r.text)}</p></div><div class="row">${btn('Entfernen','erase-answer','small danger',`data-uid="${e(r.uid)}"`)}</div></div>`).join('')}</div>`;}
function renderGuestLive(){
 if(publicState?.phase==='finished')return renderFinalResults(false);
 if(publicState?.phase==='ready')return readyQuestionScene();
 if(activeQuestion()?.type===TEAM_EMOJI&&publicState.teamEmoji)return teamEmojiScene();
 if(!hasLiveQuestion())return boardScene(false);
 if(reviewIsCurrent(publicState))return renderReviewView();
 const q=activeQuestion(),open=isOpen(),b=winner(),written=roundMode(q)==='written',timeUp=!!publicState.deadline&&publicState.deadline<now(),lockedOut=isBuzzLocked(game?.uid);
 const allowedBuzz=connected&&canBuzz(publicState,buzzers,game?.uid,member?.team,now());
 const waitingForBuzz=publicState.buzzerArmed===false||publicState.settings?.buzzerEnabled===false;
 const canWrite=guestCanAnswer()&&!myResponse;
 const participantHasMap=q.type==='map'&&open&&(written?!!publicState.answerParticipants?.[game?.uid]:b?.uid===game?.uid);
 const mapSubmitAllowed=connected&&q.type==='map'&&canMapPick()&&!!mapPick;
 const writtenUI=`<div class="bq-guest-mode"><h3>✍️ Alle antworten</h3><p>Jede Person gibt eine eigene Antwort ab. Der Host öffnet anschließend die Übersicht mit verdeckten Antworten.</p></div><form id="answer-form" class="formgrid">${q.type==='map'?`<div class="bq-map-hint">📍 Tippe auf die Weltkarte, um einen Pin zu setzen.</div><p class="bq-map-result">${mapPick?`Ausgewählt: ${mapPick.x} % Ost / ${mapPick.y} % Süd`:'Noch kein Kartenpunkt gewählt'}</p>`:q.type==='estimate'?`<label class="field span2">Schätzung (${e(q.estimateUnit||'Zahl')})<input id="answer-number" type="number" step="any" inputmode="decimal" ${canWrite?'':'disabled'}></label>`:`<label class="field span2">Deine geheime Antwort<textarea id="answer-text" rows="3" maxlength="800" placeholder="Antwort eingeben" ${canWrite?'':'disabled'}>${e(myResponse?.text||'')}</textarea></label>`}${btn(q.type==='map'?(myResponse?'Pin aktualisieren':'Pin verbindlich senden'):(myResponse?'Antwort abgegeben':'Antwort verbindlich senden'),'submit-answer','primary bq-big-control',(q.type==='map'?mapSubmitAllowed:connected&&canWrite)?'':'disabled')}</form><p class="small ${myResponse?'good':'muted'}">${myResponse?(q.type==='map'?'Pin gespeichert. Du kannst ihn bis zum Rundenende ändern und erneut senden.':'Antwort gespeichert. Andere sehen sie erst nach Host-Aufdeckung.'):'Die Antwort bleibt bis zur Aufdeckung verborgen.'}</p>`;
 const resolved=publicState?.buzzerResolved?.[roundKey()],lastJudgement=publicState?.buzzerJudgements?.[roundKey()];
 const resultNotice=resolved&&publicState.phase==='reveal'
   ?`<div class="bq-quiz-verdict is-right" role="status"><strong>✓ Richtig beantwortet!</strong><span>${e(roster?.[resolved.uid]?.name||winner()?.name||'Teilnehmer')} · ${e(teamName(resolved.team))} · +${e(q.points)} Punkte</span><small>${publicState.solutionVisible===false?'Der Host zeigt noch einmal die Frage. Die Wertung bleibt bestehen.':'Die richtige Lösung ist jetzt für alle sichtbar. Der Host öffnet das nächste Feld.'}</small></div>`
   :lastJudgement?.result==='wrong'&&!b&&open
   ?`<div class="bq-quiz-verdict is-wrong" role="status"><strong>✕ Leider falsch · ${e(lastJudgement.delta)} Punkte</strong><span>Andere Spieler können jetzt buzzern. Die Lösung bleibt verborgen.</span></div>`
   :'';
 const buzzUI=`${resultNotice}<div class="bq-buzzer-quickstatus" role="status">${b?e(b.name)+' antwortet gerade':waitingForBuzz?'Warte auf Freigabe durch den Host':lockedOut?'Buzzer für diese Runde gesperrt':'Wer zuerst buzzert, darf antworten'}</div><div class="bq-guest-mode"><h3>🎙️ Buzzerfrage</h3><p>${resolved&&publicState.phase==='reveal'?'Diese Runde ist beendet.':b?`<b>${e(b.name)} (${e(teamName(b.team))})</b> darf jetzt antworten.`:'Sobald du bereit bist, auf den Buzzer drücken. Das erste gültige Signal gewinnt – unabhängig davon, wer die Frage ausgewählt hat.'}</p><p class="small muted">Die Antwort wird außerhalb von BrainQuiz gegeben. Der Host bewertet direkt im Quiz.</p></div><button type="button" class="btn primary bq-big-buzzer" data-action="buzz" ${allowedBuzz?'':'disabled'}>${resolved?'Richtig beantwortet · Runde beendet':!open?'Runde beendet':lockedOut?'Für diese Runde gesperrt':b?'Buzzer belegt':waitingForBuzz?'Warte auf Buzzer-Freigabe':timeUp?'Zeit abgelaufen':'◉ JETZT BUZZERN (B)'}</button>${lockedOut?'<p class="small bad">Du bzw. dein Team seid nach einer falschen Antwort bis zur Host-Freigabe gesperrt.</p>':''}${participantHasMap?`<div class="bq-map-hint">📍 Tippe auf die Weltkarte und bestätige deinen Pin.</div><p class="bq-map-result">${mapPick?`Ausgewählt: ${mapPick.x} % / ${mapPick.y} %`:'Noch kein Ort gewählt'}</p>${!written?btn('Kartenpunkt senden','submit-map','primary bq-big-control',mapPick?'':'disabled'):''}`:''}${myResponse&&q.type==='map'?'<p class="small good">Kartenpunkt beim Host eingegangen. Bis zum Rundenende kannst du ihn aktualisieren.</p>':''}`;
 return `<section class="bq-session-scene bq-question-scene" data-scene="question"><div class="bq-scene-heading"><div><span class="bq-eyebrow">FRAGE ${e(publicState.round)}</span><h2>${e(q.category)} · ${e(q.points)} Punkte</h2></div><span class="pill ${open?'good':''}">${open?'Offen':publicState.phase==='paused'?'Pausiert':'Warten'}</span></div><div class="bq-question-body"><section class="glass panel bq-question-panel"><div class="bq-scene-content">${renderStage()}</div></section>${publicState.phase==='reveal'?`<div class="bq-guest-reveal-status">${resultNotice}</div>`:`<section class="glass panel bq-guest-compose ${written?'bq-guest-written':'bq-guest-buzzer'}"><div class="panelhead"><h3>${written?'Schriftliche Runde':'Dein Buzzer'}</h3>${publicState.deadline?'<span class="pill" id="clock">–:––</span>':''}</div>${written?writtenUI:buzzUI}<details class="bq-auxiliary" data-bq-persist="teamchat"><summary>Privater Teamchat</summary>${renderChat()}</details></section>`}</div>${sessionFooter()}</section>`;
}
function renderTeams(){
 if(!publicState)return '<div class="empty">Lade Lobby …</div>';
 const lobby=lobbySnapshot({public:publicState,roster,members,presence});
 const waiting=Object.entries(members||{}).filter(([,p])=>p?.status==='pending');
 const accepted=Object.entries(roster||{}).filter(([,p])=>p?.name&&p?.team);
 const occupied=approvedCount(roster),slots=freeSlots(roster);
 const pregame=canArrangeLobby(publicState),canAdmit=slots>0&&pregame;
 const inviteUrl=location.origin+location.pathname+'?room='+room;
 const pendingHTML=waiting.map(([id,p])=>{
  const request=p.teamRequest||null;
  const manual=pendingTeamChoices.get(id);
  const choice=manual!==undefined?manual:request?.kind==='join'?request.id:request?.kind==='create'?'':'t1';
  const requestText=request?.kind==='create'?'Neues Team: '+request.name:request?.kind==='join'?'Gewünscht: '+(publicState.teams?.[request.id]||'unbekannt'):'Noch kein Team gewählt';
  const options=(request?.kind==='create'?[['','Team „'+request.name+'“ erstellen']]:[]).concat(Object.entries(publicState.teams||{}));
  return `<article class="bq-host-join-request person" data-pending-id="${e(id)}"><div class="bq-lobby-request"><b>${e(p.name)}</b><small>${e(requestText)}</small><span class="bq-lobby-request-ready ${p.ready?'ready':''}">${p.ready?'✓ Bereit':'Noch nicht bereit'}</span></div>
   <div class="bq-host-join-actions"><label class="bq-host-team-choice"><span>Team zuordnen</span><select class="input" id="team-${e(id)}" aria-label="Team für ${e(p.name)} wählen">${options.map(([tid,name])=>`<option value="${e(tid)}" ${choice===tid?'selected':''}>${e(name)}</option>`).join('')}</select></label>
   ${btn(!slots?'Raum voll':canAdmit?'Annehmen':'Spiel läuft','approve','primary small',`data-uid="${e(id)}" ${canAdmit?'':'disabled title="Aufnahme nur vor Spielbeginn möglich"'}`)}
   ${btn('Ablehnen','kick','small danger',`data-uid="${e(id)}"`)}</div></article>`;
 }).join('');
 return `<div class="bq-host-lobby-page" data-phase="${pregame?'waiting':'playing'}">
  <section class="glass panel bq-host-code-banner" aria-label="Lobby-Code und Einladung">
   <div class="bq-host-code-top"><div><span class="bq-host-step">SCHRITT 2 · ${pregame?'LOBBY':'SPIELRAUM'}</span><h2>${pregame?'Deine Lobby ist bereit':'Dein Quiz läuft'}</h2><p>${e(lobby.title)} · ${pregame?'Gib deinen Mitspielern diesen Code.':'Der Raum bleibt für zugelassene Mitspieler verbunden.'}</p></div><span class="bq-host-connection ${connected?'is-online':''}" role="status"><i class="dot ${connected?'live':''}"></i>${connected?'Verbunden':'Verbindung prüfen'}</span></div>
   <div class="bq-host-code-line"><div class="bq-host-code-value"><span>LOBBY-CODE</span><strong id="bq-lobby-code" class="mono" aria-label="Lobby-Code ${e(room)}">${e(room)}</strong></div>
    <div class="bq-host-code-actions">${btn('Code kopieren','copy-room','primary')}${btn('Einladungslink kopieren','copy-invite-link','')}</div></div>
   <p class="bq-host-code-guide">Mitspieler öffnen <strong>${e(location.host+location.pathname)}</strong> und geben den Code mit ihrem Namen ein – oder verwenden den Einladungslink.</p>
  </section>
  <div class="bq-host-lobby-overview">
   <section class="glass panel bq-host-requests" id="bq-host-requests" aria-labelledby="bq-pending-title">
    <div class="panelhead"><div><h2 id="bq-pending-title">Beitrittsanfragen</h2><p class="small muted">Neue Spieler erscheinen hier, sobald sie den Code eingeben.</p></div>
    <span class="bq-request-count ${waiting.length?'has-pending':''}" role="status" aria-live="polite">${waiting.length?waiting.length+' offen':'Keine offen'}</span></div>
    <div class="bq-host-request-list">${waiting.length?pendingHTML:'<div class="bq-host-empty-pending"><span aria-hidden="true">✓</span><div><strong>Alles erledigt</strong><p>Keine offenen Beitrittsanfragen. Du musst gerade niemanden annehmen.</p></div></div>'}</div>
   </section>
   <section class="glass panel bq-host-participants" aria-labelledby="bq-players-title">
    <div class="panelhead"><div><h2 id="bq-players-title">Teilnehmer</h2><p class="small muted">Zugelassene Mitspieler und Bereitschaft</p></div><span class="bq-approved-count" role="status">${occupied} / ${MAX_PLAYERS}</span></div>
    <div class="bq-host-approved-list">${accepted.length?accepted.map(([id,p])=>`<div class="bq-host-approved-person person"><div class="bq-host-member-identity"><span class="dot ${presence?.[id]?'live':''}"></span><div><strong>${e(p.name)}</strong><small><span class="bq-team-swatch" style="--bq-team-color:${teamColor(p.team)}" aria-hidden="true"></span>${e(teamName(p.team))}</small></div></div><div class="bq-host-member-state"><span class="${members[id]?.ready?'is-ready':''}">${members[id]?.ready?'✓ Bereit':'Noch nicht bereit'}</span>${btn('Entfernen','kick','small danger',`data-uid="${e(id)}"`)}</div></div>`).join(''):'<div class="bq-host-empty-players">Noch niemand beigetreten. Teile den Code oben, damit Spieler hier erscheinen.</div>'}</div>
   </section>
  </div>
  <section class="bq-host-lobby-next" aria-label="Spielstart">
   <div><strong>${pregame?'Bereit für die erste Frage?':'Spiel gestartet'}</strong><p>${pregame?occupied===0?'Warte auf mindestens einen zugelassenen Teilnehmer, bevor du das Spiel startest.':waiting.length?'Es sind noch Anfragen offen. Du kannst sie zuerst bearbeiten.':lobby.ready+' von '+occupied+' Teilnehmern haben sich bereit gemeldet.': 'Öffne auf dem Quizbrett die nächste Frage.'}</p></div>
   ${pregame?!isPublished()?btn('Quiz fertigstellen','view','primary bq-host-start','data-view="editor"'):btn('Spiel starten','start-game','primary bq-host-start',occupied>0?'':'disabled title="Zuerst mindestens einen Teilnehmer zulassen"'):btn('Zum Quizbrett','view','primary bq-host-start','data-view="live"')}
  </section>
  <section class="bq-host-lobby-team-section" aria-label="Teamübersicht">${hostLobbySummary(lobby)}</section>
  <details class="bq-host-lobby-extra" data-bq-persist="lobbyextra"><summary>Weitere Funktionen und Informationen</summary><div class="glass panel"><p class="small muted">Team-Punktestand, Verbindungsdetails und Raumeinstellungen sind während des Spiels weiterhin über die Navigation verfügbar.</p>${btn('Einstellungen öffnen','view','small','data-view="setup"')}${pregame?'':btn('Quizbrett öffnen','view','small','data-view="live"')}</div></details>
  </div>`;
}
function renderSetup(){
 const diagnostics=game?.diagnostics?.()||null;
 const peers=diagnostics?.peers||[];
 const formatTime=value=>new Date(value).toLocaleTimeString('de-DE');
 const connectionDetails=`<div class="bq-connection-audit">
  <h4>Teilnehmer und Spielstand</h4>
  <p>${peers.filter(client=>client.connected).length} von ${peers.length} verbunden</p>
  ${peers.map(client=>`<div class="bq-peer-row"><strong>${e(client.name)}</strong>
    <span>${!client.connected?'Unterbrochen':client.synced?'Synchronisiert':'Verbindung aktiv · Spielstand wird übertragen'}</span>
    <small>${client.lastAck?'Spielstand bestätigt um '+formatTime(client.lastAck):'Spielstand noch nicht bestätigt'}</small>
    <small>${client.bufferedBytes?'Übertragungspuffer '+client.bufferedBytes+' Byte':''}</small></div>`).join('')||'<p class="small muted">Noch keine Teilnehmer.</p>'}
  ${diagnostics?.lastBackupAt?`<p class="small muted">Spielstand gesichert um ${formatTime(diagnostics.lastBackupAt)}</p>`:''}
  ${diagnostics?.backupError?`<p role="alert">${e(diagnostics.backupError)}</p>`:''}
  ${diagnostics?.error?`<p role="status">${e(diagnostics.error)}</p>`:''}
  <p class="small muted">Phase: ${e(diagnostics?.phase||'–')} · ICE: ${e(diagnostics?.iceState||'–')} · TURN: ${diagnostics?.turnConfigured?'Konfiguriert':'Nicht konfiguriert'} · Wiederholungen: ${Number(diagnostics?.reconnectAttempts)||0}</p>
  <p class="small muted">${e(diagnostics?.guidance||'')}</p>
  <div class="row">${btn('Fehlerbericht kopieren','copy-connection-report','small')}${btn('Host-Verbindung neu starten','restart-host-transport','small')}</div>
  <details class="bq-auxiliary" data-bq-persist="turnsetup-host"><summary>TURN-Relay für neue Verbindungen einrichten</summary>${turnRelaySetup()}<p class="small muted">Nach einer Änderung „Host-Verbindung neu starten“ wählen, damit sie auf dem Host wirksam wird. Die Gäste müssen ebenfalls die Zugangsdaten einrichten.</p></details>
 </div>`;
 const manual=publicState?.settings?.manualBuzzer===true;
 const buzzSettings=canHost()&&!isOffline()?`<section class="glass panel"><div class="panelhead"><h3>Buzzer-Freigabe</h3></div>
  <p>${manual?'Du gibst den Buzzer bei jeder neuen Buzzerfrage frei.':'Der Buzzer ist mit Beginn der Frage freigegeben.'}</p>
  ${btn(manual?'Automatische Freigabe aktivieren':'Buzzer pro Frage manuell freigeben','toggle-manual-buzz','small')}</section>`:'';
 return `<div class="grid"><section class="glass panel"><div class="panelhead"><h3>Spielraum & Einladung</h3><span class="pill good">GITHUB LIVE</span></div><label class="field">Raumcode<input readonly value="${e(room)}" class="mono" style="font-size:20px;letter-spacing:.14em"></label><div class="row" style="margin-top:12px">${btn('Einladungslink kopieren','invite','primary')}${btn('Raum-Link kopieren','copy-room','')}${btn('Lokalen Beamer öffnen','open-projector','small')}${btn('Zuschauerlink kopieren','copy-projector','small')}</div><div class="divider"></div><div class="hint">Die Website läuft unabhängig von deinem PC. Während der laufenden Runde muss der Host-Browser verbunden sein; nur die Gäste brauchen keine Installation.</div></section><div class="stack">${canHost()?`<section class="glass panel"><div class="panelhead"><h3>Private Host-Dateien</h3><span class="pill warn">NICHT VERSCHICKEN</span></div><p>Host-Quizdateien enthalten die Lösungen und Originalbilder. Nur der Host sollte sie erhalten.</p><div class="row">${btn('Host-Quiz exportieren','export','primary')}${btn('Quiz importieren','import','')}</div><input type="file" id="import-quiz" accept=".json,.brainquiz" hidden><div class="divider"></div>${btn('Spielstand zurücksetzen','reset-questions','danger small')} ${btn(roomCloseLabel(),'leave-host-room','danger small')}</section>`:''}<section class="glass panel"><div class="panelhead"><h3>Verbindungsdetails</h3></div><div class="hint"><b>PeerJS / WebRTC</b><br>Verbindung: ${connected?'Aktiv':'Unterbrochen'}<br>Angemeldet: ${e(game?.uid?.slice(0,14)||'–')}…<br>Der Host-Browser hält den Spielstand. Vor dem Schließen ein Quiz-Backup exportieren.</div>${connectionDetails}</section>${buzzSettings}</div></div>`;}
function currentQuestion(){return quiz.questions.find(q=>q.id===selected)||quiz.questions[0]||null;}
function renderEditor(){return studio.render()+(isOffline()?`<div class="bq-editor-probe-bar">${btn('Generalprobe · Fragen und Lösungen durchlaufen','editor-probe','small primary')}</div>`:'');}
const REHEARSAL_PLAYERS={
 probe_1:{name:'Probespieler 1',team:'t1'},probe_2:{name:'Probespieler 2',team:'t2'}
};
function beginRehearsal(){
 studio.flush?.();
 if(!quiz.questions.length)throw Error('Lege zuerst eine Frage an.');
 if(rehearsal)endRehearsal();
 rehearsal={rounds:new Map(),compact:false,media:null,checking:false,previous:{publicState,questionHistory,buzzers,responses,roster,selected}};
 publicState={title:quiz.title,scoreMode:quiz.scoreMode||'team',phase:'board',round:0,boardRound:1,boardSequence:true,
  board:buildPublicBoard(quiz),teams:{t1:'Probeteam 1',t2:'Probeteam 2'},scores:{t1:0,t2:0},
  used:{},playerScores:{},settings:{buzzerEnabled:true,chatOpen:false},manualPlayers:{}};
 roster=structuredClone(REHEARSAL_PLAYERS);publicState.selectionTurn=makeSelectionTurn(publicState,roster);buzzers={};responses={};questionHistory={};
 view='present';boardPage=0;previewRevealed=false;schedule();
}
function endRehearsal(){
 if(!rehearsal)return;
 const previous=rehearsal.previous;
 publicState=previous.publicState;questionHistory=previous.questionHistory;buzzers=previous.buzzers;
 responses=previous.responses;roster=previous.roster;selected=previous.selected;
 rehearsal=null;
}
function startRehearsalQuestion(q){
 if(q.type===TEAM_EMOJI){
  rehearsal.emoji=newTeamEmojiRound(q,publicState,{probe_1:{team:'t1'},probe_2:{team:'t1'}},'probe-'+publicState.round);
  rehearsal.emojiActing='probe_1';emojiDraft=null;
  publicState.teamEmoji=publicTeamEmoji(rehearsal.emoji);
 }else rehearsal.rounds.set(q.id,{state:publicState,buzzers:{},answers:{}});
}
function rehearsalRound(q){
 let demo=rehearsal.rounds.get(q.id);
 if(!demo){
  demo={state:publicState,buzzers:{},answers:{}};
  rehearsal.rounds.set(q.id,demo);
 }
 if(publicState.current?.id===q.id)demo.state=publicState;
 return demo;
}
function rehearsalTotals(){
 return Object.entries(REHEARSAL_PLAYERS).map(([id,player])=>({
  name:scoreMode(publicState)==='individual'?player.name:publicState.teams[player.team],
  points:scoreMode(publicState)==='individual'?publicState.playerScores[id]?.total||0:publicState.scores[player.team]||0
 }));
}
function renderRehearsalControls(q){
 const demo=rehearsalRound(q),p=demo.state;
 const buzzer=roundMode(q)==='buzzer',winner=p.phase==='question'?demo.buzzers[p.round]:null;
 const players=Object.entries(REHEARSAL_PLAYERS);
 const points=rehearsalTotals().map(row=>`<li>${e(row.name)} <strong>${row.points.toLocaleString('de-DE')}</strong></li>`).join('');
 const submissions=players.map(([id,player])=>{
  const attrs=`data-player="${id}"`;
  if(buzzer)return btn(player.name+' buzzert','probe-buzz','small',canBuzz(p,demo.buzzers,id,player.team)?attrs:'disabled');
  if(p.phase==='question')return btn(player.name+(demo.answers[id]?' · abgegeben':' antwortet'),'probe-answer','small',demo.answers[id]?'disabled':attrs);
  const entry=p.answerReview?.entries?.[id];
  if(!entry?.submitted)return `<p>${e(player.name)} · keine Abgabe</p>`;
  if(!entry.revealed)return btn(player.name+' aufdecken','probe-uncover','small',attrs);
  const verdict=p.playerScores[id]?.rounds?.[p.round]?.result;
  return `<div class="bq-probe-submission"><strong>${e(player.name)}</strong><span>${e(entry.value)}</span>
   ${btn('Richtig','probe-correct',verdict==='correct'?'small primary':'small',attrs)}
   ${btn('Falsch','probe-wrong',verdict==='wrong'?'small danger':'small',attrs)}</div>`;
 }).join('');
 const audit=quizAudit(quiz);
 return `<section class="glass panel bq-rehearsal" aria-label="Generalprobe">
  <div class="panelhead"><h3>Probespieler</h3>${btn('Generalprobe neu starten','probe-reset','small')}</div>
  ${audit.errors.length?`<p class="small bad">Quizcheck · ${audit.errors.length} offene Punkte im Editor</p>`:''}
  <div class="row" aria-label="Simulierte Spieleraktionen">${submissions}</div>
  ${winner?`<div class="row"><strong>${e(winner.name)} am Buzzer</strong>
   ${btn('Richtig · +'+e(q.points),'probe-correct','primary')}
   ${btn('Falsch · −'+e(q.points/2),'probe-wrong','danger')}</div>`:''}
  ${!buzzer&&p.phase==='question'?btn('Antwortübersicht öffnen','probe-review','small',Object.keys(demo.answers).length?'':'disabled'):''}
  <ul class="bq-probe-scores" aria-label="Punktestand der Generalprobe">${points}</ul>
 </section>`;
}
function renderEmojiRehearsal(q){
 const demo=rehearsal.emoji,round=publicState.teamEmoji;
 const acting=rehearsal.emojiActing;
 playerEmoji=teamEmojiForPlayer(demo,'t1',acting);
 const header=`<section class="glass panel bq-rehearsal">
  <h3>Emoji-Teamrunde proben</h3><div class="row" aria-label="Simulierter Teilnehmer">
   ${Object.entries(REHEARSAL_PLAYERS).map(([id,person])=>btn(person.name,'probe-emoji-player','small',`data-player="${id}" aria-pressed="${acting===id}"`)).join('')}
  </div></section>`;
 const controls=round.phase==='reveal'?renderTeamEmoji(true):`<section class="glass panel bq-team-emoji">
  <h3>${emojiPhases[round.phase][0]}</h3>${renderPlayerEmoji(round,playerEmoji,true)}
  ${round.phase==='roles'?btn('Emoji-Phase starten','emoji-start','primary',round.teams.some(team=>team.ready)?'':'disabled'):
   btn('Zeitablauf simulieren','probe-emoji-time','small')}
 </section>`;
 return header+controls+`<div class="row">${btn('Zurück zur Übersicht','back','primary')}</div>`+sessionFooter();
}
async function rehearse(action,button){
 if(!isOffline()||!rehearsal||view!=='present')return;
 const q=quiz.questions.find(question=>question.id===activeQuestion()?.id);
 if(action==='probe-width'){rehearsal.compact=!rehearsal.compact;schedule();return;}
 if(action==='probe-media'){
  const session=rehearsal;if(session.checking)return;
  session.checking=true;schedule();
  try{session.media=await checkQuizMedia(quiz);}
  finally{session.checking=false;schedule();}
  return;
 }
 if(action==='probe-reset'){
  if(q&&confirm('Generalprobe neu starten? Die Probepunkte werden zurückgesetzt.'))beginRehearsal();
  return;
 }
 if(!q)return;
 const demo=rehearsalRound(q),p=demo.state;
 const id=button.dataset.player,player=REHEARSAL_PLAYERS[id];
 const isBuzzer=roundMode(q)==='buzzer';
 if(action==='probe-buzz'&&player&&canBuzz(p,demo.buzzers,id,player.team)){
  demo.buzzers[p.round]={uid:id,team:player.team,name:player.name,at:Date.now()};
 }else if(action==='probe-answer'&&!isBuzzer&&p.phase==='question'&&player){
  const second=id==='probe_2';
  const text=q.type==='map'?encodePoint({x:second?64:50,y:44}):q.type==='estimate'?(second?'42':'100'):
   q.type==='multiple'?(second?'B':'A'):q.type==='order'?'A → B → C':second?'Zweite Testantwort':'Erste Testantwort';
  demo.answers[id]={text};
 }else if(action==='probe-review'&&!isBuzzer&&p.phase==='question'){
  p.phase='review';p.answerReview=makeAnswerReview(REHEARSAL_PLAYERS,demo.answers,p.round);
 }else if(action==='probe-uncover'&&p.answerReview&&player){
  p.answerReview=revealAnswer(p.answerReview,id,demo.answers[id]);
 }else if(action==='probe-correct'||action==='probe-wrong'){
  const result=action==='probe-correct'?'correct':'wrong';
  if(isBuzzer){
   const winner=demo.buzzers[p.round];
   if(!winner||p.phase!=='question')return;
   const judged=applyBuzzerJudgement(p,demo.buzzers,{round:p.round,uid:winner.uid,result});
   demo.state=judged.state;demo.buzzers=judged.buzzers;
   if(result==='correct')Object.assign(demo.state,buildRevealPatch(q));
  }else if(player&&p.answerReview?.entries?.[id]?.revealed){
   const before=p.playerScores[id]?.rounds?.[p.round]?.delta||0;
   p.playerScores[id]=updatePlayerScore(p.playerScores[id],{kind:'judgement',round:p.round,questionId:q.id,points:p.current.points,result,at:Date.now()});
   if(scoreMode(p)==='team')p.scores[player.team]+=p.playerScores[id].rounds[p.round].delta-before;
  }
 }
 publicState=demo.state;
 schedule();
}

function renderPresenter(){
 if(!isOffline())return renderHostLive();
 if(!rehearsal)return renderHostLive();
 const q=quiz.questions.find(question=>question.id===activeQuestion()?.id);
 const toolbar=`<section class="glass panel bq-rehearsal bq-rehearsal-toolbar"><h2>Generalprobe</h2>
  <div class="row">${btn('Zurück zum Editor','view','small','data-view="editor"')}
   ${btn(rehearsal.compact?'Normale Breite':'Handybreite testen','probe-width','small')}
   ${btn('Alle Medien prüfen','probe-media','small',rehearsal.checking?'disabled':'')}
  </div>${rehearsal.media?`<p role="status">${rehearsal.media.checked} eingebettete Medien geprüft · ${rehearsal.media.failures.length} Probleme</p>`:''}
 </section>`;
 let content;
 if(publicState.phase==='board')content=boardScene(true);
 else if(publicState.phase==='ready')content=readyQuestionScene();
 else if(q?.type===TEAM_EMOJI)content=renderEmojiRehearsal(q);
 else content=`<section class="bq-session-scene bq-question-scene" data-scene="rehearsal">
  ${q?renderRehearsalControls(q):''}
  <section class="glass panel bq-question-panel presenter-stage">${renderStage()}</section>
  <div class="row bq-action-bar">${publicState.phase!=='reveal'?btn('Lösung zeigen','reveal','primary'):(publicState.solutionVisible===false?btn('Lösung erneut zeigen','solution-forward','primary'):btn('Schritt zurück · Frage ansehen','reveal-prev','small'))}
   ${btn('Zurück zur Übersicht','back','primary')}
   ${isOpen()&&(Number(activeQuestion().scene?.step||0)>0||Number(activeQuestion().hintStep||0)>0)?btn('Schritt zurück','reveal-prev','small'):''}
   ${q?.scene&&isOpen()&&sceneHasStep(q,Number(activeQuestion().scene?.step||0))?btn('Inhalt weiter aufdecken','scene-next','small'):''}
  </div>${sessionFooter()}</section>`;
 return toolbar+`<div class="${rehearsal.compact?'bq-probe-compact':''}">${content}</div>`;
}
async function publish(){if(!canHost()||isOffline())throw Error('Zum Live-Veröffentlichen bitte zuerst einen Online-Raum erstellen.');if(isPublished())throw Error('Dieses Quiz ist bereits veröffentlicht. Neue Fragen können erst in einem neuen Quiz erstellt werden.');quiz.questions.forEach(q=>{if(q.scene)reconcileQuestion(q)});const audit=quizAudit(quiz);if(!audit.ready){view='editor';studio.focusIssue?.(audit.errors[0]?.id);schedule();throw Error(`Quizcheck: ${audit.errors.length} Fehler. ${audit.errors.slice(0,3).map(x=>x.label+': '+x.reason).join(' | ')}. Öffne „Quizcheck“ im Editor.`);}if(audit.warnings.length&&!confirm(`${audit.warnings.length} Hinweise im Quizcheck. Trotzdem veröffentlichen?`))return;
 if(Object.keys(roster).length&&!confirm('Das Live-Quizbrett wird neu veröffentlicht: aktuelle Frage, Punkte und bisherige gespielte Kacheln werden zurückgesetzt. Fortfahren?'))return;
 clearTimeout(cloudTimer);cloudTimer=null;await serializedCloudWrite(room,normalizedQuiz(quiz));cloudDirty=false;saveState='Im Host-Browser gesichert';
 const teams={...(publicState?.teams||{}),...buildTeams(quiz)};const teamScores=Object.fromEntries(Object.keys(teams).map(id=>[id,0]));
 const p={title:quiz.title,published:true,scoreMode:quiz.scoreMode||'team',phase:'board',current:null,round:0,boardRound:1,boardSequence:true,deadline:0,pausedRemaining:0,teams,scores:teamScores,manualPlayers:manualPlayerLabels(quiz),playerScores:{_empty:true},writtenTeamRepresentatives:{},board:buildPublicBoard(quiz),used:{_empty:true},answerReview:null,answerParticipants:null,buzzerBlocked:{_empty:true},settings:publicState?.settings||{buzzerEnabled:true,chatOpen:true,lockOnBuzz:false,timerSeconds:60}};
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
 if(!canHost()||!publicState||publicState.phase!=='board')throw Error('Kehre zuerst zur Fragenübersicht zurück.');
 const q=quiz.questions.find(x=>x.id===id);
 if(!q||!validQuestionPair(publicState,q))throw Error('Dieses Fragenfeld ist nicht mehr verfügbar oder gehört nicht zum aktuellen Quizbrett.');
 const invalid=validateQuestion(q,quiz.scoreMode);if(invalid)throw Error('Diese Frage ist noch unvollständig: '+invalid);
 if(q.type===TEAM_EMOJI&&isOffline()&&!rehearsal)throw Error('Öffne die Generalprobe für diesen Fragetyp.');
 const expectedRound=Number(publicState.round)||0;
 openingQuestion=true;
 try{
  let visual='';if(q.type==='splash')visual=await splashPreview(q.image,q,false);
  if(q.type==='order')visual=q.scene?.template==='order'?(q.orderDisplayItems||[]):shuffledItems(q.orderItems);
  const playerQuestion=publicQuestion(q,false,visual,0);if(q.type==='splash')playerQuestion.visualStep=0;
  const participants=isOffline()||q.roundMode!=='written'?null:participantSnapshot(roster);
  const deadline=!isOffline()&&q.seconds>0?now()+q.seconds*1000:0;
  if(isOffline()){
   const next=openQuestionState(publicState,{expectedRound,question:q,playerQuestion,participants,deadline,covered:true});
   if(!next)throw Error('Das Fragenfeld wurde inzwischen geöffnet.');
   publicState=next;selected=q.id;questionHistory[String(next.round)]=createHistoryEntry({...q,points:next.current.points},next.round,now());if(!rehearsal)saveOfflineSession();schedule();return;
  }
  const next=await game.openQuestion(room,expectedRound,q,playerQuestion,participants,deadline,{covered:true});
  // The round is published atomically. Noncritical side effects are deliberately
  // scoped to the committed round and cannot replace another current question.
  await game.clearPicks(room).catch(error);
  await game.recordQuestion(room,next.round,createHistoryEntry({...q,points:next.current.points},next.round,now())).catch(error);
 }finally{openingQuestion=false;}
}
function buildRevealPatch(q){
 const v=q.type==='order'?publicState.current.displayItems:q.image||'';
 const sceneStep=q.type==='imposter'?Number(publicState.current.scene?.step||0):6;
 const preRevealDisplay={
  sceneStep:Number(publicState.current.scene?.step||0),
  hintStep:Number(publicState.current.hintStep||0),
  visualStep:Number(publicState.current.visualStep||0),
  // A splash crop is different from the full answer image and must be kept.
  ...(q.type==='splash'?{image:publicState.current.image||''}:{})
 };
 const patch={current:publicQuestion(q,true,v,publicState.current.hintStep||0,sceneStep),phase:'reveal',solutionVisible:true,preRevealDisplay,deadline:0,pausedRemaining:0};
 patch.current.points=publicState.current.points;
 patch.current.basePoints=publicState.current.basePoints??q.points;
 patch.current.doublePoints=publicState.current.doublePoints===true;
 if(q.type==='map'){
  // Publish all submitted pins atomically with the solution; private until now.
  const answers=responses?.[roundKey()]||{};
  const expected=publicState.answerParticipants||participantSnapshot(roster);
  let review=reviewIsCurrent(publicState)?structuredClone(publicState.answerReview):makeAnswerReview(expected,answers,Number(publicState.round));
  for(const [id,entry] of Object.entries(review.entries||{})){
   const response=answers[id];
   if(entry.revealed||!decodePoint(response?.text))continue;
   if(!entry.submitted)review.entries[id]={...entry,submitted:true};
   review=revealAnswer(review,id,response);
  }
  patch.answerReview=review;
 }
 return patch;
}
async function hostReveal(){
 if(publicState?.phase==='reveal')return; // Already shown by a correct buzzer judgement.
 if(roundMode(activeQuestion())==='buzzer'&&winner()&&!publicState?.buzzerResolved?.[roundKey()])throw Error('Offener Buzzer: bitte zuerst richtig oder falsch bewerten oder den Buzzer zurücksetzen.');
 const q=quiz.questions.find(x=>x.id===publicState?.current?.id);
 if(!q)throw Error('Originalfrage im Host-Quiz fehlt. Eine Host-Quizdatei importieren.');
 await game.updateCurrent(room,Number(publicState.round),q.id,buildRevealPatch(q),['question','answered','paused','review']);
}
async function hostHint(){const q=quiz.questions.find(x=>x.id===activeQuestion()?.id);if(!q||!isOpen())return;const current=Number(activeQuestion()?.hintStep||0);if(current>=4)return;const next=(q.hints||[]).findIndex((h,i)=>i>=current&&h.trim());if(next<0)return;const v=q.type==='order'?activeQuestion().displayItems:activeQuestion().image||'';const pub=publicQuestion(q,false,v,next+1,Number(activeQuestion()?.scene?.step||0));if(q.type==='splash')pub.visualStep=Number(activeQuestion().visualStep||0);await game.updateCurrent(room,Number(publicState.round),q.id,{current:pub},['question']);}
async function hostSplashNext(){const q=quiz.questions.find(x=>x.id===activeQuestion()?.id);if(!q||q.type!=='splash'||!isOpen())return;const expectedRound=Number(publicState.round);const next=Math.min(2,Number(activeQuestion().visualStep||0)+1);const visual=await splashPreview(q.image,{...q,zoom:splashStageZoom(q.zoom,next)},false);const pub=publicQuestion(q,false,visual,Number(activeQuestion().hintStep)||0,Number(activeQuestion()?.scene?.step||0));pub.visualStep=next;await game.updateCurrent(room,expectedRound,q.id,{current:pub},['question']);}
async function hostSceneNext(){const source=quiz.questions.find(x=>x.id===activeQuestion()?.id);if(!source?.scene||!isOpen())return;const step=Number(activeQuestion()?.scene?.step||0);if(step>=5)return;const next=step+1;const v=source.type==='order'?activeQuestion().displayItems:activeQuestion().image||'';const pub=publicQuestion(source,false,v,Number(activeQuestion()?.hintStep||0),next);if(source.type==='splash')pub.visualStep=Number(activeQuestion().visualStep||0);if(isOffline()){publicState.current={...pub,points:activeQuestion().points,basePoints:activeQuestion().basePoints,doublePoints:activeQuestion().doublePoints};schedule();}else await game.updateCurrent(room,Number(publicState.round),source.id,{current:pub},['question']);}
async function hostPreviousReveal(){
 if(!canHost()||!activeQuestion())return;
 const source=quiz.questions.find(q=>q.id===activeQuestion().id);
 if(!source)throw Error('Die Originalfrage fehlt.');
 const phase=publicState.phase,round=Number(publicState.round),id=source.id;
 if(phase==='reveal'){
  if(publicState.solutionVisible===false)return;
  if(isOffline()){publicState.solutionVisible=false;schedule();}
  else await game.updateCurrent(room,round,id,{solutionVisible:false},['reveal']);
  return;
 }
 if(!isOpen())return; // Never reopen voting or buzzers after scoring.
 const q=activeQuestion(),scene=Number(q.scene?.step||0),hints=Number(q.hintStep||0),visual=Number(q.visualStep||0);
 if(!scene&&!hints&&!visual)return;
 if(visual>0&&source.type==='splash'){
  const image=await splashPreview(source.image,{...source,zoom:splashStageZoom(source.zoom,visual-1)},false);
  const pub=publicQuestion(source,false,image,hints,scene);pub.visualStep=visual-1;
  if(isOffline()){publicState.current=pub;schedule();}
  else await game.updateCurrent(room,round,id,{current:pub},['question']);
  return;
 }
 const v=source.type==='order'?q.displayItems:q.image||'';
 const pub=publicQuestion(source,false,v,scene>0?hints:Math.max(0,hints-1),Math.max(0,scene-1));
 if(source.type==='splash')pub.visualStep=visual;
 if(isOffline()){publicState.current=pub;schedule();}
 else await game.updateCurrent(room,round,id,{current:pub},['question']);
}
async function hostRepeatSolution(){
 if(!canHost()||publicState?.phase!=='reveal'||publicState.solutionVisible!==false||!activeQuestion())return;
 if(isOffline()){publicState.solutionVisible=true;schedule();}
 else await game.updateCurrent(room,Number(publicState.round),activeQuestion().id,{solutionVisible:true},['reveal']);
}
async function hostPause(){let remains=publicState.deadline?Math.max(0,publicState.deadline-now()):0;await game.updateCurrent(room,Number(publicState.round),publicState.current.id,{phase:'paused',deadline:0,pausedRemaining:remains},['question']);}
async function hostResume(){const ms=publicState.pausedRemaining||0;await game.updateCurrent(room,Number(publicState.round),publicState.current.id,{phase:'question',deadline:ms?now()+ms:0,pausedRemaining:0},['paused']);}
function makeQuestion(){return normalizedQuiz({questions:[{id:uid(),roundMode:'buzzer',category:'Neue Kategorie',title:'Neue Frage',type:'text',points:100,prompt:'',answer:'',explanation:'',cropX:50,cropY:50,zoom:3,icons:['','','','',''],abilityNames:ABILITIES,orderItems:[],seconds:0,hints:['','','','']}] ,teams:quiz.teams,title:quiz.title}).questions[0]}
const studio=createStudioEditor({
 getQuiz:()=>quiz,getQuestion:()=>currentQuestion(),setSelected:id=>{selected=id},
 boardInfo:()=>({id:boardId,title:quiz.title,isLocal:isOffline(),conflict:boardConflict,boards:isOffline()?boardList(localStorage):[]}),
 save:()=>saveLocal(),saveStatus:()=>saveState,notice,newId:uid,snapshot:()=>snapshotLayout(),discardSnapshot:()=>{undoStack.pop();},undo:()=>undoLayout('undo'),redo:()=>undoLayout('redo'),error:error,isOffline,onlineReady:()=>configured,
 optimizeImage,optimizeAudio,backup:()=>safeDownload(backupFilename('BrainQuiz_Backup'),JSON.stringify(normalizedQuiz(quiz),null,2)),
 makeQuestion:(category,template='text',boardRound=1)=>{
  if(quiz.questions.length>=180)throw Error('Maximal 180 Fragen pro Quiz.');
  snapshotLayout();
  const q=makeQuestion();q.boardRound=boardRound;q.category=category;q.title=category+' '+q.points;
  quiz.categories=collectCategories(quiz.categories,quiz.questions.concat(q));
  if(template!=='text'){
   q.type=Object.hasOwn(MODES,template)?template:'text';
   if(template==='image'||template==='map'||template===TEAM_EMOJI)q.scene=templateScene(template,q);
   if(template==='written'||template==='map')q.roundMode='written';
   if(template===TEAM_EMOJI){q.roundMode=TEAM_EMOJI;q.teamEmoji=normalizeTeamEmoji();}
  }
  quiz.questions.push(q);selected=q.id;saveLocal();
 },
 quickset:(cats,boardRound=1)=>{const items=quickBoard(cats).map(question=>({...question,boardRound}));if(quiz.questions.length+items.length>180)throw Error('Maximal 180 Fragen.');snapshotLayout();quiz.questions.push(...items);quiz.categories=collectCategories(quiz.categories,quiz.questions);selected=items[0]?.id||selected;saveLocal();},
 copyQuestion:(targetId)=>{const q=(targetId?quiz.questions.find(x=>x.id===targetId):null)||currentQuestion();if(!q)return;if(roundQuestions(quiz,boardRoundOf(q)).filter(item=>categoryKey(item.category)===categoryKey(q.category)).length>=6)throw Error('Maximal sechs Fragen in dieser Kategorie. Wähle das andere Spielbrett.');snapshotLayout();const next=JSON.parse(JSON.stringify(q));next.id=uid();next.title+=' (Kopie)';quiz.questions.push(next);selected=next.id;saveLocal();},
 deleteQuestion:()=>{const old=currentQuestion();if(!old)return;snapshotLayout();quiz.questions=quiz.questions.filter(x=>x.id!==old.id);selected=quiz.questions[0]?.id||'';saveLocal();}
});
async function doAction(action,button){if(isPublished()&&editorOnlyActions.has(action))throw Error('Das veröffentlichte Quiz ist gesperrt. Erstelle für weitere Fragen ein neues Quiz.');switch(action){
 case 'uncover-question':await uncoverSelectedQuestion();return;
 case 'next-board':case 'skip-board':{
  const early=action==='skip-board';
  if(!canHost()||!canAdvanceBoard(publicState,{force:early}))return;
  if(early){
   const remaining=remainingBoardQuestions(publicState,1).length;
   if(!remaining)throw Error('Alle Fragen der ersten Runde sind bereits gespielt.');
   if(!confirm('ACHTUNG: '+remaining+' offene Frage(n) werden beim Wechsel zu Runde 2 übersprungen. Diese Felder sind danach im laufenden Spiel nicht mehr erreichbar. Nur fortfahren, wenn dies mit allen Teams abgestimmt ist.'))return;
  }
  if(isOffline()){
   publicState=advanceBoardState(publicState,{force:early});boardPage=0;
   if(!rehearsal)saveOfflineSession();schedule();
  }else await game.advanceBoard(room,publicState.round,{force:early});
  return;
 }
 case 'emoji-start':{
  if(!canHost()||publicState?.teamEmoji?.phase!=='roles')return;
  const round=publicState.teamEmoji;
  if(rehearsal){advanceTeamEmoji(rehearsal.emoji,now());publicState.teamEmoji=publicTeamEmoji(rehearsal.emoji);schedule();return;}
  if(round.teams.some(team=>team.players>0&&!team.ready)&&!confirm('Einige Teams haben noch kein vollständiges Rollenpaar. Emoji-Phase starten?'))return;
  await game.startTeamEmoji(room,round.id);return;
 }
 case 'emoji-close':{
  const round=publicState?.teamEmoji;
  if(!canHost()||!round)return;
  if(['clues','guess'].includes(round.phase)&&!confirm('Diese Emoji-Teamrunde abbrechen? Das Fragenfeld zählt als gespielt.'))return;
  if(!await game.closeTeamEmoji(room,round.id,round.phase))notice('Die Runde ist inzwischen weitergelaufen.');
  return;
 }
 case 'emoji-add':case 'emoji-remove':{
  const own=playerEmoji,index=Number(button.dataset.emojiIndex);
  if(!own?.palette||publicState?.teamEmoji?.phase!=='clues'||own.id!==publicState.teamEmoji.id||!Number.isInteger(index)||index<0)return;
  const selection=emojiSelection(own);
  if(action==='emoji-add'&&index<own.palette.length&&selection.length<MAX_EMOJI_CLUES)selection.push(index);
  if(action==='emoji-remove'&&index<selection.length)selection.splice(index,1);
  schedule();return;
 }
 case 'emoji-role':case 'emoji-clue':case 'emoji-guess':{
  const round=publicState?.teamEmoji;
  if(!round||!rehearsal&&(role!=='guest'||!connected))return;
  const kind=action.slice('emoji-'.length);
  const value=kind==='role'?button.dataset.emojiRole:kind==='clue'?[...(emojiDraft?.indices||[])]:$('team-emoji-guess')?.value;
  const label={role:'Rollenwahl',clue:'Emoji-Hinweis',guess:'Rateversuch'}[kind];
  if(rehearsal){
   const demo=rehearsal.emoji;
   playTeamEmoji(demo,'t1',rehearsal.emojiActing,kind,value,demo.deadline?demo.deadline-1:now());
   publicState.teamEmoji=publicTeamEmoji(demo);schedule();return;
  }
  await sendGuestAction(label,()=>game.submitTeamEmoji(room,round.id,kind,value));return;
 }
 case 'sfx-mute':sfx.setMuted(!sfx.values().muted);schedule();return;
 case 'sfx-preview':sfx.unlock();sfx.play(button.dataset.sfx);return;
 case 'create-offline':startOffline();return;
 case 'create-new-quiz':createNewLocalQuiz();return;
 case 'save-board':saveCurrentBoard();return;
 case 'back-to-quizzes':backToSavedQuizzes();return;
 case 'host-current-board':await hostSavedQuiz(boardId);return;
 case 'host-saved-board':await hostSavedQuiz(button.dataset.boardId);return;
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
 case 'buzz-correct':case 'buzz-wrong':{
  if(!canHost()||!isOpen()||roundMode(activeQuestion())!=='buzzer'||!winner())throw Error('Kein aktiver Buzzer zu bewerten.');
  const b=winner(),verdict=action==='buzz-correct'?'correct':'wrong';
  if(isOffline())throw Error('Buzzerbewertung nur in einem Online-Raum verfügbar.');
  const question=quiz.questions.find(q=>q.id===activeQuestion().id);
  const patch=verdict==='correct'?buildRevealPatch(question):null;
  const result=await game.judgeBuzzer(room,roundKey(),b.uid,verdict,patch);
  notice(verdict==='correct'?`${b.name} richtig: +${result.delta} Punkte. Lösung aufgedeckt.`:`Falsch: ${result.delta} Punkte. Buzzer für andere wieder offen.`);return;
 }
 case 'judge-review-correct':case 'judge-review-wrong':case 'judge-correct':case 'judge-wrong':{
  const person=action.startsWith('judge-review-')?button.dataset.person:scoreTarget;
  if(!canHost()||!person||!activeQuestion()||roundMode(activeQuestion())!=='written')throw Error('Bewerte schriftliche Antworten in der Antwortübersicht.');
  const result=action.endsWith('correct')?'correct':'wrong';
  if(!publicState?.answerReview?.entries?.[person]?.revealed)throw Error('Antwort vor Bewertung zuerst aufdecken.');
  if(isOffline()){
   const team=roster?.[person]?.team,teamMode=scoreMode(publicState)==='team';
   const official=teamMode&&team?publicState.writtenTeamRepresentatives?.[roundKey()]?.[team]:null;
   if(official&&official!==person)throw Error('Dieses Team hat bereits eine offiziell bewertete Antwort.');
   publicState.playerScores??={};const previous=Number(publicState.playerScores[person]?.rounds?.[roundKey()]?.delta)||0;
   const next=updatePlayerScore(publicState.playerScores[person],{kind:'judgement',round:roundKey(),questionId:activeQuestion().id,points:Number(activeQuestion().points),result,at:now()});
   publicState.playerScores[person]=next;
   if(teamMode&&team&&publicState.teams?.[team]){
    publicState.writtenTeamRepresentatives??={};publicState.writtenTeamRepresentatives[roundKey()]??={};
    publicState.writtenTeamRepresentatives[roundKey()][team]=person;
    publicState.scores[team]=(Number(publicState.scores?.[team])||0)+(Number(next.rounds[roundKey()].delta)||0)-previous;
   }
   saveOfflineSession();schedule();
  }else await game.judgeWritten(room,roundKey(),person,result);
  scoreTarget=person;notice(result==='correct'?'Antwort richtig bewertet.':'Antwort falsch bewertet: halbe Fragepunkte abgezogen.');return;
 }
 case 'adjust-player':{if(!canHost()||!scoreTarget)throw Error('Person auswählen.');const delta=Number($('person-adjust')?.value);const actionData={kind:'manual',delta,at:now()};if(isOffline()){publicState.playerScores??={};publicState.playerScores[scoreTarget]=updatePlayerScore(publicState.playerScores[scoreTarget],actionData);saveOfflineSession();schedule();}else await game.scorePerson(room,scoreTarget,actionData);notice('Punkte korrigiert.');return;}
 case 'score-page':{scorePage=Math.max(0,scorePage+Number(button.dataset.delta||0));schedule();return;}
 case 'board-page':{boardPage=Math.max(0,Math.min(boardPages().length-1,boardPage+Number(button.dataset.delta||0)));schedule();return;}
 case 'request-pick':{if(role!=='guest'||member?.status!=='approved')return;const turn=selectingTeam(publicState);if(turn&&turn!==member.team)throw Error('Gerade wählt ein anderes Team.');await sendGuestAction(turn?'Fragenauswahl':'Fragenwunsch',()=>game.requestPick(room,button.dataset.qid,member.name));notice(turn?'Frage ausgewählt. Der Host deckt sie auf.':'Fragenwunsch an den Host gesendet.');return;}
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
 case 'probe-emoji-player':if(rehearsal){rehearsal.emojiActing=button.dataset.player;emojiDraft=null;schedule();}return;
 case 'probe-emoji-time':{
  if(!rehearsal?.emoji)return;
  const demo=rehearsal.emoji;
  if(!advanceTeamEmoji(demo,demo.deadline))return;
  publicState.teamEmoji=publicTeamEmoji(demo);
  if(demo.phase==='reveal'){
   for(const result of demo.results)publicState.scores[result.id]=(publicState.scores[result.id]||0)+result.points;
   publicState.phase='reveal';publicState.current={...publicQuestion(currentQuestion(),true),points:publicState.current.points,basePoints:publicState.current.basePoints,doublePoints:publicState.current.doublePoints};
  }
  schedule();return;
 }
 case 'editor-probe':{
  if(!isOffline()||!canHost())throw Error('Die Generalprobe ist nur in einer lokalen Quiz-Kopie verfügbar.');
  if(!quiz.questions.length)throw Error('Lege zuerst eine Frage an.');
  beginRehearsal();return;
 }
 case 'probe-buzz':case 'probe-answer':case 'probe-review':case 'probe-uncover':
 case 'probe-correct':case 'probe-wrong':case 'probe-width':case 'probe-media':case 'probe-reset':
  await rehearse(action,button);return;

 case 'lobby-join':{if(role!=='guest')return;await sendGuestAction('Teamwahl',()=>game.chooseLobbyTeam(room,button.dataset.team));notice('Team ausgewählt.');return;}
 case 'lobby-ready':{if(role!=='guest')return;await sendGuestAction('Bereitschaft',()=>game.setLobbyReady(room,button.dataset.ready==='true'));notice(button.dataset.ready==='true'?'Bereit gemeldet.':'Bereitschaft zurückgenommen.');return;}
 case 'clear-turn-relay':{
  const {configureTurnRelay}=await import('./peer-client.mjs');
  configureTurnRelay(null);notice('TURN-Einstellung entfernt. Bei laufendem Host erst nach Netzwerk-Neustart wirksam.');if(view==='setup')schedule();return;
 }
 case 'test-turn-relay':{
  const {testTurnRelay}=await import('./peer-client.mjs');
  await testTurnRelay();notice('TURN-Server erreichbar: Relay-Kandidat erfolgreich empfangen. Host und Gäste müssen denselben Zugang konfigurieren.');return;
 }
 case 'restart-host-transport':{
  if(!canHost()||isOffline()||!game?.restartHostTransport)throw Error('Nur für einen geöffneten Live-Hostraum verfügbar.');
  if(!confirm('Host-Netzwerk mit den aktuellen TURN-Einstellungen neu starten? Teilnehmer sind kurz getrennt und verbinden sich automatisch erneut. Punktestand und Fragen bleiben erhalten.'))return;
  await game.restartHostTransport(room);notice('Host-Verbindung neu aufgebaut. Teilnehmer verbinden sich erneut.');return;
 }
 case 'retry-connect':{
  if(role!=='guest'||!game?.retryGuestNow)return;
  await game.retryGuestNow();notice('Mit dem Host wieder verbunden.');return;
 }
 case 'copy-connection-report':{
  const report=connectionReport();
  try{await navigator.clipboard.writeText(report);notice('Verbindungsbericht ohne Schlüssel, IP-Adressen oder Quizlösungen kopiert.');}
  catch{safeDownload('BrainQuiz_Verbindungsbericht.txt',report);notice('Verbindungsbericht als Datei gespeichert.');}
  return;
 }
 case 'create':await createRoom();return;
 case 'leave-host-room':{if(!canHost()||isOffline())return;const active=isPublished();const msg=waitingInLobby()?'Diese Lobby schließen und alle Teilnehmer trennen? Das gespeicherte Quiz bleibt unter „Meine Quizze“.':active?'Dieses laufende Quiz für alle Teilnehmer beenden und den Raum verlassen? Der Spielstand ist danach nicht mehr fortsetzbar.':'Diese Lobby ohne Quizstart schließen? Alle Teilnehmer werden getrennt; dein Entwurf bleibt als Host-Sicherung erhalten.';if(!confirm(msg))return;const oldRoom=room;let copiedDraft=false;if(projectorChannel){projectorChannel.postMessage({t:'closed'});projectorChannel.close();projectorChannel=null;projectorRoom='';}if(!active&&quiz.questions.length){try{createBoard(localStorage,normalizedQuiz(quiz),makeBoardId);copiedDraft=true;}catch(err){throw Error('Entwurf konnte nicht als lokales Quizbrett gesichert werden. Die Lobby bleibt geöffnet: '+(err?.message||err));}}clearTimeout(cloudTimer);cloudTimer=null;cloudDirty=false;hostCloudReady=false;try{await cloudWriteTail}catch{}await game.deleteRoom(oldRoom);stopGuestListeners();game.clearWatchers();game=null;localStorage.removeItem('bq-last-host');localStorage.removeItem('bq-published-'+oldRoom);room='';role='landing';view='start';publicState=null;members={};roster={};presence={};responses={};buzzers={};messages={};connected=false;history.replaceState(null,'',location.pathname);schedule();notice(active?'Spielraum geschlossen.':copiedDraft?'Lobby geschlossen. Der Entwurf liegt unter deinen lokalen Quizbrettern.':'Lobby geschlossen.');return;}
  case 'resume':{const code=localStorage.getItem('bq-last-host');if(!code)throw Error('Kein vorheriger Hostraum gespeichert.');await enterRoom(code);return;}
 case 'start-game':{
  if(!canHost()||isOffline()||!canArrangeLobby(publicState))throw Error('Spielstart ist nur vor der ersten Frage möglich.');
  if(!isPublished())throw Error('Bitte zuerst das Quiz veröffentlichen.');
  if(!approvedCount(roster))throw Error('Lasse zuerst mindestens einen Teilnehmer zu.');
  if(!connected)throw Error('Die Host-Verbindung ist unterbrochen.');
  const pending=Object.values(members||{}).filter(p=>p?.status==='pending').length;
  const unready=Object.entries(roster||{}).filter(([uid])=>!members?.[uid]?.ready).map(([,p])=>p.name||'Spieler');
  const warnings=[];
  if(pending)warnings.push(pending+' offene Beitrittsanfrage(n)');
  if(unready.length)warnings.push(unready.length+' noch nicht bereit: '+unready.slice(0,5).join(', '));
  if(warnings.length&&!confirm('Vor dem Spielstart prüfen:\n• '+warnings.join('\n• ')+'\n\nTrotzdem bewusst starten?'))return;
  await game.setState(room,{started:true});view='live';schedule();notice('Quiz gestartet. Öffne die erste Frage auf dem Quizbrett.');return;
 }
 case 'view':{
  if(isPublished()&&button.dataset.view==='editor'){notice('Dieses Quiz ist bereits veröffentlicht.');return;}
  if(isOffline()&&button.dataset.view==='live'){beginRehearsal();return;}
  if(rehearsal&&button.dataset.view!=='present')endRehearsal();
  view=button.dataset.view;schedule();return;
 }
 case 'invite':{const link=location.origin+location.pathname+'?room='+room;await navigator.clipboard.writeText(`BrainQuiz Live\n${link}\nRaumcode: ${room}`);notice('Einladung kopiert.');return;}
 case 'copy-room':await navigator.clipboard.writeText(room);notice('Lobby-Code kopiert.');return;
  case 'copy-invite-link':{if(isOffline()||!hasValidRoom(room))throw Error('Kein aktiver Lobby-Link.');await navigator.clipboard.writeText(location.origin+location.pathname+'?room='+room);notice('Einladungslink kopiert.');return;}
 case 'select-q':selected=button.dataset.qid;editingBlock='';previewRevealed=false;previewImage='';lastEditAt=0;schedule();return;
 case 'new-q':{snapshotLayout();const q=makeQuestion();quiz.questions.push(q);selected=q.id;previewOpen=false;saveLocal();schedule();return;}
 case 'move-up':case 'move-down':{snapshotLayout();const i=quiz.questions.findIndex(x=>x.id===selected),j=i+(action==='move-up'?-1:1);if(i<0||j<0||j>=quiz.questions.length)return;[quiz.questions[i],quiz.questions[j]]=[quiz.questions[j],quiz.questions[i]];saveLocal();schedule();return;}
 case 'clone-q':{const q=currentQuestion();if(!q)return;if(roundQuestions(quiz,boardRoundOf(q)).filter(item=>categoryKey(item.category)===categoryKey(q.category)).length>=6)throw Error('Maximal sechs Fragen in dieser Kategorie.');snapshotLayout();const copy=JSON.parse(JSON.stringify(q));copy.id=uid();copy.title+=' (Kopie)';quiz.questions.push(copy);selected=copy.id;saveLocal();schedule();return;}
 case 'delete-q':{const q=currentQuestion();if(!q||!confirm(`Frage „${q.title}“ wirklich löschen?`))return;snapshotLayout();quiz.questions=quiz.questions.filter(x=>x.id!==q.id);selected=quiz.questions[0]?.id||'';saveLocal();schedule();return;}
 case 'preview-q':{previewOpen=!previewOpen;previewRevealed=false;previewImage='';const q=currentQuestion();if(previewOpen&&q?.type==='splash')previewImage=await splashPreview(q.image,q,false);schedule();return;}
 case 'preview-reveal':previewRevealed=!previewRevealed;schedule();return;
 case 'reset-order':pickedOrder=[];schedule();return;
 case 'pick-order':{const q=activeQuestion(),i=Number(button.dataset.index);if(q?.type!=='order'||!guestCanAnswer()||myResponse||pickedOrder.includes(i)||!Number.isInteger(i)||i<0||i>=q.displayItems?.length)return;pickedOrder.push(i);schedule();return;}
 case 'splash-next':if(!canHost())return;await hostSplashNext();return;
 case 'hint-next':if(!canHost())return;await hostHint();return;
 case 'scene-next':if(!canHost())return;await hostSceneNext();return;
 case 'reveal-prev':await hostPreviousReveal();return;
 case 'solution-forward':await hostRepeatSolution();return;
 case 'save-q':saveLocal();if(!isOffline()){cloudDirty=true;await flushHostCloudSave();notice('Frage privat im Host-Browser gesichert.');}else notice('Frage lokal gespeichert.');return;
 case 'import':$('import-quiz')?.click();return;
 case 'export':safeDownload(backupFilename(),JSON.stringify(normalizedQuiz(quiz),null,2));notice('Quizbrett als privates Backup exportiert. Nicht an Teilnehmer weitergeben!');return;
 case 'publish':await publish();return;
 case 'select-choice':{if(!canHost()&&isOpen()&&!myResponse){guestChoice=button.dataset.choice||'';const target=$('answer-text');if(target)target.value=guestChoice;schedule();}return;}
 case 'custom-score':{const team=$('custom-team')?.value,amount=Number($('custom-points')?.value);if(!canHost()||!publicState.teams[team]||!Number.isInteger(amount)||Math.abs(amount)>10000||!amount)throw Error('Bitte gültige Punktkorrektur zwischen -10.000 und +10.000 eingeben.');if(isOffline()){publicState.scores[team]=(Number(publicState.scores[team])||0)+amount;schedule();}else await game.score(room,team,amount);notice('Punkte korrigiert.');return;}
 case 'open':if(!canHost())return;await hostOpen(button.dataset.qid);return;
 case 'clear-pick':{
  if(!canHost()||isOffline()||publicState?.phase!=='board'||!publicState?.questionPick)return;
  await game.clearPicks(room);notice('Auswahl aufgehoben. Dasselbe Team darf erneut wählen.');return;
 }
 case 'skip-turn':{
  if(!canHost()||publicState?.phase!=='board'||!selectingTeam(publicState))return;
  const current=teamName(selectingTeam(publicState));
  if(!confirm('Das Auswahlrecht von '+current+' an das nächste Team weitergeben? Es werden keine Punkte verändert.'))return;
  if(isOffline()){const next=skipSelectionTurn(publicState);if(!next)throw Error('Auswahlrecht kann jetzt nicht weitergegeben werden.');publicState=next;saveOfflineSession();schedule();}
  else await game.skipSelection(room);
  notice('Jetzt wählt das nächste Team.');return;
 }
 case 'cancel-question':{
  if(!canHost()||!activeQuestion())return;
  if(!confirm('Frage als UNGESPIELT zurücklegen? Das geht nur ohne Buzzer, Antworten oder Punktwertungen. Dasselbe Team behält das Auswahlrecht.'))return;
  if(isOffline()){
   const next=cancelQuestionState(publicState);
   if(!next)throw Error('Diese Frage ist nicht ungespielt zurücklegbar.');
   publicState=next;delete questionHistory[roundKey()];saveOfflineSession();schedule();
  }else await game.cancelQuestion(room,Number(publicState.round),activeQuestion().id);
  notice('Frage ist wieder verfügbar und nicht als gespielt markiert.');return;
 }
 case 'start-review':if(roundMode(activeQuestion())!=='written')throw Error('Antwortübersicht ist nur für Schreib-Runden.');await startAnswerReview(false);return;
 case 'reveal-answer':await publishOneAnswer(button.dataset.uid);return;
 case 'reveal-all-answers':await publishAllAnswers();return;
 case 'audio-play':{
  const q=activeQuestion(),play=soundEvent();
  if(!canHost()||!q||q.type!=='audio'||!isOpen()||!isAudioData(q.audio))throw Error('Sound kann nur vom Host während einer offenen Audiofrage abgespielt werden.');
  if(play&&soundPlayer?.key===room+':'+publicState.round+':'+q.id&&!soundPlayer.ended)throw Error('Sound läuft noch oder wurde nicht fertig abgespielt.');
  const next={round:Number(publicState.round),id:q.id,seq:(play?.seq||0)+1,at:now()};
  if(isOffline()){publicState.audioPlayback=next;schedule();}
  else await game.updateCurrent(room,Number(publicState.round),q.id,{audioPlayback:next},['question']);
  return;
 }
 case 'audio-unblock':{
  const play=soundEvent();
  if(!play||!isOpen()||!soundPlayer||soundPlayer.seq!==play.seq||!soundPlayer.blocked||soundPlayer.ended)throw Error('Der Host hat keinen neuen Sound freigegeben.');
  await attemptSoundPlayback(soundPlayer,play);return;
 }
 case 'reveal':if(!canHost()||!activeQuestion()||publicState.phase==='ready')return;if(isOffline()){const q=quiz.questions.find(x=>x.id===activeQuestion()?.id);publicState={...publicState,...buildRevealPatch(q)};schedule();}else await hostReveal();return;
 case 'pause':if(isOffline()){publicState.pausedRemaining=publicState.deadline?Math.max(0,publicState.deadline-now()):0;publicState.deadline=0;publicState.phase='paused';schedule();}else await hostPause();return;
 case 'resume-round':if(isOffline()){publicState.deadline=publicState.pausedRemaining?now()+publicState.pausedRemaining:0;publicState.pausedRemaining=0;publicState.phase='question';schedule();}else await hostResume();return;
 case 'back':{
  if(!canHost()||!activeQuestion())return;
  if(winner()&&!publicState.buzzerResolved?.[roundKey()])throw Error('Offener Buzzer: zuerst richtig oder falsch bewerten oder den Buzzer zurücksetzen.');
  const changed=publicState.phase!=='reveal';
  if(changed&&!confirm('Die Frage wird als GESPIELT markiert, auch wenn sie nicht richtig beantwortet wurde.\n\nUngespielt zurücklegen geht stattdessen über die separate Schaltfläche. Trotzdem beenden?'))return;
  if(isOffline()){publicState=returnToBoardState(publicState)||publicState;if(!rehearsal)saveOfflineSession();schedule();}
  else await game.returnToBoard(room,publicState.round,activeQuestion().id);
  return;
 }
 case 'reset-buzz':if(isOffline()){buzzers={};schedule();}else await game.clearBuzzer(room,roundKey());return;
 case 'arm-buzzer':{
  if(!canHost()||isOffline()||!isOpen()||roundMode(activeQuestion())!=='buzzer'||winner())return;
  await game.updateCurrent(room,Number(publicState.round),activeQuestion().id,{buzzerArmed:button.dataset.armed==='true'},['question']);
  return;
 }
 case 'toggle-manual-buzz':{
  if(!canHost()||isOffline())return;
  await game.setState(room,{'settings/manualBuzzer':!publicState.settings?.manualBuzzer});
  return;
 }
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
 case 'buzz':{if(canHost()||!member||!connected||!canBuzz(publicState,buzzers,game?.uid,member.team,now()))return;sfx.play('buzz');const wasFirst=await sendGuestAction('Buzzer',()=>game.buzzer(room,roundKey(),member.team,member.name));notice(wasFirst?'Buzzer angekommen! Du bist zuerst gewesen.':'Ein anderer Buzzer war schneller.');return;}
 case 'submit-map':{if(canHost()||!member||activeQuestion()?.type!=='map'||!mapPick||winner()?.uid!==game?.uid||!isOpen())return;await sendGuestAction('Kartenpunkt',()=>game.answer(room,roundKey(),member.team,encodePoint(mapPick)));notice('Kartenpunkt an den Host gesendet.');return;}
 case 'submit-answer':{if(canHost()||!member||!guestCanAnswer()||(myResponse&&activeQuestion()?.type!=='map')||roundMode(activeQuestion())!=='written')return;const q=activeQuestion();let text='';if(q?.type==='map'){text=encodePoint(mapPick)}else if(q?.type==='order'){if(pickedOrder.length!==q.displayItems?.length)throw Error('Bitte alle Sortiereinträge auswählen.');text=pickedOrder.map(i=>String.fromCharCode(65+i)).join(' → ');}else if(q?.type==='estimate'){const raw=$('answer-number')?.value||'';if(!raw.trim()||!Number.isFinite(Number(raw)))throw Error('Bitte einen gültigen Zahlenwert eingeben.');text=String(Number(raw));}else{text=$('answer-text')?.value?.trim()||'';}if(!text)throw Error('Bitte eine Antwort eingeben.');await sendGuestAction(q.type==='map'?'Kartenpunkt':'Antwort',()=>game.answer(room,roundKey(),member.team,text));notice('Antwort gesendet.');return;}
 case 'undo-last-score':{if(!canHost()||isOffline()||!game?.hostUndoScore)throw Error('Punkte können nur vom verbundenen Host korrigiert werden.');const id=button.dataset.event;if(!id)throw Error('Kein Punkteeintrag gewählt.');if(!confirm('Letzte Punkteänderung rückgängig machen? Bereits gezeigte Lösungen und Runden bleiben unverändert.'))return;await game.hostUndoScore(room,id);notice('Letzte Punkteänderung wurde zurückgenommen und protokolliert.');return;}
 case 'regrade-score':{
  if(!canHost()||isOffline())return;
  if(!confirm('Bewertung ändern und den Punktestand entsprechend korrigieren?'))return;
  const event=await game.hostRegradeScore(room,button.dataset.event);
  notice(event.verdict==='correct'?'Als richtig gewertet.':'Als falsch gewertet.');
  return;
 }
 case 'export-history':{if(!canHost())return;const players=Object.fromEntries(participantList().map(([id,name])=>[id,{name}]));const rows=historyRows(questionHistory,responses,publicState?.playerScores,players);if(!rows.length)throw Error('Noch keine Fragerunden im Verlauf.');const solutions=Object.fromEntries(quiz.questions.map(q=>[q.id,answerViewContent(q).text]));const metadata=Object.fromEntries(quiz.questions.map(q=>[q.id,q]));const blob=new Blob([historyCsv(rows,solutions,metadata)],{type:'text/csv;charset=utf-8'});const href=URL.createObjectURL(blob);const link=document.createElement('a');link.href=href;link.download='BrainQuiz_Fragenverlauf.csv';link.click();setTimeout(()=>URL.revokeObjectURL(href),500);return;}
 case 'finish-game':{
  if(!canHost()||isOffline()||!mayFinishGame(publicState))throw Error('Quiz kann nur zwischen Fragen oder nach einer Auflösung beendet werden.');
  if(boardRoundOf(publicState)===1&&Object.values(publicState.board||{}).some(cell=>boardRoundOf(cell)===2))
   throw Error('Vor der Siegerehrung muss Runde 2 gestartet oder ausdrücklich übersprungen werden.');
  const ranking=finalStandings(publicState,roster);
  const summary=ranking.map(row=>row.rank+'. '+row.name+' · '+row.points.toLocaleString('de-DE')+' Punkte').join('\n');
  const left=remainingBoardQuestions(publicState).length;
  if(!confirm('Endstand prüfen und Siegerehrung starten?'+(left?'\n\nAchtung: '+left+' Fragen der aktuellen Runde sind noch ungespielt.':'')+'\n\n'+summary))return;
  await game.setState(room,{phase:'finished',finaleStep:0,presentation:null,current:null,deadline:0,pausedRemaining:0,answerReview:null,answerParticipants:null});
  return;
 }
 case 'finale-next':case 'finale-all':{
  if(!canHost()||isOffline()||publicState?.phase!=='finished')return;
  const next=Number(button.dataset.step);
  if(action==='finale-next'&&next!==publicState.finaleStep+1)return;
  await game.setState(room,{finaleStep:action==='finale-next'?next:null});
  return;
 }
 case 'resume-final':{
  if(!canHost()||isOffline()||publicState?.phase!=='finished')return;
  await game.setState(room,{phase:'board',finaleStep:null,current:null,deadline:0});
  return;
 }
 case 'open-projector':{openProjector();return;}
 case 'copy-projector':{
  const href=projectorLink(true);
  pushProjector();
  try{await navigator.clipboard.writeText(href);notice('Zuschauerlink kopiert.');}
  catch{prompt('Zuschauerlink zum Kopieren',href);}
  return;
 }
 case 'projector-scene':{
  if(!canHost()||isOffline()||publicState?.phase==='finished')return;
  const slide=button.dataset.slide||'';
  if(slide&&!Object.hasOwn(PROJECTOR_SLIDES,slide))return;
  await game.setState(room,{presentation:slide||null});
  return;
 }
 case 'export-final-results':{if(!canHost()||isOffline())return;
  const rows=finalStandings(publicState,roster),header='Platz;Name;Punkte\r\n';
  const body=rows.map(r=>[r.rank,r.name,r.points].map(csvSafeCell).join(';')).join('\r\n');
  const blob=new Blob(['\ufeff'+header+body],{type:'text/csv;charset=utf-8'}),href=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=href;anchor.download='BrainQuiz_Endstand.csv';anchor.click();
  setTimeout(()=>URL.revokeObjectURL(href),500);return;}
 case 'reset-questions':{
  if(!canHost())return;
  if(!confirm('Alle Buzzer, Antworten, Spielrunden und Punkte zurücksetzen? Das Quiz im Editor bleibt erhalten.'))return;
  boardPage=0;scorePage=0;questionHistory={};buzzers={};responses={};picks={};
  const next=resetBoardGameState(publicState,buildPublicBoard(quiz),roster);
  if(isOffline()){localStorage.removeItem('bq-session-LOCAL-'+boardId);publicState=next;schedule();return;}
  await game.clearRoomEvents(room);await game.replacePublic(room,next);return;
 }
 default:return;}}
async function handleMessage(form){const text=$('chat-text')?.value.trim();if(!text)return;if(Date.now()-lastMsgTime<1100)throw Error('Bitte zwischen zwei Nachrichten kurz warten.');if(!canHost()&&!chatAllowed())throw Error('Teamchat wurde vorübergehend gesperrt.');
 const target=canHost()?chatTeam:member?.team,targets=target==='ALL'?Object.keys(publicState.teams||{}):[target],name=canHost()?'HOST':member.name;
 const send=()=>Promise.all(targets.map(t=>game.message(room,t,name,text)));if(canHost())await send();else await sendGuestAction('Chatnachricht',send);lastMsgTime=Date.now();const input=$('chat-text');if(input?.value.trim()===text)input.value='';}
async function handleUpload(input){const kind=input.dataset.image,file=input.files?.[0],q=currentQuestion();if(!file||!q)return;
 const data=await optimizeImage(file,kind==='main'?1350:500,kind==='main'?350000:65000);
 if(kind==='main')q.image=data;else if(kind==='icon')q.icons[Number(input.dataset.index)]=data;else if(kind==='correct-icon')q.correctIcon=data;
 saveLocal();schedule();notice('Bild verarbeitet und lokal gespeichert.');}
async function handleBlockUpload(input){const b=chosenBlock(),file=input.files?.[0];if(!b||b.type!=='image'||!file)return;const q=currentQuestion();snapshotLayout();const data=await optimizeImage(file,850,120000);b.image=data;b.alt=b.alt||file.name.replace(/\.[^.]+$/,'').slice(0,120);const total=q.blocks.reduce((sum,x)=>sum+(x.image?.length||0),0);if(total>780000){undoLayout('undo');throw Error('Bildmenge für eine Frage überschreitet 780 KB. Bitte weniger oder kleinere Bilder nutzen.');}saveLocal();schedule();notice('Bild optimiert und im Fragenlayout gespeichert.');}
async function handleAudioUpload(input){const q=currentQuestion(),file=input.files?.[0];if(!q||!file)return;notice('Audio wird lokal verarbeitet …');q.audio=await optimizeAudio(file,q.audioStart,q.audioDuration);saveLocal();schedule();notice('Audioclip verarbeitet, ohne Original-Metadaten gespeichert.');}
async function handleImport(input){if(isPublished())throw Error('Nach der Veröffentlichung können keine weiteren Fragen importiert werden.');const file=input.files?.[0];if(!file)return;if(file.size>8_000_000)throw Error('Host-Quizdatei zu groß (max. 8 MB).');const raw=JSON.parse(await file.text());if(!Array.isArray(raw.questions))throw Error('Datei enthält keine gültige Quiz-Fragensammlung.');const imported=normalizedQuiz(raw);if(isOffline()){studio.flush?.();if(!saveLocal())throw Error('Das aktuelle Quizbrett konnte nicht gespeichert werden.');const created=createBoard(localStorage,imported,makeBoardId);applyBoardWorkspace(created);loadOfflineBoardState();editorSearch='';view='editor';schedule();notice('Host-Quiz als eigenes Quizbrett importiert. Vorheriges Brett bleibt erhalten.');return;}if(!confirm('Quizbrett „'+quiz.title+'“ im aktuellen Live-Raum durch diese Datei ersetzen? Vorher wird automatisch ein Backup heruntergeladen.'))return;safeDownload(backupFilename('BrainQuiz_Vor_Import'),JSON.stringify(normalizedQuiz(quiz),null,2));snapshotLayout();quiz=imported;selected=quiz.questions[0]?.id||'';editingBlock='';previewOpen=false;previewRevealed=false;editorSearch='';if(!saveLocal())throw Error('Importiert, aber Speichern fehlgeschlagen. Quiz als Datei exportieren.');view='editor';schedule();notice('Host-Quiz importiert. Für Teilnehmer muss es noch live veröffentlicht werden.');}
function updateClock(){const el=$('clock');if(!el)return;const deadline=publicState?.deadline||0;if(!deadline){el.textContent='–:––';return;}const s=Math.max(0,Math.ceil((deadline-now())/1000));el.textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
const CRITICAL_HOST_ACTIONS=new Set(['open','clear-pick','skip-turn','cancel-question','uncover-question','next-board','skip-board','reveal','start-review','reveal-all-answers','reveal-answer','audio-play','back','score','judge-correct','judge-wrong','judge-review-correct','judge-review-wrong','publish','start-timer','stop-timer','undo-last-score','regrade-score','arm-buzzer','buzz-correct','buzz-wrong','reveal-prev','solution-forward','restart-host-transport','finish-game','finale-next','finale-all','resume-final']);
const HOST_ACTION_FEEDBACK={open:'Frage geöffnet.',reveal:'Lösung freigegeben.','start-review':'Antwortübersicht geöffnet.','reveal-all-answers':'Antworten aufgedeckt.',score:'Punkte aktualisiert.'};
document.addEventListener('pointerdown',()=>{sfx.unlock()},{capture:true,passive:true});
document.addEventListener('keydown',()=>{sfx.unlock()},{capture:true});
document.addEventListener('input',ev=>{const input=ev.target;if(!input?.matches?.('[data-sfx-volume]'))return;
 const value=sfx.setVolume(input.dataset.sfxVolume,input.value)[input.dataset.sfxVolume];
 const output=input.closest('.bq-sfx-row')?.querySelector('output');if(output)output.textContent=value+' %';
});
document.addEventListener('click',async ev=>{if(ev.target.closest('.question-settings summary'))settingsExpanded=!ev.target.closest('details').open;if(ev.target.closest('.inspector-advanced summary'))inspectorExpanded=!ev.target.closest('details').open;if(ev.target.closest('.quiz-metadata summary'))quizMetaExpanded=!ev.target.closest('details').open;const b=ev.target.closest('[data-action]');if(!b)return;ev.preventDefault();if(b.disabled)return;try{b.disabled=true;const action=b.dataset.action;if(canHost()&&CRITICAL_HOST_ACTIONS.has(action)){const key=[room,publicState?.round??0,action,b.dataset.uid||b.dataset.person||b.dataset.team||b.dataset.qid||b.dataset.event||''].join(':');await hostActionLease.run(key,async()=>{await doAction(action,b);if(HOST_ACTION_FEEDBACK[action])notice(HOST_ACTION_FEEDBACK[action]);});}else await doAction(action,b);}catch(err){error(err);}finally{if(document.contains(b))b.disabled=false;}});
document.addEventListener('submit',async ev=>{if(!['join-form','chat-form','answer-form','lobby-create-form','host-team-create-form','turn-relay-form','team-emoji-guess-form'].includes(ev.target.id))return;ev.preventDefault();
 const joining=ev.target.id==='join-form';
 const joinButton=joining?ev.target.querySelector('button[type="submit"]'):null;
 if(joining){
  if(ev.target.dataset.connecting==='1')return;
  ev.target.dataset.connecting='1';
  if(joinButton){joinButton.disabled=true;joinButton.textContent='Verbinde …';}
  ev.target.querySelector('.bq-join-error')?.remove();
 }
 try{if(ev.target.id==='team-emoji-guess-form'){await doAction('emoji-guess',ev.target);return;}if(ev.target.id==='turn-relay-form'){
 const data=Object.fromEntries(new FormData(ev.target));
 const {configureTurnRelay}=await import('./peer-client.mjs');
 configureTurnRelay(data);ev.target.reset();notice(canHost()?'TURN gespeichert. Damit der Host sie nutzt, Netzwerk in den Einstellungen neu starten.':'TURN für neue Verbindungen in diesem Tab gespeichert.');if(view==='setup')schedule();return;
 }if(ev.target.id==='host-team-create-form'){if(!canHost()||isOffline())throw Error('Nur der Host des Live-Raums kann Teams erstellen.');const input=$('bq-host-team-name');const created=await game.hostCreateLobbyTeam(room,input?.value||'');if(input){input.value='';input.blur();input.closest('details')?.removeAttribute('open');}notice('Team „'+created.name+'“ erstellt.');}if(ev.target.id==='lobby-create-form'&&role==='guest'){const name=$('bq-new-team')?.value||'';await sendGuestAction('Teamname',()=>game.createLobbyTeam(room,name));notice('Teamname übernommen. Der Host bestätigt deine Auswahl.');}if(ev.target.id==='join-form')await enterRoom($('join-room').value,$('join-name').value,true);if(ev.target.id==='chat-form')await handleMessage(ev.target);if(ev.target.id==='answer-form'&&!canHost()&&(!myResponse||activeQuestion()?.type==='map'))await doAction('submit-answer',ev.target);}catch(err){
  if(joining&&ev.target.isConnected){
   const alert=document.createElement('p');
   alert.className='bq-join-error span2';alert.setAttribute('role','alert');
   alert.textContent=String(err?.message||'Beitritt fehlgeschlagen. Netzwerk prüfen und erneut versuchen.');
   ev.target.appendChild(alert);
  }
  error(err);
 }finally{
  if(joining){
   delete ev.target.dataset.connecting;
   if(joinButton&&joinButton.isConnected){joinButton.disabled=false;joinButton.textContent='Beitreten';}
  }
 }});
document.addEventListener('input',ev=>{const input=ev.target;if(input.dataset.blockfield){blockPropertyUpdate(input);return;}if(input.id==='history-search'){historyFilter=input.value;schedule();return;}if(input.id==='editor-search'){editorSearch=input.value;schedule();return;}if(input.id?.startsWith('q-')||['quiz-title','quiz-description','quiz-teams','quiz-manual-players'].includes(input.id)){updateDraftField(input);clearTimeout(updateDraftField.timer);updateDraftField.timer=setTimeout(schedule,350);}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&cloudDirty)void flushHostCloudSave();
 if(document.visibilityState==='visible'&&role==='guest'&&!connected)void game?.retryGuestNow?.().catch(()=>{});
});
window.addEventListener('online',()=>{if(role==='guest'&&!connected)void game?.retryGuestNow?.().catch(()=>{});});
window.addEventListener('storage',event=>{
 if(!isOffline()||!boardId||event.key!=='bq-board-workspace-'+boardId)return;
 try{const current=loadBoard(localStorage,boardId);if(current.revision===boardRevision)return;}catch{}
 boardConflict=true;saveState='KONFLIKT – als Kopie sichern!';schedule();notice('Ein anderer Tab hat dieses Quizbrett geändert. Deine Änderungen werden nicht überschrieben.');
});
window.addEventListener('beforeunload',event=>{
 if(role==='host'&&(boardConflict||/SPEICHERFEHLER|KONFLIKT/.test(saveState))){event.preventDefault();event.returnValue='';}
});
document.addEventListener('change',async ev=>{const target=ev.target;try{if(target.id==='import-quiz')await handleImport(target);else if(target.dataset.blockimage)await handleBlockUpload(target);else if(target.dataset.blockfield){blockPropertyUpdate(target);schedule();}else if(target.dataset.image)await handleUpload(target);else if(target.dataset.audio)await handleAudioUpload(target);else if(target.id==='q-type'){updateDraftField(target);schedule();}else if(target.id?.startsWith('team-')){pendingTeamChoices.set(target.id.slice(5),target.value);}else if(target.id==='chat-team'){chatTeam=target.value;schedule();}else if(target.id?.startsWith('q-'))updateDraftField(target);}catch(err){error(err);}});
document.addEventListener('keydown',ev=>{if((ev.key==='Enter'||ev.key===' ')&&document.activeElement?.classList.contains('bq-selectable')){ev.preventDefault();document.activeElement.click();return;}const input=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);if((ev.ctrlKey||ev.metaKey)&&ev.code==='KeyS'&&canHost()){ev.preventDefault();safeDownload(backupFilename('BrainQuiz_Autosicherung'),JSON.stringify(normalizedQuiz(quiz),null,2));notice('Quiz-Backup heruntergeladen.');return;}if((ev.ctrlKey||ev.metaKey)&&!input&&canHost()&&ev.code==='KeyZ'){ev.preventDefault();undoLayout(ev.shiftKey?'redo':'undo');return;}});

document.addEventListener('keydown',ev=>{if(ev.code!=='KeyB'||ev.ctrlKey||ev.altKey||ev.metaKey||canHost()||role!=='guest')return;const el=document.activeElement;if(el&&['INPUT','TEXTAREA','SELECT'].includes(el.tagName))return;ev.preventDefault();const b=document.querySelector('[data-action="buzz"]');if(b&&!b.disabled)b.click();});
setInterval(()=>{updateClock();if(publicState?.phase==='question'&&roundMode(activeQuestion())==='written'&&publicState.deadline&&now()>=publicState.deadline)void maybeAutoBeginReview();const play=soundEvent();if(soundPlayer?.blocked&&play&&soundExpired(soundPlayer,play)){soundPlayer.ended=true;soundPlayer.blocked=false;schedule();}},350);
render();
// A host may restore a previous session from its own browser; returning guests
// need the per-tab identity/secret created on their original visit.
if(hasValidRoom(roomFromLink))void (async()=>{
 try{
  const isHost=await (await initialize()).hasHostSession(roomFromLink);
  const isGuest=!!sessionStorage.getItem('bq-p2p-guest-'+roomFromLink);
  if(isGuest)await enterRoom(roomFromLink,'Spieler',true);
  else if(isHost)await enterRoom(roomFromLink);
 }catch(err){notice(err?.message||'Wiederverbindung fehlgeschlagen.');}
})();
if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});

window.addEventListener('resize',()=>{if(isGameView())schedule();},{passive:true});
