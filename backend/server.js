const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const { Server } = require('socket.io');

const PORT = 5000;
const FRONTEND_PORT = 3000;

const app = express();

// Allowed origins for dev (localhost/LAN) and tunnels (ngrok, cloudflared)
const allowedOrigins = [
	new RegExp(`^https?:\/\/(localhost|127\\.0\\.0\\.1|\\d{1,3}(?:\\.\\d{1,3}){3}):${FRONTEND_PORT}$`),
	new RegExp('^https://.*\\.ngrok(?:-free)?\\.app$'),
	new RegExp('^https://.*\\.trycloudflare\\.com$'),
];


// CORS for REST routes
app.use(cors({
	origin: (origin, callback) => {
		if (!origin) return callback(null, true);
		if (allowedOrigins.some((r) => r.test(origin))) return callback(null, true);
		return callback(new Error('Not allowed by CORS'));
	},
	credentials: true,
}));

app.get('/', (_req, res) => {
	res.send('WebRTC Signaling Server is running');
});

// Create HTTP server for now (HTTPS can be added later if needed)
const server = http.createServer(app);
console.log('HTTP server created');

// Socket.IO with CORS
const io = new Server(server, {
	cors: {
		origin: (origin, callback) => {
			if (!origin) return callback(null, true);
			if (allowedOrigins.some((r) => r.test(origin))) return callback(null, true);
			return callback(new Error('Not allowed by CORS'));
		},
		methods: ['GET', 'POST'],
		credentials: true,
	},
});

// In-memory room state: roomId -> { broadcasterSocketId: string | null, viewerSocketIds: Set<string> }
const rooms = new Map();

function ensureRoom(roomId) {
	if (!rooms.has(roomId)) {
		rooms.set(roomId, { broadcasterSocketId: null, viewerSocketIds: new Set() });
	}
	return rooms.get(roomId);
}

io.on('connection', (socket) => {
	let joinedRoomId = null;
	let role = null; // 'broadcaster' | 'viewer'

	socket.on('join-room', ({ roomId, role: clientRole }) => {
		if (!roomId || !clientRole) return;
		joinedRoomId = roomId;
		role = clientRole;

		socket.join(roomId);
		const room = ensureRoom(roomId);

		if (role === 'broadcaster') {
			room.broadcasterSocketId = socket.id;
			// Notify viewers that broadcaster is ready
			socket.to(roomId).emit('broadcaster-ready', { roomId, broadcasterId: socket.id });
		} else if (role === 'viewer') {
			room.viewerSocketIds.add(socket.id);
			// Notify broadcaster that a viewer joined
			if (room.broadcasterSocketId) {
				io.to(room.broadcasterSocketId).emit('viewer-joined', { roomId, viewerId: socket.id });
				// Also let the viewer know the broadcaster is present
				io.to(socket.id).emit('broadcaster-ready', { roomId, broadcasterId: room.broadcasterSocketId });
			}
		}
	});

	// Attendance mode is now controlled by the viewer (source of truth)
	socket.on('attendance-mode', ({ roomId, enabled }) => {
		if (!roomId) return;
		const room = rooms.get(roomId);
		if (!room) return;
		// Only allow a viewer to declare their own attendance mode
		if (role === 'viewer' && room.broadcasterSocketId) {
			io.to(room.broadcasterSocketId).emit('attendance-mode', {
				viewerId: socket.id,
				enabled: !!enabled,
			});
		}
	});

	// Attendance status from viewer back to broadcaster
	socket.on('attendance-status', ({ roomId, detected }) => {
		if (!roomId) return;
		const room = rooms.get(roomId);
		if (!room) return;
		if (role === 'viewer' && room.broadcasterSocketId) {
			io.to(room.broadcasterSocketId).emit('attendance-status', {
				viewerId: socket.id,
				detected: !!detected,
			});
		}
	});

	// Signaling relay: directly route to target socket
	socket.on('offer', (payload) => {
		// payload: { roomId, to, from, sdp }
		if (payload?.to) io.to(payload.to).emit('offer', payload);
	});

	socket.on('answer', (payload) => {
		// payload: { roomId, to, from, sdp }
		if (payload?.to) io.to(payload.to).emit('answer', payload);
	});

	socket.on('ice-candidate', (payload) => {
		// payload: { roomId, to, from, candidate }
		if (payload?.to) io.to(payload.to).emit('ice-candidate', payload);
	});

	socket.on('disconnect', () => {
		if (!joinedRoomId) return;
		const room = rooms.get(joinedRoomId);
		if (!room) return;

		if (role === 'broadcaster' && room.broadcasterSocketId === socket.id) {
			// Notify all viewers broadcaster left
			socket.to(joinedRoomId).emit('broadcaster-left', { roomId: joinedRoomId });
			room.broadcasterSocketId = null;
		} else if (role === 'viewer') {
			room.viewerSocketIds.delete(socket.id);
			if (room.broadcasterSocketId) {
				io.to(room.broadcasterSocketId).emit('viewer-left', { roomId: joinedRoomId, viewerId: socket.id });
			}
		}

		// Cleanup empty room
		if (!room.broadcasterSocketId && room.viewerSocketIds.size === 0) {
			rooms.delete(joinedRoomId);
		}
	});
});

server.listen(PORT, '0.0.0.0', () => {
	// eslint-disable-next-line no-console
	console.log(`Signaling server listening on http://localhost:${PORT}`);
});


