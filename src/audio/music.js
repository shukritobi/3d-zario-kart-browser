// ============================================================
// Super Kart 3D.js — music.js
// Procedural racing playlist (lo-fi hype, zero audio assets):
// pads with a slow wobble, pentatonic chimes, sine bass, punchy
// kick/snare/hat groove and a vinyl texture with crackles — all
// synthesized live with the WebAudio API.
//
// Contract (ARCHITECTURE.md):
//   new MusicEngine(ctx, { volume, onEnded, menu, intensity })
//   start(), stop(), next(), setVolume(v), setIntensity(0..1)
//   static renderOffline(ctx, out, trackName, seed, cycles)
//   static trackNames(), static trackDuration(name, cycles)
//
// Emotional arc (audit r3): setIntensity(0..1) reshapes the arrangement
// live — 0 is the calm/menu color (pad+bass pulled back), ≥0.7 adds a
// ghost-hat 16th layer, opens the pad filter (+60% cutoff) and nudges BPM
// (+4% at max). Values ramp ~0.4s in the scheduler, so the final-lap lift
// swells instead of snapping. `menu: true` plays a single calm loop
// (MENU_TRACK, cycles=Infinity) instead of the shuffled race playlist.
//
// Scheduler: setInterval(tick, 100) with a 0.35s lookahead;
// 16th-note steps, swing on odd steps. Tracks loop their chord
// progression `cycles` times, then the playlist advances.
//
// Pitfalls baked in (validated in the match-3djs project):
//   - stop() sets a `_stopping` guard so the _finishTrack timeout
//     cannot restart the music.
//   - The bus gain starts at 0 and fades in on play; renderOffline
//     sets bus.gain.value = 1 explicitly (no fade-in runs there).
//   - All randomized synthesis uses a seeded RNG so offline renders
//     are byte-for-byte reproducible for a given seed.
// ============================================================

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ------------------------------------------------------------
// Chord voicings (MIDI notes) — closed voicings in a comfortable
// lo-fi register (C3-B4).
// ------------------------------------------------------------
const CHORDS = {
  Cmaj7:  [48, 52, 55, 59],
  Am7:    [45, 48, 52, 55],
  Fmaj7:  [53, 57, 60, 64],
  G7:     [43, 47, 50, 53],
  Dm7:    [50, 53, 57, 60],
  Bbmaj7: [46, 50, 53, 57],
  A7:     [45, 49, 52, 55],
  Em7:    [52, 55, 59, 62],
  Gmaj7:  [43, 47, 50, 54],
  D7:     [50, 53, 57, 60],
  C7:     [48, 52, 55, 58],
  E7:     [52, 56, 59, 62],
  Dmaj7:  [50, 54, 57, 61],
  Gadd9:  [43, 47, 50, 54, 57],
};

// Pentatonic pools per key (for the chime melody).
const PENTA = {
  C:  [60, 62, 64, 67, 69, 72, 74, 76],
  Dm: [50, 53, 55, 57, 60, 62, 65, 67],
  Am: [57, 60, 62, 64, 67, 69, 72, 74],
  F:  [53, 57, 60, 62, 65, 69, 72, 74],
  G:  [55, 59, 62, 64, 67, 71, 74, 76],
  Em: [52, 55, 59, 62, 64, 67, 71, 74],
};

