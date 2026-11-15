import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const script=readFileSync(new URL('../scripts/configure-pages.mjs',import.meta.url),'utf8');
function run(options={}){
 const dir=mkdtempSync(join(tmpdir(),'bq-p2p-pages-'));
 try{
  mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'docs'));
  writeFileSync(join(dir,'scripts/configure-pages.mjs'),script);
  for(const name of options.missing===true?['index.html','app.mjs']:['index.html','app.mjs','peer-client.mjs','sw.js']){
   writeFileSync(join(dir,'docs',name),name==='index.html'?'<!doctype html><main>Quiz</main>':'export default true;');
  }
  return spawnSync(process.execPath,[join(dir,'scripts/configure-pages.mjs')],{cwd:dir,env:{PATH:process.env.PATH},encoding:'utf8'});
 }finally{rmSync(dir,{recursive:true,force:true})}
}
test('GitHub-Pages-P2P-Build benötigt keinerlei Firebase-Variablen',()=>{const r=run();assert.equal(r.status,0);assert.match(r.stdout,/PeerJS WebRTC/)});
test('Build verweigert fehlendes PeerJS-Transportmodul',()=>{const r=run({missing:true});assert.notEqual(r.status,0);assert.match(r.stderr,/Fehlende GitHub-Pages-Datei/)});
test('Die Produktionsseite lädt keine Firebase-Konfiguration',()=>{const html=readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');assert.doesNotMatch(html,/firebase/i);assert.match(html,/\.\/app\.mjs/)});
test('Das Repo enthält keine eigenen Firebase-Admin- oder Datenbankregeln',()=>{for(const path of ['docs/firebase-client.mjs','docs/firebase-config.js','database.rules.json','firebase.json','.github/workflows/firebase-rules.yml'])assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path)});
