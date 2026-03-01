// ─────────────────────────────────────────────────────────────────────────────
// SARA v6.0 — Firebase Signaling + Raw WebRTC (no PeerJS)
// ─────────────────────────────────────────────────────────────────────────────
//
// SETUP (one time):
//  1. Go to https://console.firebase.google.com
//  2. Create a project (free)
//  3. Add a Web App → copy the firebaseConfig below
//  4. Go to Build → Realtime Database → Create database → Start in TEST MODE
//  5. Deploy these files to GitHub Pages
//
// ─────────────────────────────────────────────────────────────────────────────

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBjpAVzhN_FPcBvnSKeAV8uJ5tXZk9URSU",
  authDomain: "main-prod-5c92e.firebaseapp.com",
  databaseURL: "https://main-prod-5c92e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "main-prod-5c92e",
  storageBucket: "main-prod-5c92e.firebasestorage.app",
  messagingSenderId: "958395880276",
  appId: "1:958395880276:web:56635073fa9e1ba446aec1",
  measurementId: "G-9CQH2TH7W1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
// ─────────────────────────────────────────────────────────────────────────────

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: ['turn:openrelay.metered.ca:80',
             'turn:openrelay.metered.ca:443',
             'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject',
      credential: 'openrelayproject' }
  ]
};

// ── state ─────────────────────────────────────────────────────────────────────
let app, db;
let pc       = null;   // RTCPeerConnection
let localStream = null;
let remoteStream = null;
let upT      = null;
let t0       = null;
let unsubOffer = null;
let unsubAnswer = null;
let unsubICE = null;

// ── init firebase ─────────────────────────────────────────────────────────────
function initFirebase() {
  if (firebaseConfig.apiKey === 'PASTE_YOUR_API_KEY') {
    L('Firebase not configured!', 'err');
    L('Open main.js and paste your firebaseConfig', 'err');
    return false;
  }
  try {
    app = initializeApp(firebaseConfig);
    db  = getDatabase(app);
    L('Firebase connected', 'ok');
    return true;
  } catch(e) {
    L('Firebase init failed: ' + e.message, 'err');
    return false;
  }
}

