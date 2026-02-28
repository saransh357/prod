// ── State ─────────────────────────────────────────────────────────────────────
let peer          = null;
let currentStream = null;
let activeCall    = null;
let mode          = 'broadcast';
let startTime     = null;
let uptimeTimer   = null;
let retryTimeout  = null;
let retryCount    = 0;
const MAX_RETRIES = 3;

// ── PeerJS server config ──────────────────────────────────────────────────────
// Uses PeerJS cloud with explicit ICE/STUN/TURN servers for NAT traversal
const PEER_CONFIG = {
    debug: 0,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            // Open TURN relay — helps when devices are on different networks
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ]
    }
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const video      = document.getElementById('webcam-feed');
const noSignal   = document.getElementById('no-signal');
const liveDot    = document.getElementById('live-dot');
const liveLabel  = document.getElementById('live-label');
const statStatus = document.getElementById('stat-status');
const statMode   = document.getElementById('stat-mode');
const statUptime = document.getElementById('stat-uptime');
const statSignal = document.getElementById('stat-signal');

// ── Boot sequence ─────────────────────────────────────────────────────────────
const bootLines = [
    'SARA v2.4.1 initializing...',
    'loading peer engine... OK',
    'ICE/STUN servers loaded... OK',
    'TURN relay configured... OK',
    'camera driver: standby',
    'awaiting operator input_'
];

function bootLog() {
    const terminal = document.getElementById('log');
    terminal.innerHTML = '';
    bootLines.forEach((line, i) => {
        setTimeout(() => {
            addLog(line, i >= 1 && i <= 3 ? 'ok' : i === bootLines.length - 1 ? 'ok' : '');
        }, i * 250);
    });
}

// ── Typewriter ────────────────────────────────────────────────────────────────
const phrases = ['STREAMING_UTILITY', 'SECURE_CHANNEL', 'CAM_BRIDGE_V2', 'PEER_LINK_ACTIVE'];
let phraseIdx = 0, charIdx = 0, deleting = false;

function typewriter() {
    const el = document.getElementById('typewriter');
    if (!el) return;
    const current = phrases[phraseIdx];
    if (!deleting) {
        el.textContent = current.slice(0, ++charIdx);
        if (charIdx === current.length) { deleting = true; setTimeout(typewriter, 2000); return; }
    } else {
        el.textContent = current.slice(0, --charIdx);
        if (charIdx === 0) { deleting = false; phraseIdx = (phraseIdx + 1) % phrases.length; }
    }
    setTimeout(typewriter, deleting ? 40 : 80);
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const el = document.getElementById('vid-clock');
    if (el) el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
setInterval(updateClock, 1000);
updateClock();

// ── Uptime ────────────────────────────────────────────────────────────────────
function startUptime() {
    stopUptime();
    startTime = Date.now();
    uptimeTimer = setInterval(() => {
        const e = Math.floor((Date.now() - startTime) / 1000);
        const h = String(Math.floor(e / 3600)).padStart(2, '0');
        const m = String(Math.floor((e % 3600) / 60)).padStart(2, '0');
        const s = String(e % 60).padStart(2, '0');
        statUptime.textContent = `${h}:${m}:${s}`;
    }, 1000);
}

function stopUptime() {
    clearInterval(uptimeTimer);
    statUptime.textContent = '00:00:00';
    startTime = null;
}

// ── Log ───────────────────────────────────────────────────────────────────────
function addLog(msg, type = '') {
    const terminal = document.getElementById('log');
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `<span class="log-prompt">root@sara:~$</span> <span class="log-msg ${type}">${msg}</span>`;
    terminal.appendChild(line);
    // Keep log to last 20 lines
    while (terminal.children.length > 20) terminal.removeChild(terminal.firstChild);
    terminal.scrollTop = terminal.scrollHeight;
}

// ── Mode switching ────────────────────────────────────────────────────────────
function setMode(m) {
    mode = m;
    document.getElementById('tab-broadcast').classList.toggle('active', m === 'broadcast');
    document.getElementById('tab-watch').classList.toggle('active', m === 'watch');
    document.getElementById('panel-broadcast').style.display = m === 'broadcast' ? 'flex' : 'none';
    document.getElementById('panel-watch').style.display     = m === 'watch'     ? 'flex' : 'none';
    statMode.textContent = m.toUpperCase();
    addLog('mode switched → ' + m.toUpperCase());
}

// ── Status ────────────────────────────────────────────────────────────────────
function setStatus(live, label) {
    liveDot.className      = live ? 'live-dot live' : 'live-dot';
    liveLabel.textContent  = live ? label : 'OFFLINE';
    statStatus.textContent = live ? label : 'OFFLINE';
    statStatus.style.color = live ? 'var(--green)' : 'var(--red)';
    noSignal.className     = live ? 'no-signal hidden' : 'no-signal';
    statSignal.textContent = live ? 'STRONG' : '--';
    if (live) startUptime(); else stopUptime();
}

// ── Stop ──────────────────────────────────────────────────────────────────────
function stopStream() {
    clearTimeout(retryTimeout);
    retryCount = 0;
    if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
    if (activeCall)    { try { activeCall.close(); } catch(e){} activeCall = null; }
    if (peer)          { try { peer.destroy();     } catch(e){} peer = null; }
    video.srcObject = null;
    setStatus(false, 'OFFLINE');
    addLog('stream terminated.', 'err');
}

// ── Create peer helper ────────────────────────────────────────────────────────
// Tries PeerJS cloud first; if it fails, retries with a different approach
function createPeer(id = null) {
    const opts = { ...PEER_CONFIG };
    return id ? new Peer(id, opts) : new Peer(opts);
}

// ── Broadcast (Phone side) ────────────────────────────────────────────────────
async function startBroadcast(facingMode) {
    const password = document.getElementById('stream-pass').value.trim();
    if (!password) { addLog('ERROR: auth_key required', 'err'); return; }

    stopStream();
    addLog('requesting camera access...');

    try {
        currentStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode },
            audio: true
        });
    } catch (e) {
        addLog('camera denied: ' + e.message, 'err');
        return;
    }

    video.srcObject = currentStream;

    // Show resolution
    const track = currentStream.getVideoTracks()[0];
    if (track) {
        const s = track.getSettings();
        if (s.width && s.height) {
            document.getElementById('hud-res').textContent = `${s.width} × ${s.height}`;
        }
    }

    setStatus(true, 'BROADCASTING');
    addLog('camera active. connecting to relay...');

    try {
        peer = createPeer(password);
    } catch(e) {
        addLog('peer init failed: ' + e.message, 'err');
        return;
    }

    peer.on('open', id => {
        addLog(`relay connected. key: "${id}"`, 'ok');
        addLog('waiting for receiver...', 'ok');
    });

    peer.on('call', call => {
        activeCall = call;
        call.answer(currentStream);
        setStatus(true, 'LIVE');
        addLog('receiver connected — LIVE', 'ok');

        call.on('close', () => {
            setStatus(true, 'BROADCASTING');
            addLog('receiver disconnected. waiting...', 'err');
        });
    });

    peer.on('disconnected', () => {
        addLog('relay disconnected. reconnecting...', 'err');
        if (peer) peer.reconnect();
    });

    peer.on('error', err => {
        if (err.type === 'unavailable-id') {
            addLog('key in use — choose another', 'err');
            stopStream();
        } else if (err.type === 'network' || err.type === 'server-error') {
            addLog('relay error — retrying...', 'err');
        } else {
            addLog('peer error: ' + err.type, 'err');
        }
    });
}

