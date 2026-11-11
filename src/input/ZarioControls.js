/* Zario Kart original mobile input adapter. Preserves the upstream MIT engine. */
import './zario-controls.css';
import {screenTilt, normalizeAngle, tiltToSteer} from './tiltMath.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const button = (text, title) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  return b;
};
const isTouch = () => !!window.matchMedia?.('(pointer: coarse)')?.matches;

export class ZarioControls {
  constructor({ touchRoot, onItemDown = () => {}, onItemUp = () => {}, onPause = () => {} } = {}) {
    this.touchRoot = touchRoot;
    this.onItemDown = onItemDown;
    this.onItemUp = onItemUp;
    this.onPause = onPause;
    this.tiltEnabled = false;
    this.autoTiltAttempted = false;
    try { this.userDisabledTilt = localStorage.getItem('zario.tilt.choice.v2') === 'off'; }
    catch { this.userDisabledTilt = false; }
    this.steer = 0;
    this.neutral = null;
    this.lastRaw = null;
    this.lastSampleTime = 0;
    // Keep the player's steering preference independent of gyro permissions.
    try { this.inverted = localStorage.getItem('zario.steer.inverted.v2') === '1'; }
    catch { this.inverted = false; }
    try { this.gripMode = localStorage.getItem('zario.handling.v1') === 'classic' ? 'classic' : 'tight'; }
    catch { this.gripMode = 'tight'; }
    try { this.axis = ['auto', 'beta', 'gamma'].includes(localStorage.getItem('zario.tilt.axis.v1')) ? localStorage.getItem('zario.tilt.axis.v1') : 'auto'; }
    catch { this.axis = 'auto'; }
    this.gamepadActive = false;
    this.lastItem = false;
    this.lastPause = false;
    this.element = document.createElement('div');
    this.element.className = 'zario-controls';
    this.toggle = button('GYRO OFF', 'Enable tilt steering (requires motion permission)');
    this.recenterButton = button('RECENTER', 'Calibrate your comfortable steering position');
    this.invertButton = button('↔ FLIP', 'Reverse steering for touch, gyro and gamepad');
    this.invertButton.classList.toggle('active', this.inverted);
    this.recenterButton.hidden = true;
    this.axisButton = button('AXIS: AUTO', 'Choose motion sensor axis for unusual tablet orientations');
    this.axisButton.hidden = true;
    this.gripButton = button('GRIP: TIGHT', 'Switch between tight arcade handling and classic loose drift');
    this.statusButton = button('◀  •  ▶', 'Steering input indicator');
    this.statusButton.disabled = true;
    this.updateLabels();
    this.element.append(this.toggle, this.recenterButton, this.axisButton, this.invertButton, this.gripButton, this.statusButton);
    document.body.appendChild(this.element);
    if (navigator.maxTouchPoints > 0) document.body.classList.add('zario-touchscreen');

    this.hint = document.createElement('div');
    this.hint.className = 'zario-landscape-hint';
    this.hint.textContent = '↻ Rotate to landscape for the best racing view';
    document.body.appendChild(this.hint);

    this.toggle.addEventListener('click', () => this.toggleTilt());
    this.recenterButton.addEventListener('click', () => this.recenter());
    this.invertButton.addEventListener('click', () => {
      this.inverted = !this.inverted;
      this.invertButton.classList.toggle('active', this.inverted);
      try { localStorage.setItem('zario.steer.inverted.v2', this.inverted ? '1' : '0'); } catch {}
      this.updateLabels();
    });
    this.gripButton.addEventListener('click', () => {
      this.gripMode = this.gripMode === 'tight' ? 'classic' : 'tight';
      try { localStorage.setItem('zario.handling.v1', this.gripMode); } catch {}
      this.updateLabels();
    });
    this.axisButton.addEventListener('click', () => {
      this.axis = { auto: 'beta', beta: 'gamma', gamma: 'auto' }[this.axis];
      try { localStorage.setItem('zario.tilt.axis.v1', this.axis); } catch {}
      this.neutral = null;
      this.lastRaw = null;
      this.steer = 0;
      this.updateLabels();
    });
    window.addEventListener('deviceorientation', (event) => this.readSensor(event), { passive: true });
    window.addEventListener('orientationchange', () => this.resetTilt());
    screen.orientation?.addEventListener?.('change', () => this.resetTilt());
    window.addEventListener('gamepadconnected', () => this.updatePadLabel());
    window.addEventListener('gamepaddisconnected', () => this.updatePadLabel());
    this.updatePadLabel();
  }

  angle() {
    const screenAngle = Number(screen.orientation?.angle);
    const legacyAngle = Number(window.orientation);
    // Some iPad Chrome/WebKit builds report a stale 0 in screen.orientation
    // while the older orientation property has the actual screen rotation.
    if (Number.isFinite(legacyAngle) && Math.abs(legacyAngle) > 0 &&
        Number.isFinite(screenAngle) && normalizeAngle(screenAngle) === 0 &&
        innerWidth > innerHeight) return normalizeAngle(legacyAngle);
    return normalizeAngle(Number.isFinite(screenAngle) ? screenAngle :
      (Number.isFinite(legacyAngle) ? legacyAngle : 0));
  }

  sensorAngle(event) {
    return screenTilt(event, this.angle(), this.axis);
  }

  resetTilt() {
    this.touchRoot?.classList.remove('zario-tilt-active');
    this.neutral = null;
    this.lastRaw = null;
    this.lastSampleTime = 0;
    this.steer = 0;
  }

  updateLabels() {
    this.invertButton.textContent = this.inverted ? '↔ FLIPPED' : '↔ FLIP';
    this.gripButton.textContent = this.gripMode === 'tight' ? 'GRIP: TIGHT' : 'GRIP: CLASSIC';
    this.axisButton.textContent = 'AXIS: ' + this.axis.toUpperCase();
  }

