/* BrainQuiz 1.9 — private host-only question journal, no guest data paths. */
const safe=(v,max=800)=>String(v??'').slice(0,max);
const safeRound=n=>Math.max(0,Math.min(9999999,Math.floor(Number(n)||0)));
export function solutionFor(question){
 if(!question)return '';
 if(question.type==='estimate')return [question.estimateTarget,question.estimateUnit].filter(x=>x!==undefined&&x!==null&&String(x)!=='').join(' ').slice(0,800);
 if(question.type==='multiple'){const idx=Math.max(0,Math.min(3,Number(question.correct)||0));return `${'ABCD'[idx]} · ${question.options?.[idx]||question.answer||''}`.slice(0,800);}
 if(question.type==='order')return (question.scene?.sortCorrect||[]).join(' → ').slice(0,800)||String(question.answer||'').slice(0,800);
 if(question.type==='imposter')return ['Passiv','Q','W','E','R'][Number(question.imposterIndex)||0]||String(question.answer||'');
 return safe(question.answer||'',800);
}
export function createHistoryEntry(question,round,askedAt=Date.now()){
 if(!question?.id)throw new Error('Frage benötigt eine ID.');
 return {questionId:safe(question.id,80),round:safeRound(round),category:safe(question.category||'',80),title:safe(question.title||'',120),prompt:safe(question.prompt||'',600),solution:solutionFor(question),points:Math.max(0,Math.min(10000,Number(question.points)||0)),askedAt:Math.max(0,Number(askedAt)||0)};
}
export function historyRows(history,answers,scores,people){
 const entries=Object.values(history||{}).filter(x=>x&&Number.isInteger(x.round)&&x.round>0&&x.questionId).sort((a,b)=>b.round-a.round);
 return entries.map(item=>{
  const round=String(item.round),submitted=answers?.[round]||{};
  const ids=new Set([...Object.keys(submitted),...Object.keys(scores||{}).filter(id=>scores[id]?.rounds?.[round])]);
  const participants=[...ids].map(id=>{
   const judgement=scores?.[id]?.rounds?.[round]||null;
   return {id,name:safe(people?.[id]?.name||submitted[id]?.name||id,28),answer:typeof submitted[id]?.text==='string'?safe(submitted[id].text):'',status:judgement?.result==='correct'?'correct':judgement?.result==='wrong'?'wrong':'open',delta:judgement&&Number.isFinite(Number(judgement.delta))?Number(judgement.delta):null};
  }).sort((a,b)=>a.name.localeCompare(b.name,'de'));
  return {...item,participants,submittedCount:Object.values(submitted).filter(v=>v&&typeof v.text==='string').length,correctCount:participants.filter(p=>p.status==='correct').length,wrongCount:participants.filter(p=>p.status==='wrong').length};
 });
}
export function responseStatus(status){return status==='correct'?{label:'Richtig',icon:'✓'}:status==='wrong'?{label:'Falsch',icon:'✕'}:{label:'Nicht bewertet',icon:'–'};}
export function csvSafeCell(value){const s=safe(value,1200);const guarded=/^[=+@\-\t\r]/.test(s)?"'"+s:s;return '"'+guarded.replaceAll('"','""')+'"';}
export function historyCsv(rows,solutionLookup={},metadataLookup={}){
 const lines=[['Runde','Kategorie','Frage','Punkte','Person','Antwort','Bewertung','Punkteänderung','Musterlösung','Antwortbild','Akzeptierte Varianten','Host-Notizen','Quelle','Patch / Bezugsjahr','Geprüft am']];
 for(const row of rows){
  const participants=row.participants.length?row.participants:[{name:'',answer:'',status:'open',delta:null}];
  const meta=Object.hasOwn(metadataLookup,row.questionId)?metadataLookup[row.questionId]:{};
  const solution=Object.hasOwn(solutionLookup,row.questionId)?solutionLookup[row.questionId]:row.solution||'';
  for(const p of participants){
   lines.push([row.round,row.category,row.prompt||row.title,row.points,p.name,p.answer,
    responseStatus(p.status).label,p.delta??'',solution,meta.answerImage?meta.answerImageAlt||'Enthalten':'',
    meta.acceptedAnswers,meta.hostNotes,meta.sourceUrl,meta.sourcePatch,meta.sourceCheckedOn]);
  }
 }
 return '\ufeff'+lines.map(line=>line.map(csvSafeCell).join(';')).join('\r\n');
}
