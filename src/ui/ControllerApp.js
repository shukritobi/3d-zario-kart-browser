/**
 * Super Kart 3D (Zario Kart) — iPhone Wireless Nintendo Switch Controller UI (`?controller=1`)
 *
 * Turns an iPhone (Safari iOS) or any mobile smartphone into a wireless Nintendo Switch
 * D-Pad + Joy-Con controller paired to the 2021 45" Samsung Smart TV.
 *
 * Key UX Guarantees:
 *   1. Locked in Landscape Mode: Automatically locks into landscape layout whether the
 *      iPhone is held sideways OR held with iOS Portrait Orientation Lock enabled (via
 *      automatic 90° CSS landscape rotation + coordinate mapping).
 *   2. Zero Overflow: Uses exact visualViewport / innerWidth-innerHeight bounds with
 *      `min-height: 0` / `min-width: 0` flex/grid constraints so no element ever overflows.
 *   3. Zero Double-Tap Zoom or Highlight: Intercepts `touchstart`, `touchend`, `dblclick`,
 *      `selectstart`, and `gesturestart` with `{ passive: false }` + `touch-action: none`
 *      and `-webkit-user-select: none` so rapid tapping never zooms or highlights text.
 */

import { SwitchClientBridge, normalizeRoomCode } from '../input/SwitchBridge.js';

const ITEM_EMOJI = {
  mushroom: '🍄',
  triple_mushroom: '🍄🍄🍄',
  green_shell: '🐢',
  shell: '🐢',
  red_shell: '🔴',
  blue_shell: '🐚',
  banana: '🍌',
  star: '⭐',
  lightning: '⚡',
  coin: '🪙',
};

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];

