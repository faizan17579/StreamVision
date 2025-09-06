import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';
import * as tf from '@tensorflow/tfjs';
import * as faceDetection from '@tensorflow-models/face-detection';

const SIGNALING_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.host}`
  : 'http://localhost:3000';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function Viewer({ roomId, onLeave }) {
  const remoteVideoRef = useRef(null);
  const canvasRef = useRef(null); // 👈 NEW canvas
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const [status, setStatus] = useState('Connecting...');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 👇 Face detection
  const detectorRef = useRef(null);
  const [faceStatus, setFaceStatus] = useState("Checking...");
  const [showFaceDetection, setShowFaceDetection] = useState(true);
  const [faceCount, setFaceCount] = useState(0);
  const processedVideoRef = useRef(null); // For displaying processed video
  
  // Video quality optimization
  const [videoQuality, setVideoQuality] = useState('auto');
  const [connectionQuality, setConnectionQuality] = useState('good');
  const frameProcessingRef = useRef(false);

  useEffect(() => {
    const socket = io(SIGNALING_URL, { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-room', { roomId, role: 'viewer' });
      setStatus('Waiting for broadcaster...');
    });

    socket.on('broadcaster-ready', () => {
      setStatus('Broadcaster ready');
    });

    socket.on('offer', async ({ from, sdp }) => {
      await ensurePeerConnection(from);
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socket.emit('answer', { roomId, to: from, from: socket.id, sdp: answer });
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      if (pcRef.current && candidate) {
        try { await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      }
    });

    socket.on('broadcaster-left', () => {
      setStatus('Broadcaster left');
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    });

    return () => {
      if (pcRef.current) pcRef.current.close();
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [roomId]);

  async function ensurePeerConnection(expectedRemoteId) {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      setStatus('Receiving stream');
      
      // Start monitoring connection quality
      monitorConnectionQuality(pc);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', {
          roomId,
          to: expectedRemoteId,
          from: socketRef.current.id,
          candidate: event.candidate
        });
      }
    };

    return pc;
  }

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Stable checkbox component that doesn't re-render
  const FaceDetectionCheckbox = useMemo(() => {
    const handleToggle = () => {
      setShowFaceDetection(prev => !prev);
    };

    return (
      <label className="face-detection-checkbox">
        <input
          type="checkbox"
          checked={showFaceDetection}
          onChange={handleToggle}
        />
        <span className="checkbox-label">Face Detection</span>
      </label>
    );
  }, [showFaceDetection]);

  // Monitor connection quality
  const monitorConnectionQuality = (pc) => {
    const checkStats = async () => {
      try {
        const stats = await pc.getStats();
        let totalBytesReceived = 0;
        let totalPacketsLost = 0;
        let totalPacketsReceived = 0;

        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
            totalBytesReceived += report.bytesReceived || 0;
            totalPacketsLost += report.packetsLost || 0;
            totalPacketsReceived += report.packetsReceived || 0;
          }
        });

        if (totalPacketsReceived > 0) {
          const packetLossRate = (totalPacketsLost / totalPacketsReceived) * 100;
          
          if (packetLossRate > 5) {
            setConnectionQuality('poor');
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

  // 👇 Load face detector
  useEffect(() => {
    const loadModel = async () => {
      await tf.ready();
      detectorRef.current = await faceDetection.createDetector(
        faceDetection.SupportedModels.MediaPipeFaceDetector,
        { runtime: 'tfjs' }
      );
    };
    loadModel();
  }, []);

  // 👇 Process video frames with face detection (optimized)
  useEffect(() => {
    const processFrame = async () => {
      if (!detectorRef.current || !remoteVideoRef.current || !canvasRef.current || frameProcessingRef.current) return;

      try {
        frameProcessingRef.current = true;
        
        const video = remoteVideoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        // Check if video is ready
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          frameProcessingRef.current = false;
          return;
        }

        // Always use full video resolution for display canvas
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Clear canvas and draw the current video frame at full resolution
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Create a separate canvas for face detection with optimized size
        const detectionCanvas = document.createElement('canvas');
        const detectionCtx = detectionCanvas.getContext('2d');
        
        // Optimize detection canvas size based on connection quality
        let scaleFactor = 1;
        if (connectionQuality === 'poor') {
          scaleFactor = 0.5; // Reduce processing load for poor connections
        } else if (connectionQuality === 'fair') {
          scaleFactor = 0.75;
        }

        const detectionWidth = Math.floor(video.videoWidth * scaleFactor);
        const detectionHeight = Math.floor(video.videoHeight * scaleFactor);
        
        detectionCanvas.width = detectionWidth;
        detectionCanvas.height = detectionHeight;
        
        // Draw video frame to detection canvas at optimized size
        detectionCtx.drawImage(video, 0, 0, detectionWidth, detectionHeight);

        // Run face detection on the optimized detection canvas
        const faces = await detectorRef.current.estimateFaces(detectionCanvas);

        // Update status
        setFaceCount(faces.length);
        setFaceStatus(faces.length > 0 ? "Person detected" : "No person detected");

        // Only draw face detection if enabled
        if (showFaceDetection && faces.length > 0) {
          // Draw face shapes on the display canvas with correct coordinates
          faces.forEach(face => {
            const { xMin, yMin, width, height } = face.box;
            
            // Scale coordinates back to full resolution
            const scaledXMin = xMin / scaleFactor;
            const scaledYMin = yMin / scaleFactor;
            const scaledWidth = width / scaleFactor;
            const scaledHeight = height / scaleFactor;
            
            const centerX = scaledXMin + scaledWidth / 2;
            const centerY = scaledYMin + scaledHeight / 2;
            const aspectRatio = scaledWidth / scaledHeight;
            
            ctx.strokeStyle = "lime";
            ctx.lineWidth = 3;
            
            // Determine face shape based on aspect ratio
            if (aspectRatio > 0.9 && aspectRatio < 1.1) {
              // Square face
              ctx.beginPath();
              ctx.rect(scaledXMin - 5, scaledYMin - 5, scaledWidth + 10, scaledHeight + 10);
              ctx.stroke();
            } else if (aspectRatio < 0.8) {
              // Long/Rectangle face
              ctx.beginPath();
              ctx.rect(scaledXMin - 5, scaledYMin - 5, scaledWidth + 10, scaledHeight + 10);
              ctx.stroke();
            } else if (aspectRatio > 1.2) {
              // Round face
              ctx.beginPath();
              ctx.arc(centerX, centerY, Math.max(scaledWidth, scaledHeight) / 2 + 5, 0, Math.PI * 2);
              ctx.stroke();
            } else if (aspectRatio > 0.8 && aspectRatio < 1.2) {
              // Oval face
              ctx.beginPath();
              ctx.ellipse(centerX, centerY, scaledWidth / 2 + 5, scaledHeight / 2 + 5, 0, 0, Math.PI * 2);
              ctx.stroke();
            } else {
              // Diamond face
              ctx.beginPath();
              ctx.moveTo(centerX, scaledYMin - 5); // Top
              ctx.lineTo(scaledXMin + scaledWidth + 5, centerY); // Right
              ctx.lineTo(centerX, scaledYMin + scaledHeight + 5); // Bottom
              ctx.lineTo(scaledXMin - 5, centerY); // Left
              ctx.closePath();
              ctx.stroke();
            }
          });
        }

        // Display the processed frame
        if (processedVideoRef.current) {
          processedVideoRef.current.src = canvas.toDataURL();
        }

      } catch (err) {
        console.error("Face detection error:", err);
        setFaceStatus("Detection error");
        setFaceCount(0);
      } finally {
        frameProcessingRef.current = false;
      }
    };

    // Adaptive processing interval based on connection quality
    let interval;
    if (connectionQuality === 'poor') {
      interval = setInterval(processFrame, 300); // Slower processing for poor connections
    } else if (connectionQuality === 'fair') {
      interval = setInterval(processFrame, 200); // Medium processing
    } else {
      interval = setInterval(processFrame, 100); // Fast processing for good connections
    }

    return () => {
      clearInterval(interval);
    };
  }, [showFaceDetection, connectionQuality]);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="section-title">Viewer</div>
        <div className="controls">
          <span className="status">{status}</span>
          <div className="connection-indicator">
            <span className="connection-dot"></span>
            <span className="connection-text">
              {connectionQuality === 'good' ? 'Good' : 
               connectionQuality === 'fair' ? 'Fair' : 'Poor'}
            </span>
          </div>
          {FaceDetectionCheckbox}
          <button className="btn btn-secondary" onClick={toggleFullscreen}>
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
          <button className="btn btn-secondary" onClick={onLeave}>Leave</button>
        </div>
      </div>

      <div className={`video-shell ${isFullscreen ? 'fullscreen' : ''}`} style={{ position: "relative" }}>
        {/* Original video (hidden) */}
        <video ref={remoteVideoRef} className="video" autoPlay playsInline controls={false} style={{ display: 'none' }} />
        
        {/* Processed video with face detection */}
        <img ref={processedVideoRef} className="video" style={{ 
          width: '100%', 
          height: '100%', 
          objectFit: 'contain',
          display: 'block'
        }} />
        
        {/* Hidden canvas for processing */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {showFaceDetection && (
          <div className="face-detection-overlay">
            <div className={`face-detection-indicator ${faceCount > 0 ? 'detected' : 'not-detected'}`}>
              <div className="face-detection-icon">
                {faceCount > 0 ? '👤' : '👁️'}
              </div>
              <div className="face-detection-content">
                <div className="face-detection-status">{faceStatus}</div>
                {faceCount > 0 && (
                  <div className="face-detection-count">
                    {faceCount} {faceCount === 1 ? 'person' : 'people'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {isFullscreen && (
          <div className="fullscreen-controls">
            <div className="controls">
              <span className="status">{status}</span>
              {FaceDetectionCheckbox}
              <button className="btn btn-secondary" onClick={toggleFullscreen}>
                Exit Fullscreen
              </button>
              <button className="btn btn-secondary" onClick={onLeave}>Leave</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
