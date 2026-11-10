/**
 * Zario Kart — title menu overlay.
 *
 * Pure DOM, appended to document.body, hidden by default.
 *
 * The main card stays compact: logo, Start Race, How to Play, the race
 * settings (engine class + assists) and two buttons that open dedicated
 * FULL-SCREEN selection screens (FECO feedback: the inline roster list and
 * the unclear track picker — "quero uma TELA de selecao com detalhes e
 * visualizacao / que mostre o TRACADO"):
 *
 *   RACERS  — one character card at a time: canvas kart silhouette in the
 *             driver's colors, name + color swatch and SPD/ACC/HAN stat
 *             bars. ◀ ▶ arrows (or swipe) flip through; SELECT confirms.
 *   TRACKS  — track cards with a canvas-drawn LAYOUT: the control points
 *             projected XZ + a checkered start-line marker. SELECT confirms
 *             and swaps the whole world via the established ?track= reload.
 *
 * Selections persist in localStorage and publish to window.__sk3dChar /
 * window.__sk3dTrack so main.js can read them at race start.
 */
import { CONFIG } from '../config.js';
import { TRACK_PATH, CITY_PATH } from '../track/TrackBuilder.js';
import { CANYON_PATH, SKY_PATH, VOLCANO_PATH, MANSION_PATH } from '../track/ExtraTracks.js';
import { racerShowroom3D } from './RacerShowroom3D.js';
import './ui.css';

/** [action, keyboard, touch] rows for the "How to Play" table. */
const CONTROL_ROWS = [
  ['Steer', '← → or A / D', '◀ ▶ or iPhone Tilt'],
  ['Accelerate', '↑ or W', 'Auto / A button'],
  ['Brake / Reverse', '↓ or S', 'B button'],
  ['Drift / Ramp Trick', 'Shift (hold)', '🧲 DRIFT / ZR button'],
  ['Use item', 'Space', '🎁 / X / ZL button'],
  ['Throw item back', 'Hold Space, release', 'Hold 🎁, release'],
  ['Swap item', 'Tab', 'Tap 🎁 reserve / Y'],
  ['Samsung TV + iPhone', 'T key', '📺 TV Switch Mode'],
  ['Telemetry & Logs', 'F9 key', '📋 Logs button'],
  ['Restart', 'R', '—'],
  ['Pause', 'P / Esc', '⏸ / + button'],
];

/** 0xff5a5f -> "#ff5a5f" */
function toHex(value) {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/**
 * Track catalog. ids match the ?track= query param main.js uses; `points`
 * are the control-point loops exported by TrackBuilder (do NOT edit it).
 */
const TRACKS = [
  { id: 1, name: 'Meadow Circuit', icon: '🌇', desc: 'Rolling sunny hills, sweeping bends and launch ramps.', points: TRACK_PATH },
  { id: 2, name: 'Neon City', icon: '🌆', desc: 'Long night race across wet neon boulevards and sharp switchbacks.', points: CITY_PATH },
  { id: 3, name: 'Sunset Canyon', icon: '🌅', desc: 'Golden cliffs, S-bends, aerial jumps and festival arches.', points: CANYON_PATH },
  { id: 4, name: 'Cloudtop Garden', icon: '🌈', desc: 'Pastel sky gardens, swooping curves and colorful launch gates.', points: SKY_PATH },
  { id: 5, name: 'Inferno Volcano', icon: '🌋', desc: 'Basalt caldera road, erupting magma rivers, obsidian spires and trick jumps.', points: VOLCANO_PATH },
  { id: 6, name: 'Haunted Mansion', icon: '👻', desc: 'Moonlit gothic manor, spectral swamp mist, floating ghosts and cobblestone hairpins.', points: MANSION_PATH },
];

/**
 * Uniform Catmull-Rom 2D sampling over a closed loop of control points —
 * the same curve family TrackBuilder uses (THREE.CatmullRomCurve3), minus
 * the three.js dependency. Returns [x, z] pairs for the layout preview.
 */
function sampleClosedLoop(pts, perSegment = 18) {
  const n = pts.length;
  const out = [];
  const total = n * perSegment;
  for (let i = 0; i < total; i++) {
    const t = (i / total) * n;
    const seg = Math.floor(t) % n;
    const f = t - Math.floor(t);
    const p0 = pts[(seg - 1 + n) % n];
    const p1 = pts[seg];
    const p2 = pts[(seg + 1) % n];
    const p3 = pts[(seg + 2) % n];
    const f2 = f * f;
    const f3 = f2 * f;
    out.push([
      0.5 * (2 * p1.x + (-p0.x + p2.x) * f + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3),
      0.5 * (2 * p1.z + (-p0.z + p2.z) * f + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * f2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * f3),
    ]);
  }
  return out;
}

/** Rounded-rect sub-path helper (roundRect has spotty WebView support). */
function rr(g, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.arcTo(x + w, y, x + w, y + h, rad);
  g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad);
  g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}

