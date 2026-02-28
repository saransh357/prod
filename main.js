// ── State ─────────────────────────────────────────────────────────────────────
var peer          = null;
var currentStream = null;
var activeCall    = null;
var mode          = 'broadcast';
var startTime     = null;
var uptimeTimer   = null;
var retryTimeout  = null;
var retryCount    = 0;
var MAX_RETRIES   = 5;

var PEER_CONFIG = {
    debug: 0,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            // Free TURN relay — required when phone & PC are on different subnets
            {
                urls: [
                    'turn:openrelay.metered.ca:80',
                    'turn:openrelay.metered.ca:80?transport=tcp',
                    'turn:openrelay.metered.ca:443',
                    'turn:openrelay.metered.ca:443?transport=tcp'
                ],
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function forcePlayVideo(stream) {
    var video = document.getElementById('webcam-feed');
    var overlay = document.getElementById('no-signal');
    if (!video) { addLog('ERROR: video element not found', 'err'); return; }

    // Detach first to reset state
    video.srcObject = null;
    video.load();

    setTimeout(function() {
        video.srcObject = stream;
        video.muted = true;        // must be muted for autoplay to work
        video.playsInline = true;
        video.autoplay = true;

        var playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.then(function() {
                addLog('video playing OK', 'ok');
                if (overlay) overlay.className = 'no-signal hidden';
            }).catch(function(err) {
                addLog('autoplay blocked: ' + err.message, 'err');
                addLog('tap the video area to start playback', '');
                // Add a one-time click handler so user tap starts it
                video.addEventListener('click', function handler() {
                    video.play().catch(function(){});
                    video.removeEventListener('click', handler);
                });
                // Show a tap-to-play overlay
                if (overlay) {
                    overlay.className = 'no-signal';
                    overlay.querySelector('.ns-glitch').textContent = 'TAP TO PLAY';
                    overlay.querySelector('.ns-sub').textContent = 'STREAM READY — TAP VIDEO TO START';
                    overlay.style.cursor = 'pointer';
                    overlay.addEventListener('click', function h() {
                        video.play().catch(function(){});
                        overlay.className = 'no-signal hidden';
                        overlay.removeEventListener('click', h);
                    });
                }
            });
        }
    }, 100);
}

function addLog(msg, type) {
    var terminal = document.getElementById('log');
    if (!terminal) return;
    var line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = '<span class="log-prompt">root@sara:~$</span> <span class="log-msg ' + (type||'') + '">' + msg + '</span>';
    terminal.appendChild(line);
    while (terminal.children.length > 30) terminal.removeChild(terminal.firstChild);
    terminal.scrollTop = terminal.scrollHeight;
}

function setStatus(live, label) {
    var liveDot   = document.getElementById('live-dot');
    var liveLabel = document.getElementById('live-label');
    var statStatus = document.getElementById('stat-status');
    var noSignal  = document.getElementById('no-signal');
    var statSignal = document.getElementById('stat-signal');
    if (liveDot)    liveDot.className      = live ? 'live-dot live' : 'live-dot';
    if (liveLabel)  liveLabel.textContent  = live ? label : 'OFFLINE';
    if (statStatus) { statStatus.textContent = live ? label : 'OFFLINE'; statStatus.style.color = live ? 'var(--green)' : 'var(--red)'; }
    if (noSignal)   noSignal.className     = live ? 'no-signal hidden' : 'no-signal';
    if (statSignal) statSignal.textContent = live ? 'STRONG' : '--';
    if (live) startUptime(); else stopUptime();
}

function startUptime() {
    stopUptime();
    startTime = Date.now();
    uptimeTimer = setInterval(function() {
        var e = Math.floor((Date.now() - startTime) / 1000);
        var h = String(Math.floor(e/3600)).padStart(2,'0');
        var m = String(Math.floor((e%3600)/60)).padStart(2,'0');
        var s = String(e%60).padStart(2,'0');
        var el = document.getElementById('stat-uptime');
        if (el) el.textContent = h+':'+m+':'+s;
    }, 1000);
}

function stopUptime() {
    clearInterval(uptimeTimer);
    var el = document.getElementById('stat-uptime');
    if (el) el.textContent = '00:00:00';
    startTime = null;
}

function updateClock() {
    var pad = function(n) { return String(n).padStart(2,'0'); };
    var now = new Date();
    var el = document.getElementById('vid-clock');
    if (el) el.textContent = pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds());
}
setInterval(updateClock, 1000);
updateClock();

