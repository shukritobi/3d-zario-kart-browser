// ============================================================
// Super Kart 3D.js — AudioManager
// Thin manager over the pure synthesis in sfx.js / music.js:
//   - Lazy AudioContext (autoplay policy) created on init(), which
//     runs on the first user gesture (also auto-attached).
//   - Master chain (FECO r2 pass): volume gain (CONFIG.audio.masterVolume)
//     → HP filter → lowshelf (low-end body) → presence → highshelf →
//     waveshaper saturation → glue compressor → makeup gain → safety
//     limiter → destination, with a shared gentle CONVOLVER REVERB send
//     (procedural IR, dark return) so SFX, music and crowd sit together
//     in one fat arcade space instead of playing bone-dry.
//   - One-shot SFX via renderSfx(), procedural music via MusicEngine,
//     continuous per-kart engine loops.
//
// Contract (ARCHITECTURE.md):
//   new AudioManager()
//   init()                      — first user gesture; builds ctx + master
//   play(name, opts)            — one-shot SFX; safe no-op before init
//   startMusic()/stopMusic()/nextTrack()
//   startMenuMusic()/stopMenuMusic() — calm menu loop (audit r3)
//   setMusicIntensity(0..1) — emotional arc (0.5 race, 0.85 final lap)
//   setEngineLoop(kartId, speed01, pose?) — continuous engine per kart;
//                                 pose {x,z,heading?} enables StereoPanner
//                                 pan + distance rolloff vs the listener;
//                                 remembered and applied on init
//   setListenerPose({x,y,z,heading}) — camera/listener for positional audio
//   crowdCheer(intensity), setCrowdProximity(0..1) — crowd ambience
//   setMasterVolume(v), setMusicVolume(v)
// All calls before init() are safe (no-op or remembered).
// ============================================================

