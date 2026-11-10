// ============================================================
// Super Kart 3D.js — music.js (Mario Kart DS Edition)
// High-energy procedural arcade soundtrack inspired by Mario Kart DS
// (Shinobu Tanaka / Nintendo DS SSEQ soundfont aesthetic):
//   - Bright DS Brass & Jazz-Fusion Synth leads with pitch-scoop attack & vibrato
//   - Syncopated 7th/9th brass & electric-piano chord stabs
//   - Funky octave-jumping slap/FM synth basslines
//   - Sparkling 16th-note chip-bell counter-arpeggios
//   - Driving arcade drum grooves with 4-bar snare/tom fills & crash cymbals
//   - Final Lap Hyper-Lift (+14% BPM speedup + +2 semitone key modulation!)
//   - Super Star Invincibility Eurobeat/Disco mode (setStarMode(true))
//
// Contract (ARCHITECTURE.md):
//   new MusicEngine(ctx, { volume, onEnded, menu, intensity, track })
//   start(), stop(), next(), setVolume(v), setIntensity(0..1), setStarMode(bool)
//   static renderOffline(ctx, out, trackName, seed, cycles)
//   static trackNames(), static trackDuration(name, cycles)
// ============================================================

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ------------------------------------------------------------
// Chord voicings (MIDI notes) — bright jazz-fusion / arcade voicings
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
  D7:     [50, 54, 57, 60],
  C7:     [48, 52, 55, 58],
  E7:     [52, 56, 59, 62],
  B7:     [47, 51, 54, 57],
  Dmaj7:  [50, 54, 57, 61],
  Gadd9:  [43, 47, 50, 54, 57],
};

// Pentatonic & scale pools per key (for counter-chimes & sparkles)
const PENTA = {
  C:  [60, 62, 64, 67, 69, 72, 74, 76],
  Dm: [50, 53, 55, 57, 60, 62, 65, 67],
  Am: [57, 60, 62, 64, 67, 69, 72, 74],
  F:  [53, 57, 60, 62, 65, 69, 72, 74],
  G:  [55, 59, 62, 64, 67, 71, 74, 76],
  Em: [52, 55, 59, 62, 64, 67, 71, 74],
};

