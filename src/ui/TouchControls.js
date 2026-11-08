/**
 * Zario Kart — mobile touch controls overlay.
 *
 * Pure DOM, appended to document.body, hidden by default.
 * Large left/right steer buttons plus an item button. Only shows on
 * touch devices (coarse pointer or narrow viewport). Pointer events
 * with `touch-action: none` — the page never scrolls or zooms from them.
 */
import './ui.css';

export class TouchControls {
  /**
   * @param {object} opts
   * @param {(v: number) => void} [opts.onSteer] called with -1 | 0 | +1
   * @param {() => void} [opts.onItem]          called when the item button is pressed
   * @param {() => void} [opts.onPause]         called when the pause button is pressed
   * @param {(b: boolean) => void} [opts.onDrift] called on drift button hold/release
   */
  constructor({ onSteer, onItem, onPause, onDrift } = {}) {
    this.onSteer = typeof onSteer === 'function' ? onSteer : () => {};
    this.onItem = typeof onItem === 'function' ? onItem : () => {};
    this.onPause = typeof onPause === 'function' ? onPause : () => {};
    this.onDrift = typeof onDrift === 'function' ? onDrift : () => {};
    this.steerValue = 0;
    // D3 AUDIO/HAPTIC AUDIT (2026-08-20): mobile haptic feedback was absent
    // entirely (navigator.vibrate never called). The game is fully playable
    // on touch, so gameplay events must pulse the device. `haptic(pattern)`
    // is a safe no-op when the API is missing (desktop, iOS Safari). Patterns
    // are short and event-specific: tap on steer edge, pulse on drift, kick
    // on boost/hit (MK8-style controller rumble surrogate).
    this.haptic = (pattern) => {
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(pattern);
        }
      } catch { /* vibrate unsupported / blocked — silent */ }
    };
    this._steerPressed = { left: false, right: false };

    this.root = document.createElement('div');
    this.root.className = 'sk3d-touch sk3d-hidden';
    this.root.innerHTML = `
      <button type="button" class="sk3d-touch-btn sk3d-touch-left" aria-label="Steer left"><span class="sk3d-touch-arrow">◀</span><span class="sk3d-touch-label">LEFT</span></button>
      <button type="button" class="sk3d-touch-btn sk3d-touch-right" aria-label="Steer right"><span class="sk3d-touch-arrow">▶</span><span class="sk3d-touch-label">RIGHT</span></button>
      <button type="button" class="sk3d-touch-btn sk3d-touch-drift" aria-label="Drift (hold)"><span class="sk3d-touch-arrow">🧲</span><span class="sk3d-touch-label">DRIFT</span></button>
      <button type="button" class="sk3d-touch-btn sk3d-touch-item" aria-label="Use item"><span class="sk3d-touch-arrow">🎁</span><span class="sk3d-touch-label">ITEM</span></button>
      <button type="button" class="sk3d-touch-pause" aria-label="Pause"><span>⏸</span></button>`;

    this.leftBtn = this.root.querySelector('.sk3d-touch-left');
    this.rightBtn = this.root.querySelector('.sk3d-touch-right');
    this.driftBtn = this.root.querySelector('.sk3d-touch-drift');
    this.itemBtn = this.root.querySelector('.sk3d-touch-item');
    this.pauseBtn = this.root.querySelector('.sk3d-touch-pause');
    let pausePointerAt = -Infinity;
    let pauseTriggeredAt = -Infinity;
    const triggerPause = () => {
      const now = performance.now();
      if (now - pauseTriggeredAt < 400) return;
      pauseTriggeredAt = now;
      this.onPause();
    };
    this.pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pausePointerAt = performance.now();
    });
    this.pauseBtn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      if (performance.now() - pausePointerAt < 800) triggerPause();
      pausePointerAt = -Infinity;
    });
    this.pauseBtn.addEventListener('pointercancel', () => { pausePointerAt = -Infinity; });
    this.pauseBtn.addEventListener('lostpointercapture', () => { pausePointerAt = -Infinity; });
    this.pauseBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      triggerPause();
    }, { passive: false });
    this.pauseBtn.addEventListener('click', triggerPause);
    // Drift is hold-to-drift: press = drift on, release = drift off.
    const setDrift = (b) => (e) => { e.preventDefault(); if (e.pointerId && e.target?.setPointerCapture) { try { if (b) e.target.setPointerCapture(e.pointerId); else if (e.target.hasPointerCapture?.(e.pointerId)) e.target.releasePointerCapture(e.pointerId); } catch {} } this.onDrift(b); if (b) this.haptic(18); };
    this.driftBtn.addEventListener('pointerdown', setDrift(true));
    this.driftBtn.addEventListener('pointerup', setDrift(false));
    this.driftBtn.addEventListener('pointercancel', setDrift(false));
    this.driftBtn.addEventListener('lostpointercapture', () => this.onDrift(false));

    this.bindSteer(this.leftBtn, -1);
    this.bindSteer(this.rightBtn, 1);
    this.bindItem(this.itemBtn);

    document.body.appendChild(this.root);
  }

  /** @returns {boolean} true when the device likely needs touch controls. */
  isTouchDevice() {
    return (
      (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
    );
  }

  /** Show only on touch devices (no-op on desktop). */
  show() {
    this.root.classList.toggle('sk3d-hidden', !this.isTouchDevice());
  }

  /** Programmatic haptic pulse for gameplay events (boost/hit/etc).
   *  @param {string} event one of: boost, hit, miniBoost, wrongWay, land */
  pulse(event) {
    switch (event) {
      case 'boost': this.haptic([0, 30, 20, 40]); break;
      case 'hit': this.haptic([0, 60, 30, 60]); break;
      case 'miniBoost': this.haptic(20); break;
      case 'wrongWay': this.haptic([0, 40, 40, 40]); break;
      case 'land': this.haptic(12); break;
      default: this.haptic(15);
    }
  }

  hide() {
    this.root.classList.add('sk3d-hidden');
  }

  bindSteer(button, value) {
    const side = value < 0 ? 'left' : 'right';
    const update = () => {
      const next = this._steerPressed.left === this._steerPressed.right
        ? 0
        : this._steerPressed.left ? -1 : 1;
      if (this.steerValue === next) return;
      this.steerValue = next;
      this.onSteer(next);
    };

    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (button.setPointerCapture) {
        try { button.setPointerCapture(e.pointerId); } catch { /* pointer already ended */ }
      }
      this._steerPressed[side] = true;
      button.classList.add('is-active');
      this.haptic(10); // steer edge tap
      update();
    });
    const release = () => {
      this._steerPressed[side] = false;
      button.classList.remove('is-active');
      update();
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', release);
    button.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  resetInput() {
    this._steerPressed.left = false;
    this._steerPressed.right = false;
    this.steerValue = 0;
    this.leftBtn.classList.remove('is-active');
    this.rightBtn.classList.remove('is-active');
    this.driftBtn.classList.remove('is-active');
    this.itemBtn.classList.remove('is-active');
    this.onSteer(0);
    this.onDrift(false);
  }

  bindItem(button) {
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (e.pointerId && button.setPointerCapture) try { button.setPointerCapture(e.pointerId); } catch {}
      button.classList.add('is-active');
      this.haptic(25); // item use
      this.onItem();
    });
    const clear = (e) => {
      if (e?.pointerId && button.hasPointerCapture?.(e.pointerId)) try { button.releasePointerCapture(e.pointerId); } catch {}
      button.classList.remove('is-active');
    };
    button.addEventListener('pointerup', clear);
    button.addEventListener('pointercancel', clear);
    button.addEventListener('lostpointercapture', clear);
    button.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
