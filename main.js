// ── config ────────────────────────────────────────────────────────────────────
var PC = {
  debug: 0,
  config: {
    iceServers: [
      {urls:'stun:stun.l.google.com:19302'},
      {urls:'stun:stun1.l.google.com:19302'},
      {urls:['turn:openrelay.metered.ca:80','turn:openrelay.metered.ca:443','turn:openrelay.metered.ca:443?transport=tcp'],
       username:'openrelayproject',credential:'openrelayproject'}
    ]
  }
};

// ── state ─────────────────────────────────────────────────────────────────────
var peer=null,remoteStream=null,activeCall=null,retries=0,retryT=null,upT=null,t0=null;

// ── log ───────────────────────────────────────────────────────────────────────
function L(msg,t){
  var el=document.getElementById('LOG');
  var d=document.createElement('div');
  d.className='ll';
  d.innerHTML='<span class="lp">$</span><span class="l'+(t||'def')+'"> '+msg+'</span>';
  el.appendChild(d);
  while(el.children.length>60)el.removeChild(el.firstChild);
  el.scrollTop=el.scrollHeight;
}

// ── clock / uptime ────────────────────────────────────────────────────────────
function pad(n){return String(n).padStart(2,'0');}
setInterval(function(){
  var n=new Date();
  document.getElementById('CLK').textContent=pad(n.getHours())+':'+pad(n.getMinutes())+':'+pad(n.getSeconds());
},1000);
function startUp(){
  stopUp(); t0=Date.now();
  upT=setInterval(function(){
    var e=Math.floor((Date.now()-t0)/1000);
    document.getElementById('su').textContent=pad(Math.floor(e/3600))+':'+pad(Math.floor(e%3600/60))+':'+pad(e%60);
  },1000);
}
function stopUp(){clearInterval(upT);document.getElementById('su').textContent='00:00:00';t0=null;}

// ── status ────────────────────────────────────────────────────────────────────
function setLive(on,lbl){
  document.getElementById('DOT').className='dot'+(on?' live':'');
  document.getElementById('LL').textContent=on?(lbl||'LIVE'):'OFFLINE';
  var ss=document.getElementById('ss');
  ss.textContent=on?(lbl||'LIVE'):'OFFLINE';
  ss.style.color=on?'var(--g)':'var(--r)';
  document.getElementById('sg').textContent=on?'STRONG':'--';
  on?startUp():stopUp();
}

// ── mode ──────────────────────────────────────────────────────────────────────
function setMode(m){
  var isBcast=m==='b';
  document.getElementById('t-bcast').className='tab'+(isBcast?' on':'');
  document.getElementById('t-watch').className='tab'+(!isBcast?' on':'');
  document.getElementById('p-bcast').style.display=isBcast?'flex':'none';
  document.getElementById('p-watch').style.display=isBcast?'none':'flex';
  document.getElementById('sm').textContent=isBcast?'BROADCAST':'WATCH';
  L('mode: '+(isBcast?'BROADCAST':'WATCH'));
}

// ── THE video attach function ─────────────────────────────────────────────────
function attachToVideo(stream){
  remoteStream=stream;

  L('got tracks: '+stream.getTracks().map(function(t){return t.kind+'('+t.readyState+')'}).join(', '),'ok');

  var V  = document.getElementById('V');
  var NS = document.getElementById('NS');
  var PO = document.getElementById('PO');

  // Hide no-signal
  NS.style.display='none';

  // Assign stream to video
  V.srcObject = stream;
  V.muted     = true;

  L('srcObject set. calling play()...');

  var p = V.play();
  if(p && p.then){
    p.then(function(){
      L('play() SUCCESS — stream is live!','ok');
      PO.style.display='none';
      setLive(true,'WATCHING');
    }).catch(function(err){
      L('play() blocked: '+err.name,'err');
      L('showing CLICK TO PLAY button...','ok');
      PO.style.display='flex';
      setLive(true,'PAUSED');
    });
  } else {
    L('play() called (no promise)','ok');
    PO.style.display='none';
    setLive(true,'WATCHING');
  }
}

// ── manual play button ────────────────────────────────────────────────────────
document.getElementById('b-play').onclick = function(){
  if(!remoteStream){ L('no stream','err'); return; }
  L('manual play clicked...','ok');
  var V  = document.getElementById('V');
  var PO = document.getElementById('PO');
  var NS = document.getElementById('NS');

  // Re-create video element completely (nuclear option)
  var parent = V.parentNode;
  var newV   = document.createElement('video');
  newV.id          = 'V';
  newV.autoplay    = true;
  newV.muted       = true;
  newV.playsInline = true;
  newV.setAttribute('playsinline','');
  newV.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:1;display:block;';
  newV.srcObject = remoteStream;
  parent.replaceChild(newV, V);

  newV.play().then(function(){
    L('manual play OK!','ok');
    PO.style.display='none';
    NS.style.display='none';
    setLive(true,'WATCHING');
  }).catch(function(e){
    L('still blocked: '+e.name+' — try clicking again','err');
  });
};