// ── Mode switching ────────────────────────────────────────────────────────────
function setMode(m) {
    mode = m;
    var tb = document.getElementById('tab-broadcast');
    var tw = document.getElementById('tab-watch');
    var pb = document.getElementById('panel-broadcast');
    var pw = document.getElementById('panel-watch');
    var sm = document.getElementById('stat-mode');
    if (tb) tb.className = 'tab' + (m==='broadcast' ? ' active' : '');
    if (tw) tw.className = 'tab' + (m==='watch'     ? ' active' : '');
    if (pb) pb.style.display = m==='broadcast' ? 'flex' : 'none';
    if (pw) pw.style.display = m==='watch'     ? 'flex' : 'none';
    if (sm) sm.textContent = m.toUpperCase();
    addLog('mode → ' + m.toUpperCase());
}

// ── Stop ──────────────────────────────────────────────────────────────────────
function stopStream() {
    clearTimeout(retryTimeout);
    retryCount = 0;
    if (currentStream) { currentStream.getTracks().forEach(function(t){ t.stop(); }); currentStream = null; }
    if (activeCall)    { try { activeCall.close(); } catch(e){} activeCall = null; }
    if (peer)          { try { peer.destroy();     } catch(e){} peer = null; }
    var video = document.getElementById('webcam-feed');
    if (video) video.srcObject = null;
    setStatus(false, 'OFFLINE');
    addLog('stream terminated.', 'err');
}

// ── BROADCAST ─────────────────────────────────────────────────────────────────
function startBroadcast(facingMode) {
    var password = document.getElementById('stream-pass').value.trim();
    if (!password) { addLog('ERROR: enter auth_key first', 'err'); return; }

    stopStream();
    addLog('requesting camera: ' + facingMode + '...');

    navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode }, audio: true })
    .then(function(stream) {
        currentStream = stream;
        var video = document.getElementById('webcam-feed');
        if (video) { video.srcObject = stream; video.play(); }

        var track = stream.getVideoTracks()[0];
        if (track) {
            var s = track.getSettings();
            var res = document.getElementById('hud-res');
            if (res && s.width) res.textContent = s.width + ' × ' + s.height;
        }

        setStatus(true, 'BROADCASTING');
        addLog('camera active. connecting relay...');

        peer = new Peer(password, PEER_CONFIG);

        peer.on('open', function(id) {
            addLog('ready on key: "' + id + '"', 'ok');
            addLog('waiting for PC...', 'ok');
        });

        peer.on('call', function(call) {
            addLog('PC calling — answering...');
            activeCall = call;
            call.answer(stream);
            setStatus(true, 'LIVE');
            addLog('PC connected — LIVE', 'ok');
            call.on('close', function() {
                setStatus(true, 'BROADCASTING');
                addLog('PC disconnected.', 'err');
            });
        });

        peer.on('disconnected', function() {
            addLog('relay lost — reconnecting...', 'err');
            if (peer && !peer.destroyed) peer.reconnect();
        });

        peer.on('error', function(err) {
            if (err.type === 'unavailable-id') {
                addLog('key in use — choose another', 'err');
                stopStream();
            } else {
                addLog('error: ' + err.type, 'err');
            }
        });
    })
    .catch(function(e) {
        addLog('camera denied: ' + e.message, 'err');
        addLog('go to phone Settings > Safari > Camera > Allow', '');
    });
}

