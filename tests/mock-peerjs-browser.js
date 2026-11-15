/* Browser test-only fake signaling + data transport across tabs of one origin.
 * NOT part of the production website; real transport uses PeerJS/WebRTC.
 */
(() => {
 class Emitter {
  constructor(){this.handlers=new Map()}
  on(key,fn){const h=this.handlers.get(key)||[];h.push(fn);this.handlers.set(key,h);return this}
  emit(key,...args){for(const fn of this.handlers.get(key)||[])fn(...args)}
 }
 class Conn extends Emitter {
  constructor(peer,to,cid){super();this.peer=peer;this.to=to;this.id=cid;this.connectionId=cid;this.open=false}
  send(value){if(!this.open)throw Error('RTC channel closed');this.peer.post({t:'data',to:this.to,cid:this.id,value})}
  close(){if(!this.open)return;this.open=false;this.peer.conns.delete(this.id);this.peer.post({t:'close',to:this.to,cid:this.id});queueMicrotask(()=>this.emit('close'))}
 }
 class Peer extends Emitter {
  constructor(id){super();this.id=id||('test-guest-'+Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join(''));this.conns=new Map();this.bc=new BroadcastChannel('brainquiz-test-peer-network');this.destroyed=false;
   this.bc.onmessage=({data:m})=>{
    if(!m||m.to!==this.id)return;
    if(m.t==='offer'){
     const c=new Conn(this,m.from,m.cid);this.conns.set(m.cid,c);this.emit('connection',c);c.open=true;
     this.post({t:'accept',to:m.from,cid:m.cid});
    }else if(m.t==='accept'){
     const c=this.conns.get(m.cid);if(c){c.open=true;queueMicrotask(()=>c.emit('open'))}
    }else if(m.t==='data'){
     const c=this.conns.get(m.cid);if(c?.open)queueMicrotask(()=>c.emit('data',m.value));
    }else if(m.t==='close'){
     const c=this.conns.get(m.cid);if(c){this.conns.delete(m.cid);c.open=false;queueMicrotask(()=>c.emit('close'))}
    }
   };
   setTimeout(()=>{if(!this.destroyed)this.emit('open',this.id)},18);
  }
  post(m){this.bc.postMessage({...m,from:this.id})}
  connect(to){const cid='chan-'+Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');const c=new Conn(this,to,cid);this.conns.set(cid,c);this.post({t:'offer',to,cid});return c}
  destroy(){if(this.destroyed)return;this.destroyed=true;for(const c of [...this.conns.values()])c.close();this.bc.close();this.emit('close')}
  reconnect(){setTimeout(()=>this.emit('open',this.id),0)}
 }
 globalThis.Peer=Peer;
})();