// ── log ───────────────────────────────────────────────────────────────────────
function L(msg, t) {
  const el = document.getElementById('LOG');
  const d  = document.createElement('div');
  d.className = 'll';
  d.innerHTML = '<span class="lp">$</span><span class="l'+(t||'def')+'"> '+msg+'</span>';
  el.appendChild(d);
  while (el.children.length > 60) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// ── clock / uptime ────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2,'0');
setInterval(() => {
  const n = new Date();
  document.getElementById('CLK').textContent =
    pad(n.getHours())+':'+pad(n.getMinutes())+':'+pad(n.getSeconds());
}, 1000);

function startUp() {
  stopUp(); t0 = Date.now();
  upT = setInterval(() => {
    const e = Math.floor((Date.now()-t0)/1000);
    document.getElementById('su').textContent =
      pad(Math.floor(e/3600))+':'+pad(Math.floor(e%3600/60))+':'+pad(e%60);
  }, 1000);
}
function stopUp() { clearInterval(upT); document.getElementById('su').textContent='00:00:00'; t0=null; }

// ── status ────────────────────────────────────────────────────────────────────
function setLive(on, lbl) {
  document.getElementById('DOT').className = 'dot'+(on?' live':'');
  document.getElementById('LL').textContent = on ? (lbl||'LIVE') : 'OFFLINE';
  const ss = document.getElementById('ss');
  ss.textContent  = on ? (lbl||'LIVE') : 'OFFLINE';
  ss.style.color  = on ? 'var(--g)' : 'var(--r)';
  document.getElementById('sg').textContent = on ? 'STRONG' : '--';
  on ? startUp() : stopUp();
}

// ── mode ──────────────────────────────────────────────────────────────────────
function setMode(m) {
  const isB = m === 'b';
  document.getElementById('t-bcast').className = 'tab'+(isB?' on':'');
  document.getElementById('t-watch').className = 'tab'+(!isB?' on':'');
  document.getElementById('p-bcast').style.display = isB ? 'flex' : 'none';
  document.getElementById('p-watch').style.display = isB ? 'none' : 'flex';
  document.getElementById('sm').textContent = isB ? 'BROADCAST' : 'WATCH';
  L('mode: '+(isB?'BROADCAST':'WATCH'));
}

// ── attach remote stream to video ─────────────────────────────────────────────
function showStream(stream) {
  remoteStream = stream;
  L('tracks: '+stream.getTracks().map(t=>t.kind+'('+t.readyState+')').join(', '),'ok');

  const V  = document.getElementById('V');
  const NS = document.getElementById('NS');
  const PO = document.getElementById('PO');

  NS.style.display = 'none';
  V.srcObject = stream;
  V.muted = true;

  const p = V.play();
  if (p && p.then) {
    p.then(() => {
      L('▶ LIVE!', 'ok');
      PO.style.display = 'none';
      setLive(true, 'WATCHING');
    }).catch(err => {
      L('autoplay blocked — click CLICK TO PLAY', 'err');
      PO.style.display = 'flex';
      setLive(true, 'PAUSED');
    });
  } else {
    PO.style.display = 'none';
    setLive(true, 'WATCHING');
  }
}

// ── manual play ───────────────────────────────────────────────────────────────
document.getElementById('b-play').onclick = () => {
  if (!remoteStream) { L('no stream yet','err'); return; }
  const V  = document.getElementById('V');
  const PO = document.getElementById('PO');
  const NS = document.getElementById('NS');
  // Replace video element to force render
  const nv = document.createElement('video');
  nv.id='V'; nv.autoplay=true; nv.muted=true; nv.playsInline=true;
  nv.setAttribute('playsinline','');
  nv.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:1;display:block;';
  nv.srcObject = remoteStream;
  V.parentNode.replaceChild(nv, V);
  nv.play().then(() => {
    PO.style.display='none'; NS.style.display='none';
    setLive(true,'WATCHING'); L('manual play OK','ok');
  }).catch(e => L('play err: '+e.message,'err'));
};

// ── cleanup signaling listeners ────────────────────────────────────────────────
function cleanListeners() {
  if (unsubOffer)  { unsubOffer();  unsubOffer=null; }
  if (unsubAnswer) { unsubAnswer(); unsubAnswer=null; }
  if (unsubICE)    { unsubICE();    unsubICE=null; }
}

// ── close peer connection ──────────────────────────────────────────────────────
function closePc() {
  if (pc) { try { pc.close(); } catch(e){} pc=null; }
}

// ── stop everything ───────────────────────────────────────────────────────────
function stop() {
  cleanListeners();
  closePc();
  if (localStream)  { localStream.getTracks().forEach(t=>t.stop());  localStream=null; }
  if (remoteStream) { remoteStream.getTracks().forEach(t=>t.stop()); remoteStream=null; }
  const V = document.getElementById('V');
  if (V) V.srcObject = null;
  document.getElementById('NS').style.display = 'flex';
  document.getElementById('PO').style.display = 'none';
  setLive(false);
  L('stopped.','err');
  // Clean Firebase room
  const k = document.getElementById('KEY').value.trim();
  if (db && k) remove(ref(db, 'rooms/'+k)).catch(()=>{});
}

// ── create RTCPeerConnection ───────────────────────────────────────────────────
function makePc(roomKey, isCaller) {
  const p = new RTCPeerConnection(ICE_SERVERS);

  // Send our ICE candidates to Firebase
  p.onicecandidate = e => {
    if (!e.candidate) return;
    const path = isCaller
      ? 'rooms/'+roomKey+'/watcherICE'
      : 'rooms/'+roomKey+'/broadcasterICE';
    push(ref(db, path), e.candidate.toJSON()).catch(()=>{});
  };

  p.oniceconnectionstatechange = () => {
    L('ICE: '+p.iceConnectionState);
    if (p.iceConnectionState === 'connected' || p.iceConnectionState === 'completed') {
      L('ICE connected!', 'ok');
    }
    if (p.iceConnectionState === 'failed') {
      L('ICE failed — check both devices on same network','err');
    }
  };

  p.onconnectionstatechange = () => {
    L('PC state: '+p.connectionState);
  };

  // Receive remote stream (watcher side)
  p.ontrack = e => {
    L('ontrack fired! streams: '+e.streams.length,'ok');
    if (e.streams && e.streams[0]) {
      showStream(e.streams[0]);
    }
  };

  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// BROADCAST (phone side)
// ─────────────────────────────────────────────────────────────────────────────
async function broadcast(facing) {
  const k = document.getElementById('KEY').value.trim();
  if (!k) { L('enter room key first!','err'); return; }
  if (!initFirebase()) return;
  stop();

  L('requesting camera...');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing }, audio: true
    });
  } catch(e) {
    L('camera denied: '+e.message,'err');
    L('Settings > Browser > Camera > Allow','');
    return;
  }

  // Show own camera locally
  const V = document.getElementById('V');
  document.getElementById('NS').style.display = 'none';
  V.srcObject = localStream; V.muted = true; V.play().catch(()=>{});

  const tr = localStream.getVideoTracks()[0];
  if (tr) {
    const s = tr.getSettings();
    if (s.width) document.getElementById('RES').textContent = s.width+'x'+s.height;
  }

  setLive(true, 'BROADCASTING');
  L('camera OK. cleaning old room...','ok');

  // Clean any old signaling data
  await remove(ref(db, 'rooms/'+k)).catch(()=>{});

  L('waiting for watcher to join...','ok');

  // Watch for an answer from the watcher
  unsubAnswer = onValue(ref(db, 'rooms/'+k+'/answer'), async snap => {
    const data = snap.val();
    if (!data || !pc) return;
    if (pc.signalingState === 'have-local-offer') {
      L('answer received — setting remote description','ok');
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        L('remote desc set OK','ok');
      } catch(e) { L('setRemoteDesc err: '+e.message,'err'); }
    }
  });

  // Watch for ICE candidates from watcher
  unsubICE = onChildAdded(ref(db, 'rooms/'+k+'/watcherICE'), async snap => {
    const c = snap.val();
    if (!c || !pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch(e) { L('addICE err: '+e.message,'err'); }
  });

  // Watch for watcher joining (they write their presence)
  unsubOffer = onValue(ref(db, 'rooms/'+k+'/watcherReady'), async snap => {
    if (!snap.val()) return;
    L('watcher joined! creating offer...','ok');
    setLive(true, 'LIVE');

    closePc();
    pc = makePc(k, false); // broadcaster = not caller

    // Add local tracks
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    // Create offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await set(ref(db, 'rooms/'+k+'/offer'), { type: offer.type, sdp: offer.sdp });
      L('offer sent','ok');
    } catch(e) { L('offer err: '+e.message,'err'); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCH (PC side)
// ─────────────────────────────────────────────────────────────────────────────
async function watch() {
  const k = document.getElementById('KEY').value.trim();
  if (!k) { L('enter room key first!','err'); return; }
  if (!initFirebase()) return;
  stop();

  L('connecting to room "'+k+'"...');

  // Get a local audio stream for proper WebRTC negotiation
  let localAudio;
  try {
    localAudio = await navigator.mediaDevices.getUserMedia({audio:true, video:false});
  } catch(e) {
    localAudio = new MediaStream();
    L('no mic — using empty stream','');
  }

  pc = makePc(k, true); // watcher = caller

  // Add local audio (needed for proper offer/answer)
  localAudio.getTracks().forEach(t => pc.addTrack(t, localAudio));

  // Tell broadcaster we're ready
  await set(ref(db, 'rooms/'+k+'/watcherReady'), true);
  L('joined room. waiting for offer...','ok');

  // Listen for offer from broadcaster
  unsubOffer = onValue(ref(db, 'rooms/'+k+'/offer'), async snap => {
    const data = snap.val();
    if (!data || !pc) return;
    if (pc.signalingState !== 'stable') return;

    L('offer received — creating answer...','ok');
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await set(ref(db, 'rooms/'+k+'/answer'), { type: answer.type, sdp: answer.sdp });
      L('answer sent','ok');
    } catch(e) { L('answer err: '+e.message,'err'); }
  });

  // Listen for ICE candidates from broadcaster
  unsubICE = onChildAdded(ref(db, 'rooms/'+k+'/broadcasterICE'), async snap => {
    const c = snap.val();
    if (!c || !pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch(e) { L('addICE err: '+e.message,'err'); }
  });
}

// ── fullscreen ────────────────────────────────────────────────────────────────
document.getElementById('b-fs').onclick = () => {
  const el = document.getElementById('VBOX');
  if (!document.fullscreenElement) (el.requestFullscreen||el.webkitRequestFullscreen).call(el);
  else (document.exitFullscreen||document.webkitExitFullscreen).call(document);
};

// ── wire buttons ──────────────────────────────────────────────────────────────
const BTNS = {
  't-bcast': () => setMode('b'),
  't-watch':  () => setMode('w'),
  'b-back':   () => broadcast('environment'),
  'b-front':  () => broadcast('user'),
  'b-stopb':  () => stop(),
  'b-conn':   () => watch(),
  'b-stopw':  () => stop()
};
Object.entries(BTNS).forEach(([id,fn]) => {
  const el = document.getElementById(id);
  if (!el) { L('WARN: #'+id+' not found','err'); return; }
  el.addEventListener('click',    e => { e.stopPropagation(); fn(); });
  el.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); fn(); });
});

// ── typewriter ────────────────────────────────────────────────────────────────
const PH=['FIREBASE_SIGNALING','WEBRTC_DIRECT','SECURE_CHANNEL','CAM_BRIDGE'];
let pi=0,ci=0,del=false;
function tw() {
  const el=document.getElementById('tw'); if(!el)return;
  const c=PH[pi];
  if(!del){el.textContent=c.slice(0,++ci);if(ci===c.length){del=true;setTimeout(tw,2000);return;}}
  else{el.textContent=c.slice(0,--ci);if(ci===0){del=false;pi=(pi+1)%PH.length;}}
  setTimeout(tw,del?40:80);
}

// ── boot ──────────────────────────────────────────────────────────────────────
[
  {m:'SARA v6.0 — Firebase WebRTC', t:'ok'},
  {m:'no PeerJS — raw WebRTC + Firebase', t:'ok'},
  {m:'paste firebaseConfig in main.js first!', t:'err'},
  {m:'then deploy and reload', t:''},
].forEach((l,i) => setTimeout(()=>L(l.m,l.t), i*200));
tw();
