/**
 * Zario Kart — in-race HUD overlay.
 *
 * Pure DOM, appended to document.body, hidden by default.
 * Shows position pips, lap counter, race time, a circular speedometer
 * with needle, the held item slot, countdown, finish screen and toasts.
 */
import { CONFIG } from '../config.js';
import { computeUpcomingTurn } from './RouteHints.js';
import './ui.css';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** PowerUpType (VALUE) -> emoji icon. Keys are lowercase values: 'shell',
 *  'red_shell', … — matches kart.heldItem exactly. */
const ITEM_ICONS = {
  mushroom: '🍄',
  shell: '🐢',
  red_shell: '🐢', // styled red via .sk3d-item-red
  banana: '🍌',
  star: '⭐',
  lightning: '⚡',
};

/** PowerUpType (VALUE) -> readable name shown under the icon. */
const ITEM_NAMES = {
  mushroom: 'Mushroom',
  shell: 'Green Shell',
  red_shell: 'Red Shell',
  banana: 'Banana',
  star: 'Star',
  lightning: 'Lightning',
};

/** km/h at the top of the gauge: ~42 m/s * 2.4 ≈ 100 km/h. */
const MAX_KMH = Math.round(CONFIG.physics.maxSpeed * 2.4);
const ARC_RADIUS = 62;
const ARC_LENGTH = 1.5 * Math.PI * ARC_RADIUS; // 270° MK8-style dial
const COUNTDOWN_NUMBER_MS = 1200; // safety auto-hide for numbers
const COUNTDOWN_GO_MS = 900;
const TOAST_MS = 2400;

/** Rank medals shown beside the ordinal on the position chip. */
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** Minimap: number of samples used to flatten the track path into a polyline. */
const MINIMAP_SAMPLES = 120;
const MINIMAP_SIZE = 120;
const MINIMAP_PAD = 9;
const DOT_R = 4;
const DOT_R_LEADER = 5.5;
const DOT_R_PLAYER = 5.5; // AUDIT R11: dot do jogador maior — a 72px o 4 virava ~2.4px e sumia no traçado

