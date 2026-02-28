// ── State ─────────────────────────────────────────────────────────────────────
let peer          = null;
let currentStream = null;
let activeCall    = null;
let mode          = 'broadcast';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const video    = document.getElementById('webcam-feed');
const logEl    = document.getElementById('log');
const dotEl    = document.getElementById('status-dot');
const statusEl = document.getElementById('status-text');
const overlay  = document.getElementById('video-overlay');

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg, type = 'entry') {
    const t = new Date().toLocaleTimeString();
    logEl.innerHTML = `<span class="${type}">[${t}] ${msg}</span>`;
}

// ── Mode switching ────────────────────────────────────────────────────────────
function setMode(m) {
    mode = m;
    document.getElementById('tab-broadcast').classList.toggle('active', m === 'broadcast');
    document.getElementById('tab-watch').classList.toggle('active', m === 'watch');
    document.getElementById('panel-broadcast').style.display = m === 'broadcast' ? 'flex' : 'none';
    document.getElementById('panel-watch').style.display     = m === 'watch'     ? 'flex' : 'none';
    log('Mode set to: ' + m);
}

// ── Status helpers ────────────────────────────────────────────────────────────
function setStatus(live, label) {
    dotEl.className      = live ? 'dot live' : 'dot';
    statusEl.textContent = live ? label : 'OFFLINE';
    overlay.className    = live ? 'video-overlay hidden' : 'video-overlay';
}

// ── Stop / cleanup ────────────────────────────────────────────────────────────
function stopStream() {
    if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
    if (activeCall)    { activeCall.close();  activeCall = null; }
    if (peer)          { peer.destroy();      peer = null; }
    video.srcObject = null;
    setStatus(false, 'OFFLINE');
    log('Stopped.', 'err');
}

// ── Broadcast (Phone side) ────────────────────────────────────────────────────
async function startBroadcast(facingMode) {
    const password = document.getElementById('stream-pass').value.trim();
    if (!password) { log('Enter a password first!', 'err'); return; }

    stopStream();
    log('Requesting camera access...');

    try {
        currentStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode },
            audio: true
        });
    } catch (e) {
        log('Camera denied: ' + e.message, 'err');
        return;
    }

    video.srcObject = currentStream;
    setStatus(true, 'BROADCASTING');
    log('Camera active. Connecting to signalling server...');

    peer = new Peer(password, { debug: 0 });

    peer.on('open', id => {
        log('Ready! Waiting for viewer on key: "' + id + '"', 'success');
    });

    peer.on('call', call => {
        activeCall = call;
        call.answer(currentStream);
        setStatus(true, 'LIVE');
        log('Viewer connected — streaming live!', 'success');
    });

    peer.on('error', err => {
        if (err.type === 'unavailable-id') {
            log('Password already in use — try a different one.', 'err');
        } else {
            log('Peer error: ' + err.message, 'err');
        }
    });
}

// ── Watch (PC side) ───────────────────────────────────────────────────────────
function startWatching() {
    const password = document.getElementById('stream-pass').value.trim();
    if (!password) { log('Enter the broadcaster password!', 'err'); return; }

    stopStream();
    log('Connecting to broadcaster...');

    peer = new Peer({ debug: 0 });

    peer.on('open', () => {
        // Pass a dummy empty stream — PeerJS requires a MediaStream on the caller side
        const dummyStream = new MediaStream();
        const call = peer.call(password, dummyStream);

        if (!call) { log('Could not reach broadcaster. Check password.', 'err'); return; }
        activeCall = call;

        call.on('stream', remote => {
            video.srcObject = remote;
            currentStream   = remote;
            setStatus(true, 'WATCHING');
            log('Stream received! Watching live feed.', 'success');
        });

        call.on('close', () => {
            setStatus(false, 'OFFLINE');
            log('Broadcaster disconnected.', 'err');
        });

        call.on('error', e => log('Call error: ' + e.message, 'err'));
    });

    peer.on('error', e => log('Connection failed: ' + e.message, 'err'));
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
function toggleFullscreen() {
    const el = document.querySelector('.video-wrap');
    if (!document.fullscreenElement) {
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    } else {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
}
