# WebRTC Live Streaming with Face Detection

A real-time peer-to-peer live streaming application built with React, Node.js, and WebRTC technology. Features include live video streaming, face detection with TensorFlow.js, virtual camera support for OBS, and adaptive video quality based on connection performance.

## 🚀 Features

- **Real-time Video Streaming**: Peer-to-peer WebRTC connections for low-latency streaming
- **Face Detection**: AI-powered face detection using TensorFlow.js with real-time face shape analysis
- **Virtual Camera**: OBS-compatible virtual camera with face detection overlays
- **Adaptive Quality**: Automatic video quality adjustment based on network conditions
- **Multi-device Support**: Front/back camera switching and quality controls
- **Room-based Streaming**: Multiple rooms for different streaming sessions
- **Connection Monitoring**: Real-time connection quality indicators

## 🏗️ Project Structure

```
├── backend/                 # Node.js signaling server
│   ├── server.js           # Express + Socket.IO server
│   └── package.json        # Backend dependencies
├── frontend/               # React application
│   ├── src/
│   │   ├── components/
│   │   │   ├── App.jsx     # Main application component
│   │   │   ├── Broadcaster.jsx  # Stream broadcaster interface
│   │   │   ├── Viewer.jsx       # Stream viewer interface
│   │   │   └── VirtualCamera.jsx # OBS virtual camera
│   │   ├── main.jsx        # React entry point
│   │   └── styles.css      # Application styles
│   ├── vite.config.js      # Vite configuration with HTTPS
│   └── package.json        # Frontend dependencies
└── package.json            # Root dependencies (TensorFlow.js)
```

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v16 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **Modern web browser** with WebRTC support (Chrome, Firefox, Safari, Edge)
- **Camera and microphone** access permissions

## 🛠️ Installation & Setup

### Step 1: Clone or Download the Project

```bash
# If using git
git clone <repository-url>
cd <project-directory>

# Or download and extract the project files
```

### Step 2: Install Dependencies

Install dependencies for all parts of the application:

```bash
# Install root dependencies (TensorFlow.js models)
npm install

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### Step 3: Start the Backend Server

```bash
# From the backend directory
cd backend
npm start

# Or for development with auto-restart
npm run dev
```

The backend server will start on `http://localhost:5000`

### Step 4: Start the Frontend Application

```bash
# From the frontend directory
cd frontend
npm run dev
```

The frontend application will start on `https://localhost:3000` (HTTPS is required for camera access)

## 🎯 How to Use

### 1. Basic Streaming Setup

1. **Start the Application**: Open `https://localhost:3000` in your browser
2. **Enter Room ID**: Choose a unique room name (e.g., "my-stream")
3. **Choose Your Role**:
   - **Start Broadcasting**: Stream your camera to viewers
   - **Join as Viewer**: Watch someone else's stream
   - **Open Virtual Camera**: Launch OBS-compatible virtual camera

### 2. Broadcasting

When you click "Start Broadcasting":
- Grant camera and microphone permissions when prompted
- Your camera feed will appear in the broadcaster interface
- Adjust camera settings (front/back camera, video quality)
- Monitor connection quality in real-time
- Viewers can join your room and watch your stream

### 3. Viewing Streams

When you click "Join as Viewer":
- You'll connect to the room and wait for a broadcaster
- Once a broadcaster starts streaming, you'll see their video feed
- The stream is peer-to-peer for optimal performance

### 4. Virtual Camera for OBS

The virtual camera feature is designed for streaming software like OBS Studio:

1. Click "Open Virtual Camera" to launch the virtual camera interface
2. In OBS Studio:
   - Add a new "Browser Source"
   - Set the URL to the virtual camera page
   - Or use "Window Capture" to capture the virtual camera window
3. The virtual camera includes:
   - Face detection overlays
   - Real-time face shape analysis
   - Connection status indicators
   - Optimized for streaming software

## 🔧 Configuration

### Video Quality Settings

The application supports multiple video quality levels:

- **Low**: 640x480 @ 15fps (for poor connections)
- **Medium**: 1280x720 @ 24fps (balanced)
- **High**: 1920x1080 @ 30fps (default)
- **Ultra**: 2560x1440 @ 30fps (for high-end devices)

Quality is automatically adjusted based on network conditions.

### Face Detection Features

The face detection system provides:

- **Real-time Detection**: Processes video frames at 10fps
- **Face Shape Analysis**: Detects and categorizes face shapes (oval, square, round, etc.)
- **Visual Overlays**: Draws shapes around detected faces
- **Toggle Controls**: Show/hide face detection overlays

## 🌐 Network Configuration

### Development Setup

The application is configured for local development:

- **Frontend**: `https://localhost:3000` (HTTPS required for camera access)
- **Backend**: `http://localhost:5000` (WebRTC signaling server)
- **Proxy**: Vite proxy forwards Socket.IO requests to backend

### Production Deployment

For production deployment:

1. **Update CORS settings** in `backend/server.js`
2. **Configure HTTPS** for both frontend and backend
3. **Set up proper domain names**
4. **Configure firewall** to allow WebRTC traffic
5. **Consider using TURN servers** for NAT traversal

## 📚 Dependencies

### Backend Dependencies

- **express**: Web server framework
- **socket.io**: Real-time communication
- **cors**: Cross-origin resource sharing
- **nodemon**: Development auto-restart (dev dependency)

### Frontend Dependencies

- **react**: UI framework
- **react-dom**: React DOM rendering
- **socket.io-client**: Real-time communication client
- **@tensorflow/tfjs**: TensorFlow.js runtime
- **@tensorflow-models/face-detection**: Face detection models
- **vite**: Build tool and dev server
- **@vitejs/plugin-react**: React support for Vite
- **vite-plugin-mkcert**: HTTPS certificate generation

## 🔍 Troubleshooting

### Common Issues

1. **Camera Permission Denied**
   - Ensure you're using HTTPS (required for camera access)
   - Check browser permissions for camera/microphone
   - Try refreshing the page

2. **Connection Issues**
   - Verify both frontend and backend are running
   - Check firewall settings
   - Ensure ports 3000 and 5000 are available

3. **Face Detection Not Working**
   - Wait for TensorFlow.js models to load (may take a few seconds)
   - Ensure good lighting conditions
   - Check browser console for errors

4. **Poor Video Quality**
   - Check your internet connection
   - Try lowering the video quality setting
   - Ensure adequate lighting for your camera

### Browser Compatibility

- **Chrome**: Full support (recommended)
- **Firefox**: Full support
- **Safari**: Full support (macOS/iOS)
- **Edge**: Full support

## 🚀 Advanced Usage

### Custom Room Management

You can create custom room management by modifying the backend:

```javascript
// In backend/server.js, modify the room logic
const rooms = new Map();
// Add custom room validation, user limits, etc.
```

### Adding More AI Features

Extend the face detection with additional TensorFlow.js models:

```javascript
// In VirtualCamera.jsx, add more models
import * as poseDetection from '@tensorflow-models/pose-detection';
// Add pose detection, object detection, etc.
```

### Custom Video Processing

Add custom video filters and effects:

```javascript
// In VirtualCamera.jsx, modify the processFrame function
// Add custom canvas drawing, filters, effects
```

## 📄 License

This project is open source. Feel free to modify and distribute according to your needs.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.

## 📞 Support

If you encounter any issues or have questions:

1. Check the troubleshooting section above
2. Review the browser console for error messages
3. Ensure all dependencies are properly installed
4. Verify that both frontend and backend servers are running

---

**Happy Streaming! 🎥✨**
