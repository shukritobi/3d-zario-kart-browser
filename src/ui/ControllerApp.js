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
import { screenTilt, tiltToSteer, normalizeAngle } from '../input/tiltMath.js';

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
    stickY: 0,
    mode: 'analog',
    menuX: 0,
    menuY: 0,
    menuConfirm: false,
    menuBack: false,
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
      <div class="zc-pad-title">MOVE / STEER</div>
      <div class="zc-dpad-zone" id="zc-stick-zone" role="group" aria-label="Directional pad and analog thumbstick">
        <div class="zc-dpad-cross">
          <button type="button" class="zc-dpad-up" id="zc-dpad-up" aria-label="Up or accelerate">▲</button>
          <div class="zc-dpad-middle-row">
            <button type="button" class="zc-dpad-btn zc-dpad-left" id="zc-steer-left" aria-label="Left">◀</button>
            <div class="zc-dpad-center-pivot"><div class="zc-dpad-pivot-ring" id="zc-wheel-visual" aria-label="Analog stick"></div></div>
            <button type="button" class="zc-dpad-btn zc-dpad-right" id="zc-steer-right" aria-label="Right">▶</button>
          </div>
          <button type="button" class="zc-dpad-down" id="zc-dpad-down" aria-label="Down or brake">▼</button>
        </div>
        <div class="zc-steer-readout" id="zc-steer-readout">ANALOG · CENTER</div>
      </div>
      <div class="zc-left-utility-row">
        <button type="button" class="zc-pill-btn" id="zc-btn-mode">◎ ANALOG</button>
        <button type="button" class="zc-pill-btn" id="zc-btn-gyro">GYRO AUTO</button>
        <button type="button" class="zc-pill-btn" id="zc-btn-recenter" hidden>CENTER</button>
      </div>
    </div>
    <div class="zc-center-console">
      <div class="zc-top-bar">
        <div class="zc-room-group"><label for="zc-room-input">ROOM</label>
          <input id="zc-room-input" type="text" maxlength="6" value="${initialRoom}" autocomplete="off" autocapitalize="characters" spellcheck="false" />
          <button type="button" id="zc-room-connect">PAIR</button>
        </div>
        <div class="zc-conn-pill" id="zc-conn-status">Connecting...</div>
      </div>
      <div class="zc-telemetry-card">
        <div class="zc-tele-rank" id="zc-tele-rank">1st</div>
        <div class="zc-tele-mid">
          <div class="zc-tele-speed"><span id="zc-tele-speed-val">0</span><small> km/h</small></div>
          <div class="zc-tele-lap" id="zc-tele-lap">LAP 1/3</div>
        </div>
      </div>
      <div class="zc-center-actions">
        <button type="button" class="zc-action-chip is-active" id="zc-btn-autogas">AUTO GAS: ON</button>
        <div class="zc-center-subrow">
          <button type="button" class="zc-action-chip" id="zc-btn-back">BACK</button>
          <button type="button" class="zc-action-chip" id="zc-btn-confirm">SELECT</button>
          <button type="button" class="zc-action-chip" id="zc-btn-start">START / PAUSE</button>
        </div>
      </div>
    </div>
    <div class="zc-joycon-right">
      <div class="zc-pad-title">ACTION</div>
      <div class="zc-abxy-cluster">
        <button type="button" class="zc-pedal-btn zc-btn-a" id="zc-btn-drift"><span class="zc-btn-letter">R</span><span class="zc-btn-sub">DRIFT / TRICK</span></button>
        <div class="zc-secondary-pedals">
          <button type="button" class="zc-pedal-btn zc-btn-b" id="zc-btn-brake"><span class="zc-btn-letter">B</span><span class="zc-btn-sub">BRAKE</span></button>
          <button type="button" class="zc-pedal-btn zc-btn-x" id="zc-btn-item"><span class="zc-btn-letter">X</span><span class="zc-btn-sub">ITEM</span></button>
          <button type="button" class="zc-pedal-btn zc-btn-a" id="zc-btn-gas"><span class="zc-btn-letter">A</span><span class="zc-btn-sub">GAS</span></button>
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

  let manualDrift = false;
  let autoDriftUntil = 0;
  bindHoldButton('#zc-btn-drift', (down) => {
    manualDrift = down;
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
  // One item button only: no duplicated shoulder/telemetry fire targets.

  // Auto-Gas toggle (Mario Kart 8 Smart Accelerate)
  const autoGasBtn = ui.querySelector('#zc-btn-autogas');
  bindTapButton('#zc-btn-autogas', () => {
    state.autoThrottle = !state.autoThrottle;
    if (autoGasBtn) {
      autoGasBtn.classList.toggle('is-active', state.autoThrottle);
      autoGasBtn.textContent = `AUTO GAS: ${state.autoThrottle ? 'ON' : 'OFF'}`;
    }
    pulseFeedback(15);
  });

  bindTapButton('#zc-btn-confirm', () => {
    state.menuConfirm = true;
    setTimeout(() => { state.menuConfirm = false; }, 130);
  });
  bindTapButton('#zc-btn-back', () => {
    state.menuBack = true;
    setTimeout(() => { state.menuBack = false; }, 130);
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

  // Four-way D-pad with optional 360-degree analog thumbstick.
  // A rapid second tap in the same steering direction starts a short drift.
  const modeBtn = ui.querySelector('#zc-btn-mode');
  try { state.mode = localStorage.getItem('zario.phone.pad.v2') === 'dpad' ? 'dpad' : 'analog'; } catch {}
  const syncMode = () => {
    ui.classList.toggle('zc-mode-dpad', state.mode === 'dpad');
    if (modeBtn) modeBtn.textContent = state.mode === 'analog' ? '◎ ANALOG' : '✚ D-PAD';
  };
  syncMode();
  bindTapButton('#zc-btn-mode', () => {
    state.mode = state.mode === 'analog' ? 'dpad' : 'analog';
    state.stickSteer = 0; state.stickY = 0;
    try { localStorage.setItem('zario.phone.pad.v2', state.mode); } catch {}
    syncMode();
  });
  let leftBtnHeld = false;
  let rightBtnHeld = false;
  let upBtnHeld = false;
  let downBtnHeld = false;
  const lastDirectionalTap = {left: 0, right: 0};
  const steeringTap = (dir) => {
    const now = performance.now();
    if (now - lastDirectionalTap[dir] <= 290 && now - lastDirectionalTap[dir] >= 70) {
      autoDriftUntil = now + 1050;
      pulseFeedback(30);
    }
    lastDirectionalTap[dir] = now;
  };
  bindHoldButton('#zc-steer-left', (down) => { leftBtnHeld = down; if (down) steeringTap('left'); });
  bindHoldButton('#zc-steer-right', (down) => { rightBtnHeld = down; if (down) steeringTap('right'); });
  bindHoldButton('#zc-dpad-up', (down) => { upBtnHeld = down; });
  bindHoldButton('#zc-dpad-down', (down) => { downBtnHeld = down; });

  const stickZone = ui.querySelector('#zc-stick-zone');
  let stickPointerId = null;
  stickZone?.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'analog' || e.target.closest('button')) return;
    stickPointerId = e.pointerId;
    try { stickZone.setPointerCapture(e.pointerId); } catch {}
    updateStick(e);
  });
  stickZone?.addEventListener('pointermove', (e) => {
    if (stickPointerId === e.pointerId) updateStick(e);
  });
  const endStick = (e) => {
    if (stickPointerId !== e.pointerId) return;
    stickPointerId = null;
    state.stickSteer = 0;
    state.stickY = 0;
  };
  stickZone?.addEventListener('pointerup', endStick);
  stickZone?.addEventListener('pointercancel', endStick);
  stickZone?.addEventListener('lostpointercapture', endStick);
  function updateStick(e) {
    const rect = stickZone.getBoundingClientRect();
    // CSS-rotated portrait fallback: virtual X/Y become physical Y/-X.
    const dx = isPortraitRotated
      ? (e.clientY - (rect.top + rect.height / 2))
      : (e.clientX - (rect.left + rect.width / 2));
    const dy = isPortraitRotated
      ? -(e.clientX - (rect.left + rect.width / 2))
      : (e.clientY - (rect.top + rect.height / 2));
    const radius = Math.max(38, Math.min(rect.width, rect.height) * 0.38);
    state.stickSteer = Math.abs(dx) < radius * 0.09 ? 0 : Math.max(-1, Math.min(1, dx / radius));
    state.stickY = Math.abs(dy) < radius * 0.15 ? 0 : Math.max(-1, Math.min(1, dy / radius));
  }

  const gyroBtn = ui.querySelector('#zc-btn-gyro');
  const recenterBtn = ui.querySelector('#zc-btn-recenter');
  let gyroNeutral = null;
  let lastSensorAt = 0;
  let permissionAttempted = false;
  let userDisabledGyro = false;
  try { userDisabledGyro = localStorage.getItem('zario.phone.gyro.v2') === 'off'; } catch {}
  const screenAngle = () => {
    const legacy = Number(window.orientation);
    const screenValue = Number(screen.orientation?.angle);
    if (Number.isFinite(legacy) && Math.abs(legacy) === 90 &&
        (!Number.isFinite(screenValue) || normalizeAngle(screenValue) === 0)) return normalizeAngle(legacy);
    return normalizeAngle(Number.isFinite(screenValue) ? screenValue : (Number.isFinite(legacy) ? legacy : 0));
  };
  const handleOrientation = (ev) => {
    const raw = screenTilt(ev, screenAngle());
    if (raw === null) return;
    state.rawTiltDeg = raw;
    lastSensorAt = performance.now();
    if (!state.gyroEnabled) return;
    if (gyroNeutral === null) { gyroNeutral = raw; return; }
    const target = tiltToSteer(raw, gyroNeutral, {deadZone: 3.2, fullSteer: 32});
    state.gyroSteer += 0.36 * (target - state.gyroSteer);
    state.tiltDeg = raw - gyroNeutral;
  };
  window.addEventListener('deviceorientation', handleOrientation, {passive: true});
  const syncGyro = (label) => {
    if (gyroBtn) {
      gyroBtn.textContent = label || (state.gyroEnabled ? 'GYRO ON' : 'GYRO OFF');
      gyroBtn.classList.toggle('is-active', state.gyroEnabled);
    }
    if (recenterBtn) recenterBtn.hidden = !state.gyroEnabled;
  };
  async function enableGyro() {
    if (userDisabledGyro || permissionAttempted || state.gyroEnabled) return;
    permissionAttempted = true;
    try {
      if (typeof DeviceOrientationEvent === 'undefined') throw Error('No motion sensor');
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS requires this synchronous call from a real touch/pointer gesture.
        const result = await DeviceOrientationEvent.requestPermission();
        if (result !== 'granted') throw Error('Motion access declined');
      }
      state.gyroEnabled = true;
      state.gyroSteer = 0;
      gyroNeutral = null;
      syncGyro();
    } catch {
      state.gyroEnabled = false;
      state.gyroSteer = 0;
      userDisabledGyro = true;
      syncGyro('GYRO UNAVAILABLE');
    }
  }
  // Android can start listening without a permission prompt; on iOS the first
  // controller interaction supplies the gesture, and rejection leaves D-pad on.
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission !== 'function') enableGyro();
  ui.addEventListener('pointerdown', () => {
    if (!permissionAttempted && !userDisabledGyro) enableGyro();
  }, {once: true, capture: true});
  bindTapButton('#zc-btn-gyro', () => {
    if (state.gyroEnabled) {
      userDisabledGyro = true;
      state.gyroEnabled = false;
      state.gyroSteer = 0;
      try { localStorage.setItem('zario.phone.gyro.v2', 'off'); } catch {}
      syncGyro();
    } else {
      userDisabledGyro = false;
      permissionAttempted = false;
      try { localStorage.setItem('zario.phone.gyro.v2', 'on'); } catch {}
      enableGyro();
    }
  });
  bindTapButton('#zc-btn-recenter', () => {
    gyroNeutral = Number.isFinite(state.rawTiltDeg) ? state.rawTiltDeg : null;
    state.gyroSteer = 0;
    pulseFeedback(15);
  });
  window.addEventListener('orientationchange', () => {
    gyroNeutral = null;
    state.gyroSteer = 0;
  });
  syncGyro(userDisabledGyro ? 'GYRO OFF' : 'GYRO AUTO');

  // 30Hz input transmission & D-Pad visual indicator loop
  const wheelVisual = ui.querySelector('#zc-wheel-visual');
  const steerReadout = ui.querySelector('#zc-steer-readout');

  const timer = setInterval(() => {
    const dpadSteer = (rightBtnHeld ? 1 : 0) - (leftBtnHeld ? 1 : 0);
    const steerFromStick = state.mode === 'analog' ? state.stickSteer : 0;
    const steerFromGyro = state.gyroEnabled && performance.now() - lastSensorAt < 650 ? state.gyroSteer : 0;
    const combinedSteer = Math.max(-1, Math.min(1,
      dpadSteer || (Math.abs(steerFromStick) > 0.08 ? steerFromStick : steerFromGyro)));
    const axisY = state.mode === 'analog' ? state.stickY : 0;
    state.steer = combinedSteer;
    const up = upBtnHeld || axisY < -0.32;
    const down = downBtnHeld || axisY > 0.32;
    state.menuX = dpadSteer || (Math.abs(steerFromStick) > 0.6 ? Math.sign(steerFromStick) : 0);
    state.menuY = (down ? 1 : 0) - (up ? 1 : 0);
    state.brake = (down || ui.querySelector('#zc-btn-brake')?.classList.contains('is-pressed')) ? 1 : 0;
    state.throttle = (manualGasHeld || up || (state.autoThrottle && !state.brake)) ? 1 : 0;
    state.drift = manualDrift || performance.now() < autoDriftUntil;
    if (wheelVisual) wheelVisual.style.transform = `translate(${(combinedSteer * 12).toFixed(1)}px, ${(axisY * 9).toFixed(1)}px)`;
    if (steerReadout) steerReadout.textContent =
      `${state.gyroEnabled ? 'GYRO' : state.mode.toUpperCase()} · ${combinedSteer < -0.1 ? 'LEFT' : combinedSteer > 0.1 ? 'RIGHT' : 'CENTER'}`;
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