/** Draw a mini top-down kart: shadow, wheels, chassis, spoiler, driver. */
function drawKart(canvas, character) {
  const g = canvas.getContext('2d');
  const s = canvas.width / 200; // canvases are 2x logical (hidpi)
  const W = canvas.width / s;
  const H = canvas.height / s;
  g.setTransform(s, 0, 0, s, 0, 0);
  g.clearRect(0, 0, W, H);
  const ink = '#1b2a41';
  const c = toHex(character.color);
  const suit = toHex(character.suitColor);
  const helmet = toHex(character.helmetColor);
  const accent = toHex(character.accentColor);

  // Ground shadow.
  g.fillStyle = 'rgba(27,42,65,0.18)';
  g.beginPath();
  g.ellipse(100, 106, 60, 24, 0, 0, Math.PI * 2);
  g.fill();

  // Wheels (4 dark rounded blocks).
  g.fillStyle = '#222a36';
  g.strokeStyle = ink;
  g.lineWidth = 2;
  for (const [wx, wy] of [[50, 76], [50, 114], [150, 76], [150, 114]]) {
    rr(g, wx - 7, wy - 11, 14, 22, 6);
    g.fill();
    g.stroke();
  }

  // Chassis in the driver's identity color.
  g.fillStyle = c;
  rr(g, 56, 76, 88, 38, 15);
  g.fill();
  g.strokeStyle = ink;
  g.lineWidth = 2.5;
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  rr(g, 78, 90, 46, 9, 4.5);
  g.fill();

  // Rear spoiler wing + posts (accent color).
  g.fillStyle = accent;
  rr(g, 50, 86, 12, 18, 5);
  g.fill();
  g.strokeStyle = ink;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#222a36';
  g.fillRect(63, 88, 3, 12);
  g.fillRect(63, 101, 3, 12);

  // Front bumper nub.
  g.fillStyle = ink;
  rr(g, 140, 90, 10, 9, 3);
  g.fill();

  // Chibi driver: torso + helmet + visor.
  g.fillStyle = suit;
  g.beginPath();
  g.ellipse(96, 98, 13, 15, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = ink;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = helmet;
  g.beginPath();
  g.arc(96, 84, 11, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = accent;
  g.beginPath();
  g.arc(96, 84, 7, 0.35, Math.PI - 0.35);
  g.fill();
  g.fillStyle = ink;
  g.fillRect(90, 83, 12, 2.5);
}

/**
 * Draw a track layout: the control points projected XZ (uniform scale,
 * centered) as a closed road with outline, dashed center line and a
 * checkered START bar at the first control point.
 */
function drawTrackLayout(canvas, points) {
  const g = canvas.getContext('2d');
  const s = canvas.width / 300; // canvases are 2x logical (hidpi)
  const W = canvas.width / s;
  const H = canvas.height / s;
  const ink = '#1b2a41';
  g.setTransform(s, 0, 0, s, 0, 0);
  g.clearRect(0, 0, W, H);

  const samples = sampleClosedLoop(points, 18);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of samples) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const spanX = maxX - minX || 1;
  const spanZ = maxZ - minZ || 1;
  const pad = 30;
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanZ);
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const offX = W / 2 - midX * scale;
  const offZ = H / 2 - midZ * scale;
  const px = (x) => offX + x * scale;
  const pz = (z) => offZ + z * scale;

  const trace = (ctx) => {
    ctx.beginPath();
    ctx.moveTo(px(samples[0][0]), pz(samples[0][1]));
    for (let i = 1; i < samples.length; i++) ctx.lineTo(px(samples[i][0]), pz(samples[i][1]));
    ctx.closePath();
  };

  g.lineJoin = 'round';
  g.lineCap = 'round';
  // Soft glow underlay → route reads at a glance.
  g.strokeStyle = 'rgba(255,209,102,0.4)';
  g.lineWidth = 20;
  trace(g);
  g.stroke();
  // Dark outline.
  g.strokeStyle = '#1b2a41';
  g.lineWidth = 16;
  trace(g);
  g.stroke();
  // Road surface.
  g.strokeStyle = '#f2f5f9';
  g.lineWidth = 11;
  trace(g);
  g.stroke();
  // Center dashed line (racing-line cue).
  g.setLineDash([9, 11]);
  g.strokeStyle = 'rgba(46,196,255,0.8)';
  g.lineWidth = 2.5;
  trace(g);
  g.stroke();
  g.setLineDash([]);

  // Checkered START bar across the road at the first control point.
  const sx = px(samples[0][0]);
  const sz = pz(samples[0][1]);
  const tx = px(samples[1][0]) - sx;
  const tz = pz(samples[1][1]) - sz;
  const len = Math.hypot(tx, tz) || 1;
  const ux = tx / len;
  const uz = tz / len;
  const nx = -uz; // across-track unit
  const nz = ux;
  const roadPx = Math.max(10, CONFIG.track.roadWidth * scale);
  const half = roadPx / 2 + 3;
  g.save();
  g.translate(sx, sz);
  g.rotate(Math.atan2(nz, nx)); // bar along local X
  const barW = half * 2;
  const cell = barW / 8;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 === 0 ? '#ffffff' : '#1b2a41';
    g.fillRect(-barW / 2 + i * cell, -2.5, cell, 5);
  }
  g.restore();

  // Red flag + START label beside the line.
  g.fillStyle = '#ff5a5f';
  g.beginPath();
  g.moveTo(sx, sz - 16);
  g.lineTo(sx + 10, sz - 9);
  g.lineTo(sx, sz - 2);
  g.closePath();
  g.fill();
  g.strokeStyle = ink;
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = ink;
  g.font = '800 9px "Baloo 2", "Trebuchet MS", sans-serif';
  g.fillText('START', sx - 14, sz - 20);
}

