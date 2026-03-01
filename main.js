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
//  SARA v8.0  —  Firebase Compat + Raw WebRTC  —  main.js
//  No ES modules, no imports. Works on GitHub Pages.
// =============================================================================
//
//  SETUP:
//  1. console.firebase.google.com → New project
//  2. Build → Realtime Database → Create → TEST MODE
//  3. Project Settings (gear) → Add Web App → copy firebaseConfig
//  4. Paste below, deploy all 3 files.
//
// =============================================================================

// ── PASTE YOUR FIREBASE CONFIG HERE ──────────────────────────────────────────
var firebaseConfig = {
  apiKey:            "PASTE_YOUR_API_KEY",
  authDomain:        "PASTE_YOUR_AUTH_DOMAIN",
  databaseURL:       "PASTE_YOUR_DATABASE_URL",
  projectId:         "PASTE_YOUR_PROJECT_ID",
  storageBucket:     "PASTE_YOUR_STORAGE_BUCKET",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId:             "PASTE_YOUR_APP_ID"
};
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
var unsubOffer   = null;
var unsubAnswer  = null;
var unsubICE     = null;

// ── Firebase init ─────────────────────────────────────────────────────────────
function initFirebase() {
  if (firebaseConfig.apiKey === 'PASTE_YOUR_API_KEY') {
    L('Firebase not configured!', 'err');
    L('Open main.js and paste your firebaseConfig', 'err');
    return false;
  }
  if (db) return true;
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    L('Firebase connected', 'ok');
    return true;
  } catch (e) {
    L('Firebase error: ' + e.message, 'err');
    return false;
  }
}

// ── Log ───────────────────────────────────────────────────────────────────────
function L(msg, type) {
  var el = document.getElementById('LOG');
  var d  = document.createElement('div');
  d.className = 'll';
  d.innerHTML = '<span class="lp">$</span><span class="l' + (type || 'def') + '"> ' + msg + '</span>';
  el.appendChild(d);
  while (el.children.length > 60) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

setInterval(function () {
  var n  = new Date();
  var el = document.getElementById('CLK');
  if (el) el.textContent = pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds());
}, 1000);

function startUptime() {
  stopUptime();
  startTime = Date.now();
  uptimeTimer = setInterval(function () {
    var e  = Math.floor((Date.now() - startTime) / 1000);
    var el = document.getElementById('su');
    if (el) el.textContent =
      pad(Math.floor(e / 3600)) + ':' +
      pad(Math.floor((e % 3600) / 60)) + ':' +
      pad(e % 60);
  }, 1000);
}

function stopUptime() {
  clearInterval(uptimeTimer);
  var el = document.getElementById('su');
  if (el) el.textContent = '00:00:00';
  startTime = null;
}

// ── Status ────────────────────────────────────────────────────────────────────
function setLive(on, label) {
  var dot = document.getElementById('DOT');
  var ll  = document.getElementById('LL');
  var ss  = document.getElementById('ss');
  var sg  = document.getElementById('sg');
  if (dot) dot.className  = 'dot' + (on ? ' live' : '');
  if (ll)  ll.textContent = on ? (label || 'LIVE') : 'OFFLINE';
  if (ss)  { ss.textContent = on ? (label || 'LIVE') : 'OFFLINE'; ss.style.color = on ? 'var(--green)' : 'var(--red)'; }
  if (sg)  sg.textContent = on ? 'STRONG' : '--';
  on ? startUptime() : stopUptime();
}

// ── Mode ──────────────────────────────────────────────────────────────────────
function setMode(m) {
  var b = (m === 'b');
  document.getElementById('t-bcast').className    = 'tab' + (b  ? ' on' : '');
  document.getElementById('t-watch').className    = 'tab' + (!b ? ' on' : '');
  document.getElementById('p-bcast').style.display = b  ? 'flex' : 'none';
  document.getElementById('p-watch').style.display = !b ? 'flex' : 'none';
  document.getElementById('sm').textContent       = b ? 'BROADCAST' : 'WATCH';
  L('mode: ' + (b ? 'BROADCAST' : 'WATCH'));
}

// ── Show remote stream ────────────────────────────────────────────────────────
function showStream(stream) {
  remoteStream = stream;
  L('tracks: ' + stream.getTracks().map(function (t) {
    return t.kind + '(' + t.readyState + ')';
  }).join(', '), 'ok');

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
      L('tap CLICK TO PLAY', 'err');
      PO.style.display = 'flex';
      setLive(true, 'PAUSED');
    });
  } else {
    PO.style.display = 'none';
    setLive(true, 'WATCHING');
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanListeners() {
  if (unsubOffer  && db) { /* Firebase compat listeners removed via .off() */ }
  unsubOffer = unsubAnswer = unsubICE = null;
}

function closePc() {
  if (pc) { try { pc.close(); } catch (e) {} pc = null; }
}

function stop() {
  // Detach Firebase listeners
  var k = document.getElementById('KEY').value.trim();
  if (db && k) {
    db.ref('rooms/' + k + '/answer').off();
    db.ref('rooms/' + k + '/watcherICE').off();
    db.ref('rooms/' + k + '/watcherReady').off();
    db.ref('rooms/' + k + '/offer').off();
    db.ref('rooms/' + k + '/broadcasterICE').off();
    db.ref('rooms/' + k).remove().catch(function () {});
  }
  cleanListeners();
  closePc();

  if (localStream)  { localStream.getTracks().forEach(function (t) { t.stop(); });  localStream  = null; }
  if (remoteStream) { remoteStream.getTracks().forEach(function (t) { t.stop(); }); remoteStream = null; }

  var V  = document.getElementById('V');
  var NS = document.getElementById('NS');
  var PO = document.getElementById('PO');
  if (V)  V.srcObject      = null;
  if (NS) NS.style.display = 'flex';
  if (PO) PO.style.display = 'none';

  setLive(false);
  L('stopped.', 'err');
}

// ── RTCPeerConnection factory ─────────────────────────────────────────────────
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
    if (conn.iceConnectionState === 'connected' || conn.iceConnectionState === 'completed') L('ICE OK!', 'ok');
    if (conn.iceConnectionState === 'failed') L('ICE failed — check network', 'err');
  };

  conn.ontrack = function (e) {
    L('track received!', 'ok');
    if (e.streams && e.streams[0]) showStream(e.streams[0]);
  };

  return conn;
}

