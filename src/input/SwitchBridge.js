/**
 * Super Kart 3D (Zario Kart) — Nintendo Switch Mode Bridge (Samsung TV Host + iPhone Controller)
 *
 * Enables playing Zario Kart on a 2021 45" Samsung Smart TV (Tizen 6.0 / Chromium M76)
 * like a Nintendo Switch, using an iPhone (Safari iOS) as a wireless motion/touch controller.
 *
 * Multi-transport architecture (runs simultaneously for zero-config reliability):
 *  1. Local LAN Relay (`/api/switch-bridge/*`) — built into Vite server for instant home Wi-Fi pairing.
 *  2. WebRTC P2P (`PeerJS` dynamic CDN load) — works on static hosts (GitHub Pages) across any network.
 *  3. `BroadcastChannel('zario-switch-bridge')` — instant same-device multi-tab testing & QA verification.
 *
 * Also includes:
 *  - Pure-JS ISO/IEC 18004 SVG QR Code encoder (`renderPairingQRCodeSvg`) with zero external dependencies.
 *  - 2021 45" Samsung Smart TV Tizen 6.0 adaptation (overscan safe-area, 10-foot UI, One-Remote D-pad navigation).
 */

import { zarioLogger } from '../game/ZarioLogger.js';

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PEER_PREFIX = 'zariokart-tv-2026-';

export function generateRoomCode(len = 4) {
  let code = '';
  for (let i = 0; i < len; i++) {
    code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  }
  return code;
}

export function normalizeRoomCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function createDefaultControllerPacket() {
  return {
    type: 'controller_input',
    seq: 0,
    ts: Date.now(),
    steer: 0,
    throttle: 0,
    brake: 0,
    drift: false,
    useItem: false,
    itemDir: 0,
    swapItem: false,
    pause: false,
    startRace: false,
    gyroEnabled: false,
    tiltDeg: 0,
  };
}

/**
 * Pure-JS QR Code SVG Generator (ISO/IEC 18004 Byte Mode, EC Level L, Versions 1..6).
 * Generates a scannable SVG QR code offline with zero external image dependencies.
 */
