import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import * as tf from '@tensorflow/tfjs';
import * as faceDetection from '@tensorflow-models/face-detection';

const SIGNALING_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.host}`
  : 'http://localhost:3000';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function VirtualCamera({ roomId }) {
  const remoteVideoRef = useRef(null);
  const canvasRef = useRef(null); // For processing frames
  const processedVideoRef = useRef(null); // For displaying processed video
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const [status, setStatus] = useState('Connecting...');
  const [isConnected, setIsConnected] = useState(false);
  
  // Face detection states
  const detectorRef = useRef(null);
  const [faceStatus, setFaceStatus] = useState("Checking...");
  const [showFaceDetection, setShowFaceDetection] = useState(true);
  const [faceCount, setFaceCount] = useState(0);

  useEffect(() => {
    const socket = io(SIGNALING_URL, { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-room', { roomId, role: 'viewer' });
      setStatus('Waiting for broadcaster...');
    });

    socket.on('broadcaster-ready', async ({ broadcasterId }) => {
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
      setIsConnected(false);
    });

    return () => {
      if (pcRef.current) pcRef.current.close();
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [roomId]);

  // Load face detector once
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

  // Process video frames with face detection
  useEffect(() => {
    const processFrame = async () => {
      if (!detectorRef.current || !remoteVideoRef.current || !canvasRef.current || !isConnected) return;

      try {
        const video = remoteVideoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        // Check if video is ready
        if (video.videoWidth === 0 || video.videoHeight === 0) return;

        // Set canvas size to match video dimensions exactly
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Clear canvas and draw the current video frame
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Run face detection on the current frame
        const faces = await detectorRef.current.estimateFaces(canvas);

        // Update status
        setFaceCount(faces.length);
        setFaceStatus(faces.length > 0 ? "Person detected" : "No person detected");

        // Skip drawing any shapes around faces per request

        // Display the processed frame
        if (processedVideoRef.current) {
          processedVideoRef.current.src = canvas.toDataURL();
        }

      } catch (err) {
        console.error("Face detection error:", err);
        setFaceStatus("Detection error");
        setFaceCount(0);
      }
    };

    const interval = setInterval(processFrame, 100); // Process every 100ms for smoother detection

    return () => clearInterval(interval);
  }, [isConnected]);

  async function ensurePeerConnection(expectedRemoteId) {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      setStatus('Receiving stream');
      setIsConnected(true);
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

    pc.onnegotiationneeded = async () => {};

    return pc;
  }

  return (
    <>
      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          margin: 0;
          padding: 0;
          overflow: hidden;
        }
        #root {
          margin: 0;
          padding: 0;
        }
        
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
        }
      `}</style>
      <div style={{
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        backgroundColor: '#000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Arial, sans-serif',
        color: '#fff',
        overflow: 'hidden',
        position: 'fixed',
        top: 0,
        left: 0
      }}>
      {/* Status indicator */}
      <div style={{
        position: 'absolute',
        top: '100px',
        left: '20px',
        backgroundColor: isConnected ? '#4CAF50' : '#f44336',
        color: 'white',
        padding: '10px 20px',
        borderRadius: '5px',
        fontSize: '14px',
        fontWeight: 'bold',
        zIndex: 1000,
        transform: 'scaleX(-1)' // Flip horizontally for virtual camera
      }}>
        {status}
      </div>

      {/* Room ID and Face Detection Toggle */}
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        zIndex: 1000,
        transform: 'scaleX(-1)' // Flip horizontally for virtual camera
      }}>
        <button
          onClick={() => setShowFaceDetection(!showFaceDetection)}
          style={{
            backgroundColor: showFaceDetection ? '#4CAF50' : '#666',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '5px',
            fontSize: '12px',
            cursor: 'pointer',
            fontWeight: 'bold',
            transition: 'background-color 0.3s'
          }}
          title="Toggle face detection display"
        >
          {showFaceDetection ? 'Hide Face Detection' : 'Show Face Detection'}
        </button>
        <div style={{
          backgroundColor: 'rgba(0,0,0,0.7)',
          color: 'white',
          padding: '10px 20px',
          borderRadius: '5px',
          fontSize: '14px'
        }}>
          Room: {roomId}
        </div>
      </div>

      {/* Video container */}
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative'
      }}>
        {/* Original video (hidden) */}
        <video 
          ref={remoteVideoRef} 
          style={{
            display: 'none'
          }}
          autoPlay 
          playsInline 
          controls={false}
          muted={false}
        />
        
        {/* Processed video with face detection */}
        <img 
          ref={processedVideoRef} 
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            backgroundColor: '#000',
            display: 'block'
          }}
        />
        
        {/* Hidden canvas for processing */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        
        {/* Face Detection Overlay */}
        {showFaceDetection && isConnected && (
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            zIndex: 10,
            pointerEvents: 'none',
            transform: 'scaleX(-1)' // Flip horizontally for virtual camera
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: faceCount > 0 ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
              backdropFilter: 'blur(10px)',
              borderRadius: '12px',
              padding: '8px 12px',
              border: `1px solid ${faceCount > 0 ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              boxShadow: `0 0 20px ${faceCount > 0 ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              transition: 'all 0.3s ease',
              animation: 'slideIn 0.3s ease-out'
            }}>
              <div style={{
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.2)',
                animation: 'pulse 2s infinite'
              }}>
                {faceCount > 0 ? '👤' : '👁️'}
              </div>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}>
                <div style={{
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: '600',
                  textShadow: '0 1px 2px rgba(0, 0, 0, 0.5)'
                }}>
                  {faceStatus}
                </div>
                {faceCount > 0 && (
                  <div style={{
                    color: 'rgba(255, 255, 255, 0.8)',
                    fontSize: '11px',
                    fontWeight: '500'
                  }}>
                    {faceCount} {faceCount === 1 ? 'person' : 'people'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* No signal overlay */}
        {!isConnected && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            color: '#666'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>📺</div>
            <div style={{ fontSize: '24px', marginBottom: '10px' }}>No Signal</div>
            <div style={{ fontSize: '16px' }}>Waiting for broadcaster to connect...</div>
          </div>
        )}
      </div>

      {/* Instructions overlay (only show when connected) */}
      {isConnected && (
        <div style={{
          position: 'absolute',
          bottom: '20px',
          left: '20px',
          backgroundColor: 'rgba(0,0,0,0.8)',
          color: 'white',
          padding: '15px',
          borderRadius: '5px',
          fontSize: '12px',
          maxWidth: '300px',
          zIndex: 1000,
          transform: 'scaleX(-1)' // Flip horizontally for virtual camera
        }}>
         
          
        </div>
      )}
      </div>
    </>
  );
}
