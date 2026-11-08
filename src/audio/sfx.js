// ============================================================
// Super Kart 3D.js — sfx.js
// Pure procedural SFX recipes (fat modern arcade racing theme), 100%
// synthesized with the WebAudio API — no samples, no assets.
//
// Palette (FECO r2 pass): every beep-type SFX was rebuilt from raw
// chiptune tones into layered, filtered, punchy hits — sub-kick thumps,
// noise bursts with filter sweeps, lowpassed square bodies, sparkle
// layers. The AudioManager master chain (EQ → saturation → glue
// compressor → makeup → limiter, with a shared convolver reverb send)
// seats them all in one fat arcade space.
//
// Contract (ARCHITECTURE.md):
//   renderSfx(ctx, out, name, opts)
//     ctx  — ANY BaseAudioContext (AudioContext in the game,
//            OfflineAudioContext for QA rendering).
//     out  — destination AudioNode (master chain or ctx.destination).
//     name — one of the SFX names below.
//     opts — { volume=1, rate=1, pan=0, at=0, ... } plus per-recipe
//            extras (speed01, dur).
//
// The recipes are pure: no DOM, no global state. The WAV dumped by
// scripts/render-sfx.mjs therefore IS the sound the game plays.
//
// Pitfalls baked in (validated in the match-3djs project):
//   - Long tails use setTargetAtTime(0.0001, t, timeConstant)
//     instead of exponentialRampToValueAtTime (decays too fast).
//   - Noise buffers are DC-blocked (mean subtracted) to avoid pops.
//   - Oscillator frequencies are clamped to >= 30 Hz.
// ============================================================

// Note frequencies (Hz). C4 = 261.63.
const N = {
  C4: 261.63, E4: 329.63, G4: 392.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760.0,
  C7: 2093.0, D7: 2349.32,
};

// Pentatonic pool for sparkle/shine runs.
const SFX_PENTA = [N.C5, N.D5, N.E5, N.G5, N.A5, N.C6, N.D6, N.E6];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Deterministic noise keeps OfflineAudioContext renders reproducible while
// preserving the same broadband texture in live playback. Audio variation is
// supplied by pitch/pan/event timing, never by an unseeded global RNG.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------
// Engine gear map (audit r2): a continuous 55→205Hz RPM sweep reads as
// a synth drone, not a kart. Piecewise gears with OVERLAPPING ranges
// (hysteresis): at the shift boundary the new gear always starts BELOW
// the old gear's redline, so the pitch audibly DROPS on upshift, then
// climbs again. `load` is the throttle proxy (speed01); `local` is the
// position inside the current gear (0 right after shift → 1 redline).
// Shared by the live engine loop (AudioManager) and the QA 'engine'
// recipe so both always agree.
// ------------------------------------------------------------
const ENGINE_GEARS = [
  { lo: 0.0,  hi: 0.28, base: 58,  redline: 150 },
  { lo: 0.22, hi: 0.52, base: 92,  redline: 175 },
  { lo: 0.48, hi: 0.78, base: 128, redline: 195 },
  { lo: 0.74, hi: 1.0,  base: 164, redline: 205 },
];

/**
 * Piecewise gear map: speed01 (0 idle … 1 full) → engine state.
 * @param {number} speed01
 * @returns {{gear:number, rpm:number, local:number, load:number, ratio:number}}
 */
export function engineGear(speed01) {
  const s = clamp(speed01, 0, 1);
  let gear = 0;
  for (let g = 1; g < ENGINE_GEARS.length; g++) {
    if (s >= ENGINE_GEARS[g].lo) gear = g;
  }
  const gd = ENGINE_GEARS[gear];
  const span = Math.max(1e-6, gd.hi - gd.lo);
  const local = clamp((s - gd.lo) / span, 0, 1);
  const rpm = gd.base + local * (gd.redline - gd.base);
  const lo = ENGINE_GEARS[0].base;
  const hi = ENGINE_GEARS[ENGINE_GEARS.length - 1].redline;
  return {
    gear,
    rpm,
    local,
    load: s, // throttle proxy — 0 coasting, 1 full throttle
    ratio: clamp((rpm - lo) / (hi - lo), 0, 1),
  };
}

/* ---------------- Shared helpers ---------------- */

// One cached 2s white-noise buffer per context (DC-blocked).
// BufferSources are stopped early, so a single buffer serves
// every requested duration.
const _noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let buf = _noiseCache.get(ctx);
  if (!buf) {
    const len = Math.max(1, Math.ceil(ctx.sampleRate * 2));
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let sum = 0;
    const rng = mulberry32((ctx.sampleRate ^ len ^ 0x534658) | 0);
    for (let i = 0; i < len; i++) {
      data[i] = rng() * 2 - 1;
      sum += data[i];
    }
    const mean = sum / len;
    if (Math.abs(mean) > 1e-7) {
      for (let i = 0; i < len; i++) data[i] -= mean;
    }
    _noiseCache.set(ctx, buf);
  }
  return buf;
}