export class Menu {
  /**
   * @param {object} opts
   * @param {() => void} [opts.onStart]   called when "Start Race" is pressed
   * @param {(color: number) => void} [opts.onColor] called when a racer is picked
   * @param {(name: string) => void} [opts.onSound] played on UI interaction
   * @param {(muted: boolean) => void} [opts.onToggleMute] called when the sound toggle is pressed
   */
  constructor({ onStart, onColor, onSound, onToggleMute, onVolume } = {}) {
    this.onStart = typeof onStart === 'function' ? onStart : () => {};
    this.onColor = typeof onColor === 'function' ? onColor : () => {};
    this.onSound = typeof onSound === 'function' ? onSound : () => {};
    this.onToggleMute = typeof onToggleMute === 'function' ? onToggleMute : () => {};
    this.onVolume = typeof onVolume === 'function' ? onVolume : () => {};
    this.muted = false;
    this.selectedColor = CONFIG.kart.playerColors[0];
    this.selectedChar = 0; // driver index into CONFIG.kart.characters
    // Track id matches the ?track= query param (1..6).
    this.trackId = [1,2,3,4,5,6].includes(Number(new URLSearchParams(location.search).get('track'))) ? Number(new URLSearchParams(location.search).get('track')) : 1;
    // Difficulty/accessibility state (audit r3): restored from localStorage.
    this.cc = CONFIG.cc.default;
    this.autoAccel = CONFIG.assist.autoAccelerate;
    this.steerAssist = CONFIG.assist.steerAssist;

    this.root = document.createElement('div');
    this.root.className = 'sk3d-overlay sk3d-menu sk3d-hidden';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Main menu');
    this.root.innerHTML = this.buildHtml();
    this.setupCompactSettings();

    this.startBtn = this.root.querySelector('.sk3d-start-btn');
    this.helpToggle = this.root.querySelector('.sk3d-help-toggle');
    this.helpPanel = this.root.querySelector('.sk3d-help-panel');
    this.muteBtn = this.root.querySelector('.sk3d-mute-toggle');
    this.volumeInput = this.root.querySelector('.sk3d-volume');
    this.ccBtns = Array.from(this.root.querySelectorAll('.sk3d-cc-btn'));
    this.assistToggles = Array.from(this.root.querySelectorAll('input[data-assist]'));

    // Selection-screen refs.
    this.racersBtn = this.root.querySelector('.sk3d-racers-btn');
    this.tracksBtn = this.root.querySelector('.sk3d-tracks-btn');
    this.switchModeBtn = this.root.querySelector('.sk3d-switch-btn');
    this.logsBtn = this.root.querySelector('.sk3d-logs-btn');
    this.pickLine = this.root.querySelector('.sk3d-current-pick');
    this.screenRacers = this.root.querySelector('.sk3d-screen-racers');
    this.screenTracks = this.root.querySelector('.sk3d-screen-tracks');
    this.backBtns = Array.from(this.root.querySelectorAll('.sk3d-back-btn'));
    this.charStrip = this.root.querySelector('.sk3d-char-strip');
    this.charCards = Array.from(this.root.querySelectorAll('.sk3d-char-card'));
    this.charPrev = this.root.querySelector('.sk3d-char-prev');
    this.charNext = this.root.querySelector('.sk3d-char-next');
    this.charSelect = this.root.querySelector('.sk3d-char-select');
    this.trackStrip = this.root.querySelector('.sk3d-track-strip');
    this.trackCards = Array.from(this.root.querySelectorAll('.sk3d-track-card'));
    this.trackPrev = this.root.querySelector('.sk3d-track-prev');
    this.trackNext = this.root.querySelector('.sk3d-track-next');
    this.trackSelect = this.root.querySelector('.sk3d-track-select');

    this.bindEvents();
    document.body.appendChild(this.root);
    // AUDIT v5 MED: restore the master volume slider (persisted)
    try {
      const v = parseFloat(localStorage.getItem('sk3d.volume'));
      if (v >= 0 && v <= 1 && this.volumeInput) {
        this.volumeInput.value = String(Math.round(v * 100));
        this.onVolume(v);
      }
    } catch { /* */ }
    this.restoreSettings(); // persisted difficulty/assist/track choices
    this.drawAllCanvases();
    this.refreshPickLine();
  }

