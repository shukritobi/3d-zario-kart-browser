/**
 * Super Kart 3D (Zario Kart) — iPhone Wireless Nintendo Switch Controller UI (`?controller=1`)
 *
 * Turns an iPhone (Safari iOS) or any mobile smartphone into a wireless Nintendo Switch
 * Joy-Con / Mario Kart Steering Wheel controller paired to the 2021 45" Samsung Smart TV.
 */

import { SwitchClientBridge, normalizeRoomCode } from '../input/SwitchBridge.js';

const ITEM_EMOJI = {
  mushroom: '🍄',
  triple_mushroom: '🍄🍄🍄',
  green_shell: '🐢',
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

  // Hide the main 3D game HUD/menus so the iPhone uses <1% GPU and zero battery drain
  const hud = document.getElementById('hud-root');
  const menus = document.getElementById('menu-root');
  const touchControls = document.getElementById('touch-controls');
  if (hud) hud.style.display = 'none';
  if (menus) menus.style.display = 'none';
  if (touchControls) touchControls.style.display = 'none';

  const state = {
    steer: 0,
    stickSteer: 0,
    gyroSteer: 0,
    throttle: 0,
    autoThrottle: true, // MK8 Deluxe Auto-Accelerate enabled by default for comfort!
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

      <div class="zc-wheel-zone" id="zc-stick-zone">
        <div class="zc-wheel-ring" id="zc-wheel-visual">
          <div class="zc-wheel-top-mark"></div>
          <div class="zc-wheel-hub">ZARIO</div>
        </div>
        <div class="zc-steer-buttons">
          <button type="button" class="zc-dpad-btn" id="zc-steer-left" aria-label="Steer Left">◀</button>
          <button type="button" class="zc-dpad-btn" id="zc-steer-right" aria-label="Steer Right">▶</button>
        </div>
        <div class="zc-steer-readout" id="zc-steer-readout">STEER: 0°</div>
      </div>

      <div class="zc-left- utility-row">
        <button type="button" class="zc-pill-btn" id="zc-btn-gyro">🎯 Enable Motion Tilt</button>
        <button type="button" class="zc-pill-btn" id="zc-btn-recenter" hidden>⚖️ Center</button>
      </div>
    </div>

    <div class="zc-center-console">
      <div class="zc-top-bar">
        <div class="zc-room-group">
          <label for="zc-room-input">TV ROOM</label>
          <input id="zc-room-input" type="text" maxlength="6" value="${initialRoom}" autocomplete="off" spellcheck="false" />
          <button type="button" id="zc-room-connect">PAIR</button>
        </div>
        <div class="zc-conn-pill" id="zc-conn-status">Connecting...</div>
      </div>

      <div class="zc-telemetry-card">
        <div class="zc-tele-rank" id="zc-tele-rank">1st</div>
        <div class="zc-tele-mid">
          <div class="zc-tele-speed"><span id="zc-tele-speed-val">0</span> <small>km/h</small></div>
          <div class="zc-tele-lap" id="zc-tele-lap">LAP 1/3 · 🪙 0</div>
        </div>
        <div class="zc-tele-item" id="zc-tele-item" title="Tap to fire item">🎲</div>
      </div>

      <div class="zc-center-actions">
        <button type="button" class="zc-action-chip is-active" id="zc-btn-autogas">
          🚀 Auto-Gas (MK8): <strong>ON</strong>
        </button>
        <button type="button" class="zc-action-chip" id="zc-btn-swap">
          🔄 Swap Item (Y)
        </button>
        <button type="button" class="zc-action-chip" id="zc-btn-start">
          ➕ Start / Pause
        </button>
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

  const pulseFeedback = (ms = 20) => {
    try { navigator.vibrate?.(ms); } catch { /* iOS fallback */ }
    ui.classList.add('zc-haptic-flash');
    setTimeout(() => ui.classList.remove('zc-haptic-flash'), 90);
  };

  const clientBridge = new SwitchClientBridge({
    roomCode: initialRoom,
    onStatus: (st) => {
      const pill = ui.querySelector('#zc-conn-status');
      if (pill) {
        pill.textContent = st.connected ? `🟢 TV Linked (${st.transport})` : '🟡 Linking...';
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
        pill.textContent = `🟢 TV Linked (${clientBridge.transport})`;
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
  roomBtn?.addEventListener('click', () => {
    const code = normalizeRoomCode(roomInput?.value);
    if (code) {
      roomInput.value = code;
      clientBridge.setRoomCode(code);
      pulseFeedback(25);
    }
  });

  // Bind hold button helper (supports multi-touch pointer events)
  const bindHoldButton = (selector, onChange) => {
    const el = ui.querySelector(selector);
    if (!el) return;
    const press = (e) => {
      e.preventDefault();
      el.classList.add('is-pressed');
      onChange(true);
    };
    const release = (e) => {
      e.preventDefault();
      el.classList.remove('is-pressed');
      onChange(false);
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
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

  const fireItem = () => {
    state.useItem = true;
    pulseFeedback(30);
    setTimeout(() => { state.useItem = false; }, 110);
  };
  ui.querySelector('#zc-btn-item')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fireItem();
  });
  ui.querySelector('#zc-btn-item-shoulder')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fireItem();
  });
  ui.querySelector('#zc-tele-item')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fireItem();
  });

  // Auto-Gas toggle (Mario Kart 8 Smart Accelerate)
  const autoGasBtn = ui.querySelector('#zc-btn-autogas');
  autoGasBtn?.addEventListener('click', () => {
    state.autoThrottle = !state.autoThrottle;
    autoGasBtn.classList.toggle('is-active', state.autoThrottle);
    autoGasBtn.innerHTML = `🚀 Auto-Gas (MK8): <strong>${state.autoThrottle ? 'ON' : 'OFF'}</strong>`;
    pulseFeedback(15);
  });

  ui.querySelector('#zc-btn-swap')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    state.swapItem = true;
    pulseFeedback(15);
    setTimeout(() => { state.swapItem = false; }, 110);
  });

  ui.querySelector('#zc-btn-start')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    state.startRace = true;
    state.pause = true;
    pulseFeedback(20);
    setTimeout(() => {
      state.startRace = false;
      state.pause = false;
    }, 120);
  });

  // Left/Right D-pad steering buttons + drag-wheel steering
  let leftBtnHeld = false;
  let rightBtnHeld = false;
  bindHoldButton('#zc-steer-left', (down) => { leftBtnHeld = down; });
  bindHoldButton('#zc-steer-right', (down) => { rightBtnHeld = down; });

  const stickZone = ui.querySelector('#zc-stick-zone');
  let stickPointerId = null;
  stickZone?.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    stickPointerId = e.pointerId;
    updateStickFromEvent(e);
  });
  stickZone?.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointerId) return;
    updateStickFromEvent(e);
  });
  const endStick = (e) => {
    if (e.pointerId !== stickPointerId) return;
    stickPointerId = null;
    state.stickSteer = 0;
  };
  stickZone?.addEventListener('pointerup', endStick);
  stickZone?.addEventListener('pointercancel', endStick);

  function updateStickFromEvent(e) {
    const rect = stickZone.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const dx = (e.clientX - cx) / Math.max(40, rect.width * 0.36);
    state.stickSteer = Math.max(-1, Math.min(1, dx));
  }

  // iPhone Gyroscope Tilt Steering (Safari iOS 13+ permission compliant)
  const gyroBtn = ui.querySelector('#zc-btn-gyro');
  const recenterBtn = ui.querySelector('#zc-btn-recenter');

  const handleOrientation = (ev) => {
    if (!state.gyroEnabled) return;
    // In landscape orientation on iPhone, beta (-90..90) measures steering wheel tilt!
    // Fallback to gamma if device is held upright.
    const angle = typeof window.orientation === 'number' && Math.abs(window.orientation) === 90
      ? (window.orientation === 90 ? (ev.beta || 0) : -(ev.beta || 0))
      : (ev.gamma || ev.beta || 0);
    state.rawTiltDeg = angle;
    const calibrated = angle - state.gyroZeroOffset;
    state.tiltDeg = calibrated;
    // Full lock at ±28 degrees of steering wheel tilt
    const normalized = Math.max(-1, Math.min(1, calibrated / 28));
    state.gyroSteer = Math.abs(normalized) < 0.05 ? 0 : normalized;
  };

  gyroBtn?.addEventListener('click', async () => {
    if (state.gyroEnabled) {
      state.gyroEnabled = false;
      state.gyroSteer = 0;
      gyroBtn.textContent = '🎯 Enable Motion Tilt';
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
      gyroBtn.textContent = '🎯 Motion Tilt: ON';
      gyroBtn.classList.add('is-active');
      if (recenterBtn) recenterBtn.hidden = false;
      pulseFeedback(25);
    } catch { /* ignore */ }
  });

  recenterBtn?.addEventListener('click', () => {
    state.gyroZeroOffset = state.rawTiltDeg || 0;
    pulseFeedback(15);
  });

  // 30Hz input transmission & steering wheel visual update loop
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
      wheelVisual.style.transform = `rotate(${(combinedSteer * 42).toFixed(1)}deg)`;
    }
    if (steerReadout) {
      steerReadout.textContent = `STEER: ${Math.round(combinedSteer * 45)}°${state.gyroEnabled ? ' (GYRO)' : ''}`;
    }

    clientBridge.sendInput(state);
  }, 33);

  return {
    clientBridge,
    destroy() {
      clearInterval(timer);
      clientBridge.stop();
      ui.remove();
    },
  };
}
