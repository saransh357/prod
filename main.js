// =============================================================================
//  SARA v11.0 — Firebase Realtime DB Signaling + WebRTC
//  Plain JS, Firebase Compat SDK (loaded via HTML script tags)
// =============================================================================
//
//  FIREBASE SETUP (one-time, 5 minutes):
//  1. https://console.firebase.google.com → Add project
//  2. Left menu: Build → Realtime Database → Create database
//     → pick any region → Start in TEST MODE → Enable
//  3. Left menu: Project Settings (gear) → scroll to "Your apps"
//     → click </> → give app a name → Register app
//  4. Copy the firebaseConfig shown and paste it below
//  5. Push all 3 files to GitHub Pages — done!
//
// =============================================================================

(function () {
  'use strict';

  // ── PASTE YOUR FIREBASE CONFIG HERE ────────────────────────────────────────
  var FB_CONFIG = {
  apiKey: "AIzaSyBjpAVzhN_FPcBvnSKeAV8uJ5tXZk9URSU",
  authDomain: "main-prod-5c92e.firebaseapp.com",
  databaseURL: "https://main-prod-5c92e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "main-prod-5c92e",
  storageBucket: "main-prod-5c92e.firebasestorage.app",
  messagingSenderId: "958395880276",
  appId: "1:958395880276:web:56635073fa9e1ba446aec1",
  measurementId: "G-9CQH2TH7W1"
  };
  // ──────────────────────────────────────────────────────────────────────────

  var ICE = {
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

  // ── State ──────────────────────────────────────────────────────────────────
  var db          = null;
  var pc          = null;
  var localStream = null;
  var remoteStream= null;
  var timerID     = null;
  var t0          = null;
  var fbRefs      = [];   // all active firebase listeners for cleanup
  var QUALITY = 'ultra';

  // ── DOM shortcut ───────────────────────────────────────────────────────────
  function get(id) {
    var el = document.getElementById(id);
    if (!el) console.error('SARA: element #' + id + ' not found');
    return el;
  }

  // ── Log ────────────────────────────────────────────────────────────────────
  function L(msg, type) {
    var box = get('logBox');
    if (!box) return;
    var row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML =
      '<span class="log-pre">$</span>' +
      '<span class="c-' + (type || 'def') + '"> ' + msg + '</span>';
    box.appendChild(row);
    while (box.children.length > 80) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  // ── Uptime clock ───────────────────────────────────────────────────────────
  function pad(n) { return String(n).padStart(2, '0'); }

  setInterval(function () {
    var d = new Date();
    var el = get('clock');
    if (el) el.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }, 1000);

  function startUptime() {
    clearInterval(timerID);
    t0 = Date.now();
    timerID = setInterval(function () {
      var s = Math.floor((Date.now() - t0) / 1000);
      var el = get('stUptime');
      if (el) el.textContent =
        pad(Math.floor(s / 3600)) + ':' +
        pad(Math.floor((s % 3600) / 60)) + ':' +
        pad(s % 60);
    }, 1000);
  }

  function stopUptime() {
    clearInterval(timerID);
    var el = get('stUptime');
    if (el) el.textContent = '00:00:00';
  }

  // ── Status display ─────────────────────────────────────────────────────────
  function setStatus(on, label) {
    var dot   = get('dot');
    var lbl   = get('liveLabel');
    var stSt  = get('stStatus');
    var stSig = get('stSignal');
    if (dot)  dot.className  = 'dot' + (on ? ' live' : '');
    if (lbl)  lbl.textContent  = on ? (label || 'LIVE') : 'OFFLINE';
    if (stSt) { stSt.textContent = on ? (label || 'LIVE') : 'OFFLINE'; stSt.style.color = on ? 'var(--g)' : 'var(--r)'; }
    if (stSig) stSig.textContent = on ? 'STRONG' : '--';
    if (on) startUptime(); else stopUptime();
  }

  // ── Mode switch ────────────────────────────────────────────────────────────
  function setMode(mode) {
    var isBroadcast = (mode === 'broadcast');
    // tabs
    var tb = get('tabBroadcast');
    var tw = get('tabWatch');
    if (tb) tb.className = 'tab' + (isBroadcast ? ' tab-on' : '');
    if (tw) tw.className = 'tab' + (!isBroadcast ? ' tab-on' : '');
    // panels
    var pb = get('panelBroadcast');
    var pw = get('panelWatch');
    if (pb) pb.style.display = isBroadcast ? 'flex' : 'none';
    if (pw) pw.style.display = !isBroadcast ? 'flex' : 'none';
    // stat
    var stm = get('stMode');
    if (stm) stm.textContent = isBroadcast ? 'BROADCAST' : 'WATCH';
    L('mode: ' + (isBroadcast ? 'BROADCAST' : 'WATCH'));
  }

  // ── Firebase init ──────────────────────────────────────────────────────────
  function initDB() {
    if (db) return true;
    if (FB_CONFIG.apiKey === 'PASTE_YOUR_API_KEY') {
      L('Firebase not configured!', 'err');
      L('Open main.js → paste your firebaseConfig', 'err');
      return false;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
      db = firebase.database();
      L('Firebase connected', 'ok');
      return true;
    } catch (e) {
      L('Firebase error: ' + e.message, 'err');
      return false;
    }
  }

  // ── Firebase listener helpers ──────────────────────────────────────────────
  function fbOn(path, event, fn) {
    if (!db) return;
    var ref = db.ref(path);
    ref.on(event, fn);
    fbRefs.push({ ref: ref, event: event, fn: fn });
  }

  function fbOff() {
    fbRefs.forEach(function (item) {
      item.ref.off(item.event, item.fn);
    });
    fbRefs = [];
  }

  function fbSet(path, value) {
    if (!db) return Promise.reject('no db');
    return db.ref(path).set(value);
  }

  function fbRemove(path) {
    if (!db) return Promise.resolve();
    return db.ref(path).remove();
  }

  function fbPush(path, value) {
    if (!db) return;
    db.ref(path).push(value);
  }

  // ── Show remote stream ─────────────────────────────────────────────────────
  function showStream(stream) {
    remoteStream = stream;
    var tracks = stream.getTracks().map(function (t) {
      return t.kind + '(' + t.readyState + ')';
    }).join(', ');
    L('stream received: ' + tracks, 'ok');

    var vid   = get('videoEl');
    var ovNS  = get('ovNoSig');
    var ovP   = get('ovPlay');

    if (ovNS) ovNS.style.display = 'none';
    if (vid) {
      vid.srcObject = stream;
      vid.muted = true;
      vid.play()
        .then(function () {
          L('playing!', 'ok');
          if (ovP) ovP.style.display = 'none';
          setStatus(true, 'WATCHING');
        })
        .catch(function () {
          L('autoplay blocked — tap CLICK TO PLAY', 'err');
          if (ovP) ovP.style.display = 'flex';
          setStatus(true, 'PAUSED');
        });
    }
  }

  // ── Build RTCPeerConnection ────────────────────────────────────────────────
  function buildPC(roomKey, isCaller) {
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }

    pc = new RTCPeerConnection(ICE);

    pc.onicecandidate = function (evt) {
      if (!evt.candidate) return;
      // Caller = watcher, Callee = broadcaster
      var path = 'rooms/' + roomKey + '/' + (isCaller ? 'callerICE' : 'calleeICE');
      fbPush(path, evt.candidate.toJSON());
    };

    pc.oniceconnectionstatechange = function () {
      L('ICE: ' + pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        L('connection established!', 'ok');
      }
      if (pc.iceConnectionState === 'failed') {
        L('ICE failed — both devices must be on same network', 'err');
      }
    };

    pc.ontrack = function (evt) {
      L('track received!', 'ok');
      if (evt.streams && evt.streams[0]) showStream(evt.streams[0]);
    };

    return pc;
  }

  // ── Full stop & cleanup ────────────────────────────────────────────────────
  function stopAll() {
    fbOff();
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (localStream)  { localStream.getTracks().forEach(function (t) { t.stop(); });  localStream  = null; }
    if (remoteStream) { remoteStream.getTracks().forEach(function (t) { t.stop(); }); remoteStream = null; }

    var vid  = get('videoEl');
    var ovNS = get('ovNoSig');
    var ovP  = get('ovPlay');
    if (vid)  vid.srcObject     = null;
    if (ovNS) ovNS.style.display = 'flex';
    if (ovP)  ovP.style.display  = 'none';

    setStatus(false);
    L('stopped.', 'err');

    // Clean up Firebase room
    var key = get('roomKey') ? get('roomKey').value.trim() : '';
    if (key) fbRemove('rooms/' + key);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BROADCAST  (run on phone)
  // ═══════════════════════════════════════════════════════════════════════════
  function startBroadcast(facing) {
    var key = get('roomKey').value.trim();
    if (!key) { L('enter a room key first!', 'err'); return; }
    if (!initDB()) return;

    stopAll();
    L('getting camera (' + facing + ')...');

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing },
      audio: true
    })
    .then(function (stream) {
      localStream = stream;

      // Preview locally
      var vid  = get('videoEl');
      var ovNS = get('ovNoSig');
      if (ovNS) ovNS.style.display = 'none';
      if (vid)  { vid.srcObject = stream; vid.muted = true; vid.play().catch(function(){}); }

      var vt = stream.getVideoTracks()[0];
      if (vt) {
        var s = vt.getSettings();
        var resEl = get('res');
        if (s.width && resEl) resEl.textContent = s.width + 'x' + s.height;
      }

      setStatus(true, 'BROADCASTING');
      L('camera ready. clearing room...', 'ok');

      // Clear old signaling data, then listen
      fbRemove('rooms/' + key)
        .then(function () {
          L('waiting for viewer...', 'ok');

          // When viewer joins → create offer
          fbOn('rooms/' + key + '/viewerReady', 'value', function (snap) {
            if (!snap.val()) return;
            L('viewer connected! creating offer...', 'ok');
            setStatus(true, 'LIVE');

            buildPC(key, false);
            localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });

            pc.createOffer()
              .then(function (o)  { return pc.setLocalDescription(o); })
              .then(function ()   { return fbSet('rooms/' + key + '/offer', { type: pc.localDescription.type, sdp: pc.localDescription.sdp }); })
              .then(function ()   { L('offer sent', 'ok'); })
              .catch(function (e) { L('offer error: ' + e.message, 'err'); });
          });

          // Receive answer from viewer
          fbOn('rooms/' + key + '/answer', 'value', function (snap) {
            var d = snap.val();
            if (!d || !pc || pc.signalingState !== 'have-local-offer') return;
            pc.setRemoteDescription(new RTCSessionDescription(d))
              .then(function ()   { L('answer applied', 'ok'); })
              .catch(function (e) { L('answer error: ' + e.message, 'err'); });
          });

          // Receive ICE from viewer
          fbOn('rooms/' + key + '/callerICE', 'child_added', function (snap) {
            var c = snap.val();
            if (c && pc) pc.addIceCandidate(new RTCIceCandidate(c)).catch(function(){});
          });
        })
        .catch(function (e) { L('firebase error: ' + e.message, 'err'); });
    })
    .catch(function (e) {
      if (e.name === 'NotAllowedError') {
        L('camera permission denied!', 'err');
        L('tap the lock icon in browser → allow camera', '');
      } else {
        L('camera error: ' + e.message, 'err');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  WATCH  (run on PC)
  // ═══════════════════════════════════════════════════════════════════════════
  function startWatch() {
    var key = get('roomKey').value.trim();
    if (!key) { L('enter a room key first!', 'err'); return; }
    if (!initDB()) return;

    stopAll();
    L('joining room: ' + key + '...');

    // Get mic for proper WebRTC offer/answer (no camera popup on PC)
    var audioP = navigator.mediaDevices
      ? navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          .catch(function () { return new MediaStream(); })
      : Promise.resolve(new MediaStream());

    audioP.then(function (audio) {
      buildPC(key, true);
      audio.getTracks().forEach(function (t) { pc.addTrack(t, audio); });

      // Listen for offer from broadcaster
      fbOn('rooms/' + key + '/offer', 'value', function (snap) {
        var d = snap.val();
        if (!d || !pc || pc.signalingState !== 'stable') return;

        L('offer received — creating answer...', 'ok');
        pc.setRemoteDescription(new RTCSessionDescription(d))
          .then(function ()   { return pc.createAnswer(); })
          .then(function (a)  { return pc.setLocalDescription(a); })
          .then(function ()   { return fbSet('rooms/' + key + '/answer', { type: pc.localDescription.type, sdp: pc.localDescription.sdp }); })
          .then(function ()   { L('answer sent', 'ok'); })
          .catch(function (e) { L('answer error: ' + e.message, 'err'); });
      });

      // Receive ICE from broadcaster
      fbOn('rooms/' + key + '/calleeICE', 'child_added', function (snap) {
        var c = snap.val();
        if (c && pc) pc.addIceCandidate(new RTCIceCandidate(c)).catch(function(){});
      });

      // Tell broadcaster we are ready
      fbSet('rooms/' + key + '/viewerReady', true)
        .then(function () { L('waiting for broadcaster...', 'ok'); })
        .catch(function (e) { L('firebase error: ' + e.message, 'err'); });
    });
  }

  // ── Manual play button ─────────────────────────────────────────────────────
  function wirePlayBtn() {
    var btn = get('btnPlay');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!remoteStream) { L('no stream yet', 'err'); return; }
      var old  = get('videoEl');
      var ovNS = get('ovNoSig');
      var ovP  = get('ovPlay');
      var nv   = document.createElement('video');
      nv.id = 'videoEl'; nv.autoplay = true; nv.muted = true; nv.playsInline = true;
      nv.setAttribute('playsinline', '');
      nv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;display:block;';
      nv.srcObject = remoteStream;
      old.parentNode.replaceChild(nv, old);
      nv.play()
        .then(function () {
          if (ovP)  ovP.style.display  = 'none';
          if (ovNS) ovNS.style.display = 'none';
          setStatus(true, 'WATCHING');
          L('playing!', 'ok');
        })
        .catch(function (e) { L('play error: ' + e.message, 'err'); });
    });
  }

  // ── Fullscreen button ──────────────────────────────────────────────────────
  function wireFsBtn() {
    var btn = get('btnFs');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var box = get('vbox');
      if (!document.fullscreenElement) {
        (box.requestFullscreen || box.webkitRequestFullscreen).call(box);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      }
    });
  }

  // ── Wire all main buttons ──────────────────────────────────────────────────
  function wireButtons() {
    // Map of element ID → handler function
    var map = {
      'tabBroadcast': function () { setMode('broadcast'); },
      'tabWatch':     function () { setMode('watch'); },
      'btnBackCam':   function () { startBroadcast('environment'); },
      'btnFrontCam':  function () { startBroadcast('user'); },
      'btnStopB':     function () { stopAll(); },
      'btnConnect':   function () { startWatch(); },
      'btnStopW':     function () { stopAll(); }
    };

    var count = 0;
    Object.keys(map).forEach(function (id) {
      var el = get(id);
      if (!el) { L('ERROR: #' + id + ' missing from HTML!', 'err'); return; }
      var fn = map[id];
      // Both click and touchend — prevent double-fire with a flag
      var busy = false;
      function handle(e) {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        busy = true;
        setTimeout(function () { busy = false; }, 300);
        fn();
      }
      el.addEventListener('click', handle);
      el.addEventListener('touchend', handle);
      count++;
    });

    L('buttons wired: ' + count + '/7', count === 7 ? 'ok' : 'err');
  }

  // ── Typewriter ─────────────────────────────────────────────────────────────
  var TW_LIST = ['FIREBASE_SIGNALING', 'WEBRTC_P2P', 'SECURE_STREAM', 'SARA_V11'];
  var twIdx = 0, twCh = 0, twDel = false;

  function typewriter() {
    var el = document.getElementById('tw');
    if (!el) return;
    var str = TW_LIST[twIdx];
    if (!twDel) {
      el.textContent = str.slice(0, ++twCh);
      if (twCh === str.length) { twDel = true; setTimeout(typewriter, 2200); return; }
    } else {
      el.textContent = str.slice(0, --twCh);
      if (twCh === 0) { twDel = false; twIdx = (twIdx + 1) % TW_LIST.length; }
    }
    setTimeout(typewriter, twDel ? 38 : 76);
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  var fbLoaded = (typeof firebase !== 'undefined');

  var bootMsgs = [
    { m: 'SARA v11.0 booting...',                                     t: 'ok'  },
    { m: 'Firebase SDK: ' + (fbLoaded ? 'LOADED' : 'MISSING!'),      t: fbLoaded ? 'ok' : 'err' },
    { m: 'DOM ready',                                                  t: 'ok'  },
  ];

  bootMsgs.forEach(function (b, i) {
    setTimeout(function () { L(b.m, b.t); }, i * 150);
  });

  setTimeout(function () {
    wireButtons();
    wirePlayBtn();
    wireFsBtn();
    L('ready — enter room key and select mode', 'ok');
    typewriter();
  }, bootMsgs.length * 150 + 50);

})();