const QR_VERSIONS = [
  null,
  { v: 1, size: 21, totalCodewords: 26, ecCodewords: 7, align: [] },
  { v: 2, size: 25, totalCodewords: 44, ecCodewords: 10, align: [6, 18] },
  { v: 3, size: 29, totalCodewords: 70, ecCodewords: 15, align: [6, 22] },
  { v: 4, size: 33, totalCodewords: 100, ecCodewords: 20, align: [6, 26] },
  { v: 5, size: 37, totalCodewords: 134, ecCodewords: 26, align: [6, 30] },
  { v: 6, size: 41, totalCodewords: 172, ecCodewords: 36, align: [6, 34] }, // 2 blocks of 18 EC
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(dataBytes, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const msg = new Uint8Array(dataBytes.length + ecLen);
  msg.set(dataBytes, 0);
  for (let i = 0; i < dataBytes.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(dataBytes.length);
}

export function encodeQRMatrix(text) {
  const utf8 = new TextEncoder().encode(String(text || ''));
  // Pick smallest version (1..5 single-block L, or 6 two-block L) that fits byte mode
  let ver = QR_VERSIONS[5];
  for (let v = 1; v <= 6; v++) {
    const info = QR_VERSIONS[v];
    const dataCap = info.totalCodewords - info.ecCodewords;
    if (utf8.length + 2 <= dataCap) {
      ver = info;
      break;
    }
  }
  const dataCap = ver.totalCodewords - ver.ecCodewords;
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  // Mode 0100 (Byte), 8-bit char count
  pushBits(0b0100, 4);
  const payload = utf8.slice(0, Math.max(1, dataCap - 2));
  pushBits(payload.length, 8);
  for (let i = 0; i < payload.length; i++) pushBits(payload[i], 8);
  // Terminator up to 4 zeros
  const maxBits = dataCap * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(dataCap);
  for (let i = 0; i < bits.length / 8; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    dataBytes[i] = b;
  }
  const padBytes = [0xec, 0x11];
  for (let i = Math.floor(bits.length / 8); i < dataCap; i++) {
    dataBytes[i] = padBytes[(i - Math.floor(bits.length / 8)) % 2];
  }

  let codewords;
  if (ver.v === 6) {
    // Version 6-L uses 2 blocks of (68 data, 18 EC)
    const b1 = dataBytes.slice(0, 68);
    const b2 = dataBytes.slice(68, 136);
    const ec1 = rsEncode(b1, 18);
    const ec2 = rsEncode(b2, 18);
    codewords = new Uint8Array(ver.totalCodewords);
    let idx = 0;
    for (let i = 0; i < 68; i++) {
      codewords[idx++] = b1[i];
      codewords[idx++] = b2[i];
    }
    for (let i = 0; i < 18; i++) {
      codewords[idx++] = ec1[i];
      codewords[idx++] = ec2[i];
    }
  } else {
    const ecBytes = rsEncode(dataBytes, ver.ecCodewords);
    codewords = new Uint8Array(ver.totalCodewords);
    codewords.set(dataBytes, 0);
    codewords.set(ecBytes, dataCap);
  }

  const size = ver.size;
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunctionModule = (r, c, dark) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = dark ? 1 : 0;
    reserved[r][c] = 1;
  };

  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r0 + dr;
        const cc = c0 + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(rr, cc, inOuter && (onBorder || inInner));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  if (ver.align.length > 0) {
    for (const ar of ver.align) {
      for (const ac of ver.align) {
        if ((ar === 6 && ac === 6) || (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6)) {
          continue;
        }
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFunctionModule(ar + dr, ac + dc, dark);
          }
        }
      }
    }
  }

  // Reserve format info areas + dark module
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = 1;
      reserved[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }
  setFunctionModule(size - 8, 8, true);

  // Place data bits in upward/downward 2-column zig-zag
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            dark = ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          // Apply Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) dark = !dark;
          modules[r][c] = dark ? 1 : 0;
        }
      }
    }
    upward = !upward;
  }

  // Format bits for EC Level L (01) + Mask 0 (000) -> 0x77c4 (30660)
  const formatBits = 0x77c4;
  const fBit = (i) => ((formatBits >> i) & 1) === 1;
  const formatCoordsA = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = formatCoordsA[i];
    modules[r][c] = fBit(14 - i) ? 1 : 0;
  }
  for (let i = 0; i < 7; i++) {
    modules[size - 1 - i][8] = fBit(14 - i) ? 1 : 0;
  }
  for (let i = 7; i < 15; i++) {
    modules[8][size - 15 + i] = fBit(14 - i) ? 1 : 0;
  }

  return modules;
}

export function renderPairingQRCodeSvg(url, pixelSize = 188) {
  const matrix = encodeQRMatrix(url);
  const n = matrix.length;
  const quiet = 3;
  const total = n + quiet * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        path += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges" role="img" aria-label="iPhone Controller QR Code"><rect width="${total}" height="${total}" rx="2" fill="#ffffff"/><path d="${path}" fill="#0f172a"/></svg>`;
}

/**
 * Dynamically loads PeerJS in browser environments if not already loaded.
 */
let _peerJsPromise = null;
function loadPeerJS() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.Peer) return Promise.resolve(window.Peer);
  if (_peerJsPromise) return _peerJsPromise;
  _peerJsPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    script.async = true;
    script.onload = () => resolve(window.Peer || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return _peerJsPromise;
}

/**
 * TV Host Bridge: runs on the Samsung Smart TV (or PC/Mac display) and receives
 * low-latency steering, throttle, drift, and item commands from the iPhone controller.
 */
