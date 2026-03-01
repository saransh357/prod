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
// =============================================================================
//  SARA v7.0  —  Firebase WebRTC  —  main.js
// =============================================================================
//
//  SETUP (one time, 5 minutes):
//  1. Go to https://console.firebase.google.com
//  2. Create a new project (free)
//  3. Left sidebar → Build → Realtime Database → Create database → Test mode
//  4. Left sidebar → Project Settings (gear icon) → Add Web App → Register app
//  5. Copy the firebaseConfig object shown and paste it below
//  6. Deploy all 3 files to GitHub Pages
//
// =============================================================================

// =============================================================================

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

// ── App state ─────────────────────────────────────────────────────────────────
let app, db;
let pc           = null;
let localStream  = null;
let remoteStream = null;
let uptimeTimer  = null;
let startTime    = null;
let unsubOffer   = null;
let unsubAnswer  = null;
let unsubICE     = null;

// ── Firebase init ─────────────────────────────────────────────────────────────
function initFirebase() {
  if (firebaseConfig.apiKey === 'PASTE_YOUR_API_KEY') {
    L('Firebase not configured!', 'err');
    L('Open main.js and paste your firebaseConfig', 'err');
    return false;
  }
  if (app) return true; // already initialised
  try {
    app = initializeApp(firebaseConfig);
    db  = getDatabase(app);
    L('Firebase connected', 'ok');
    return true;
  } catch (e) {
    L('Firebase error: ' + e.message, 'err');
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');

function L(msg, type) {
  const el = document.getElementById('LOG');
  const d  = document.createElement('div');
  d.className = 'll';
  d.innerHTML =
    '<span class="lp">$</span>' +
    '<span class="l' + (type || 'def') + '"> ' + msg + '</span>';
  el.appendChild(d);
  while (el.children.length > 60) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

function setLive(on, label) {
  const dot = document.getElementById('DOT');
  const ll  = document.getElementById('LL');
  const ss  = document.getElementById('ss');
  const sg  = document.getElementById('sg');
  dot.className    = 'dot' + (on ? ' live' : '');
  ll.textContent   = on ? (label || 'LIVE') : 'OFFLINE';
  ss.textContent   = on ? (label || 'LIVE') : 'OFFLINE';
  ss.style.color   = on ? 'var(--green)' : 'var(--red)';
  sg.textContent   = on ? 'STRONG' : '--';
  on ? startUptime() : stopUptime();
}

function startUptime() {
  stopUptime();
  startTime = Date.now();
  uptimeTimer = setInterval(() => {
    const e = Math.floor((Date.now() - startTime) / 1000);
    document.getElementById('su').textContent =
      pad(Math.floor(e / 3600)) + ':' +
      pad(Math.floor((e % 3600) / 60)) + ':' +
      pad(e % 60);
  }, 1000);
}

function stopUptime() {
  clearInterval(uptimeTimer);
  document.getElementById('su').textContent = '00:00:00';
  startTime = null;
}

// Live clock
setInterval(() => {
  const n = new Date();
  document.getElementById('CLK').textContent =
    pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds());
}, 1000);

// ── Mode switching ────────────────────────────────────────────────────────────
function setMode(m) {
  const isBcast = m === 'b';
  document.getElementById('t-bcast').className = 'tab' + (isBcast  ? ' on' : '');
  document.getElementById('t-watch').className = 'tab' + (!isBcast ? ' on' : '');
  document.getElementById('p-bcast').style.display = isBcast  ? 'flex' : 'none';
  document.getElementById('p-watch').style.display = !isBcast ? 'flex' : 'none';
  document.getElementById('sm').textContent = isBcast ? 'BROADCAST' : 'WATCH';
  L('mode: ' + (isBcast ? 'BROADCAST' : 'WATCH'));
}

// ── Attach remote stream to video ─────────────────────────────────────────────
function showStream(stream) {
  remoteStream = stream;
  L('tracks: ' + stream.getTracks()
    .map(t => t.kind + '(' + t.readyState + ')').join(', '), 'ok');

  const V  = document.getElementById('V');
  const NS = document.getElementById('NS');
  const PO = document.getElementById('PO');

  NS.style.display = 'none';
  V.srcObject = stream;
  V.muted     = true;

  V.play()
    .then(() => {
      L('▶ LIVE!', 'ok');
      PO.style.display = 'none';
      setLive(true, 'WATCHING');
    })
    .catch(() => {
      L('tap CLICK TO PLAY button', 'err');
      PO.style.display = 'flex';
      setLive(true, 'PAUSED');
    });
}

// ── Manual play button ────────────────────────────────────────────────────────
document.getElementById('b-play').addEventListener('click', () => {
  if (!remoteStream) { L('no stream yet', 'err'); return; }

  const V  = document.getElementById('V');
  const PO = document.getElementById('PO');
  const NS = document.getElementById('NS');

  // Replace video element completely — most reliable fix for autoplay issues
  const nv = document.createElement('video');
  nv.id          = 'V';
  nv.autoplay    = true;
  nv.muted       = true;
  nv.playsInline = true;
  nv.setAttribute('playsinline', '');
  nv.style.cssText =
    'position:absolute;top:0;left:0;width:100%;height:100%;' +
    'object-fit:cover;z-index:1;display:block;';
  nv.srcObject = remoteStream;
  V.parentNode.replaceChild(nv, V);

  nv.play()
    .then(() => {
      PO.style.display = 'none';
      NS.style.display = 'none';
      setLive(true, 'WATCHING');
      L('manual play OK', 'ok');
    })
    .catch(e => L('play error: ' + e.message, 'err'));
});

// ── Stop / cleanup ────────────────────────────────────────────────────────────
function cleanListeners() {
  if (unsubOffer)  { unsubOffer();  unsubOffer  = null; }
  if (unsubAnswer) { unsubAnswer(); unsubAnswer = null; }
  if (unsubICE)    { unsubICE();    unsubICE    = null; }
}

function closePc() {
  if (pc) { try { pc.close(); } catch (e) {} pc = null; }
}

function stop() {
  cleanListeners();
  closePc();
  if (localStream)  { localStream.getTracks().forEach(t => t.stop());  localStream  = null; }
  if (remoteStream) { remoteStream.getTracks().forEach(t => t.stop()); remoteStream = null; }

  const V  = document.getElementById('V');
  const NS = document.getElementById('NS');
  const PO = document.getElementById('PO');
  if (V)  V.srcObject    = null;
  if (NS) NS.style.display = 'flex';
  if (PO) PO.style.display = 'none';

  setLive(false);
  L('stopped.', 'err');

  // Clean Firebase room
  const k = document.getElementById('KEY').value.trim();
  if (db && k) remove(ref(db, 'rooms/' + k)).catch(() => {});
}

// ── Create RTCPeerConnection ───────────────────────────────────────────────────
function makePeerConnection(roomKey, isCaller) {
  const connection = new RTCPeerConnection(ICE_CONFIG);

  // Send our ICE candidates to Firebase so the other peer can use them
  connection.onicecandidate = event => {
    if (!event.candidate) return;
    const path = isCaller
      ? 'rooms/' + roomKey + '/watcherICE'
      : 'rooms/' + roomKey + '/broadcasterICE';
    push(ref(db, path), event.candidate.toJSON()).catch(() => {});
  };

  connection.oniceconnectionstatechange = () => {
    L('ICE: ' + connection.iceConnectionState);
    if (connection.iceConnectionState === 'connected' ||
        connection.iceConnectionState === 'completed') {
      L('ICE connected!', 'ok');
    }
    if (connection.iceConnectionState === 'failed') {
      L('ICE failed — check network', 'err');
    }
  };

  // Receive remote stream (watcher side)
  connection.ontrack = event => {
    L('track received! streams: ' + event.streams.length, 'ok');
    if (event.streams && event.streams[0]) {
      showStream(event.streams[0]);
    }
  };

  return connection;
}

// =============================================================================
//  BROADCAST  (use on phone)
// =============================================================================
async function broadcast(facingMode) {
  const k = document.getElementById('KEY').value.trim();
  if (!k) { L('enter a room key first!', 'err'); return; }
  if (!initFirebase()) return;
  stop();

  L('requesting camera (' + facingMode + ')...');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode },
      audio: true
    });
  } catch (e) {
    L('camera denied: ' + e.message, 'err');
    L('Settings > Browser > Camera > Allow', '');
    return;
  }

  // Show local camera preview
  const V  = document.getElementById('V');
  const NS = document.getElementById('NS');
  NS.style.display = 'none';
  V.srcObject = localStream;
  V.muted = true;
  V.play().catch(() => {});

  const track = localStream.getVideoTracks()[0];
  if (track) {
    const s = track.getSettings();
    if (s.width) document.getElementById('RES').textContent = s.width + 'x' + s.height;
  }

  setLive(true, 'BROADCASTING');
  L('camera OK. cleaning old room...', 'ok');

  // Remove stale signaling data from previous sessions
  await remove(ref(db, 'rooms/' + k)).catch(() => {});

  L('waiting for viewer to connect...', 'ok');

  // Listen for an answer from the watcher
  unsubAnswer = onValue(ref(db, 'rooms/' + k + '/answer'), async snap => {
    const data = snap.val();
    if (!data || !pc) return;
    if (pc.signalingState === 'have-local-offer') {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        L('remote description set', 'ok');
      } catch (e) {
        L('setRemoteDescription error: ' + e.message, 'err');
      }
    }
  });

  // Listen for ICE candidates from the watcher
  unsubICE = onChildAdded(ref(db, 'rooms/' + k + '/watcherICE'), async snap => {
    const c = snap.val();
    if (!c || !pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
  });

  // When watcher signals they are ready, create an offer
  unsubOffer = onValue(ref(db, 'rooms/' + k + '/watcherReady'), async snap => {
    if (!snap.val()) return;
    L('viewer joined! creating offer...', 'ok');
    setLive(true, 'LIVE');

    closePc();
    pc = makePeerConnection(k, false); // broadcaster is not the caller

    // Add all local tracks to the connection
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await set(ref(db, 'rooms/' + k + '/offer'), {
        type: offer.type,
        sdp:  offer.sdp
      });
      L('offer sent to viewer', 'ok');
    } catch (e) {
      L('offer error: ' + e.message, 'err');
    }
  });
}

