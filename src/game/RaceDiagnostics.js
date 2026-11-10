/**
 * In-memory, opt-in exportable race flight recorder.
 * No network calls. Stores at most 2400 samples and 600 events, and records
 * once every 200ms rather than allocating heavy objects per physics step.
 */
import { zarioLogger, LogCategory } from './ZarioLogger.js';

const num = n => Number.isFinite(Number(n)) ? +Number(n).toFixed(3) : null;
export class RaceDiagnostics {
  constructor({sampleHz = 5, maxSamples = 2400, maxEvents = 600} = {}) {
    this.samplePeriod = 1 / sampleHz;
    this.maxSamples = maxSamples;
    this.maxEvents = maxEvents;
    this.reset();
  }
  reset(metadata = {}) {
    this.started = false;
    this.metadata = {...metadata};
    this.samples = [];
    this.events = [];
    this.counts = {wall:0, contact:0, rescue:0, jump:0, offRoad:0,
      slowFrame:0, pixelRatio:0, lap:0, rampLaunch:0, trick:0};
    this._clock = 0;
    this._sinceSample = 0;
    this._prev = null;
    this._prevOffRoad = false;
  }
  start(metadata = {}) {
    this.reset(metadata);
    this.started = true;
    this.event('race-start',{});
    zarioLogger.info(LogCategory.BOOT, 'RaceDiagnostics recorder started', metadata);
  }
  event(type, fields = {}) {
    if (!this.started) return;
    this.counts[type] = (this.counts[type] || 0) + 1;
    const cleanFields = Object.fromEntries(Object.entries(fields).filter(([,v]) =>
      typeof v === 'string' || typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    ).map(([k,v])=>[k,typeof v==='number'?num(v):v]));
    this.events.push({sec:num(this._clock),type,...cleanFields});
    if (this.events.length > this.maxEvents) this.events.shift();
    if (type === 'rampLaunch') {
      zarioLogger.recordRampLaunch('player', cleanFields);
    } else if (type === 'trick') {
      zarioLogger.recordTrick('player', cleanFields);
    }
  }
  tick({dt, player, frameMs, audioState, pixelRatio, calls} = {}) {
    if (!this.started || !player || !Number.isFinite(dt) || dt <= 0) return;
    this._clock += dt;
    const s = player.state;
    if (!s?.position) return;
    const p = s.position;
    if (s.offRoad && !this._prevOffRoad) this.event('offRoad',{progress:s.progress01});
    this._prevOffRoad = !!s.offRoad;
    if (this._prev) {
      const jump = Math.hypot(p.x - this._prev.x, p.z - this._prev.z);
      const threshold = Math.max(3, Math.abs(s.speed || 0) * dt * 2.3 + 1.5);
      if (jump > threshold && dt < 0.06) this.event('position-jump',{
        metres:jump,limit:threshold,x:p.x,z:p.z,progress:s.progress01,
      });
    }
    this._prev = {x:p.x,z:p.z};
    if (Number.isFinite(frameMs) && frameMs > 38) {
      this.counts.slowFrame++;
    }
    this._sinceSample += dt;
    if (this._sinceSample < this.samplePeriod) return;
    this._sinceSample = 0;
    this.samples.push({
      t:num(this._clock),x:num(p.x),y:num(p.y),z:num(p.z),
      heading:num(s.heading),speed:num(s.speed),
      lateral:num(player._latVel || 0),steer:num(player._controls?.steer || 0),
      lap:s.lap,progress:num(s.progress01),
      offRoad:!!s.offRoad,drifting:!!s.drifting,airborne:player._airTime>0.05,
      frameMs:num(frameMs),audio:audioState||'unknown',
      dpr:num(pixelRatio),calls:Math.round(calls||0),
    });
    if(this.samples.length > this.maxSamples)this.samples.shift();
  }
  snapshot() {
    return {
      schema:'zario-phase1-v1',
      metadata:{...this.metadata},seconds:num(this._clock),
      counts:{...this.counts},
      samples:this.samples.map(x=>({...x})),
      events:this.events.map(x=>({...x})),
    };
  }
  exportJSON() { return JSON.stringify(this.snapshot(),null,2); }
}