/** Fallback AI dot color if a kart has no readable body material. */
const DOT_FALLBACK_COLOR = '#ff5a5f';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11-13 -> "11th"; invalid -> "--". */
export function ordinal(n) {
  if (!Number.isFinite(n) || n < 1) return '--';
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  const suffix = mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** seconds -> "m:ss.t" */
export function formatTime(seconds) {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const tenth = Math.floor((s * 10) % 10);
  return `${m}:${String(sec).padStart(2, '0')}.${tenth}`;
}

/** Kart body color as a CSS string, read from the live body material. */
function kartDotColor(kart) {
  const mat = kart && kart._bodyMat;
  if (mat && mat.color && typeof mat.color.getStyle === 'function') {
    return mat.color.getStyle();
  }
  return DOT_FALLBACK_COLOR;
}

export class HUD {
  /**
   * @param {object|null} [track] Track descriptor from buildTrack() — used to
   *   render the minimap polyline. Anything with a `path.getPointAt(t)` curve
   *   works; pass null/undefined to skip the minimap entirely.
   */
  constructor(track = null) {
    this.root = document.createElement('div');
    this.root.className = 'sk3d-overlay sk3d-hud sk3d-hidden';

    this.root.innerHTML = `
      <div class="sk3d-hud-top">
        <div class="sk3d-hud-left">
          <div class="sk3d-chip sk3d-lap">
            <span class="sk3d-lap-text">LAP 1/${CONFIG.game.totalLaps}</span>
            <span class="sk3d-lap-bar"><span class="sk3d-lap-bar-fill"></span></span>
          </div>
          <div class="sk3d-chip sk3d-time">0:00.0</div>
        </div>
        <div class="sk3d-hud-right">
          <div class="sk3d-chip sk3d-coins" title="Coin top-speed bonus (max +10%)" style="color:#ffd166;letter-spacing:0.06em;">🪙 <span class="sk3d-coin-count">0</span><span class="sk3d-coin-max">/${Math.round(CONFIG.items.coinSpeedCap / CONFIG.items.coinSpeedBonus)}</span></div>
        </div>
      </div>
      <!-- MK8D bottom HUD: rank plate + item slots bottom-LEFT (item slots
           stacked ABOVE the rank chip), speedo + drift meter bottom-RIGHT. -->
      <div class="sk3d-hud-bottom">
        <div class="sk3d-hud-bottom-left">
          <div class="sk3d-item-zone"></div>
          <div class="sk3d-chip sk3d-position"><span class="sk3d-position-player">YOU</span><span class="sk3d-position-value">--</span></div>
        </div>
        <div class="sk3d-hud-bottom-right"></div>
      </div>
      <div class="sk3d-hitflash sk3d-hidden" aria-hidden="true"></div>
      <div class="sk3d-draft sk3d-hidden">DRAFT</div>
      <div class="sk3d-countdown sk3d-hidden">3</div>
      <div class="sk3d-pause sk3d-hidden" role="dialog" aria-modal="true" aria-labelledby="sk3d-pause-title">
        <div id="sk3d-pause-title" class="sk3d-pause-title">⏸ PAUSED</div>
        <div class="sk3d-pause-hint">Press P / tap to resume</div>
        <div class="sk3d-pause-actions">
          <button type="button" class="sk3d-btn sk3d-pause-restart" aria-label="Restart race">↻ Restart</button>
          <button type="button" class="sk3d-btn sk3d-pause-sound" aria-label="Toggle sound">🔊 Sound</button>
          <button type="button" class="sk3d-btn sk3d-pause-menu" aria-label="Open main menu">⌂ Menu</button>
        </div>
      </div>
      <div class="sk3d-finish sk3d-hidden" role="dialog" aria-modal="true" aria-labelledby="sk3d-finish-title">
        <div class="sk3d-finish-card">
          <div class="sk3d-finish-trophy" aria-hidden="true">🏆</div>
          <div id="sk3d-finish-title" class="sk3d-finish-title">FINISHED <span class="sk3d-finish-place">1st</span>!</div>
          <div class="sk3d-finish-track" aria-label="Track"></div>
          <div class="sk3d-finish-time">0:00.0</div>
          <div class="sk3d-finish-results" aria-label="Final standings"></div>
          <button type="button" class="sk3d-finish-btn" aria-label="Race again">Race Again</button>
          <button type="button" class="sk3d-menu-btn" aria-label="Open main menu">Menu</button>
          <div class="sk3d-finish-hint">or press R</div>
        </div>
      </div>
      <div class="sk3d-toast sk3d-hidden" role="status"></div>
      <div class="sk3d-route-cue sk3d-hidden" role="status" aria-live="polite"><span class="sk3d-route-cue-arrow">↶</span><span class="sk3d-route-cue-label">TURN LEFT</span></div>`;

    // MK8D bottom HUD: speedo + drift meter bottom-RIGHT; item slots + rank
    // plate bottom-LEFT (items stacked ABOVE the rank chip).
    const bottom = this.root.querySelector('.sk3d-hud-bottom');
    const bottomRight = this.root.querySelector('.sk3d-hud-bottom-right');
    const itemZone = this.root.querySelector('.sk3d-item-zone');
    const speedo = this.buildSpeedometer();
    this.speedoWrap = speedo.wrap;
    this.speedNeedle = speedo.needle;
    this.speedArc = speedo.arc;
    this.speedValueEl = speedo.wrap.querySelector('.sk3d-speedo-value');
    // AUDIT r9: high-speed wind streaks (MK8D) — a full-screen canvas overlay
    // of radial speed lines, opacity ramps in above 80% top speed.
    this.speedlineCanvas = document.createElement('canvas');
    this.speedlineCanvas.className = 'sk3d-speedlines';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.speedlineCanvas.width = Math.round(window.innerWidth * dpr);
    this.speedlineCanvas.height = Math.round(window.innerHeight * dpr);
    this.speedlineCanvas.style.width = window.innerWidth + 'px';
    this.speedlineCanvas.style.height = window.innerHeight + 'px';
    this.speedlineCtx = this.speedlineCanvas.getContext('2d');
    this.speedlineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.root.appendChild(this.speedlineCanvas);
    // AUDIT r5: the gauge scale was a load-time constant (MAX_KMH≈101) so the
    // needle PEGGED at 150cc. Now dynamic — startRace() calls setMaxKmh().
    this._maxKmh = MAX_KMH;
    bottomRight.append(speedo.wrap);
    itemZone.append(this.buildItemSlot());
    // Drift charge meter: a thin bar under the speedometer that fills while
    // drifting (white → yellow → orange, matching the spark colors). Only
    // visible while the player is actually drifting.
    const drift = document.createElement('div');
    drift.className = 'sk3d-drift-meter sk3d-hidden';
    // Tick at the mini-boost release threshold (75%) so the player knows when to let go.
    drift.innerHTML = '<div class="sk3d-drift-fill"></div><div class="sk3d-drift-tick"></div><span class="sk3d-drift-label">DRIFT</span>';
    bottomRight.append(drift);
    this.driftMeterEl = drift;
    this.driftFillEl = drift.querySelector('.sk3d-drift-fill');

    this.positionEl = this.root.querySelector('.sk3d-position');
    this.positionValueEl = this.root.querySelector('.sk3d-position-value');
    this.draftEl = this.root.querySelector('.sk3d-draft');
    this.hitFlashEl = this.root.querySelector('.sk3d-hitflash');
    this.lapEl = this.root.querySelector('.sk3d-lap');
    this.lapTextEl = this.root.querySelector('.sk3d-lap-text');
    this.lapBarFillEl = this.root.querySelector('.sk3d-lap-bar-fill');
    this.timeEl = this.root.querySelector('.sk3d-time');
    this.itemIconEl = this.root.querySelector('.sk3d-item-icon');
    // AUDIT r3 dual-slot: reserve slot + coin counter refs.
    this.itemCountEl = this.root.querySelector('.sk3d-item-count');
    this.item2SlotEl = this.root.querySelector('.sk3d-item2-slot');
    this.item2IconEl = this.root.querySelector('.sk3d-item2-icon');
    this.item2CountEl = this.root.querySelector('.sk3d-item2-count');
    this.coinCountEl = this.root.querySelector('.sk3d-coin-count');
    this.onSwap = null; // wired by main.js: swap the player's held slots
    if (this.item2SlotEl) {
      this.item2SlotEl.addEventListener('click', () => {
        window.__sk3d?.audio?.play?.('uiClick', { volume: 0.5 });
        // AUDIT: swap com os dois slots vazios = no-op — agora treme o
        // mini-slot em vez de só tocar o click (era silencioso visualmente).
        if (!this.itemType && !this._item2Type) {
          const mini = this.item2SlotEl;
          mini.classList.remove('sk3d-item2-nope');
          void mini.offsetWidth;
          mini.classList.add('sk3d-item2-nope');
          return;
        }
        if (this.onSwap) this.onSwap();
      });
    }
    this.countdownEl = this.root.querySelector('.sk3d-countdown');
    this.finishEl = this.root.querySelector('.sk3d-finish');
    this.finishCardEl = this.root.querySelector('.sk3d-finish-card');
    this.finishPlaceEl = this.root.querySelector('.sk3d-finish-place');
    this.finishBtnEl = this.root.querySelector('.sk3d-finish-btn');
    this.finishBtnEl.addEventListener('click', () => window.__sk3d?.restartRace?.());
    this.menuBtnEl = this.root.querySelector('.sk3d-menu-btn');
    this.menuBtnEl.addEventListener('click', () => window.__sk3d?.gotoMenu?.());
    // Pause overlay actions (AUDIT r2: pause was a touch dead-end — only
    // 'tap to resume'; touch players couldn't restart/quit mid-race).
    const pr = this.root.querySelector('.sk3d-pause-restart');
    if (pr) pr.addEventListener('click', () => window.__sk3d?.restartRace?.());
    const ps = this.root.querySelector('.sk3d-pause-sound');
    if (ps) ps.addEventListener('click', (e) => {
      // AUDIT HIGH-2: the click bubbled to .sk3d-pause → togglePause(), so
      // tapping Sound while paused silently RESUMED the race. Stop the bubble.
      e.stopPropagation();
      window.__sk3d?.audio?.toggleMute?.();
    });
    const pm = this.root.querySelector('.sk3d-pause-menu');
    if (pm) pm.addEventListener('click', () => window.__sk3d?.gotoMenu?.());
    this.finishTimeEl = this.root.querySelector('.sk3d-finish-time');
    this.finishTrackEl = this.root.querySelector('.sk3d-finish-track');
    this.toastEl = this.root.querySelector('.sk3d-toast');
    this.routeCueEl = this.root.querySelector('.sk3d-route-cue');
    this.routeCueArrowEl = this.root.querySelector('.sk3d-route-cue-arrow');
    this.routeCueLabelEl = this.root.querySelector('.sk3d-route-cue-label');
    this.toastEl.setAttribute('aria-live', 'polite'); // toast only (root was too chatty)

    this.countdownTimer = 0;
    this.toastTimer = 0;
    this._idle = false; // AUDIT imersão (R11): estado do auto-hide (setIdle)

    // Caches so per-frame update() never churns the DOM.
    this._pos = null;
    this._lapText = null;
    this._lapPct = null;
    this._timeText = null;
    this.itemType = null;
    this._itemCount = 1; // main slot stack size (triple badge)
    this._item2Type = null; // reserve slot cache
    this._item2Count = 1;
    this._coins = 0;

    // Circular minimap — sits between the left chips and the race clock.
    this._mm = this.buildMinimap(track);
    this._trackPath = track && track.path;
    this._trackLength = Number(track && track.length) || 0;
    if (this._mm) {
      // Minimap sits in the TOP-RIGHT corner group (left of the coin counter),
      // so it never covers the finish gantry / action in screen center.
      const right = this.root.querySelector('.sk3d-hud-right');
      right.prepend(this._mm.wrap);
    }

    document.body.appendChild(this.root);
  }


  /** Item acquisition: glowing pickup flies to the touch ammo button.
   *  The original box itself breaks into instanced 3D shards in ItemBox. */
  animateItemPickup(worldPosition,type,camera) {
    const dest=document.querySelector('.sk3d-touch-item') || this.root.querySelector('.sk3d-item-slot');
    if(!dest||!camera||!worldPosition)return;
    const target=dest.getBoundingClientRect();
    const origin=worldPosition.clone();
    camera.updateMatrixWorld();
    origin.project(camera);
    const canvas=document.querySelector('#app canvas');
    const viewport=canvas?.getBoundingClientRect()||{left:0,top:0,width:innerWidth,height:innerHeight};
    let x=viewport.left+(origin.x*0.5+0.5)*viewport.width;
    let y=viewport.top+(-origin.y*0.5+0.5)*viewport.height;
    x=Math.max(24,Math.min(innerWidth-24,x));
    y=Math.max(24,Math.min(innerHeight-24,y));
    const targetX=target.left+target.width/2;
    const targetY=target.top+target.height/2;
    const fly=document.createElement('span');
    fly.className='zario-item-fly';
    fly.textContent=ITEM_ICONS[type]||'✨';
    fly.setAttribute('aria-hidden','true');
    fly.style.left=x+'px';
    fly.style.top=y+'px';
    document.body.appendChild(fly);
    const reduce=matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if(reduce||typeof fly.animate!=='function') {
      fly.remove();
    }else{
      const dx=targetX-x,dy=targetY-y;
      const anim=fly.animate([
        {transform:'translate(-50%,-50%) scale(1.2)',opacity:0.1,offset:0},
        {transform:'translate(-50%,-75%) scale(1.65)',opacity:1,offset:0.25},
        {transform:'translate(calc(-50% + '+(dx*.55)+'px),calc(-75% + '+(dy*.55)+'px)) scale(1)',opacity:1,offset:0.62},
        {transform:'translate(calc(-50% + '+dx+'px),calc(-50% + '+dy+'px)) scale(.32)',opacity:.25,offset:1},
      ],{duration:620,easing:'cubic-bezier(.18,.7,.3,1)',fill:'forwards'});
      anim.onfinish=()=>fly.remove();
      anim.oncancel=()=>fly.remove();
    }
    const slot=this.root.querySelector('.sk3d-item-slot');
    slot?.classList.remove('zario-item-arrived');
    void slot?.offsetWidth;
    slot?.classList.add('zario-item-arrived');
    setTimeout(()=>slot?.classList.remove('zario-item-arrived'),700);
  }

  buildSpeedometer() {
    const wrap = document.createElement('div');
    wrap.className = 'sk3d-speedo';
    wrap.innerHTML = `
      <div class="sk3d-speedo-dial"></div>
      <div class="sk3d-speedo-readout">
        <span class="sk3d-speedo-value">0</span>
        <span class="sk3d-speedo-unit">km/h</span>
      </div>`;

    const dial = wrap.querySelector('.sk3d-speedo-dial');
    // AUDIT (visual auditor 2026-08-12): MK8 speedo is a FULL circular dial
    // with a 270° arc — the old 180° semicircle in a square card read as a
    // generic panel. Center (80,80), radius 62, arc from -135° to +135°.
    const svg = svgEl('svg', {
      viewBox: '0 0 160 160',
      class: 'sk3d-speedo-svg',
      'aria-hidden': 'true',
    });

    const gradient = svgEl('linearGradient', { id: 'sk3d-speedo-grad', x1: '0', y1: '0', x2: '1', y2: '0' });
    gradient.append(
      svgEl('stop', { offset: '0%', style: 'stop-color: var(--sk3d-green)' }),
      svgEl('stop', { offset: '55%', style: 'stop-color: var(--sk3d-yellow)' }),
      svgEl('stop', { offset: '100%', style: 'stop-color: var(--sk3d-red)' })
    );
    // Subtle vertical gradient for the base (empty) arc — darker toward the
    // needle pivot so the dial reads as recessed.
    const bgGradient = svgEl('linearGradient', { id: 'sk3d-speedo-bg-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
    bgGradient.append(
      svgEl('stop', { offset: '0%', style: 'stop-color: rgba(27, 42, 65, 0.14)' }),
      svgEl('stop', { offset: '100%', style: 'stop-color: rgba(27, 42, 65, 0.32)' })
    );
    // Soft warm glow behind the filled arc.
    const glowFilter = svgEl('filter', { id: 'sk3d-speedo-glow', x: '-40%', y: '-40%', width: '180%', height: '180%' });
    glowFilter.append(
      svgEl('feDropShadow', {
        dx: '0',
        dy: '3',
        stdDeviation: '4',
        'flood-color': '#ffd166',
        'flood-opacity': '0.55',
      })
    );
    const defs = svgEl('defs', {});
    defs.append(gradient, bgGradient, glowFilter);
    svg.append(defs);

    const arcPath = 'M 36.1 36.1 A 62 62 0 1 1 36.1 123.9'; // 270° from -135° to +135°
    const track = svgEl('path', { d: arcPath, fill: 'none', 'stroke-linecap': 'round' });
    track.setAttribute('stroke', 'url(#sk3d-speedo-bg-grad)');
    track.setAttribute('stroke-width', '12');
    svg.append(track);

    const arc = svgEl('path', { d: arcPath, fill: 'none', 'stroke-linecap': 'round', class: 'sk3d-speedo-arc' });
    arc.setAttribute('stroke', 'url(#sk3d-speedo-grad)');
    arc.setAttribute('stroke-width', '12');
    arc.setAttribute('filter', 'url(#sk3d-speedo-glow)');
    arc.style.strokeDasharray = String(ARC_LENGTH);
    arc.style.strokeDashoffset = String(ARC_LENGTH);
    svg.append(arc);

    // Tick marks every 5 km/h, major every 20 — 270° sweep centered on the
    // dial (start angle -135°, end +135°; the needle pivot is (80,80)).
    const TICK_SWEEP = 1.5 * Math.PI; // 270°
    const TICK_START = -0.75 * Math.PI; // -135°
    for (let kmh = 0; kmh <= MAX_KMH; kmh += 5) {
      const major = kmh % 20 === 0;
      const a = TICK_START + (kmh / MAX_KMH) * TICK_SWEEP;
      const r1 = 54;
      const r2 = major ? 44 : 48;
      const tick = svgEl('line', {
        x1: 80 + r1 * Math.sin(a),
        y1: 80 - r1 * Math.cos(a),
        x2: 80 + r2 * Math.sin(a),
        y2: 80 - r2 * Math.cos(a),
        'stroke-linecap': 'round',
      });
      tick.style.stroke = 'var(--sk3d-ink)';
      tick.style.strokeWidth = major ? '3' : '2';
      svg.append(tick);
    }

    dial.append(svg);

    // AUDIT R2 (blind critic 2026-08-13: 'no scale ticks, dial reads as
    // generic ring') — major + minor ticks along the 270° arc (MK8 gauge).
    const TICK_MAJOR = 9;   // every 30°
    const TICK_MINOR = 27;  // every 10°
    const tickGroup = svgEl('g', { class: 'sk3d-speedo-ticks' });
    for (let i = 0; i <= TICK_MAJOR; i++) {
      const angleDeg = -135 + (i / TICK_MAJOR) * 270;
      const a = (angleDeg * Math.PI) / 180;
      const major = i % 3 === 0; // 0,90,180,270 marks longer
      const r0 = major ? 50 : 54;
      const r1 = 60;
      const x0 = 80 + r0 * Math.cos(a);
      const y0 = 80 + r0 * Math.sin(a);
      const x1 = 80 + r1 * Math.cos(a);
      const y1 = 80 + r1 * Math.sin(a);
      const tick = svgEl('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'sk3d-speedo-tick' });
      if (major) tick.setAttribute('stroke-width', '3');
      tickGroup.append(tick);
    }
    svg.append(tickGroup);

    const needle = document.createElement('div');
    needle.className = 'sk3d-speedo-needle';
    const hub = document.createElement('div');
    hub.className = 'sk3d-speedo-hub';
    dial.append(needle, hub);
    // Center the value readout INSIDE the dial (MK8 read): reposition via CSS
    // (readout becomes absolutely-centered overlay in the circular dial).

    return { wrap, needle, arc };
  }

  buildItemSlot() {
    // Stacked pair: the main ITEM slot + a mini RESERVE slot underneath
    // (audit r3 dual-slot). Clicking the mini slot swaps the two — the touch
    // counterpart to the Tab swap key. Count badges show triple stacks (×3).
    // All styling lives in ui.css (.sk3d-item-wrap / .sk3d-item-badge) so the
    // slot family shares the HUD card language (translucent dark + light
    // stroke + rounded).
    const wrap = document.createElement('div');
    wrap.className = 'sk3d-item-wrap';

    const slot = document.createElement('div');
    slot.className = 'sk3d-chip sk3d-item-slot';
    slot.innerHTML = `
      <span class="sk3d-item-label">ITEM</span>
      <span class="sk3d-item-icon sk3d-item-empty">?</span>
      <span class="sk3d-item-name"></span>
      <span class="sk3d-item-count sk3d-item-badge sk3d-hidden">×1</span>`;

    const mini = document.createElement('div');
    mini.className = 'sk3d-chip sk3d-item-slot sk3d-item2-slot';
    mini.setAttribute('title', 'Reserve item — click (or Tab) to swap');
    mini.innerHTML = `<span class="sk3d-item2-icon sk3d-item-empty">?</span>
      <span class="sk3d-item2-count sk3d-item-badge sk3d-item-badge-mini sk3d-hidden">×1</span>`;

    wrap.append(slot, mini);
    return wrap;
  }

  /**
   * Build the circular track minimap (SVG). Samples the track path once into a
   * closed polyline, then scales it to fit inside a 120px circle.
   * @param {object|null} track descriptor with a THREE.Curve `path`
   * @returns {object|null} { wrap, dotsGroup } or null when no usable path
   */
  buildMinimap(track) {
    const path = track && track.path;
    if (!path || typeof path.getPointAt !== 'function') return null;

    // Flatten the closed loop into N sample points (getPointAt(1) ≈ getPointAt(0)).
    const samples = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < MINIMAP_SAMPLES; i++) {
      const p = path.getPointAt(i / MINIMAP_SAMPLES);
      const x = p.x;
      const z = p.z;
      samples.push([x, z]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    if (!(spanX > 0) || !(spanZ > 0)) return null;

    // Uniform scale (preserves track shape), centered inside the circle.
    const avail = MINIMAP_SIZE - MINIMAP_PAD * 2;
    const scale = avail / Math.max(spanX, spanZ);
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;
    const offX = MINIMAP_SIZE / 2 - midX * scale;
    const offZ = MINIMAP_SIZE / 2 - midZ * scale;

    const pts = samples
      .map(([x, z]) => `${(offX + x * scale).toFixed(1)},${(offZ + z * scale).toFixed(1)}`)
      .join(' ');
    const polyline = `M ${pts} Z`;

    const wrap = document.createElement('div');
    wrap.className = 'sk3d-chip sk3d-minimap';
    wrap.title = 'Track map';

    const svg = svgEl('svg', {
      viewBox: `0 0 ${MINIMAP_SIZE} ${MINIMAP_SIZE}`,
      class: 'sk3d-minimap-svg',
      'aria-hidden': 'true',
    });

    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', { id: 'sk3d-minimap-track-grad', x1: '0', y1: '0', x2: '1', y2: '1' });
    grad.append(
      svgEl('stop', { offset: '0%', style: 'stop-color: rgba(255, 255, 255, 0.95)' }),
      svgEl('stop', { offset: '100%', style: 'stop-color: rgba(255, 209, 102, 0.95)' })
    );
    defs.append(grad);
    svg.append(defs);

    const c = MINIMAP_SIZE / 2;
    svg.append(
      svgEl('circle', { cx: c, cy: c, r: c - 1, class: 'sk3d-minimap-bg' }),
      svgEl('circle', { cx: c, cy: c, r: c - 3, class: 'sk3d-minimap-ring' })
    );
    // Glow underlay makes the route readable at a glance (art-bible: minimap
    // must communicate position, not just look decorative).
    const glowPath = svgEl('path', { d: polyline, class: 'sk3d-minimap-track-glow' });
    const trackPath = svgEl('path', { d: polyline, class: 'sk3d-minimap-track' });
    trackPath.setAttribute('stroke', 'url(#sk3d-minimap-track-grad)');
    const dotsGroup = svgEl('g', { class: 'sk3d-minimap-dots' });
    // AUDIT imersão (R11): view local MK8D — um <g> em volta de traçado+dots
    // permite zoom centrado no jogador (mobile); desktop segue zoom 1 (global).
    const view = svgEl('g', { class: 'sk3d-minimap-view' });
    view.append(glowPath, trackPath, dotsGroup);
    svg.append(view);
    wrap.append(svg);

    const mobile =
      (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
      window.innerWidth <= 768;
    return {
      wrap, dotsGroup, view,
      zoom: 1, // always fit the complete track, no broken mobile pan
      scale, offX, offZ,
      // Limites projetados da pista (unidades do viewBox) — clamp do pan.
      pMinX: offX + minX * scale, pMaxX: offX + maxX * scale,
      pMinY: offZ + minZ * scale, pMaxY: offZ + maxZ * scale,
      dots: new Map(), itemDots: new Map(), kartsRef: null,
    };
  }

  /** Create the minimap dot for one ACTIVE ITEM (banana/shell) — AUDIT
   *  (Feco, 2026-08-11): 'a banana não dá pra ver no mapa' — the minimap
   *  only drew karts, so dropped hazards were invisible on it. */
  _addMinimapItemDot(item) {
    const mm = this._mm;
    if (!mm) return null;
    const cls = item.constructor && item.constructor.name;
    let color = '#ffd23f'; // banana
    if (cls === 'ShellProjectile') {
      color = item.blue ? '#4aa8ff' : item.homing ? '#ff5252' : '#43d64b';
    }
    const dot = svgEl('circle', {
      cx: MINIMAP_SIZE / 2,
      cy: MINIMAP_SIZE / 2,
      r: '3.4',
      class: 'sk3d-minimap-dot-item',
    });
    dot.style.fill = color;
    mm.dotsGroup.append(dot);
    return dot;
  }

  /** Create the minimap dot for one kart (called once per kart identity). */
  _addMinimapDot(kart) {
    const mm = this._mm;
    const isPlayer = !!kart.isPlayer;
    const dot = svgEl('circle', {
      cx: MINIMAP_SIZE / 2,
      cy: MINIMAP_SIZE / 2,
      r: String(isPlayer ? DOT_R_PLAYER : DOT_R), // AUDIT R11: jogador maior no minimap mobile
      class: isPlayer ? 'sk3d-minimap-dot-player' : 'sk3d-minimap-dot-ai',
    });
    if (!isPlayer) {
      dot.style.fill = kartDotColor(kart);
    }
    mm.dotsGroup.append(dot);
    mm.dots.set(kart, dot);
    // Player gets a direction cone (points along state.heading) so the map
    // reads "where am I going", not just "where am I".
    if (isPlayer) {
      const cone = svgEl('path', { d: 'M 0 -11 L 8 6 L 0 0 L -8 6 Z', class: 'sk3d-minimap-cone' });
      mm.dotsGroup.append(cone);
      mm.playerCone = cone;
    }
    return dot;
  }

  /**
   * Project every kart's world XZ onto the minimap. Dots are created once per
   * kart identity (cached); only cx/cy/r attributes are touched per frame.
   * @param {object[]} [karts] raceManager.karts (player first, then AI)
   */
  _updateMinimap(raceManager, karts) {
    const mm = this._mm;
    if (!mm || !karts || karts.length === 0) return;

    // AUDIT imersão (R11): view local no mobile — pan/zoom 2.1× centrado no
    // jogador (MK8D touch minimap); clamp nos limites da pista. Desktop zoom 1.
    if (mm.view && mm.zoom > 1) {
      const pk = karts.find((k) => k.isPlayer);
      const zp = pk && pk.state && pk.state.position;
      if (zp) {
        const cxc = mm.offX + zp.x * mm.scale;
        const cyc = mm.offZ + zp.z * mm.scale;
        const half = MINIMAP_SIZE / 2;
        const tx = Math.min(0, Math.max(half - mm.pMaxX, half - cxc * mm.zoom));
        const ty = Math.min(0, Math.max(half - mm.pMaxY, half - cyc * mm.zoom));
        const t = `translate(${tx.toFixed(1)},${ty.toFixed(1)}) scale(${mm.zoom})`;
        if (mm.view.getAttribute('transform') !== t) mm.view.setAttribute('transform', t);
      }
    }

    // Rebuild the dot cache when the karts array is swapped (race restart).
    if (karts !== mm.kartsRef) {
      mm.kartsRef = karts;
      mm.dots.clear();
      mm.dotsGroup.replaceChildren();
      for (const kart of karts) this._addMinimapDot(kart);
    }

    for (const kart of karts) {
      const dot = mm.dots.get(kart);
      const p = kart && kart.state && kart.state.position;
      if (!dot || !p) continue;
      const cx = mm.offX + p.x * mm.scale;
      const cy = mm.offZ + p.z * mm.scale;
      if (dot.getAttribute('cx') !== String(cx)) dot.setAttribute('cx', String(cx));
      if (dot.getAttribute('cy') !== String(cy)) dot.setAttribute('cy', String(cy));
      // Race leader dot is slightly larger.
      const r = kart.isPlayer ? DOT_R_PLAYER : (kart.position === 1 ? DOT_R_LEADER : DOT_R); // AUDIT R11: jogador sempre maior
      if (dot.getAttribute('r') !== String(r)) dot.setAttribute('r', String(r));
      // Player direction cone: rotate to state.heading (world Z maps to SVG Y).
      if (kart.isPlayer && mm.playerCone) {
        const hDeg = ((kart.state.heading || 0) * 180) / Math.PI;
        const deg = 180 - hDeg;
        mm.playerCone.setAttribute('transform', `translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${deg.toFixed(1)})`);
      }
    }

    // Active items (dropped bananas, flying shells) — AUDIT (Feco): hazards
    // are now readable on the minimap. StarEffect has no mesh, so it's skipped
    // by the mesh check; dead/removed items get their dot cleaned up.
    const items = raceManager && Array.isArray(raceManager.activeItems) ? raceManager.activeItems : null;
    if (items) {
      for (const [it, dot] of mm.itemDots) {
        if (!it || it.dead || !items.includes(it)) {
          dot.remove();
          mm.itemDots.delete(it);
        }
      }
      for (const it of items) {
        if (!it || it.dead || !it.mesh || !it.mesh.position) continue;
        let dot = mm.itemDots.get(it);
        if (!dot) {
          dot = this._addMinimapItemDot(it);
          if (!dot) continue;
          mm.itemDots.set(it, dot);
        }
        const ip = it.mesh.position;
        dot.setAttribute('cx', String(mm.offX + ip.x * mm.scale));
        dot.setAttribute('cy', String(mm.offZ + ip.z * mm.scale));
      }
    }
  }

  show() {
    this.root.classList.remove('sk3d-hidden');
  }

  /** AUDIT imersão (R11): auto-hide MK8D — esmaece o HUD quando o jogador
   *  está focado na pista; qualquer toque/tecla restaura (main.js cronometra). */
  setIdle(idle) {
    const on = !!idle;
    if (on === this._idle) return;
    this._idle = on;
    this.root.classList.toggle('sk3d-hud-idle', on);
  }

  hide() {
    this.root.classList.add('sk3d-hidden');
  }

  _updateRouteCue(player) {
    if (!this.routeCueEl || !this._trackPath || !player) return;
    const s=player.state;
    const stopped=!!player.finished || (this.finishEl && !this.finishEl.classList.contains('sk3d-hidden'));
    const info=stopped || s?.offRoad ? null : computeUpcomingTurn(
      this._trackPath, s?.progress01, this._trackLength, s?.heading, Math.abs(s?.speed||0)
    );
    this.routeCueEl.classList.toggle('sk3d-hidden', !info);
    if (!info) return;
    this.routeCueArrowEl.textContent=info.direction==='LEFT'?'↶':'↷';
    this.routeCueLabelEl.textContent=`${info.direction} · ${info.distance}m`;
    this.routeCueEl.setAttribute('aria-label', `Upcoming ${info.direction.toLowerCase()} turn in about ${info.distance} metres`);
  }

  /**
   * Per-frame update. Reads rank/lap/time/speed/item from the race state.
   * @param {object} raceManager RaceManager instance (elapsed, player, ...)
   * @param {object} player      player Kart (position, lap, state, heldItem)
   * @param {object[]} [karts]   raceManager.karts — used to render minimap dots
   */
  update(raceManager, player, karts) {
    if (this.root.classList.contains('sk3d-hidden')) return;

    // MK8D rank plate (bottom-left): big bold ordinal on a gold/silver/
    // bronze/white plate; pops (sk3d-position-pop) + blips on change.
    const pos = player && typeof player.position === 'number' ? player.position : 0;
    if (pos !== this._pos) {
      const prev = this._pos; // capture BEFORE the write (audit v4 F1: the
      // old code wrote _pos then compared — dead pop + always-'down' SFX)
      this._pos = pos;
      const medal = MEDALS[pos] ? `${MEDALS[pos]} ` : '';
      const text = medal + ordinal(pos);
      const cls = pos === 1 ? ' sk3d-position-1' : pos === 2 ? ' sk3d-position-2' : pos === 3 ? ' sk3d-position-3' : '';
      this.positionEl.className = `sk3d-chip sk3d-position${cls}`;
      this.positionValueEl.textContent = text;
      this.positionEl.setAttribute('aria-label', `Your position: ${text}`);
      // Position change feedback (audit UX-v3 F2): pop the chip + SFX.
      this.positionEl.classList.remove('sk3d-position-pop');
      void this.positionEl.offsetWidth;
      this.positionEl.classList.add('sk3d-position-pop');
      if (typeof prev === 'number' && pos !== prev) {
        this._onPositionChange?.(pos < prev ? 'up' : 'down');
      }
    }

    // Lap counter + per-lap progress bar (progress01 from player.state).
    const completedLaps = player && typeof player.lap === 'number' ? player.lap : 0;
    const lap = Math.min(CONFIG.game.totalLaps, Math.max(1, completedLaps + 1));
    const lapText = `LAP ${lap}/${CONFIG.game.totalLaps}`;
    if (lapText !== this._lapText) {
      this._lapText = lapText;
      this.lapTextEl.textContent = lapText;
    }
    const prog = player && player.state && typeof player.state.progress01 === 'number' ? player.state.progress01 : 0;
    const pct = `${(Math.max(0, Math.min(1, prog)) * 100).toFixed(1)}%`;
    if (pct !== this._lapPct) {
      this._lapPct = pct;
      this.lapBarFillEl.style.width = pct;
    }

    // Race time (freeze on the player's final time once finished).
    const finished = player && player.finished;
    const elapsed =
      finished && typeof player.totalTime === 'number'
        ? player.totalTime
        : raceManager && typeof raceManager.elapsed === 'number'
          ? raceManager.elapsed
          : 0;
    const timeText = formatTime(elapsed);
    if (timeText !== this._timeText) {
      this._timeText = timeText;
      this.timeEl.textContent = timeText;
    }

    // Speedometer.
    const speed = player && player.state ? player.state.speed : 0;
    this.setSpeed(speed);

    // Slipstream indicator (audit v3: drafting had no feedback).
    const drafting = !!(player && player.state && player.state.draft);
    if (drafting !== this._drafting) {
      this._drafting = drafting;
      this.draftEl.classList.toggle('sk3d-hidden', !drafting);
    }

    // Held item slots (audit r3 dual-slot: primary + reserve + coin counter).
    const item = player ? player.heldItem : null;
    // AUDIT R11: consumir item no slot principal treme o mini-slot (o uso
    // não tinha feedback — pickup tem roulette+toast, uso nada).
    if (this.itemType && !item && !this._itemUseShakeT) {
      const icon = this.root.querySelector('.sk3d-item-slot');
      if (icon) {
        icon.classList.remove('sk3d-item-use');
        void icon.offsetWidth;
        icon.classList.add('sk3d-item-use');
      }
      this._itemUseShakeT = setTimeout(() => {
        const ic = this.root.querySelector('.sk3d-item-slot');
        if (ic) ic.classList.remove('sk3d-item-use');
        this._itemUseShakeT = null;
      }, 500);
    }
    this.setItem(item, player ? player._heldItemCount || 1 : 1);
    const item2 = player ? player.heldItem2 : null;
    this.setItem2(item2, player ? player._heldItem2Count || 1 : 1);
    // AUDIT r8: MK8D coin loss on a hit — a shell/banana scatters up to 3
    // coins, so a drop here is a hit cue: red-flash the chip + show −N.
    const coins = player ? player._coins || 0 : 0;
    if (coins < this._coins) this.flashCoinLoss(this._coins - coins);
    this.setCoins(coins);

    // Route anticipation cue: only appears for a meaningful bend ahead.
    this._updateRouteCue(player);
    // Minimap dots (karts + active items).
    this._updateMinimap(raceManager, karts);
  }

  /** @param {number} speed kart speed in m/s (may be negative while reversing). */
  setSpeed(speed) {
    const kmh = Math.max(0, Math.min(speed * 2.4, this._maxKmh));
    const rounded = Math.round(kmh);
    if (this.speedValueEl.textContent !== String(rounded)) {
      this.speedValueEl.textContent = String(rounded);
    }
    const angle = -135 + (kmh / this._maxKmh) * 270; // 270° MK8 dial sweep
    this.speedNeedle.style.transform = `rotate(${angle}deg)`;
    this.speedArc.style.strokeDashoffset = String(ARC_LENGTH * (1 - kmh / this._maxKmh));
    // AUDIT r9: wind streaks ramp in above 80% of the gauge (MK8D velocity cue).
    this._drawSpeedlines(kmh / this._maxKmh);
  }

  /** Radial speed lines on a full-screen overlay — opacity ∝ speed01 (0.8+). */
  _drawSpeedlines(speed01) {
    const ctx = this.speedlineCtx;
    if (!ctx) return;
    // AUDIT r10: resize the canvas if the window changed since construction
    // (cheap guard — the HUD rebuilds per race anyway).
    const iw = window.innerWidth;
    const ih = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const needW = Math.round(iw * dpr);
    const needH = Math.round(ih * dpr);
    if (this.speedlineCanvas.width !== needW || this.speedlineCanvas.height !== needH) {
      this.speedlineCanvas.width = needW;
      this.speedlineCanvas.height = needH;
      this.speedlineCanvas.style.width = iw + 'px';
      this.speedlineCanvas.style.height = ih + 'px';
      this.speedlineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const a = speed01 > 0.8 ? Math.min(0.5, (speed01 - 0.8) * 2.2) : 0;
    const w = iw;
    const h = ih;
    ctx.clearRect(0, 0, w, h);
    if (a <= 0.01) return;
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    // ~14 radial streaks near the frame edges, flickering slightly per call
    // (deterministic-ish: seeded by time bucket so it shimmers without noise).
    const t = Math.floor(performance.now() / 90);
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + t * 0.02;
      const r0 = Math.min(w, h) * (0.42 + ((i * 37 + t) % 7) * 0.012);
      const r1 = r0 + 30 + ((i * 53 + t * 3) % 40);
      const cx = w / 2 + Math.cos(ang) * (w * 0.05);
      const cy = h / 2 + Math.sin(ang) * (h * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Rescale the gauge for the engine class (50/100/150cc). */
  setMaxKmh(kmh) {
    this._maxKmh = Math.max(40, Math.round(kmh));
  }

  /** AUDIT (itens/HUD/FX 2026-08-16): boost reactivity — o dial MK8D brilha
   *  dourado + o valor km/h pisca enquanto um boost está ativo (mushroom,
   *  turbo pad, star). Só alterna classe; a animação vive no ui.css. */
  setBoost(active) {
    if (active === this._boost) return;
    this._boost = !!active;
    const dial = this.root.querySelector('.sk3d-speedo-dial');
    if (dial) dial.classList.toggle('sk3d-speedo-boost', !!active);
    // AUDIT imersão R11: speedo ghost acende no boost
    const speedo = this.root.querySelector('.sk3d-speedo');
    if (speedo) speedo.classList.toggle('sk3d-speedo-active', !!active);
  }

  /** Lap-split chip: current + best lap, flashes on a new best (audit r4). */
  setLapSplit(lapMs, bestLapMs, isBest) {
    let chip = this.root.querySelector('.sk3d-lapsplit');
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'sk3d-lapsplit';
      const timeEl = this.root.querySelector('.sk3d-time');
      if (timeEl && timeEl.parentNode) timeEl.parentNode.insertBefore(chip, timeEl.nextSibling);
      else this.root.appendChild(chip);
    }
    const fmt = (ms) => {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      return `${m}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 100))}`;
    };
    chip.textContent = `LAP ${fmt(lapMs)} · BEST ${fmt(bestLapMs)}`;
    chip.classList.toggle('sk3d-lapsplit-best', !!isBest);
    clearTimeout(this._lapFlashT);
    this._lapFlashT = setTimeout(() => chip.classList.remove('sk3d-lapsplit-best'), 2600);
  }

  /** @param {string|null} itemType PowerUpType key, or null/undefined for empty.
   *  @param {number} [count=1] stack size — >1 shows a ×N triple badge. */
  setItem(itemType, count = 1) {
    const n = Math.max(1, Math.round(count || 1));
    if (itemType === this.itemType && n === this._itemCount) return;
    this.itemType = itemType || null;
    this._itemCount = n;

    const icon = this.itemIconEl;
    const nameEl = this.root.querySelector('.sk3d-item-name');
    if (this.itemType && ITEM_ICONS[this.itemType]) {
      icon.textContent = ITEM_ICONS[this.itemType];
      icon.classList.toggle('sk3d-item-red', this.itemType === 'red_shell');
      icon.classList.remove('sk3d-item-empty');
      if (nameEl) nameEl.textContent = ITEM_NAMES[this.itemType] || this.itemType;
    } else {
      this.cancelRoulette(); // v4 F3: using the item mid-spin must kill the spin
      icon.textContent = '?';
      icon.classList.remove('sk3d-item-red');
      icon.classList.add('sk3d-item-empty');
      if (nameEl) nameEl.textContent = '';
    }
    if (this.itemCountEl) {
      this.itemCountEl.textContent = `×${n}`;
      this.itemCountEl.classList.toggle('sk3d-hidden', !(this.itemType && n > 1));
    }
    // Pop whenever the icon changes.
    icon.classList.remove('sk3d-item-pop');
    void icon.offsetWidth;
    icon.classList.add('sk3d-item-pop');
  }

  /** Reserve slot (mini slot under the main one). Mirrors setItem but is
   *  quiet (no roulette, no name) — the main slot owns the feedback. */
  setItem2(itemType, count = 1) {
    const n = Math.max(1, Math.round(count || 1));
    if (itemType === this._item2Type && n === this._item2Count) return;
    this._item2Type = itemType || null;
    this._item2Count = n;
    const icon = this.item2IconEl;
    if (!icon) return;
    if (this._item2Type && ITEM_ICONS[this._item2Type]) {
      icon.textContent = ITEM_ICONS[this._item2Type];
      icon.classList.toggle('sk3d-item-red', this._item2Type === 'red_shell');
      icon.classList.remove('sk3d-item-empty');
    } else {
      icon.textContent = '?';
      icon.classList.remove('sk3d-item-red');
      icon.classList.add('sk3d-item-empty');
    }
    if (this.item2CountEl) {
      this.item2CountEl.textContent = `×${n}`;
      this.item2CountEl.classList.toggle('sk3d-hidden', !(this._item2Type && n > 1));
    }
    // AUDIT: o slot reserva também ganha o pop (era mudo — só o principal popava).
    icon.classList.remove('sk3d-item-pop');
    void icon.offsetWidth;
    icon.classList.add('sk3d-item-pop');
  }

  /** Coin counter chip (🪙 n/max). Pops on change. */
  setCoins(n) {
    const v = Math.max(0, Math.round(n || 0));
    if (v === this._coins) return;
    const gained = v > this._coins;
    this._coins = v;
    if (this.coinCountEl) this.coinCountEl.textContent = String(v);
    const chip = this.coinCountEl && this.coinCountEl.closest('.sk3d-coins');
    if (chip) {
      chip.classList.remove('sk3d-position-pop'); // reuse the pop animation
      void chip.offsetWidth;
      chip.classList.add('sk3d-position-pop');
    }
    // AUDIT R11: floater '+N' que sobe e some — o GANHO de moeda é o evento de
    // maior frequência do jogo e merecia feedback próprio (MK8D faz o mesmo).
    if (gained && this.coinCountEl) {
      const n = v - this._coinsPrev;
      this._coinsPrev = v;
      let f = this._coinGainEl;
      if (!f) {
        f = document.createElement('span');
        f.className = 'sk3d-coin-gain';
        chip && chip.appendChild(f);
        this._coinGainEl = f;
      }
      f.textContent = `+${Math.max(1, n)}`;
      f.classList.remove('sk3d-coin-gain-anim');
      void f.offsetWidth;
      f.classList.add('sk3d-coin-gain-anim');
      clearTimeout(this._coinGainT);
      this._coinGainT = setTimeout(() => f.classList.remove('sk3d-coin-gain-anim'), 900);
    } else {
      this._coinsPrev = v;
    }
  }

  /** AUDIT r8: coin-loss feedback — red flash + a transient −N badge on the
   *  coin chip when a hit costs coins (MK8D drops up to 3 per shell/banana
   *  hit). Inline styles only, so no CSS file changes; clears itself. */
  flashCoinLoss(lost) {
    const chip = this.coinCountEl && this.coinCountEl.closest('.sk3d-coins');
    if (chip) {
      chip.style.color = '#ff6b6b';
      chip.style.borderColor = '#ff6b6b';
      chip.style.boxShadow = '0 0 14px rgba(255, 90, 90, 0.55)';
      if (!this._coinLostEl) {
        this._coinLostEl = document.createElement('span');
        this._coinLostEl.style.cssText = 'margin-left:6px;font-weight:800;color:#ff6b6b;';
        chip.appendChild(this._coinLostEl);
      }
      this._coinLostEl.textContent = `−${Math.max(1, Math.round(lost || 1))}`;
    }
    clearTimeout(this._coinLossT);
    this._coinLossT = setTimeout(() => this._clearCoinLoss(), 1000);
  }

  _clearCoinLoss() {
    const chip = this.coinCountEl && this.coinCountEl.closest('.sk3d-coins');
    if (chip) {
      chip.style.color = '';
      chip.style.borderColor = '';
      chip.style.boxShadow = '';
    }
    if (this._coinLostEl) this._coinLostEl.textContent = '';
  }

  /**
   * MK8-style item roulette: cycles random item icons ~0.7s, then reveals the
   * real item (audit minor — pickups were instant-assign).
   * @param {string|null} itemType final PowerUpType key
   */
  setItemRoulette(itemType, count = 1) {
    const icons = Object.values(ITEM_ICONS).filter((s) => s && s !== '?');
    let tick = 0;
    if (this._rouletteTimer) clearInterval(this._rouletteTimer);
    const gen = (this._rouletteGen = (this._rouletteGen || 0) + 1); // v4 F3: stale spins must not reveal a phantom item
    this._rouletteTimer = setInterval(() => {
      if (gen !== this._rouletteGen) { clearInterval(this._rouletteTimer); this._rouletteTimer = null; return; }
      tick++;
      if (tick > 9) {
        clearInterval(this._rouletteTimer);
        this._rouletteTimer = null;
        this.setItem(itemType, count); // reveal the real item (with pop)
        return;
      }
      this.itemIconEl.textContent = icons[Math.floor(Math.random() * icons.length)];
      this.itemIconEl.classList.remove('sk3d-item-red', 'sk3d-item-empty');
    }, 80);
  }

  /** Cancel a running item roulette (called on setItem(null) and reset —
   *  audit v4 F3: using the item mid-spin leaked a phantom reveal). */
  cancelRoulette() {
    this._rouletteGen = (this._rouletteGen || 0) + 1;
    if (this._rouletteTimer) {
      clearInterval(this._rouletteTimer);
      this._rouletteTimer = null;
    }
  }

  /**
   * Big fullscreen countdown number.
   * @param {number|string} n 3|2|1 or 'GO'
   */
  countdown(n) {
    if (n === null || n === undefined) {
      // clear signal — just hide, never render "null"
      this.countdownEl.classList.add('sk3d-hidden');
      return;
    }
    const go = n === 'GO';
    this.countdownEl.textContent = go ? 'GO!' : String(n);
    this.countdownEl.classList.toggle('sk3d-countdown-go', go);
    this.countdownEl.classList.remove('sk3d-hidden');

    this.countdownEl.classList.remove('sk3d-pop');
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add('sk3d-pop');

    clearTimeout(this.countdownTimer);
    this.countdownTimer = setTimeout(() => {
      this.countdownEl.classList.add('sk3d-hidden');
    }, go ? COUNTDOWN_GO_MS : COUNTDOWN_NUMBER_MS);
  }

  _renderFinishStandings(standings) {
    const listEl = this.root.querySelector('.sk3d-finish-results');
    if (!listEl) return;
    listEl.innerHTML = '';
    for (const row of standings || []) {
      const line = document.createElement('div');
      const name = row.kart?.character?.name || 'Racer';
      const isPlayer = !!row.kart?.isPlayer;
      line.className = `sk3d-finish-row${isPlayer ? ' sk3d-finish-row-player' : ''}`;
      if (isPlayer) line.setAttribute('aria-current', 'true');
      line.innerHTML = `<span class="sk3d-finish-row-pos">${ordinal(row.position)}</span>` +
        `<span class="sk3d-finish-row-name">${name}${isPlayer ? ' (You)' : ''}</span>` +
        `<span class="sk3d-finish-row-time">${Number.isFinite(row.totalTime) ? formatTime(row.totalTime) : '—'}</span>`;
      listEl.append(line);
    }
  }

  /** Refresh rows after every kart has crossed the line. */
  updateFinishStandings(standings) {
    this._renderFinishStandings(standings);
  }

  /** @param {number} place race rank (1-6) @param {number} time total time in seconds
   *  @param {Array} [standings] final order [{ position, kart, totalTime }] — AUDIT r21 */
  showFinish(place, time, standings, trackName = '') {
    this.finishPlaceEl.textContent = ordinal(place);
    if (this.finishTrackEl) this.finishTrackEl.textContent = trackName;
    this.finishTimeEl.textContent = formatTime(time);
    const rows = (standings && standings.length ? standings : [{ position: place, kart: null, totalTime: time }]);
    this._renderFinishStandings(rows);
    this.finishEl.classList.remove('sk3d-hidden');
    this.routeCueEl?.classList.add('sk3d-hidden');
    this.root.classList.add('sk3d-finish-active');
    this.finishBtnEl?.focus({ preventScroll: true });
    clearTimeout(this.toastTimer);
    this.toastEl.classList.add('sk3d-hidden');

    // Re-trigger the pop animation on the NEXT frame — remove+void+add in the
    // same tick silently fails on slow/headless frames and the `both` fill
    // mode leaves the card at scale(0)/opacity 0 (invisible, unclickable).
    this.finishCardEl.classList.remove('sk3d-pop');
    if (this._finishPopRaf) cancelAnimationFrame(this._finishPopRaf);
    this._finishPopRaf = requestAnimationFrame(() => {
      this.finishCardEl.classList.add('sk3d-pop');
      this._finishPopRaf = 0;
    });
    // Safety: if the animation still can't run (any environment), the card
    // must remain visible + clickable — force it after the animation window.
    if (this._finishPopTimer) clearTimeout(this._finishPopTimer);
    this._finishPopTimer = setTimeout(() => {
      // Cancel the pending rAF BEFORE forcing the card visible — on a slow
      // frame (<1fps SwiftShader) the rAF could land AFTER this timer and
      // re-add sk3d-pop → the card freezes at scale(0) again (user bug: the
      // Race Again button disappeared on slow machines).
      if (this._finishPopRaf) cancelAnimationFrame(this._finishPopRaf);
      this._finishPopRaf = 0;
      this.finishCardEl.classList.remove('sk3d-pop');
      this.finishCardEl.style.transform = 'none';
      this.finishCardEl.style.opacity = '1';
    }, 650);
  }

  /** Red screen flash when the player is hit (user feedback: hits were
   *  unreadable). Re-triggers via animation restart. */
  showHitFlash(kind = 'red') {
    if (!this.hitFlashEl) return;
    this.hitFlashEl.classList.remove('sk3d-hidden');
    this.hitFlashEl.classList.remove('sk3d-hitflash-on');
    if (kind === 'electric') this.hitFlashEl.classList.add('sk3d-hitflash-electric');
    else this.hitFlashEl.classList.remove('sk3d-hitflash-electric');
    void this.hitFlashEl.offsetWidth;
    this.hitFlashEl.classList.add('sk3d-hitflash-on');
    clearTimeout(this._hitFlashTimer);
    this._hitFlashTimer = setTimeout(() => this.hitFlashEl.classList.add('sk3d-hidden'), 500);
  }

  /** Transient centered toast message (auto-hides).
   *  @param {string} text
   *  @param {number} [duration=TOAST_MS] how long it stays visible (ms) */
  showMessage(text, duration = TOAST_MS) {
    // Tick31: the FINISHED panel owns the screen — a late reveal (item
    // roulette timer fired after the player crossed the line) must not pop
    // a toast over the results card (tick30 overlap). RACE/COUNTDOWN callers
    // are unaffected (finish hidden there); reset() re-enables toasts.
    if (this.finishEl && !this.finishEl.classList.contains('sk3d-hidden')) return;
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('sk3d-hidden', 'sk3d-toast-show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('sk3d-toast-show');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.add('sk3d-hidden');
    }, duration);
  }

  /** One-time rear-throw tip (audit r4). Persisted in localStorage so it shows
   *  once ever — teaches hold-to-throw-back without nagging. */
  showRearHint() {
    try {
      if (localStorage.getItem('sk3d.rearHintShown') === '1') return;
      localStorage.setItem('sk3d.rearHintShown', '1');
    } catch { /* private mode */ }
    this.showMessage('Hold ITEM to throw back! ↩️', 3600);
  }

  /** Show drift charge (0..1) while drifting; hide when not. */
  setDriftCharge(charge, active) {
    if (!this.driftMeterEl) return;
    // AUDIT imersão R11: speedo ghost acende durante o drift
    const speedo = this.root.querySelector('.sk3d-speedo');
    if (speedo) speedo.classList.toggle('sk3d-speedo-drift', !!active);
    if (!active) {
      if (!this.driftMeterEl.classList.contains('sk3d-hidden')) this.driftMeterEl.classList.add('sk3d-hidden');
      return;
    }
    this.driftMeterEl.classList.remove('sk3d-hidden');
    const pct = Math.max(0, Math.min(1, charge || 0));
    this.driftFillEl.style.width = `${Math.round(pct * 100)}%`;
    const ready = pct >= 0.75; // mini-boost release threshold (audit v4 F9:
    // the 3px tick was illegible — the whole meter flashes when ready)
    const color = pct < 0.33 ? '#ffffff' : pct < 0.66 ? '#ffd166' : '#ff9f45';
    this.driftFillEl.style.background = ready ? '#ffd166' : color;
    this.driftFillEl.style.boxShadow = ready ? '0 0 14px #ffd166, 0 0 26px #ff9f45' : `0 0 8px ${color}`;
    this.driftMeterEl.classList.toggle('sk3d-drift-ready', ready);
    if (ready && !this._driftReadyWas) {
      this._driftReadyWas = true;
      this._onDriftReady?.(); // beep when the release point is reached
    }
    if (!ready) this._driftReadyWas = false;
  }

  /** Toggle the pause overlay. */
  showPause(show) {
    const el = this.root.querySelector('.sk3d-pause');
    if (el) el.classList.toggle('sk3d-hidden', !show);
    if (show) this.root.querySelector('.sk3d-pause-restart')?.focus({ preventScroll: true });
    // AUDIT r3: Sound button must reflect mute state (was always '🔊').
    if (show) {
      const btn = this.root.querySelector('.sk3d-pause-sound');
      if (btn && window.__sk3d?.audio) {
        btn.textContent = window.__sk3d.audio.muted ? '🔇 Sound Off' : '🔊 Sound';
      }
    }
  }

  /** Clear all HUD state back to defaults. */
  reset() {
    clearTimeout(this.countdownTimer);
    clearTimeout(this.toastTimer);
    this.cancelRoulette(); // v4 F3: a restart must not leak the old spin
    this.showPause(false);

    this._pos = null;
    this._lapText = null;
    this._lapPct = null;
    this._timeText = null;

    this.positionEl.className = 'sk3d-chip sk3d-position';
    this.positionValueEl.textContent = '--';
    this.positionEl.setAttribute('aria-label', 'Your position: unavailable');
    this.lapTextEl.textContent = `LAP 1/${CONFIG.game.totalLaps}`;
    this.lapBarFillEl.style.width = '0%';
    this.timeEl.textContent = '0:00.0';

    this.setSpeed(0);
    this.setItem(null);
    this.setItem2(null);
    this.setCoins(0);
    clearTimeout(this._coinLossT); // AUDIT r8: no stale coin-loss flash into the fresh race
    this._clearCoinLoss();

    this.countdownEl.classList.add('sk3d-hidden');
    this.finishEl.classList.add('sk3d-hidden');
    this.root.classList.remove('sk3d-finish-active');
    this.toastEl.classList.add('sk3d-hidden');
  }
}
