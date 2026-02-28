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
            {
                urls: ['turn:openrelay.metered.ca:80','turn:openrelay.metered.ca:443','turn:openrelay.metered.ca:443?transport=tcp'],
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    }
};

// ── Log ───────────────────────────────────────────────────────────────────────
function log(msg, type) {
    var el = document.getElementById('log');
    if (!el) return;
    var d = document.createElement('div');
    d.className = 'log-line';
    d.innerHTML = '<span class="log-prompt">$</span><span class="log-' + (type||'def') + '"> ' + msg + '</span>';
    el.appendChild(d);
    while (el.children.length > 40) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
}

// ── Status ────────────────────────────────────────────────────────────────────
function setStat(id, val, color) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (color) el.style.color = color;
}

function setStatus(live, label) {
    var dot = document.getElementById('live-dot');
    var lbl = document.getElementById('live-label');
    if (dot) dot.className = live ? 'dot live' : 'dot';
    if (lbl) lbl.textContent = live ? label : 'OFFLINE';
    setStat('s-status', live ? label : 'OFFLINE', live ? 'var(--green)' : 'var(--red)');
    setStat('s-signal', live ? 'STRONG' : '--');
    if (live) startUptime(); else stopUptime();
}

// ── Uptime ────────────────────────────────────────────────────────────────────
function startUptime() {
    stopUptime();
    startTime = Date.now();
    uptimeTimer = setInterval(function() {
        var e = Math.floor((Date.now() - startTime) / 1000);
        setStat('s-uptime',
            String(Math.floor(e/3600)).padStart(2,'0') + ':' +
            String(Math.floor((e%3600)/60)).padStart(2,'0') + ':' +
            String(e%60).padStart(2,'0')
        );
    }, 1000);
}
function stopUptime() {
    clearInterval(uptimeTimer);
    setStat('s-uptime', '00:00:00');
    startTime = null;
}

// ── Clock ─────────────────────────────────────────────────────────────────────
setInterval(function() {
    var n = new Date(), p = function(x){ return String(x).padStart(2,'0'); };
    setStat('vid-clock', p(n.getHours())+':'+p(n.getMinutes())+':'+p(n.getSeconds()));
}, 1000);

// ── Show video ────────────────────────────────────────────────────────────────
function showVideo(stream) {
    var vid      = document.getElementById('webcam-feed');
    var noSig    = document.getElementById('overlay-nosignal');
    var playOver = document.getElementById('overlay-play');

    if (!vid) { log('video element missing!', 'err'); return; }

    currentStream = stream;
    vid.srcObject  = stream;
    vid.muted      = true;   // muted = always autoplays

    log('attaching stream...', 'ok');
    log('tracks: ' + stream.getTracks().map(function(t){ return t.kind+'('+t.readyState+')'; }).join(', '), 'ok');

    vid.play()
    .then(function() {
        log('▶ playing!', 'ok');
        if (noSig)    noSig.classList.add('hidden');
        if (playOver) playOver.classList.add('hidden');
        setStatus(true, 'WATCHING');
    })
    .catch(function(err) {
        log('autoplay blocked: ' + err.message, 'err');
        log('>>> click the green button <<<', 'ok');
        if (noSig)    noSig.classList.add('hidden');
        if (playOver) playOver.classList.remove('hidden');
        setStatus(true, 'PAUSED');
    });
}

// ── Manual play ───────────────────────────────────────────────────────────────
function manualPlay() {
    var vid      = document.getElementById('webcam-feed');
    var playOver = document.getElementById('overlay-play');
    var noSig    = document.getElementById('overlay-nosignal');

    if (!vid || !currentStream) { log('no stream yet', 'err'); return; }
    vid.srcObject = currentStream;
    vid.muted     = true;
    vid.play()
    .then(function() {
        log('▶ manual play OK', 'ok');
        if (playOver) playOver.classList.add('hidden');
        if (noSig)    noSig.classList.add('hidden');
        setStatus(true, 'WATCHING');
    })
    .catch(function(e) { log('play err: ' + e.message, 'err'); });
}

// ── Mode ──────────────────────────────────────────────────────────────────────
function setMode(m) {
    mode = m;
    document.getElementById('tab-broadcast').className = 'tab' + (m==='broadcast'?' active':'');
    document.getElementById('tab-watch').className     = 'tab' + (m==='watch'    ?' active':'');
    document.getElementById('panel-broadcast').className = 'btn-stack' + (m==='broadcast'?'':' hidden');
    document.getElementById('panel-watch').className     = 'btn-stack' + (m==='watch'    ?'':' hidden');
    setStat('s-mode', m.toUpperCase());
    log('mode → ' + m.toUpperCase());
}