/**
 * Generic gain envelope: attack, then either a long setTargetAtTime
 * tail (timeConstant), a held sustain + release, or a plain decay.
 */
function env(gain, { at, peak, attack = 0.004, timeConstant = null, dur = null, sustain = false, release = 0.05 }) {
  const p = clamp(Math.max(0.0001, peak), 0.0001, 1);
  const a = Math.max(0.002, attack);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(p, at + a);
  if (timeConstant != null) {
    gain.gain.setTargetAtTime(0.0001, at + a, timeConstant);
  } else if (sustain && dur != null) {
    gain.gain.setValueAtTime(p, Math.max(at + a, at + dur - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  } else if (dur != null) {
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  }
}

/**
 * Oscillator + envelope + optional filter / frequency glide / LFO.
 * `timeConstant` gives a long natural tail (bells), `sustain` holds
 * the peak until `dur - release` (loops, horns), otherwise the gain
 * decays exponentially across `dur`.
 */
function osc(ctx, out, {
  type = 'sine', freq = 440, glideTo = null, dur = 0.1, vol = 0.2,
  at = 0, attack = 0.004, timeConstant = null, sustain = false, release = 0.05,
  filterType = null, filterFreq = null, filterQ = 1, filterGlideTo = null,
  lfoFreq = null, lfoDepth = 0,
}) {
  const oscNode = ctx.createOscillator();
  const gain = ctx.createGain();

  oscNode.type = type;
  oscNode.frequency.setValueAtTime(Math.max(1, freq), at);
  if (glideTo !== null && glideTo > 0) {
    oscNode.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), at + Math.max(0.02, dur));
  }
  if (lfoFreq != null && lfoFreq > 0) {
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = lfoFreq;
    lfoGain.gain.value = lfoDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(oscNode.frequency);
    lfo.start(at);
    lfo.stop(at + dur + 0.1);
  }

  let node = oscNode;
  if (filterType) {
    const flt = ctx.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.setValueAtTime(Math.max(20, filterFreq ?? freq * 2), at);
    if (filterGlideTo !== null && filterGlideTo > 0) {
      flt.frequency.exponentialRampToValueAtTime(Math.max(20, filterGlideTo), at + Math.max(0.02, dur));
    }
    flt.Q.value = filterQ;
    oscNode.connect(flt);
    node = flt;
  }

  if (timeConstant != null) {
    env(gain, { at, peak: vol, attack, timeConstant });
  } else if (sustain) {
    env(gain, { at, peak: vol, attack, dur, sustain: true, release });
  } else {
    env(gain, { at, peak: vol, attack, dur });
  }

  node.connect(gain);
  gain.connect(out);
  const tail = timeConstant != null ? Math.min(0.6, timeConstant * 4) : 0.06;
  oscNode.start(at);
  oscNode.stop(at + dur + tail);
}

/**
 * Filtered noise burst. Same envelope modes as `osc`; `glideTo` sweeps
 * the filter cutoff (whooshes).
 */
function noise(ctx, out, {
  dur = 0.1, vol = 0.2, at = 0, filterType = 'lowpass', freq = 800, q = 1,
  glideTo = null, attack = 0.003, timeConstant = null, sustain = false, release = 0.05,
}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const flt = ctx.createBiquadFilter();
  flt.type = filterType;
  flt.frequency.setValueAtTime(Math.max(20, freq), at);
  if (glideTo !== null && glideTo > 0) {
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), at + Math.max(0.02, dur));
  }
  flt.Q.value = q;
  const gain = ctx.createGain();
  if (timeConstant != null) {
    env(gain, { at, peak: vol, attack, timeConstant });
  } else if (sustain) {
    env(gain, { at, peak: vol, attack, dur, sustain: true, release });
  } else {
    env(gain, { at, peak: vol, attack, dur });
  }
  src.connect(flt);
  flt.connect(gain);
  gain.connect(out);
  const tail = timeConstant != null ? Math.min(0.6, timeConstant * 4) : 0.06;
  src.start(at);
  src.stop(at + dur + tail);
}

/**
 * Punchy sub kick — the modern arcade impact body (no samples):
 * a sine thump with a fast exponential pitch drop + a 2ms highpassed
 * noise "beater" click for attack. Used to fatten hits, pickups and
 * boost launches instead of raw beeps.
 */
function kick(ctx, out, { at = 0, vol = 0.6, freq = 140, glideTo = 40, dur = 0.22, click = 0.35 }) {
  osc(ctx, out, {
    type: 'sine', freq: Math.max(30, freq), glideTo: Math.max(30, glideTo),
    dur, vol, at, attack: 0.001,
  });
  noise(ctx, out, { dur: 0.012, vol: vol * click, at, filterType: 'highpass', freq: 6000 });
}

/**
 * Bell chime: fundamental + harmonic partials + a detuned pair for
 * shimmer. Uses setTargetAtTime tails (long natural decay).
 */
