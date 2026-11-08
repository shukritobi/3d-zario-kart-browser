/**
 * Super Kart 3D.js — central tuning constants.
 * Single source of truth for gameplay, physics and rendering knobs.
 * UI copy is 100% English (project convention).
 */

export const CONFIG = {
  game: {
    totalLaps: 3,
    numKarts: 6, // 1 player + 5 AI
    countdownMs: [3, 2, 1, 0], // 0 === GO
    itemBoxRespawnMs: 6000,
    raceTimeoutMs: 5 * 60 * 1000,
  },

  cc: {
    // Engine-class difficulty selector (audit r3: "no difficulty layer").
    // Multipliers scale CONFIG.physics.maxSpeed/boostSpeed at race start
    // (main.js). The AI rubber-band ceiling is derived from maxSpeed in
    // AIController, so the whole field scales together with the player.
    levels: [50, 100, 150],
    default: 100,
    multipliers: {
      50: 0.78,
      100: 1.0,
      150: 1.22,
    },
  },

  physics: {
    maxSpeed: 42,
    rubberBandCap: 0.12, // AI total speed ceiling over player maxSpeed (cap coins+rubber combined)
    boostSpeed: 64,
    reverseSpeed: -12,
    acceleration: 26,
    braking: 40,
    steerSpeed: 1.9, // rad/s at full speed (was 2.6 — too jerky)
    steerSpeedLow: 3.2, // rad/s when slow
    driftSteer: 3.6,
    driftMinSpeed: 12,
    driftChargeRate: 0.55, // 0..1 per second while drifting (audit r3: 1.0 made
    // tier sparks hit at 0.2-0.33s and auto-fire at ~1.3s — 2× faster than
    // MK8D's 1.1/1.7/2.2s sparks / 2.6s auto; chaining minis was free)
    driftReleaseBoost: 0.75, // mini-boost if charge >= this
    friction: 3.2,
    lateralGrip: 8.5,
    gravity: -32,
    kartMass: 1.0,
    collisionBounce: 0.35,
    airControl: 1.2,
  },

  kart: {
    chassisLength: 1.7,
    chassisWidth: 1.05,
    chassisHeight: 0.55,
    wheelRadius: 0.34,
    wheelWidth: 0.30, // AUDIT visual 2026-08-12: MK8 tires are chunky (w/d ~0.5)
    playerColors: [0xff5a5f, 0x2ec4ff, 0xffd166, 0x6cff8f, 0xc86bff, 0xff9f45],
    // Roster of 6 drivers — each kart gets a character so karts and their
    // chibi drivers are visually distinct: body color, racing suit, helmet
    // and a colored helmet stripe (accent). `stats` (1-10) are applied to
    // physics: speed → top speed (±8% around the 7 baseline), accel →
    // throttle, handling → steering (main.js for the player; AIController
    // already scales AI drivers) — roster choice is never cosmetic.
    characters: [
      { name: 'Turbo', color: 0xff5a5f, suitColor: 0xf4f6f8, helmetColor: 0xffd166, accentColor: 0xffd166, stats: { speed: 8, accel: 5, handling: 7 } },
      { name: 'Comet', color: 0x2ec4ff, suitColor: 0x1b2a41, helmetColor: 0xf4f6f8, accentColor: 0xffffff, stats: { speed: 9, accel: 4, handling: 5 } },
      { name: 'Bolt', color: 0xffd166, suitColor: 0xff5a5f, helmetColor: 0xff5a5f, accentColor: 0x1b2a41, stats: { speed: 6, accel: 9, handling: 5 } },
      { name: 'Daisy', color: 0x6cff8f, suitColor: 0xff9ff0, helmetColor: 0xf4f6f8, accentColor: 0xffffff, stats: { speed: 5, accel: 6, handling: 9 } },
      { name: 'King', color: 0xc86bff, suitColor: 0xffd166, helmetColor: 0xffd166, accentColor: 0x2ec4ff, stats: { speed: 6, accel: 7, handling: 7 } },
      { name: 'Pip', color: 0xff9f45, suitColor: 0x2ec4ff, helmetColor: 0x2ec4ff, accentColor: 0xffd166, stats: { speed: 5, accel: 8, handling: 7 } },
    ],
  },

  track: {
    // Track shape is defined by waypoints in TrackBuilder; these are global
    // visual/geometry knobs shared with physics collision.
    roadWidth: 9,
    roadEdge: 0.9, // grass margin width
    curveSmoothness: 40, // segments per curve
    offRoadMaxSpeedFactor: 0.45,
    // Turbo pad cluster centers (normalized path positions). KartPhysics
    // triggers a boost when a kart's progress01 is within 0.015 of one.
    // AUDIT (city redesign, 2026-08-11): 0.72 sat on the lower-right corner
    // apex of the new '2' layout (boost mid-corner shoves karts wide);
    // 0.78 is mid-bottom-straight.
    turboPadTs: [0.18, 0.78],
  },

  items: {
    boxRadius: 0.7, // cube edge/2 — AAA REBUILD: was 1.0 (2m cube dominated
    // every frame, MK8D item boxes are ~1.4m and read as pickups, not props)
    boxBobSpeed: 2.0,
    pickupRadius: 2.8, // generous — at 43 m/s the kart crosses 2.1m per 0.05s frame
    // AUDIT (Feco, 2026-08-11): 'a velocidade que ele é arremessado é lenta' —
    // 46 m/s vs a kart at ~42 was a ~4 m/s relative gain: a thrown shell barely
    // outran its owner. MK8 shells are thrown ~1.6-1.8x kart speed; 72 m/s
    // (~1.7x) makes the throw read as a proper shot while still dodgeable.
    shellSpeed: 84,
    shellHomingTurnRate: 3.2,
    // AUDIT r4: blue shell ARC — the spiny flies high (telegraph) before
    // diving. lift 13 m/s launch, gravity 9.8 brings it down in ~2.6s.
    blueShellLift: 13,
    blueShellGravity: 9.8,
    bananaRadius: 0.7,
    starDurationMs: 4000,
    lightningDurationMs: 4500,
    lightningScale: 0.55,
    mushroomBoostMs: 1500,
    // AUDIT r4: hold the item button this long to arm a REAR throw (the
    // MK8D hold-to-throw-back skill — release fires shells/bananas backward).
    rearHoldMs: 350,
    maxHeldItems: 2, // MK8 dual-slot: primary + reserve (audit r3: "no hold/swap")
    tripleChance: 1 / 6, // ~1 in 6 item boxes grants 3 queued items (MK8 triple)
    coinCount: 10, // gold coins placed near the road edge
    coinPickupRadius: 2.4,
    coinSpeedBonus: 0.01, // +1% maxSpeed per coin collected
    coinSpeedCap: 0.10, // +10% max coin bonus (10 coins)
  },

  ai: {
    rubberBandFactor: 0.5,
    targetSpeedError: 8,
    steerPredictAhead: 10.0, // AUDIT F3: 6m was 143ms at max speed — too short for clean cornering on the tight city circuit (heading err dropped 16->6 deg); 10m keeps turn-in early without over-rotating.
    itemUseChancePerSec: 0.5,
    crashRecoverMs: 500, // AI re-grips 0.5s after a spin ends (was 1200: long idle)
  },

  assist: {
    // Accessibility assists (audit r3) — the menu toggles override these
    // defaults and persist the choice in localStorage.
    autoAccelerate: false,      // keep the throttle pinned unless braking
    steerAssist: false,         // gentle pull toward the track centerline
    steerAssistGain: 0.5,       // assist strength (fraction of full AI authority)
    steerAssistAuthority: 1.4,  // player input magnitude at which assist fades out
  },

  camera: {
    fov: 68, // AUDIT r17 (Feco real-GPU): the 7.2m/3.4m chase made the kart
    // tiny in frame and the FINISH gantry dominate. MK8D keeps the kart
    // ~25-30% of the frame: closer (5.7m), lower (2.6m), wider FOV 68.
    // (r20: 5.2 cropped the kart at the bottom edge — 5.7 keeps the size
    // without the heavy crop.)
    followDistance: 4.3, // AUDIT R5: critic recommended 4.0-4.3m — kart is the subject of the frame
    neonFollowExtra: 0.55, // Neon has denser rails/lighting; reveal more route without shrinking Meadow
    followHeight: 2.3,
    lookAhead: 4.6,
    lookHeight: 1.2,
    lerp: 5.0,
    shakeIntensity: 0.02,
  },

  render: {
    antialias: true,
    pixelRatioCap: 2,
    // Gameplay baseline: bloom disabled until emissive layers are isolated.
    // Global glow was reading as a dreamlike veil on the real GPU.
    bloomStrength: 0.0,
    bloomRadius: 0.0,
    bloomThreshold: 1.50,
    vignetteStrength: 0.08, // AUDIT 2026-09-02 AAA: 0.12→0.08 — halo branco radial nos cantos (critic 4/10) vinha de vignette+bloom radius; reduzir
    colorGradeSaturation: 1.25, // AUDIT R21e: 1.45→1.25 — saturava o glow âmbar do bloom em oliva no chão noturno // AUDIT r17 (Feco real-GPU + pixel-measured
    // critic): ACES tone mapping in OutputPass DESSATURATES — the grade
    // must fight it. Measured: sat 87/255 mean + 21% dead-grey on the real
    // GPU frame = washed. 1.45 restores the MK8 punch AFTER the ACES eats
    // its share. (Headless QA never sees this — no grade there.)
    colorGradeContrast: 1.25,
    shadows: true,
    shadowMapSize: 2048,
    testShadowMapSize: 1024, // used when ?test is active (QA speed)
  },

  audio: {
    masterVolume: 0.8,
    musicVolume: 0.34,
    engineVolume: 0.5,
  },

  debug: {
    showWaypoints: false,
    showPhysicsDebug: false,
    logFps: false,
  },
};
