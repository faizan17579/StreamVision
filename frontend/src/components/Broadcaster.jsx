import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// With Vite proxy, same-origin Socket.IO path
const SIGNALING_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.host}`
  : 'http://localhost:3000';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function Broadcaster({ roomId, onStop }) {
  const localVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peersRef = useRef(new Map()); // viewerId -> RTCPeerConnection
  const localStreamRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [camera, setCamera] = useState('user'); // 'user' | 'environment'
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const [videoQuality, setVideoQuality] = useState('high'); // 'low' | 'medium' | 'high' | 'ultra'
  const [connectionQuality, setConnectionQuality] = useState('good');

  // Video quality configurations
  const getVideoConstraints = (quality) => {
    const configs = {
      low: {
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 15, max: 30 },
        facingMode: { ideal: camera }
      },
      medium: {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 24, max: 30 },
        facingMode: { ideal: camera }
      },
      high: {
        width: { ideal: 1920, max: 2560 },
        height: { ideal: 1080, max: 1440 },
        frameRate: { ideal: 30, max: 60 },
        facingMode: { ideal: camera }
      },
      ultra: {
        width: { ideal: 2560, max: 3840 },
        height: { ideal: 1440, max: 2160 },
        frameRate: { ideal: 30, max: 60 },
        facingMode: { ideal: camera }
      }
    };
    return configs[quality] || configs.high;
  };

  // Detect device capabilities and adjust quality accordingly
  const detectOptimalQuality = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      
      // Test different qualities to find the best supported one
      for (const quality of ['ultra', 'high', 'medium', 'low']) {
        try {
          const constraints = getVideoConstraints(quality);
          const stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
          stream.getTracks().forEach(track => track.stop());
          
          // If we can get this quality, use it
          setVideoQuality(quality);
          break;
        } catch (error) {
          console.log(`Quality ${quality} not supported, trying next...`);
        }
      }
    } catch (error) {
      console.error('Error detecting optimal quality:', error);
      setVideoQuality('medium'); // fallback
    }
  };

  // Initialize socket connection once
  useEffect(() => {
    const socket = io(SIGNALING_URL, { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-room', { roomId, role: 'broadcaster' });
    });

    socket.on('viewer-joined', async ({ viewerId }) => {
      await createOfferForViewer(viewerId);
    });

    socket.on('answer', async ({ from, sdp }) => {
      const pc = peersRef.current.get(from);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    });

    socket.on('ice-candidate', async ({ from, candidate }) => {
      const pc = peersRef.current.get(from);
      if (pc && candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      }
    });

    socket.on('viewer-left', ({ viewerId }) => {
      const pc = peersRef.current.get(viewerId);
      if (pc) {
        pc.close();
        peersRef.current.delete(viewerId);
      }
    });

    return () => {
      for (const [, pc] of peersRef.current) pc.close();
      peersRef.current.clear();
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [roomId]);

  // Initialize camera stream
  useEffect(() => {
    async function initCamera() {
      try {
        setIsSwitchingCamera(true);
        
        // Detect optimal quality on first load
        if (!isReady) {
          await detectOptimalQuality();
        }
        
        const videoConstraints = getVideoConstraints(videoQuality);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: true
        });
        
        // Stop old stream
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
        }
        
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          try { await localVideoRef.current.play(); } catch {}
        }

        // Replace tracks in existing peer connections
        for (const [viewerId, pc] of peersRef.current) {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) {
            await sender.replaceTrack(stream.getVideoTracks()[0]);
          }
        }

        setIsReady(true);
        setIsSwitchingCamera(false);
      } catch (error) {
        console.error('Failed to switch camera:', error);
        setIsSwitchingCamera(false);
      }
    }

    initCamera();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [camera, videoQuality]);

  // Monitor connection quality
  const monitorConnectionQuality = (pc) => {
    const checkStats = async () => {
      try {
        const stats = await pc.getStats();
        let totalBytesSent = 0;
        let totalPacketsLost = 0;
        let totalPacketsSent = 0;

        stats.forEach(report => {
          if (report.type === 'outbound-rtp' && report.mediaType === 'video') {
            totalBytesSent += report.bytesSent || 0;
            totalPacketsLost += report.packetsLost || 0;
            totalPacketsSent += report.packetsSent || 0;
          }
        });

        if (totalPacketsSent > 0) {
          const packetLossRate = (totalPacketsLost / totalPacketsSent) * 100;
          
          if (packetLossRate > 5) {
            setConnectionQuality('poor');
            // Auto-adjust quality down if connection is poor
            if (videoQuality !== 'low') {
              const qualityLevels = ['ultra', 'high', 'medium', 'low'];
              const currentIndex = qualityLevels.indexOf(videoQuality);
              if (currentIndex < qualityLevels.length - 1) {
                setVideoQuality(qualityLevels[currentIndex + 1]);
              }
            }
          } else if (packetLossRate > 2) {
            setConnectionQuality('fair');
          } else {
            setConnectionQuality('good');
          }
        }
      } catch (error) {
        console.error('Error monitoring connection quality:', error);
      }
    };

    // Check stats every 5 seconds
    const interval = setInterval(checkStats, 5000);
    return () => clearInterval(interval);
  };

  async function createOfferForViewer(viewerId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(viewerId, pc);

    // add local tracks if stream is available
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    }

    // Start monitoring connection quality
    const stopMonitoring = monitorConnectionQuality(pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', {
          roomId,
          to: viewerId,
          from: socketRef.current.id,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'closed') {
        stopMonitoring();
      }
    };

    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);

    socketRef.current.emit('offer', {
      roomId,
      to: viewerId,
      from: socketRef.current.id,
      sdp: offer
    });
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="section-title">Broadcaster</div>
        <div className="controls">
          <span className="status">
            {isSwitchingCamera ? 'Switching Camera...' : (isReady ? 'Connected' : 'Connecting...')}
          </span>
          <button className="btn btn-secondary" onClick={onStop}>Stop</button>
        </div>
      </div>
      <div className="controls">
        <div className="field">
          <label htmlFor="camera">Camera</label>
          <select 
            id="camera" 
            className="select" 
            value={camera} 
            onChange={(e) => setCamera(e.target.value)}
            disabled={isSwitchingCamera}
          >
            <option value="user">Front</option>
            <option value="environment">Back</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="quality">Video Quality</label>
          <select 
            id="quality" 
            className="select" 
            value={videoQuality} 
            onChange={(e) => setVideoQuality(e.target.value)}
            disabled={isSwitchingCamera}
          >
            <option value="low">Low (640x480)</option>
            <option value="medium">Medium (1280x720)</option>
            <option value="high">High (1920x1080)</option>
            <option value="ultra">Ultra (2560x1440)</option>
          </select>
        </div>
        <div className="field">
          <label>Connection</label>
          <div className={`connection-indicator ${connectionQuality}`}>
            <span className="connection-dot"></span>
            <span className="connection-text">
              {connectionQuality === 'good' ? 'Good' : 
               connectionQuality === 'fair' ? 'Fair' : 'Poor'}
            </span>
          </div>
        </div>
      </div>
      <div className="video-shell">
        <video ref={localVideoRef} className="video" autoPlay muted playsInline />
      </div>
    </div>
  );
}