// =============================================================================
//  WATCH  (use on PC)
// =============================================================================
async function watch() {
  const k = document.getElementById('KEY').value.trim();
  if (!k) { L('enter a room key first!', 'err'); return; }
  if (!initFirebase()) return;
  stop();

  L('joining room "' + k + '"...');

  // Get local audio for proper WebRTC offer/answer (no video popup on PC)
  let localAudio;
  try {
    localAudio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    localAudio = new MediaStream(); // silent fallback
    L('no mic — using silent stream', '');
  }

  pc = makePeerConnection(k, true); // watcher is the caller

  // Add local audio tracks
  localAudio.getTracks().forEach(t => pc.addTrack(t, localAudio));

  // Signal broadcaster that we are ready
  await set(ref(db, 'rooms/' + k + '/watcherReady'), true);
  L('waiting for broadcaster offer...', 'ok');

  // Listen for offer from broadcaster
  unsubOffer = onValue(ref(db, 'rooms/' + k + '/offer'), async snap => {
    const data = snap.val();
    if (!data || !pc) return;
    if (pc.signalingState !== 'stable') return;

    L('offer received — creating answer...', 'ok');
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await set(ref(db, 'rooms/' + k + '/answer'), {
        type: answer.type,
        sdp:  answer.sdp
      });
      L('answer sent to broadcaster', 'ok');
    } catch (e) {
      L('answer error: ' + e.message, 'err');
    }
  });

  // Listen for ICE candidates from broadcaster
  unsubICE = onChildAdded(ref(db, 'rooms/' + k + '/broadcasterICE'), async snap => {
    const c = snap.val();
    if (!c || !pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
  });
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
document.getElementById('b-fs').addEventListener('click', () => {
  const el = document.getElementById('VBOX');
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
});

// ── Wire all buttons ──────────────────────────────────────────────────────────
const BUTTON_MAP = {
  't-bcast': () => setMode('b'),
  't-watch':  () => setMode('w'),
  'b-back':   () => broadcast('environment'),
  'b-front':  () => broadcast('user'),
  'b-stopb':  () => stop(),
  'b-conn':   () => watch(),
  'b-stopw':  () => stop()
};

Object.entries(BUTTON_MAP).forEach(([id, fn]) => {
  const el = document.getElementById(id);
  if (!el) { L('WARN: #' + id + ' not found', 'err'); return; }
  el.addEventListener('click',    e => { e.stopPropagation(); fn(); });
  el.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); fn(); });
});