// ── Stop ──────────────────────────────────────────────────────────────────────
function stopStream() {
    clearTimeout(retryTimeout);
    retryCount = 0;
    if (currentStream) { currentStream.getTracks().forEach(function(t){ t.stop(); }); currentStream = null; }
    if (activeCall)    { try{ activeCall.close(); }catch(e){} activeCall = null; }
    if (peer)          { try{ peer.destroy();     }catch(e){} peer = null; }
    var vid = document.getElementById('webcam-feed');
    if (vid) vid.srcObject = null;
    var noSig    = document.getElementById('overlay-nosignal');
    var playOver = document.getElementById('overlay-play');
    if (noSig)    noSig.classList.remove('hidden');
    if (playOver) playOver.classList.add('hidden');
    setStatus(false, 'OFFLINE');
    log('terminated.', 'err');
}

// ── BROADCAST ─────────────────────────────────────────────────────────────────
function startBroadcast(facing) {
    var pass = document.getElementById('stream-pass').value.trim();
    if (!pass) { log('enter auth key first!', 'err'); return; }

    stopStream();
    log('camera: ' + facing + '...');

    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: true })
    .then(function(stream) {
        currentStream = stream;
        var vid = document.getElementById('webcam-feed');
        if (vid) { vid.srcObject = stream; vid.muted = true; vid.play().catch(function(){}); }

        var noSig = document.getElementById('overlay-nosignal');
        if (noSig) noSig.classList.add('hidden');

        var track = stream.getVideoTracks()[0];
        if (track) {
            var s = track.getSettings();
            if (s.width) setStat('hud-res', s.width + ' x ' + s.height);
        }

        setStatus(true, 'BROADCASTING');
        log('camera OK. connecting relay...', 'ok');

        peer = new Peer(pass, PEER_CONFIG);

        peer.on('open', function(id) {
            log('ready! key: "' + id + '"', 'ok');
            log('waiting for PC...', 'ok');
        });

        peer.on('call', function(call) {
            log('PC calling — answering...', 'ok');
            activeCall = call;
            call.answer(stream);
            setStatus(true, 'LIVE');
            log('LIVE!', 'ok');
            call.on('close', function(){ setStatus(true,'BROADCASTING'); log('PC disconnected','err'); });
            call.on('error', function(e){ log('call err: '+e.message,'err'); });
        });

        peer.on('disconnected', function(){ if(peer && !peer.destroyed) peer.reconnect(); });
        peer.on('error', function(e){
            if (e.type==='unavailable-id') { log('key in use — try another','err'); stopStream(); }
            else log('peer err: '+e.type,'err');
        });
    })
    .catch(function(e) {
        log('camera denied: ' + e.message, 'err');
        log('Settings > Safari/Chrome > Camera > Allow', '');
    });
}

// ── WATCH ─────────────────────────────────────────────────────────────────────
function startWatching() {
    var pass = document.getElementById('stream-pass').value.trim();
    if (!pass) { log('enter auth key first!', 'err'); return; }
    clearTimeout(retryTimeout);
    stopStream();
    retryCount = 0;
    _connect(pass);
}

function _connect(pass) {
    log('dialing... attempt ' + (retryCount+1));

    peer = new Peer(PEER_CONFIG);

    var openTimer = setTimeout(function(){
        log('relay timeout', 'err');
        _cleanup(); _retry(pass);
    }, 10000);

    peer.on('open', function() {
        clearTimeout(openTimer);
        log('relay open. calling broadcaster...');

        // Use real mic if available, else synthetic silent stream
        var getLocalStream = navigator.mediaDevices
            ? navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(function(){
                var ctx = new (window.AudioContext||window.webkitAudioContext)();
                return ctx.createMediaStreamDestination().stream;
              })
            : Promise.resolve(new MediaStream());

        getLocalStream.then(function(local) {
            var call;
            try { call = peer.call(pass, local); } catch(e) {
                log('call failed: '+e.message,'err'); _cleanup(); _retry(pass); return;
            }
            if (!call) { log('broadcaster not found','err'); _cleanup(); _retry(pass); return; }

            activeCall = call;
            log('ringing...');
            var gotStream = false;

            var streamTimer = setTimeout(function(){
                if (!gotStream) { log('stream timeout','err'); _cleanup(); _retry(pass); }
            }, 20000);

            // Primary: PeerJS stream event
            call.on('stream', function(remote) {
                if (gotStream) return;
                gotStream = true;
                clearTimeout(streamTimer);
                retryCount = 0;
                log('stream event fired!', 'ok');
                showVideo(remote);
            });

            // Fallback: native RTCPeerConnection track event (Safari)
            if (call.peerConnection) {
                call.peerConnection.ontrack = function(e) {
                    if (gotStream) return;
                    if (!e.streams || !e.streams[0]) return;
                    gotStream = true;
                    clearTimeout(streamTimer);
                    retryCount = 0;
                    log('track event fired!', 'ok');
                    showVideo(e.streams[0]);
                };
                call.peerConnection.oniceconnectionstatechange = function() {
                    var s = call.peerConnection.iceConnectionState;
                    log('ICE: ' + s);
                    if (s==='failed'){ clearTimeout(streamTimer); _cleanup(); _retry(pass); }
                };
            }

            call.on('close', function(){ clearTimeout(streamTimer); setStatus(false,'OFFLINE'); log('broadcaster closed','err'); });
            call.on('error', function(e){ clearTimeout(streamTimer); log('call err: '+(e.message||e.type),'err'); _cleanup(); _retry(pass); });
        });
    });

    peer.on('error', function(e) {
        log('peer err: ' + e.type, 'err');
        if (e.type==='peer-unavailable') log('phone not broadcasting yet?', '');
        _cleanup(); _retry(pass);
    });
    peer.on('disconnected', function(){ log('relay disconnected','err'); _cleanup(); _retry(pass); });
}