  setupCompactSettings() {
    // Keep the landing screen fixed. All advanced controls live in one panel.
    const card = this.root.querySelector('.sk3d-menu-card');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sk3d-btn zario-settings-toggle';
    toggle.textContent = '⚙ SETTINGS';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'zario-settings-panel');
    const panel = document.createElement('section');
    panel.id = 'zario-settings-panel';
    panel.className = 'zario-settings-panel sk3d-hidden';
    panel.setAttribute('aria-label','Game settings');
    const head = document.createElement('div');
    head.className = 'zario-settings-heading';
    const heading = document.createElement('strong');
    heading.textContent = '⚙ RACE SETTINGS';
    const close = document.createElement('button');
    close.className = 'sk3d-btn zario-settings-close';
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label','Close settings');
    head.append(heading,close);
    panel.append(head);
    for (const selector of ['.sk3d-settings','.sk3d-volume-row','.sk3d-mute-toggle','.sk3d-help-toggle','.sk3d-help-panel','.sk3d-credit']) {
      const element = card.querySelector(selector);
      if (element) panel.append(element);
    }
    const picked = card.querySelector('.sk3d-current-pick');
    const subRow = card.querySelector('.sk3d-menu-actions-sub');
    if (subRow) {
      subRow.prepend(toggle);
      picked?.after(subRow);
    } else {
      picked?.after(toggle);
    }
    card.append(panel);
    const showPanel = (show) => {
      panel.classList.toggle('sk3d-hidden', !show);
      toggle.setAttribute('aria-expanded',String(show));
      if (show) panel.scrollTop = 0;
    };
    toggle.addEventListener('click', () => showPanel(panel.classList.contains('sk3d-hidden')));
    close.addEventListener('click', () => showPanel(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') showPanel(false); });
    this.closeSettings = () => showPanel(false);
  }

  buildHtml() {
    const rows = CONTROL_ROWS
      .map(
        ([action, keyboard, touch]) =>
          `<tr><td>${action}</td><td>${keyboard}</td><td>${touch}</td></tr>`
      )
      .join('');

    const statRow = (label, v) => `
      <span class="sk3d-stat">
        <span class="sk3d-stat-label">${label}</span>
        <span class="sk3d-stat-track"><span class="sk3d-stat-fill" style="width:${Math.round((v / 10) * 100)}%"></span></span>
        <span class="sk3d-stat-val">${v}</span>
      </span>`;

    // RACERS screen: one character card at a time (canvas kart silhouette +
    // name + color swatch + SPD/ACC/HAN bars). Cards flip via ◀ ▶ arrows or
    // swipe; SELECT confirms.
    const charCards = CONFIG.kart.characters
      .map((c, i) => {
        const sel = i === 0;
        return `
        <button type="button" class="sk3d-char-card${sel ? ' is-selected' : ''}" data-index="${i}" role="radio" aria-checked="${sel}" aria-label="Select ${c.name}">
          <canvas class="sk3d-char-canvas" width="400" height="280" aria-hidden="true"></canvas>
          <span class="sk3d-char-name"><span class="sk3d-char-swatch" style="background:${toHex(c.color)}"></span>${c.name}</span>
          <span class="sk3d-stats">
            ${statRow('SPD', c.stats.speed)}
            ${statRow('ACC', c.stats.accel)}
            ${statRow('HAN', c.stats.handling)}
          </span>
        </button>`;
      })
      .join('');

    // TRACKS screen: canvas-drawn layout (control points projected XZ) +
    // start-line marker on each card.
    const trackCards = TRACKS
      .map((t, i) => {
        const sel = t.id === 1;
        return `
        <button type="button" class="sk3d-track-card${sel ? ' is-selected' : ''}" data-track="${t.id}" role="radio" aria-checked="${sel}" aria-label="Select ${t.name}">
          <canvas class="sk3d-track-canvas" width="600" height="380" aria-hidden="true"></canvas>
          <span class="sk3d-track-name">${t.icon} ${t.name}${sel ? ' <em class="sk3d-picked-badge">PICKED</em>' : ''}</span>
          <span class="sk3d-track-desc">${t.desc}</span>
          <span class="sk3d-track-num">${i + 1}/${TRACKS.length}</span>
        </button>`;
      })
      .join('');

    const ccBtns = CONFIG.cc.levels
      .map((cc) => {
        const sel = cc === CONFIG.cc.default;
        return `<button type="button" class="sk3d-btn sk3d-cc-btn" data-cc="${cc}" role="radio" aria-checked="${sel}" style="padding:8px 18px;font-size:1rem;background:${sel ? 'var(--sk3d-yellow)' : 'var(--sk3d-cream)'}">${cc}cc</button>`;
      })
      .join('');

    return `
      <div class="sk3d-menu-card">
        <h1 class="sk3d-logo">
          <span class="sk3d-logo-line">ZARIO KART</span>
          <span class="sk3d-logo-sub">RACE THE WORLD</span>
        </h1>
        <div class="sk3d-logo-strip" aria-hidden="true"></div>
        <p class="sk3d-tagline">PICK A RIDE • HIT THE TRACK</p>
        <button type="button" class="sk3d-btn sk3d-primary-btn sk3d-start-btn">🏁 Start Race</button>
        <button type="button" class="sk3d-btn sk3d-help-toggle" aria-expanded="false">❓ How to Play</button>
        <div class="sk3d-help-panel sk3d-hidden">
          <table class="sk3d-controls-table">
            <thead><tr><th>Action</th><th>Keyboard</th><th>Touch</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="sk3d-menu-actions" role="group" aria-label="Choose racer or track">
          <button type="button" class="sk3d-btn sk3d-action-btn sk3d-racers-btn">🏎️ RACERS</button>
          <button type="button" class="sk3d-btn sk3d-action-btn sk3d-tracks-btn">🗺️ TRACKS (6)</button>
        </div>
        <div class="sk3d-menu-actions sk3d-menu-actions-sub" role="group" aria-label="Samsung TV Switch Mode and Telemetry">
          <button type="button" class="sk3d-btn sk3d-action-btn sk3d-switch-btn" title="Play on 45-inch Samsung Smart TV using iPhone as wireless controller">📺 TV + iPhone</button>
          <button type="button" class="sk3d-btn sk3d-action-btn sk3d-logs-btn" title="View detailed race, ramp, model & TV telemetry logs (F9)">📋 Logs</button>
        </div>
        <div class="sk3d-current-pick" aria-live="polite"></div>
        <div class="sk3d-settings" role="group" aria-label="Race settings">
          <div class="sk3d-setting-row" style="display:flex;flex-direction:column;align-items:center;gap:8px;">
            <span class="sk3d-color-label" id="sk3d-cc-label">Engine class</span>
            <div class="sk3d-cc-row" role="radiogroup" aria-labelledby="sk3d-cc-label" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">${ccBtns}</div>
          </div>
          <div class="sk3d-assist-row" role="group" aria-label="Driving assists" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <label class="sk3d-btn sk3d-assist-toggle" style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;font-size:0.95rem;">
              <input type="checkbox" data-assist="autoAccel" /> Auto-accelerate
            </label>
            <label class="sk3d-btn sk3d-assist-toggle" style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;font-size:0.95rem;">
              <input type="checkbox" data-assist="steerAssist" /> Steer assist
            </label>
          </div>
        </div>
        <div class="sk3d-volume-row">
          <span class="sk3d-volume-label">Vol</span>
          <input type="range" class="sk3d-volume" min="0" max="100" value="80" aria-label="Master volume" />
        </div>
        <button type="button" class="sk3d-btn sk3d-mute-toggle" aria-pressed="false">🔊 Sound on</button>
        <footer class="sk3d-credit">Made with Three.js — open source</footer>
      </div>

      <div class="sk3d-screen sk3d-screen-racers sk3d-hidden" role="dialog" aria-modal="true" aria-label="Select racer">
        <div class="sk3d-screen-card">
          <div class="sk3d-screen-head">
            <button type="button" class="sk3d-btn sk3d-back-btn" aria-label="Back to menu">← Back</button>
            <h2 class="sk3d-screen-title">🏁 Choose Your Racer</h2>
            <span class="sk3d-screen-spacer" aria-hidden="true"></span>
          </div>
          <div class="sk3d-carousel">
            <button type="button" class="sk3d-btn sk3d-arrow-btn sk3d-char-prev" aria-label="Previous racer">‹</button>
            <div class="sk3d-cards-strip sk3d-char-strip" role="radiogroup" aria-label="Racers" tabindex="0">${charCards}</div>
            <button type="button" class="sk3d-btn sk3d-arrow-btn sk3d-char-next" aria-label="Next racer">›</button>
          </div>
          <button type="button" class="sk3d-btn sk3d-primary-btn sk3d-select-btn sk3d-char-select">✅ SELECT</button>
        </div>
      </div>

      <div class="sk3d-screen sk3d-screen-tracks sk3d-hidden" role="dialog" aria-modal="true" aria-label="Select track">
        <div class="sk3d-screen-card">
          <div class="sk3d-screen-head">
            <button type="button" class="sk3d-btn sk3d-back-btn" aria-label="Back to menu">← Back</button>
            <h2 class="sk3d-screen-title">🗺️ Choose Your Track</h2>
            <span class="sk3d-screen-spacer" aria-hidden="true"></span>
          </div>
          <div class="sk3d-carousel">
            <button type="button" class="sk3d-btn sk3d-arrow-btn sk3d-track-prev" aria-label="Previous track">‹</button>
            <div class="sk3d-cards-strip sk3d-track-strip" role="radiogroup" aria-label="Tracks" tabindex="0">${trackCards}</div>
            <button type="button" class="sk3d-btn sk3d-arrow-btn sk3d-track-next" aria-label="Next track">›</button>
          </div>
          <button type="button" class="sk3d-btn sk3d-primary-btn sk3d-select-btn sk3d-track-select">✅ SELECTED</button>
        </div>
      </div>`;
  }

  bindEvents() {
    this.startBtn.addEventListener('click', () => {
      if (this.startBtn.disabled) return;
      this.onSound('uiSelect');
      this.startBtn.disabled = true;
      this.startBtn.textContent = '⏳ Loading race…';
      // Give the browser one paint before Three.js builds the race scene.
      this.onStart();
    });
    this.helpToggle.addEventListener('click', () => { this.onSound('uiClick'); this.toggleHelp(); });

    // Compact main-menu buttons open the full-screen selection screens.
    this.racersBtn.addEventListener('click', () => { this.onSound('uiSelect'); this.openScreen(this.screenRacers); });
    this.tracksBtn.addEventListener('click', () => { this.onSound('uiSelect'); this.openScreen(this.screenTracks); });
    this.switchModeBtn?.addEventListener('click', () => {
      this.onSound('uiSelect');
      window.__zarioOpenSwitchModal?.();
    });
    this.logsBtn?.addEventListener('click', () => {
      this.onSound('uiClick');
      window.__zarioLogger?.toggleOverlay?.();
    });
    for (const b of this.backBtns) {
      b.addEventListener('click', () => { this.onSound('uiClick'); this.closeScreens(); });
    }

    // RACERS screen: arrows flip the selection, cards select, SELECT confirms.
    this.charPrev.addEventListener('click', () => { this.onSound('uiClick'); this.stepChar(-1); });
    this.charNext.addEventListener('click', () => { this.onSound('uiClick'); this.stepChar(1); });
    for (const card of this.charCards) {
      card.addEventListener('click', () => { this.onSound('uiClick'); this.selectChar(card); });
    }
    this.charSelect.addEventListener('click', () => { this.onSound('uiSelect'); this.closeScreens(); });

    // TRACKS screen: arrows flip, cards select, SELECT swaps the world.
    this.trackPrev.addEventListener('click', () => { this.onSound('uiClick'); this.stepTrack(-1); });
    this.trackNext.addEventListener('click', () => { this.onSound('uiClick'); this.stepTrack(1); });
    for (const card of this.trackCards) {
      card.addEventListener('click', () => { this.onSound('uiClick'); this.selectTrackCard(card); });
    }
    this.trackSelect.addEventListener('click', () => { this.onSound('uiSelect'); this.confirmTrack(); });

    // Engine class + assist toggles (difficulty/accessibility layer, audit r3).
    for (const b of this.ccBtns) {
      b.addEventListener('click', () => { this.onSound('uiClick'); this.selectCc(Number(b.dataset.cc)); });
    }
    for (const input of this.assistToggles) {
      input.addEventListener('change', () => {
        this.onSound('uiClick');
        this[input.dataset.assist] = input.checked;
        this.saveSettings();
      });
    }

    // Escape closes an open selection screen back to the main card.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeScreens();
    });

