/* Zario Kart original mobile input adapter. Preserves the upstream MIT engine. */
import './zario-controls.css';

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
    this.steer = 0;
    this.neutral = null;
    this.lastRaw = null;
    this.lastSampleTime = 0;
    this.inverted = false;
    this.gamepadActive = false;
    this.lastItem = false;
    this.lastPause = false;
    this.element = document.createElement('div');
    this.element.className = 'zario-controls';
    this.toggle = button('GYRO OFF', 'Enable tilt steering (requires motion permission)');
    this.recenterButton = button('RECENTER', 'Calibrate your comfortable steering position');
    this.invertButton = button('↔', 'Invert tilt steering direction');
    this.recenterButton.hidden = true;
    this.invertButton.hidden = true;
    this.element.append(this.toggle, this.recenterButton, this.invertButton);
    document.body.appendChild(this.element);

    this.hint = document.createElement('div');
    this.hint.className = 'zario-landscape-hint';
    this.hint.textContent = '↻ Rotate to landscape for the best racing view';
    document.body.appendChild(this.hint);

    this.toggle.addEventListener('click', () => this.toggleTilt());
    this.recenterButton.addEventListener('click', () => this.recenter());
    this.invertButton.addEventListener('click', () => {
      this.inverted = !this.inverted;
      this.invertButton.classList.toggle('active', this.inverted);
      this.recenter();
    });
    window.addEventListener('deviceorientation', (event) => this.readSensor(event), { passive: true });
    window.addEventListener('orientationchange', () => this.recenter());
    screen.orientation?.addEventListener?.('change', () => this.recenter());
    window.addEventListener('gamepadconnected', () => this.updatePadLabel());
    window.addEventListener('gamepaddisconnected', () => this.updatePadLabel());
    this.updatePadLabel();
  }

  angle() {
    const deg = Number(screen.orientation?.angle ?? window.orientation ?? 0);
    return ((deg % 360) + 360) % 360;
  }

  sensorAngle(event) {
    const a = this.angle();
    const raw = (a === 90 || a === 270) ? event.beta : event.gamma;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    return raw * (a === 90 ? -1 : 1);
  }

  readSensor(event) {
    const raw = this.sensorAngle(event);
    if (raw === null) return;
    this.lastRaw = raw;
    this.lastSampleTime = performance.now();
    if (!this.tiltEnabled) return;
    if (this.neutral === null) { this.neutral = raw; return; }
    // Relative calibration removes dependence on how the player holds the phone.
    const degrees = ((raw - this.neutral + 540) % 360) - 180;
    const magnitude = Math.max(0, Math.abs(degrees) - 3) / 24;
    const target = clamp(Math.sign(degrees) * magnitude * (this.inverted ? -1 : 1), -1, 1);
    this.steer += 0.28 * (target - this.steer);
  }

  recenter() {
    this.neutral = this.lastRaw;
    this.steer = 0;
    if (this.tiltEnabled) this.toggle.textContent = 'GYRO ON ✓';
  }

  async toggleTilt() {
    if (this.tiltEnabled) {
      this.tiltEnabled = false;
      this.steer = 0;
      this.neutral = null;
      this.toggle.textContent = 'GYRO OFF';
      this.recenterButton.hidden = true;
      this.invertButton.hidden = true;
      this.touchRoot?.classList.remove('zario-tilt-active');
      return;
    }
    try {
      if (typeof DeviceOrientationEvent === 'undefined') throw new Error('No motion sensors');
      // On iOS, requestPermission MUST be reached from this button's click.
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') throw new Error('Motion permission denied');
      }
      this.tiltEnabled = true;
      this.neutral = null;
      this.steer = 0;
      this.toggle.textContent = 'GYRO ON ✓';
      this.recenterButton.hidden = false;
      this.invertButton.hidden = false;
      this.touchRoot?.classList.add('zario-tilt-active');
    } catch (err) {
      console.info('[Zario Kart] tilt unavailable, touch remains active:', err?.message || err);
      this.toggle.textContent = 'GYRO DENIED';
      this.touchRoot?.classList.remove('zario-tilt-active');
      this.tiltEnabled = false;
      this.steer = 0;
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
    // Don't lock the kart into a turn if Safari suspends motion events.
    return this.tiltEnabled && this.lastSampleTime && performance.now() - this.lastSampleTime < 1200 ? this.steer : 0;
  }

  status() {
    return {
      control: this.gamepadActive ? 'gamepad' : this.tiltEnabled ? 'tilt' : isTouch() ? 'touch' : 'keyboard',
      tiltEnabled: this.tiltEnabled,
      sensorAgeMs: this.lastSampleTime ? Math.round(performance.now() - this.lastSampleTime) : null,
      neutral: this.neutral,
      tiltSteer: +this.steer.toFixed(3),
      inverted: this.inverted,
      gamepadConnected: this.gamepadActive,
    };
  }
}