function _cleanup() {
    if (activeCall){ try{activeCall.close();}catch(e){} activeCall=null; }
    if (peer)      { try{peer.destroy();    }catch(e){} peer=null; }
}

function _retry(pass) {
    if (retryCount >= MAX_RETRIES) {
        log('max retries. tap CONNECT FEED to try again.','err');
        retryCount = 0; return;
    }
    retryCount++;
    var delay = Math.min(retryCount * 2000, 8000);
    log('retry ' + retryCount + '/' + MAX_RETRIES + ' in ' + delay/1000 + 's...');
    retryTimeout = setTimeout(function(){ _connect(pass); }, delay);
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
function toggleFullscreen() {
    var el = document.querySelector('.video-frame');
    if (!document.fullscreenElement) (el.requestFullscreen||el.webkitRequestFullscreen).call(el);
    else (document.exitFullscreen||document.webkitExitFullscreen).call(document);
}

// ── Typewriter ────────────────────────────────────────────────────────────────
var _phrases = ['STREAMING_UTILITY','SECURE_CHANNEL','CAM_BRIDGE_V2','PEER_LINK'];
var _pi=0,_ci=0,_del=false;
function typewriter(){
    var el=document.getElementById('typewriter'); if(!el)return;
    var cur=_phrases[_pi];
    if(!_del){el.textContent=cur.slice(0,++_ci);if(_ci===cur.length){_del=true;setTimeout(typewriter,2000);return;}}
    else{el.textContent=cur.slice(0,--_ci);if(_ci===0){_del=false;_pi=(_pi+1)%_phrases.length;}}
    setTimeout(typewriter,_del?40:80);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function boot() {
    var lines = [
        {m:'SARA v3.1 ready',       t:'ok'},
        {m:'peer engine OK',        t:'ok'},
        {m:'STUN/TURN loaded',      t:'ok'},
        {m:'tap camera to start',   t:'ok'},
    ];
    var el = document.getElementById('log');
    if (el) el.innerHTML = '';
    lines.forEach(function(l,i){ setTimeout(function(){ log(l.m,l.t); }, i*200); });
}

// ── Wire all buttons ──────────────────────────────────────────────────────────
// Script is at bottom of <body> so DOM is ready — no DOMContentLoaded needed
(function wire() {
    var map = {
        'tab-broadcast': function(){ setMode('broadcast'); },
        'tab-watch':     function(){ setMode('watch'); },
        'btn-back':      function(){ startBroadcast('environment'); },
        'btn-front':     function(){ startBroadcast('user'); },
        'btn-stop-b':    function(){ stopStream(); },
        'btn-connect':   function(){ startWatching(); },
        'btn-stop-w':    function(){ stopStream(); },
        'btn-fs':        function(){ toggleFullscreen(); },
        'btn-manual-play': function(){ manualPlay(); },
    };
    Object.keys(map).forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) { console.warn('missing #'+id); return; }
        var fn = map[id];
        el.addEventListener('click',    function(e){ e.stopPropagation(); fn(); });
        el.addEventListener('touchend', function(e){ e.preventDefault(); e.stopPropagation(); fn(); });
    });
    log('buttons wired OK', 'ok');
})();

boot();
typewriter();
