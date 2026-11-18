// Local signaling for tests. The data channel and ICE negotiation are native WebRTC.
(() => {
 class Emitter {
  constructor(){this.events=new Map();}
  on(name,handler){
   if(!this.events.has(name))this.events.set(name,[]);
   this.events.get(name).push(handler);
  }
  emit(name,value){for(const handler of this.events.get(name)||[])handler(value);}
 }

 class Connection extends Emitter {
  constructor(id){
   super();
   this.connectionId=id;
   this.peerConnection=new RTCPeerConnection({iceServers:[]});
   this.dataChannel=null;
   this.closed=false;
   this.peerConnection.onconnectionstatechange=()=>{
    if(this.peerConnection.connectionState==='failed')this.close();
   };
  }
  get open(){return !this.closed&&this.dataChannel?.readyState==='open';}
  use(channel){
   this.dataChannel=channel;
   channel.onopen=()=>this.emit('open');
   channel.onmessage=event=>this.emit('data',JSON.parse(event.data));
   channel.onerror=()=>this.close();
   channel.onclose=()=>this.close();
  }
  send(data){this.dataChannel.send(JSON.stringify(data));}
  close(){
   if(this.closed)return;
   this.closed=true;
   this.dataChannel?.close();
   this.peerConnection.close();
   this.emit('close');
  }
 }

 async function localDescription(connection,description){
  const pc=connection.peerConnection;
  await pc.setLocalDescription(description);
  if(pc.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{
   const finish=()=>{
    clearTimeout(timer);
    pc.removeEventListener('icegatheringstatechange',check);
   };
   const timer=setTimeout(()=>{finish();reject(Error('ICE gathering timed out'));},6000);
   const check=()=>{
    if(pc.iceGatheringState==='complete'){finish();resolve();}
   };
   pc.addEventListener('icegatheringstatechange',check);
  });
  return pc.localDescription.toJSON();
 }

 class BrowserTestPeer extends Emitter {
  constructor(id){
   super();
   this.id=id||crypto.randomUUID();
   this.connections=new Map();
   this.signaling=new BroadcastChannel('brainquiz-native-rtc-browser-test');
   this.signaling.onmessage=event=>{
    if(event.data.to===this.id)void this.receive(event.data).catch(error=>this.emit('error',error));
   };
   queueMicrotask(()=>this.emit('open',this.id));
  }
  signal(to,type,id,sdp){this.signaling.postMessage({from:this.id,to,type,id,sdp});}
  add(conn){
   this.connections.set(conn.connectionId,conn);
   conn.on('close',()=>this.connections.delete(conn.connectionId));
  }
  async receive({from,type,id,sdp}){
   if(type==='answer'){
    const conn=this.connections.get(id);
    if(conn)await conn.peerConnection.setRemoteDescription(sdp);
    return;
   }
   const conn=new Connection(id);
   this.add(conn);
   this.emit('connection',conn);
   conn.peerConnection.ondatachannel=event=>conn.use(event.channel);
   await conn.peerConnection.setRemoteDescription(sdp);
   const answer=await conn.peerConnection.createAnswer();
   this.signal(from,'answer',id,await localDescription(conn,answer));
  }
  connect(to){
   const conn=new Connection(crypto.randomUUID());
   this.add(conn);
   conn.use(conn.peerConnection.createDataChannel('brainquiz'));
   void conn.peerConnection.createOffer().then(offer=>localDescription(conn,offer)).then(
    sdp=>this.signal(to,'offer',conn.connectionId,sdp),error=>this.emit('error',error)
   );
   return conn;
  }
  reconnect(){this.emit('open',this.id);}
  destroy(){
   if(this.destroyed)return;
   this.destroyed=true;
   for(const conn of this.connections.values())conn.close();
   this.signaling.close();
   this.emit('close');
  }
 }
 globalThis.Peer=BrowserTestPeer;
})();
