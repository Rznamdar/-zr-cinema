const $ = id => document.getElementById(id);
let peer = null, conn = null, localStream = null, activeCall = null;
let isHost = false, suppressSync = false, localObjectUrl = null, roomBusy = false;
const movie = $('movie');
const embedPlayer = $('embedPlayer');

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}
function status(msg) { $('roomStatus').textContent = msg; }
function setConnected(ok) {
  $('connectionLabel').textContent = ok ? 'متصل' : (peer?.open ? 'آماده اتصال' : 'آفلاین');
  $('syncState').textContent = ok ? 'ON' : 'OFF';
  $('syncState').style.color = ok ? '#e2c47f' : '';
}
function send(data) { if (conn?.open) conn.send(data); }
function showMovie() { $('emptyScreen').classList.add('hidden'); }
function hidePlayers() { movie.pause(); movie.classList.remove('visible'); embedPlayer.classList.remove('visible'); }
function setVideoSource(src, name = 'فیلم آماده پخش است') {
  hidePlayers(); embedPlayer.src = 'about:blank'; movie.src = src; movie.classList.add('visible'); movie.load(); showMovie();
  $('movieStatus').textContent = name;
}
function aparatEmbed(raw) {
  try {
    const u = new URL(raw);
    if (!/(^|\.)aparat\.com$/i.test(u.hostname)) return null;
    if (/\/video\/video\/embed\/videohash\//i.test(u.pathname)) return raw;
    const m = u.pathname.match(/\/(?:v|video)\/([A-Za-z0-9_-]+)/i);
    if (m) return `https://www.aparat.com/video/video/embed/videohash/${m[1]}/vt/frame`;
    return null;
  } catch { return null; }
}
function looksLikeDirectVideo(raw) {
  try {
    const p = new URL(raw).pathname.toLowerCase();
    return /\.(mp4|webm|ogg|ogv|m3u8|mpd)$/.test(p);
  } catch { return false; }
}
function setEmbedSource(src, name = 'ویدئو از پلیر خارجی') {
  hidePlayers(); movie.removeAttribute('src'); movie.load();
  embedPlayer.src = src; embedPlayer.classList.add('visible'); showMovie();
  $('movieStatus').textContent = name;
}
function loadMovieUrl(raw, notify = true) {
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) { toast('لینک باید با https یا http شروع شود'); return; }
  const aparat = aparatEmbed(url);
  if (aparat) setEmbedSource(aparat, 'آپارات');
  else if (looksLikeDirectVideo(url)) setVideoSource(url, 'فیلم از لینک مستقیم');
  else setEmbedSource(url, 'پلیر یا صفحه خارجی؛ اگر سایت اجازه Embed بدهد نمایش داده می‌شود');
  if (notify) send({ type: 'movie', url });
}
function addMessage(text, mine, name = '') {
  $('chatEmpty').classList.add('hidden');
  const wrap = document.createElement('div'); wrap.className = 'message ' + (mine ? 'mine' : 'theirs');
  const sender = document.createElement('span'); sender.className = 'sender'; sender.textContent = name || (mine ? 'شما' : 'طرف مقابل');
  const body = document.createElement('div'); body.textContent = text;
  const time = document.createElement('time'); time.textContent = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  wrap.append(sender, body, time); $('messages').appendChild(wrap); $('messages').scrollTop = $('messages').scrollHeight;
}
function handleData(d) {
  if (!d?.type) return;
  if (d.type === 'play' && movie.src) { suppressSync = true; movie.currentTime = d.time || 0; movie.play().catch(() => toast('برای پخش، یک بار روی دکمه پخش بزنید')); setTimeout(() => suppressSync = false, 700); }
  if (d.type === 'pause' && movie.src) { suppressSync = true; movie.pause(); if (Number.isFinite(d.time)) movie.currentTime = d.time; setTimeout(() => suppressSync = false, 500); }
  if (d.type === 'seek' && movie.src) { suppressSync = true; movie.currentTime = d.time || 0; setTimeout(() => suppressSync = false, 400); }
  if (d.type === 'movie' && d.url) { $('movieUrl').value = d.url; loadMovieUrl(d.url, false); toast('فیلم طرف مقابل بارگذاری شد'); }
  if (d.type === 'chat') addMessage(d.text, false);
}
function attachConnection(c) {
  if (conn && conn !== c) { try { conn.close(); } catch {} }
  conn = c; status('در حال برقراری ارتباط با اتاق...');
  const timeout = setTimeout(() => { if (!c.open) status('اتصال هنوز برقرار نشده؛ کد اتاق و اینترنت هر دو نفر را بررسی کنید.'); }, 12000);
  c.on('open', () => {
    clearTimeout(timeout); setConnected(true);
    status('اتصال برقرار شد؛ چت و همگام‌سازی ویدئوی مستقیم آماده است.');
    $('shareRow').classList.toggle('hidden', !isHost); toast('به اتاق وصل شدی ❤️');
  });
  c.on('data', handleData);
  c.on('close', () => { clearTimeout(timeout); setConnected(false); status('ارتباط اتاق قطع شد. صفحه را باز نگه دارید و دوباره تلاش کنید.'); });
  c.on('error', e => { clearTimeout(timeout); console.error('Data connection error:', e); setConnected(false); status('خطای اتصال: ' + (e?.type || e?.message || 'ارتباط ناموفق')) });
}
function destroyPeer() {
  if (activeCall) { try { activeCall.close(); } catch {} activeCall = null; }
  if (conn) { try { conn.close(); } catch {} conn = null; }
  if (peer) { try { peer.destroy(); } catch {} peer = null; }
  setConnected(false);
}
function createPeer() {
  return new Promise((resolve, reject) => {
    if (!window.Peer) return reject(new Error('کتابخانه PeerJS بارگذاری نشده؛ صفحه را تازه‌سازی کنید.'));
    peer = new Peer(undefined, {
      debug: 1,
      // Public STUN + TURN fallback helps devices behind restrictive NAT/mobile networks.
      config: { iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
      ] }
    });
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('مهلت اتصال به سرور اتاق تمام شد. VPN یا اینترنت را بررسی کنید.')); } }, 18000);
    peer.on('open', id => {
      $('connectionLabel').textContent = 'آماده اتصال';
      if (!settled) { settled = true; clearTimeout(timer); resolve(id); }
    });
    peer.on('connection', c => { if (isHost) attachConnection(c); });
    peer.on('call', async call => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!call.metadata?.video });
        localStream = stream; call.answer(stream); activeCall = call; setupCall(call, true);
      } catch (e) { console.error('Incoming call media error:', e); call.answer(); toast('برای تماس، مجوز میکروفون/دوربین لازم است.'); }
    });
    peer.on('disconnected', () => {
      $('connectionLabel').textContent = 'در حال بازیابی';
      status('ارتباط با سرور هماهنگی قطع شد؛ در حال تلاش برای بازیابی...');
      try { peer.reconnect(); } catch (e) { console.error('Peer reconnect failed:', e); }
    });
    peer.on('error', e => {
      console.error('Peer error:', e);
      if (e.type === 'peer-unavailable') { setConnected(false); status('این کد اتاق پیدا نشد؛ میزبان باید اول اتاق را بسازد و صفحه‌اش را باز نگه دارد.'); }
      const messages = { 'peer-unavailable': 'اتاق پیدا نشد یا میزبان آنلاین نیست.', 'network': 'ارتباط شبکه با سرور اتاق برقرار نشد.', 'server-error': 'سرور اتاق موقتاً پاسخ نمی‌دهد.', 'unavailable-id': 'این شناسه در دسترس نیست؛ یک اتاق تازه بسازید.' };
      status(messages[e.type] || ('خطای سرور اتاق: ' + (e.type || e.message || 'نامشخص')));
      if (!settled) { settled = true; clearTimeout(timer); reject(e); }
    });
  });
}
$('createRoom').onclick = async () => {
  if (roomBusy) return; roomBusy = true;
  try {
    destroyPeer(); isHost = true; status('در حال ساخت اتاق و اتصال به سرور...');
    const id = await createPeer();
    $('myRoomCode').textContent = id; $('roomId').value = id; $('shareRow').classList.remove('hidden');
    status('اتاق آماده است. همین کد را برای زهرا بفرست و صفحه را باز نگه دار.');
  } catch (e) { console.error(e); status(e.message || 'ساخت اتاق ناموفق بود؛ اینترنت را بررسی کنید.'); }
  finally { roomBusy = false; }
};
$('joinRoom').onclick = async () => {
  if (roomBusy) return; const id = $('roomId').value.trim();
  if (!id) return toast('کد اتاق را وارد کن'); roomBusy = true;
  try {
    destroyPeer(); isHost = false; status('در حال اتصال به سرور و ورود به اتاق...');
    await createPeer(); attachConnection(peer.connect(id, { reliable: true }));
  } catch (e) { console.error(e); status(e.message || 'ورود به اتاق ناموفق بود.'); }
  finally { roomBusy = false; }
};
$('copyCode').onclick = async () => { try { await navigator.clipboard.writeText($('myRoomCode').textContent); toast('کد اتاق کپی شد'); } catch { toast('کد را دستی کپی کن'); } };
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active')); b.classList.add('active');
  $('linkPanel').classList.toggle('hidden', b.dataset.tab !== 'link'); $('filePanel').classList.toggle('hidden', b.dataset.tab !== 'file');
});
$('loadUrl').onclick = () => { const u = $('movieUrl').value.trim(); if (!u) return toast('لینک فیلم را وارد کن'); loadMovieUrl(u); };
$('movieFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
  localObjectUrl = URL.createObjectURL(f); setVideoSource(localObjectUrl, f.name);
  toast('فایل فقط روی همین گوشی باز شد؛ نفر دوم باید همان فایل را جداگانه انتخاب کند.');
};
movie.addEventListener('play', () => { if (!suppressSync) send({ type: 'play', time: movie.currentTime }); });
movie.addEventListener('pause', () => { if (!suppressSync) send({ type: 'pause', time: movie.currentTime }); });
movie.addEventListener('seeked', () => { if (!suppressSync) send({ type: 'seek', time: movie.currentTime }); });
$('messageForm').onsubmit = e => {
  e.preventDefault(); const input = $('messageInput'), msg = input.value.trim(); if (!msg) return;
  if (!conn?.open) return toast('اول هر دو وارد یک اتاق شوید');
  addMessage(msg, true, 'شما'); send({ type: 'chat', text: msg }); input.value = ''; input.focus();
};
function setupCall(call, incoming = false) {
  call.on('stream', s => { $('remoteVideo').srcObject = s; });
  call.on('close', clearCallUI);
  call.on('error', e => { console.error('Call error:', e); toast('تماس قطع شد یا برقرار نشد.'); clearCallUI(); });
  $('startAudio').disabled = true; $('startVideo').disabled = true; $('endCall').disabled = false;
  $('toggleMic').disabled = false; $('toggleCamera').disabled = !(call.metadata?.video || localStream?.getVideoTracks().length);
  toast(incoming ? 'تماس وصل شد' : 'درخواست تماس ارسال شد');
}
function clearCallUI() {
  if (localStream) localStream.getTracks().forEach(t => t.stop()); localStream = null;
  $('localVideo').srcObject = null; $('remoteVideo').srcObject = null;
  $('startAudio').disabled = false; $('startVideo').disabled = false; $('endCall').disabled = true;
  $('toggleMic').disabled = true; $('toggleCamera').disabled = true; activeCall = null;
}
async function startCall(video) {
  try {
    if (!conn?.open) return toast('اول به اتاق وصل شو');
    if (!peer) return toast('اتصال اتاق برقرار نیست');
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    $('localVideo').srcObject = localStream; $('localVideo').style.visibility = video ? 'visible' : 'hidden';
    const remoteId = conn.peer;
    activeCall = peer.call(remoteId, localStream, { metadata: { video } }); setupCall(activeCall);
  } catch (e) { console.error('Outgoing call error:', e); toast('دسترسی میکروفون یا دوربین ممکن نشد؛ مجوزها و HTTPS را بررسی کنید.'); clearCallUI(); }
}
$('startAudio').onclick = () => startCall(false); $('startVideo').onclick = () => startCall(true);
$('toggleMic').onclick = () => { const t = localStream?.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; $('toggleMic').textContent = t.enabled ? '🎙 قطع میکروفون' : '🎙 روشن کردن میکروفون'; } };
$('toggleCamera').onclick = () => { const t = localStream?.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; $('toggleCamera').textContent = t.enabled ? '📷 خاموش کردن دوربین' : '📷 روشن کردن دوربین'; } };
$('endCall').onclick = () => { if (activeCall) activeCall.close(); clearCallUI(); };
$('themeInfo').onclick = () => $('infoDialog').showModal(); $('closeInfo').onclick = () => $('infoDialog').close();
window.addEventListener('beforeunload', () => { destroyPeer(); if (localObjectUrl) URL.revokeObjectURL(localObjectUrl); });
