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

btnBack.addEventListener('click', () => capture('environment'));
btnFront.addEventListener('click', () => capture('user'));
btnFS.addEventListener('click', enterFullScreen);