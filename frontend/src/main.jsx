import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import VirtualCamera from './components/VirtualCamera.jsx';
import './styles.css';

const root = createRoot(document.getElementById('root'));

// Check if this is a virtual camera request
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode');
const roomId = urlParams.get('room');

if (mode === 'virtual-camera' && roomId) {
  // Render standalone virtual camera page
  root.render(<VirtualCamera roomId={roomId} />);
} else {
  // Render normal app
  root.render(<App />);
}


