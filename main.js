const video = document.getElementById('webcam-feed');
const btnBack = document.getElementById('btn-back');
const btnFront = document.getElementById('btn-front');
const btnFS = document.getElementById('btn-fullscreen');

function capture(facingMode) {
    navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingMode }
    })
    .then(stream => {
        video.srcObject = stream;
        document.querySelector('.status-dot').style.background = '#22c55e';
        document.querySelector('.status-dot').style.boxShadow = '0 0 10px #22c55e';
    })
    .catch(err => {
        console.error("Camera Access Denied:", err);
        alert("Please allow camera permissions to use this utility.");
    });
}

function enterFullScreen() {
    if (video.requestFullscreen) video.requestFullscreen();
    else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
    else if (video.webkitEnterFullScreen) video.webkitEnterFullScreen();
}
let peer = null;
let currentStream = null;

const video = document.getElementById('webcam-feed');
const passwordInput = document.getElementById('stream-pass');

// 1. Function to Start Broadcasting (Phone Side)
async function startStreaming(facingMode) {
    const password = passwordInput.value;
    if (!password) return alert("Please set a password first!");

    try {
        currentStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facingMode },
            audio: true
        });
        
        video.srcObject = currentStream;
        
        // Initialize Peer with the password as the ID
        peer = new Peer(password); 

        peer.on('open', (id) => {
            alert("Streaming started! PC can now join using this password.");
            updateStatus(true);
        });

        // When the PC calls the phone, send the video stream
        peer.on('call', (call) => {
            call.answer(currentStream);
        });

    } catch (err) {
        console.error("Error:", err);
        alert("Camera access failed.");
    }
}

// 2. Function to Watch (PC Side)
function watchStream() {
    const password = passwordInput.value;
    if (!password) return alert("Enter the broadcaster's password!");

    peer = new Peer(); // PC gets a random ID

    peer.on('open', () => {
        const call = peer.call(password, null); // Call the phone using the password
        
        call.on('stream', (remoteStream) => {
            video.srcObject = remoteStream;
            updateStatus(true);
        });
    });
}

function updateStatus(active) {
    const dot = document.querySelector('.status-dot');
    dot.style.background = active ? '#22c55e' : '#ef4444';
    dot.style.boxShadow = active ? '0 0 10px #22c55e' : '0 0 10px #ef4444';
}

// Event Listeners
document.getElementById('btn-back').addEventListener('click', () => startStreaming('environment'));
document.getElementById('btn-front').addEventListener('click', () => startStreaming('user'));
document.getElementById('btn-watch').addEventListener('click', watchStream);
btnBack.addEventListener('click', () => capture('environment'));
btnFront.addEventListener('click', () => capture('user'));
btnFS.addEventListener('click', enterFullScreen);