// ------------------------------------------------------------
// Playlist — 3 tracks: different BPM, progression and groove.
// Each: chords (MIDI voicings), 16-step drum/bass patterns,
// timbre knobs and lo-fi vinyl texture.
// ------------------------------------------------------------
const TRACKS = [
  {
    name: 'Turbo Circuit',
    key: 'C',
    bpm: 124,
    chords: ['Cmaj7', 'Am7', 'Fmaj7', 'G7'],
    barsPerChord: 1,
    cycles: 8,
    padType: 'triangle',
    padFilter: 1300,
    padWobble: 0.35,
    padGain: 0.9,
    chimeVol: 0.13,
    chimeDensity: 0.5,
    bassVol: 0.26,
    drumVol: 0.2,
    kickPattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0],
    snarePattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hatPattern: [0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1],
    bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
  },
  {
    name: 'Rainbow Drift',
    key: 'Dm',
    bpm: 138,
    chords: ['Dm7', 'Bbmaj7', 'Fmaj7', 'A7'],
    barsPerChord: 2,
    cycles: 4,
    padType: 'sawtooth',
    padFilter: 850,
    padWobble: 0.55,
    padGain: 1.0,
    chimeVol: 0.11,
    chimeDensity: 0.4,
    bassVol: 0.28,
    drumVol: 0.22,
    kickPattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    snarePattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hatPattern: [0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1],
    bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
  },
  {
    name: 'Star Sprint',
    key: 'Am',
    bpm: 150,
    chords: ['Am7', 'Fmaj7', 'Cmaj7', 'G7'],
    barsPerChord: 2,
    cycles: 4,
    padType: 'sawtooth',
    padFilter: 1500,
    padWobble: 0.3,
    padGain: 1.1,
    chimeVol: 0.14,
    chimeDensity: 0.55,
    bassVol: 0.26,
    drumVol: 0.24,
    kickPattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0],
    snarePattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hatPattern: [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1],
    bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
  },
  {
    name: 'Neon Nights',
    key: 'Dm',
    bpm: 142,
    chords: ['Dm7', 'Bbmaj7', 'Fmaj7', 'E7'],
    barsPerChord: 1,
    cycles: 8,
    padType: 'sawtooth',
    padFilter: 700,
    padWobble: 0.6,
    padGain: 1.0,
    chimeVol: 0.12,
    chimeDensity: 0.45,
    bassVol: 0.3,
    drumVol: 0.24,
    kickPattern: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    snarePattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hatPattern: [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1],
    bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
  },
];

