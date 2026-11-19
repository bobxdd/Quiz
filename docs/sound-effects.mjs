/* Browser-local UI sound effects (not quiz audio). Purely synthesized: no external
 * media files, network requests or copyrighted recordings. */
export const DEFAULT_SFX_SETTINGS=Object.freeze({
 muted:false,master:35,buzz:42,correct:40,wrong:38
});
export const SFX_STORAGE_KEY='brainquiz-sfx-local-v1';
const KEYS=['master','buzz','correct','wrong'];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const SILENCE=.0001;
const CUES={
 // A sustained electric buzz with a brief contact click at the start.
 buzz:[
  {frequency:226,wave:'square',duration:.28,peak:.50,hold:.78},
  {frequency:473,wave:'triangle',duration:.26,peak:.21,hold:.62},
  {frequency:920,endFrequency:650,wave:'triangle',duration:.045,peak:.14}
 ],
 // A rising major chord, played as four short bell notes.
 correct:[
  {frequency:523.25,wave:'triangle',duration:.16,peak:.45},
  {frequency:659.25,wave:'triangle',delay:.085,duration:.17,peak:.46},
  {frequency:783.99,wave:'triangle',delay:.17,duration:.18,peak:.47},
  {frequency:1046.50,wave:'triangle',delay:.255,duration:.29,peak:.50,hold:.18}
 ],
 // A descending two-part signal, with a clear pause between its tones.
 wrong:[
  {frequency:392,endFrequency:277,wave:'triangle',duration:.12,peak:.58,hold:.55},
  {frequency:224,endFrequency:145,wave:'triangle',delay:.212,duration:.25,peak:.49,hold:.52},
  {frequency:238,endFrequency:155,wave:'sawtooth',delay:.212,duration:.23,peak:.24,hold:.45}
 ]
};
export function normalizeSfxSettings(value){
 const data=value&&typeof value==='object'?value:{};
 const settings={muted:data.muted===true};
 for(const key of KEYS){
  const n=Number(data[key]);
  settings[key]=data[key]===null||data[key]===undefined||data[key]===''||!Number.isFinite(n)?
   DEFAULT_SFX_SETTINGS[key]:clamp(Math.round(n),0,100);
 }
 return settings;
}
export function loadSfxSettings(storage){
 try{return normalizeSfxSettings(JSON.parse(storage?.getItem(SFX_STORAGE_KEY)||'null'));}
 catch{return normalizeSfxSettings(null);}
}
export function saveSfxSettings(storage,settings){
 try{storage?.setItem(SFX_STORAGE_KEY,JSON.stringify(normalizeSfxSettings(settings)));return true;}
 catch{return false;}
}
/** The context is started only in response to an actual user gesture.
 * In a page where autoplay remains blocked, cues are silently skipped instead
 * of queued and unexpectedly played later.
 */
export function createSoundEffects({storage,AudioContextClass}={}){
 const store=storage??(typeof localStorage==='undefined'?null:localStorage);
 const AudioCtor=AudioContextClass??(globalThis.AudioContext||globalThis.webkitAudioContext);
 let settings=loadSfxSettings(store),context=null,output=null;
 function values(){return {...settings};}
 function setVolume(key,value){
  if(!KEYS.includes(key))return values();
  settings=normalizeSfxSettings({...settings,[key]:value});
  saveSfxSettings(store,settings);return values();
 }
 function setMuted(muted){
  settings={...settings,muted:!!muted};saveSfxSettings(store,settings);return values();
 }
 async function unlock(){
  if(!AudioCtor)return false;
  try{
   context??=new AudioCtor();
   if(context.state==='closed')return false;
   if(context.state!=='running')await context.resume();
   return context.state==='running';
  }catch{return false;}
 }
 function connectEffects(){
  const compressor=context.createDynamicsCompressor();
  compressor.threshold.value=-5;
  compressor.knee.value=3;
  compressor.ratio.value=12;
  compressor.attack.value=.003;
  compressor.release.value=.085;
  compressor.connect(context.destination);
  return compressor;
 }
 function tone({frequency,wave,duration,peak,endFrequency,delay=0,hold=.14},start,level){
  const at=start+delay,amp=Math.max(SILENCE,peak*level);
  const osc=context.createOscillator(),gain=context.createGain();
  osc.type=wave;osc.frequency.setValueAtTime(frequency,at);
  if(endFrequency)osc.frequency.exponentialRampToValueAtTime(endFrequency,at+duration);
  gain.gain.setValueAtTime(SILENCE,at);
  gain.gain.exponentialRampToValueAtTime(amp,at+.007);
  gain.gain.exponentialRampToValueAtTime(Math.max(SILENCE,amp*hold),at+duration*.73);
  gain.gain.exponentialRampToValueAtTime(SILENCE,at+duration);
  osc.connect(gain);gain.connect(output);
  osc.start(at);osc.stop(at+duration+.008);
 }
 function play(key){
  if(!Object.hasOwn(CUES,key)||settings.muted||!settings.master||!settings[key])return false;
  if(!context||context.state!=='running')return false;
  const level=(settings.master/100)*(settings[key]/100);
  try{
   output??=connectEffects();
   const start=context.currentTime+.006;
   for(const voice of CUES[key])tone(voice,start,level);
   return true;
  }catch{return false;}
 }
 return {values,setVolume,setMuted,unlock,play};
}