// ── stop ──────────────────────────────────────────────────────────────────────
function stop(){
  clearTimeout(retryT); retries=0;
  if(remoteStream){remoteStream.getTracks().forEach(function(t){t.stop();});remoteStream=null;}
  if(activeCall){try{activeCall.close();}catch(e){} activeCall=null;}
  if(peer){try{peer.destroy();}catch(e){} peer=null;}
  var V=document.getElementById('V');
  if(V){V.srcObject=null;}
  document.getElementById('NS').style.display='flex';
  document.getElementById('PO').style.display='none';
  setLive(false);
  L('stopped.','err');
}

// ── broadcast ─────────────────────────────────────────────────────────────────
function broadcast(facing){
  var k=document.getElementById('KEY').value.trim();
  if(!k){L('enter auth key first!','err');return;}
  stop();
  L('requesting camera...');
  navigator.mediaDevices.getUserMedia({video:{facingMode:facing},audio:true})
  .then(function(s){
    remoteStream=s;
    var V=document.getElementById('V');
    document.getElementById('NS').style.display='none';
    V.srcObject=s; V.muted=true; V.play().catch(function(){});
    var tr=s.getVideoTracks()[0];
    if(tr){var st=tr.getSettings();if(st.width)document.getElementById('RES').textContent=st.width+'x'+st.height;}
    setLive(true,'BROADCASTING');
    L('camera OK. registering peer...','ok');

    peer=new Peer(k,PC);
    peer.on('open',function(id){
      L('registered! key="'+id+'"','ok');
      L('waiting for PC to connect...','ok');
    });
    peer.on('call',function(c){
      L('PC calling — answering...','ok');
      activeCall=c;
      c.answer(s);
      setLive(true,'LIVE');
      L('LIVE — streaming to PC','ok');
      c.on('close',function(){setLive(true,'BROADCASTING');L('PC disconnected','err');});
      c.on('error',function(e){L('call err:'+e.type,'err');});
    });
    peer.on('disconnected',function(){if(peer&&!peer.destroyed){peer.reconnect();L('relay reconnecting...','err');}});
    peer.on('error',function(e){
      if(e.type==='unavailable-id'){L('key in use — try another key','err');stop();}
      else if(e.type==='network'||e.type==='socket-error'||e.type==='socket-closed'){L('network err — check connection','err');}
      else L('peer err:'+e.type,'err');
    });
  }).catch(function(e){
    L('camera denied: '+e.message,'err');
    L('Settings > Browser > Camera > Allow','');
  });
}

// ── watch ────────────────────────────────────────────────────────────────────
function watch(){
  var k=document.getElementById('KEY').value.trim();
  if(!k){L('enter auth key first!','err');return;}
  clearTimeout(retryT);
  stop();
  retries=0;
  doConnect(k);
}

