import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mapMarkup} from '../docs/map-viewport.mjs';

const source=path=>readFileSync(new URL('../docs/'+path,import.meta.url),'utf8');

test('published map markers identify players by a number, name, team and accessible legend',()=>{
 const html=mapMarkup({prompt:'Wo?',visibleSolution:true,solution:{x:50,y:50},
  otherPins:[
   {x:20,y:30,name:'Alice & Bob',team:'t1',teamLabel:'Team Rot',number:1,distanceKm:0},
   {x:70,y:30,name:'Charlie',team:'t2',teamLabel:'Team Blau',number:2,distanceKm:120}
  ]});
 assert.match(html,/bq-map-pin-legend/);
 assert.match(html,/is-public is-team-t1/);
 assert.match(html,/is-public is-team-t2/);
 assert.match(html,/>1<\/span>/);
 assert.match(html,/>2<\/span>/);
 assert.match(html,/Alice &amp; Bob/);
 assert.match(html,/Team Rot/);
 assert.match(html,/Charlie/);
 assert.match(html,/120 km/);
 assert.match(html,/is-solution/);
 const unrevealed=mapMarkup({point:{x:10,y:10}});
 assert.match(unrevealed,/is-self/);
 assert.doesNotMatch(unrevealed,/is-public|bq-map-pin-legend|is-solution/);
 const malicious=mapMarkup({otherPins:[{x:50,y:50,name:'<img src=x onerror=alert(1)>',team:'t1'}]});
 assert.doesNotMatch(malicious,/<img src=x/);
 assert.match(malicious,/&lt;img/);
});

test('timed rounds show a host and guest countdown based on shared deadline',()=>{
 const app=source('app.mjs'),css=source('session-ui.css');
 assert.match(app,/function roundTimerMarkup\(\)/);
 assert.match(app,/\['question','paused'\]\.includes\(p\?\.phase\)/);
 assert.match(app,/roundTimerMarkup\(\)\}<\/div>/);
 assert.match(app,/id="clock" role="timer" aria-live="off"/);
 assert.match(app,/p\.phase==='paused'\?Number\(p\.pausedRemaining\)/);
 assert.match(app,/const seconds=Math\.max\(0,Math\.ceil\(remaining\/1000\)\)/);
 assert.match(css,/\.bq-round-countdown\.is-urgent/);
 assert.match(css,/\.bq-round-countdown\.is-paused/);
});

test('host review supports team switching and a non-scoring second answer verdict',()=>{
 const app=source('app.mjs');
 assert.match(app,/aria-label="Antworten nach Teams"/);
 assert.match(app,/case 'review-team-step'/);
 assert.match(app,/visibleEntries\.map/);
 assert.match(app,/shownVerdict=teamAlreadyJudged/);
 assert.match(app,/judgeAction=teamAlreadyJudged\?'mark-review':'judge-review'/);
 assert.match(app,/case 'mark-review-correct':case 'mark-review-wrong'/);
 const branch=app.slice(app.indexOf("case 'mark-review-correct'"),app.indexOf("case 'score-page'"));
 assert.match(branch,/game\.updateCurrent/);
 assert.doesNotMatch(branch,/game\.judgeWritten|game\.score\(|scores\[|updatePlayerScore/);
 // The WebRTC transport remains on the previously released PeerJS defaults.
 assert.match(source('peer-client.mjs'),/if\(!custom\)return \{debug:0\};/);
});