// ── Watch (PC side) ───────────────────────────────────────────────────────────
function startWatching() {
    const password = document.getElementById('stream-pass').value.trim();
    if (!password) { addLog('ERROR: auth_key required', 'err'); return; }

    clearTimeout(retryTimeout);
    stopStream();
    retryCount = 0;
    _connectWatch(password);
}

function _connectWatch(password) {
    addLog(`connecting... (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);

    try {
        peer = createPeer();
    } catch(e) {
        addLog('peer init failed: ' + e.message, 'err');
        return;
    }

    // Timeout if open never fires
    const openTimeout = setTimeout(() => {
        addLog('relay timeout. retrying...', 'err');
        _retry(password);
    }, 8000);

    peer.on('open', () => {
        clearTimeout(openTimeout);
        addLog('relay open. dialing broadcaster...');

        const dummyStream = new MediaStream();

        let call;
        try {
            call = peer.call(password, dummyStream);
        } catch(e) {
            addLog('call failed: ' + e.message, 'err');
            _retry(password);
            return;
        }

        if (!call) {
            addLog('broadcaster not found. check key & ensure phone is broadcasting.', 'err');
            _retry(password);
            return;
        }

        activeCall = call;

        // Timeout if stream never arrives
        const streamTimeout = setTimeout(() => {
            addLog('stream timeout — broadcaster may not be ready yet.', 'err');
            _retry(password);
        }, 10000);

        call.on('stream', remote => {
            clearTimeout(streamTimeout);
            retryCount = 0;
            video.srcObject = remote;
            currentStream   = remote;
            setStatus(true, 'WATCHING');
            addLog('feed received. streaming now.', 'ok');
        });

        call.on('close', () => {
            clearTimeout(streamTimeout);
            setStatus(false, 'OFFLINE');
            addLog('broadcaster disconnected.', 'err');
        });

        call.on('error', e => {
            clearTimeout(streamTimeout);
            addLog('call error: ' + e.message, 'err');
            _retry(password);
        });
    });

    peer.on('disconnected', () => {
        addLog('relay disconnected.', 'err');
        _retry(password);
    });

    peer.on('error', e => {
        addLog('peer error: ' + e.type + ' — ' + (e.message || ''), 'err');
        if (e.type === 'peer-unavailable') {
            addLog('broadcaster not found. is phone broadcasting with same key?', 'err');
            // Still retry in case phone is starting up
            _retry(password);
        } else {
            _retry(password);
        }
    });
}

function _retry(password) {
    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
    if (retryCount < MAX_RETRIES) {
        retryCount++;
        const delay = retryCount * 3000;
        addLog(`retrying in ${delay / 1000}s... (${retryCount}/${MAX_RETRIES})`);
        retryTimeout = setTimeout(() => _connectWatch(password), delay);
    } else {
        addLog('max retries reached. check:', 'err');
        addLog('1. phone is on BROADCAST tab', 'err');
        addLog('2. same AUTH_KEY on both devices', 'err');
        addLog('3. both on same WiFi/hotspot', 'err');
        addLog('tap CONNECT FEED to try again.', '');
        retryCount = 0;
    }
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
function toggleFullscreen() {
    const el = document.querySelector('.video-frame');
    if (!document.fullscreenElement) {
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    } else {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
}

// ── Init ──────────────────────────────────────────────────────────────────────
bootLog();
typewriter();
