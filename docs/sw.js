// Offline-capable static shell only. Quiz data, WebRTC messages, private URLs and
// unrecognized same-origin assets MUST NOT enter the service-worker Cache Storage.
const NAME='brainquiz-shell-3.7.1-image-drop-map-distance-soundquiz-fast-cover-sfx-buzzer-reveal-rtc-audit-answer-tabs-qol-audit-phases-1to5-live-release-team-emoji-imposter-two-boards-team-turns-fullscreen-reveal-rewind-rtc-recovery-turn-probe-final-six-team-score-sfx-host-emoji-category-peerjs-default-ice-lobby-join-map-pins-timed-answers-team-review-20261119-host-only-selection-indexeddb-quiz-library-20261120-live-playtest-answer-input-team-draw-emoji-sort-projector';
const ASSETS=['./','./index.html','./projector.html','./projector.mjs','./style.css','./pixel-theme.css','./characters.css','./actor-motion.css','./map-dagger-animation.css','./session-ui.css','./map-ui.css','./lobby-ui.css','./host-flow.css','./editor-categories.css','./editor-31.css','./board-workspace.css','./category-model.mjs','./editor-workflows.mjs','./pixel-constellation.png','./pixel-corner.png','./app.mjs','./answer-view.mjs','./score-ledger.mjs','./backup-store.mjs','./final-results.mjs','./sound-effects.mjs','./core.mjs','./team-emoji.mjs','./emoji-catalog.json','./question-flow.mjs','./layout.mjs','./studio-model.mjs','./studio-editor.mjs','./image-drop.mjs','./board-workspace.mjs','./answer-review.mjs','./history-model.mjs','./peer-client.mjs','./round-rules.mjs','./lobby-model.mjs','./lobby-view.mjs','./icon.svg','./characters/rogue.webp','./characters/blades.webp','./characters/mage.webp','./characters/druid.webp','./map-tools.mjs','./map-viewport.mjs','./map-dagger-animation.mjs','./world-map.svg','./dagger-pin.svg','./manifest.webmanifest'];
const SCOPE=new URL(self.registration.scope);
const ALLOWED_PATHS=new Set(ASSETS.map(path=>new URL(path,SCOPE).pathname));
self.addEventListener('install',event=>event.waitUntil(caches.open(NAME).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('brainquiz-shell-')&&k!==NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin!==SCOPE.origin||!ALLOWED_PATHS.has(url.pathname))return;
 // Strip query parameters (e.g. ?room=...) from the cache key for our public landing page.
 // Never cache non-whitelisted pages, quiz URLs, room API calls or network data.
 const isIndex=url.pathname===SCOPE.pathname||url.pathname===new URL('./index.html',SCOPE).pathname;
 const isProjector=url.pathname===new URL('./projector.html',SCOPE).pathname;
 const key=isIndex?new URL('./index.html',SCOPE).href:isProjector?new URL('./projector.html',SCOPE).href:event.request;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok&&response.type==='basic'){
   const copy=response.clone();caches.open(NAME).then(cache=>cache.put(key,copy));
  }
  return response;
 }).catch(()=>caches.match(key)));
});
