const $=id=>document.getElementById(id);
let peer=null,conn=null,localStream=null,activeCall=null,isHost=false,suppressSync=false,localObjectUrl=null,callMode=null;
const movie=$('movie');
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
function status(msg){$('roomStatus').textContent=msg}
function setConnected(ok){$('connectionLabel').textContent=ok?'متصل':'آفلاین';$('syncState').textContent=ok?'ON':'OFF';$('syncState').style.color=ok?'#e2c47f':''}
function send(data){if(conn&&conn.open)conn.send(data)}
function showMovie(){$('emptyScreen').classList.add('hidden');movie.classList.add('visible')}
function setSource(src,name){movie.src=src;movie.load();showMovie();$('movieStatus').textContent=name||'فیلم آماده پخش است'}
function addMessage(text,mine,name=''){ $('chatEmpty').classList.add('hidden');const wrap=document.createElement('div');wrap.className='message '+(mine?'mine':'theirs');const sender=document.createElement('span');sender.className='sender';sender.textContent=name||(mine?'شما':'زهرا');const body=document.createElement('div');body.textContent=text;const time=document.createElement('time');time.textContent=new Date().toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});wrap.append(sender,body,time);$('messages').appendChild(wrap);$('messages').scrollTop=$('messages').scrollHeight}
function handleData(d){if(!d||!d.type)return;
 if(d.type==='play'){suppressSync=true;movie.currentTime=d.time||0;movie.play().catch(()=>{});setTimeout(()=>suppressSync=false,500)}
 if(d.type==='pause'){suppressSync=true;movie.pause();if(Number.isFinite(d.time))movie.currentTime=d.time;setTimeout(()=>suppressSync=false,500)}
 if(d.type==='seek'){suppressSync=true;movie.currentTime=d.time||0;setTimeout(()=>suppressSync=false,350)}
 if(d.type==='movie')toast('طرف مقابل فیلم را آماده کرده؛ شما هم همان فایل یا لینک را باز کنید.');
 if(d.type==='chat')addMessage(d.text,false,'زهرا');
}
function attachConnection(c){conn=c;c.on('open',()=>{setConnected(true);status('اتصال برقرار شد. چت و همگام‌سازی آماده است.');$('shareRow').classList.toggle('hidden',!isHost);toast('به اتاق وصل شدی ❤️')});c.on('data',handleData);c.on('close',()=>{setConnected(false);status('ارتباط قطع شد.')});c.on('error',e=>{console.error(e);toast('خطا در ارتباط اتاق')})}
function newPeer(){return new Promise((resolve,reject)=>{peer=new Peer();peer.on('open',id=>resolve(id));peer.on('error',reject);peer.on('connection',c=>{if(isHost)attachConnection(c)});peer.on('call',call=>{activeCall=call;const answer=localStream?call.answer(localStream):call.answer();call.on('stream',s=>{$('remoteVideo').srcObject=s});call.on('close',clearCallUI)})})}
function clearCallUI(){if(localStream)localStream.getTracks().forEach(t=>t.stop());localStream=null;$('localVideo').srcObject=null;$('remoteVideo').srcObject=null;$('startAudio').disabled=false;$('startVideo').disabled=false;$('endCall').disabled=true;$('toggleMic').disabled=true;$('toggleCamera').disabled=true;activeCall=null;callMode=null}
$('createRoom').onclick=async()=>{try{isHost=true;status('در حال ساخت اتاق...');const id=await newPeer();$('myRoomCode').textContent=id;$('shareRow').classList.remove('hidden');$('roomId').value=id;status('اتاق ساخته شد. کد را برای زهرا بفرست.')}catch(e){console.error(e);status('ساخت اتاق ناموفق بود؛ اینترنت را بررسی کنید.')}};
$('joinRoom').onclick=async()=>{const id=$('roomId').value.trim();if(!id)return toast('کد اتاق را وارد کن');try{isHost=false;status('در حال اتصال...');if(!peer)await newPeer();attachConnection(peer.connect(id,{reliable:true}))}catch(e){console.error(e);status('اتصال برقرار نشد. کد اتاق را بررسی کنید.')}};
$('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText($('myRoomCode').textContent);toast('کد اتاق کپی شد')}catch(e){toast('کد را دستی کپی کن')}};
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('linkPanel').classList.toggle('hidden',b.dataset.tab!=='link');$('filePanel').classList.toggle('hidden',b.dataset.tab!=='file')});
$('loadUrl').onclick=()=>{const u=$('movieUrl').value.trim();if(!u)return toast('لینک فیلم را وارد کن');if(!/^https?:\/\//i.test(u))return toast('لینک باید با https یا http شروع شود');setSource(u,'فیلم از لینک اینترنتی');send({type:'movie'})};
$('movieFile').onchange=e=>{const f=e.target.files[0];if(!f)return;if(localObjectUrl)URL.revokeObjectURL(localObjectUrl);localObjectUrl=URL.createObjectURL(f);setSource(localObjectUrl,f.name);send({type:'movie'})};
movie.addEventListener('play',()=>{if(!suppressSync)send({type:'play',time:movie.currentTime})});movie.addEventListener('pause',()=>{if(!suppressSync)send({type:'pause',time:movie.currentTime})});movie.addEventListener('seeked',()=>{if(!suppressSync)send({type:'seek',time:movie.currentTime})});
$('messageForm').onsubmit=e=>{e.preventDefault();const input=$('messageInput'),msg=input.value.trim();if(!msg)return;if(!conn||!conn.open)return toast('برای چت، اول هر دو وارد یک اتاق شوید');addMessage(msg,true,'شما');send({type:'chat',text:msg});input.value='';input.focus()};
async function startCall(video){try{if(!conn||!conn.open)return toast('اول به اتاق وصل شو');if(!peer)return toast('اتصال اتاق برقرار نیست');callMode=video?'video':'audio';localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:video});$('localVideo').srcObject=localStream;$('localVideo').style.visibility=video?'visible':'hidden';const remoteId=isHost?conn.peer:$('roomId').value.trim();activeCall=peer.call(remoteId,localStream);activeCall.on('stream',s=>{$('remoteVideo').srcObject=s});activeCall.on('close',clearCallUI);$('startAudio').disabled=true;$('startVideo').disabled=true;$('endCall').disabled=false;$('toggleMic').disabled=false;$('toggleCamera').disabled=!video;toast(video?'درخواست تماس تصویری ارسال شد':'درخواست تماس صوتی ارسال شد')}catch(e){console.error(e);toast('دسترسی میکروفون یا دوربین ممکن نشد. از HTTPS استفاده کنید.');clearCallUI()}}
$('startAudio').onclick=()=>startCall(false);$('startVideo').onclick=()=>startCall(true);
$('toggleMic').onclick=()=>{if(!localStream)return;const t=localStream.getAudioTracks()[0];if(t){t.enabled=!t.enabled;$('toggleMic').textContent=t.enabled?'🎙 قطع میکروفون':'🎙 روشن کردن میکروفون'}};
$('toggleCamera').onclick=()=>{if(!localStream)return;const t=localStream.getVideoTracks()[0];if(t){t.enabled=!t.enabled;$('toggleCamera').textContent=t.enabled?'📷 خاموش کردن دوربین':'📷 روشن کردن دوربین'}};
$('endCall').onclick=()=>{if(activeCall)activeCall.close();clearCallUI()};
$('themeInfo').onclick=()=>$('infoDialog').showModal();$('closeInfo').onclick=()=>$('infoDialog').close();
window.addEventListener('beforeunload',()=>{if(peer)peer.destroy();if(localObjectUrl)URL.revokeObjectURL(localObjectUrl)});