// ------------------------------------------------------------
// Mario Kart DS-Style Race Playlist (6 Track Themes)
// Each track includes:
//   - leadPattern: 32-step (2-bar) composed melodic hook (MIDI note or 0 for rest/tie)
//   - leadGate: note duration in 16th steps when triggered
//   - stabPattern: 16-step syncopated brass/chord stab rhythm
//   - bassWalk: 16-step semitone offsets relative to chord root (-12) for walking/octave bass
// ------------------------------------------------------------
const TRACKS = [
  {
    // Track 1: Meadow Circuit — MKDS Figure-8 Circuit / Delfino Square vibe
    name: 'Turbo Circuit',
    key: 'C',
    bpm: 160,
    chords: ['Cmaj7', 'Am7', 'Fmaj7', 'G7'],
    barsPerChord: 1,
    cycles: 8,
    leadInstrument: 'brass',
    padType: 'sawtooth',
    padFilter: 1900,
    padWobble: 0.35,
    padGain: 0.95,
    chimeVol: 0.16,
    chimeDensity: 0.75,
    bassVol: 0.34,
    drumVol: 0.27,
    kickPattern:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1],
    snarePattern: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
    hatPattern:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    bassPattern:  [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0],
    bassWalk:     [0, 0, 12, 0, 7, 0, 12, 7, 0, 0, 12, 0, 5, 7, 12, 0],
    stabPattern:  [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0],
    leadPattern: [
      // Bar 1: Bright heroic Mario Kart brass fanfare
      72, 0, 76, 0, 79, 0, 81, 79, 0, 76, 72, 0, 74, 0, 76, 0,
      // Bar 2: Syncopated call-and-response climb to high C6/D6
      77, 0, 81, 0, 84, 0, 83, 81, 0, 79, 81, 0, 83, 0, 84, 0,
    ],
    leadGate:     [
      2, 0, 2, 0, 2, 0, 1, 2, 0, 1, 2, 0, 2, 0, 2, 0,
      2, 0, 2, 0, 2, 0, 1, 2, 0, 1, 2, 0, 2, 0, 2, 0,
    ],
  },
  {
    // Track 3: Canyon Rush — MKDS Desert Hills / Yoshi Falls upbeat brass & marimba adventure
    name: 'Rainbow Drift',
    key: 'G',
    bpm: 164,
    chords: ['Gmaj7', 'Em7', 'Cmaj7', 'D7'],
    barsPerChord: 1,
    cycles: 8,
    leadInstrument: 'brass',
    padType: 'sawtooth',
    padFilter: 1750,
    padWobble: 0.45,
    padGain: 1.0,
    chimeVol: 0.17,
    chimeDensity: 0.8,
    bassVol: 0.34,
    drumVol: 0.27,
    kickPattern:  [1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0],
    snarePattern: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1],
    hatPattern:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    bassPattern:  [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
    bassWalk:     [0, 0, 7, 12, 0, 0, 12, 0, 0, 0, 7, 12, 10, 0, 7, 0],
    stabPattern:  [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0],
    leadPattern: [
      79, 0, 83, 86, 0, 83, 81, 79, 0, 76, 79, 0, 81, 0, 83, 0,
      84, 0, 83, 81, 0, 79, 81, 83, 0, 86, 84, 0, 81, 0, 79, 0,
    ],
    leadGate: [
      2, 0, 1, 2, 0, 1, 1, 2, 0, 1, 2, 0, 2, 0, 2, 0,
      2, 0, 1, 2, 0, 1, 1, 2, 0, 1, 2, 0, 2, 0, 2, 0,
    ],
  },
  {
    // Track 4: Alpine Frost — MKDS DK Pass / Peach Gardens sparkling snow rally
    name: 'Star Sprint',
    key: 'Am',
    bpm: 162,
    chords: ['Am7', 'Fmaj7', 'Cmaj7', 'G7'],
    barsPerChord: 1,
    cycles: 8,
    leadInstrument: 'whistle',
    padType: 'sawtooth',
    padFilter: 2100,
    padWobble: 0.3,
    padGain: 1.05,
    chimeVol: 0.19,
    chimeDensity: 0.85,
    bassVol: 0.33,
    drumVol: 0.28,
    kickPattern:  [1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    snarePattern: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1],
    hatPattern:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    bassPattern:  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    bassWalk:     [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 7, 0, 12, 7],
    stabPattern:  [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0],
    leadPattern: [
      76, 0, 81, 83, 84, 0, 83, 81, 79, 0, 76, 0, 79, 0, 81, 0,
      77, 0, 81, 84, 88, 0, 86, 84, 83, 0, 79, 0, 83, 0, 86, 0,
    ],
    leadGate: [
      2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 2, 0, 2, 0, 2, 0,
      2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 2, 0, 2, 0, 2, 0,
    ],
  },
  {
    // Track 2: Harbor Dusk — MKDS Waluigi Pinball / Rainbow Road electro-arcade hype
    name: 'Neon Nights',
    key: 'Dm',
    bpm: 168,
    chords: ['Dm7', 'Bbmaj7', 'Fmaj7', 'A7'],
    barsPerChord: 1,
    cycles: 8,
    leadInstrument: 'synth',
    padType: 'sawtooth',
    padFilter: 1850,
    padWobble: 0.6,
    padGain: 1.05,
    chimeVol: 0.18,
    chimeDensity: 0.85,
    bassVol: 0.36,
    drumVol: 0.29,
    kickPattern:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    snarePattern: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1],
    hatPattern:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    bassPattern:  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    bassWalk:     [0, 12, 0, 12, 0, 12, 7, 12, 0, 12, 0, 12, 5, 12, 7, 12],
    stabPattern:  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1],
    leadPattern: [
      74, 77, 81, 0, 86, 0, 84, 81, 79, 77, 76, 77, 79, 0, 81, 0,
      82, 0, 81, 79, 77, 0, 76, 74, 73, 0, 76, 79, 81, 0, 85, 0,
    ],
    leadGate: [
      1, 1, 2, 0, 2, 0, 1, 1, 1, 1, 1, 1, 2, 0, 2, 0,
      2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 2, 0,
    ],
  },
  {
    // Track 5: Inferno Volcano — MKDS Bowser Castle / Airship Fortress boss rush
    name: 'Magma Caldera',
    key: 'Em',
    bpm: 170,
    chords: ['Em7', 'C7', 'Am7', 'B7'],
    barsPerChord: 1,
    cycles: 8,
    leadInstrument: 'brass',
    padType: 'sawtooth',
    padFilter: 1950,
    padWobble: 0.5,
    padGain: 1.1,
    chimeVol: 0.17,
    chimeDensity: 0.8,
    bassVol: 0.37,
    drumVol: 0.3,
    kickPattern:  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0],
    snarePattern: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1],
    hatPattern:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    bassPattern:  [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0],
    bassWalk:     [0, 0, 12, 0, 7, 7, 12, 0, 0, 0, 12, 0, 6, 0, 7, 0],
    stabPattern:  [1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0],
    leadPattern: [
      76, 0, 79, 83, 84, 0, 83, 79, 78, 79, 81, 79, 76, 0, 71, 0,
      76, 0, 83, 0, 88, 0, 87, 88, 86, 84, 83, 81, 79, 78, 76, 0,
    ],
    leadGate: [
      2, 0, 1, 1, 2, 0, 1, 1, 1, 1, 1, 1, 2, 0, 2, 0,
      2, 0, 2, 0, 2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0,
    ],
  },
  {
    // Track 6: Haunted Mansion — MKDS Luigi's Mansion spooky harpsichord & theremin bounce
    name: 'Phantom Manor',
    key: 'Am',
    bpm: 156,
    chords: ['Am7', 'Dm7', 'E7', 'Am7'],
    barsPerChord: 1,
    cycles: 8,
    leadInstrument: 'harpsichord',
    padType: 'triangle',
    padFilter: 1550,
    padWobble: 0.68,
    padGain: 0.98,
    chimeVol: 0.19,
    chimeDensity: 0.82,
    bassVol: 0.34,
    drumVol: 0.26,
    kickPattern:  [1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1],
    snarePattern: [0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1],
    hatPattern:   [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
    bassPattern:  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    bassWalk:     [0, 0, 3, 0, 7, 0, 8, 0, 7, 0, 3, 0, 0, 0, -1, 0],
    stabPattern:  [1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0],
    leadPattern: [
      69, 0, 72, 0, 76, 0, 77, 76, 0, 75, 76, 0, 81, 0, 76, 0,
      81, 0, 80, 81, 0, 77, 76, 0, 74, 72, 71, 72, 69, 0, 0, 0,
    ],
    leadGate: [
      1, 0, 1, 0, 1, 0, 1, 2, 0, 1, 2, 0, 2, 0, 2, 0,
      2, 0, 1, 2, 0, 1, 2, 0, 1, 1, 1, 1, 3, 0, 0, 0,
    ],
  },
];

