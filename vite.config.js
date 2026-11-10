import os from 'node:os';
import { defineConfig } from 'vite';

/**
 * Built-in LAN Switch Bridge Relay for Samsung Smart TV + iPhone Wireless Controller.
 * Zero external dependencies — relays controller inputs and HUD telemetry over home Wi-Fi.
 */
function zarioSwitchBridgePlugin() {
  const rooms = new Map();

  const getLanOrigins = (port) => {
    const origins = [];
    try {
      const nets = os.networkInterfaces();
      for (const list of Object.values(nets)) {
        for (const iface of list || []) {
          if (iface && iface.family === 'IPv4' && !iface.internal) {
            origins.push(`http://${iface.address}:${port}`);
          }
        }
      }
    } catch { /* ignore */ }
    return origins;
  };

  const attachMiddleware = (server, defaultPort = 3457) => {
    server.middlewares.use((req, res, next) => {
      if (!req.url || !req.url.startsWith('/api/switch-bridge/')) return next();

      const urlObj = new URL(req.url, 'http://localhost');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (urlObj.pathname === '/api/switch-bridge/info') {
        const port = server.config?.server?.port || defaultPort;
        res.end(JSON.stringify({ ok: true, origins: getLanOrigins(port) }));
        return;
      }

      if (urlObj.pathname === '/api/switch-bridge/poll') {
        const room = String(urlObj.searchParams.get('room') || 'KART').toUpperCase();
        const entry = rooms.get(room) || { controllerInput: null, hostTelemetry: null };
        res.end(JSON.stringify({
          ok: true,
          room,
          controllerInput: entry.controllerInput,
          hostTelemetry: entry.hostTelemetry,
        }));
        return;
      }

      if (urlObj.pathname === '/api/switch-bridge/push' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 32768) req.destroy();
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const room = String(parsed.room || 'KART').toUpperCase();
            const entry = rooms.get(room) || { controllerInput: null, hostTelemetry: null };
            if (parsed.role === 'client') {
              entry.controllerInput = parsed.payload;
            } else if (parsed.role === 'host') {
              entry.hostTelemetry = parsed.payload;
            }
            rooms.set(room, entry);
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false }));
          }
        });
        return;
      }

      next();
    });
  };

  return {
    name: 'zario-switch-bridge-lan',
    configureServer(server) {
      attachMiddleware(server, 3457);
    },
    configurePreviewServer(server) {
      attachMiddleware(server, 4173);
    },
  };
}

export default defineConfig({
  // base relativa: funciona em qualquer subpath (GitHub Pages project site
  // fica em /super-kart-3djs/, não na raiz). './' = assets relativos ao index.html.
  base: './',
  plugins: [zarioSwitchBridgePlugin()],
  server: {
    host: '0.0.0.0',
    port: 3457,
    strictPort: true,
  },
  build: {
    // Target ES2019 / Chrome 76 / Safari 13 so 2021 45" Samsung Smart TVs (Tizen 6.0)
    // and iPhone Safari controllers run natively without syntax errors.
    target: ['es2019', 'chrome76', 'safari13'],
    sourcemap: true,
    // outDir padrão 'dist' — universal. Pode ser sobrescrito por env var
    // (ex: SK3D_OUT_DIR=/some/out/dir npm run build) para filesystems que
    // bloqueiam copyfile (copyfile-restricted filesystems/9p).
    outDir: process.env.SK3D_OUT_DIR || 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/examples/')) return 'three-examples';
          if (id.includes('/node_modules/three/src/renderers/')) return 'three-renderer';
          if (id.includes('/node_modules/three/')) return 'three-core';
          return undefined;
        },
      },
    },
  },
});
