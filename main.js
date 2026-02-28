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
    currentStream = stream;

    log('stream arrived!', 'ok');
    log('tracks: ' + stream.getTracks().map(function(t){ return t.kind+'('+t.readyState+')'; }).join(', '), 'ok');

    // Always show the PLAY button — user click guarantees autoplay works
    var noSig    = document.getElementById('overlay-nosignal');
    var playOver = document.getElementById('overlay-play');
    if (noSig)    noSig.style.display = 'none';
    if (playOver) playOver.style.display = 'flex';

    setStatus(true, 'WATCHING');
    log('>>> click PLAY STREAM button <<<', 'ok');
}

// ── Manual play ───────────────────────────────────────────────────────────────
function manualPlay() {
    var playOver = document.getElementById('overlay-play');
    var noSig    = document.getElementById('overlay-nosignal');

    if (!currentStream) { log('no stream yet — connect first', 'err'); return; }

    log('manual play clicked...', 'ok');

    // Destroy old video element and create a brand new one
    // This is the most reliable way to force Chrome to render a remote stream
    var frame   = document.querySelector('.video-frame');
    var oldVid  = document.getElementById('webcam-feed');
    if (oldVid) frame.removeChild(oldVid);

    var vid = document.createElement('video');
    vid.id               = 'webcam-feed';
    vid.autoplay         = true;
    vid.muted            = true;
    vid.playsInline      = true;
    vid.setAttribute('playsinline', '');
    vid.setAttribute('webkit-playsinline', '');
    vid.style.position   = 'absolute';
    vid.style.inset      = '0';
    vid.style.width      = '100%';
    vid.style.height     = '100%';
    vid.style.objectFit  = 'cover';
    vid.style.display    = 'block';
    vid.style.zIndex     = '1';

    // Insert before the overlays
    var firstOverlay = frame.querySelector('.abs-fill');
    frame.insertBefore(vid, firstOverlay);

    // Set srcObject AFTER inserting into DOM
    vid.srcObject = currentStream;

    vid.play()
    .then(function() {
        log('▶ PLAYING! stream is live', 'ok');
        if (playOver) playOver.style.display = 'none';
        if (noSig)    noSig.style.display = 'none';
        setStatus(true, 'WATCHING');
    })
    .catch(function(e) {
        log('play failed: ' + e.message, 'err');
        // Last resort: open stream in a new tab
        log('trying new tab fallback...', 'err');
        var url = URL.createObjectURL(currentStream);
        window.open(url, '_blank');
    });
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
    if (noSig)    noSig.style.display = 'flex';
    if (playOver) playOver.style.display = 'none';
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

// ── DEBUG helpers ─────────────────────────────────────────────────────────────
document.getElementById('btn-test-cam') && document.getElementById('btn-test-cam').addEventListener('click', function() {
    // Test if video element can show anything at all
    var vid = document.getElementById('webcam-feed');
    var dbg = document.getElementById('debug-msg');
    dbg.textContent = 'requesting local cam...';
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    .then(function(s) {
        vid.srcObject = s;
        vid.muted = true;
        vid.play().then(function() {
            dbg.textContent = 'LOCAL CAM OK — video element works!';
            dbg.style.color = '#00ff41';
            var noSig = document.getElementById('overlay-nosignal');
            if (noSig) noSig.classList.add('hidden');
            log('video element confirmed working', 'ok');
        }).catch(function(e) {
            dbg.textContent = 'play() failed: ' + e.message;
            dbg.style.color = '#ff2222';
            log('play failed: ' + e.message, 'err');
        });
    }).catch(function(e) {
        dbg.textContent = 'cam denied: ' + e.message;
        dbg.style.color = '#ff2222';
        log('test cam denied: ' + e.message, 'err');
    });
});

document.getElementById('btn-force-render') && document.getElementById('btn-force-render').addEventListener('click', function() {
    var vid = document.getElementById('webcam-feed');
    var dbg = document.getElementById('debug-msg');
    var noSig    = document.getElementById('overlay-nosignal');
    var playOver = document.getElementById('overlay-play');
    
    dbg.textContent = 'currentStream=' + (currentStream ? 'YES tracks:'+currentStream.getTracks().length : 'NULL');
    dbg.style.color = currentStream ? '#00ff41' : '#ff2222';
    log('force render: stream=' + (currentStream ? 'YES' : 'NULL'), currentStream ? 'ok' : 'err');

    if (!currentStream) {
        log('no stream yet — connect first', 'err');
        return;
    }

    // Brute force: recreate video element
    var parent = vid.parentNode;
    var newVid = document.createElement('video');
    newVid.id = 'webcam-feed';
    newVid.autoplay = true;
    newVid.muted = true;
    newVid.playsInline = true;
    newVid.setAttribute('playsinline', '');
    newVid.setAttribute('webkit-playsinline', '');
    newVid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:1;';
    newVid.srcObject = currentStream;
    parent.insertBefore(newVid, vid);
    parent.removeChild(vid);

    newVid.play().then(function() {
        dbg.textContent = 'FORCE RENDER OK!';
        dbg.style.color = '#00ff41';
        if (noSig)    noSig.style.display = 'none';
        if (playOver) playOver.style.display = 'none';
        setStatus(true, 'WATCHING');
        log('force render SUCCESS', 'ok');
    }).catch(function(e) {
        dbg.textContent = 'force render failed: ' + e.message;
        dbg.style.color = '#ff2222';
        log('force render failed: ' + e.message, 'err');
    });
});