// Upbeat Mario Kart DS Title & Character Select Groove (replaces sleepy 86 BPM loop!)
const MENU_TRACK = {
  name: 'Menu Cruise',
  key: 'F',
  bpm: 136,
  chords: ['Fmaj7', 'G7', 'Em7', 'Am7'],
  barsPerChord: 1,
  cycles: Infinity,
  leadInstrument: 'whistle',
  padType: 'triangle',
  padFilter: 1650,
  padWobble: 0.28,
  padGain: 0.85,
  chimeVol: 0.14,
  chimeDensity: 0.65,
  bassVol: 0.28,
  drumVol: 0.22,
  kickPattern:  [1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0],
  snarePattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  hatPattern:   [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
  bassPattern:  [1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0],
  bassWalk:     [0, 0, 12, 0, 0, 7, 12, 0, 0, 0, 12, 0, 5, 7, 0, 0],
  stabPattern:  [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0],
  leadPattern: [
    77, 0, 81, 0, 84, 0, 81, 79, 0, 76, 79, 0, 81, 0, 76, 0,
    74, 0, 77, 0, 81, 0, 84, 83, 0, 79, 81, 0, 79, 0, 0, 0,
  ],
  leadGate: [
    2, 0, 2, 0, 2, 0, 1, 2, 0, 1, 2, 0, 2, 0, 2, 0,
    2, 0, 2, 0, 2, 0, 1, 2, 0, 1, 2, 0, 3, 0, 0, 0,
  ],
};

// Iconic Super Star Invincibility Theme (178 BPM Eurobeat/Disco riff)
const STAR_TRACK = {
  name: 'Starman Hyper',
  key: 'C',
  bpm: 178,
  chords: ['Fmaj7', 'Em7', 'Fmaj7', 'Em7'],
  barsPerChord: 1,
  cycles: Infinity,
  leadInstrument: 'synth',
  padType: 'sawtooth',
  padFilter: 2400,
  padWobble: 0.5,
  padGain: 1.1,
  chimeVol: 0.2,
  chimeDensity: 0.9,
  bassVol: 0.38,
  drumVol: 0.3,
  kickPattern:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
  snarePattern: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1],
  hatPattern:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  bassPattern:  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  bassWalk:     [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 7, 12],
  stabPattern:  [1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0],
  leadPattern: [
    84, 0, 84, 0, 84, 0, 74, 84, 0, 84, 0, 74, 84, 74, 84, 0,
    83, 0, 83, 0, 83, 0, 72, 83, 0, 83, 0, 72, 83, 72, 83, 0,
  ],
  leadGate: [
    2, 0, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 1, 1, 2, 0,
    2, 0, 2, 0, 2, 0, 1, 2, 0, 2, 0, 1, 1, 1, 2, 0,
  ],
};

