// =============================================================================
//  SARA v10.0 — Copy-Paste WebRTC Signaling
//  NO server, NO Firebase, NO PeerJS needed.
//  Works on any device, any network.
//
//  HOW IT WORKS:
//  1. Phone creates an "offer" (text blob) → you copy it
//  2. You paste it on PC → PC creates an "answer" (text blob) → you copy it
//  3. You paste the answer back on phone → stream starts
//  Transfer via WhatsApp, SMS, email, or anything!
// =============================================================================

(function () {

  // ── Helpers ──────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function log(msg, type) {
    var box = $('log');
    var row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML = '<span class="log-pre">$</span><span class="' + (type || 'def') + '"> ' + msg + '</span>';
    box.appendChild(row);
    if (box.children.length > 80) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // ── Clock ──────────────────────────────────────────────────────────────────
  setInterval(function () {
    var d = new Date();
    $('clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }, 1000);

  var uptimer = null;
  var t0 = null;

  function startTimer() {
    stopTimer();
    t0 = Date.now();
    uptimer = setInterval(function () {
      var s = Math.floor((Date.now() - t0) / 1000);
      $('statUptime').textContent =
        pad(Math.floor(s / 3600)) + ':' +
        pad(Math.floor((s % 3600) / 60)) + ':' +
        pad(s % 60);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(uptimer);
    $('statUptime').textContent = '00:00:00';
    t0 = null;
  }

  // ── Live indicator ──────────────────────────────────────────────────────────
  function setLive(on, label) {
    $('liveDot').className = 'dot' + (on ? ' live' : '');
    $('liveLabel').textContent = on ? (label || 'LIVE') : 'OFFLINE';
    $('statStatus').textContent = on ? (label || 'LIVE') : 'OFFLINE';
    $('statStatus').style.color = on ? 'var(--g)' : 'var(--r)';
    if (on) startTimer(); else stopTimer();
  }

  // ── Step management ─────────────────────────────────────────────────────────
  function activateStep(stepId) {
    var steps = ['step1', 'step2', 'step3', 'pcStep1', 'pcStep2'];
    steps.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.classList.toggle('dimmed', id !== stepId);
    });
  }

  // ── ICE config ──────────────────────────────────────────────────────────────
  var ICE = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // ── State ────────────────────────────────────────────────────────────────────
  var pc          = null;
  var localStream = null;
  var remoteStream = null;

  // ── Destroy peer connection ──────────────────────────────────────────────────
  function destroyPc() {
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
  }

  // ── Show stream on video ─────────────────────────────────────────────────────
  function showStream(stream) {
    remoteStream = stream;
    var tracks = stream.getTracks().map(function (t) { return t.kind + '(' + t.readyState + ')'; }).join(', ');
    log('stream: ' + tracks, 'ok');

    var vid = $('videoEl');
    $('overlayNoSig').classList.add('hidden');
    vid.srcObject = stream;
    vid.muted = true;

    vid.play().then(function () {
      log('playing!', 'ok');
      $('overlayPlay').classList.add('hidden');
      setLive(true, 'WATCHING');
    }).catch(function () {
      log('tap CLICK TO PLAY', 'err');
      $('overlayPlay').classList.remove('hidden');
      setLive(true, 'PAUSED');
    });
  }

  // ── Build RTCPeerConnection ──────────────────────────────────────────────────
  function buildPc() {
    destroyPc();
    pc = new RTCPeerConnection(ICE);

    pc.oniceconnectionstatechange = function () {
      log('ICE: ' + pc.iceConnectionState);
      $('statIce').textContent = pc.iceConnectionState.toUpperCase();
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        log('connected!', 'ok');
        setLive(true, 'LIVE');
      }
    };

    pc.ontrack = function (evt) {
      log('track received!', 'ok');
      if (evt.streams && evt.streams[0]) showStream(evt.streams[0]);
    };

    return pc;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  PHONE FLOW
  // ══════════════════════════════════════════════════════════════════════════════

  function startCamera(facing) {
    log('requesting ' + facing + ' camera...');
    destroyPc();

    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: true })
      .then(function (stream) {
        localStream = stream;

        // Show preview
        var vid = $('videoEl');
        $('overlayNoSig').classList.add('hidden');
        vid.srcObject = localStream;
        vid.muted = true;
        vid.play().catch(function () {});

        var vt = stream.getVideoTracks()[0];
        if (vt) {
          var s = vt.getSettings();
          if (s.width) $('resolution').textContent = s.width + 'x' + s.height;
        }

        setLive(true, 'BROADCASTING');
        log('camera OK. building offer...', 'ok');

        // Build peer connection and offer
        buildPc();

        // Add local tracks
        localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });

        // Gather all ICE before creating offer (trickle-less for copy-paste)
        var candidates = [];
        pc.onicecandidate = function (e) {
          if (e.candidate) {
            candidates.push(e.candidate);
          } else {
            // All ICE gathered — serialize full offer with candidates
            var offerObj = {
              sdp: pc.localDescription,
              candidates: candidates.map(function (c) { return c.toJSON(); })
            };
            var offerStr = btoa(JSON.stringify(offerObj));
            $('offerOut').value = offerStr;
            activateStep('step2');
            log('offer ready — copy it and paste on PC', 'ok');
          }
        };

        pc.createOffer()
          .then(function (offer) {
            return pc.setLocalDescription(offer);
          })
          .then(function () {
            log('gathering ICE...', 'ok');
          })
          .catch(function (e) {
            log('offer error: ' + e.message, 'err');
          });
      })
      .catch(function (e) {
        log('camera denied: ' + e.message, 'err');
        log('allow camera in browser settings', '');
      });
  }

  function applyAnswer() {
    var raw = $('answerIn').value.trim();
    if (!raw) { log('paste the answer first!', 'err'); return; }
    if (!pc)  { log('start camera first!', 'err'); return; }

    try {
      var obj = JSON.parse(atob(raw));
      pc.setRemoteDescription(new RTCSessionDescription(obj.sdp))
        .then(function () {
          log('remote description set', 'ok');
          // Add candidates from PC
          var adds = (obj.candidates || []).map(function (c) {
            return pc.addIceCandidate(new RTCIceCandidate(c));
          });
          return Promise.all(adds);
        })
        .then(function () {
          log('ICE candidates added — waiting for stream...', 'ok');
          setLive(true, 'CONNECTING');
        })
        .catch(function (e) {
          log('apply answer error: ' + e.message, 'err');
        });
    } catch (e) {
      log('invalid answer text — did you copy it fully?', 'err');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  //  PC FLOW
  // ══════════════════════════════════════════════════════════════════════════════

  function applyOffer() {
    var raw = $('offerIn').value.trim();
    if (!raw) { log('paste the offer first!', 'err'); return; }

    try {
      var obj = JSON.parse(atob(raw));
      log('offer received — building answer...', 'ok');

      buildPc();

      // Gather ICE silently then produce answer
      var candidates = [];
      pc.onicecandidate = function (e) {
        if (e.candidate) {
          candidates.push(e.candidate);
        } else {
          // All ICE gathered
          var answerObj = {
            sdp: pc.localDescription,
            candidates: candidates.map(function (c) { return c.toJSON(); })
          };
          var answerStr = btoa(JSON.stringify(answerObj));
          $('answerOut').value = answerStr;
          activateStep('pcStep2');
          log('answer ready — copy it and paste on phone', 'ok');
        }
      };

      pc.setRemoteDescription(new RTCSessionDescription(obj.sdp))
        .then(function () {
          var adds = (obj.candidates || []).map(function (c) {
            return pc.addIceCandidate(new RTCIceCandidate(c));
          });
          return Promise.all(adds);
        })
        .then(function () { return pc.createAnswer(); })
        .then(function (answer) {
          return pc.setLocalDescription(answer);
        })
        .then(function () {
          log('gathering ICE...', 'ok');
        })
        .catch(function (e) {
          log('process offer error: ' + e.message, 'err');
        });
    } catch (e) {
      log('invalid offer text — did you copy it fully?', 'err');
    }
  }

  // ── Copy helpers ─────────────────────────────────────────────────────────────
  function copyText(textareaId, btnId) {
    var val = $(textareaId).value;
    if (!val) { log('nothing to copy yet', 'err'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(function () {
        log('copied to clipboard!', 'ok');
        var btn = $(btnId);
        var orig = btn.textContent;
        btn.textContent = '✓ COPIED!';
        setTimeout(function () { btn.textContent = orig; }, 2000);
      }).catch(function () { fallbackCopy(textareaId); });
    } else {
      fallbackCopy(textareaId);
    }
  }

  function fallbackCopy(textareaId) {
    var ta = $(textareaId);
    ta.select();
    ta.setSelectionRange(0, 99999);
    try {
      document.execCommand('copy');
      log('copied (fallback)', 'ok');
    } catch (e) {
      log('copy failed — select text manually', 'err');
    }
  }

  // ── Manual play button ────────────────────────────────────────────────────────
  $('btnPlay').addEventListener('click', function () {
    if (!remoteStream) { log('no stream yet', 'err'); return; }
    var old = $('videoEl');
    var nv  = document.createElement('video');
    nv.id = 'videoEl'; nv.autoplay = true; nv.muted = true; nv.playsInline = true;
    nv.setAttribute('playsinline', '');
    nv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;display:block;';
    nv.srcObject = remoteStream;
    old.parentNode.replaceChild(nv, old);
    nv.play().then(function () {
      $('overlayPlay').classList.add('hidden');
      $('overlayNoSig').classList.add('hidden');
      setLive(true, 'WATCHING');
      log('playing!', 'ok');
    }).catch(function (e) { log('play err: ' + e.message, 'err'); });
  });

  // ── Fullscreen ────────────────────────────────────────────────────────────────
  $('btnFs').addEventListener('click', function () {
    var box = $('vbox');
    if (!document.fullscreenElement) {
      (box.requestFullscreen || box.webkitRequestFullscreen).call(box);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
  });

  // ── Role switching ────────────────────────────────────────────────────────────
  function setRole(role) {
    if (role === 'phone') {
      $('rolePhone').className  = 'role-btn active';
      $('rolePC').className     = 'role-btn';
      $('phoneFlow').classList.remove('hidden');
      $('pcFlow').classList.add('hidden');
      $('statRole').textContent = 'PHONE';
      activateStep('step1');
      log('role: PHONE (broadcaster)', 'ok');
    } else {
      $('rolePhone').className  = 'role-btn';
      $('rolePC').className     = 'role-btn active';
      $('phoneFlow').classList.add('hidden');
      $('pcFlow').classList.remove('hidden');
      $('statRole').textContent = 'PC';
      activateStep('pcStep1');
      log('role: PC (viewer)', 'ok');
    }
  }

  // ── Wire buttons ──────────────────────────────────────────────────────────────
  var ACTIONS = {
    'rolePhone':      function () { setRole('phone'); },
    'rolePC':         function () { setRole('pc'); },
    'btnBackCam':     function () { startCamera('environment'); },
    'btnFrontCam':    function () { startCamera('user'); },
    'btnCopyOffer':   function () { copyText('offerOut', 'btnCopyOffer'); },
    'btnApplyAnswer': function () { applyAnswer(); activateStep('step3'); },
    'btnApplyOffer':  function () { applyOffer(); },
    'btnCopyAnswer':  function () { copyText('answerOut', 'btnCopyAnswer'); }
  };

  Object.keys(ACTIONS).forEach(function (id) {
    var btn = $(id);
    if (!btn) { log('WARN: #' + id + ' not in DOM', 'err'); return; }
    var fn = ACTIONS[id];
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
    btn.addEventListener('touchend', function (e) {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  });

  // ── Typewriter ────────────────────────────────────────────────────────────────
  var TW = ['MANUAL_SIGNALING', 'NO_SERVER_NEEDED', 'COPY_PASTE_WEBRTC', 'SARA_V10'];
  var twi = 0, twc = 0, twd = false;

  function typewriter() {
    var el = $('tw');
    if (!el) return;
    var s = TW[twi];
    if (!twd) {
      el.textContent = s.slice(0, ++twc);
      if (twc === s.length) { twd = true; setTimeout(typewriter, 2200); return; }
    } else {
      el.textContent = s.slice(0, --twc);
      if (twc === 0) { twd = false; twi = (twi + 1) % TW.length; }
    }
    setTimeout(typewriter, twd ? 38 : 76);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────────
  var BOOT = [
    { m: 'SARA v10.0 — copy-paste signaling', t: 'ok'  },
    { m: 'no server, no Firebase needed',     t: 'ok'  },
    { m: Object.keys(ACTIONS).length + ' buttons wired', t: 'ok' },
    { m: 'select PHONE or PC role to begin',  t: 'def' }
  ];

  BOOT.forEach(function (b, i) {
    setTimeout(function () { log(b.m, b.t); }, i * 180);
  });

  typewriter();

})(); // end IIFE — all functions are scoped, no global pollution