function chime(ctx, out, { freq = 523, dur = 0.3, vol = 0.3, at = 0, partials = [1, 2, 3, 4], timeConstant = null }) {
  const tc = timeConstant ?? dur * 0.22;
  const amps = { 1: 1.0, 2: 0.42, 3: 0.2, 4: 0.1, 5: 0.06, 6: 0.04 };
  // AUDIT R60 (auditoria som #1/10): 'star' C7×6 = 12.5kHz, 'itemPickup'
  // ×5 = 10.4kHz — partials acima de 8kHz reforçavam o brilho estridente.
  // Filtra os que passam de 8kHz; nunca deixa vazio.
  const usable = partials.filter((p) => freq * p <= 8000);
  if (!usable.length) usable.push(1);
  const ampScale = usable.length > 3 ? 1.25 : 1;
  for (const p of usable) {
    osc(ctx, out, {
      type: 'sine', freq: Math.max(30, freq * p), dur, vol: vol * (amps[p] ?? 0.2) / ampScale,
      at, attack: 0.003, timeConstant: tc,
    });
  }
  osc(ctx, out, { type: 'sine', freq: Math.max(30, freq * 1.003), dur: dur * 0.85, vol: vol * 0.16, at, attack: 0.003, timeConstant: tc * 0.8 });
  osc(ctx, out, { type: 'sine', freq: Math.max(30, freq * 0.997), dur: dur * 0.85, vol: vol * 0.16, at, attack: 0.003, timeConstant: tc * 0.8 });
}

/** Bright cartoon "horn" voice: sawtooth + square through lowpasses. */
function horn(ctx, out, at, freq, dur, vol = 0.5) {
  osc(ctx, out, { type: 'sawtooth', freq, dur, vol: vol * 0.8, at, attack: 0.008, sustain: true, release: 0.07, filterType: 'lowpass', filterFreq: 2300, filterQ: 0.7 });
  osc(ctx, out, { type: 'square', freq, dur, vol: vol * 0.35, at, attack: 0.008, sustain: true, release: 0.07, filterType: 'lowpass', filterFreq: 3400, filterQ: 0.7 });
}

/* ---------------- Recipes ---------------- */

/**
 * Render one SFX into `out`.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} out
 * @param {string} name engine|boost|drift|itemPickup|useItem|shell|redShell|
 *   banana|star|lightning|crash|countdown|go|lap|finalLap|cheer|finish|
 *   victory|uiClick|uiHover|musicIntro (alias: menuMusic)
 * @param {Object} [opts] { volume=1, rate=1, pan=0, at=0, speed01, dur }
 */