function doConnect(k){
  L('dialing... attempt '+(retries+1));
  peer=new Peer(PC);

  var openTimer=setTimeout(function(){
    L('relay open timeout','err');
    cleanup(); doRetry(k);
  },12000);

  peer.on('open',function(){
    clearTimeout(openTimer);
    L('relay open. calling phone...','ok');

    // get mic stream for proper offer/answer (video:false so no camera popup)
    var getAudio = navigator.mediaDevices
      ? navigator.mediaDevices.getUserMedia({audio:true,video:false}).catch(function(){
          return new MediaStream();
        })
      : Promise.resolve(new MediaStream());

    getAudio.then(function(localAudio){
      var c;
      try{ c=peer.call(k,localAudio); }
      catch(e){ L('call() threw: '+e.message,'err'); cleanup(); doRetry(k); return; }

      if(!c){ L('phone not found (null call)','err'); cleanup(); doRetry(k); return; }

      activeCall=c;
      L('ringing phone...','ok');
      var gotStream=false;

      var streamTimer=setTimeout(function(){
        if(!gotStream){L('stream timeout — phone may not be ready','err');cleanup();doRetry(k);}
      },20000);

      // PRIMARY: PeerJS stream event
      c.on('stream',function(remote){
        if(gotStream)return;
        gotStream=true;
        clearTimeout(streamTimer);
        retries=0;
        L('STREAM RECEIVED via stream event!','ok');
        attachToVideo(remote);
      });

      // FALLBACK: raw RTCPeerConnection ontrack
      if(c.peerConnection){
        c.peerConnection.ontrack=function(ev){
          if(gotStream)return;
          if(!ev.streams||!ev.streams[0])return;
          gotStream=true;
          clearTimeout(streamTimer);
          retries=0;
          L('STREAM RECEIVED via ontrack!','ok');
          attachToVideo(ev.streams[0]);
        };
        c.peerConnection.oniceconnectionstatechange=function(){
          var s=c.peerConnection.iceConnectionState;
          L('ICE: '+s);
          if(s==='failed'){
            clearTimeout(streamTimer);
            L('ICE failed — TURN server unreachable?','err');
            cleanup(); doRetry(k);
          }
        };
      }

      c.on('close',function(){clearTimeout(streamTimer);setLive(false);L('phone disconnected','err');});
      c.on('error',function(e){clearTimeout(streamTimer);L('call err: '+(e.message||e.type),'err');cleanup();doRetry(k);});
    });
  });

  peer.on('error',function(e){
    clearTimeout(openTimer);
    L('peer err: '+e.type,'err');
    if(e.type==='peer-unavailable') L('phone not found — is it broadcasting?','');
    else if(e.type==='network'||e.type==='socket-error'||e.type==='socket-closed'){
      L('WEBSOCKET BLOCKED','err');
      L('Both devices must be on same hotspot','err');
      L('University/office WiFi blocks WSS','err');
    }
    cleanup(); doRetry(k);
  });
  peer.on('disconnected',function(){clearTimeout(openTimer);cleanup();doRetry(k);});
}

function cleanup(){
  if(activeCall){try{activeCall.close();}catch(e){} activeCall=null;}
  if(peer){try{peer.destroy();}catch(e){} peer=null;}
}
function doRetry(k){
  if(retries>=5){L('max retries. tap CONNECT FEED again.','err');retries=0;return;}
  retries++;
  var delay=Math.min(retries*2000,8000);
  L('retry '+retries+'/5 in '+delay/1000+'s...');
  retryT=setTimeout(function(){doConnect(k);},delay);
}

// ── fullscreen ────────────────────────────────────────────────────────────────
document.getElementById('b-fs').onclick=function(){
  var el=document.getElementById('VBOX');
  if(!document.fullscreenElement)(el.requestFullscreen||el.webkitRequestFullscreen).call(el);
  else (document.exitFullscreen||document.webkitExitFullscreen).call(document);
};

// ── wire buttons ──────────────────────────────────────────────────────────────
var BTNS={
  't-bcast':function(){setMode('b');},
  't-watch':function(){setMode('w');},
  'b-back':function(){broadcast('environment');},
  'b-front':function(){broadcast('user');},
  'b-stopb':function(){stop();},
  'b-conn':function(){watch();},
  'b-stopw':function(){stop();}
};
Object.keys(BTNS).forEach(function(id){
  var el=document.getElementById(id);
  if(!el){L('WARN: #'+id+' not found','err');return;}
  var fn=BTNS[id];
  el.addEventListener('click',function(e){e.stopPropagation();fn();});
  el.addEventListener('touchend',function(e){e.preventDefault();e.stopPropagation();fn();});
});

// ── typewriter ────────────────────────────────────────────────────────────────
var PH=['STREAMING_UTILITY','SECURE_CHANNEL','CAM_BRIDGE','PEER_LINK'],pi=0,ci=0,del=false;
function tw(){
  var el=document.getElementById('tw');if(!el)return;
  var c=PH[pi];
  if(!del){el.textContent=c.slice(0,++ci);if(ci===c.length){del=true;setTimeout(tw,2000);return;}}
  else{el.textContent=c.slice(0,--ci);if(ci===0){del=false;pi=(pi+1)%PH.length;}}
  setTimeout(tw,del?40:80);
}

// ── boot ──────────────────────────────────────────────────────────────────────
var PEER_OK = typeof Peer !== 'undefined';
[
  {m:'SARA v5.0',t:'ok'},
  {m:'PeerJS: '+(PEER_OK?'LOADED':'FAILED — check CDN'),t:PEER_OK?'ok':'err'},
  {m:'buttons wired OK',t:'ok'},
  {m:PEER_OK?'ready — enter key and tap camera':'RELOAD PAGE if PeerJS failed',t:PEER_OK?'ok':'err'}
].forEach(function(l,i){setTimeout(function(){L(l.m,l.t);},i*200);});
tw();