export class SwitchHostBridge {
  constructor(options = {}) {
    this.roomCode = normalizeRoomCode(options.roomCode) || generateRoomCode(4);
    this.connected = false;
    this.transport = 'waiting';
    this.lastPacketAt = 0;
    this.lastSeq = -1;
    this.latestState = createDefaultControllerPacket();
    this._edgeItemPressed = false;
    this._edgeSwapPressed = false;
    this._edgePausePressed = false;
    this._edgeStartPressed = false;
    this._prevRawItem = false;
    this._prevRawSwap = false;
    this._prevRawPause = false;
    this._prevRawStart = false;
    this.lanOrigins = [];
    this.listeners = new Set();
    this._bc = null;
    this._peer = null;
    this._peerConns = new Set();
    this._pollTimer = null;
    this._started = false;
  }

  start() {
    if (this._started) return this;
    this._started = true;

    // 1. BroadcastChannel for instant local/multi-tab pairing
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this._bc = new BroadcastChannel('zario-switch-bridge');
        this._bc.onmessage = (ev) => {
          const msg = ev.data;
          if (!msg || normalizeRoomCode(msg.roomCode) !== this.roomCode) return;
          if (msg.type === 'controller_input' || msg.type === 'controller_hello') {
            this._handleIncomingPacket(msg, 'BroadcastChannel');
          }
        };
        this._bc.unref?.();
      } catch { /* ignore */ }
    }

    // 2. Local Vite LAN Relay polling + LAN IP discovery
    if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
      this._discoverLanInfo();
      this._startLanPolling();
    }

    // 3. PeerJS WebRTC P2P Host (works across static GitHub Pages + cellular/Wi-Fi)
    if (typeof window !== 'undefined') {
      loadPeerJS().then((PeerClass) => {
        if (!PeerClass || !this._started) return;
        try {
          const peerId = `${PEER_PREFIX}${this.roomCode}`;
          const peer = new PeerClass(peerId, { debug: 0 });
          this._peer = peer;
          peer.on('connection', (conn) => {
            this._peerConns.add(conn);
            conn.on('data', (data) => {
              this._handleIncomingPacket(data, 'WebRTC-PeerJS');
            });
            conn.on('close', () => {
              this._peerConns.delete(conn);
            });
          });
          peer.on('error', () => {
            // Silent fallback to LAN relay / BroadcastChannel
          });
        } catch { /* ignore */ }
      });
    }

    zarioLogger.info('SWITCH_CONTROLLER', `TV Host Bridge started for room ${this.roomCode}`);
    return this;
  }

  stop() {
    this._started = false;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._bc) {
      try { this._bc.close(); } catch { /* ignore */ }
      this._bc = null;
    }
    if (this._peer) {
      try { this._peer.destroy(); } catch { /* ignore */ }
      this._peer = null;
    }
  }

  onStatusChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emitStatus() {
    for (const fn of this.listeners) {
      try { fn(this.getStatus()); } catch { /* ignore */ }
    }
  }

  async _discoverLanInfo() {
    try {
      const res = await fetch('/api/switch-bridge/info', { cache: 'no-store' });
      if (!res.ok) return;
      const info = await res.json();
      if (Array.isArray(info.origins) && info.origins.length > 0) {
        this.lanOrigins = info.origins;
        this._emitStatus();
      }
    } catch { /* static host without Vite relay */ }
  }

  _startLanPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(async () => {
      if (!this._started) return;
      try {
        const res = await fetch(`/api/switch-bridge/poll?role=host&room=${encodeURIComponent(this.roomCode)}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.controllerInput && data.controllerInput.ts > this.lastPacketAt) {
          this._handleIncomingPacket(data.controllerInput, 'LAN-Relay');
        }
      } catch {
        // Static build or offline
      }
    }, 45);
    this._pollTimer.unref?.();
  }

  _handleIncomingPacket(packet, transportName) {
    if (!packet || typeof packet !== 'object') return;
    const now = Date.now();
    const wasConnected = this.connected;
    this.connected = true;
    this.transport = transportName || this.transport;
    this.lastPacketAt = now;

    if (packet.type === 'controller_hello') {
      if (!wasConnected) {
        zarioLogger.recordControllerConnect(this.roomCode, this.transport);
        this._emitStatus();
      }
      return;
    }

    const steer = Math.max(-1, Math.min(1, Number(packet.steer) || 0));
    const throttle = Math.max(0, Math.min(1, Number(packet.throttle) || 0));
    const brake = Math.max(0, Math.min(1, Number(packet.brake) || 0));
    const drift = !!packet.drift;
    const rawItem = !!packet.useItem;
    const rawSwap = !!packet.swapItem;
    const rawPause = !!packet.pause;
    const rawStart = !!packet.startRace;

    if (rawItem && !this._prevRawItem) this._edgeItemPressed = true;
    if (rawSwap && !this._prevRawSwap) this._edgeSwapPressed = true;
    if (rawPause && !this._prevRawPause) this._edgePausePressed = true;
    if (rawStart && !this._prevRawStart) this._edgeStartPressed = true;

    this._prevRawItem = rawItem;
    this._prevRawSwap = rawSwap;
    this._prevRawPause = rawPause;
    this._prevRawStart = rawStart;

    this.latestState = {
      type: 'controller_input',
      seq: Number(packet.seq) || (this.lastSeq + 1),
      ts: Number(packet.ts) || now,
      steer,
      throttle,
      brake,
      drift,
      useItem: rawItem,
      itemDir: Number(packet.itemDir) || 0,
      swapItem: rawSwap,
      pause: rawPause,
      startRace: rawStart,
      gyroEnabled: !!packet.gyroEnabled,
      tiltDeg: Number(packet.tiltDeg) || 0,
    };
    this.lastSeq = this.latestState.seq;

    const latencyMs = packet.ts ? Math.max(0, Math.min(999, now - Number(packet.ts))) : 0;
    zarioLogger.recordControllerPacket(latencyMs);

    if (!wasConnected) {
      zarioLogger.recordControllerConnect(this.roomCode, this.transport);
    }
    this._emitStatus();
  }

  /**
   * Returns active controller inputs for the current physics frame.
   * Automatically drops active state if the controller hasn't sent a packet in >3.5s.
   */
  sampleFrameInput() {
    if (!this.connected) return null;
    if (Date.now() - this.lastPacketAt > 3500) {
      this.connected = false;
      this._emitStatus();
      return null;
    }
    const useItem = this._edgeItemPressed;
    const swapItem = this._edgeSwapPressed;
    const pause = this._edgePausePressed;
    const startRace = this._edgeStartPressed;
    this._edgeItemPressed = false;
    this._edgeSwapPressed = false;
    this._edgePausePressed = false;
    this._edgeStartPressed = false;

    return {
      ...this.latestState,
      useItem,
      swapItem,
      pause,
      startRace,
    };
  }

  /**
   * Broadcasts live race HUD telemetry (rank, speed, lap, heldItem, coins) back to the iPhone screen!
   */
  broadcastTelemetry(telemetry) {
    if (!this.connected) return;
    const payload = {
      type: 'host_telemetry',
      roomCode: this.roomCode,
      ts: Date.now(),
      ...telemetry,
    };
    if (this._bc) {
      try { this._bc.postMessage(payload); } catch { /* ignore */ }
    }
    for (const conn of this._peerConns) {
      try { if (conn.open) conn.send(payload); } catch { /* ignore */ }
    }
    if (typeof fetch !== 'undefined' && this.transport === 'LAN-Relay') {
      fetch('/api/switch-bridge/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'host', room: this.roomCode, payload }),
      }).catch(() => {});
    }
  }

  getPairingUrl() {
    if (typeof window === 'undefined') {
      return `http://localhost:3000/?controller=1&room=${this.roomCode}`;
    }
    let origin = window.location.origin;
    if ((origin.includes('localhost') || origin.includes('127.0.0.1')) && this.lanOrigins.length > 0) {
      origin = this.lanOrigins[0];
    }
    const pathname = window.location.pathname || '/';
    return `${origin}${pathname}?controller=1&room=${this.roomCode}`;
  }

  getStatus() {
    const active = this.connected && (Date.now() - this.lastPacketAt <= 3500);
    return {
      roomCode: this.roomCode,
      connected: active,
      transport: active ? this.transport : 'waiting',
      pairingUrl: this.getPairingUrl(),
      lanOrigins: this.lanOrigins,
      latestState: this.latestState,
    };
  }
}

/**
 * iPhone Controller Client Bridge: runs on the iPhone Safari browser (`?controller=1&room=XXXX`)
 * and streams 30Hz motion/touch inputs to the Samsung TV host while receiving live HUD telemetry.
 */
export class SwitchClientBridge {
  constructor(options = {}) {
    this.roomCode = normalizeRoomCode(options.roomCode) || 'KART';
    this.connected = false;
    this.transport = 'connecting';
    this.seq = 0;
    this.hostTelemetry = {
      position: 1,
      lap: 1,
      totalLaps: 3,
      speedKmh: 0,
      heldItem: null,
      coins: 0,
      trackName: 'Mario Circuit',
    };
    this.onTelemetry = options.onTelemetry || null;
    this.onStatus = options.onStatus || null;
    this._bc = null;
    this._peer = null;
    this._conn = null;
    this._pollTimer = null;
    this._started = false;
  }

  start() {
    if (this._started) return this;
    this._started = true;

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this._bc = new BroadcastChannel('zario-switch-bridge');
        this._bc.onmessage = (ev) => {
          const msg = ev.data;
          if (!msg || normalizeRoomCode(msg.roomCode) !== this.roomCode) return;
          if (msg.type === 'host_telemetry') {
            this._handleTelemetry(msg, 'BroadcastChannel');
          }
        };
        this._bc.unref?.();
        this._bc.postMessage({
          type: 'controller_hello',
          roomCode: this.roomCode,
          ts: Date.now(),
        });
      } catch { /* ignore */ }
    }

    if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
      this._startLanTelemetryPoll();
    }

    if (typeof window !== 'undefined') {
      loadPeerJS().then((PeerClass) => {
        if (!PeerClass || !this._started) return;
        try {
          const peer = new PeerClass({ debug: 0 });
          this._peer = peer;
          peer.on('open', () => {
            const targetId = `${PEER_PREFIX}${this.roomCode}`;
            const conn = peer.connect(targetId, { reliable: false });
            this._conn = conn;
            conn.on('open', () => {
              this.connected = true;
              this.transport = 'WebRTC-PeerJS';
              conn.send({ type: 'controller_hello', roomCode: this.roomCode, ts: Date.now() });
              this.onStatus?.({ connected: true, transport: this.transport, roomCode: this.roomCode });
            });
            conn.on('data', (data) => {
              if (data && data.type === 'host_telemetry') {
                this._handleTelemetry(data, 'WebRTC-PeerJS');
              }
            });
          });
        } catch { /* ignore */ }
      });
    }

    return this;
  }

  setRoomCode(newCode) {
    this.roomCode = normalizeRoomCode(newCode) || this.roomCode;
    this.stop();
    this.start();
  }

  stop() {
    this._started = false;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._bc) {
      try { this._bc.close(); } catch { /* ignore */ }
      this._bc = null;
    }
    if (this._peer) {
      try { this._peer.destroy(); } catch { /* ignore */ }
      this._peer = null;
    }
  }

  _startLanTelemetryPoll() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(async () => {
      if (!this._started) return;
      try {
        const res = await fetch(`/api/switch-bridge/poll?role=client&room=${encodeURIComponent(this.roomCode)}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.ok) {
          if (!this.connected) {
            this.connected = true;
            this.transport = 'LAN-Relay';
            this.onStatus?.({ connected: true, transport: this.transport, roomCode: this.roomCode });
          }
          if (data.hostTelemetry) {
            this._handleTelemetry(data.hostTelemetry, 'LAN-Relay');
          }
        }
      } catch { /* ignore */ }
    }, 180);
    this._pollTimer.unref?.();
  }

  _handleTelemetry(msg, transportName) {
    this.connected = true;
    this.transport = transportName || this.transport;
    this.hostTelemetry = {
      ...this.hostTelemetry,
      ...msg,
    };
    this.onTelemetry?.(this.hostTelemetry);
  }

  sendInput(inputState) {
    this.seq += 1;
    const packet = {
      type: 'controller_input',
      roomCode: this.roomCode,
      seq: this.seq,
      ts: Date.now(),
      steer: Number(inputState.steer) || 0,
      throttle: Number(inputState.throttle) || 0,
      brake: Number(inputState.brake) || 0,
      drift: !!inputState.drift,
      useItem: !!inputState.useItem,
      itemDir: Number(inputState.itemDir) || 0,
      swapItem: !!inputState.swapItem,
      pause: !!inputState.pause,
      startRace: !!inputState.startRace,
      gyroEnabled: !!inputState.gyroEnabled,
      tiltDeg: Number(inputState.tiltDeg) || 0,
    };

    if (this._bc) {
      try { this._bc.postMessage(packet); } catch { /* ignore */ }
    }
    if (this._conn && this._conn.open) {
      try { this._conn.send(packet); } catch { /* ignore */ }
    }
    if (typeof fetch !== 'undefined') {
      fetch('/api/switch-bridge/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'client', room: this.roomCode, payload: packet }),
      }).catch(() => {});
    }
    return packet;
  }
}

/**
 * 2021 45" Samsung Smart TV Mode & One-Remote D-Pad Navigation Helper.
 */
export function setSamsungTVMode(enabled, reason = 'user-toggle') {
  if (typeof document === 'undefined') return false;
  const active = !!enabled;
  document.body.classList.toggle('zario-tv-mode', active);
  try {
    localStorage.setItem('zario_tv_mode', active ? '1' : '0');
  } catch { /* ignore */ }
  zarioLogger.recordTvMode(active, reason);
  return active;
}

export function initSamsungTVAdaptation(hostBridge) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const qs = new URLSearchParams(window.location.search);
  const ua = navigator.userAgent || '';
  const isSamsungTV = /Tizen|SmartTV|SMART-TV|SamsungBrowser.*TV|Web0S|NetCast|VIDAA/i.test(ua);
  let savedTv = false;
  try {
    savedTv = localStorage.getItem('zario_tv_mode') === '1';
  } catch { /* ignore */ }

  if (qs.get('tv') === '1' || isSamsungTV || savedTv) {
    setSamsungTVMode(true, isSamsungTV ? 'Samsung-Tizen-UA' : (qs.get('tv') === '1' ? 'URL-tv=1' : 'saved-pref'));
  }

  // Samsung Smart TV One-Remote D-Pad spatial focus navigation for menus & modals
  window.addEventListener('keydown', (e) => {
    // Tizen Return key code is 10009
    const isTizenReturn = e.keyCode === 10009 || e.key === 'XF86Back';
    const modal = document.getElementById('zario-switch-modal');
    if ((e.key === 'Escape' || isTizenReturn) && modal && !modal.hidden) {
      e.preventDefault();
      modal.hidden = true;
      return;
    }

    // Only intercept arrow keys when menu or modal is visible
    const menuVisible = !!document.querySelector('.menu-screen:not([hidden]), #zario-switch-modal:not([hidden])');
    if (!menuVisible) return;

    const focusables = Array.from(
      document.querySelectorAll(
        '#zario-switch-modal:not([hidden]) button, .menu-screen:not([hidden]) button, .menu-screen:not([hidden]) .char-card, .menu-screen:not([hidden]) .track-card, .menu-screen:not([hidden]) .cc-btn'
      )
    ).filter((el) => el.offsetParent !== null && !el.disabled);

    if (focusables.length === 0) return;

    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
      const currentIdx = focusables.indexOf(document.activeElement);
      const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      const nextIdx = currentIdx === -1 ? 0 : (currentIdx + step + focusables.length) % focusables.length;
      focusables[nextIdx]?.focus();
      e.preventDefault();
    } else if (e.key === 'Enter' && document.activeElement && focusables.includes(document.activeElement)) {
      document.activeElement.click();
      e.preventDefault();
    }
  });

  if (qs.get('pair') === '1' && hostBridge) {
    setTimeout(() => openTVPairingModal(hostBridge), 350);
  }
}

/**
 * Opens the Samsung TV + iPhone Nintendo Switch Controller Pairing Modal.
 */
export function openTVPairingModal(hostBridge) {
  if (typeof document === 'undefined' || !hostBridge) return;
  let modal = document.getElementById('zario-switch-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'zario-switch-modal';
    modal.className = 'zario-switch-modal-backdrop';
    document.body.appendChild(modal);
  }

  const renderModalContent = () => {
    const status = hostBridge.getStatus();
    const qrSvg = renderPairingQRCodeSvg(status.pairingUrl, 196);
    const tvActive = document.body.classList.contains('zario-tv-mode');
    modal.innerHTML = `
      <div class="zario-switch-modal-card" role="dialog" aria-label="Samsung TV & iPhone Switch Controller Setup">
        <div class="zario-switch-modal-header">
          <div>
            <span class="zario-switch-badge">🎮 NINTENDO SWITCH MODE · SAMSUNG 45" TV</span>
            <h2>Pair Your iPhone Wireless Controller</h2>
          </div>
          <button type="button" class="zario-switch-close" id="zario-switch-close-btn">✕ Close</button>
        </div>

        <div class="zario-switch-grid">
          <div class="zario-switch-qr-box">
            <div class="zario-switch-qr-frame">${qrSvg}</div>
            <div class="zario-switch-room-pill">
              <span>ROOM CODE:</span>
              <strong>${status.roomCode}</strong>
            </div>
            <div class="zario-switch-conn-status ${status.connected ? 'is-connected' : 'is-waiting'}">
              ${status.connected
                ? `✅ iPhone Connected (${status.transport})`
                : '📡 Waiting for iPhone to scan QR or enter code...'}
            </div>
          </div>

          <div class="zario-switch-steps">
            <h3>How to Play on Your 2021 45" Samsung Smart TV</h3>
            <ol>
              <li>
                <strong>Scan the QR Code on your iPhone</strong> (opens Safari in full-screen Joy-Con / Mario Kart Wheel mode).
              </li>
              <li>
                Or open <code class="zario-switch-url">${status.pairingUrl}</code> on your iPhone and enter Room Code <strong>${status.roomCode}</strong>.
              </li>
              <li>
                <strong>Tilt your iPhone like a Mario Kart Wii / Switch Wheel</strong> (or use the touch thumbstick), hold <strong>A</strong> for Gas, hold <strong>ZR</strong> to Drift & Trick off ramps, and tap <strong>ITEM</strong> to fire shells!
              </li>
            </ol>

            <div class="zario-switch-actions">
              <button type="button" class="zario-switch-btn primary" id="zario-toggle-tv-mode-btn">
                📺 45" Samsung TV Safe-Area & 60fps Mode: <strong>${tvActive ? 'ON' : 'OFF'}</strong>
              </button>
              <button type="button" class="zario-switch-btn secondary" id="zario-open-sim-controller-btn">
                📱 Open Controller Preview in New Tab
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    modal.querySelector('#zario-switch-close-btn')?.addEventListener('click', () => {
      modal.hidden = true;
    });
    modal.querySelector('#zario-toggle-tv-mode-btn')?.addEventListener('click', () => {
      const next = !document.body.classList.contains('zario-tv-mode');
      setSamsungTVMode(next, 'modal-button');
      renderModalContent();
    });
    modal.querySelector('#zario-open-sim-controller-btn')?.addEventListener('click', () => {
      window.open(status.pairingUrl, '_blank', 'noopener,width=844,height=390');
    });
  };

  modal.hidden = false;
  renderModalContent();
  if (!modal._subscribed) {
    modal._subscribed = true;
    hostBridge.onStatusChange(() => {
      if (!modal.hidden) renderModalContent();
    });
  }
}