import { CONFIG } from '../config.js';
import { renderSfx, engineGear } from './sfx.js';
import { MusicEngine } from './music.js';
import { onStateChange, STATES } from '../game/GameState.js';

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class AudioManager {
  constructor() {
    this._ctx = null;
    this._master = null;
    this._volume = CONFIG.audio.masterVolume;
    this._musicVolume = CONFIG.audio.musicVolume;
    this._engineVolume = CONFIG.audio.engineVolume;

    this._music = null;
    this._musicRequested = false;
    this._menuMusic = null;
    this._menuMusicRequested = false;
    this._duckTimer = null;
    this._duckGeneration = 0;
    this._engineLoops = new Map();    // kartId -> loop node graph
    this._pendingEngine = new Map();  // kartId -> { speed01, pose } (pre-init)

    this._listener = null;            // { x, y, z, heading } — camera/listener
    this._crowd = null;               // crowd ambience graph
    this._crowdProximity = 0;         // 0..1 grandstand proximity (wash boost)
    this._lastCheerAt = 0;            // crowdCheer cooldown timestamp (ms)

    this._unlock = () => this.init();
    this._attachUnlock();
    // Menu music follows the game state (audit r3): a calm loop owns the
    // title screen, the race arrangement owns COUNTDOWN→FINISHED, and a
    // fresh COUNTDOWN resets the intensity arc (a previous race may have
    // left it at the 0.85 final-lap lift).
    onStateChange((next) => {
      if (next === STATES.MENU) {
        this.startMenuMusic();
      } else if (next === STATES.COUNTDOWN) {
        this.stopMenuMusic();
        this.setMusicIntensity(0.5);
      } else {
        this.stopMenuMusic();
      }
    });
  }

  /* ---------------- Context + master chain ---------------- */

  /**
   * Creates the AudioContext and master chain. Called on the first
   * user gesture (autoplay policy); idempotent. Applies engine loops
   * and music requests that arrived before init.
   *
   * Master chain (FECO r2 pass — tuned from the original dry
   * gain→compressor→destination):
   *   master gain → EQ (hp 28 / lowshelf 150Hz +3dB body / presence
   *   3.2k / hshelf 11k) → waveshaper (gentle tanh saturation) → glue
   *   compressor (soft knee, low ratio) → makeup gain → safety limiter
   *   → destination, with a CONVOLUTION REVERB send (procedural IR with
   *   pre-delay + dark return) so SFX and music share a fat, glued
   *   arcade space instead of playing bone-dry.
   * @returns {AudioContext|null}
   */
  init() {
    if (this._ctx) {
      this._resume();
      return this._ctx;
    }
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      console.warn('[AudioManager] WebAudio is not available in this browser.');
      return null;
    }
    this._ctx = new Ctx();
    this._master = this._ctx.createGain();
    this._master.gain.value = this._muted ? 0 : this._volume;

    // --- EQ (subtractive + low-end body + presence) ---------------------
    const eq = this._ctx.createBiquadFilter();
    eq.type = 'highpass';
    eq.frequency.value = 28; // kill sub rumble below audibility
    const lowshelf = this._ctx.createBiquadFilter();
    lowshelf.type = 'lowshelf';
    lowshelf.frequency.value = 150;
    lowshelf.gain.value = 3; // low-end body — the "fat" arcade bottom
    const presence = this._ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3200;
    presence.Q.value = 0.8;
    presence.gain.value = 0.8; // AUDIT R54: 1.5→0.8 — presence 3.2k amplificava os produtos de distorção (2-4kHz é a faixa mais sensível)
    const hshelf = this._ctx.createBiquadFilter();
    hshelf.type = 'highshelf';
    hshelf.frequency.value = 11000;
    hshelf.gain.value = -2; // tame harsh digital highs

    // --- Waveshaper (soft saturation — analog warmth, kills the raw-osc
    // "8-bit" edge; slightly gentler curve so it glues rather than fuzzes)
    // AUDIT R54 (auditoria som #1 CRÍTICA): drive 1.35→0.5 — o shaper master
    // saturava com qualquer entrada >0.65 (6 motores + música + crowd somam
    // bem acima), regenerando harmônicos até Nyquist = estridente constante.
    const shaper = this._ctx.createWaveShaper();
    shaper.curve = this._softClipCurve(220, 0.5);

    // --- Glue compressor (bus glue, not pumping): soft knee, low ratio,
    // fast attack — tucks every layer together like a mixing-bus.
    const comp = this._ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 22;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    // --- Makeup gain + safety limiter (the loud, fat arcade finish) ------
    const makeup = this._ctx.createGain();
    makeup.gain.value = 1.0; // AUDIT R54: 1.9→1.0 — makeup +5.6dB empurrava tudo no limiter ratio 20 (corpo sustentado saturado)
    const limiter = this._ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; // AUDIT R54: -3→-6 — margem extra contra clip
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.06;

    this._master.connect(eq);
    eq.connect(lowshelf);
    lowshelf.connect(presence);
    presence.connect(hshelf);
    hshelf.connect(shaper);
    shaper.connect(comp);
    comp.connect(makeup);
    makeup.connect(limiter);
    limiter.connect(this._ctx.destination);

    // --- Reverb send (procedural IR — generated, no assets) --------------
    // Gentle shared space: send is modest, the return is dark (lowpassed)
    // and joins BEFORE the glue compressor so the tail sits IN the mix
    // instead of splashing on top of it.
    this._reverb = this._createReverb(this._ctx);
    const reverbSend = this._ctx.createGain();
    reverbSend.gain.value = 0.18;
    const wetTone = this._ctx.createBiquadFilter();
    wetTone.type = 'lowpass';
    wetTone.frequency.value = 6500; // dark tail — no harsh reverb sparkle
    const reverbWet = this._ctx.createGain();
    reverbWet.gain.value = 0.75;
    this._master.connect(reverbSend);
    reverbSend.connect(this._reverb);
    this._reverb.connect(wetTone);
    wetTone.connect(reverbWet);
    reverbWet.connect(comp); // wet joins the glue compressor input
    this._reverbSend = reverbSend;

    // Apply engine loops remembered before init().
    for (const [kartId, pending] of this._pendingEngine) {
      this.setEngineLoop(kartId, pending.speed01, pending.pose, pending.vol);
    }
    this._pendingEngine.clear();

    // Music requested before init(): the menu loop owns the title screen,
    // the race playlist owns the race.
    if (this._menuMusicRequested && !this._musicRequested) this.startMenuMusic();
    if (this._musicRequested) this.startMusic();

    this._resume();
    return this._ctx;
  }

  /**
   * Soft tanh-ish clip curve for the waveshaper (warm saturation).
   * 1.35 = gentle glue; aggressive curves fuzz the highs and fight the
   * compressor. Shared by the master chain and the engine-loop voice.
   */
  _softClipCurve(n = 220, drive = 1.35) {
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x);
    }
    return curve;
  }

  /**
   * Procedural impulse response: 2.2s exponentially-decaying lowpassed
   * noise with a 20ms pre-delay, per-channel decorrelation and a slight
   * early-reflection energy bump. Sounds like a believable small hall,
   * not a spring reverb.
   */
  _createReverb(ctx) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2.2);
    const preDelay = Math.floor(sr * 0.02); // 20ms — dry transient first
    const buffer = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      const rng = mulberry32((sr ^ len ^ (ch * 0x9E3779B9) ^ 0x524556) | 0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        if (i < preDelay) {
          data[i] = 0;
          continue;
        }
        const t = (i - preDelay) / (len - preDelay); // 0..1 tail position
        const white = rng() * 2 - 1;
        last = last * 0.55 + white * 0.45; // lowpass the noise — warm tail
        const decay = Math.pow(1 - t, 2.6) * (ch === 1 ? 0.86 : 1.0);
        data[i] = last * decay * (t < 0.02 ? 1.6 : 1); // early-reflection bump
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buffer;
    return conv;
  }

  _resume() {
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
  }

  /** Pause the whole AudioContext (tab hidden). Quality gate: audio lifecycle. */
  suspend() {
    if (this._ctx && this._ctx.state === 'running') {
      this._ctx.suspend().catch(() => {});
    }
  }

  /** Resume the AudioContext after the tab becomes visible again. */
  resume() {
    this._resume();
  }

  _attachUnlock() {
    if (typeof window === 'undefined') return;
    for (const evt of GESTURE_EVENTS) {
      window.addEventListener(evt, this._unlock, { capture: true, passive: true });
    }
  }

  _detachUnlock() {
    if (typeof window === 'undefined') return;
    for (const evt of GESTURE_EVENTS) {
      window.removeEventListener(evt, this._unlock, { capture: true });
    }
  }

  /* ---------------- One-shot SFX ---------------- */

  /**
   * Plays a synthesized SFX (recipe in sfx.js). Safe no-op before
   * init() — the engine/UI may call this on any frame.
   * @param {string} name SFX name (see sfx.js).
   * @param {Object} [opts] { volume=1, rate=1, pan=0, delay=0, ... } —
   *   extra recipe opts (intensity, speed01, dur) are forwarded.
   */
  play(name, opts = {}) {
    if (!this._ctx || !this._master) return;
    let { volume = 1, rate = 1, pan = 0, delay = 0 } = opts;
    // AUDIT R65 (auditoria som #1/4): clamp global de one-shots (lightning
    // 0.9, crowdCheer 0.9, go recipe soma ~2.0) — nada deve passar de 0.85.
    volume = Math.min(0.85, Math.max(0, volume));
    // AUDIT R61 (auditoria som #1/3 ALTA): one-shots atribuídos a karts
    // tocavam volume cheio independente da distância (só pan). Com posição
    // fornecida, rola off com a distância do listener (12u = meia potência),
    // como os engine loops.
    if (opts.pos && this._listener) {
      const d = Math.hypot(opts.pos.x - this._listener.x, opts.pos.z - this._listener.z);
      volume *= Math.max(0, 12 / (12 + d));
    }
    const resolved = this._resolveSfxName(name, { volume, rate, pan, delay });
    renderSfx(this._ctx, this._master, resolved.name, {
      ...opts,
      volume,
      rate,
      pan,
      at: this._ctx.currentTime + Math.max(0, delay),
    });
    this._hookCrowd(resolved.name);
  }

  /**
   * Context-aware SFX name resolution (audit r2, dedupe). main.js still
   * announces FINAL LAP as play('posUp', { volume: 0.7 }) — the overtake
   * blip is posUp @0.5, so the 0.7 call is uniquely the final-lap
   * announcement. Route it to the dedicated 'finalLap' jingle so the last
   * lap stops reusing the overtake sound. Once main.js is renamed to
   * play('finalLap'), this alias becomes dead code and can be removed.
   */
  _resolveSfxName(name, { volume = 1 } = {}) {
    if (name === 'posUp' && volume > 0.6) return { name: 'finalLap' };
    return { name };
  }

  /**
   * Crowd ambience hooks — fire automatically off the existing play()
   * call sites (no main.js wiring needed for these):
   *   countdown/go → stadium wakes up (crowd wash swells in)
   *   posUp / finalLap → small cheer (overtake, or the final lap)
   *   finish / victory → big cheer
   */
  _hookCrowd(name) {
    if (!this._ctx) return;
    if (name === 'countdown' || name === 'go') {
      this._startCrowd();
    } else if (name === 'finalLap') {
      this.crowdCheer(0.35);
      // Audit r3: the final lap is the emotional peak — lift the music to
      // 0.85 (ghost-hat layer, open pads, +BPM). main.js announces it via
      // play('posUp', { volume: 0.7 }), which _resolveSfxName routes here.
      this.setMusicIntensity(0.85);
    } else if (name === 'posUp') {
      this.crowdCheer(0.35);
    } else if (name === 'finish' || name === 'victory') {
      this.crowdCheer(1);
    }
  }

  /* ---------------- Music ---------------- */

  /** Starts the procedural racing playlist (stops any menu loop first). */
  startMusic(trackName) {
    this._musicRequested = true;
    this.stopMenuMusic();
    if (!this._ctx || !this._master) return; // starts on init()
    if (this._music) return;                 // already running
    this._music = new MusicEngine(this._ctx, {
      output: this._master,
      volume: this._musicVolume,
      track: trackName, // per-track opening song (e.g. 'Neon Nights' on city)
      onEnded: () => {}, // the engine advances the playlist itself
    });
    this._music.start();
    this.play('musicIntro', { volume: 0.8 });
  }

  /**
   * Starts the calm menu loop — a low-volume variant of track 1
   * (MusicEngine `menu` mode, intensity 0). Safe before init() (remembered
   * and started on init()). Stops the race music, so returning to the
   * title screen after a race actually goes calm.
   */
  startMenuMusic() {
    this._menuMusicRequested = true;
    if (!this._ctx || !this._master) return; // starts on init()
    if (this._menuMusic) return;             // already running
    // Park the race playlist — the menu owns the speakers now.
    if (this._music) {
      this._music.stop();
      this._music = null;
      this._musicRequested = false;
    }
    this._menuMusic = new MusicEngine(this._ctx, {
      output: this._master,
      volume: this._musicVolume * 0.55, // calm, low volume
      menu: true,
      onEnded: () => {},
    });
    this._menuMusic.setIntensity(0); // calm arrangement
    this._menuMusic.start();
  }

  /** Stops the menu loop (race start / teardown). */
  stopMenuMusic() {
    this._menuMusicRequested = false;
    if (this._menuMusic) {
      this._menuMusic.stop();
      this._menuMusic = null;
    }
  }

  /**
   * Emotional intensity for the race music (0..1): 0.5 is the normal race
   * arrangement, 0.85 is the final-lap lift (ghost hats, open pads, +BPM).
   * Safe no-op before the music exists.
   */
  setMusicIntensity(v) {
    if (this._music) this._music.setIntensity(v);
  }

  /** Stops the music (fast fade out). */
  stopMusic() {
    this._musicRequested = false;
    this._duckGeneration += 1;
    if (this._duckTimer) {
      clearTimeout(this._duckTimer);
      this._duckTimer = null;
    }
    if (this._music) {
      this._music.stop();
      this._music = null;
    }
  }

  /** Skips to the next track in the playlist. */
  nextTrack() {
    if (this._music) this._music.next();
  }

  /** Name of the currently playing track (or null). */
  get currentTrack() {
    return this._music ? this._music.currentTrack : null;
  }

  /* ---------------- Continuous engine loops ---------------- */

  /**
   * Creates or updates a continuous engine sound for a kart.
   * Oscillator pair: sawtooth base + square octave, pitch mapped from
   * the piecewise GEAR MAP (audit r2 — upshift pitch drops + throttle
   * load), through a lowpass, into a gain scaled by
   * CONFIG.audio.engineVolume. Updates are smoothed with setTargetAtTime
   * (no zipper noise). Positional audio (audit r2): each loop carries a
   * StereoPannerNode + distance gain updated every call from the
   * listener's bearing — pass `pose` {x, z, heading?} and feed the
   * camera/player via setListenerPose (or the 'player' loop's own pose).
   * @param {string} kartId
   * @param {number} speed01 0..1 normalized speed.
   * @param {Object} [pose] { x, z, heading? } kart world position (y unused).
   */
  setEngineLoop(kartId, speed01, pose = null, vol = 1) {
    const s = Math.max(0, Math.min(1, speed01));
    const v = Math.max(0, Math.min(1, vol));
    if (!this._ctx || !this._master) {
      // Remember and apply on init().
      this._pendingEngine.set(kartId, { speed01: s, pose, vol: v });
      return;
    }
    // AUDIT R55 (auditoria som #2/3 MÉDIA): volume por kart — os AIs devem
    // tocar como rivais distantes (bus 0.28), não a volume cheio a 0m.
    // main.js passa vol=0.28 para 'ai0'..'ai4'.
    if (kartId === 'player' && pose) {
      // Chase camera sits behind the player kart looking along its
      // heading — the player pose IS a good listener proxy. A caller may
      // still override with the real camera pose via setListenerPose().
      this._listener = {
        x: pose.x ?? 0,
        y: pose.y ?? 0,
        z: pose.z ?? 0,
        heading: pose.heading ?? 0,
      };
    }
    const existing = this._engineLoops.get(kartId);
    if (existing) {
      existing.kartVol = v;
      this._updateEngineLoop(existing, s, pose, kartId);
    } else {
      const loop = this._createEngineLoop(s, pose);
      loop.kartVol = v;
      this._engineLoops.set(kartId, loop);
    }
  }

  /**
   * Sets the listening position for positional audio: the camera (or the
   * player kart as a proxy). `heading` is the camera yaw in radians —
   * forward = (sin heading, 0, cos heading), matching kart heading.
   * @param {{x:number, y?:number, z:number, heading?:number}} pose
   */
  setListenerPose({ x = 0, y = 0, z = 0, heading = 0 } = {}) {
    this._listener = { x, y, z, heading };
  }

  /** Stops and removes one kart's engine loop. */
  removeEngineLoop(kartId) {
    this._pendingEngine.delete(kartId);
    const loop = this._engineLoops.get(kartId);
    if (loop) {
      // AUDIT R63 (auditoria som #2/5): rampa rápida antes de parar — o
      // stop() direto com gain ~0.26-0.46 causava click/pop audível em todo
      // restart (clearEngineLoops).
      const t = this._ctx ? this._ctx.currentTime : 0;
      try {
        loop.gain.gain.setTargetAtTime(0.0001, t, 0.03);
        loop.distGain?.gain.setTargetAtTime(0.0001, t, 0.03);
      } catch { /* node já desconectado */ }
      setTimeout(() => {
        try {
          loop.base.stop();
          loop.oct.stop();
          loop.sub?.stop();
          loop.lfo.stop();
          loop.noise?.stop();
        } catch { /* already stopped */ }
        loop.base.disconnect();
        loop.oct.disconnect();
        loop.sub?.disconnect();
        loop.flt.disconnect();
        loop.shaper?.disconnect();
        loop.gain.disconnect();
        loop.noise?.disconnect();
        loop.nBand?.disconnect();
        loop.distGain?.disconnect();
        loop.panner?.disconnect();
        // AUDIT R62: vBase/vOct/vSub + lfoGain ficavam referenciados (base.disconnect()
        // remove saídas, não entradas) — leak por restart.
        loop.vBase?.disconnect();
        loop.vOct?.disconnect();
        loop.vSub?.disconnect();
        loop.lfoGain?.disconnect();
      }, 120);
      this._engineLoops.delete(kartId);
    }
  }

  /** Stops every engine loop + the crowd wash (race restart / teardown). */
  clearEngineLoops() {
    for (const kartId of [...this._engineLoops.keys()]) {
      this.removeEngineLoop(kartId);
    }
    this._pendingEngine.clear();
    this._stopCrowd();
  }

  _createEngineLoop(speed01, pose = null) {
    const ctx = this._ctx;
    const base = ctx.createOscillator();
    base.type = 'sawtooth';
    const oct = ctx.createOscillator();
    oct.type = 'square';
    // Sub oscillator: sine one octave BELOW the base — gives the motor
    // physical low-end body (USER/VISION FIX: the old 2-osc engine was a
    // thin synth buzz; a sub + saturation reads as a real combustion engine).
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 1.2;
    // Soft saturation on the motor voice (waveshaper — analog warmth).
    // AUDIT R53 (auditoria som #2/2 ALTA): staging por voz — a receita QA
    // 'engine' balanceia saw 0.55 / square 0.22 / sub 0.5, mas o loop ao
    // vivo conectava os 3 a UNITY. O square 2.02× saturado no shaper +
    // presence 3.2k + makeup 1.9 = som estridente constante. Agora cada voz
    // passa por um gain de mix antes do filtro (0.55/0.22/0.5).
    const shaper = ctx.createWaveShaper();
    shaper.curve = this._softClipCurve(160, 0.5); // R53: drive 0.5 (só satura em |x|>~1.75, transientes)
    const gain = ctx.createGain();
    // Combustion noise: white noise through a bandpass in the motor band.
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer();
    noise.loop = true;
    const nBand = ctx.createBiquadFilter();
    nBand.type = 'bandpass';
    nBand.Q.value = 0.7;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.06; // subtle — makes it sound like an engine, not a synth
    noise.connect(nBand);
    nBand.connect(nGain);
    nGain.connect(gain);
    // Small detune LFO for engine roughness.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 3; // cents of detune wobble (scaled by load below)
    lfo.connect(lfoGain);
    lfoGain.connect(base.detune);
    // AUDIT R53: per-voice mix gains (QA recipe engine: saw 0.55 / square 0.22 / sub 0.5)
    const vBase = ctx.createGain(); vBase.gain.value = 0.55;
    const vOct = ctx.createGain(); vOct.gain.value = 0.22;
    const vSub = ctx.createGain(); vSub.gain.value = 0.5;
    base.connect(vBase); vBase.connect(flt);
    oct.connect(vOct); vOct.connect(flt);
    sub.connect(vSub); vSub.connect(flt);
    flt.connect(shaper);
    shaper.connect(gain);
    // --- Positional stage (audit r2): distance gain + StereoPanner. ---
    // Every engine voice funnels through this so AI karts pan left/right
    // and roll off with distance from the listener. When no pose/listener
    // is known the values stay 0 / 1 — legacy centered full-volume sound.
    const distGain = ctx.createGain();
    distGain.gain.value = 1;
    let panner = null;
    if (typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      panner.pan.value = 0;
      gain.connect(panner);
      panner.connect(distGain);
    } else {
      gain.connect(distGain); // no panner support — distance only
    }
    distGain.connect(this._master);
    base.start();
    oct.start();
    sub.start();
    noise.start();
    lfo.start();
    // AUDIT R64 (auditoria som #2/6): valores iniciais explícitos ANTES do
    // start — o throttle temporal pode pular o 1º _updateEngineLoop e os
    // osciladores tocam na frequência DEFAULT de 440Hz (blip audível).
    base.frequency.value = 58; oct.frequency.value = 117; sub.frequency.value = 29;
    flt.frequency.value = 300; nBand.frequency.value = 220;
    gain.gain.value = 0.14; distGain.gain.value = 1;
    const loop = { base, oct, sub, flt, shaper, gain, lfo, lfoGain, noise, nBand, distGain, panner, vBase, vOct, vSub, pose, speed01: 0 };
    this._updateEngineLoop(loop, speed01, pose);
    return loop;
  }

  _noiseBuffer() {
    if (this._noiseBuf) return this._noiseBuf;
    const ctx = this._ctx;
    const len = ctx.sampleRate * 1.0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let sum = 0;
    const rng = mulberry32((ctx.sampleRate ^ len ^ 0x435244) | 0);
    for (let i = 0; i < len; i++) {
      data[i] = rng() * 2 - 1;
      sum += data[i];
    }
    const mean = sum / len;
    for (let i = 0; i < len; i++) data[i] -= mean; // DC block
    this._noiseBuf = buf;
    return buf;
  }

  _updateEngineLoop(loop, speed01, pose = null, kartId = null) {
    // AUDIT R52 (2026-08-14, auditoria som #2/1 ALTA): o throttle R37 usava
    // `_engineTick` GLOBAL com paridade — main.js chama 6×/frame na ordem
    // fixa, então player/ai1/ai3 eram SEMPRE ímpares e congelavam na
    // marcha-lenta (nunca atualizavam freq/gain/spatial); ai0/ai2/ai4
    // rodavam a 60Hz. Agora throttle TEMPORAL por loop (30Hz real) e o
    // speed01/pose são gravados ANTES do early-return (nunca stale).
    loop.speed01 = speed01;
    if (pose) loop.pose = pose;
    const t = this._ctx.currentTime;
    if (loop.lastTick && t - loop.lastTick < 1 / 30) return;
    loop.lastTick = t;
    const tc = 0.06; // smooth updates, no zipper noise
    // Piecewise gear map (audit r2): RPM climbs within a gear and DROPS on
    // upshift; `load` (throttle proxy) drives volume + detune roughness,
    // `lug` (strain right after a shift) muffles the top end.
    const { rpm, local, load, ratio } = engineGear(speed01);
    const lug = (1 - local) * load;
    loop.base.frequency.setTargetAtTime(rpm, t, tc);
    loop.oct.frequency.setTargetAtTime(rpm * 2.02, t, tc);
    loop.sub.frequency.setTargetAtTime(rpm * 0.5, t, tc);
    loop.flt.frequency.setTargetAtTime(300 + ratio * 1500 - lug * 250, t, tc);
    loop.nBand.frequency.setTargetAtTime(220 + ratio * 900, t, tc);
    loop.gain.gain.setTargetAtTime(this._engineVolume * (loop.kartVol ?? 1) * (0.15 + 0.85 * load) * (0.28 + 0.64 * (0.7 * load + 0.3 * local)), t, tc); // AUDIT R55/R57: kartVol (AIs 0.28) + idleScale (0.15 parado → quase mudo no grid)
    loop.lfoGain.gain.setTargetAtTime(3 + load * 4, t, tc); // roughness grows with throttle
    this._updateSpatial(loop, t);
  }

  /**
   * Per-frame positional update (audit r2): pans the engine left/right by
   * the kart's bearing from the listener (camera) and rolls the gain off
   * with distance. Listener convention: forward = (sin heading, 0, cos
   * heading), right = (cos heading, 0, -sin heading) — matches the game's
   * kart heading (main.js builds forward as (sin h, 0, cos h)).
   */
  _updateSpatial(loop, t) {
    const tc = 0.05;
    const pose = loop.pose;
    const L = this._listener;
    if (!pose || !L) {
      // No spatial data: centered, conservative volume (AUDIT R58: fallback
      // era 1.0 full — qualquer AI sem listener tocava cheio no aquecimento).
      if (loop.panner) loop.panner.pan.setTargetAtTime(0, t, tc);
      loop.distGain.gain.setTargetAtTime(0.35, t, tc);
      return;
    }
    const dx = pose.x - L.x;
    const dz = pose.z - L.z;
    const dist = Math.hypot(dx, dz);
    const yaw = L.heading ?? 0;
    const lateral = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const depth = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    const MAX_PAN = 16;   // units for full-left/full-right
    const pan = clamp(lateral / MAX_PAN, -1, 1);
    const REF = 12;       // distance rolloff reference (gain 0.5 at 12u)
    // AUDIT R56 (auditoria som #2/4 MÉDIA): piso 0.22→0.05 + fade distante
    // (sumiu a ~350m) — com 5 AIs o piso antigo mantinha uma cama constante
    // de motores a 22% que nunca sumia ('som constante').
    const far = Math.max(0, 1 - dist / 350);
    const gain = clamp((REF / (REF + dist)) * far, 0.05, 1) * (depth < -8 ? 0.8 : 1);
    if (loop.panner) loop.panner.pan.setTargetAtTime(pan, t, tc);
    loop.distGain.gain.setTargetAtTime(gain, t, tc);
  }

  /* ---------------- Crowd ambience (audit r2) ---------------- */

  /**
   * Continuous crowd wash: looped noise through two bandpass layers
   * (620Hz murmur body + 2100Hz sibilance) at low volume, with a slow LFO
   * wandering the murmur center so it reads as a live crowd, not static
   * hiss. Auto-started by play('countdown'|'go') and faded out by
   * clearEngineLoops() (race restart / menu).
   */
  _startCrowd() {
    if (!this._ctx || !this._master) return;
    if (!this._crowd) this._createCrowd();
    const t = this._ctx.currentTime;
    this._crowd.gain.gain.cancelScheduledValues(t);
    this._crowd.gain.gain.setTargetAtTime(this._crowdLevel(), t, 1.2); // slow swell in
  }

  _stopCrowd() {
    if (this._crowd && this._ctx) {
      const t = this._ctx.currentTime;
      this._crowd.gain.gain.cancelScheduledValues(t);
      this._crowd.gain.gain.setTargetAtTime(0.0001, t, 0.8);
      // AUDIT R62 (auditoria som #1/6): o BufferSource loopado e o LFO nunca
      // recebiam stop()/disconnect() — o grafo continuava processando (CPU)
      // indefinidamente após clearEngineLoops. Para depois do fade.
      const crowd = this._crowd;
      this._crowd = null;
      setTimeout(() => {
        try { crowd.src.stop(); } catch { /* já parado */ }
        crowd.src.disconnect();
        crowd.bp.disconnect();
        crowd.bp2?.disconnect();
        crowd.gain.disconnect();
        crowd.lfo.disconnect();
      }, 1500);
    }
  }

  _createCrowd() {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    src.loop = true;
    // Murmur body — the classic stadium "shhh".
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 620;
    bp.Q.value = 0.5;
    // Slow wander LFO on the murmur center (a crowd shifts, it never sits).
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 130;
    lfo.connect(lfoG);
    lfoG.connect(bp.frequency);
    // Raised-voice sibilance layer, quieter and higher.
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 2100;
    bp2.Q.value = 1.4;
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(bp);
    src.connect(bp2);
    bp.connect(gain);
    bp2.connect(g2);
    g2.connect(gain);
    gain.connect(this._master);
    src.start();
    lfo.start();
    this._crowd = { src, bp, bp2, gain, lfo };
  }

  /** Wash level: baseline murmur + proximity boost (both subtle). */
  _crowdLevel() {
    return 0.045 + this._crowdProximity * 0.05;
  }

  /**
   * Grandstand proximity (0..1) — feed per frame from the player's
   * distance to the nearest grandstand (main.js side). Closer → louder
   * wash, and a cheer fires when the player pulls up close.
   * @param {number} p01 0..1 proximity.
   */
  setCrowdProximity(p01) {
    const p = Math.max(0, Math.min(1, p01));
    this._crowdProximity = p;
    if (this._crowd && this._ctx) {
      this._crowd.gain.gain.setTargetAtTime(this._crowdLevel(), this._ctx.currentTime, 0.3);
    }
    if (p > 0.7 && this._ctx) this.crowdCheer(0.5 + p * 0.4, 2600);
  }

  /**
   * One-shot crowd cheer burst (sfx 'cheer'), cooldown-gated so rapid
   * overtake chains don't fire overlapping roars. Also briefly swells the
   * wash gain. Safe before init (no-op).
   * @param {number} [intensity] 0..1 (default 0.5).
   * @param {number} [minGapMs] cooldown between bursts (default 1200).
   */
  crowdCheer(intensity = 0.5, minGapMs = 1200) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this._lastCheerAt < minGapMs) return;
    this._lastCheerAt = now;
    this.play('cheer', { volume: 0.9, intensity: Math.max(0.05, Math.min(1, intensity)) });
    if (this._crowd && this._ctx) this._swellCrowd(intensity);
  }

  /** Temporary wash bump under a cheer, then settle back. */
  _swellCrowd(intensity) {
    const g = this._crowd.gain.gain;
    const t = this._ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this._crowdLevel() + intensity * 0.05, t, 0.1);
    g.setTargetAtTime(this._crowdLevel(), t + 1.6, 0.5);
  }

  /* ---------------- Volume ---------------- */

  /** Sets the master volume (0..1), smoothed to avoid clicks. */
  setMasterVolume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this._ctx && this._master) {
      // R25: never reopen audio while muted — the UI still reads Sound off.
      const target = this._muted ? 0 : this._volume;
      this._master.gain.setTargetAtTime(target, this._ctx.currentTime, 0.02);
    }
  }

  /** Mute toggle (pause overlay Sound button). Restores the last volume. */
  toggleMute() {
    if (this._muted) this.setMuted(false);
    else this.setMuted(true);
  }

  setMuted(m) {
    this._muted = !!m;
    const localStorage2 = (typeof localStorage !== 'undefined') ? localStorage : null;
    if (localStorage2) localStorage2.setItem('sk3d.muted', m ? '1' : '0'); // AUDIT MED: single persistence source
    if (!this._ctx || !this._master) return;
    if (this._muted) {
      this._master.gain.cancelScheduledValues(this._ctx.currentTime);
      this._master.gain.setTargetAtTime(0, this._ctx.currentTime, 0.02);
    } else {
      this._master.gain.cancelScheduledValues(this._ctx.currentTime);
      this._master.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.02);
    }
  }

  get muted() {
    return !!this._muted;
  }

  /** Sets the music bus volume (0..1), independent of master. */
  setMusicVolume(v) {
    this._musicVolume = Math.max(0, Math.min(1, v));
    if (this._music) this._music.setVolume(this._musicVolume);
    if (this._menuMusic) this._menuMusic.setVolume(this._musicVolume * 0.55);
  }

  /** Temporary music duck (AUDIT MED + AUDIT R59): DUCK de verdade — abaixa
   *  a música momentaneamente para destacar o SFX (finish/victory), sem
   *  escrever _musicVolume (o antigo setMusicVolume(1) vazava e todas as
   *  corridas seguintes começavam em volume cheio; e duckMusic(1,...) era o
   *  OPOSTO — levantava a música a 100% no momento mais saturado). */
  duckMusic(v, ms) {
    const target = Math.min(1, Math.max(0.1, this._musicVolume * v));
    if (this._music) this._music.setVolume(target);
    if (this._menuMusic) this._menuMusic.setVolume(target * 0.55);
    if (ms) {
      if (this._duckTimer) clearTimeout(this._duckTimer);
      const generation = ++this._duckGeneration;
      this._duckTimer = setTimeout(() => {
        this._duckTimer = null;
        if (generation !== this._duckGeneration) return;
        if (this._music) this._music.setVolume(this._musicVolume);
        if (this._menuMusic) this._menuMusic.setVolume(this._musicVolume * 0.55);
      }, ms);
    }
  }

  /** True once the context + master chain exist. */
  get isReady() {
    return this._ctx !== null && this._master !== null;
  }

  /* ---------------- Lifecycle ---------------- */

  destroy() {
    this._detachUnlock();
    this.stopMusic();
    this.stopMenuMusic();
    this.clearEngineLoops();
    if (this._ctx) {
      try {
        this._ctx.close();
      } catch { /* context already closed */ }
      this._ctx = null;
      this._master = null;
    }
  }
}
