const SUPABASE_URL = 'https://dwbwiotgvqygxpjrgivh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_v1O8gC6z36mCYVyDWsjkKw_2VSvV3BV';
const $ = id => document.getElementById(id);
const movie = $('movie'), embedPlayer = $('embedPlayer');
let sb, channel, roomCode = '', isHost = false, clientId = crypto.randomUUID();
let roomBusy = false, localObjectUrl = null, suppressSync = false;
let pc = null, localStream = null, remoteStream = null, peerClientId = null;
let pendingIce = [];

function toast(msg) { const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>t.classList.remove('show'),3200); }
function status(msg) { $('roomStatus').textContent=msg; }
function setConnected(ok) { $('connectionLabel').textContent=ok?'متصل':'آفلاین'; $('syncState').textContent=ok?'ON':'OFF'; $('syncState').style.color=ok?'#e2c47f':''; }
function showMovie(){ $('emptyScreen').classList.add('hidden'); }
function hidePlayers(){ movie.pause(); movie.classList.remove('visible'); embedPlayer.classList.remove('visible'); }
function setVideoSource(src,name='فیلم آماده پخش است'){ hidePlayers(); embedPlayer.src='about:blank'; movie.src=src; movie.classList.add('visible'); movie.load(); showMovie(); $('movieStatus').textContent=name; }
function aparatEmbed(raw){ try{const u=new URL(raw);if(!/(^|\.)aparat\.com$/i.test(u.hostname))return null;if(/\/video\/video\/embed\/videohash\//i.test(u.pathname))return raw;const m=u.pathname.match(/\/(?:v|video)\/([A-Za-z0-9_-]+)/i);return m?'https://www.aparat.com/video/video/embed/videohash/'+m[1]+'/vt/frame':null;}catch{return null;} }
function looksLikeDirectVideo(raw){try{return /\.(mp4|webm|ogg|ogv|m3u8|mpd)$/i.test(new URL(raw).pathname);}catch{return false;}}
function setEmbedSource(src,name='ویدئو از پلیر خارجی'){hidePlayers();movie.removeAttribute('src');movie.load();embedPlayer.src=src;embedPlayer.classList.add('visible');showMovie();$('movieStatus').textContent=name;}
function broadcast(event,payload){if(channel)channel.send({type:'broadcast',event,payload:{...payload,from:clientId}}).catch(e=>console.warn('broadcast',e));}
function loadMovieUrl(raw,notify=true){const url=raw.trim();if(!/^https?:\/\//i.test(url)){toast('لینک معتبر وارد کن');return;}const a=aparatEmbed(url);if(a)setEmbedSource(a,'آپارات');else if(looksLikeDirectVideo(url))setVideoSource(url,'فیلم از لینک مستقیم');else setEmbedSource(url,'پلیر خارجی؛ نمایش به اجازه سایت منبع بستگی دارد');if(notify)broadcast('movie',{url});}

/* More reliable remote playback feedback and metadata-safe synchronization */
function syncRemotePlayback(action,p){
  if(!movie.getAttribute('src'))return;
  const apply=()=>{
    suppressSync=true;
    if(Number.isFinite(p.time))movie.currentTime=p.time;
    const done=()=>{suppressSync=false;};
    if(action==='play'){
      const result=movie.play();
      if(result&&typeof result.catch==='function')result.catch(()=>toast('برای شروع فیلم، یک‌بار روی دکمه پخش بزنید.'));
    }else movie.pause();
    setTimeout(done,900);
  };
  if(movie.readyState>=1)apply();
  else movie.addEventListener('loadedmetadata',apply,{once:true});
}
movie.addEventListener('error',()=>{
  if(movie.getAttribute('src'))toast('این لینک روی دستگاه شما قابل پخش نیست؛ لینک مستقیم MP4 سازگار را امتحان کنید.');
});

function addMessage(text,mine,name=''){ $('chatEmpty').classList.add('hidden');const wrap=document.createElement('div');wrap.className='message '+(mine?'mine':'theirs');const sender=document.createElement('span');sender.className='sender';sender.textContent=name||(mine?'شما':'طرف مقابل');const body=document.createElement('div');body.textContent=text;const time=document.createElement('time');time.textContent=new Date().toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});wrap.append(sender,body,time);$('messages').appendChild(wrap);$('messages').scrollTop=$('messages').scrollHeight;}
function handleBroadcast(event,p){if(!p||p.from===clientId)return;
 if(event==='chat')addMessage(p.text,false);
 if(event==='movie'&&p.url){$('movieUrl').value=p.url;loadMovieUrl(p.url,false);toast('فیلم طرف مقابل بارگذاری شد');}
 if(event==='play')syncRemotePlayback('play',p);
 if(event==='pause')syncRemotePlayback('pause',p);
 if(event==='seek'&&movie.src){suppressSync=true;movie.currentTime=p.time||0;setTimeout(()=>suppressSync=false,400);}
 if(event==='signal'&&p.to===clientId)handleSignal(p);
}
async function ensureAuth(){if(!window.supabase)throw new Error('کتابخانه اتصال بارگذاری نشد؛ صفحه را تازه‌سازی کن.');sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true}});const {data:{session}}=await sb.auth.getSession();if(!session){const {error}=await sb.auth.signInAnonymously();if(error)throw error;}}
function randomRoom(){const b=new Uint8Array(12);crypto.getRandomValues(b);return 'ZR-'+Array.from(b,x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();}
async function enterRoom(code,host){if(channel){await sb.removeChannel(channel);channel=null;}roomCode=code;isHost=host;clientId=crypto.randomUUID();peerClientId=null;
 channel=sb.channel('room:'+code,{config:{private:true,broadcast:{ack:true,self:false},presence:{key:clientId}}});
 channel.on('broadcast',{event:'chat'},p=>handleBroadcast('chat',p.payload));
 for(const ev of ['movie','play','pause','seek','signal'])channel.on('broadcast',{event:ev},p=>handleBroadcast(ev,p.payload));
 channel.on('presence',{event:'sync'},()=>{const state=channel.presenceState();const ids=Object.keys(state).filter(x=>x!==clientId);peerClientId=ids[0]||null;setConnected(!!peerClientId);if(peerClientId)status('اتصال اتاق برقرار شد؛ چت و همگام‌سازی آماده است ❤️');else status(host?'اتاق ساخته شد؛ کد را برای زهرا بفرست و منتظر ورودش بمان.':'وارد اتاق شدی؛ منتظر حضور میزبان هستیم.');});
 const result=await new Promise((resolve,reject)=>{let settled=false;const timer=setTimeout(()=>{if(!settled){settled=true;reject(new Error('اتصال به اتاق زمان‌بر شد. تنظیمات Supabase را بررسی کن.'));}},15000);channel.subscribe(async s=>{if(s==='SUBSCRIBED'&&!settled){settled=true;clearTimeout(timer);try{await channel.track({clientId,joinedAt:Date.now()});resolve(true);}catch(e){reject(e);}}else if(s==='CHANNEL_ERROR'||s==='TIMED_OUT'||s==='CLOSED'){if(!settled){settled=true;clearTimeout(timer);reject(new Error('دسترسی اتاق رد شد؛ تنظیمات ورود ناشناس و سیاست‌های Realtime را بررسی کن.'));}}});});
 $('shareRow').classList.toggle('hidden',!host);if(host){$('myRoomCode').textContent=code;$('roomId').value=code;}setConnected(true);toast(host?'اتاق ساخته شد؛ کد را بفرست ❤️':'وارد اتاق شدی ❤️');return result;}
async function createRoom(){if(roomBusy)return;roomBusy=true;try{status('در حال آماده‌سازی اتصال امن...');await ensureAuth();const code=randomRoom();await enterRoom(code,true);}catch(e){console.error(e);status(e.message||'ساخت اتاق ناموفق بود.');toast(e.message||'خطا در اتصال');}finally{roomBusy=false;}}
async function joinRoom(){if(roomBusy)return;const code=$('roomId').value.trim().toUpperCase();if(!code)return toast('کد اتاق را وارد کن');roomBusy=true;try{status('در حال ورود به اتاق...');await ensureAuth();await enterRoom(code,false);}catch(e){console.error(e);status(e.message||'ورود ناموفق بود.');toast(e.message||'خطا در اتصال');}finally{roomBusy=false;}}
$('createRoom').onclick=createRoom;$('joinRoom').onclick=joinRoom;
$('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText($('myRoomCode').textContent);toast('کد اتاق کپی شد');}catch{toast('کد را دستی کپی کن');}};
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('linkPanel').classList.toggle('hidden',b.dataset.tab!=='link');$('filePanel').classList.toggle('hidden',b.dataset.tab!=='file');});
$('loadUrl').onclick=()=>{const u=$('movieUrl').value.trim();if(u)loadMovieUrl(u);else toast('لینک فیلم را وارد کن');};
$('movieFile').onchange=e=>{const f=e.target.files[0];if(!f)return;if(localObjectUrl)URL.revokeObjectURL(localObjectUrl);localObjectUrl=URL.createObjectURL(f);setVideoSource(localObjectUrl,f.name);toast('نفر دوم باید همان فایل را جداگانه انتخاب کند.');};
movie.addEventListener('play',()=>{if(!suppressSync)broadcast('play',{time:movie.currentTime});});
movie.addEventListener('pause',()=>{if(!suppressSync)broadcast('pause',{time:movie.currentTime});});
movie.addEventListener('seeked',()=>{if(!suppressSync)broadcast('seek',{time:movie.currentTime});});
$('messageForm').onsubmit=e=>{e.preventDefault();const i=$('messageInput'),msg=i.value.trim();if(!msg)return;if(!channel)return toast('اول وارد اتاق شو');addMessage(msg,true,'شما');broadcast('chat',{text:msg});i.value='';};
async function sendSignal(kind,data={}){if(!channel||!peerClientId)return;await channel.send({type:'broadcast',event:'signal',payload:{from:clientId,to:peerClientId,kind,...data}});}
async function makePeerConnection(){if(pc)return pc;pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]});remoteStream=new MediaStream();$('remoteVideo').srcObject=remoteStream;pc.ontrack=e=>e.streams[0].getTracks().forEach(t=>remoteStream.addTrack(t));pc.onicecandidate=e=>{if(e.candidate)sendSignal('ice',{candidate:e.candidate});};pc.onconnectionstatechange=()=>{if(pc&&['failed','disconnected','closed'].includes(pc.connectionState))toast('اتصال تماس قطع شد.');};if(localStream)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));return pc;}
async function handleSignal(p){try{if(p.kind==='offer'){if(pc)await closeCall(false);localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:!!p.video});$('localVideo').srcObject=localStream;$('localVideo').style.visibility=p.video?'visible':'hidden';await makePeerConnection();await pc.setRemoteDescription(p.description);for(const c of pendingIce.splice(0))await pc.addIceCandidate(c);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await sendSignal('answer',{description:pc.localDescription});setCallButtons(true);}
else if(p.kind==='answer'&&pc){await pc.setRemoteDescription(p.description);for(const c of pendingIce.splice(0))await pc.addIceCandidate(c);}
else if(p.kind==='ice'&&p.candidate){if(pc&&pc.remoteDescription)await pc.addIceCandidate(p.candidate);else pendingIce.push(p.candidate);}
else if(p.kind==='hangup')await closeCall(false);
}catch(e){console.error('Call signaling',e);toast('برقراری تماس ناموفق بود.');}}
function setCallButtons(active){$('startAudio').disabled=active;$('startVideo').disabled=active;$('endCall').disabled=!active;$('toggleMic').disabled=!active;$('toggleCamera').disabled=!active||!localStream?.getVideoTracks().length;}
async function startCall(video){try{if(!channel||!peerClientId)return toast('اول هر دو وارد یک اتاق شوید');if(pc)return toast('تماس در حال انجام است');localStream=await navigator.mediaDevices.getUserMedia({audio:true,video});$('localVideo').srcObject=localStream;$('localVideo').style.visibility=video?'visible':'hidden';await makePeerConnection();const offer=await pc.createOffer();await pc.setLocalDescription(offer);await sendSignal('offer',{description:pc.localDescription,video});setCallButtons(true);toast('درخواست تماس ارسال شد');}catch(e){console.error(e);toast('مجوز میکروفون/دوربین یا اتصال امن را بررسی کن.');await closeCall(false);}}
async function closeCall(notify=true){if(notify)await sendSignal('hangup');if(pc){pc.ontrack=null;pc.close();pc=null;}if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}$('localVideo').srcObject=null;$('remoteVideo').srcObject=null;remoteStream=null;pendingIce=[];setCallButtons(false);}
$('startAudio').onclick=()=>startCall(false);$('startVideo').onclick=()=>startCall(true);$('endCall').onclick=()=>closeCall(true);
$('toggleMic').onclick=()=>{const t=localStream?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;$('toggleMic').textContent=t.enabled?'🎙 قطع میکروفون':'🎙 روشن کردن میکروفون';}};
$('toggleCamera').onclick=()=>{const t=localStream?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;$('toggleCamera').textContent=t.enabled?'📷 خاموش کردن دوربین':'📷 روشن کردن دوربین';}};
$('themeInfo').onclick=()=>$('infoDialog').showModal();$('closeInfo').onclick=()=>$('infoDialog').close();
window.addEventListener('online',()=>{if(channel)status('اینترنت برگشت؛ وضعیت اتاق را بررسی می‌کنیم...');});
window.addEventListener('beforeunload',()=>{if(channel)channel.untrack();if(pc)pc.close();if(localStream)localStream.getTracks().forEach(t=>t.stop());if(localObjectUrl)URL.revokeObjectURL(localObjectUrl);});
