// ── State ─────────────────────────────────────────────────────────────────────
let peer          = null;
let currentStream = null;
let activeCall    = null;
let mode          = 'broadcast';
let startTime     = null;
let uptimeTimer   = null;
let retryTimeout  = null;
let retryCount    = 0;
const MAX_RETRIES = 5;

// ── PeerJS config ─────────────────────────────────────────────────────────────
// Uses PeerJS's own hosted server (most reliable) + Google STUN
const PEER_CONFIG = {
    debug: 0,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
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
    { msg: 'SARA v2.4.1 initializing...', type: '' },
    { msg: 'loading peer engine... OK',   type: 'ok' },
    { msg: 'STUN servers loaded... OK',   type: 'ok' },
    { msg: 'awaiting operator input_',    type: 'ok' },
];

function bootLog() {
    const terminal = document.getElementById('log');
    terminal.innerHTML = '';
    bootLines.forEach((l, i) => {
        setTimeout(() => addLog(l.msg, l.type), i * 250);
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
    const pad = n => String(n).padStart(2, '0');
    const now = new Date();
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
        statUptime.textContent =
            `${String(Math.floor(e/3600)).padStart(2,'0')}:${String(Math.floor((e%3600)/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`;
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
    while (terminal.children.length > 30) terminal.removeChild(terminal.firstChild);
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
    addLog('mode → ' + m.toUpperCase());
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

// ── Hard stop ────────────────────────────────────────────────────────────────
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

// ── BROADCAST (Phone side) ────────────────────────────────────────────────────
async function startBroadcast(facingMode) {
    const password = document.getElementById('stream-pass').value.trim();
    if (!password) { addLog('ERROR: auth_key required', 'err'); return; }

    stopStream();
    addLog('requesting camera...');

    try {
        currentStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true });
    } catch(e) {
        addLog('camera denied: ' + e.message, 'err'); return;
    }

    video.srcObject = currentStream;

    const track = currentStream.getVideoTracks()[0];
    if (track) {
        const s = track.getSettings();
        if (s.width && s.height) document.getElementById('hud-res').textContent = `${s.width} × ${s.height}`;
    }

    setStatus(true, 'BROADCASTING');
    addLog('connecting to relay...');

    // Phone registers with password as its peer ID
    peer = new Peer(password, PEER_CONFIG);

    peer.on('open', id => {
        addLog(`ready on key: "${id}"`, 'ok');
        addLog('waiting for PC to connect...', 'ok');
    });

    // When PC calls in, answer with our camera stream
    peer.on('call', call => {
        addLog('PC is calling — answering...');
        activeCall = call;
        call.answer(currentStream); // Send our camera to the PC

        call.on('stream', () => {
            // We don't need their stream, just confirm connection
            setStatus(true, 'LIVE');
            addLog('PC connected — streaming LIVE', 'ok');
        });

        // 'stream' may not fire on broadcaster side — also listen for ICE connected
        call.peerConnection && call.peerConnection.addEventListener('iceconnectionstatechange', () => {
            const state = call.peerConnection.iceConnectionState;
            addLog('ICE state: ' + state);
            if (state === 'connected' || state === 'completed') {
                setStatus(true, 'LIVE');
                addLog('PC connected — streaming LIVE', 'ok');
            }
            if (state === 'disconnected' || state === 'failed') {
                setStatus(true, 'BROADCASTING');
                addLog('PC disconnected. waiting...', 'err');
            }
        });

        call.on('close', () => {
            setStatus(true, 'BROADCASTING');
            addLog('PC disconnected. waiting...', 'err');
        });

        call.on('error', e => addLog('call error: ' + e.message, 'err'));
    });

    peer.on('disconnected', () => {
        addLog('relay lost — reconnecting...', 'err');
        if (peer && !peer.destroyed) peer.reconnect();
    });

    peer.on('error', err => {
        if (err.type === 'unavailable-id') {
            addLog('key already in use — pick another', 'err');
            stopStream();
        } else {
            addLog('error: ' + err.type, 'err');
        }
    });
}

// ── WATCH (PC side) ───────────────────────────────────────────────────────────
function startWatching() {
    const password = document.getElementById('stream-pass').value.trim();
    if (!password) { addLog('ERROR: auth_key required', 'err'); return; }
    clearTimeout(retryTimeout);
    stopStream();
    retryCount = 0;
    _doConnect(password);
}

function _doConnect(password) {
    addLog(`dialing broadcaster... (attempt ${retryCount + 1})`);

    // PC gets a random peer ID
    peer = new Peer(PEER_CONFIG);

    const openTimer = setTimeout(() => {
        addLog('relay timeout — retrying...', 'err');
        _cleanup();
        _scheduleRetry(password);
    }, 10000);

    peer.on('open', myId => {
        clearTimeout(openTimer);
        addLog('relay open. calling broadcaster...');

        // PC calls the phone using the password as the phone's peer ID
        // We must pass a valid MediaStream — use a silent/blank one
        let call;
        try {
            // Create a silent audio track so PeerJS doesn't complain
            const ctx = new AudioContext();
            const dest = ctx.createMediaStreamDestination();
            const silentStream = dest.stream;
            call = peer.call(password, silentStream);
        } catch(e) {
            addLog('call init failed: ' + e.message, 'err');
            _cleanup();
            _scheduleRetry(password);
            return;
        }

        if (!call) {
            addLog('broadcaster not reachable. retrying...', 'err');
            _cleanup();
            _scheduleRetry(password);
            return;
        }

        activeCall = call;
        addLog('call placed. waiting for stream...');

        const streamTimer = setTimeout(() => {
            addLog('stream timeout — is phone broadcasting?', 'err');
            _cleanup();
            _scheduleRetry(password);
        }, 15000);

        // THIS is where the phone's camera comes in
        call.on('stream', remoteStream => {
            clearTimeout(streamTimer);
            retryCount = 0;

            // Attach stream to video element
            video.srcObject = remoteStream;
            currentStream   = remoteStream;

            // Force play (some browsers need this)
            video.play().catch(() => {});

            setStatus(true, 'WATCHING');
            addLog('stream received — LIVE', 'ok');
        });

        call.on('close', () => {
            clearTimeout(streamTimer);
            addLog('broadcaster closed stream.', 'err');
            setStatus(false, 'OFFLINE');
        });

        call.on('error', e => {
            clearTimeout(streamTimer);
            addLog('call error: ' + (e.message || e.type), 'err');
            _cleanup();
            _scheduleRetry(password);
        });
    });

    peer.on('error', e => {
        clearTimeout(openTimer);
        addLog('peer error: ' + e.type, 'err');

        if (e.type === 'peer-unavailable') {
            addLog('broadcaster not found. make sure:', 'err');
            addLog('→ phone is on BROADCAST tab', '');
            addLog('→ phone shows "waiting for PC"', '');
            addLog('→ same AUTH_KEY on both devices', '');
        }

        _cleanup();
        _scheduleRetry(password);
    });

    peer.on('disconnected', () => {
        addLog('relay disconnected.', 'err');
        _cleanup();
        _scheduleRetry(password);
    });
}

function _cleanup() {
    if (activeCall) { try { activeCall.close(); } catch(e){} activeCall = null; }
    if (peer)       { try { peer.destroy();     } catch(e){} peer = null; }
}

function _scheduleRetry(password) {
    if (retryCount >= MAX_RETRIES) {
        addLog('max retries reached. press CONNECT FEED to try again.', 'err');
        retryCount = 0;
        return;
    }
    retryCount++;
    const delay = Math.min(retryCount * 2000, 8000);
    addLog(`retry ${retryCount}/${MAX_RETRIES} in ${delay/1000}s...`);
    retryTimeout = setTimeout(() => _doConnect(password), delay);
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
