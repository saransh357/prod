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
// =============================================================================
//  SARA v8.0  —  Firebase Compat SDK  —  Plain JavaScript, no modules
// =============================================================================
//
//  SETUP:
//  1. console.firebase.google.com → New project
//  2. Build → Realtime Database → Create → Test mode
//  3. Project Settings → Add Web App → copy firebaseConfig below
//  4. Push all 3 files to GitHub Pages
//
// =============================================================================

// ── PASTE YOUR FIREBASE CONFIG HERE ──────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

var ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username:   'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

// ── State ─────────────────────────────────────────────────────────────────────
var db           = null;
var pc           = null;
var localStream  = null;
var remoteStream = null;
var uptimeTimer  = null;
var startTime    = null;
var fbListeners  = [];

// ── Log ───────────────────────────────────────────────────────────────────────
function L(msg, type) {
  var el = document.getElementById('LOG');
  var d  = document.createElement('div');
  d.className = 'll';
  d.innerHTML =
    '<span class="lp">$</span>' +
    '<span class="l' + (type || 'def') + '"> ' + msg + '</span>';
  el.appendChild(d);
  while (el.children.length > 60) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

setInterval(function () {
  var n = new Date();
  document.getElementById('CLK').textContent =
    pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds());
}, 1000);

function startUptime() {
  stopUptime();
  startTime = Date.now();
  uptimeTimer = setInterval(function () {
    var e = Math.floor((Date.now() - startTime) / 1000);
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

// ── Status ────────────────────────────────────────────────────────────────────
function setLive(on, label) {
  document.getElementById('DOT').className = 'dot' + (on ? ' live' : '');
  document.getElementById('LL').textContent = on ? (label || 'LIVE') : 'OFFLINE';
  var ss = document.getElementById('ss');
  ss.textContent = on ? (label || 'LIVE') : 'OFFLINE';
  ss.style.color = on ? 'var(--green)' : 'var(--red)';
  document.getElementById('sg').textContent = on ? 'STRONG' : '--';
  if (on) startUptime(); else stopUptime();
}

// ── Mode switch ───────────────────────────────────────────────────────────────
function setMode(m) {
  var isBcast = (m === 'b');
  document.getElementById('t-bcast').className = 'tab' + (isBcast  ? ' on' : '');
  document.getElementById('t-watch').className = 'tab' + (!isBcast ? ' on' : '');
  document.getElementById('p-bcast').style.display = isBcast  ? 'flex' : 'none';
  document.getElementById('p-watch').style.display = !isBcast ? 'flex' : 'none';
  document.getElementById('sm').textContent = isBcast ? 'BROADCAST' : 'WATCH';
  L('mode: ' + (isBcast ? 'BROADCAST' : 'WATCH'));
}

// ── Firebase init ─────────────────────────────────────────────────────────────
function initFirebase() {
  if (FIREBASE_CONFIG.apiKey === 'PASTE_YOUR_API_KEY') {
    L('Firebase not configured!', 'err');
    L('Open main.js and paste your firebaseConfig', 'err');
    return false;
  }
  if (db) return true;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    L('Firebase connected', 'ok');
    return true;
  } catch (e) {
    L('Firebase error: ' + e.message, 'err');
    return false;
  }
}

// ── Firebase listener management ──────────────────────────────────────────────
function fbOn(path, event, fn) {
  var r = db.ref(path);
  r.on(event, fn);
  fbListeners.push({ r: r, event: event, fn: fn });
}

function fbOff() {
  fbListeners.forEach(function (l) { l.r.off(l.event, l.fn); });
  fbListeners = [];
}

// ── Show remote stream ────────────────────────────────────────────────────────
function showStream(stream) {
  remoteStream = stream;
  L('tracks: ' + stream.getTracks()
    .map(function (t) { return t.kind + '(' + t.readyState + ')'; })
    .join(', '), 'ok');

  var V  = document.getElementById('V');
  var NS = document.getElementById('NS');
  var PO = document.getElementById('PO');

  NS.style.display = 'none';
  V.srcObject = stream;
  V.muted = true;

  var p = V.play();
  if (p && p.then) {
    p.then(function () {
      L('LIVE!', 'ok');
      PO.style.display = 'none';
      setLive(true, 'WATCHING');
    }).catch(function () {
      L('tap the CLICK TO PLAY button', 'err');
      PO.style.display = 'flex';
      setLive(true, 'PAUSED');
    });
  } else {
    PO.style.display = 'none';
    setLive(true, 'WATCHING');
  }
}

// ── Manual play button ────────────────────────────────────────────────────────
document.getElementById('b-play').addEventListener('click', function () {
  if (!remoteStream) { L('no stream yet', 'err'); return; }

  var V  = document.getElementById('V');
  var PO = document.getElementById('PO');
  var NS = document.getElementById('NS');

  var nv = document.createElement('video');
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

  nv.play().then(function () {
    PO.style.display = 'none';
    NS.style.display = 'none';
    setLive(true, 'WATCHING');
    L('manual play OK', 'ok');
  }).catch(function (e) {
    L('play error: ' + e.message, 'err');
  });
});

// ── Stop / cleanup ────────────────────────────────────────────────────────────
function closePc() {
  if (pc) { try { pc.close(); } catch (e) {} pc = null; }
}

function stop() {
  fbOff();
  closePc();
  if (localStream)  { localStream.getTracks().forEach(function (t) { t.stop(); });  localStream  = null; }
  if (remoteStream) { remoteStream.getTracks().forEach(function (t) { t.stop(); }); remoteStream = null; }

  var V  = document.getElementById('V');
  var NS = document.getElementById('NS');
  var PO = document.getElementById('PO');
  if (V)  V.srcObject = null;
  if (NS) NS.style.display = 'flex';
  if (PO) PO.style.display = 'none';

  setLive(false);
  L('stopped.', 'err');

  var k = document.getElementById('KEY').value.trim();
  if (db && k) db.ref('rooms/' + k).remove().catch(function () {});
}

// ── Build RTCPeerConnection ───────────────────────────────────────────────────
function makePc(roomKey, isCaller) {
  var conn = new RTCPeerConnection(ICE_CONFIG);

  conn.onicecandidate = function (e) {
    if (!e.candidate) return;
    var path = isCaller
      ? 'rooms/' + roomKey + '/watcherICE'
      : 'rooms/' + roomKey + '/broadcasterICE';
    db.ref(path).push(e.candidate.toJSON()).catch(function () {});
  };

  conn.oniceconnectionstatechange = function () {
    L('ICE: ' + conn.iceConnectionState);
    if (conn.iceConnectionState === 'failed') L('ICE failed — check network', 'err');
  };

  conn.ontrack = function (e) {
    L('track received!', 'ok');
    if (e.streams && e.streams[0]) showStream(e.streams[0]);
  };

  return conn;
}

// =============================================================================
//  BROADCAST  (use on phone)
// =============================================================================
function broadcast(facingMode) {
  var k = document.getElementById('KEY').value.trim();
  if (!k) { L('enter a room key first!', 'err'); return; }
  if (!initFirebase()) return;
  stop();

  L('requesting camera (' + facingMode + ')...');

  navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode }, audio: true })
    .then(function (stream) {
      localStream = stream;

      var V  = document.getElementById('V');
      var NS = document.getElementById('NS');
      NS.style.display = 'none';
      V.srcObject = localStream;
      V.muted = true;
      V.play().catch(function () {});

      var track = localStream.getVideoTracks()[0];
      if (track) {
        var s = track.getSettings();
        if (s.width) document.getElementById('RES').textContent = s.width + 'x' + s.height;
      }

      setLive(true, 'BROADCASTING');
      L('camera OK. cleaning room...', 'ok');

      return db.ref('rooms/' + k).remove();
    })
    .then(function () {
      L('waiting for viewer...', 'ok');

      // Listen for viewer's answer
      fbOn('rooms/' + k + '/answer', 'value', function (snap) {
        var data = snap.val();
        if (!data || !pc) return;
        if (pc.signalingState === 'have-local-offer') {
          pc.setRemoteDescription(new RTCSessionDescription(data))
            .then(function () { L('remote desc set', 'ok'); })
            .catch(function (e) { L('setRemote err: ' + e.message, 'err'); });
        }
      });

      // Listen for viewer's ICE candidates
      fbOn('rooms/' + k + '/watcherICE', 'child_added', function (snap) {
        var c = snap.val();
        if (!c || !pc) return;
        pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {});
      });

      // When viewer is ready → send offer
      fbOn('rooms/' + k + '/watcherReady', 'value', function (snap) {
        if (!snap.val()) return;
        L('viewer joined! creating offer...', 'ok');
        setLive(true, 'LIVE');

        closePc();
        pc = makePc(k, false);
        localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });

        pc.createOffer()
          .then(function (offer) { return pc.setLocalDescription(offer); })
          .then(function () {
            return db.ref('rooms/' + k + '/offer').set({
              type: pc.localDescription.type,
              sdp:  pc.localDescription.sdp
            });
          })
          .then(function () { L('offer sent', 'ok'); })
          .catch(function (e) { L('offer err: ' + e.message, 'err'); });
      });
    })
    .catch(function (e) {
      L('error: ' + e.message, 'err');
      if (e.name === 'NotAllowedError') L('Settings > Camera > Allow', '');
    });
}