// ── Typewriter animation ──────────────────────────────────────────────────────
const PHRASES = ['FIREBASE_SIGNALING', 'WEBRTC_DIRECT', 'SECURE_CHANNEL', 'CAM_BRIDGE_V2'];
let pIdx = 0, cIdx = 0, deleting = false;

function typewriter() {
  const el = document.getElementById('tw');
  if (!el) return;
  const current = PHRASES[pIdx];
  if (!deleting) {
    el.textContent = current.slice(0, ++cIdx);
    if (cIdx === current.length) { deleting = true; setTimeout(typewriter, 2000); return; }
  } else {
    el.textContent = current.slice(0, --cIdx);
    if (cIdx === 0) { deleting = false; pIdx = (pIdx + 1) % PHRASES.length; }
  }
  setTimeout(typewriter, deleting ? 40 : 80);
}

// ── Boot log ──────────────────────────────────────────────────────────────────
const BOOT = [
  { m: 'SARA v7.0 — Firebase WebRTC',    t: 'ok'  },
  { m: 'no PeerJS — raw WebRTC',         t: 'ok'  },
  { m: 'paste firebaseConfig in main.js',t: 'err' },
  { m: 'then deploy and open the site',  t: ''    },
];
BOOT.forEach((line, i) => setTimeout(() => L(line.m, line.t), i * 200));
typewriter();
