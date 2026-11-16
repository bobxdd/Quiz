/* Deep QA: syntax-check every shipped JS module, verify static dependencies
 * and offline shell references. No dependency install or network calls required. */
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,relative,dirname,extname} from 'node:path';

const root=process.cwd(),docs=resolve(root,'docs');
const files=readdirSync(docs,{recursive:true}).filter(p=>{
 const full=resolve(docs,p);
 return statSync(full).isFile();
});
const modules=files.filter(p=>/\.(?:mjs|js)$/.test(p));
const errors=[];
const toAbsolute=(file,p)=>resolve(dirname(resolve(docs,file)),p.split(/[?#]/)[0]);
let references=0;
for(const file of modules){
 const source=readFileSync(resolve(docs,file),'utf8');
 try{execFileSync(process.execPath,['--check',resolve(docs,file)],{stdio:'pipe'});}
 catch(e){errors.push('JavaScript-Syntaxfehler in '+file+': '+String(e.stderr||e).slice(0,180));}
 for(const m of source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?['"]([^'"]+)['"]/g)){
  const spec=m[1];
  if(!spec.startsWith('.'))continue;
  references++;
  if(!existsSync(toAbsolute(file,spec)))errors.push('Fehlender ESM-Import: '+file+' → '+spec);
 }
}
const html=readFileSync(resolve(docs,'index.html'),'utf8');
const linked=[...html.matchAll(/(?:src|href)="(\.[^"]+)"/g)].map(m=>m[1]);
for(const path of linked){references++;if(!existsSync(resolve(docs,path)))errors.push('Fehlendes HTML-Asset: '+path);}
const sw=readFileSync(resolve(docs,'sw.js'),'utf8');
const match=sw.match(/const ASSETS=\[([\s\S]*?)\];/);
if(!match)errors.push('Service-Worker-Shell-Liste fehlt.');
else{
 const assets=[...match[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
 const seen=new Set();
 for(const path of assets){
  references++;
  if(seen.has(path))errors.push('Doppelter Offline-Shell-Eintrag: '+path);
  seen.add(path);
  if(!path.startsWith('./')||!existsSync(resolve(docs,path)))errors.push('Fehlendes Offline-Asset: '+path);
 }
 for(const path of linked){
  if(!seen.has(path))errors.push('HTML referenziert nicht offline gespeichertes Asset: '+path);
 }
 for(const path of modules.filter(p=>p.endsWith('.mjs'))){
  if(!seen.has('./'+path))errors.push('ESM-Modul nicht im Offline-Shell-Cache: '+path);
 }
}
if(errors.length){
 for(const issue of errors)console.error('FAIL '+issue);
 process.exitCode=1;
}else console.log('PASS shipped modules: '+modules.length+', inspected asset/import references: '+references);
