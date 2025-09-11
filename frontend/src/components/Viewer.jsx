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
  const remoteAudioRef = useRef(null);
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const [status, setStatus] = useState('Connecting...');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);

  // Face detection and tracking
  const detectorRef = useRef(null);
  const [faceStatus, setFaceStatus] = useState("Checking...");
  const [showFaceDetection, setShowFaceDetection] = useState(true);
  const [faceCount, setFaceCount] = useState(0);
  const processedVideoRef = useRef(null);
  
  // Face tracking oval
  const [faceTracking, setFaceTracking] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    visible: false
  });
  
  // Attendance system
  const [attendanceMode, setAttendanceMode] = useState(false);
  const [attendanceData, setAttendanceData] = useState([]);
  const [currentUser, setCurrentUser] = useState('');
  const [attendanceTimer, setAttendanceTimer] = useState(null);
  const [faceStabilityCount, setFaceStabilityCount] = useState(0);
  const STABILITY_THRESHOLD = 15; // frames needed for stable detection
  
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
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    });

    // Viewer is source of truth for attendance; broadcaster listens

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
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.muted = !isSpeakerOn;
      }
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

  // Attendance functions
  const toggleAttendanceMode = () => {
    const next = !attendanceMode;
    setAttendanceMode(next);
    if (socketRef.current) {
      socketRef.current.emit('attendance-mode', { roomId, enabled: next });
    }
    if (!next) {
      setCurrentUser('');
      setFaceStabilityCount(0);
    }
  };

  const markAttendance = (userName = currentUser || 'Unknown User') => {
    const timestamp = new Date().toLocaleString();
    const newEntry = {
      id: Date.now(),
      name: userName,
      timestamp: timestamp,
      status: 'Present'
    };
    
    setAttendanceData(prev => [...prev, newEntry]);
    setAttendanceMode(false);
    setCurrentUser('');
    setFaceStabilityCount(0);
    
    
  };

  const clearAttendance = () => {
    setAttendanceData([]);
  };

  // Stable checkbox component for face detection
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

    const interval = setInterval(checkStats, 5000);
    return () => clearInterval(interval);
  };

  // Load face detector
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

  // Process video frames with face detection and tracking
  useEffect(() => {
    const processFrame = async () => {
      if (!detectorRef.current || !remoteVideoRef.current || !canvasRef.current || frameProcessingRef.current) return;

      try {
        frameProcessingRef.current = true;
        
        const video = remoteVideoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        if (video.videoWidth === 0 || video.videoHeight === 0) {
          frameProcessingRef.current = false;
          return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Create detection canvas
        const detectionCanvas = document.createElement('canvas');
        const detectionCtx = detectionCanvas.getContext('2d');
        
        let scaleFactor = 1;
        if (connectionQuality === 'poor') {
          scaleFactor = 0.5;
        } else if (connectionQuality === 'fair') {
          scaleFactor = 0.75;
        }

        const detectionWidth = Math.floor(video.videoWidth * scaleFactor);
        const detectionHeight = Math.floor(video.videoHeight * scaleFactor);
        
        detectionCanvas.width = detectionWidth;
        detectionCanvas.height = detectionHeight;
        detectionCtx.drawImage(video, 0, 0, detectionWidth, detectionHeight);

        // Run face detection
        const faces = await detectorRef.current.estimateFaces(detectionCanvas);

        setFaceCount(faces.length);
        setFaceStatus(faces.length > 0 ? "Person detected" : "No person detected");

        if (faces.length > 0) {
          const face = faces[0]; // Use the first detected face
          const { xMin, yMin, width, height } = face.box;
          
          // Scale coordinates back to full resolution
          const scaledXMin = xMin / scaleFactor;
          const scaledYMin = yMin / scaleFactor;
          const scaledWidth = width / scaleFactor;
          const scaledHeight = height / scaleFactor;
          
          const centerX = scaledXMin + scaledWidth / 2;
          const centerY = scaledYMin + scaledHeight / 2;

          // Update face tracking visibility (used for non-attendance only)
          setFaceTracking({
            x: centerX,
            y: centerY,
            width: scaledWidth * 1.3,
            height: scaledHeight * 1.5,
            visible: !attendanceMode
          });

          // Attendance mode: use fixed oval at center of frame
          if (attendanceMode) {
            const aspect = canvas.height / Math.max(canvas.width, 1);
            let guideRx, guideRy;
            if (aspect > 1.3) {
              // Tall/portrait screens (mobile)
              guideRx = canvas.width * 0.30;
              guideRy = canvas.height * 0.27;
            } else if (aspect < 0.9) {
              // Wide/landscape screens
              guideRx = canvas.width * 0.32;
              guideRy = canvas.height * 0.30;
            } else {
              // Default laptop/tablet
              guideRx = canvas.width * 0.30;
              guideRy = canvas.height * 0.33;
            }
            const guideCx = canvas.width / 2;
            const guideCy = canvas.height / 2 - canvas.height * 0.05;

            // Check if face center is inside guide oval
            const norm = ((centerX - guideCx) ** 2) / (guideRx ** 2) + ((centerY - guideCy) ** 2) / (guideRy ** 2);
            const isInside = norm <= 1;

            // Draw only the guide oval and progress
            if (showFaceDetection) {
              ctx.strokeStyle = isInside ? "#00ff00" : "#ff6b6b";
              ctx.lineWidth = 4;
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.ellipse(guideCx, guideCy, guideRx, guideRy, 0, 0, Math.PI * 2);
              ctx.stroke();

              // Subtle fill
              ctx.fillStyle = isInside ? "rgba(0, 255, 0, 0.08)" : "rgba(255, 107, 107, 0.08)";
              ctx.beginPath();
              ctx.ellipse(guideCx, guideCy, guideRx, guideRy, 0, 0, Math.PI * 2);
              ctx.fill();

              // Progress ring above guide
              const progress = Math.min(faceStabilityCount / STABILITY_THRESHOLD, 1);
              ctx.strokeStyle = isInside ? "#00ff00" : "#ff6b6b";
              ctx.lineWidth = 6;
              ctx.beginPath();
              ctx.arc(guideCx, guideCy - guideRy - 30, 20, -Math.PI / 2, (-Math.PI / 2) + (progress * Math.PI * 2));
              ctx.stroke();
            }

            // Update stability and emit status
            if (socketRef.current) {
              socketRef.current.emit('attendance-status', { roomId, detected: isInside });
            }
            // Only update indicator; do not auto-mark attendance
            setFaceStabilityCount(isInside ? Math.min(faceStabilityCount + 1, STABILITY_THRESHOLD) : 0);
          } else if (showFaceDetection) {
            // Suppress previous face outline drawing in non-attendance mode
          }
        } else {
          // No face detected
          setFaceTracking(prev => ({ ...prev, visible: false }));
          if (attendanceMode) {
            setFaceStabilityCount(0);
            // Draw guide even when no face
            const aspect = canvas.height / Math.max(canvas.width, 1);
            let guideRx, guideRy;
            if (aspect > 1.3) {
              guideRx = canvas.width * 0.30;
              guideRy = canvas.height * 0.27;
            } else if (aspect < 0.9) {
              guideRx = canvas.width * 0.32;
              guideRy = canvas.height * 0.30;
            } else {
              guideRx = canvas.width * 0.30;
              guideRy = canvas.height * 0.33;
            }
            const guideCx = canvas.width / 2;
            const guideCy = canvas.height / 2 - canvas.height * 0.05;
            if (showFaceDetection) {
              ctx.strokeStyle = "#ff6b6b";
              ctx.lineWidth = 4;
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.ellipse(guideCx, guideCy, guideRx, guideRy, 0, 0, Math.PI * 2);
              ctx.stroke();
            }
            if (socketRef.current) {
              socketRef.current.emit('attendance-status', { roomId, detected: false });
            }
          }
        }

        // Display the processed frame
        if (processedVideoRef.current) {
          processedVideoRef.current.src = canvas.toDataURL();
        }

      } catch (err) {
        console.error("Face detection error:", err);
        setFaceStatus("Detection error");
        setFaceCount(0);
        setFaceTracking(prev => ({ ...prev, visible: false }));
      } finally {
        frameProcessingRef.current = false;
      }
    };

    let interval;
    if (connectionQuality === 'poor') {
      interval = setInterval(processFrame, 300);
    } else if (connectionQuality === 'fair') {
      interval = setInterval(processFrame, 200);
    } else {
      interval = setInterval(processFrame, 100);
    }

    return () => {
      clearInterval(interval);
    };
  }, [showFaceDetection, connectionQuality, attendanceMode, currentUser, faceStabilityCount]);

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
          <label className="checkbox" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={isSpeakerOn}
              onChange={(e) => {
                const next = e.target.checked;
                setIsSpeakerOn(next);
                if (remoteAudioRef.current) remoteAudioRef.current.muted = !next;
              }}
            />
            <span>Speaker {isSpeakerOn ? 'On' : 'Off'}</span>
          </label>
          
          {/* Attendance Controls */}
          <button 
            className={`btn ${attendanceMode ? 'btn-success' : 'btn-primary'}`} 
            onClick={toggleAttendanceMode}
          >
            {attendanceMode ? 'Cancel Attendance' : 'Take Attendance'}
          </button>
          
          {attendanceData.length > 0 && (
            <button className="btn btn-warning" onClick={clearAttendance}>
              Clear Attendance
            </button>
          )}
          
          <button className="btn btn-secondary" onClick={toggleFullscreen}>
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
          <button className="btn btn-secondary" onClick={onLeave}>Leave</button>
        </div>
      </div>

      {/* Attendance Mode Input */}
      {attendanceMode && (
        <div className="attendance-input-panel">
          <div className="row">
            <input
              type="text"
              placeholder="Enter your name..."
              value={currentUser}
              onChange={(e) => setCurrentUser(e.target.value)}
              className="attendance-input"
              autoFocus
            />
            <button 
              className="btn btn-success" 
              onClick={() => markAttendance()}
              disabled={!currentUser.trim() || faceCount === 0}
            >
              Mark Present
            </button>
          </div>
          <div className="attendance-instructions">
            {faceCount === 0 ? (
              <span style={{ color: '#ff6b6b' }}>Please position your face in view</span>
            ) : (
              <span style={{ color: '#51cf66' }}>
                Face detected! {faceStabilityCount > 0 && `Stabilizing... ${Math.round((faceStabilityCount / STABILITY_THRESHOLD) * 100)}%`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Attendance List */}
      {attendanceData.length > 0 && (
        <div className="attendance-list">
          <h3>Attendance Record ({attendanceData.length})</h3>
          <div className="attendance-items">
            {attendanceData.map((entry) => (
              <div key={entry.id} className="attendance-item">
                <span className="attendance-name">{entry.name}</span>
                <span className="attendance-time">{entry.timestamp}</span>
                <span className="attendance-status">{entry.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`video-shell ${isFullscreen ? 'fullscreen' : ''}`} style={{ position: "relative" }}>
        {/* Original video (hidden) */}
        <video ref={remoteVideoRef} className="video" autoPlay playsInline controls={false} style={{ display: 'none' }} />
        {/* Hidden audio element to handle remote audio playback */}
        <audio ref={remoteAudioRef} autoPlay muted={!isSpeakerOn} />
        
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
                {attendanceMode ? '📝' : (faceCount > 0 ? '👤' : '👁️')}
              </div>
              <div className="face-detection-content">
                <div className="face-detection-status">
                  {attendanceMode ? 
                    (faceCount > 0 ? 'Ready for attendance' : 'Position your face') : 
                    faceStatus
                  }
                </div>
                {faceCount > 0 && !attendanceMode && (
                  <div className="face-detection-count">
                    {faceCount} {faceCount === 1 ? 'person' : 'people'}
                  </div>
                )}
                {attendanceMode && faceCount > 0 && currentUser.trim() && (
                  <div className="face-detection-count">
                    {faceStabilityCount >= STABILITY_THRESHOLD ? 'Ready to mark!' : 'Hold still...'}
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
              <label className="checkbox" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={isSpeakerOn}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setIsSpeakerOn(next);
                    if (remoteAudioRef.current) remoteAudioRef.current.muted = !next;
                  }}
                />
                <span>Speaker {isSpeakerOn ? 'On' : 'Off'}</span>
              </label>
              <button 
                className={`btn ${attendanceMode ? 'btn-success' : 'btn-primary'}`} 
                onClick={toggleAttendanceMode}
              >
                {attendanceMode ? 'Cancel Attendance' : 'Take Attendance'}
              </button>
              <button className="btn btn-secondary" onClick={toggleFullscreen}>
                Exit Fullscreen
              </button>
              <button className="btn btn-secondary" onClick={onLeave}>Leave</button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .attendance-input-panel {
          background: rgba(0, 0, 0, 0.8);
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 10px;
        }
        
        .attendance-input {
          padding: 8px 12px;
          border: 1px solid #ccc;
          border-radius: 4px;
          margin-right: 10px;
          min-width: 200px;
        }
        
        .attendance-instructions {
          margin-top: 8px;
          font-size: 14px;
        }
        
        .attendance-list {
          background: rgba(255, 255, 255, 0.95);
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 10px;
          max-height: 200px;
          overflow-y: auto;
        }
        
        .attendance-list h3 {
          margin: 0 0 10px 0;
          color: #333;
        }
        
        .attendance-items {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .attendance-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px;
          background: #f8f9fa;
          border-radius: 4px;
          border-left: 3px solid #28a745;
        }
        
        .attendance-name {
          font-weight: bold;
          color: #333;
        }
        
        .attendance-time {
          font-size: 12px;
          color: #666;
        }
        
        .attendance-status {
          background: #28a745;
          color: white;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 12px;
        }
        
        .btn-success {
          background: #28a745;
          color: white;
          border: 1px solid #28a745;
        }
        
        .btn-success:hover {
          background: #218838;
          border-color: #1e7e34;
        }
        
        .btn-primary {
          background: #007bff;
          color: white;
          border: 1px solid #007bff;
        }
        
        .btn-primary:hover {
          background: #0056b3;
          border-color: #004085;
        }
        
        .btn-warning {
          background: #ffc107;
          color: #212529;
          border: 1px solid #ffc107;
        }
        
        .btn-warning:hover {
          background: #e0a800;
          border-color: #d39e00;
        }
      `}</style>
    </div>
  );
}