// ── WATCH ─────────────────────────────────────────────────────────────────────
function startWatching() {
    var password = document.getElementById('stream-pass').value.trim();
    if (!password) { addLog('ERROR: enter auth_key first', 'err'); return; }
    clearTimeout(retryTimeout);
    stopStream();
    retryCount = 0;
    _doConnect(password);
}

function _doConnect(password) {
    addLog('dialing... (attempt ' + (retryCount+1) + ')');
    peer = new Peer(PEER_CONFIG);

    var openTimer = setTimeout(function() {
        addLog('relay timeout — retrying...', 'err');
        _cleanup(); _scheduleRetry(password);
    }, 10000);

    peer.on('open', function() {
        clearTimeout(openTimer);
        addLog('relay open. calling broadcaster...');

        // Get a real local stream (video off, audio muted) so ICE negotiation works fully
        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .catch(function() {
            // If mic denied, use a silent synthetic stream
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            return ctx.createMediaStreamDestination().stream;
        })
        .then(function(localStream) {
            var call;
            try { call = peer.call(password, localStream); } catch(e) {
                addLog('call failed: ' + e.message, 'err');
                _cleanup(); _scheduleRetry(password); return;
            }
            if (!call) {
                addLog('broadcaster not found — is phone broadcasting?', 'err');
                _cleanup(); _scheduleRetry(password); return;
            }
            activeCall = call;
            addLog('call placed. waiting for stream...');

            // Watch ICE state directly — stream event sometimes fires late
            var gotStream = false;

            var streamTimer = setTimeout(function() {
                if (!gotStream) {
                    addLog('stream timeout — retrying...', 'err');
                    _cleanup(); _scheduleRetry(password);
                }
            }, 20000);

            call.on('stream', function(remoteStream) {
                if (gotStream) return;
                gotStream = true;
                clearTimeout(streamTimer);
                retryCount = 0;
                currentStream = remoteStream;
                forcePlayVideo(remoteStream);
                setStatus(true, 'WATCHING');
                addLog('stream received — LIVE', 'ok');
            });
            // Also watch peerConnection directly for track events (Safari fallback)
            if (call.peerConnection) {
                call.peerConnection.addEventListener('track', function(e) {
                    if (gotStream) return;
                    if (!e.streams || !e.streams[0]) return;
                    gotStream = true;
                    clearTimeout(streamTimer);
                    retryCount = 0;
                    currentStream = e.streams[0];
                    forcePlayVideo(e.streams[0]);
                    setStatus(true, 'WATCHING');
                    addLog('stream received (track) — LIVE', 'ok');
                });

                call.peerConnection.addEventListener('iceconnectionstatechange', function() {
                    var state = call.peerConnection.iceConnectionState;
                    addLog('ICE: ' + state);
                    if (state === 'failed') {
                        clearTimeout(streamTimer);
                        addLog('ICE failed — TURN server may be needed', 'err');
                        _cleanup(); _scheduleRetry(password);
                    }
                });
            }

            call.on('close', function() {
                clearTimeout(streamTimer);
                setStatus(false, 'OFFLINE');
                addLog('broadcaster closed stream.', 'err');
            });

            call.on('error', function(e) {
                clearTimeout(streamTimer);
                addLog('call error: ' + (e.message||e.type), 'err');
                _cleanup(); _scheduleRetry(password);
            });
        });
    });

    peer.on('error', function(e) {
        addLog('peer error: ' + e.type, 'err');
        if (e.type === 'peer-unavailable') {
            addLog('phone not found — is it broadcasting?', '');
        }
        _cleanup(); _scheduleRetry(password);
    });

    peer.on('disconnected', function() {
        addLog('relay disconnected.', 'err');
        _cleanup(); _scheduleRetry(password);
    });
}

function _cleanup() {
    if (activeCall) { try { activeCall.close(); } catch(e){} activeCall = null; }
    if (peer)       { try { peer.destroy();     } catch(e){} peer = null; }
}

