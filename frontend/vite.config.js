import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  plugins: [react(), mkcert()],
  server: {
    port: 3000,
    host: true,
    https: true,
    allowedHosts: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true,
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            console.log('Proxy error:', err);
          });
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            console.log('WebSocket proxy request');
          });
        }
      }
    }
  }
});


