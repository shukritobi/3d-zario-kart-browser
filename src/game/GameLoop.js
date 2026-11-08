/**
 * Super Kart 3D.js — requestAnimationFrame loop with clamped delta.
 * Headless/software WebGL can run at ~1-2 fps; the dt clamp keeps
 * physics stable (slow motion instead of explosion) — same pattern
 * validated in Match-3D.js.
 */
export class GameLoop {
  constructor() {
    this.running = false;
    this.rafId = 0;
    this.last = 0;
    this.updateFn = null;
    this.elapsed = 0;
  }

  start(updateFn) {
    this.updateFn = updateFn;
    this.running = true;
    this.last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const raw = (now - this.last) / 1000;
      this.last = now;
      // AUDIT (Jarvis QA loop 2026-08-11): the first rAF timestamp can be
      // EARLIER than the performance.now() captured in start() (the frame
      // was scheduled before start ran) — raw goes negative, dt negative,
      // and countdownT += dt started the race countdown at -0.5s, which made
      // COUNTDOWN_MARKS[negativeIdx] = undefined render as a giant "undefined"
      // countdown overlay. Clamp dt to >= 0.
      const dt = Math.max(0, Math.min(raw, 0.05));
      this.elapsed += dt;
      this.updateFn(dt, this.elapsed);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