// =============================================================================
//  WATCH  (use on PC)
// =============================================================================
function watch() {
  var k = document.getElementById('KEY').value.trim();
  if (!k) { L('enter a room key first!', 'err'); return; }
  if (!initFirebase()) return;
  stop();

  L('joining room "' + k + '"...');

  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .catch(function () { return new MediaStream(); })
    .then(function (localAudio) {
      pc = makePc(k, true);
      localAudio.getTracks().forEach(function (t) { pc.addTrack(t, localAudio); });

      db.ref('rooms/' + k + '/watcherReady').set(true)
        .then(function () { L('waiting for broadcaster offer...', 'ok'); });

      // Listen for broadcaster's offer
      fbOn('rooms/' + k + '/offer', 'value', function (snap) {
        var data = snap.val();
        if (!data || !pc) return;
        if (pc.signalingState !== 'stable') return;

        L('offer received — answering...', 'ok');
        pc.setRemoteDescription(new RTCSessionDescription(data))
          .then(function () { return pc.createAnswer(); })
          .then(function (answer) { return pc.setLocalDescription(answer); })
          .then(function () {
            return db.ref('rooms/' + k + '/answer').set({
              type: pc.localDescription.type,
              sdp:  pc.localDescription.sdp
            });
          })
          .then(function () { L('answer sent', 'ok'); })
          .catch(function (e) { L('answer err: ' + e.message, 'err'); });
      });

      // Listen for broadcaster's ICE candidates
      fbOn('rooms/' + k + '/broadcasterICE', 'child_added', function (snap) {
        var c = snap.val();
        if (!c || !pc) return;
        pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {});
      });
    });
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
document.getElementById('b-fs').addEventListener('click', function () {
  var el = document.getElementById('VBOX');
  if (!document.fullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }
});