// Calm menu loop (audit r3) — a laid-back variant of 'Turbo Circuit'
// (track 1): slow BPM, sparse groove, soft pads. `cycles: Infinity` makes
// the scheduler loop the progression forever without ever advancing the
// playlist, so the menu music only ends via stopMenuMusic().
const MENU_TRACK = {
  name: 'Menu Cruise',
  key: 'C',
  bpm: 86,
  chords: ['Cmaj7', 'Am7', 'Fmaj7', 'G7'],
  barsPerChord: 2,
  cycles: Infinity,
  padType: 'triangle',
  padFilter: 900,
  padWobble: 0.22,
  padGain: 0.7,
  chimeVol: 0.09,
  chimeDensity: 0.3,
  bassVol: 0.15,
  drumVol: 0.11,
  kickPattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  snarePattern: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  hatPattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

const STEPS_PER_BEAT = 4; // 16th notes
const SWING = 0.62;       // delayed offbeats (lo-fi groove)
const LOOKAHEAD = 0.35;   // scheduler lookahead window (s)

export class MusicEngine {
  /**
   * Accepts both call styles:
   *   new MusicEngine(ctx, { output, volume, onEnded, seed })
   *   new MusicEngine({ ctx, output, volume, onEnded, seed })
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} [opts.output] Destination (defaults to ctx.destination).
   * @param {number} [opts.volume] Music bus volume (default 0.34).
   * @param {Function} [opts.onEnded] Called with the finished track.
   * @param {number} [opts.seed] RNG seed for deterministic synthesis.
   */
  constructor(ctxOrOpts, opts = {}) {
    const cfg = (ctxOrOpts && typeof ctxOrOpts === 'object' && 'ctx' in ctxOrOpts)
      ? ctxOrOpts
      : { ...opts, ctx: ctxOrOpts };
    const { ctx, output = null, volume = 0.34, onEnded = null, seed = Date.now(), track = null, menu = false, intensity = 0.5 } = cfg;

    this._ctx = ctx;
    this._out = output || ctx.destination;
    this._volume = clamp01(volume);
    // Emotional arc state (audit r3): smoothed toward _intensityTarget in
    // _tick. 0 = calm (menu), 0.5 = normal race, ≥0.7 = final-lap lift.
    this._intensityTarget = clamp01(intensity);
    this._intensity = this._intensityTarget;
    this._menu = menu;
    this._onEnded = onEnded;
    this._seed = seed >>> 0;
    this._rng = this._mulberry32(this._seed);
    this._offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;

    // Bus starts muted; fades in on play (pitfall: no clicks).
    this._bus = ctx.createGain();
    this._bus.gain.value = 0;

    // Sidechain-style duck gain (AAA groove): the kick dips the whole music
    // bus ~10% for ~0.12s, so the mix breathes with the beat instead of
    // sitting flat. Programmed from the scheduler (WebAudio has no cheap
    // native sidechain path).
    this._duckGain = ctx.createGain();
    this._duckGain.gain.value = 1;

    // Lo-fi space: short feedback delay.
    this._delay = ctx.createDelay(1.0);
    this._delay.delayTime.value = 0.27;
    this._fb = ctx.createGain();
    this._fb.gain.value = 0.3;
    this._wet = ctx.createGain();
    this._wet.gain.value = 0.2;
    this._bus.connect(this._duckGain);
    this._duckGain.connect(this._delay);
    this._delay.connect(this._fb);
    this._fb.connect(this._delay);
    this._delay.connect(this._wet);
    this._wet.connect(this._out);
    this._duckGain.connect(this._out);

    this._vinyl = null;
    this._vinylGain = null;
    this._crackleTimer = null;

    // `menu: true` swaps the shuffled 3-track playlist for the single calm
    // loop; everything downstream (scheduler, instruments) is identical.
    this._playlist = menu ? [MENU_TRACK] : TRACKS.slice();
    // `track` option pins the FIRST song (per-track identity — NEON CITY
    // opens with 'Neon Nights'; then the playlist continues shuffled).
    if (track) {
      const ti = this._playlist.findIndex((t) => t.name === track);
      if (ti > 0) this._playlist.unshift(this._playlist.splice(ti, 1)[0]);
    }
    this._trackIdx = -1;
    this._timer = null;
    this._finishTimer = null;
    this._step = 0;
    this._nextStepTime = 0;
    this._playing = false;
    this._stopping = false;
    this._lastTrack = null;
    this._currentTrack = null;
  }

  _mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- Lifecycle ---------------- */

  /**
   * Shuffles the playlist and starts playing. A repeated call while
   * playing restarts with a fresh shuffle.
   * @param {Function} [onTrackEnd] Optional per-call callback.
   */
  start(onTrackEnd = null) {
    if (onTrackEnd) this._onTrackEnd = onTrackEnd;
    if (this._playing) this.stop();
    this._stopping = false;
    this._shufflePlaylist();
    this._playNext(0.15);
  }

  /**
   * Stops everything (fast fade). The `_stopping` guard prevents the
   * pending _finishTrack timeout from starting the next track.
   */
  stop() {
    this._stopping = true;
    this._playing = false;
    this._stopScheduler();
    if (this._finishTimer) {
      clearTimeout(this._finishTimer);
      this._finishTimer = null;
    }
    this._stopVinyl();
    const now = this._ctx.currentTime;
    this._bus.gain.cancelScheduledValues(now);
    this._bus.gain.setValueAtTime(this._bus.gain.value, now);
    this._bus.gain.linearRampToValueAtTime(0, now + 0.4);
  }

  /** Skips to the next track in the playlist. */
  next() {
    if (!this._playing) {
      this._stopping = false;
      this._playNext(0.1);
      return;
    }
    this._stopScheduler();
    this._playing = false;
    if (this._finishTimer) {
      clearTimeout(this._finishTimer);
      this._finishTimer = null;
    }
    const now = this._ctx.currentTime;
    this._bus.gain.cancelScheduledValues(now);
    this._bus.gain.setValueAtTime(this._bus.gain.value, now);
    this._bus.gain.linearRampToValueAtTime(0, now + 0.2);
    const self = this;
    this._finishTimer = setTimeout(() => {
      this._finishTimer = null;
      if (!self._stopping) self._playNext(0.35);
    }, 260);
  }

  setVolume(v) {
    this._volume = clamp01(v);
    if (this._playing) {
      this._bus.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.05);
    }
  }

  /**
   * Emotional intensity 0..1 (audit r3):
   *   0.0 — calm: pad + bass pulled back (menu / cruise)
   *   0.5 — normal race arrangement
   *   ≥0.7 — lift: ghost-hat 16th layer, pad filter opens (+60%), BPM +4%
   * Values are smoothed toward the target in _tick (~0.4s ramp) so the
   * final-lap call swells in instead of snapping.
   * @param {number} v 0..1
   */
  setIntensity(v) {
    this._intensityTarget = clamp01(v);
    // Before the first notes, snap so the opening color is right (menu).
    if (!this._playing) this._intensity = this._intensityTarget;
  }

  isPlaying() {
    return this._playing;
  }

  get currentTrack() {
    return this._currentTrack ? this._currentTrack.name : null;
  }

  /* ---------------- Playlist ---------------- */

  _shufflePlaylist() {
    // Menu mode owns a single infinite loop; races shuffle the playlist.
    const list = (this._menu ? [MENU_TRACK] : TRACKS).slice();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this._rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    // The last played track never opens the next cycle (no immediate
    // repeat of the opening track).
    if (this._lastTrack) {
      const idx = list.findIndex((t) => t.name === this._lastTrack);
      if (idx > -1) {
        // AUDIT R25-FIX: push the spliced TRACK OBJECT, not the name
        // string — `_playNext` reads `.chords/.bpm` off the entry, so a
        // bare string threw on the 4th play of the 2nd cycle and killed
        // the music in long sessions.
        const [t] = list.splice(idx, 1);
        list.push(t);
      }
    }
    this._playlist = list;
    this._trackIdx = -1;
  }

  _playNext(startDelay = 0.1) {
    this._stopping = false;
    this._trackIdx += 1;
    if (this._trackIdx >= this._playlist.length) {
      this._shufflePlaylist();
      this._trackIdx = 0;
    }
    const track = this._playlist[this._trackIdx];
    this._currentTrack = track;
    this._lastTrack = track.name;
    this._step = 0;
    this._nextStepTime = this._ctx.currentTime + startDelay;
    this._playing = true;
    this._ensureVinyl();
    // Fade the bus in (pitfall: bus starts at 0).
    const now = this._ctx.currentTime;
    this._bus.gain.cancelScheduledValues(now);
    this._bus.gain.setValueAtTime(this._bus.gain.value, now);
    this._bus.gain.linearRampToValueAtTime(this._volume, now + 1.2);
    this._startScheduler();
  }

  /* ---------------- Scheduler (lookahead) ---------------- */

  _startScheduler() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), 100);
  }

  _stopScheduler() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _tick() {
    // Smooth intensity toward its target at ~10Hz (0.25/tick ≈ 0.4s ramp)
    // so the final-lap lift swells in; BPM follows the smoothed value.
    this._intensity += (this._intensityTarget - this._intensity) * 0.25;
    const stepDur = this._stepDuration();
    while (this._nextStepTime < this._ctx.currentTime + LOOKAHEAD) {
      this._scheduleStep(this._step, this._nextStepTime);
      this._step += 1;
      this._nextStepTime += stepDur;
      if (!this._playing) return;
    }
    if (this._step >= this._totalSteps()) {
      // `_nextStepTime` is the audio time immediately after the last step.
      // Do not start the fade at `currentTime`: lookahead may have queued the
      // final beat up to LOOKAHEAD seconds ahead.
      this._finishTrack(this._nextStepTime);
    }
  }

  /** Effective 16th-step duration — track BPM nudged by intensity (+4% at max). */
  _stepDuration() {
    return 60 / (this._currentTrack.bpm * (1 + 0.04 * this._intensity)) / STEPS_PER_BEAT;
  }

  _totalSteps() {
    const t = this._currentTrack;
    return t.chords.length * t.barsPerChord * 16 * t.cycles;
  }

  _finishTrack(trackEndTime = this._ctx.currentTime) {
    this._stopScheduler();
    this._playing = false;
    const now = this._ctx.currentTime;
    const end = Math.max(now, trackEndTime);
    this._bus.gain.cancelScheduledValues(now);
    this._bus.gain.setValueAtTime(this._bus.gain.value, now);
    this._bus.gain.linearRampToValueAtTime(0, end + 0.6);
    const cb = this._onEnded;
    const track = this._currentTrack;
    this._finishTimer = setTimeout(() => {
      this._finishTimer = null;
      if (cb) cb(track);
      // Guard: stop() (or a next() already pending) must not restart.
      if (!this._stopping) this._playNext(0.4);
    }, Math.max(650, (end - now) * 1000 + 650));
  }

  /* ---------------- Vinyl texture ---------------- */

  _ensureVinyl() {
    if (this._vinyl) return;
    const ctx = this._ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (this._rng() * 2 - 1) * 0.5;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    const gain = ctx.createGain();
    gain.gain.value = 0.012;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this._bus);
    src.start();
    this._vinyl = src;
    this._vinylGain = gain;
    if (!this._offline) {
      // Random crackles every ~900ms while playing.
      this._crackleTimer = setInterval(() => {
        if (!this._playing) return;
        if (this._rng() < 0.4) this._playCrackle(ctx.currentTime + 0.01);
      }, 900);
    }
  }

  _playCrackle(at) {
    const ctx = this._ctx;
    const len = Math.floor(ctx.sampleRate * 0.004);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (this._rng() * 2 - 1) * 0.4;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.004);
    src.connect(hp);
    hp.connect(g);
    g.connect(this._bus);
    src.start(at);
    src.stop(at + len / ctx.sampleRate + 0.02); // AUDIT R66: stop explícito
  }

  _stopVinyl() {
    if (this._vinyl) {
      try { this._vinyl.stop(); } catch { /* already stopped */ }
      this._vinyl = null;
      this._vinylGain = null;
    }
    if (this._crackleTimer) {
      clearInterval(this._crackleTimer);
      this._crackleTimer = null;
    }
  }

  /* ---------------- Step scheduling ---------------- */

  _swingTime(step, time) {
    // Offbeats (odd steps) land late — lo-fi swing.
    if (step % 2 === 1) {
      return time + this._stepDuration() * (SWING - 0.5);
    }
    return time;
  }

  _scheduleStep(step, time) {
    const t = this._currentTrack;
    const stepsPerBar = 16;
    const stepsPerChord = stepsPerBar * t.barsPerChord;
    const chordIdx = Math.floor(step / stepsPerChord) % t.chords.length;
    const stepInChord = step % stepsPerChord;
    const stepInBar = step % stepsPerBar;

    // Chord change -> pad + bass root + occasional chime.
    if (stepInChord === 0) {
      const chord = CHORDS[t.chords[chordIdx]];
      this._playPad(chord, time, t, stepsPerChord);
      this._playBass(chord[0] - 12, time, t);
      if (t.chimeDensity > 0 && this._rng() < 0.35) this._playChime(chord, time, t);
    }
    // Sparse chime melody mid-chord.
    if (t.chimeDensity > 0 && stepInChord === 8 && this._rng() < t.chimeDensity) {
      this._playChime(CHORDS[t.chords[chordIdx]], time, t);
    }

    // Drums.
    if (t.kickPattern[stepInBar]) {
      this._playKick(time, t);
      this._scheduleDuck(time); // sidechain-style pump on the kick
    }
    if (t.snarePattern[stepInBar]) this._playSnare(time, t);
    if (t.hatPattern[stepInBar]) this._playHat(this._swingTime(step, time), t);
    // Intensity lift (audit r3): at ≥0.7 quiet ghost hats fill the 16th
    // gaps — the groove tightens into a driving double-time feel on the
    // final lap.
    else if (this._intensity >= 0.7) this._playHat(this._swingTime(step, time), t, 0.55);

    // Bass groove.
    if (t.bassPattern[stepInBar]) {
      this._playBass(CHORDS[t.chords[chordIdx]][0] - 12, time, t, 0.9);
    }
  }

  /* ---------------- Instruments ---------------- */

  _playPad(chord, time, track, stepsPerChord) {
    const ctx = this._ctx;
    const dur = stepsPerChord * this._stepDuration() + 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    // Intensity opens the pad filter up to +60% cutoff (brighter at the lift).
    const filterFreq = track.padFilter * (1 + 0.6 * this._intensity);
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.6;
    // Slow ~0.1Hz wobble on the filter cutoff.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07 + track.padWobble * 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = filterFreq * 0.16;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(time);
    lfo.stop(time + dur);
    const g = ctx.createGain();
    // Calm (0) pulls pads back to 0.8x; full hype pushes them to 1.1x.
    const padVol = 0.085 * track.padGain * (0.8 + 0.3 * this._intensity);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(padVol, time + 0.5);
    g.gain.setValueAtTime(padVol, time + dur - 0.5);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    filter.connect(g);
    g.connect(this._bus);
    for (const note of chord) {
      const osc = ctx.createOscillator();
      osc.type = track.padType;
      osc.frequency.value = midiHz(note);
      osc.detune.value = (this._rng() * 2 - 1) * 7;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + dur);
      // Soft sine one octave up (brightness layer).
      if (track.chimeVol > 0.12) {
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = midiHz(note + 12);
        osc2.detune.value = (this._rng() * 2 - 1) * 4;
        const g2 = ctx.createGain();
        const bright = 0.035 * track.padGain * (0.7 + 0.5 * this._intensity);
        g2.gain.setValueAtTime(0.0001, time);
        g2.gain.linearRampToValueAtTime(bright, time + 0.6);
        g2.gain.setValueAtTime(bright, time + dur - 0.6);
        g2.gain.linearRampToValueAtTime(0.0001, time + dur);
        osc2.connect(g2);
        g2.connect(this._bus);
        osc2.start(time);
        osc2.stop(time + dur);
      }
    }
  }

  _playBass(noteMidi, time, track, vel = 1) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiHz(noteMidi);
    const g = ctx.createGain();
    // Calm (0) pulls the bass back to 0.7x; the lift beefs it up to 1.1x.
    const vol = 0.2 * track.bassVol * vel * (0.7 + 0.4 * this._intensity);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.42);
    osc.connect(g);
    g.connect(this._bus);
    osc.start(time);
    osc.stop(time + 0.5);
  }

  _playChime(chord, time, track) {
    const ctx = this._ctx;
    const pool = PENTA[track.key] || PENTA.C;
    const note = pool[Math.floor(this._rng() * pool.length)] + (this._rng() < 0.3 ? 12 : 0);
    const f = midiHz(note);
    const dur = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(track.chimeVol * (0.6 + 0.5 * this._intensity), time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    g.connect(this._bus);
    for (const partial of [1, 2, 3]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * partial;
      osc.detune.value = (this._rng() * 2 - 1) * 3;
      const pg = ctx.createGain();
      pg.gain.value = 1 / partial;
      osc.connect(pg);
      pg.connect(g);
      osc.start(time);
      osc.stop(time + dur);
    }
  }

  _playKick(time, track) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.09);
    const g = ctx.createGain();
    const vol = 0.72 * track.drumVol * (0.75 + 0.35 * this._intensity);
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
    osc.connect(g);
    g.connect(this._bus);
    osc.start(time);
    osc.stop(time + 0.15);
    // Click transient (short highpassed noise) — gives the kick a physical
    // beater attack instead of a pure sine thump.
    const len = Math.floor(ctx.sampleRate * 0.012);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (this._rng() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    const cg = ctx.createGain();
    cg.gain.value = 0.1 * track.drumVol * (0.75 + 0.35 * this._intensity);
    src.connect(hp);
    hp.connect(cg);
    cg.connect(this._bus);
    src.start(time);
    src.stop(time + len / ctx.sampleRate + 0.02); // AUDIT R66: stop explícito (nodes finitos não são GC'd no WebAudio)
  }

  /** Dips the music bus right on the kick (sidechain pump, ~12%). */
  _scheduleDuck(time) {
    // AUDIT R66 (auditoria som #1/5): o duck era agendado com currentTime e
    // cancelava/re-agendava a cada tick — pumping irregular + atropelava o
    // fade-in do bus. Agora agenda NO tempo da batida (futuro).
    const t = time;
    this._duckGain.gain.cancelScheduledValues(t);
    this._duckGain.gain.setValueAtTime(1, t);
    this._duckGain.gain.linearRampToValueAtTime(0.88, t + 0.015);
    this._duckGain.gain.linearRampToValueAtTime(1, t + 0.14);
  }

  _playSnare(time, track) {
    const ctx = this._ctx;
    const len = Math.floor(ctx.sampleRate * 0.09);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (this._rng() * 2 - 1) * Math.pow(1 - i / len, 1.6);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.45 * track.drumVol * (0.75 + 0.35 * this._intensity);
    src.connect(bp);
    bp.connect(g);
    g.connect(this._bus);
    src.start(time);
    src.stop(time + len / ctx.sampleRate + 0.02); // AUDIT R66: stop explícito
    // Body tone (short sine at ~190Hz) — the snare needs a pitch core or it
    // reads as pure white-noise hiss.
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(230, time);
    body.frequency.exponentialRampToValueAtTime(170, time + 0.06);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.16 * track.drumVol * (0.75 + 0.35 * this._intensity), time);
    bg.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    body.connect(bg);
    bg.connect(this._bus);
    body.start(time);
    body.stop(time + 0.1);
  }

  _playHat(time, track, volMult = 1) {
    const ctx = this._ctx;
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (this._rng() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.value = 0.09 * track.drumVol * (0.75 + 0.35 * this._intensity) * volMult;
    src.connect(hp);
    hp.connect(g);
    g.connect(this._bus);
    src.start(time);
    src.stop(time + len / ctx.sampleRate + 0.02); // AUDIT R66: stop explícito
  }

  /* ---------------- Offline render (QA) ---------------- */

  /**
   * Schedules a whole track into an OfflineAudioContext using the
   * exact same synthesis code as the real-time scheduler — with the
   * same seed, renders are deterministic. Vinyl texture and crackles
   * are included so the QA WAV matches the in-game sound.
   * @param {OfflineAudioContext} ctx
   * @param {AudioNode} output
   * @param {string} trackName
   * @param {number} [seed]
   * @param {number} [cycles] Override the track's cycle count.
   */
  static renderOffline(ctx, output, trackName, seed = 12345, cycles = null) {
    const track = TRACKS.find((t) => t.name === trackName) || TRACKS[0];
    const engine = new MusicEngine(ctx, { output, volume: 1, seed });
    engine._currentTrack = track;
    engine._playing = true;
    engine._bus.gain.value = 1; // offline: no fade-in (pitfall)
    const stepDur = engine._stepDuration();
    const cyc = cycles ?? track.cycles;
    const totalSteps = track.chords.length * track.barsPerChord * 16 * cyc;
    const totalDur = totalSteps * stepDur;
    for (let step = 0; step < totalSteps; step++) {
      engine._scheduleStep(step, step * stepDur);
    }
    // Vinyl texture + deterministic crackles (same code as real time).
    engine._ensureVinyl();
    for (let t = 0.5; t < totalDur - 0.15; t += 0.9) {
      if (engine._rng() < 0.4) engine._playCrackle(t);
    }
    return engine;
  }

  /** Duration of a track (seconds) for sizing offline contexts. */
  static trackDuration(name, cycles = 1) {
    const track = TRACKS.find((t) => t.name === name) || TRACKS[0];
    const stepDur = 60 / track.bpm / STEPS_PER_BEAT;
    return track.chords.length * track.barsPerChord * 16 * cycles * stepDur;
  }

  static trackNames() {
    return TRACKS.map((t) => t.name);
  }
}

export { TRACKS };