const STEPS_PER_BEAT = 4; // 16th notes
const SWING = 0.54;       // tight arcade groove (snappy, not sluggish)
const LOOKAHEAD = 0.35;   // scheduler lookahead window (s)

export class MusicEngine {
  constructor(ctxOrOpts, opts = {}) {
    const cfg = (ctxOrOpts && typeof ctxOrOpts === 'object' && 'ctx' in ctxOrOpts)
      ? ctxOrOpts
      : { ...opts, ctx: ctxOrOpts };
    const { ctx, output = null, volume = 0.36, onEnded = null, seed = Date.now(), track = null, menu = false, intensity = 0.5 } = cfg;

    this._ctx = ctx;
    this._out = output || ctx.destination;
    this._volume = clamp01(volume);
    this._intensityTarget = clamp01(intensity);
    this._intensity = this._intensityTarget;
    this._menu = menu;
    this._starMode = false;
    this._savedTrackBeforeStar = null;
    this._onEnded = onEnded;
    this._seed = seed >>> 0;
    this._rng = this._mulberry32(this._seed);
    this._offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;

    this._bus = ctx.createGain();
    this._bus.gain.value = 0;

    this._duckGain = ctx.createGain();
    this._duckGain.gain.value = 1;

    // Stereo slapback delay for arcade space
    this._delay = ctx.createDelay(1.0);
    this._delay.delayTime.value = 0.19;
    this._fb = ctx.createGain();
    this._fb.gain.value = 0.24;
    this._wet = ctx.createGain();
    this._wet.gain.value = 0.16;
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

    this._pinnedTrackName = track || null;
    this._playlist = menu ? [MENU_TRACK] : TRACKS.slice();
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

  start(onTrackEnd = null) {
    if (onTrackEnd) this._onTrackEnd = onTrackEnd;
    if (this._playing) this.stop();
    this._stopping = false;
    this._shufflePlaylist();
    this._playNext(0.08);
  }

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
    this._bus.gain.linearRampToValueAtTime(0, now + 0.35);
  }

  next() {
    if (!this._playing) {
      this._stopping = false;
      this._playNext(0.08);
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
    this._bus.gain.linearRampToValueAtTime(0, now + 0.18);
    const self = this;
    this._finishTimer = setTimeout(() => {
      this._finishTimer = null;
      if (!self._stopping) self._playNext(0.25);
    }, 220);
  }

  setVolume(v) {
    this._volume = clamp01(v);
    if (this._playing) {
      this._bus.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.05);
    }
  }

  setIntensity(v) {
    this._intensityTarget = clamp01(v);
    if (!this._playing) this._intensity = this._intensityTarget;
  }

  /**
   * Toggle Mario Kart Super Star Invincibility music mode!
   */
  setStarMode(active) {
    const want = !!active;
    if (want === this._starMode) return;
    this._starMode = want;
    if (!this._playing || this._menu) return;
    if (want) {
      this._savedTrackBeforeStar = this._currentTrack;
      this._currentTrack = STAR_TRACK;
      this._step = 0;
    } else if (this._savedTrackBeforeStar) {
      this._currentTrack = this._savedTrackBeforeStar;
      this._savedTrackBeforeStar = null;
      this._step = 0;
    }
  }

  isPlaying() {
    return this._playing;
  }

  get currentTrack() {
    return this._currentTrack ? this._currentTrack.name : null;
  }

  /* ---------------- Playlist ---------------- */

  _shufflePlaylist() {
    const list = (this._menu ? [MENU_TRACK] : TRACKS).slice();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this._rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    // Keep the track-specific theme song first when starting a race!
    if (this._pinnedTrackName && !this._menu) {
      const pi = list.findIndex((t) => t.name === this._pinnedTrackName);
      if (pi > 0) {
        const [pinned] = list.splice(pi, 1);
        list.unshift(pinned);
      }
    } else if (this._lastTrack) {
      const idx = list.findIndex((t) => t.name === this._lastTrack);
      if (idx > -1) {
        const [t] = list.splice(idx, 1);
        list.push(t);
      }
    }
    this._playlist = list;
    this._trackIdx = -1;
  }