export function mountControllerApp(rootContainer) {
  const qs = new URLSearchParams(window.location.search);
  const initialRoom = normalizeRoomCode(qs.get('room')) || 'KART';

  // Hide the main 3D game HUD/menus/orientation prompt so the controller owns 100% of the screen
  const hud = document.getElementById('hud-root');
  const menus = document.getElementById('menu-root');
  const touchControls = document.getElementById('touch-controls');
  const orientPrompt = document.querySelector('.zario-orientation-prompt');
  const bootGuard = document.getElementById('zario-boot-guard');
  if (hud) hud.style.display = 'none';
  if (menus) menus.style.display = 'none';
  if (touchControls) touchControls.style.display = 'none';
  if (orientPrompt) orientPrompt.style.display = 'none';
  if (bootGuard) bootGuard.remove();

  document.documentElement.classList.add('zc-controller-html-lock');
  document.body.classList.add('zc-controller-body-lock');

  const state = {
    steer: 0,
    stickSteer: 0,
    gyroSteer: 0,
    throttle: 0,
    autoThrottle: true, // MK8 Deluxe Auto-Accelerate enabled by default
    brake: 0,
    drift: false,
    useItem: false,
    itemDir: 0,
    swapItem: false,
    pause: false,
    startRace: false,
    gyroEnabled: false,
    gyroZeroOffset: 0,
    rawTiltDeg: 0,
    tiltDeg: 0,
  };

  const ui = document.createElement('div');
  ui.id = 'zario-iphone-controller';
  ui.className = 'zario-controller-shell';
  ui.innerHTML = `
    <div class="zc-joycon-left">
      <div class="zc-shoulder-bar">
        <button type="button" class="zc-shoulder-btn" id="zc-btn-item-shoulder">ZL · USE ITEM</button>
      </div>

      <div class="zc-dpad-zone" id="zc-stick-zone">
        <div class="zc-dpad-cross" role="group" aria-label="Directional Pad">
          <div class="zc-dpad-up" id="zc-dpad-up" aria-label="Aim Forward">▲</div>
          <div class="zc-dpad-middle-row">
            <button type="button" class="zc-dpad-btn zc-dpad-left" id="zc-steer-left" aria-label="Steer Left">
              <span class="zc-dpad-arrow">◀</span>
              <span class="zc-dpad-label">LEFT</span>
            </button>
            <div class="zc-dpad-center-pivot">
              <div class="zc-dpad-pivot-ring" id="zc-wheel-visual"></div>
            </div>
            <button type="button" class="zc-dpad-btn zc-dpad-right" id="zc-steer-right" aria-label="Steer Right">
              <span class="zc-dpad-arrow">▶</span>
              <span class="zc-dpad-label">RIGHT</span>
            </button>
          </div>
          <div class="zc-dpad-down" id="zc-dpad-down" aria-label="Aim Backward">▼</div>
        </div>
        <div class="zc-steer-readout" id="zc-steer-readout">D-PAD · 0°</div>
      </div>

      <div class="zc-left-utility-row">
        <button type="button" class="zc-pill-btn" id="zc-btn-gyro">🎯 Tilt: OFF</button>
        <button type="button" class="zc-pill-btn" id="zc-btn-recenter" hidden>⚖️ Center</button>
      </div>
    </div>

    <div class="zc-center-console">
      <div class="zc-top-bar">
        <div class="zc-room-group">
          <label for="zc-room-input">ROOM</label>
          <input id="zc-room-input" type="text" maxlength="6" value="${initialRoom}" autocomplete="off" autocapitalize="characters" spellcheck="false" />
          <button type="button" id="zc-room-connect">PAIR</button>
        </div>
        <div class="zc-conn-pill" id="zc-conn-status">🟡 Linking TV...</div>
      </div>

      <div class="zc-telemetry-card">
        <div class="zc-tele-rank" id="zc-tele-rank">1st</div>
        <div class="zc-tele-mid">
          <div class="zc-tele-speed"><span id="zc-tele-speed-val">0</span> <small>km/h</small></div>
          <div class="zc-tele-lap" id="zc-tele-lap">LAP 1/3 · 🪙 0</div>
        </div>
        <button type="button" class="zc-tele-item" id="zc-tele-item" aria-label="Tap to fire held item">🎲</button>
      </div>

      <div class="zc-center-actions">
        <button type="button" class="zc-action-chip is-active" id="zc-btn-autogas">
          🚀 Auto-Gas: <strong>ON</strong>
        </button>
        <div class="zc-center-subrow">
          <button type="button" class="zc-action-chip" id="zc-btn-swap">
            🔄 Swap (Y)
          </button>
          <button type="button" class="zc-action-chip" id="zc-btn-start">
            ➕ Start / Pause
          </button>
        </div>
      </div>
    </div>

    <div class="zc-joycon-right">
      <div class="zc-shoulder-bar">
        <button type="button" class="zc-shoulder-btn zc-zr" id="zc-btn-drift">ZR · DRIFT / TRICK</button>
      </div>

      <div class="zc-abxy-cluster">
        <button type="button" class="zc-pedal-btn zc-btn-a" id="zc-btn-gas">
          <span class="zc-btn-letter">A</span>
          <span class="zc-btn-sub">GAS / BOOST</span>
        </button>
        <div class="zc-secondary-pedals">
          <button type="button" class="zc-pedal-btn zc-btn-b" id="zc-btn-brake">
            <span class="zc-btn-letter">B</span>
            <span class="zc-btn-sub">BRAKE</span>
          </button>
          <button type="button" class="zc-pedal-btn zc-btn-x" id="zc-btn-item">
            <span class="zc-btn-letter">X</span>
            <span class="zc-btn-sub">FIRE ITEM</span>
          </button>
        </div>
      </div>
    </div>
  `;

  (rootContainer || document.body).appendChild(ui);

  // -------------------------------------------------------------------------
  // 1. Strict Landscape Mode Lock (Works even when iOS Portrait Lock is ON!)
  // -------------------------------------------------------------------------
  let isPortraitRotated = false;
  const syncLandscapeViewport = () => {
    const vv = window.visualViewport;
    const vw = Math.round(vv ? vv.width : window.innerWidth);
    const vh = Math.round(vv ? vv.height : window.innerHeight);

    if (vh > vw) {
      // Device viewport is Portrait -> Force-lock controller into Landscape via 90° rotation
      isPortraitRotated = true;
      ui.classList.add('is-portrait-locked-landscape');
      ui.style.width = `${vh}px`;
      ui.style.height = `${vw}px`;
      ui.style.top = `${Math.round(vh / 2)}px`;
      ui.style.left = `${Math.round(vw / 2)}px`;
      ui.style.transform = 'translate(-50%, -50%) rotate(90deg)';
    } else {
      // Device viewport is natural Landscape -> Fill exact viewport without overflow
      isPortraitRotated = false;
      ui.classList.remove('is-portrait-locked-landscape');
      ui.style.width = `${vw}px`;
      ui.style.height = `${vh}px`;
      ui.style.top = '0px';
      ui.style.left = '0px';
      ui.style.transform = 'none';
    }
  };

  syncLandscapeViewport();
  window.addEventListener('resize', syncLandscapeViewport);
  window.addEventListener('orientationchange', syncLandscapeViewport);
  window.visualViewport?.addEventListener('resize', syncLandscapeViewport);
  try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* ignore */ }

  // -------------------------------------------------------------------------
  // 2. Anti-Zoom & Anti-Highlight Guards (iOS Safari Double-Tap / Pinch / Select)
  // -------------------------------------------------------------------------
  const preventGesture = (e) => {
    if (e.target && e.target.id === 'zc-room-input') return;
    e.preventDefault();
  };
  ui.addEventListener('dblclick', preventGesture, { passive: false });
  ui.addEventListener('selectstart', preventGesture, { passive: false });
  ui.addEventListener('contextmenu', preventGesture, { passive: false });
  ui.addEventListener('gesturestart', preventGesture, { passive: false });
  ui.addEventListener('gesturechange', preventGesture, { passive: false });
  ui.addEventListener('gestureend', preventGesture, { passive: false });

  // Prevent iOS Safari double-tap-to-zoom on all interactive buttons
  ui.addEventListener('touchstart', (e) => {
    if (e.target && e.target.id === 'zc-room-input') return;
    if (e.touches && e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });

  let lastTouchEndAt = 0;
  ui.addEventListener('touchend', (e) => {
    if (e.target && e.target.id === 'zc-room-input') return;
    const now = Date.now();
    if (now - lastTouchEndAt <= 350) {
      e.preventDefault();
    }
    lastTouchEndAt = now;
  }, { passive: false });

  const pulseFeedback = (ms = 20) => {
    try { navigator.vibrate?.(ms); } catch { /* iOS fallback */ }
    ui.classList.add('zc-haptic-flash');
    setTimeout(() => ui.classList.remove('zc-haptic-flash'), 80);
  };

  const clientBridge = new SwitchClientBridge({
    roomCode: initialRoom,
    onStatus: (st) => {
      const pill = ui.querySelector('#zc-conn-status');
      if (pill) {
        pill.textContent = st.connected ? `🟢 Linked (${st.transport})` : '🟡 Linking TV...';
        pill.classList.toggle('is-online', !!st.connected);
      }
    },
    onTelemetry: (tele) => {
      const rankEl = ui.querySelector('#zc-tele-rank');
      const speedEl = ui.querySelector('#zc-tele-speed-val');
      const lapEl = ui.querySelector('#zc-tele-lap');
      const itemEl = ui.querySelector('#zc-tele-item');
      const pill = ui.querySelector('#zc-conn-status');
      if (pill) {
        pill.textContent = `🟢 Linked (${clientBridge.transport})`;
        pill.classList.add('is-online');
      }
      if (rankEl && tele.position) {
        rankEl.textContent = ORDINAL[tele.position] || `${tele.position}th`;
      }
      if (speedEl && typeof tele.speedKmh === 'number') {
        speedEl.textContent = String(Math.round(tele.speedKmh));
      }
      if (lapEl) {
        lapEl.textContent = `LAP ${tele.lap || 1}/${tele.totalLaps || 3} · 🪙 ${tele.coins || 0}`;
      }
      if (itemEl) {
        itemEl.textContent = tele.heldItem ? (ITEM_EMOJI[tele.heldItem] || '🎁') : '🎲';
      }
    },
  }).start();

  // Room code pairing input
  const roomInput = ui.querySelector('#zc-room-input');
  const roomBtn = ui.querySelector('#zc-room-connect');
  const pairRoom = () => {
    const code = normalizeRoomCode(roomInput?.value);
    if (code) {
      roomInput.value = code;
      roomInput.blur();
      clientBridge.setRoomCode(code);
      pulseFeedback(25);
    }
  };
  roomBtn?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pairRoom();
  });
  roomBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    pairRoom();
  });

  // Bind hold button helper (supports multi-touch pointer + touch events without zoom/selection)
  const bindHoldButton = (selector, onChange) => {
    const el = ui.querySelector(selector);
    if (!el) return;
    const press = (e) => {
      if (e.cancelable) e.preventDefault();
      if (e.pointerId !== undefined && el.setPointerCapture) {
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      el.classList.add('is-pressed');
      onChange(true);
    };
    const release = (e) => {
      if (e && e.cancelable) e.preventDefault();
      el.classList.remove('is-pressed');
      onChange(false);
    };
    el.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('lostpointercapture', release);
  };

  let manualGasHeld = false;
  bindHoldButton('#zc-btn-gas', (down) => {
    manualGasHeld = down;
    if (down) pulseFeedback(12);
  });

  bindHoldButton('#zc-btn-brake', (down) => {
    state.brake = down ? 1 : 0;
  });

  bindHoldButton('#zc-btn-drift', (down) => {
    state.drift = down;
    if (down) pulseFeedback(18);
  });

  const bindTapButton = (selector, onTap) => {
    const el = ui.querySelector(selector);
    if (!el) return;
    let lastFire = 0;
    const trigger = (e) => {
      if (e && e.cancelable) e.preventDefault();
      const now = performance.now();
      if (now - lastFire < 80) return;
      lastFire = now;
      el.classList.add('is-pressed');
      setTimeout(() => el.classList.remove('is-pressed'), 100);
      onTap();
    };
    el.addEventListener('touchstart', trigger, { passive: false });
    el.addEventListener('pointerdown', trigger);
  };

  const fireItem = () => {
    state.useItem = true;
    pulseFeedback(30);
    setTimeout(() => { state.useItem = false; }, 110);
  };
  bindTapButton('#zc-btn-item', fireItem);
  bindTapButton('#zc-btn-item-shoulder', fireItem);
  bindTapButton('#zc-tele-item', fireItem);

  // Auto-Gas toggle (Mario Kart 8 Smart Accelerate)
  const autoGasBtn = ui.querySelector('#zc-btn-autogas');
  bindTapButton('#zc-btn-autogas', () => {
    state.autoThrottle = !state.autoThrottle;
    if (autoGasBtn) {
      autoGasBtn.classList.toggle('is-active', state.autoThrottle);
      autoGasBtn.innerHTML = `🚀 Auto-Gas: <strong>${state.autoThrottle ? 'ON' : 'OFF'}</strong>`;
    }
    pulseFeedback(15);
  });

  bindTapButton('#zc-btn-swap', () => {
    state.swapItem = true;
    pulseFeedback(15);
    setTimeout(() => { state.swapItem = false; }, 110);
  });

  bindTapButton('#zc-btn-start', () => {
    state.startRace = true;
    state.pause = true;
    pulseFeedback(20);
    setTimeout(() => {
      state.startRace = false;
      state.pause = false;
    }, 120);
  });

  // Left/Right D-Pad steering buttons + smooth D-Pad rocker slide
  let leftBtnHeld = false;
  let rightBtnHeld = false;
  bindHoldButton('#zc-steer-left', (down) => {
    leftBtnHeld = down;
    if (down) pulseFeedback(10);
  });
  bindHoldButton('#zc-steer-right', (down) => {
    rightBtnHeld = down;
    if (down) pulseFeedback(10);
  });

  const stickZone = ui.querySelector('#zc-stick-zone');
  let stickPointerId = null;
  stickZone?.addEventListener('touchstart', (e) => {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  stickZone?.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    stickPointerId = e.pointerId;
    updateDpadSlideFromEvent(e);
  });
  stickZone?.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointerId) return;
    updateDpadSlideFromEvent(e);
  });
  const endStick = (e) => {
    if (e.pointerId !== stickPointerId) return;
    stickPointerId = null;
    state.stickSteer = 0;
  };
  stickZone?.addEventListener('pointerup', endStick);
  stickZone?.addEventListener('pointercancel', endStick);

  function updateDpadSlideFromEvent(e) {
    const rect = stickZone.getBoundingClientRect();
    if (isPortraitRotated) {
      // When rotated +90deg in portrait mode, screen Y corresponds to controller X!
      const cy = rect.top + rect.height * 0.5;
      const dy = (e.clientY - cy) / Math.max(36, rect.height * 0.36);
      state.stickSteer = Math.max(-1, Math.min(1, dy));
    } else {
      const cx = rect.left + rect.width * 0.5;
      const dx = (e.clientX - cx) / Math.max(36, rect.width * 0.36);
      state.stickSteer = Math.max(-1, Math.min(1, dx));
    }
  }

  // iPhone Gyroscope Tilt Steering (Safari iOS 13+ permission compliant)
  const gyroBtn = ui.querySelector('#zc-btn-gyro');
  const recenterBtn = ui.querySelector('#zc-btn-recenter');

  const handleOrientation = (ev) => {
    if (!state.gyroEnabled) return;
    const angle = typeof window.orientation === 'number' && Math.abs(window.orientation) === 90
      ? (window.orientation === 90 ? (ev.beta || 0) : -(ev.beta || 0))
      : (ev.gamma || ev.beta || 0);
    state.rawTiltDeg = angle;
    const calibrated = angle - state.gyroZeroOffset;
    state.tiltDeg = calibrated;
    const normalized = Math.max(-1, Math.min(1, calibrated / 28));
    state.gyroSteer = Math.abs(normalized) < 0.05 ? 0 : normalized;
  };

  gyroBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (state.gyroEnabled) {
      state.gyroEnabled = false;
      state.gyroSteer = 0;
      gyroBtn.textContent = '🎯 Tilt: OFF';
      gyroBtn.classList.remove('is-active');
      if (recenterBtn) recenterBtn.hidden = true;
      return;
    }
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') return;
      }
      window.addEventListener('deviceorientation', handleOrientation);
      state.gyroEnabled = true;
      state.gyroZeroOffset = state.rawTiltDeg || 0;
      gyroBtn.textContent = '🎯 Tilt: ON';
      gyroBtn.classList.add('is-active');
      if (recenterBtn) recenterBtn.hidden = false;
      pulseFeedback(25);
    } catch { /* ignore */ }
  });

  bindTapButton('#zc-btn-recenter', () => {
    state.gyroZeroOffset = state.rawTiltDeg || 0;
    pulseFeedback(15);
  });

  // 30Hz input transmission & D-Pad visual indicator loop
  const wheelVisual = ui.querySelector('#zc-wheel-visual');
  const steerReadout = ui.querySelector('#zc-steer-readout');

  const timer = setInterval(() => {
    const dpadSteer = (rightBtnHeld ? 1 : 0) - (leftBtnHeld ? 1 : 0);
    let combinedSteer = dpadSteer !== 0
      ? dpadSteer
      : (Math.abs(state.stickSteer) > 0.05 ? state.stickSteer : (state.gyroEnabled ? state.gyroSteer : 0));
    combinedSteer = Math.max(-1, Math.min(1, combinedSteer));
    state.steer = combinedSteer;
    state.throttle = (manualGasHeld || (state.autoThrottle && state.brake === 0)) ? 1 : 0;

    if (wheelVisual) {
      wheelVisual.style.transform = `translateX(${(combinedSteer * 10).toFixed(1)}px)`;
    }
    if (steerReadout) {
      const dirLabel = combinedSteer < -0.1 ? '◀ LEFT' : combinedSteer > 0.1 ? 'RIGHT ▶' : 'CENTER';
      steerReadout.textContent = `${state.gyroEnabled ? 'GYRO' : 'D-PAD'} · ${dirLabel} (${Math.round(combinedSteer * 45)}°)`;
    }

    clientBridge.sendInput(state);
  }, 33);
  timer.unref?.();

  return {
    clientBridge,
    syncLandscapeViewport,
    destroy() {
      clearInterval(timer);
      window.removeEventListener?.('resize', syncLandscapeViewport);
      window.removeEventListener?.('orientationchange', syncLandscapeViewport);
      window.visualViewport?.removeEventListener?.('resize', syncLandscapeViewport);
      document.documentElement?.classList?.remove?.('zc-controller-html-lock');
      document.body?.classList?.remove?.('zc-controller-body-lock');
      clientBridge.stop();
      ui.remove?.();
    },
  };
}
