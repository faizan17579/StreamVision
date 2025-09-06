import React, { useState } from 'react';
import Broadcaster from './components/Broadcaster.jsx';
import Viewer from './components/Viewer.jsx';

export default function App() {
  const [roomId, setRoomId] = useState('room-1');
  const [role, setRole] = useState(null); // 'broadcaster' | 'viewer'

  return (
    <div className="container">
      <div className="app-header">
        <div>
          <h2 className="app-title">WebRTC Live</h2>
          <div className="subtitle">Peer-to-peer live streaming demo</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="controls" style={{ marginBottom: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="room">Room ID</label>
            <input
              id="room"
              className="input"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Enter room id"
            />
          </div>
          <button className="btn" onClick={() => setRole('broadcaster')} disabled={!roomId}>
            Start Broadcasting
          </button>
          <button className="btn btn-secondary" onClick={() => setRole('viewer')} disabled={!roomId}>
            Join as Viewer
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={() => {
              const virtualCameraUrl = `${window.location.origin}${window.location.pathname}?mode=virtual-camera&room=${roomId}`;
              window.open(virtualCameraUrl, '_blank');
            }} 
            disabled={!roomId}
          >
            Open Virtual Camera
          </button>
        </div>
      </div>

      {role === 'broadcaster' && (
        <div className="card">
          <Broadcaster roomId={roomId} onStop={() => setRole(null)} />
        </div>
      )}
      {role === 'viewer' && (
        <div className="card">
          <Viewer roomId={roomId} onLeave={() => setRole(null)} />
        </div>
      )}
    </div>
  );
}