export function renderSfx(ctx, out, name, opts = {}) {
  if (!ctx || !out) return;
  const { volume = 1, rate = 1, pan = 0, at = 0 } = opts;
  const v = (x) => x * volume;

  // Optional stereo pan: route every voice through a panner.
  let target = out;
  if (typeof pan === 'number' && pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    panner.connect(out);
    target = panner;
  }

  switch (name) {
    case 'engine': {
      // Looping tone pair (sawtooth base + square octave + sine sub) used
      // by AudioManager.setEngineLoop; here rendered for QA. `speed01`
      // drives the piecewise GEAR MAP (audit r2): RPM climbs within a
      // gear and DROPS on upshift — the old continuous 55→205Hz sweep
      // read as a synth drone, not a kart gearbox. `dur` is the QA render
      // window. Matches AudioManager._updateEngineLoop exactly.
      const speed = clamp(opts.speed01 ?? 0.6, 0, 1);
      const d = Math.max(0.3, opts.dur ?? 2.0);
      const { rpm, local, load, ratio } = engineGear(speed);
      const lug = (1 - local) * load; // post-upshift strain (muffles top end)
      const cut = 300 + ratio * 1500 - lug * 250;
      const lvl = 0.28 + 0.64 * (0.7 * load + 0.3 * local);
      osc(ctx, target, {
        type: 'sawtooth', freq: rpm, dur: d, vol: v(lvl * 0.55), at, attack: 0.1, sustain: true, release: 0.08,
        filterType: 'lowpass', filterFreq: cut, filterQ: 0.8, lfoFreq: 24, lfoDepth: rpm * 0.012,
      });
      osc(ctx, target, {
        type: 'square', freq: rpm * 2, dur: d, vol: v(lvl * 0.22), at, attack: 0.1, sustain: true, release: 0.08,
        filterType: 'lowpass', filterFreq: cut * 1.4, filterQ: 1.2,
      });
      // Sub oscillator — matches the live engine loop (low-end body).
      osc(ctx, target, {
        type: 'sine', freq: rpm * 0.5, dur: d, vol: v(lvl * 0.5), at, attack: 0.1, sustain: true, release: 0.08,
      });
      noise(ctx, target, { dur: d, vol: v(lvl * 0.1), at, filterType: 'bandpass', freq: cut * 0.6, q: 0.5, attack: 0.1, sustain: true, release: 0.08 });
      break;
    }

    case 'boost': {
      // Turbo launch (modern arcade): kick thump + RISING noise whoosh
      // (bandpass sweep 300→3600) + a growling saw that rises in pitch
      // AND opens its lowpass (the flame body) + fire crackle + sub drop.
      const d = 1.0;
      kick(ctx, target, { at, vol: v(0.58), freq: 150, glideTo: 45, dur: 0.22 });
      noise(ctx, target, { dur: d, vol: v(0.38), at, filterType: 'bandpass', freq: 300, q: 1.1, glideTo: 3600, attack: 0.05, sustain: true, release: 0.12 });
      osc(ctx, target, {
        type: 'sawtooth', freq: 95 * rate, glideTo: 210 * rate, dur: d * 0.9, vol: v(0.36), at, attack: 0.02,
        filterType: 'lowpass', filterFreq: 400, filterQ: 1, filterGlideTo: 3200,
      });
      noise(ctx, target, { dur: d, vol: v(0.12), at: at + 0.06, filterType: 'highpass', freq: 5200, attack: 0.06, sustain: true, release: 0.08 });
      osc(ctx, target, { type: 'sine', freq: 120 * rate, glideTo: 40 * rate, dur: 0.3, vol: v(0.6), at, attack: 0.003 });
      break;
    }

    case 'drift': {
      // Tire screech: high-Q bandpass noise squeal with wobble LFO,
      // plus a low rumble and a bright chirp layer.
      const d = 0.85;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const flt = ctx.createBiquadFilter();
      flt.type = 'bandpass';
      flt.Q.value = 9;
      flt.frequency.setValueAtTime(950, at);
      flt.frequency.linearRampToValueAtTime(1550, at + d * 0.45);
      flt.frequency.exponentialRampToValueAtTime(1100, at + d * 0.95);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 21;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 160;
      lfo.connect(lfoG);
      lfoG.connect(flt.frequency);
      lfo.start(at);
      lfo.stop(at + d + 0.1);
      const g = ctx.createGain();
      env(g, { at, peak: v(0.3), attack: 0.04, dur: d, sustain: true, release: 0.1 });
      src.connect(flt);
      flt.connect(g);
      g.connect(target);
      src.start(at);
      src.stop(at + d + 0.1);
      noise(ctx, target, { dur: d, vol: v(0.26), at, filterType: 'lowpass', freq: 300, q: 0.8, attack: 0.03, sustain: true, release: 0.08 });
      noise(ctx, target, { dur: d * 0.7, vol: v(0.12), at: at + 0.1, filterType: 'bandpass', freq: 2400, q: 4, attack: 0.05, sustain: true, release: 0.07 });
      break;
    }

    case 'uiClick': {
      // Soft tactile click (no raw squares): a lowpassed triangle blip
      // through a gentle bandpass + a micro noise tick — feels like a
      // console menu, not a game-boy beep.
      osc(ctx, target, {
        type: 'triangle', freq: 520 * rate, glideTo: 760 * rate, dur: 0.06, vol: v(0.16), at, attack: 0.001,
        filterType: 'lowpass', filterFreq: 2400, filterQ: 0.8,
      });
      noise(ctx, target, { dur: 0.02, vol: v(0.05), at, filterType: 'bandpass', freq: 3200, q: 1.5 });
      break;
    }

    case 'uiSelect': {
      // Confirming two-tone for "Start Race" — soft lowpassed body tones
      // (no raw square) + a chime sparkle on top.
      osc(ctx, target, { type: 'triangle', freq: 523.25 * rate, dur: 0.09, vol: v(0.2), at, attack: 0.002, filterType: 'lowpass', filterFreq: 2600 });
      osc(ctx, target, { type: 'square', freq: 783.99 * rate, dur: 0.14, vol: v(0.12), at: at + 0.07, attack: 0.002, filterType: 'lowpass', filterFreq: 3200, filterQ: 1 });
      chime(ctx, target, { freq: 1046.5 * rate, dur: 0.3, vol: v(0.14), at: at + 0.12, partials: [1, 2, 3] });
      break;
    }

    case 'driftReleaseMiniBoost': {
      // Drift-release pop: kick tick + quick rising blip + tight whoosh
      // (bandpass noise sweep) + a sparkle on top — the arcade
      // "release the boost" feel, not a beep.
      kick(ctx, target, { at, vol: v(0.5), freq: 190, glideTo: 55, dur: 0.12 });
      osc(ctx, target, { type: 'triangle', freq: 320 * rate, glideTo: 1100 * rate, dur: 0.16, vol: v(0.28), at, attack: 0.002 });
      noise(ctx, target, { dur: 0.24, vol: v(0.22), at: at + 0.01, filterType: 'bandpass', freq: 1300, q: 1.2, glideTo: 3800, attack: 0.02, timeConstant: 0.08 });
      chime(ctx, target, { freq: 1568 * rate, dur: 0.25, vol: v(0.18), at: at + 0.06, partials: [1, 2, 3] });
      break;
    }

    case 'offroad': {
      // Gravel/grass rumble while the kart is on the shoulder.
      noise(ctx, target, { dur: 0.7, vol: v(0.16), at, filterType: 'bandpass', freq: 420, q: 1.1, attack: 0.05, sustain: true, release: 0.15 });
      noise(ctx, target, { dur: 0.55, vol: v(0.08), at: at + 0.02, filterType: 'highpass', freq: 3000, attack: 0.06, sustain: true, release: 0.1 });
      break;
    }

    case 'itemPickup': {
      // Item-box pickup: sub pop + bright chime arpeggio C6-E6-G6-C7 +
      // air shimmer. The pop gives it physical weight (layered pickup).
      kick(ctx, target, { at, vol: v(0.26), freq: 200, glideTo: 60, dur: 0.14 });
      osc(ctx, target, { type: 'sine', freq: 200 * rate, glideTo: 800 * rate, dur: 0.09, vol: v(0.26), at, attack: 0.002 });
      const notes = [N.C6, N.E6, N.G6, N.C7];
      let t = at;
      for (const n of notes) {
        chime(ctx, target, { freq: n * rate, dur: 0.24, vol: v(0.36), at: t, partials: [1, 2, 3, 4, 5] });
        t += 0.055;
      }
      noise(ctx, target, { dur: 0.45, vol: v(0.16), at: t, filterType: 'highpass', freq: 7500, timeConstant: 0.12 });
      break;
    }

    case 'useItem': {
      // Power-up equip: sub pop + bright upward blip + sparkle — reads
      // as a punchy item grab, not a game-boy beep.
      kick(ctx, target, { at, vol: v(0.35), freq: 220, glideTo: 70, dur: 0.1 });
      osc(ctx, target, { type: 'triangle', freq: 800 * rate, glideTo: 1500 * rate, dur: 0.12, vol: v(0.32), at, attack: 0.002 });
      osc(ctx, target, { type: 'sine', freq: 1800 * rate, dur: 0.06, vol: v(0.12), at: at + 0.02, attack: 0.002 });
      chime(ctx, target, { freq: 2093 * rate, dur: 0.18, vol: v(0.1), at: at + 0.05, partials: [1, 2, 3] });
      break;
    }

    case 'shell': {
      // Fast whoosh + whistling projectile.
      const d = 0.55;
      noise(ctx, target, { dur: d, vol: v(0.4), at, filterType: 'bandpass', freq: 380, q: 0.9, glideTo: 2600, attack: 0.04, sustain: true, release: 0.08 });
      osc(ctx, target, {
        type: 'sine', freq: 520 * rate, glideTo: 1250 * rate, dur: d, vol: v(0.22), at: at + 0.02,
        attack: 0.05, sustain: true, release: 0.07, lfoFreq: 20, lfoDepth: 12,
      });
      break;
    }

    case 'redShell': {
      // Angrier whoosh: growling saw + fast noise sweep + warble.
      const d = 0.5;
      osc(ctx, target, {
        type: 'sawtooth', freq: 240 * rate, glideTo: 100 * rate, dur: d, vol: v(0.4), at, attack: 0.005,
        filterType: 'lowpass', filterFreq: 1100, filterQ: 0.8, filterGlideTo: 450,
      });
      noise(ctx, target, { dur: d, vol: v(0.35), at, filterType: 'bandpass', freq: 260, q: 1, glideTo: 2100, attack: 0.02, sustain: true, release: 0.06 });
      osc(ctx, target, { type: 'square', freq: 800 * rate, glideTo: 1400 * rate, dur: 0.22, vol: v(0.15), at: at + 0.03, attack: 0.003, filterType: 'highpass', filterFreq: 2000 });
      break;
    }

    case 'banana': {
      // Slip-slap: filtered noise impact sweep + springy boing on a fat
      // sine body + a high "slip!" blip. Keeps the cartoon spring but
      // the slap gives it physical weight.
      noise(ctx, target, { dur: 0.09, vol: v(0.4), at, filterType: 'bandpass', freq: 1500, q: 1.4, glideTo: 320, attack: 0.001, timeConstant: 0.05 });
      const f0 = 235 * rate;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(Math.max(30, f0), at);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f0 * 0.4), at + 0.06);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f0 * 0.85), at + 0.13);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f0 * 0.52), at + 0.22);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f0 * 0.72), at + 0.32);
      const g = ctx.createGain();
      env(g, { at, peak: v(0.45), attack: 0.004, timeConstant: 0.18 });
      o.connect(g);
      g.connect(target);
      o.start(at);
      o.stop(at + 0.6);
      osc(ctx, target, { type: 'sine', freq: Math.max(30, f0 * 0.5), glideTo: Math.max(30, f0 * 0.25), dur: 0.3, vol: v(0.35), at, attack: 0.002, timeConstant: 0.15 });
      osc(ctx, target, { type: 'sine', freq: 1700 * rate, dur: 0.05, vol: v(0.16), at: at + 0.01, attack: 0.002 });
      break;
    }

    case 'star': {
      // Magical shimmer arpeggio up + sparkle chord + air.
      const notes = [N.C6, N.D6, N.E6, N.G6, N.A6, N.C7];
      let t = at;
      for (const n of notes) {
        chime(ctx, target, { freq: n * rate, dur: 0.5, vol: v(0.35), at: t, partials: [1, 2, 3, 4, 5] });
        t += 0.06;
      }
      noise(ctx, target, { dur: 0.7, vol: v(0.12), at: at + 0.1, filterType: 'highpass', freq: 9000, timeConstant: 0.15 });
      chime(ctx, target, { freq: N.C7 * rate, dur: 0.7, vol: v(0.25), at: t, partials: [1, 2, 3, 4, 5, 6] });
      break;
    }

    case 'lightning': {
      // Electric zap (pitch drop) + crackle bursts + fading rumble.
      osc(ctx, target, {
        type: 'sawtooth', freq: 2600 * rate, glideTo: 160 * rate, dur: 0.2, vol: v(0.5), at, attack: 0.001,
        filterType: 'highpass', filterFreq: 400,
      });
      osc(ctx, target, {
        type: 'square', freq: 1500 * rate, glideTo: 120 * rate, dur: 0.24, vol: v(0.28), at: at + 0.01, attack: 0.001,
        filterType: 'highpass', filterFreq: 600,
      });
      const crack = [0.22, 0.3, 0.37, 0.46, 0.55, 0.64];
      for (const off of crack) {
        noise(ctx, target, { dur: 0.03, vol: v(0.25), at: at + off, filterType: 'bandpass', freq: 3200, q: 2.5 });
      }
      osc(ctx, target, { type: 'sine', freq: 90 * rate, glideTo: 40 * rate, dur: 0.35, vol: v(0.3), at: at + 0.15, attack: 0.005 });
      break;
    }

    case 'crash': {
      // FAT impact (arcade, not 8-bit): sub kick body (sine 120→38Hz) +
      // lowpassed noise burst with a pitch-drop sweep + a metallic clank
      // (bandpassed square gliding down) + a fast shard-hiss layer.
      kick(ctx, target, { at, vol: v(0.65), freq: 120, glideTo: 38, dur: 0.3 });
      noise(ctx, target, {
        dur: 0.42, vol: v(0.43), at, filterType: 'lowpass', freq: 6000, q: 0.6, // QA: dry peak headroom
        glideTo: 160, attack: 0.001, timeConstant: 0.14,
      });
      osc(ctx, target, {
        type: 'square', freq: 920 * rate, glideTo: 300 * rate, dur: 0.16, vol: v(0.22), at: at + 0.004, attack: 0.001,
        filterType: 'bandpass', filterFreq: 1500, filterQ: 2.2, filterGlideTo: 450,
      });
      noise(ctx, target, { dur: 0.2, vol: v(0.16), at: at + 0.01, filterType: 'bandpass', freq: 3200, q: 2, glideTo: 900, attack: 0.002, timeConstant: 0.05 });
      break;
    }

    case 'driftReady': {
      // Distinct rising chime when the drift charge hits the release point
      // (audit v5 F5: was reusing the overtake blip — same sound, two events).
      // Now with a soft noise tick for presence.
      osc(ctx, target, { type: 'sine', freq: 660 * rate, glideTo: 990 * rate, dur: 0.09, vol: v(0.3), at, attack: 0.002 });
      osc(ctx, target, { type: 'sine', freq: 1320 * rate, dur: 0.06, vol: v(0.12), at: at + 0.05, attack: 0.002 });
      noise(ctx, target, { dur: 0.03, vol: v(0.05), at, filterType: 'highpass', freq: 5500 });
      break;
    }

    case 'posDown': {
      // Descending two-tone (lost a place): triangle lead + lowpassed
      // square body for weight (not a raw square — filtered and fat).
      osc(ctx, target, { type: 'triangle', freq: 520 * rate, glideTo: 300 * rate, dur: 0.14, vol: v(0.26), at, attack: 0.003 });
      osc(ctx, target, { type: 'square', freq: 520 * rate, glideTo: 300 * rate, dur: 0.14, vol: v(0.14), at, attack: 0.003, filterType: 'lowpass', filterFreq: 1800 });
      osc(ctx, target, { type: 'sine', freq: 300 * rate, glideTo: 180 * rate, dur: 0.14, vol: v(0.26), at: at + 0.1, attack: 0.003 });
      break;
    }

    case 'posUp': {
      // Ascending two-tone (overtook someone): triangle lead + lowpassed
      // square body for weight + sine tail.
      osc(ctx, target, { type: 'triangle', freq: 380 * rate, glideTo: 560 * rate, dur: 0.12, vol: v(0.26), at, attack: 0.003 });
      osc(ctx, target, { type: 'square', freq: 380 * rate, glideTo: 560 * rate, dur: 0.12, vol: v(0.14), at, attack: 0.003, filterType: 'lowpass', filterFreq: 1800 });
      osc(ctx, target, { type: 'sine', freq: 620 * rate, glideTo: 820 * rate, dur: 0.14, vol: v(0.26), at: at + 0.08, attack: 0.003 });
      break;
    }

    case 'landing': {
      // Touchdown (audit UX-F3): sub thump + filtered noise puff — a
      // grounded impact, not a beep.
      kick(ctx, target, { at, vol: v(0.5), freq: 120, glideTo: 50, dur: 0.16, click: 0.2 });
      noise(ctx, target, { dur: 0.18, vol: v(0.2), at, filterType: 'lowpass', freq: 900, attack: 0.003, timeConstant: 0.06 });
      break;
    }

    case 'countdown': {
      // Stadium countdown tone: fat lowpassed square + sine sub body +
      // soft octave — a full enveloped tone, not a thin beep.
      const f = 660 * rate;
      osc(ctx, target, {
        type: 'square', freq: f, dur: 0.26, vol: v(0.3), at, attack: 0.006, sustain: true, release: 0.06,
        filterType: 'lowpass', filterFreq: 1800, filterQ: 0.9,
      });
      osc(ctx, target, { type: 'sine', freq: Math.max(30, f * 0.5), dur: 0.26, vol: v(0.35), at, attack: 0.006, sustain: true, release: 0.06 });
      osc(ctx, target, { type: 'sine', freq: Math.max(30, f * 2), dur: 0.2, vol: v(0.1), at: at + 0.005, attack: 0.006, sustain: true, release: 0.04 });
      break;
    }

    case 'go': {
      // Race start: kick punch + fat horn blast E5 -> A5 with sub body
      // and crowd-air on top — the arcade launch, not a beep.
      kick(ctx, target, { at, vol: v(0.54), freq: 170, glideTo: 50, dur: 0.25 }); // QA: keep dry peak below 1.0
      osc(ctx, target, { type: 'sine', freq: 160 * rate, glideTo: 60 * rate, dur: 0.22, vol: v(0.5), at, attack: 0.002 });
      horn(ctx, target, at, 659.25 * rate, 0.5, v(0.36));
      horn(ctx, target, at + 0.16, 880 * rate, 0.62, v(0.36));
      chime(ctx, target, { freq: 1318.51 * rate, dur: 0.5, vol: v(0.12), at: at + 0.2, partials: [1, 2, 3] });
      noise(ctx, target, { dur: 0.25, vol: v(0.07), at: at + 0.2, filterType: 'highpass', freq: 7000, timeConstant: 0.1 });
      break;
    }

    case 'pickup': {
      // Modern coin pickup: two bright lowpassed-square blips with fast
      // decay + a high sine sparkle — reads as a reward, not a beep.
      const coin = [880 * rate, 1318.51 * rate];
      coin.forEach((f, i) => {
        osc(ctx, target, {
          type: 'square', freq: Math.max(30, f), dur: 0.14, vol: v(0.32), at: at + i * 0.07, attack: 0.002,
          filterType: 'lowpass', filterFreq: 5200, filterQ: 0.8,
        });
      });
      osc(ctx, target, { type: 'sine', freq: 2093 * rate, dur: 0.22, vol: v(0.14), at: at + 0.09, attack: 0.002, timeConstant: 0.06 });
      noise(ctx, target, { dur: 0.12, vol: v(0.05), at: at + 0.12, filterType: 'highpass', freq: 8000 });
      break;
    }

    case 'lap': {
      // Rising chime run announcing a completed lap.
      const notes = [N.C5, N.E5, N.G5, N.C6, N.E6];
      let t = at;
      for (const n of notes) {
        chime(ctx, target, { freq: n * rate, dur: 0.35, vol: v(0.45), at: t, partials: [1, 2, 3, 4] });
        t += 0.09;
      }
      noise(ctx, target, { dur: 0.4, vol: v(0.1), at: t, filterType: 'highpass', freq: 7500, timeConstant: 0.12 });
      break;
    }

    case 'finalLap': {
      // Dedicated FINAL LAP jingle (audit r2): was reusing posUp — the
      // overtake blip — so the last lap sounded like any other position
      // change. This is a short urgent fanfare: staccato horn triple
      // E5-G5-C6, held C6, sparkle on top. Distinct from 'lap' (chime
      // run) and 'finish' (longer horn fanfare).
      horn(ctx, target, at, 659.25 * rate, 0.16, v(0.3));
      horn(ctx, target, at + 0.13, 783.99 * rate, 0.16, v(0.3));
      horn(ctx, target, at + 0.26, 1046.5 * rate, 0.42, v(0.34));
      chime(ctx, target, { freq: 1318.51 * rate, dur: 0.6, vol: v(0.2), at: at + 0.34, partials: [1, 2, 3, 4] });
      noise(ctx, target, { dur: 0.35, vol: v(0.06), at: at + 0.3, filterType: 'highpass', freq: 7500, timeConstant: 0.12 });
      break;
    }

    case 'cheer': {
      // Crowd cheer burst (audit r2): swelling bandpass-noise roar plus a
      // few rising triangle "woo" voices. `intensity` (0..1) scales
      // loudness/length — small on overtakes, big on the finish line.
      const inten = clamp(opts.intensity ?? 0.5, 0.05, 1);
      const d = 0.5 + inten * 0.9;
      noise(ctx, target, {
        dur: d, vol: v(0.1 + inten * 0.3), at, filterType: 'bandpass',
        freq: 450 + inten * 250, q: 0.7, glideTo: 900 + inten * 500,
        attack: 0.08, sustain: true, release: 0.15,
      });
      noise(ctx, target, {
        dur: d * 0.8, vol: v(0.04 + inten * 0.12), at: at + 0.03,
        filterType: 'bandpass', freq: 1800, q: 2, attack: 0.1, sustain: true, release: 0.1,
      });
      const wooCount = 2 + Math.round(inten * 3);
      let wt = at + 0.05;
      for (let i = 0; i < wooCount; i++) {
        const f = (420 + i * 55) * rate; // deterministic voice ladder
        osc(ctx, target, {
          type: 'triangle', freq: f, glideTo: f * 1.12, dur: 0.3 + inten * 0.2,
          vol: v(0.05 + inten * 0.1), at: wt, attack: 0.08, sustain: true, release: 0.1,
          filterType: 'lowpass', filterFreq: 1400, lfoFreq: 6, lfoDepth: f * 0.02,
        });
        wt += 0.09;
      }
      break;
    }

    case 'finish': {
      // Fanfare arpeggio + held top note.
      const notes = [N.C5, N.E5, N.G5, N.C6, N.E6];
      let t = at;
      for (const n of notes) {
        horn(ctx, target, t, n * rate, 0.22, v(0.3));
        t += 0.11;
      }
      horn(ctx, target, t, N.G6 * rate, 0.7, v(0.34));
      chime(ctx, target, { freq: N.C7 * rate, dur: 0.8, vol: v(0.22), at: t, partials: [1, 2, 3, 4, 5] });
      noise(ctx, target, { dur: 0.6, vol: v(0.08), at: t, filterType: 'highpass', freq: 8000, timeConstant: 0.15 });
      break;
    }

    case 'victory': {
      // Longer celebration: full fanfare, held chord, sparkle run.
      const notes = [N.C5, N.E5, N.G5, N.C6, N.E6, N.G6];
      let t = at;
      for (const n of notes) {
        horn(ctx, target, t, n * rate, 0.24, v(0.28));
        t += 0.13;
      }
      for (const n of [N.C5, N.E5, N.G5, N.C6]) {
        chime(ctx, target, { freq: n * rate, dur: 1.4, vol: v(0.16), at: t, partials: [1, 2, 3, 4] });
      }
      let s = t + 0.3;
      const sparkle = [N.C7, N.D7, N.C7, N.G6, N.E6, N.G6, N.C7];
      for (const n of sparkle) {
        chime(ctx, target, { freq: n * rate, dur: 0.35, vol: v(0.16), at: s, partials: [1, 2, 3, 4, 5] });
        s += 0.07;
      }
      noise(ctx, target, { dur: 1.2, vol: v(0.08), at: t + 0.4, filterType: 'highpass', freq: 8500, timeConstant: 0.2 });
      break;
    }

    case 'uiHover': {
      // Soft hover tick (USER FIX: sine + gentle triangle — the old square
      // was the sharpest '8-bit' artifact in the menu).
      osc(ctx, target, { type: 'sine', freq: 900 * rate, dur: 0.05, vol: v(0.06), at, attack: 0.002 });
      osc(ctx, target, { type: 'triangle', freq: 1500 * rate, dur: 0.04, vol: v(0.07), at, attack: 0.002 });
      break;
    }

    case 'musicIntro':
    case 'menuMusic': {
      // Soft intro sting for the MusicEngine: Cmaj7 pad swell +
      // gentle chime melody + air.
      const d = 1.7;
      for (const n of [N.C4, N.E4, N.G4, N.B4]) {
        osc(ctx, target, {
          type: 'triangle', freq: n, dur: d, vol: v(0.16), at, attack: 0.35, sustain: true, release: 0.25,
          filterType: 'lowpass', filterFreq: 900,
        });
      }
      const mel = [N.C5, N.E5, N.G5, N.E5];
      let t = at + 0.4;
      for (const n of mel) {
        chime(ctx, target, { freq: n, dur: 0.5, vol: v(0.2), at: t, partials: [1, 2, 3] });
        t += 0.24;
      }
      noise(ctx, target, { dur: 1.0, vol: v(0.06), at: at + 0.3, filterType: 'highpass', freq: 7500, timeConstant: 0.2 });
      break;
    }

    default: {
      // Unknown name: warn (recipes stay pure) and play a quiet tick
      // so callers always hear feedback. USER FIX (audit r2): triangle
      // instead of the old raw square — the fallback was the last '8-bit'
      // square left in the SFX set.
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[sfx] Unknown SFX name: "${name}"`);
      }
      osc(ctx, target, { type: 'triangle', freq: 1000 * rate, dur: 0.04, vol: v(0.1), at, attack: 0.002 });
      break;
    }
  }
}
