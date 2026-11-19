import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lobbyRulesHTML} from '../docs/lobby-view.mjs';
import {lobbySnapshot,teamColor} from '../docs/lobby-model.mjs';
const app=readFileSync(new URL('../docs/app.mjs',import.meta.url),'utf8');

test('rules are public, accurate and visible before players mark ready',()=>{
 const data={public:{title:'LoL BrainQuiz',teams:{t1:'Rot',t2:'Blau'},
  scoreMode:'team',settings:{manualBuzzer:true},started:false,round:0,phase:'board',used:{}},
  roster:{anna:{team:'t1',name:'Anna'}},members:{anna:{ready:false,status:'approved'}},presence:{}};
 const rules=lobbyRulesHTML(lobbySnapshot(data));
 for(const phrase of ['Spielregeln und Punkte','ALLE Teams','halber Fragewert','Host bestätigt','nächsten Team'])
  assert.ok(rules.includes(phrase),phrase);
 assert.match(rules,/Joker und Sonderbonusfragen sind in diesen Standardregeln nicht aktiviert/);
 assert.ok(!rules.includes('TOP SECRET'));
 const individual=lobbyRulesHTML({scoreMode:'individual'});
 assert.match(individual,/Einzelwertung/);
 assert.doesNotMatch(individual,/Nächste.*Team/);
});

test('visual team identity never changes with leaderboard place',()=>{
 const first=teamColor('t1'),second=teamColor('t2');
 assert.notEqual(first,second);
 const fn=app.match(/function scores\(\)\{.*?\}\nfunction scoreControls\(/s)?.[0]||'';
 assert.ok(fn.includes('teamColor(id)'),fn.slice(0,350));
 assert.ok(!fn.includes('TEAM_COLORS[i%TEAM_COLORS.length]'));
});

test('gameflow explicitly labels completed vs unplayed questions, guards verdict and warns before early end',()=>{
 for(const phrase of ['Erst Buzzer bewerten','Frage als gespielt beenden',
   'Ungespielt zurücklegen','case \'cancel-question\':','case \'skip-turn\':',
   'Auswahlrecht weitergeben','noch nicht bereit','Fragen der aktuellen Runde sind noch ungespielt']){
  assert.ok(app.includes(phrase),'missing '+phrase);
 }
 assert.ok(app.includes('game.cancelQuestion(room'));
 assert.ok(app.includes('game.skipSelection(room'));
});
