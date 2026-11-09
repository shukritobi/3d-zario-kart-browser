/**
 * Conservative iOS resolution governor. Never changes simulation physics.
 * Changes the device pixel ratio only after sustained bad (or good) frame
 * pacing and an 8s cooldown. Manual ?quality overrides retain control.
 */
export class PerformanceGovernor {
  constructor({ initial = 1.4, min = 0.85, max = initial, enabled = true } = {}) {
    this.min = min;
    this.max = max;
    this.scale = Math.max(min, Math.min(max, initial));
    this.enabled = enabled;
    this.elapsed = 0;
    this.slow = 0;
    this.fast = 0;
    this.cooldown = 0;
    this.changes = 0;
  }
  reset() {
    this.elapsed = 0;
    this.slow = 0;
    this.fast = 0;
    this.cooldown = 8;
  }
  update(frameMs, dt, racing = true) {
    if (!this.enabled || !racing || !Number.isFinite(frameMs) ||
        !(dt > 0 && dt < 0.2)) return null;
    this.elapsed += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (frameMs >= 27) {
      this.slow += dt;
      this.fast = Math.max(0, this.fast - 2 * dt);
    } else if (frameMs <= 17.5) {
      this.fast += dt;
      this.slow = Math.max(0, this.slow - 2 * dt);
    } else {
      this.slow = Math.max(0, this.slow - dt);
      this.fast = Math.max(0, this.fast - dt);
    }
    if (this.elapsed < 12 || this.cooldown > 0) return null;
    let next = this.scale;
    if (this.slow >= 5) next = Math.max(this.min, this.scale - 0.15);
    else if (this.fast >= 24) next = Math.min(this.max, this.scale + 0.08);
    next = Math.round(next * 100) / 100;
    if (next === this.scale) return null;
    this.scale = next;
    this.changes++;
    this.cooldown = 10;
    this.slow = 0;
    this.fast = 0;
    return this.scale;
  }
  status() {
    return {enabled:this.enabled, dpr:this.scale, changes:this.changes,
      slowSeconds:+this.slow.toFixed(1), fastSeconds:+this.fast.toFixed(1)};
  }
}