function _scheduleRetry(password) {
    if (retryCount >= MAX_RETRIES) {
        addLog('max retries. press CONNECT FEED to try again.', 'err');
        retryCount = 0; return;
    }
    retryCount++;
    var delay = Math.min(retryCount * 2000, 8000);
    addLog('retry ' + retryCount + '/' + MAX_RETRIES + ' in ' + (delay/1000) + 's...');
    retryTimeout = setTimeout(function(){ _doConnect(password); }, delay);
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
function toggleFullscreen() {
    var el = document.querySelector('.video-frame');
    if (!document.fullscreenElement) {
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    } else {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
}

// ── Typewriter ────────────────────────────────────────────────────────────────
var phrases = ['STREAMING_UTILITY', 'SECURE_CHANNEL', 'CAM_BRIDGE_V2', 'PEER_LINK_ACTIVE'];
var phraseIdx = 0, charIdx = 0, deleting = false;
function typewriter() {
    var el = document.getElementById('typewriter');
    if (!el) return;
    var current = phrases[phraseIdx];
    if (!deleting) {
        el.textContent = current.slice(0, ++charIdx);
        if (charIdx === current.length) { deleting = true; setTimeout(typewriter, 2000); return; }
    } else {
        el.textContent = current.slice(0, --charIdx);
        if (charIdx === 0) { deleting = false; phraseIdx = (phraseIdx+1) % phrases.length; }
    }
    setTimeout(typewriter, deleting ? 40 : 80);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function boot() {
    var lines = [
        { msg: 'SARA v3.0 initializing...', type: '' },
        { msg: 'peer engine... OK',         type: 'ok' },
        { msg: 'STUN servers... OK',        type: 'ok' },
        { msg: 'buttons wired... OK',       type: 'ok' },
        { msg: 'ready. enter key + tap camera button.', type: 'ok' },
    ];
    var terminal = document.getElementById('log');
    if (terminal) terminal.innerHTML = '';
    lines.forEach(function(l, i) {
        setTimeout(function(){ addLog(l.msg, l.type); }, i * 200);
    });
}

// ── Force play (called when autoplay is blocked) ─────────────────────────────
function forcePlay() {
    var video = document.getElementById('webcam-feed');
    var overlay = document.getElementById('no-signal');
    if (video && currentStream) {
        video.srcObject = currentStream;
        video.muted = true; // muted always works
        video.play().then(function() {
            if (overlay) overlay.className = 'no-signal hidden';
            addLog('playback started.', 'ok');
        }).catch(function(e) {
            addLog('play failed: ' + e.message, 'err');
        });
    }
}

// ── Wire buttons — runs immediately, no DOMContentLoaded needed ───────────────
// (script is at bottom of body so DOM is already ready)
function wireButtons() {
    function wire(id, fn) {
        var el = document.getElementById(id);
        if (!el) { addLog('WARN: #' + id + ' not found', 'err'); return; }
        // Remove any old listeners by cloning
        var clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        clone.addEventListener('click',    function(e){ e.stopPropagation(); fn(); });
        clone.addEventListener('touchend', function(e){ e.preventDefault(); e.stopPropagation(); fn(); });
    }

    wire('tab-broadcast',  function(){ setMode('broadcast'); });
    wire('tab-watch',      function(){ setMode('watch'); });
    wire('btn-back-cam',   function(){ startBroadcast('environment'); });
    wire('btn-front-cam',  function(){ startBroadcast('user'); });
    wire('btn-stop-bcast', function(){ stopStream(); });
    wire('btn-connect',    function(){ startWatching(); });
    wire('btn-disconnect', function(){ stopStream(); });
    wire('btn-fullscreen', function(){ toggleFullscreen(); });

    addLog('v3.0 — buttons OK', 'ok');
}

boot();
typewriter();
wireButtons();