// =============================================================================
//  BROADCAST (phone)
// =============================================================================
function broadcast(facingMode) {
  var k = document.getElementById('KEY').value.trim();
  if (!k) { L('enter a room key first!', 'err'); return; }
  if (!initFirebase()) return;
  stop();

  L('requesting camera...');
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
      return db.ref('rooms/' + k).remove();
    })
    .then(function () {
      L('waiting for viewer...', 'ok');

      db.ref('rooms/' + k + '/answer').on('value', function (snap) {
        var data = snap.val();
        if (!data || !pc || pc.signalingState !== 'have-local-offer') return;
        pc.setRemoteDescription(new RTCSessionDescription(data))
          .then(function () { L('remote desc set', 'ok'); })
          .catch(function (e) { L('setRemote err: ' + e.message, 'err'); });
      });

      db.ref('rooms/' + k + '/watcherICE').on('child_added', function (snap) {
        var c = snap.val();
        if (c && pc) pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {});
      });

      db.ref('rooms/' + k + '/watcherReady').on('value', function (snap) {
        if (!snap.val()) return;
        L('viewer joined! sending offer...', 'ok');
        setLive(true, 'LIVE');
        closePc();
        pc = makePc(k, false);
        localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
        pc.createOffer()
          .then(function (o) { return pc.setLocalDescription(o); })
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
      L('camera denied: ' + e.message, 'err');
      L('Go to browser settings and allow camera', '');
    });
}

// =============================================================================
//  WATCH (PC)
// =============================================================================
function watch() {
  var k = document.getElementById('KEY').value.trim();
  if (!k) { L('enter a room key first!', 'err'); return; }
  if (!initFirebase()) return;
  stop();

  L('joining room "' + k + '"...');

  var getAudio = navigator.mediaDevices
    ? navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(function () { return new MediaStream(); })
    : Promise.resolve(new MediaStream());

  getAudio.then(function (localAudio) {
    pc = makePc(k, true);
    localAudio.getTracks().forEach(function (t) { pc.addTrack(t, localAudio); });
    return db.ref('rooms/' + k + '/watcherReady').set(true);
  })
  .then(function () {
    L('waiting for broadcaster offer...', 'ok');

    db.ref('rooms/' + k + '/offer').on('value', function (snap) {
      var data = snap.val();
      if (!data || !pc || pc.signalingState !== 'stable') return;
      L('offer received — answering...', 'ok');
      pc.setRemoteDescription(new RTCSessionDescription(data))
        .then(function () { return pc.createAnswer(); })
        .then(function (a) { return pc.setLocalDescription(a); })
        .then(function () {
          return db.ref('rooms/' + k + '/answer').set({
            type: pc.localDescription.type,
            sdp:  pc.localDescription.sdp
          });
        })
        .then(function () { L('answer sent', 'ok'); })
        .catch(function (e) { L('answer err: ' + e.message, 'err'); });
    });

    db.ref('rooms/' + k + '/broadcasterICE').on('child_added', function (snap) {
      var c = snap.val();
      if (c && pc) pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {});
    });
  })
  .catch(function (e) { L('watch error: ' + e.message, 'err'); });
}

// ── Manual play button ────────────────────────────────────────────────────────
document.getElementById('b-play').addEventListener('click', function () {
  if (!remoteStream) { L('no stream yet', 'err'); return; }
  var V  = document.getElementById('V');
  var PO = document.getElementById('PO');
  var NS = document.getElementById('NS');
  var nv = document.createElement('video');
  nv.id = 'V'; nv.autoplay = true; nv.muted = true; nv.playsInline = true;
  nv.setAttribute('playsinline', '');
  nv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:1;display:block;';
  nv.srcObject = remoteStream;
  V.parentNode.replaceChild(nv, V);
  nv.play()
    .then(function () { PO.style.display = 'none'; NS.style.display = 'none'; setLive(true, 'WATCHING'); L('playing!', 'ok'); })
    .catch(function (e) { L('play err: ' + e.message, 'err'); });
});

// ── Fullscreen ────────────────────────────────────────────────────────────────
document.getElementById('b-fs').addEventListener('click', function () {
  var el = document.getElementById('VBOX');
  if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
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
  el.addEventListener('click',    function (e) { e.stopPropagation(); fn(); });
  el.addEventListener('touchend', function (e) { e.preventDefault();  e.stopPropagation(); fn(); });
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
  { m: 'SARA v8.0 — compat mode',      t: 'ok'  },
  { m: 'buttons wired OK',             t: 'ok'  },
  { m: 'paste firebaseConfig in main.js', t: 'err' },
  { m: 'then push to GitHub Pages',    t: ''    }
].forEach(function (line, i) {
  setTimeout(function () { L(line.m, line.t); }, i * 200);
});

typewriter();