// ── Wire all buttons ──────────────────────────────────────────────────────────
var BUTTONS = {
  't-bcast': function () { setMode('b'); },
  't-watch':  function () { setMode('w'); },
  'b-back':   function () { broadcast('environment'); },
  'b-front':  function () { broadcast('user'); },
  'b-stopb':  function () { stop(); },
  'b-conn':   function () { watch(); },
  'b-stopw':  function () { stop(); }
};

Object.keys(BUTTONS).forEach(function (id) {
  var el = document.getElementById(id);
  if (!el) { console.warn('Button not found: #' + id); return; }
  var fn = BUTTONS[id];
  el.addEventListener('click', function (e) {
    e.stopPropagation();
    fn();
  });
  el.addEventListener('touchend', function (e) {
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
});

// ── Typewriter ────────────────────────────────────────────────────────────────
var PHRASES = ['FIREBASE_SIGNALING', 'WEBRTC_DIRECT', 'SECURE_CHANNEL', 'CAM_BRIDGE'];
var pIdx = 0, cIdx = 0, deleting = false;

function typewriter() {
  var el = document.getElementById('tw');
  if (!el) return;
  var cur = PHRASES[pIdx];
  if (!deleting) {
    el.textContent = cur.slice(0, ++cIdx);
    if (cIdx === cur.length) { deleting = true; setTimeout(typewriter, 2000); return; }
  } else {
    el.textContent = cur.slice(0, --cIdx);
    if (cIdx === 0) { deleting = false; pIdx = (pIdx + 1) % PHRASES.length; }
  }
  setTimeout(typewriter, deleting ? 40 : 80);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
[
  { m: 'SARA v8.0 ready',              t: 'ok'  },
  { m: 'buttons wired OK',             t: 'ok'  },
  { m: 'Firebase compat SDK loaded',   t: 'ok'  },
  { m: 'paste firebaseConfig to begin',t: 'err' }
].forEach(function (line, i) {
  setTimeout(function () { L(line.m, line.t); }, i * 200);
});

typewriter();
