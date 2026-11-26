import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
import {VERSION,MODES,normalizedQuiz,publicQuestion,shuffledItems,shuffledOrderItems,orderResponseIndices,orderResponseText,splashStageZoom,rankEstimates,validateQuestion,escapeHTML,isAudioData} from '../docs/core.mjs';
import {templateScene,reconcileQuestion} from '../docs/studio-model.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const base={id:'new-01',category:'League',title:'Test',prompt:'Was ist richtig?',points:200,answer:'Geheim',hints:['Kleiner Tipp','Großer Tipp','Letzter Tipp']};
test('Emoji und Zeichnen sind eigene Fragetypen',()=>{assert.equal(VERSION,'3.6.7');assert.equal(MODES['team-emoji'],'Emoji-Teamrunde');assert.equal(MODES['team-draw'],'Champion zeichnen')});
test('V1.1 Dateien lassen sich ohne Versionsmigration importieren',()=>{const q=normalizedQuiz({version:1,questions:[{...base,type:'text'}]}).questions[0];assert.equal(q.answer,'Geheim');assert.equal(q.seconds,0);assert.equal(q.hints.length,3)});
test('Sortier-Geheimnis wird erst bei Reveal übertragen',()=>{const q={...base,type:'order',orderItems:['Ladebildschirm','Spielstart','Spielende']};const pub=publicQuestion(q,false,['Spielstart','Spielende','Ladebildschirm']);assert.equal(pub.orderItems,undefined);assert.deepEqual(pub.displayItems,['Spielstart','Spielende','Ladebildschirm']);assert.equal(pub.answer,undefined);assert.deepEqual(publicQuestion(q,true,pub.displayItems).orderItems,q.orderItems)});
test('Sortierzufall verändert Original nicht und verliert kein Element',()=>{const original=['Alpha','Beta','Gamma','Delta'];const out=shuffledItems(original,()=>0);assert.deepEqual(original,['Alpha','Beta','Gamma','Delta']);assert.deepEqual([...out].sort(),[...original].sort());assert.notDeepEqual(out,original)});
test('Schätz-Zielwert und Host-Erklärung vor Reveal privat',()=>{const q={...base,type:'estimate',estimateTarget:315.25,estimateUnit:'kg',explanation:'Geheimes Review'};const pub=publicQuestion(q,false);assert.equal(pub.estimateTarget,undefined);assert.equal(pub.answer,undefined);assert.equal(pub.explanation,undefined);assert.equal(pub.estimateUnit,'kg');assert.equal(publicQuestion(q,true).estimateTarget,315.25)});
test('Zitate und Emoji-Hinweise werden ohne Lösung verteilt',()=>{for(const type of ['quote','emoji']){const pub=publicQuestion({...base,type,clue:'🦊 🏹'},false);assert.equal(pub.clue,'🦊 🏹');assert.equal(pub.answer,undefined)}});
test('Host-Hinweise werden nur stufenweise veröffentlicht',()=>{const q={...base,type:'text'};for(const [count,visible] of [[0,0],[1,1],[2,2],[3,3]]){const p=publicQuestion(q,false,'',count);assert.equal(p.hints.length,visible);assert.equal(p.answer,undefined)}});
test('Sortierfragen brauchen einen Auftrag und mindestens zwei eindeutige Einträge',()=>{
 assert.match(validateQuestion({...base,type:'order',prompt:'',orderItems:['A','B']}),/Sortierauftrag/);
 assert.match(validateQuestion({...base,type:'order',orderItems:['A']}),/zwei/);
 assert.match(validateQuestion({...base,type:'order',orderItems:['A','B','a']}),/eindeutig/);
 assert.equal(validateQuestion({...base,type:'order',orderItems:['A','B']}),'');
});
test('eight sorting entries are shuffled without exposing the solution in the scene',()=>{
 const items=['Eins','Zwei','Drei','Vier','Fünf','Sechs','Sieben','Acht'];
 const source={...base,type:'order',prompt:'Kleinste Zahl zuerst.',orderItems:items};
 const q=normalizedQuiz({questions:[reconcileQuestion({...source,scene:templateScene('order',source)})]}).questions[0];
 assert.equal(q.roundMode,'written');
 assert.deepEqual(q.orderItems,items);
 const shuffled=shuffledOrderItems(items,n=>n-1);
 assert.notDeepEqual(shuffled,items);
 const guest=publicQuestion(q,false,shuffled);
 assert.equal(guest.prompt,source.prompt);
 assert.equal(guest.orderItems,undefined);
 assert.equal(guest.scene.sortCorrect,undefined);
 assert.deepEqual(guest.scene.elements.filter(el=>el.kind==='order').map(el=>el.text),shuffled);
 const encode=items.map(item=>String.fromCharCode(65+shuffled.indexOf(item))).join(' → ');
 assert.equal(orderResponseText(guest.displayItems,encode),items.join(' → '));
 for(const invalid of ['A → B','A → B → C → D → E → F → G → G','A → B → C → D → E → F → G → J']){
  assert.equal(orderResponseIndices(invalid,8),null);
 }
 assert.deepEqual(publicQuestion(q,true,shuffled).orderItems,items);
});
test('Fehlende Zitat-Hinweise und Rätselantworten werden erkannt',()=>{assert.match(validateQuestion({...base,type:'quote',clue:''}),/Zitat/);assert.match(validateQuestion({...base,type:'emoji',clue:'🦊',answer:''}),/Antwort-Tab/)});
test('Schätz-Ranking toleriert Komma und ignoriert kaputte Antworten',()=>{const guesses=[{uid:'a',text:'10',at:200},{uid:'b',text:'10,5',at:100},{uid:'c',text:'keine Ahnung',at:100},{uid:'d',text:'9,5',at:250}];const ranked=rankEstimates(guesses,10);assert.equal(ranked[0].uid,'a');assert.equal(ranked.length,3);assert.equal(ranked[1].uid,'b');assert.equal(ranked[2].uid,'d')});
test('Bildenthüllung skaliert monoton, nie vorzeitig volle Größe',()=>{for(const z of [3,5,8]){const x=[0,1,2].map(n=>splashStageZoom(z,n));assert.ok(x[0]>x[1]&&x[1]>x[2]&&x[2]>1)}});
test('Gegen HTML-Injektion in Zitat und Itemtiteln geschützt',()=>{const s='<svg onload=alert(1)>';assert.ok(!escapeHTML(s).includes('<svg'));assert.equal(escapeHTML(s),'&lt;svg onload=alert(1)&gt;')});

test('Audio-Originale und unsichere URLs nicht als Clip akzeptiert',()=>{const q=normalizedQuiz({questions:[{...base,type:'audio',audio:'https://secret.test/file.mp3'}]}).questions[0];assert.equal(q.audio,'');assert.match(validateQuestion(q),/Audioausschnitt/);assert.equal(isAudioData('data:audio/wav;base64,AAAA'),true);assert.equal(isAudioData('data:audio/svg+xml;base64,AAAA'),false)});
test('Audio wird erst mit aktiver Frage öffentlich, ohne Lösung',()=>{const q={...base,type:'audio',audio:'data:audio/wav;base64,AAAA'};const p=publicQuestion(q,false);assert.equal(p.audio,q.audio);assert.equal(p.answer,undefined);});
