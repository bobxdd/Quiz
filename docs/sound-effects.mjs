/* Browser-local UI sound effects (not quiz audio). Purely synthesized: no external
 * media files, network requests or copyrighted recordings. */
export const DEFAULT_SFX_SETTINGS=Object.freeze({
 muted:false,master:35,buzz:42,correct:40,wrong:38
});
export const SFX_STORAGE_KEY='brainquiz-sfx-local-v1';
const KEYS=['master','buzz','correct','wrong'];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
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
 let settings=loadSfxSettings(store),context=null;
 function values(){return {...settings};}
 function setVolume(key,value){
  if(!KEYS.includes(key))return values();
  settings=normalizeSfxSettings({...settings,[key]:value});
  saveSfxSettings(store,settings);return values();
 }
 function setMuted(muted){
  settings={...settings,muted:!!muted};saveSfxSettings(store,settings);return values();
 }
 function unlock(){
  if(!AudioCtor)return false;
  try{
   context??=new AudioCtor();
   if(context.state==='suspended')void context.resume().catch(()=>{});
   return context.state==='running';
  }catch{return false;}
 }
 function tone(frequency,at,duration,type,amp,endFrequency){
  const osc=context.createOscillator(),gain=context.createGain();
  osc.type=type;osc.frequency.setValueAtTime(frequency,at);
  if(endFrequency&&endFrequency!==frequency)osc.frequency.exponentialRampToValueAtTime(endFrequency,at+duration);
  gain.gain.setValueAtTime(0.0001,at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.00011,amp),at+0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001,at+duration);
  osc.connect(gain);gain.connect(context.destination);
  osc.start(at);osc.stop(at+duration+0.009);
 }
 function play(key){
  if(!['buzz','correct','wrong'].includes(key)||settings.muted||!settings.master||!settings[key])return false;
  if(!context||context.state!=='running')return false;
  // Keep default cues intentionally soft. The user's per-cue + master sliders
  // multiply the peak: changing one effect never changes the audio quiz clip.
  const level=(settings.master/100)*(settings[key]/100);
  try{
   const now=context.currentTime+0.009;
   if(key==='buzz'){
    tone(260,now,.125,'triangle',.16*level,175);
   }else if(key==='correct'){
    tone(440,now,.102,'sine',.19*level,494);
    tone(660,now+.11,.17,'sine',.20*level,880);
   }else{
    tone(280,now,.11,'triangle',.14*level,235);
    tone(200,now+.12,.18,'triangle',.13*level,150);
   }
   return true;
  }catch{return false;}
 }
 return {values,setVolume,setMuted,unlock,play};
}