  applySteer(steer) {
    return clamp((this.inverted ? -1 : 1) * steer, -1, 1);
  }

  showSteer(steer) {
    this.statusButton.textContent = steer < -0.12 ? '◀ LEFT' : steer > 0.12 ? 'RIGHT ▶' : '◀  •  ▶';
  }

  readSensor(event) {
    const raw = this.sensorAngle(event);
    if (raw === null) return;
    this.lastRaw = raw;
    this.lastSampleTime = performance.now();
    if (!this.tiltEnabled) return;
    if (this.neutral === null) {
      this.neutral = raw;
      // Only hide the touch arrows after real sensor data is available.
      this.touchRoot?.classList.add('zario-tilt-active');
      return;
    }
    // Relative calibration removes dependence on how the player holds the phone.
    const target = tiltToSteer(raw, this.neutral);
    // Avoid slow steering tails: reactive input with a little sensor noise filtering.
    this.steer += 0.42 * (target - this.steer);
  }

  recenter() {
    this.neutral = this.lastRaw;
    this.steer = 0;
    if (this.tiltEnabled) this.toggle.textContent = 'GYRO ON ✓';
  }

  // Called synchronously from Start Race's click: iOS requires the permission
  // request inside the original trusted gesture, before any async work.
  enableTiltForRace() {
    if (this.tiltEnabled || this.userDisabledTilt || this.autoTiltAttempted) return;
    this.autoTiltAttempted = true;
    void this.toggleTilt({automatic: true});
  }

  async toggleTilt({automatic = false} = {}) {
    if (automatic && this.userDisabledTilt) return false;
    if (this.tiltEnabled && !automatic) {
      this.tiltEnabled = false;
      this.userDisabledTilt = true;
      this.steer = 0;
      this.neutral = null;
      this.toggle.textContent = 'GYRO OFF';
      this.recenterButton.hidden = true;
      this.axisButton.hidden = true;
      this.touchRoot?.classList.remove('zario-tilt-active');
      try { localStorage.setItem('zario.tilt.choice.v2', 'off'); } catch {}
      return false;
    }
    try {
      if (typeof DeviceOrientationEvent === 'undefined') throw new Error('No motion sensors');
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') throw new Error('Motion permission denied');
      }
      this.tiltEnabled = true;
      this.userDisabledTilt = false;
      this.neutral = null;
      this.steer = 0;
      this.toggle.textContent = 'GYRO ON ✓';
      this.recenterButton.hidden = false;
      this.axisButton.hidden = false;
      this.touchRoot?.classList.remove('zario-tilt-active');
      try { localStorage.setItem('zario.tilt.choice.v2', 'on'); } catch {}
      return true;
    } catch (err) {
      console.info('[Zario Kart] tilt unavailable, D-pad remains active:', err?.message || err);
      this.toggle.textContent = 'GYRO UNAVAILABLE';
      this.touchRoot?.classList.remove('zario-tilt-active');
      this.tiltEnabled = false;
      this.userDisabledTilt = true;
      this.steer = 0;
      // Remember denial so changing tracks never causes another popup.
      try { localStorage.setItem('zario.tilt.choice.v2', 'off'); } catch {}
      return false;
    }
  }

  updatePadLabel() {
    this.gamepadActive = this.findPad() !== null;
  }

  findPad() {
    try { return [...(navigator.getGamepads?.() || [])].find(p => p?.connected && p.mapping === 'standard') || null; }
    catch { return null; }
  }

  pollGamepad() {
    const pad = this.findPad();
    this.gamepadActive = !!pad;
    if (!pad) {
      if (this.lastItem) this.onItemUp();
      this.lastItem = false;
      this.lastPause = false;
      return null;
    }
    const pressed = (index) => (pad.buttons[index]?.value || 0) > 0.4;
    const item = pressed(1) || pressed(2);
    const pause = pressed(9);
    if (item && !this.lastItem) this.onItemDown();
    if (!item && this.lastItem) this.onItemUp();
    if (pause && !this.lastPause) this.onPause();
    this.lastItem = item;
    this.lastPause = pause;
    let steer = clamp(Number(pad.axes?.[0]) || 0, -1, 1);
    if (Math.abs(steer) < 0.12) steer = 0;
    else steer = Math.sign(steer) * (Math.abs(steer) - 0.12) / 0.88;
    return {
      steer,
      throttle: clamp(Number(pad.buttons[7]?.value) || (pressed(3) ? 1 : 0), 0, 1),
      brake: pressed(6),
      drift: pressed(4) || pressed(5) || pressed(0),
    };
  }

  getSteer() {
    // Safari pauses sensor events when switching orientation / entering menus.
    // If motion data is stale, immediately restore the touch buttons.
    if (!this.tiltEnabled || !this.lastSampleTime ||
        performance.now() - this.lastSampleTime > 650) {
      this.steer = 0;
      this.touchRoot?.classList.remove('zario-tilt-active');
      return null;
    }
    this.touchRoot?.classList.add('zario-tilt-active');
    return this.steer;
  }

  status() {
    return {
      control: this.gamepadActive ? 'gamepad' : this.tiltEnabled ? 'tilt' : isTouch() ? 'touch' : 'keyboard',
      tiltEnabled: this.tiltEnabled,
      sensorAgeMs: this.lastSampleTime ? Math.round(performance.now() - this.lastSampleTime) : null,
      neutral: this.neutral,
      tiltSteer: +this.steer.toFixed(3),
      inverted: this.inverted,
      axis: this.axis,
      angle: this.angle(),
      handling: this.gripMode,
      gamepadConnected: this.gamepadActive,
    };
  }
}