  _playNext(startDelay = 0.08) {
    this._stopping = false;
    this._trackIdx += 1;
    if (this._trackIdx >= this._playlist.length) {
      this._shufflePlaylist();
      this._trackIdx = 0;
    }
    const track = this._starMode ? STAR_TRACK : this._playlist[this._trackIdx];
    this._currentTrack = track;
    this._lastTrack = track.name;
    this._step = 0;
    this._nextStepTime = this._ctx.currentTime + startDelay;
    this._playing = true;
    this._ensureVinyl();
    const now = this._ctx.currentTime;
    this._bus.gain.cancelScheduledValues(now);
    this._bus.gain.setValueAtTime(this._bus.gain.value, now);
    this._bus.gain.linearRampToValueAtTime(this._volume, now + 0.45);
    this._startScheduler();
  }

  /* ---------------- Scheduler (lookahead) ---------------- */

  _startScheduler() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), 80);
  }

  _stopScheduler() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _tick() {
    this._intensity += (this._intensityTarget - this._intensity) * 0.28;
    const stepDur = this._stepDuration();
    while (this._nextStepTime < this._ctx.currentTime + LOOKAHEAD) {
      this._scheduleStep(this._step, this._nextStepTime);
      this._step += 1;
      this._nextStepTime += stepDur;
      if (!this._playing) return;
    }
    if (this._step >= this._totalSteps()) {
      this._finishTrack(this._nextStepTime);
    }
  }

  /**
   * Effective 16th-step duration — on the Final Lap (_intensity >= 0.75),
   * Mario Kart DS speeds up the music by +14% for an adrenaline rush!
   */
  _stepDuration() {
    const finalLapBoost = this._intensity >= 0.75 ? 0.14 : 0.05 * this._intensity;
    return 60 / (this._currentTrack.bpm * (1 + finalLapBoost)) / STEPS_PER_BEAT;
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
    this._bus.gain.linearRampToValueAtTime(0, end + 0.5);
    const cb = this._onEnded;
    const track = this._currentTrack;
    this._finishTimer = setTimeout(() => {
      this._finishTimer = null;
      if (cb) cb(track);
      if (!this._stopping) this._playNext(0.3);
    }, Math.max(550, (end - now) * 1000 + 550));
  }

  /* ---------------- Subtle analog air floor (kept ultra-clean for arcade punch) ---------------- */

  _ensureVinyl() {
    if (this._vinyl) return;
    const ctx = this._ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (this._rng() * 2 - 1) * 0.15;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2800;
    const gain = ctx.createGain();
    gain.gain.value = 0.0025;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this._bus);
    src.start();
    this._vinyl = src;
    this._vinylGain = gain;
  }

  _playCrackle(at) {
    const ctx = this._ctx;
    const len = Math.floor(ctx.sampleRate * 0.003);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (this._rng() * 2 - 1) * 0.2;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.015, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.003);
    src.connect(hp);
    hp.connect(g);
    g.connect(this._bus);
    src.start(at);
    src.stop(at + len / ctx.sampleRate + 0.02);
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

  /* ---------------- Step scheduling (Mario Kart DS Multi-Track Sequencer) ---------------- */

  _swingTime(step, time) {
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
    const stepInPhrase = step % 64; // 4-bar phrase cycle
    const stepInHook = step % 32;   // 2-bar melodic hook cycle

    // Final Lap key modulation (+2 semitones on Final Lap, just like Mario Kart!)
    const transpose = this._intensity >= 0.78 ? 2 : 0;
    const rawChord = CHORDS[t.chords[chordIdx]] || CHORDS.Cmaj7;
    const chord = transpose ? rawChord.map((n) => n + transpose) : rawChord;

    // 1. Harmonic Pad + Crash Cymbal on Bar/Phrase Boundaries
    if (stepInChord === 0) {
      this._playPad(chord, time, t, stepsPerChord);
    }
    if (stepInPhrase === 0) {
      this._playCrash(time, t);
    }

    // 2. Syncopated Mario Kart DS Brass / Polysynth Chord Stabs
    if (t.stabPattern && t.stabPattern[stepInBar]) {
      this._playBrassStab(chord, this._swingTime(step, time), t);
    }

    // 3. Composed Mario Kart DS Lead Melody Hook (32-step pattern)
    if (t.leadPattern) {
      const leadMidi = t.leadPattern[stepInHook];
      if (leadMidi && leadMidi > 0) {
        const gateSteps = (t.leadGate && t.leadGate[stepInHook]) || 2;
        // Add subtle melodic variation on the 2nd half of the 4-bar phrase
        const phraseVar = (stepInPhrase >= 48 && stepInHook >= 24 && leadMidi < 84) ? 2 : 0;
        this._playLead(leadMidi + transpose + phraseVar, gateSteps, this._swingTime(step, time), t);
      }
    }

    // 4. Sparkling 16th-Note Nintendo DS Chip-Bell Counter-Arpeggio
    if (step % 2 === 0 || this._intensity >= 0.65) {
      this._playArp(chord, stepInBar, this._swingTime(step, time), t);
    }
    if (t.chimeDensity > 0 && (stepInBar === 0 || stepInBar === 6 || stepInBar === 12) && this._rng() < t.chimeDensity) {
      this._playChime(chord, time, t, transpose);
    }

    // 5. Funky Walking / Octave Slap-Synth Bassline
    if (t.bassPattern[stepInBar]) {
      const walkOffset = (t.bassWalk && t.bassWalk[stepInBar]) || 0;
      const bassNote = chord[0] - 12 + walkOffset;
      const isAccent = stepInBar % 4 === 0 || walkOffset >= 12;
      this._playBass(bassNote, time, t, isAccent ? 1.05 : 0.88, walkOffset >= 12);
    }

    // 6. Arcade Drum Kit + 4-Bar Snare/Tom Fill Rolls
    const isFillZone = stepInPhrase >= 60; // Last beat of every 4 bars = drum fill!
    if (t.kickPattern[stepInBar] || (isFillZone && stepInBar % 2 === 0)) {
      this._playKick(time, t);
      this._scheduleDuck(time);
    }
    if (t.snarePattern[stepInBar] || isFillZone) {
      const fillPitch = isFillZone ? 1.25 - (stepInPhrase - 60) * 0.08 : 1.0;
      const fillVel = isFillZone ? 0.85 : 1.0;
      this._playSnare(this._swingTime(step, time), t, fillPitch, fillVel);
    }
    const isOpenHat = stepInBar % 4 === 2;
    if (t.hatPattern[stepInBar]) {
      this._playHat(this._swingTime(step, time), t, isOpenHat ? 1.25 : 0.85, isOpenHat);
    } else if (this._intensity >= 0.6) {
      this._playHat(this._swingTime(step, time), t, 0.55, false);
    }
  }

  /* ---------------- Mario Kart DS Synthesized Instruments ---------------- */

  /**
   * Expressive Mario Kart DS Lead Synthesizer:
   *   - 'brass': Dual detuned sawtooth + octave square with pitch-scoop attack & vibrato
   *   - 'synth': Bright Waluigi-Pinball style dual-saw + pulse lead
   *   - 'harpsichord': Luigi's-Mansion style plucky harpsichord + spooky vibrato overtone
   *   - 'whistle': Cheerful pitch-gliding whistle/flute + bell attack
   */
  _playLead(noteMidi, gateSteps, time, track) {
    const ctx = this._ctx;
    const stepDur = this._stepDuration();
    const dur = Math.max(0.09, gateSteps * stepDur * 0.92);
    const freq = midiHz(noteMidi);
    const mode = track.leadInstrument || 'brass';
    const leadVol = 0.135 * (0.85 + 0.3 * this._intensity);

    const outGain = ctx.createGain();
    outGain.gain.setValueAtTime(0.0001, time);
    outGain.gain.linearRampToValueAtTime(leadVol, time + (mode === 'harpsichord' ? 0.004 : 0.014));
    outGain.gain.setValueAtTime(leadVol * 0.82, Math.max(time + 0.02, time + dur - 0.03));
    outGain.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.04);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const baseCut = mode === 'synth' ? 3800 : mode === 'harpsichord' ? 4200 : 2900;
    filter.frequency.setValueAtTime(baseCut * 0.55, time);
    filter.frequency.exponentialRampToValueAtTime(baseCut * (1 + 0.35 * this._intensity), time + 0.045);
    filter.Q.value = mode === 'synth' ? 2.2 : 1.3;
    filter.connect(outGain);
    outGain.connect(this._bus);

    // Expressive vibrato on sustained notes
    const lfo = ctx.createOscillator();
    lfo.frequency.value = mode === 'harpsichord' ? 6.5 : 5.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0.001, time);
    lfoGain.gain.linearRampToValueAtTime(freq * (mode === 'harpsichord' ? 0.014 : 0.008), time + 0.08);
    lfo.connect(lfoGain);
    lfo.start(time);
    lfo.stop(time + dur + 0.05);

    const voices = mode === 'whistle'
      ? [{ type: 'triangle', detune: 0, mult: 1, gain: 0.85 }, { type: 'sine', detune: 5, mult: 2, gain: 0.35 }]
      : mode === 'harpsichord'
      ? [{ type: 'sawtooth', detune: -6, mult: 1, gain: 0.65 }, { type: 'square', detune: 6, mult: 2, gain: 0.35 }]
      : [{ type: 'sawtooth', detune: -8, mult: 1, gain: 0.58 }, { type: 'sawtooth', detune: 8, mult: 1, gain: 0.58 }, { type: 'square', detune: 0, mult: 1, gain: 0.28 }];

    for (const v of voices) {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      // Brass pitch-scoop attack (starts 3% flat and snaps to pitch in 18ms)
      osc.frequency.setValueAtTime(freq * v.mult * 0.975, time);
      osc.frequency.exponentialRampToValueAtTime(freq * v.mult, time + 0.018);
      osc.detune.value = v.detune;
      lfoGain.connect(osc.frequency);
      const vg = ctx.createGain();
      vg.gain.value = v.gain;
      osc.connect(vg);
      vg.connect(filter);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    }
  }

  /**
   * Punchy syncopated Mario Kart DS Brass / Polysynth Chord Stab
   */
  _playBrassStab(chord, time, track) {
    const ctx = this._ctx;
    const dur = this._stepDuration() * 1.45;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, time);
    filter.frequency.exponentialRampToValueAtTime(2600 * (1 + 0.3 * this._intensity), time + 0.025);
    filter.frequency.exponentialRampToValueAtTime(1100, time + dur);
    filter.Q.value = 1.4;

    const g = ctx.createGain();
    const stabVol = 0.058 * track.padGain * (0.85 + 0.3 * this._intensity);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(stabVol, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.02);
    filter.connect(g);
    g.connect(this._bus);

    for (const note of chord) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiHz(note + 12);
      osc.detune.value = (this._rng() * 2 - 1) * 6;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + dur + 0.03);
    }
  }

  /**
   * Sparkling 16th-note Nintendo DS Counter-Arpeggiator
   */
  _playArp(chord, stepInBar, time, track) {
    const ctx = this._ctx;
    const arpOrder = [0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2];
    const idx = arpOrder[stepInBar % arpOrder.length] % chord.length;
    const octaveShift = (stepInBar % 4 === 3) ? 24 : 12;
    const note = chord[idx] + octaveShift;
    const dur = this._stepDuration() * 0.85;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiHz(note);
    const g = ctx.createGain();
    const vol = 0.055 * (0.75 + 0.4 * this._intensity);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.02);
    osc.connect(g);
    g.connect(this._bus);
    osc.start(time);
    osc.stop(time + dur + 0.03);
  }

  _playPad(chord, time, track, stepsPerChord) {
    const ctx = this._ctx;
    const dur = stepsPerChord * this._stepDuration() + 0.25;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const filterFreq = track.padFilter * (1 + 0.55 * this._intensity);
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    const padVol = 0.065 * track.padGain * (0.8 + 0.3 * this._intensity);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(padVol, time + 0.08);
    g.gain.setValueAtTime(padVol, Math.max(time + 0.1, time + dur - 0.18));
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
    }
  }

  /**
   * Funky Mario Kart DS Slap / FM Synth Bass (Sawtooth + Sub Triangle through resonant filter snap)
   */
  _playBass(noteMidi, time, track, vel = 1, isSlap = false) {
    const ctx = this._ctx;
    const dur = this._stepDuration() * 1.65;
    const freq = midiHz(Math.max(28, noteMidi));

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;

    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(isSlap ? 2200 : 1400, time);
    filter.frequency.exponentialRampToValueAtTime(240, time + 0.085);
    filter.Q.value = isSlap ? 3.2 : 1.8;

    const g = ctx.createGain();
    const vol = 0.24 * track.bassVol * vel * (0.8 + 0.35 * this._intensity);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(g);
    g.connect(this._bus);
    osc.start(time);
    sub.start(time);
    osc.stop(time + dur + 0.02);
    sub.stop(time + dur + 0.02);
  }

  _playChime(chord, time, track, transpose = 0) {
    const ctx = this._ctx;
    const pool = PENTA[track.key] || PENTA.C;
    const note = pool[Math.floor(this._rng() * pool.length)] + 12 + transpose;
    const f = midiHz(note);
    const dur = 0.45;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(track.chimeVol * 0.7 * (0.7 + 0.4 * this._intensity), time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    g.connect(this._bus);
    for (const partial of [1, 2]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * partial;
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
    osc.frequency.setValueAtTime(165, time);
    osc.frequency.exponentialRampToValueAtTime(48, time + 0.085);
    const g = ctx.createGain();
    const vol = 0.78 * track.drumVol * (0.8 + 0.3 * this._intensity);
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
    osc.connect(g);
    g.connect(this._bus);
    osc.start(time);
    osc.stop(time + 0.15);

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
    cg.gain.value = 0.12 * track.drumVol * (0.8 + 0.3 * this._intensity);
    src.connect(hp);
    hp.connect(cg);
    cg.connect(this._bus);
    src.start(time);
    src.stop(time + len / ctx.sampleRate + 0.02);
  }

  _scheduleDuck(time) {
    const t = time;
    this._duckGain.gain.cancelScheduledValues(t);
    this._duckGain.gain.setValueAtTime(1, t);
    this._duckGain.gain.linearRampToValueAtTime(0.9, t + 0.012);
    this._duckGain.gain.linearRampToValueAtTime(1, t + 0.11);
  }

  _playSnare(time, track, pitchMult = 1, velMult = 1) {
    const ctx = this._ctx;
    const len = Math.floor(ctx.sampleRate * 0.085);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (this._rng() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1850 * pitchMult;
    bp.Q.value = 0.75;
    const g = ctx.createGain();
    g.gain.value = 0.48 * track.drumVol * (0.8 + 0.3 * this._intensity) * velMult;
    src.connect(bp);
    bp.connect(g);
    g.connect(this._bus);
    src.start(time);
    src.stop(time + len / ctx.sampleRate + 0.02);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(240 * pitchMult, time);
    body.frequency.exponentialRampToValueAtTime(155 * pitchMult, time + 0.055);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.18 * track.drumVol * (0.8 + 0.3 * this._intensity) * velMult, time);
    bg.gain.exponentialRampToValueAtTime(0.001, time + 0.075);
    body.connect(bg);
    bg.connect(this._bus);
    body.start(time);
    body.stop(time + 0.09);
  }

  _playHat(time, track, volMult = 1, open = false) {
    const ctx = this._ctx;
    const durSec = open ? 0.065 : 0.026;
    const len = Math.floor(ctx.sampleRate * durSec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (this._rng() * 2 - 1) * Math.pow(1 - i / len, 1.8);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6400;
    const g = ctx.createGain();
    g.gain.value = 0.095 * track.drumVol * (0.8 + 0.3 * this._intensity) * volMult;
    src.connect(hp);
    hp.connect(g);
    g.connect(this._bus);
    src.start(time);
    src.stop(time + len / ctx.sampleRate + 0.02);
  }

  _playCrash(time, track) {
    const ctx = this._ctx;
    const durSec = 0.38;
    const len = Math.floor(ctx.sampleRate * durSec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (this._rng() * 2 - 1) * Math.pow(1 - i / len, 1.4);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.11 * track.drumVol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + durSec);
    src.connect(hp);
    hp.connect(g);
    g.connect(this._bus);
    src.start(time);
    src.stop(time + durSec + 0.02);
  }

  /* ---------------- Offline render (QA) ---------------- */

  static renderOffline(ctx, output, trackName, seed = 12345, cycles = null) {
    const track = TRACKS.find((t) => t.name === trackName) || TRACKS[0];
    const engine = new MusicEngine(ctx, { output, volume: 1, seed });
    engine._currentTrack = track;
    engine._playing = true;
    engine._bus.gain.value = 1;
    const stepDur = engine._stepDuration();
    const cyc = cycles ?? track.cycles;
    const totalSteps = track.chords.length * track.barsPerChord * 16 * cyc;
    for (let step = 0; step < totalSteps; step++) {
      engine._scheduleStep(step, step * stepDur);
    }
    engine._ensureVinyl();
    return engine;
  }

  static trackDuration(name, cycles = 1) {
    const track = TRACKS.find((t) => t.name === name) || TRACKS[0];
    const stepDur = 60 / track.bpm / STEPS_PER_BEAT;
    return track.chords.length * track.barsPerChord * 16 * cycles * stepDur;
  }

  static trackNames() {
    return TRACKS.map((t) => t.name);
  }
}

export { TRACKS, MENU_TRACK, STAR_TRACK };