    // Hover feedback (audit minor: 'uiHover' recipe existed but was never
    // wired). Gate to real hover pointers (v4 F6: on touch, pointerenter
    // fires on tap → hover+click double-tick).
    const canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
    if (canHover) {
      for (const el of [
        this.startBtn, this.helpToggle, this.muteBtn, this.racersBtn, this.tracksBtn,
        ...this.ccBtns, ...this.backBtns, this.charPrev, this.charNext,
        this.charSelect, this.trackPrev, this.trackNext, this.trackSelect,
        ...this.charCards, ...this.trackCards,
      ]) {
        el.addEventListener('pointerenter', () => { this.onSound('uiHover'); });
      }
    }
    if (this.volumeInput) {
      this.volumeInput.addEventListener('input', () => {
        const v = Number(this.volumeInput.value) / 100;
        try { localStorage.setItem('sk3d.volume', String(v)); } catch { /* */ }
        this.onVolume(v);
      });
    }
    this.muteBtn.addEventListener('click', () => {
      // AUDIT v4: the ack must play AFTER the master gain returns (setMuted
      // ramps ~50ms) — playing uiClick before toggleMute landed in silence
      // when UNMUTING, so unmute gave zero confirmation.
      this.toggleMute();
      setTimeout(() => this.onSound('uiClick'), this.muted ? 0 : 70);
    }); // AUDIT MED: mute had no sound ack, unlike every other menu control
  }

  /** Flip the audio mute toggle (persisted in localStorage). */
  toggleMute() {
    this.muted = !this.muted;
    this.muteBtn.setAttribute('aria-pressed', String(this.muted));
    this.muteBtn.textContent = this.muted ? '🔇 Sound off' : '🔊 Sound on';
    try {
      localStorage.setItem('sk3d.muted', this.muted ? '1' : '0');
    } catch { /* private mode */ }
    this.onToggleMute(this.muted);
  }

  /** AUDIT MED-1: reconcile the menu mute label with the real audio state.
   *  Muting from the pause overlay left the menu showing 'Sound on' (stale),
   *  so the first menu click looked dead (needed two). */
  reconcileMute() {
    const aud = window.__sk3d?.audio;
    if (!aud) return;
    this.muted = !!aud.muted;
    if (this.muteBtn) {
      this.muteBtn.setAttribute('aria-pressed', String(this.muted));
      this.muteBtn.textContent = this.muted ? '🔇 Sound off' : '🔊 Sound on';
    }
  }

  /** Restore the persisted mute state. */
  restoreMute() {
    try {
      if (localStorage.getItem('sk3d.muted') === '1') this.toggleMute();
    } catch { /* private mode */ }
  }

  /** Pick an engine class (50/100/150cc) — persisted + published (audit r3). */
  selectCc(cc) {
    if (!CONFIG.cc.levels.includes(cc)) return;
    this.cc = cc;
    for (const b of this.ccBtns) {
      const sel = Number(b.dataset.cc) === cc;
      b.setAttribute('aria-checked', String(sel));
      b.style.background = sel ? 'var(--sk3d-yellow)' : 'var(--sk3d-cream)';
    }
    this.saveSettings();
  }

  /** Persist difficulty/assist/driver/track choices + publish to window. */
  saveSettings() {
    try {
      localStorage.setItem('sk3d.cc', String(this.cc));
      localStorage.setItem('sk3d.autoAccel', this.autoAccel ? '1' : '0');
      localStorage.setItem('sk3d.steerAssist', this.steerAssist ? '1' : '0');
      localStorage.setItem('sk3d.char', String(this.selectedChar));
      localStorage.setItem('sk3d.track', String(this.trackId));
    } catch { /* private mode */ }
    this.syncGlobals();
  }

  /** Live settings on window so main.js reads them at race start. */
  syncGlobals() {
    window.__sk3dCc = this.cc;
    window.__sk3dAutoAccel = this.autoAccel;
    window.__sk3dSteerAssist = this.steerAssist;
    window.__sk3dChar = this.selectedChar; // driver index (buildKarts reads it)
    window.__sk3dTrack = this.trackId; // track id (main.js TRACK_ID + reloads)
  }

  /** Restore persisted difficulty/assist/track choices (constructor → DOM). */
  restoreSettings() {
    try {
      const savedCc = Number(localStorage.getItem('sk3d.cc'));
      if (CONFIG.cc.levels.includes(savedCc)) this.cc = savedCc;
      if (localStorage.getItem('sk3d.autoAccel') === '1') this.autoAccel = true;
      if (localStorage.getItem('sk3d.steerAssist') === '1') this.steerAssist = true;
      const savedTrack = Number(localStorage.getItem('sk3d.track'));
      if ([1,2,3,4,5,6].includes(savedTrack)) this.trackId = savedTrack;
    } catch { /* private mode */ }
    for (const b of this.ccBtns) {
      const sel = Number(b.dataset.cc) === this.cc;
      b.setAttribute('aria-checked', String(sel));
      b.style.background = sel ? 'var(--sk3d-yellow)' : 'var(--sk3d-cream)';
    }
    for (const input of this.assistToggles) {
      input.checked = input.dataset.assist === 'autoAccel' ? this.autoAccel : this.steerAssist;
    }
    // Restore the persisted driver + track picks onto the cards.
    try {
      const savedChar = Number(localStorage.getItem('sk3d.char'));
      if (Number.isFinite(savedChar) && CONFIG.kart.characters[savedChar]) this.selectedChar = savedChar;
    } catch { /* private mode */ }
    for (const card of this.charCards) this._setCardSelected(card, Number(card.dataset.index) === this.selectedChar);
    for (const card of this.trackCards) this._setCardSelected(card, Number(card.dataset.track) === this.trackId);
    this.saveSettings();
  }

  toggleHelp() {
    const open = !this.helpPanel.classList.contains('sk3d-hidden');
    this.helpPanel.classList.toggle('sk3d-hidden', open);
    this.helpToggle.setAttribute('aria-expanded', String(!open));
  }

  // -------------------------------------------------------------------------
  // Selection screens
  // -------------------------------------------------------------------------

  /** Open a full-screen selection overlay (hides the main card). */
  openScreen(screen) {
    if (!screen) return;
    this.root.querySelector('.sk3d-menu-card').classList.add('sk3d-hidden');
    for (const s of [this.screenRacers, this.screenTracks]) {
      if (s === screen) {
        s.classList.remove('sk3d-hidden');
        s.classList.remove('sk3d-screen-anim');
        void s.offsetWidth; // restart the entrance animation
        s.classList.add('sk3d-screen-anim');
        const back = s.querySelector('.sk3d-back-btn');
        if (back) back.focus({ preventScroll: true });
      } else {
        s.classList.add('sk3d-hidden');
      }
    }
    if (screen === this.screenRacers) {
      racerShowroom3D.renderAllCards(this.charCards, drawKart);
      racerShowroom3D.startLive(this.charCards, () => this.selectedChar);
      const activeCard = this.charCards[this.selectedChar];
      if (activeCard) this._centerCard(this.charStrip, activeCard);
    } else {
      racerShowroom3D.stopLive();
    }
  }

  /** Close the selection screens back to the main card. */
  closeScreens() {
    racerShowroom3D.stopLive();
    if (this.screenRacers.classList.contains('sk3d-hidden') && this.screenTracks.classList.contains('sk3d-hidden')) return;
    this.screenRacers.classList.add('sk3d-hidden');
    this.screenTracks.classList.add('sk3d-hidden');
    this.root.querySelector('.sk3d-menu-card').classList.remove('sk3d-hidden');
    this.refreshPickLine();
  }

  /** Center a card inside its snap strip (arrow flip-through). */
  _centerCard(strip, card) {
    if (!strip || !card) return;
    const left = card.offsetLeft - (strip.clientWidth - card.clientWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }

  /** Flip to the neighbouring racer (wraps around the roster). */
  stepChar(dir) {
    const n = CONFIG.kart.characters.length;
    const next = (this.selectedChar + dir + n) % n;
    this.selectChar(this.charCards[next]);
  }

  /** Pick a racer card: publish __sk3dChar, repaint the kart (onColor),
   *  persist and center the card. */
  selectChar(card) {
    const index = Number(card.dataset.index);
    if (!CONFIG.kart.characters[index]) return;
    this.selectedChar = index;
    for (const c of this.charCards) this._setCardSelected(c, c === card);
    this.onColor(CONFIG.kart.characters[index].color);
    this.saveSettings();
    this.refreshPickLine();
    this._centerCard(this.charStrip, card);
  }

  /** Flip to the neighbouring track (wraps the 2-track catalog). */
  stepTrack(dir) {
    const idx = TRACKS.findIndex((t) => t.id === this.trackId);
    const next = TRACKS[(idx + dir + TRACKS.length) % TRACKS.length];
    this.selectTrackCard(this.trackCards.find((c) => Number(c.dataset.track) === next.id));
  }

  /** Pick a track card (visual preview only — SELECT applies it). */
  selectTrackCard(card) {
    if (!card) return;
    const id = Number(card.dataset.track);
    if (!TRACKS.some((t) => t.id === id)) return;
    this.trackId = id;
    for (const c of this.trackCards) this._setCardSelected(c, c === card);
    this.saveSettings();
    this.refreshPickLine();
    this._centerCard(this.trackStrip, card);
  }

  /** TRACKS SELECT: publish __sk3dTrack, persist, then swap the whole world
   *  (track + environment theme) via the established ?track= reload. */
  confirmTrack() {
    this.trackSelect.disabled = true;
    this.trackSelect.textContent = 'Switching track…';
    try {
      localStorage.setItem('sk3d.track', String(this.trackId));
    } catch { /* private mode */ }
    window.__sk3dTrack = this.trackId;
    this.saveSettings();
    setTimeout(() => {
      location.search = '?track=' + this.trackId;
    }, 350);
  }

  /** Reflect a card's selected state (class + aria). */
  _setCardSelected(card, sel) {
    card.classList.toggle('is-selected', sel);
    card.setAttribute('aria-checked', String(sel));
  }

  /** Repaint every canvas (3D showroom kart previews + track layouts). */
  drawAllCanvases() {
    racerShowroom3D.renderAllCards(this.charCards, drawKart);
    for (const card of this.trackCards) {
      const canvas = card.querySelector('canvas');
      const t = TRACKS.find((x) => x.id === Number(card.dataset.track));
      if (canvas && t) drawTrackLayout(canvas, t.points);
    }
  }

  /** Main-card summary line: current racer + track. */
  refreshPickLine() {
    if (!this.pickLine) return;
    const c = CONFIG.kart.characters[this.selectedChar];
    const t = TRACKS.find((x) => x.id === this.trackId) || TRACKS[0];
    this.pickLine.innerHTML = `
      <span class="sk3d-pick-dot" style="background:${toHex(c.color)}"></span>
      <span>${c.name}</span>
      <span aria-hidden="true">·</span>
      <span>${t.icon} ${t.name}</span>`;
  }

  /** @returns {number} selected driver index into CONFIG.kart.characters. */
  getCharacter() {
    return this.selectedChar;
  }

  /** Reflect an externally chosen driver index (e.g. persisted pick on boot). */
  setSelectedCharacter(index) {
    if (!CONFIG.kart.characters[index]) return;
    this.selectedChar = index;
    for (const c of this.charCards) this._setCardSelected(c, Number(c.dataset.index) === index);
    this.refreshPickLine();
    this.syncGlobals(); // keep window.__sk3dChar in sync with the external pick
  }

  /** @returns {number} currently selected kart color (0xRRGGBB). */
  getColor() {
    return this.selectedColor;
  }

  /** @returns {number} selected engine class (50 | 100 | 150). */
  getCc() {
    return this.cc;
  }

  /** @returns {number} selected track id (1 = Meadow Circuit, 2 = Neon City). */
  getTrack() {
    return this.trackId;
  }

  /** @returns {boolean} auto-accelerate assist enabled. */
  isAutoAccel() {
    return this.autoAccel;
  }

  /** @returns {boolean} steer-assist enabled. */
  isSteerAssist() {
    return this.steerAssist;
  }

  /** @returns {{cc:number, autoAccel:boolean, steerAssist:boolean, color:number, character:number, track:number}} */
  getSelection() {
    return { cc: this.cc, autoAccel: this.autoAccel, steerAssist: this.steerAssist, color: this.selectedColor, character: this.selectedChar, track: this.trackId };
  }

  /** Show the menu. Idempotent — DOM is built once in the constructor. */
  show() {
    this.startBtn.disabled = false;
    this.startBtn.textContent = '🏁 Start Race';
    this.reconcileMute(); // AUDIT MED-1: menu mute label went stale after pause-mute
    this.closeScreens();
    this.closeSettings?.();
    this.refreshPickLine();
    this.root.classList.remove('sk3d-hidden');
    // Re-trigger the entrance animation on every show.
    this.root.classList.remove('sk3d-menu-anim');
    void this.root.offsetWidth;
    this.root.classList.add('sk3d-menu-anim');
    this.startBtn.focus({ preventScroll: true });
  }

  /** Reflect the persisted kart color (audit v4 F2 — no swatch row anymore;
   *  the racer's identity color drives the kart paint unless overridden). */
  setSelectedColor(color) {
    this.selectedColor = color;
  }

  hide() {
    racerShowroom3D.stopLive();
    this.root.classList.add('sk3d-hidden');
  }
}
