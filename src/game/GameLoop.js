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
    // Limit ProMotion devices to 60 rendered frames/sec to reduce heat and battery use.
    // Physics delta uses time between simulated frames, not between raw rAF callbacks.
    this.mobile = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.minFrameMs = this.mobile ? 15 : 0;
    this.frameAverageMs = 16.667;
    window.__zarioFrameStats = () => ({
      fps: Math.round(1000 / Math.max(1, this.frameAverageMs)),
      frameMs: +this.frameAverageMs.toFixed(2),
      capFps: this.mobile ? 60 : 'display',
    });
  }

  start(updateFn) {
    this.updateFn = updateFn;
    this.running = true;
    this.last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      // Background tabs shouldn't burn GPU or advance the race while hidden.
      if (document.hidden || (this.minFrameMs && now - this.last < this.minFrameMs)) {
        if (document.hidden) this.last = now;
        this.rafId = requestAnimationFrame(tick);
        return;
      }
      const raw = (now - this.last) / 1000;
      const frameMs = Math.max(0, now - this.last);
      this.frameAverageMs = this.frameAverageMs * 0.93 + frameMs * 0.07;
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
