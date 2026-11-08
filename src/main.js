/**
 * Super Kart 3D.js — main bootstrap & wiring (controller-owned).
 * Boots the full stack: scene → environment → track → postfx → audio →
 * race → menu/HUD/touch. Handles game state machine, camera follow,
 * keyboard input and the ?demo cinematic autopilot used by visual QA.
 */
import { autoInstancing } from './perf/instancing.js';
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createScene } from './render/SceneManager.js';
import { GameLoop } from './game/GameLoop.js';
import { setState, getState, STATES, onStateChange } from './game/GameState.js';
import { buildTrack, TRACK_PATH, CITY_PATH } from './track/TrackBuilder.js';
import { Environment } from './track/Environment.js';
import { PostFX } from './render/PostFX.js';
import { AudioManager } from './audio/AudioManager.js';
import { RaceManager } from './game/RaceManager.js';
import { Kart } from './entities/Kart.js';
import { AIController } from './entities/AIController.js';
import { createItemBoxes, ItemBox } from './entities/ItemBox.js';
import { ParticleSystem } from './render/Particles.js';
import { SkidMarks } from './effects/SkidMarks.js';
import { updateWind } from './render/Materials.js'; // PREMIUM PASS: vento na grama/palmeiras
import { Menu } from './ui/Menu.js';
import { HUD } from './ui/HUD.js';
import { TouchControls } from './ui/TouchControls.js';
import { signedAngle } from './entities/PowerUp.js'; // steer-assist steering math (shared with AIController)
import { createBootOverlay } from './ui/BootOverlay.js';

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const container = document.getElementById('app');
const bootOverlay = createBootOverlay();
const bootHold = new URLSearchParams(location.search).get('boothold');
bootOverlay.setStage('starting renderer', 0.04);
if (bootHold) window.__boothold = bootOverlay; // dev/test: freeze overlay for visual QA
const { scene, camera, renderer, qualityProfile, capabilityProbe } = createScene(container);

const DEMO = new URLSearchParams(location.search).has('demo');
const TEST = new URLSearchParams(location.search).has('test'); // fast no-postfx mode for gameplay testing
// Must be initialized before the optional DEMO/TEST auto-start below. `let`
// declarations are in TDZ until execution reaches their original declaration;
// TEST boot used to call startRace() first and throw before the menu existed.
let startRacePending = false;
let deferredKartDisposals = [];
// Track select: the menu's TRACKS screen publishes window.__sk3dTrack
// before reloading with ?track=2, so the persisted choice wins on boot and
// the query param covers the very first load (defaults to the meadow circuit).
let savedTrackId = 0;
try { savedTrackId = Number(localStorage.getItem('sk3d.track')); } catch { /* private mode */ }
const TRACK_ID =
  Number(window.__sk3dTrack) === 2 || savedTrackId === 2 ||
  Number(new URLSearchParams(location.search).get('track')) === 2 ? 2 : 1;
bootOverlay.setStage('reading controls', 0.10);

// Difficulty/accessibility (audit r3): the CC selector scales the physics
// speed envelope through CONFIG.physics, which KartPhysics reads live every
// frame. Bases are captured BEFORE startRace() mutates them.
const BASE_MAX_SPEED = CONFIG.physics.maxSpeed;
const BASE_BOOST_SPEED = CONFIG.physics.boostSpeed;

const env = new Environment();
env.trackId = TRACK_ID; // theme hook: 1 = sunny meadow, 2 = neon city
bootOverlay.setStage('laying the circuit', 0.22);
const track = buildTrack(scene, TRACK_ID === 2 ? CITY_PATH : TRACK_PATH);
  // MK8 turbo strips breathe (Feco QA 2026-08-12): additive glow overlay pulse.
  const turboGlowMat = (track.turboPads && track.turboPads.glowMat) || null;
env.buildEnvironment(scene, track); // track passed so props avoid the road
bootOverlay.setStage('dressing the world', 0.34);

// AUDIT PERF (2026-08-13): instancing pós-build — vegetação/posts/placas
// repetidos em InstancedMesh (764 → ~250 draw calls no Meadow).
const mergedCount = (window.location.search.includes('noinst') ? 0 : autoInstancing(scene));
console.log('[perf] auto-instancing merged', mergedCount, 'meshes');
bootOverlay.setStage('lighting effects', 0.52);
// Image-based lighting: chrome + car paint need an env map or metalness
// renders BLACK. A procedural SUNNY-SKY env (instead of the grey RoomEnvironment)
// makes clearcoat/paint reflect vivid sky blue — the console-racer look.
function buildSkyEnv(renderer) {
  const envScene = new THREE.Scene();
  const skyGeo = new THREE.SphereGeometry(50, 32, 16);
  const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 512;
  skyCanvas.height = 256;
  const g = skyCanvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  if (TRACK_ID === 2) {
    // NEON CITY IBL: deep purple night sky so clearcoat/chrome reflect the
    // city, not the meadow day (vision critic: karts showed no neon).
    grad.addColorStop(0, '#141030');
    grad.addColorStop(0.55, '#26204e');
    grad.addColorStop(0.78, '#3a2a6a');
    grad.addColorStop(1, '#0e0e24');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
    // neon light clusters — bright pink/cyan points that read as city signs
    // in the reflections (small + intense = hard clearcoat highlights).
    // AUDIT R21d: AMARELO (#ffe23c) REMOVIDO — o env map tinge todo material
    // PBR e o concreto do chão lia OLIVA em toda parte. Só neons frios agora.
    const neon = ['#ff2ec4', '#2ec4ff'];
    for (let i = 0; i < 14; i++) {
      g.fillStyle = neon[i % 2]; // AUDIT R21d: 3→2 (amarelo fora)
      g.globalAlpha = 0.9;
      g.beginPath();
      g.arc(40 + Math.random() * 430, 30 + Math.random() * 120, 5 + Math.random() * 7, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  } else {
    // PREMIUM PASS (2026-08-21): IBL casando com o novo domo shader — azul
    // mais profundo no zênite, horizonte quente de sunset. O clearcoat/chrome
    // dos karts reflete o MESMO céu que se vê, não um gradiente genérico.
    grad.addColorStop(0, '#2e8fd8');   // deep sky (uTop do domo)
    grad.addColorStop(0.55, '#7cc3f0'); // mid sky (uMid)
    grad.addColorStop(0.78, '#ffe3c2'); // horizon WARM (banda sunset)
    grad.addColorStop(1, '#9ccf8f');   // ground tint esverdeado (campo)
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
  }
  if (TRACK_ID === 2) {
    // NEON CITY: a MOON disc (warm white, small) — the daylight sun specular
    // on clearcoat under moonlight was a glaring day cue (audit MED).
    g.fillStyle = '#e8ecf8';
    g.beginPath();
    g.arc(128, 48, 18, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.35;
    g.fillStyle = '#aab4e8';
    g.beginPath();
    g.arc(128, 48, 44, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  } else {
    // bright sun disc — BRIGHTER than ambient so clearcoat/chrome get a
    // strong, defined reflection (vision critic: gloss reads but is weak).
    g.fillStyle = '#fffbe0';
    g.beginPath();
    g.arc(128, 40, 30, 0, Math.PI * 2);
    g.fill();
    // hard sun core (sharp reflection highlight)
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(128, 40, 14, 0, Math.PI * 2);
    g.fill();
    // soft sun glow
    g.globalAlpha = 0.45;
    g.fillStyle = '#fff3c0';
    g.beginPath();
    g.arc(128, 40, 70, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(skyCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  skyMat.map = tex;
  envScene.add(new THREE.Mesh(skyGeo, skyMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  // AUDIT PERF-R46 (2026-08-14, auditoria memória #14): a cena auxiliar do
  // PMREM (skyGeo/skyMat/tex) ficava retida sem dispose (~700KB-1MB GPU).
  skyGeo.dispose();
  skyMat.dispose();
  tex.dispose();
  return envTex;
}
scene.environment = buildSkyEnv(renderer);

const postfx = new PostFX(renderer, scene, camera, qualityProfile);
// When global bloom is disabled for gameplay readability, bypass the entire
// composer too. The mobile GPU A/B showed the composer path itself introduces
// a white veil even with BloomPass strength=0; direct renderer output is crisp.
if (CONFIG.render.bloomStrength <= 0) postfx.enabled = false;
// AUDIT R21k: grade NEUTRO no Neon — warmth+saturation empurravam o glow
// difuso do horizonte para verde-oliva (vision: ?nobl = haze some). Noite
// MK8: cores frias fiéis ao render, sem grade dourado. Os uniforms vivem em
// pass.uniforms[...] do ShaderPass APÓS build (MaterialPass), mas o acesso
// seguro é via pass.material.uniforms.
if (TRACK_ID === 2) {
  for (const pass of postfx.composer.passes) {
    const u = pass.uniforms || (pass.material && pass.material.uniforms);
    if (u && u.warmth) {
      u.warmth.value = 0;
      if (u.saturation) u.saturation.value = 1.0;
    }
  }
}
bootOverlay.setStage('loading race systems', 0.68);
if (TEST) postfx.enabled = false; // software GL runs ~30x faster without bloom
const audio = new AudioManager();
const particles = new ParticleSystem(scene);
const skids = new SkidMarks(scene);
const raceManager = new RaceManager(scene, camera);
const hud = new HUD(track);
// AUDIT r3 dual-slot: the HUD's mini reserve slot is clickable — the touch
// counterpart to the Tab swap key (Swap itself runs in Kart.swapHeldItems;
// this just feeds it the click).
hud.onSwap = () => {
  if (playerKart && playerKart.swapHeldItems) playerKart.swapHeldItems();
};
hud._onPositionChange = (dir) => {
  // Overtake/loss feedback (audit UX-v3 F2): subtle blips, player only.
  audio.play(dir === 'up' ? 'posUp' : 'posDown', { volume: 0.5 });
};
hud._onDriftReady = () => {
  // Beep the instant the drift charge hits the release point (audit v4 F9).
  audio.play('driftReady', { volume: 0.5 });
};
const menu = new Menu({
  onStart: startRace,
  onColor: setPlayerColor,
  onSound: (n) => audio.play(n),
  onToggleMute: (muted) => audio.setMuted(muted), // AUDIT MED: single mute source (sets _muted + master + persists) — pause Sound and menu stay in sync
  onVolume: (v) => {
    // AUDIT v5 MED: master volume slider — also updates the unmute restore
    // target so unmuting returns to the USER's level, not the default 0.8.
    CONFIG.audio.masterVolume = v;
    audio.setMasterVolume(v);
  },
});
menu.restoreMute(); // persisted mute state (audit minor)
const touch = new TouchControls({ onSteer: setTouchSteer, onItem: () => pressItem(), onPause: togglePause, onDrift: (b) => { touchDrift = b; } });
bootOverlay.setStage('drawing the HUD', 0.82);
// AUDIT r4: the touch item button only reports presses — wire the release
// edges here so hold-to-throw-back works on touch too (pointerup/cancel/leave).
touch.itemBtn.addEventListener('pointerup', () => releaseItem());
touch.itemBtn.addEventListener('pointercancel', () => releaseItem());
touch.itemBtn.addEventListener('pointerleave', () => releaseItem());

// Default player color matches their character's identity color; the menu
// picker can override it (setPlayerColor → setBodyColor).
let playerColor = CONFIG.kart.characters[0].color;
let playerKart = null;
let aiKarts = [];
let countdownT = 0;
let countdownIndex = -1;
let offroadT = 0.55; // off-road gravel SFX accumulator (feedback audit)
let lastHeldItem = null;
let lastHeldItem2 = null; // reserve-slot toast tracker (audit r3 dual-slot)
let suppressNextItemToast = 0; // swap feedback replaces the pickup fanfare for 1 frame
// AUDIT r8 (item roulette anticipation): the pickup toast reveal is delayed
// ~0.45s (MK8D roulette spins 0.4-0.5s before the reveal) — generation-guarded
// so a newer pickup / item use / swap cancels the pending announce.
let pickupRevealGen = 0;
let pickupRevealTimer = null;
const ITEM_ROULETTE_MS = 450; // shuffle duration before the item name is revealed
// AUDIT r4 (rear throw): hold-to-arm-back input state. itemPressT records when
// the item button went down (-1 = up); crossing REAR_HOLD_MS while held flips
// the item bubble (Kart.setItemRear) and the release fires REARWARD.
let itemPressT = -1;
let rearArmed = false;
let lastLap = 0;
let finalLapShown = false; // FINAL LAP callout (audit v5 #5)
let driftScreechAcc = 0; // drift tire screech accumulator
let aiScreechAcc = 0;    // AI drift screech accumulator (v4 F5)
let hudIdleT = 0;        // AUDIT imersão R11: auto-hide do HUD no touch
let dustAcc = 0;         // off-road dust accumulator
let turboParticleAcc = 0; // accumulator: burst once per 0.1s while turbo-boosting

// Difficulty/accessibility settings (audit r3): refreshed by applyDifficulty()
// at every race start from the menu's live choices (window.__sk3d*).
let settings = { cc: CONFIG.cc.default, autoAccel: false, steerAssist: false };

// Boot lands on the title menu (menu overlay + orbit camera).
setState(STATES.MENU);
menu.show();
// AUDIT R18 (Feco real-GPU 2026-08-14: 'tela congela ao clicar Start
// Game'): compila os shaders ANTES do clique — cria 1 kart fantasma por
// personagem do roster + 1 item box invisíveis, renderiza UM frame e
// descarta. O custo sai do startRace() (síncrono no clique) e vai para o
// boot (com o menu ainda por cima). GPU compila shader uma vez e reusa.
function prewarmShaders() {
  if (DEMO || TEST) return; // test mode pula direto; demo já paga no start
  const warmKarts = [];
  try {
    for (const ch of CONFIG.kart.characters) {
      const k = new Kart({ character: ch, isPlayer: false });
      k.group.visible = false;
      k.group.position.set(0, -50, 0); // longe do menu/orbit cam
      scene.add(k.group);
      warmKarts.push(k);
    }
    const warmBox = new ItemBox(track, 0.045, 1);
    if (warmBox.mesh) { warmBox.mesh.visible = false; scene.add(warmBox.mesh); }
    if (warmBox.beam) { warmBox.beam.visible = false; scene.add(warmBox.beam); }
    if (warmBox.ring) { warmBox.ring.visible = false; scene.add(warmBox.ring); }
    renderer.render(scene, camera); // compila todos os shaders
    // AUDIT PERF-R30 (2026-08-14, auditoria memória #3): scene.remove() não
    // liberava buffers WebGL — geometrias/materiais ficavam retidos (2-3MB).
    // Dispose de tudo ANTES de remover (padrão do startRace), sem tocar em
    // texturas do cache global (_visorCache etc.).
    const disposeTree = (root) => {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m.map && m.map.userData && m.map.userData.shared) { m.map = null; }
            m.dispose();
          }
        }
      });
    };
    for (const k of warmKarts) { disposeTree(k.group); scene.remove(k.group); }
    if (warmBox.mesh) { disposeTree(warmBox.mesh); scene.remove(warmBox.mesh); }
    if (warmBox.beam) { disposeTree(warmBox.beam); scene.remove(warmBox.beam); }
    if (warmBox.ring) { disposeTree(warmBox.ring); scene.remove(warmBox.ring); }
    console.log('[perf] shaders pre-warmed (', warmKarts.length, 'karts + 1 box )');
  } catch (err) {
    for (const k of warmKarts) scene.remove(k.group);
    console.warn('[perf] prewarm failed (non-fatal):', err);
  }
}
if (false && typeof Kart !== 'undefined' && typeof ItemBox !== 'undefined') prewarmShaders(); // disabled: hidden-rig render throws on some mobile/WebGL drivers and causes a boot freeze; startRace now yields across frames
if (DEMO || TEST) startRace(); // demo autopilot / fast test mode jump straight in

// Quality gate (audio lifecycle): pause all audio when the tab is hidden.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    audio.suspend();
  } else {
    audio.resume();
  }
});

// ---------------------------------------------------------------------------
// Karts
// ---------------------------------------------------------------------------
function buildGridPositions(count) {
  // 2 rows x 3 cols behind the start line
  const out = [];
  const dir = track.startLine.direction.clone().normalize();
  const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  for (let i = 0; i < count; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const pos = track.startLine.position
      .clone()
      .addScaledVector(dir, -(row + 1) * 4.6) // AUDIT r18: 3.6→4.6 row,
      .addScaledVector(perp, (col - 1) * 3.4); // 2.7→3.4 col — the vision
    // critic read the pack as 'cramped / wheels merge'. MK8 grid gaps.
    pos.y += 0.1;
    out.push({ position: pos, heading: Math.atan2(dir.x, dir.z) });
  }
  return out;
}

function setPlayerColor(color) {
  playerColor = color;
  if (playerKart) {
    playerKart.setBodyColor(color);
  }
  // Persist the pick (audit minor: color was lost on refresh).
  try {
    localStorage.setItem('sk3d.color', String(color));
  } catch { /* private mode */ }
}

// Restore persisted kart color (audit minor) + sync the menu picker (v4 F2).
(function restoreColor() {
  try {
    const saved = localStorage.getItem('sk3d.color');
    if (saved) {
      const c = Number(saved);
      if (Number.isFinite(c)) {
        playerColor = c;
        menu.setSelectedColor?.(c);
      }
    }
  } catch { /* private mode */ }
})();

/** Drift mini-boost drama: SFX + golden spark burst on release (all karts). */
function wireGrassExit(kart) {
  // AUDIT MED: the off-road exit kick was real but SILENT — no listener on
  // _onGrassExit anywhere. Give it a pop + dust burst like the drift boost.
  kart._onGrassExit = () => {
    if (kart.isPlayer) {
      audio?.play('driftReleaseMiniBoost', { volume: 0.5 });
    }
    particles?.burst?.(kart.group.position, { count: 10, color: 0xb8a37a, speed: 4, size: 0.22, spread: 0.5, life: 0.5 });
  };
}

function wireMiniBoost(kart) {
  kart._onHit = (type) => {
    // PLAYER hit feedback (user request): red screen flash + label + shake —
    // getting hit by a banana/shell was unreadable before.
    if (!kart.isPlayer) {
      // AUDIT MED: AI hits were INVISIBLE — a small spark burst + quiet thud
      // so the player sees the rival got hit (their spin already shows).
      particles?.burst?.(kart.group.position, { count: 8, color: 0xffd23c, speed: 3, size: 0.18, spread: 0.4, life: 0.4 });
      audio?.play?.('banana', { volume: 0.25 }); // AUDIT v4: bananaBoing was dead code (no sfx case) — use the real recipe
      return;
    }
    hud.showHitFlash();
    const label = type === 'banana' ? '💥 BANANA!' : type === 'blue' ? '💥 BLUE SHELL!' : '💥 SHELL HIT!';
    hud.showMessage(label);
    addShake(0.5, 0.5);
    touch?.pulse?.('hit');
  };
  kart._onLightning = () => {
    // AUDIT (power-up audit, 2026-08-11): lightning hit the player with only
    // a shrink — no telegraph. MK8D: electric screen flash + thunder + shake.
    if (!kart.isPlayer) return;
    hud.showHitFlash('electric');
    audio?.play?.('lightning', { volume: 0.9 });
    addShake(0.6, 0.6);
    touch?.pulse?.('hit');
  };
  kart._onDraftExit = () => {
    // Slingshot pop when leaving a wake (player only).
    if (kart.isPlayer) audio.play('driftReleaseMiniBoost', { volume: 0.5 });
  };
  kart._onTrick = () => {
    // Trick landing boost — sparkle burst + pop (mostly for the player).
    // AUDIT r8 (MK8D blue-shell dodge counterplay): a trick landed within
    // ~1s of the spiny's dive grants a 900ms invincibility window — the
    // classic well-timed-hop dodge. PowerUp._blueDodged also consults
    // _lastTrickAt, so the dodge holds even if setInvincible gets cleared
    // early by an overlapping effect.
    kart._lastTrickAt = performance.now();
    kart.setInvincible?.(true, 900);
    if (kart.isPlayer) {
      audio.play('driftReleaseMiniBoost', { volume: 0.7 });
      particles.emit('sparkle', kart.group.position, { count: 16, speed: 5, size: 0.3 });
    }
  };
  kart._onLand = () => {
    // Soft thump on touchdown — mostly for the player (AI landings are quiet).
    if (kart.isPlayer) audio.play('landing', { volume: 0.5 });
    touch?.pulse?.('land');
  };
  kart._onRescued = () => {
    // AUDIT r7: the Lakitu hook was producer-only dead code — a rescued
    // player got only a shake. Now: toast + item-lost feedback.
    if (kart.isPlayer) {
      hud.showMessage('🧑‍✈️ LAKITU!', 1800);
      addShake(0.3, 0.3);
    }
  };
  kart._onMiniBoost = (charge01 = 1) => {
    const v = (kart.isPlayer ? 0.8 : 0.45) * (0.5 + charge01 * 0.5);
    audio.play('driftReleaseMiniBoost', { volume: v, pan: (kart.group.position.x - playerKart.group.position.x) * 0.02 });
    if (kart.isPlayer) touch?.pulse?.('miniBoost');
    if (particles) {
      particles.emit('sparkle', kart.state.position.clone().add(new THREE.Vector3(0, 0.6, 0)), {
        count: Math.round(5 + charge01 * 13), speed: 3.0 + charge01 * 2.5, size: 0.22, spread: 1.4 + charge01 * 0.4, color: 0xffd166,
      });
    }
  };
  kart._onDriftTier = (tier = 1) => {
    // Drift charge tier cue (audit r2/r9): beep + spark burst at 0.33/0.66/0.9
    // (tier 1 = blue tick, tier 2 = orange blip, tier 3 = purple flash —
    // MK8D's three spark colors).
    const v = kart.isPlayer ? 0.5 : 0.26;
    audio.play(tier === 1 ? 'uiClick' : 'posUp', {
      volume: v,
      pan: (kart.group.position.x - playerKart.group.position.x) * 0.02,
    });
    if (particles) {
      particles.emit('sparkle', kart.state.position.clone().add(new THREE.Vector3(0, 0.6, 0)), {
        count: tier === 1 ? 6 : tier === 2 ? 10 : 16, speed: 3.2, size: 0.18,
        spread: 1.0 + tier * 0.2,
        color: tier === 1 ? 0x9adcff : tier === 2 ? 0xffa64d : 0xc86bff,
      });
    }
  };
}

/** Selected driver index from the menu cards (window.__sk3dChar), clamped to
 *  the roster. Defaults to 0 (Turbo) when unset/invalid. */
function getPlayerCharIndex() {
  const n = CONFIG.kart.characters.length;
  const idx = Number(window.__sk3dChar);
  return Number.isFinite(idx) && idx >= 0 && idx < n ? idx : 0;
}

const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

async function buildKarts() {
  const slots = buildGridPositions(CONFIG.game.numKarts);
  const characters = CONFIG.kart.characters; // roster: [0] player, [1..5] AI
  // AUDIT r4: the menu's driver cards pick the player's character (was hard-
  // coded to characters[0]); applyPlayerStats() turns its stats into physics.
  const playerCharIdx = getPlayerCharIndex();
  // Player in slot 0 (back row center) unless demo.
  const playerSlot = DEMO ? 1 : 0;
  const playerPos = DEMO ? slots[1] : slots[0];

  playerKart = new Kart({
    color: playerColor, // menu picker wins; defaults to character[0].color
    character: characters[playerCharIdx],
    isPlayer: true,
    number: 1,
    startPosition: playerPos.position,
    startHeading: playerPos.heading,
  });
  scene.add(playerKart.group);
  wireMiniBoost(playerKart);
  // Swap feedback: a click blip + one frame without the pickup fanfare (the
  // frame-loop toast would otherwise re-announce the item as a fresh pickup).
  playerKart._onSwap = () => {
    audio.play('uiClick');
    suppressNextItemToast = 1;
  };
    playerKart._onWrongWay = () => {
      // Play a short alarm sound
      audio.play('crash', { volume: 0.5 });
      // Show HUD message
      hud.showMessage('WRONG WAY!', 1500);
      // Optionally add a screen shake
      addShake(0.4, 0.4);
      touch?.pulse?.('wrongWay');
    };

  // Let the first kart paint before constructing the five AI karts.
    playerKart._onTurboBoost = () => {
    // Play turbo boost sound
    audio.play('boost', { volume: 0.6 });
    // Optionally add a small screen shake
    addShake(0.2, 0.2);
    touch?.pulse?.('boost');
  };
  await yieldFrame();

  aiKarts = [];
  let aiNum = 2;
  // AUDIT r4: AI drive the REST of the roster (never the player's pick — no
  // duplicate drivers on the grid). Cyclic over the 5 remaining characters.
  const aiRoster = characters.filter((_, i) => i !== playerCharIdx);
  let aiCharIdx = 0;
  for (let i = 0; i < CONFIG.game.numKarts; i++) {
    if (!DEMO && i === playerSlot) continue;
    if (DEMO && i === 1) continue; // slot 1 reserved for player visual
    const slot = slots[i];
    const kart = new Kart({
      character: aiRoster[aiCharIdx % aiRoster.length],
      isPlayer: false,
      number: aiNum++,
      startPosition: slot.position,
      startHeading: slot.heading,
    });
    aiCharIdx++;
    scene.add(kart.group);
    wireGrassExit(kart);
    wireMiniBoost(kart);
    aiKarts.push(kart);
      playerKart._onTurboBoost = () => {
    // Play turbo boost sound
    audio.play('boost', { volume: 0.6 });
    // Optionally add a small screen shake
    addShake(0.2, 0.2);
    touch?.pulse?.('boost');
  };
  await yieldFrame();
  }
  // NOTE: AI controllers are created by RaceManager.init() (single source of
  // truth — AUDIT FIX: main.js used to keep a duplicate local array whose
  // cruise controller leaked into restarts). The DEMO autopilot controller
  // for the player kart is added in startRace() after init().
}

// ---------------------------------------------------------------------------
// Input (desktop keyboard)
// ---------------------------------------------------------------------------
const input = { steer: 0, throttle: 0, brake: false, drift: false, swapItem: false };
const keys = new Set();
const REAR_HOLD_MS = CONFIG.items.rearHoldMs || 350; // hold ITEM to arm a rear throw

let touchSteer = 0;
let touchDrift = false;
// AUDIT r3 dual-slot: Tab queues a one-frame swapItem input (consumed by
// readKeyboardInput → setControls → Kart.update rising edge).
let swapQueued = false;

function setTouchSteer(v) {
  touchSteer = v;
}

function isTouchMode() {
  return matchMedia('(pointer: coarse)').matches || window.innerWidth <= 768;
}

function readKeyboardInput() {
  const left = keys.has('ArrowLeft') || keys.has('KeyA');
  const right = keys.has('ArrowRight') || keys.has('KeyD');
  const up = keys.has('ArrowUp') || keys.has('KeyW');
  const down = keys.has('ArrowDown') || keys.has('KeyS');
  input.steer = (right ? 1 : 0) - (left ? 1 : 0);
  input.throttle = up ? 1 : 0;
  input.brake = down;
  input.drift = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchDrift;
  input.swapItem = swapQueued;
  swapQueued = false;
}

function pressItem() {
  if (getState() !== STATES.RACE || !playerKart) return;
  // Dual-slot (audit r3): an item in EITHER slot can fire — useItem promotes
  // the reserve into the primary when the primary is empty.
  if (!playerKart.heldItem && !playerKart.heldItem2) return;
  if (itemPressT >= 0) return; // already holding — ignore repeat presses
  itemPressT = performance.now();
}

/** Release of the item button (audit r4): a quick tap throws FORWARD; a hold
 *  ≥ REAR_HOLD_MS (~0.35s) arms and throws BACK — the MK8D core skill. */
function releaseItem() {
  if (itemPressT < 0) return;
  const held = performance.now() - itemPressT;
  itemPressT = -1;
  disarmRear();
  if (getState() !== STATES.RACE || !playerKart) return;
  // The item can be knocked away mid-hold (lightning) — release is a no-op.
  if (!playerKart.heldItem && !playerKart.heldItem2) return;
  const rear = held >= REAR_HOLD_MS;
  if (rear) playerKart._rearThrow = true; // consumed by PowerUp.useItem
  const used = playerKart.heldItem || playerKart.heldItem2;
  raceManager.useItem(playerKart);
  playerKart._rearThrow = false; // cleared even if useItem bailed (no item)
  // Feedback: show what you just used (user: item use felt unclear).
  const LABELS = {
    mushroom: '🍄 MUSHROOM!', shell: '🐢 SHELL!', red_shell: '🔴 RED SHELL!',
    banana: '🍌 BANANA!', star: '⭐ STAR!', lightning: '⚡ LIGHTNING!', blue_shell: '🔵 BLUE SHELL!',
  };
  if (LABELS[used]) hud.showMessage(rear ? `↩️ ${LABELS[used]}` : LABELS[used]);
}

/** Reset the armed-rear visual when a hold ends, is cancelled or restarted. */
function disarmRear() {
  if (!rearArmed) return;
  rearArmed = false;
  playerKart?.setItemRear?.(false);
}

function clearTransientInput() {
  keys.clear();
  touch?.resetInput?.();
  touchSteer = 0;
  touchDrift = false;
  swapQueued = false;
  input.steer = 0;
  input.throttle = 0;
  input.brake = false;
  input.drift = false;
  input.swapItem = false;
  itemPressT = -1;
  disarmRear();
}

window.addEventListener('blur', clearTransientInput);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') clearTransientInput();
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  audio.init(); // first gesture unlocks audio (autoplay policy)
  hudIdleT = 0; // AUDIT imersão R11: input restaura o HUD
  if (typeof hud !== 'undefined' && hud && hud.setIdle && hud._idle) hud.setIdle(false);
  keys.add(e.code);
  const gameplayState = getState() === STATES.RACE || getState() === STATES.COUNTDOWN;
  if (e.code === 'Space' && gameplayState) {
    e.preventDefault();
    pressItem();
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    // Pause toggles handled by state machine below.
  }
  if (e.code === 'Tab' && getState() === STATES.RACE) {
    e.preventDefault(); // keep Tab from stealing focus during gameplay
    swapQueued = true;
  }
  if (e.code === 'KeyR') {
    if (getState() === STATES.FINISHED || getState() === STATES.RACE) restartRace();
    else if (getState() === STATES.PAUSED) restartRace();
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    togglePause();
  }
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  // AUDIT r4: the item fires on RELEASE (tap = forward, hold = back).
  if (e.code === 'Space') releaseItem();
});
window.addEventListener('pointerdown', () => {
  audio.init(); // first gesture unlocks audio (autoplay policy)
  hudIdleT = 0; // AUDIT imersão R11: toque restaura o HUD
  if (typeof hud !== 'undefined' && hud && hud.setIdle && hud._idle) hud.setIdle(false);
}, { once: false });
window.addEventListener('touchstart', () => audio.init(), { passive: true });

// ---------------------------------------------------------------------------
// Race lifecycle
// ---------------------------------------------------------------------------
const COUNTDOWN_MARKS = [3, 2, 1, 0]; // 0 === GO
const COUNTDOWN_STEP = TEST ? 0.25 : 0.6; // snappier start; test mode even faster

// Start-light animation on the gantry (countdown 3-2-1 → green on GO).
const LAMP_RED = 0xff3b30;
const LAMP_GREEN = 0x4ade80;
const LAMP_OFF = 0x3a4252;

function setStartLights(state) {
  // state: 0 = all off, 1..3 = n red lamps lit, 4 = all green
  if (!track.startLights) return;
  const green = state >= 4;
  const lit = Math.min(state, 3);
  track.startLights.forEach((lamp, i) => {
    const on = i < lit || green;
    lamp.material.color.setHex(on ? (green ? LAMP_GREEN : LAMP_RED) : LAMP_OFF);
    lamp.material.emissive.setHex(on ? (green ? LAMP_GREEN : LAMP_RED) : 0x000000);
    // SK3D FIX (2026-08-20, Feco real-GPU): emissive 1.4 → 0.85 — verdes no
    // GO liam como "balões verdes flutuantes" (glow excessivo). 0.85 mantém
    // a leitura de "luz acesa" sem saturar para orbes brilhantes.
    lamp.material.emissiveIntensity = on ? 0.6 : 0; // SK3D FIX: 0.85→0.6 — verdes no GO não leem como "balão verde"
  });
}

/** Apply the menu's CC + assist choices to the physics envelope (audit r3). */
function applyDifficulty() {
  const cc = Number(window.__sk3dCc) || CONFIG.cc.default;
  const mult = CONFIG.cc.multipliers[cc] || 1;
  settings.cc = cc;
  settings.autoAccel = !!window.__sk3dAutoAccel;
  settings.steerAssist = !!window.__sk3dSteerAssist;
  // AUDIT R49: player sem steerAssist → _disablePathPull=true (KartPhysics
  // zera o pull do path); o kart só vira com input real.
  if (playerKart) playerKart._disablePathPull = !settings.steerAssist;
  // KartPhysics/AIController read CONFIG.physics live each frame — scaling
  // maxSpeed/boostSpeed scales the player AND the AI rubber-band ceiling.
  CONFIG.physics.maxSpeed = BASE_MAX_SPEED * mult;
  CONFIG.physics.boostSpeed = BASE_BOOST_SPEED * mult;
  // AUDIT r5: gauge scale follows engine class (the needle used to PEG at
  // 150cc — MAX_KMH was a load-time constant). +10% headroom above top speed.
  if (typeof hud !== 'undefined' && hud && hud.setMaxKmh) {
    // 1.25 headroom: CC scale + coin bonus (+10%) + boost spikes
    hud.setMaxKmh(CONFIG.physics.maxSpeed * 2.4 * 1.25);
  }
}

/** Apply the player character's stats to physics (audit r3 — roster matters). */
function applyPlayerStats() {
  if (!playerKart) return;
  const st = (playerKart.character && playerKart.character.stats) || { speed: 7, accel: 7, handling: 7 };
  // speed → top speed ±8% around the 7 baseline (roster range 5..9);
  // accel → throttle (0.85..1.05); handling → steer authority (1.0..1.12).
  // Mirrors the AI drivers' stat curve in AIController.
  playerKart._statSpeed = 1 + (st.speed - 7) * 0.04;
  playerKart._statAccel = 0.6 + (st.accel / 10) * 0.5;
  playerKart._statSteer = 0.85 + (st.handling / 10) * 0.3;
  // KartPhysics targets `kart.cruiseSpeed || P.maxSpeed` — the player's
  // personal top speed. Kart.restart() wipes cruiseSpeed, so restartRace()
  // re-applies this after every race reset.
  playerKart.cruiseSpeed = CONFIG.physics.maxSpeed * playerKart._statSpeed;
}

/**
 * Steer assist: signed heading error toward the track centerline look-ahead.
 * Identical math to AIController (sign-verified in-game), returns -1..1.
 */
function centerlineAssist() {
  const cl = raceManager && raceManager.centerline;
  if (!cl || !cl.length || !playerKart) return 0;
  const pos = playerKart.state.position;
  // AUDIT r11 (#7, code audit): the old full-scan picked the nearest sample
  // IN SPACE — after a spin/off-road excursion on a curved loop that can be
  // a DIFFERENT track segment (tangent pointing the opposite way), so the
  // assist could nudge the player the WRONG way. Anchor on race progress
  // (same progress-anchored pattern as AIController._findNearest): the
  // assist only ever pulls toward the player's own race progress + look.
  const prog = playerKart.state && playerKart.state.progress01;
  let best = -1;
  if (typeof prog === 'number' && prog >= 0 && prog <= 1) {
    best = Math.min(cl.length - 1, Math.max(0, Math.round(prog * cl.length)));
  } else {
    let bestD = Infinity;
    for (let i = 0; i < cl.length; i++) {
      const dx = cl[i].x - pos.x;
      const dz = cl[i].z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  const spacing = raceManager.centerlineSpacing || 2.5;
  const look = Math.max(1, Math.round(CONFIG.ai.steerPredictAhead / spacing));
  const t = cl[(best + look) % cl.length];
  const dx = t.x - pos.x;
  const dz = t.z - pos.z;
  const len = Math.hypot(dx, dz) || 1;
  const h = playerKart.state.heading;
  const err = signedAngle(
    { x: Math.sin(h), y: Math.cos(h) },
    { x: dx / len, y: dz / len }
  );
  return THREE.MathUtils.clamp(err / 0.7, -1, 1);
}

// State for deferred kart disposal is initialized with the boot flags above.

function disposeDeferredKartGroup() {
  const group = deferredKartDisposals.shift();
  if (!group) return;
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose?.();
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const material of materials) {
      // Shared cached textures are owned by Materials.js, not this kart.
      if (material?.map && !material.map.userData?.shared) material.map.dispose?.();
      material?.dispose?.();
    }
  });
  if (deferredKartDisposals.length) setTimeout(disposeDeferredKartGroup, 50);
}

function scheduleDeferredKartDisposals() {
  if (!deferredKartDisposals.length) return;
  setTimeout(disposeDeferredKartGroup, 1000);
}

// AUDIT R16g-h: the click used to enter this whole constructor/dispose path
// in one task. Schedule it after the menu paint so the button can acknowledge
// the click; the heavy body remains exactly once and double-clicks are ignored.
function startRace() {
  if (startRacePending) return;
  startRacePending = true;
  setTimeout(() => {
    startRacePending = false;
    startRaceHeavy();
  }, 0);
}

function startRaceHeavy() {
  // AUDIT R16g-h: dispose in its own frame; building six karts and boxes
  // immediately after this used to create one very long input task.
  // AUDIT r3: leak fix — Menu→StartRace re-added kart groups without
  // removing the previous ones (unbounded scene growth + draw calls).
  // Dispose old kart groups before rebuilding.
  if (playerKart) {
    scene.remove(playerKart.group);
    deferredKartDisposals.push(playerKart.group);
  }
  for (const k of aiKarts) {
    scene.remove(k.group);
    deferredKartDisposals.push(k.group);
  }
  setTimeout(startRaceBuild, 0);
}

function startRaceBuild() {
  applyDifficulty();
  buildKarts().then(() => {
    applyPlayerStats();
    setTimeout(startRaceInit, 0);
  });
}

function startRaceInit() {
  // Karts are built one per frame above; initialization now runs after the
  // browser has had several chances to paint the loading state.
  // AUDIT r4: lap-split feedback — time each completed lap, track the best,
  // feed the HUD chip (MK8D consistency reward).
  playerKart._lastLapAt = 0;
  playerKart._bestLapMs = null;
  playerKart._onLap = ({ lap }) => {
    const now = raceManager.elapsed;
    const lapMs = Math.round(Math.max(0, now - (playerKart._lastLapAt || 0)) * 1000);
    playerKart._lastLapAt = now;
    // R26: the grid sits ~0.5s before the line — that first crossing is race
    // start, not a completed lap. Sub-5s laps are physically impossible on
    // either track (shortest real laps run 8s+), so seed the timer silently
    // instead of freezing BEST at 0:00.5 for the whole race.
    if (lapMs < 5000) return;
    if (lap === 1) {
      playerKart._bestLapMs = lapMs;
      hud.setLapSplit?.(lapMs, lapMs, true);
      return;
    }
    const isBest = lapMs < (playerKart._bestLapMs || Infinity);
    if (isBest) playerKart._bestLapMs = lapMs;
    hud.setLapSplit?.(lapMs, playerKart._bestLapMs, isBest);
  };
  const boxes = createItemBoxes(track);
  raceManager.init({
    track,
    playerKart,
    aiKarts,
    itemBoxes: boxes,
    audio,
    particles,
  });
  // DEMO autopilot owns the player kart (QA captures); RaceManager.restart()
  // preserves it via _playerAI instead of dropping it like a cruise controller.
  raceManager._playerAI = DEMO;
  if (DEMO) raceManager.aiControllers.push(new AIController(playerKart, track, raceManager));
  // Onboarding tip (audit v4 F10): teach the drift-boost loop once per session.
  if (!window.__sk3dDriftTipShown) {
    window.__sk3dDriftTipShown = true;
    const tip = isTouchMode()
      ? 'Hold DRIFT — release when it flashes for a boost!'
      : 'Hold Shift to drift — release at the flash for a boost!';
    hud.showMessage(tip);
  }
  raceManager.onPlayerFinish = (place, time) => {
    // AUDIT MED: hide touch controls at FINISHED — the DRIFT button (z 120)
    // sat over the finish card (z 3) and stole taps from Race Again/Menu.
    touch.hide?.();
    // AUDIT r21: the finish card now shows the FULL final standings
    // (position + driver + time) like MK8D's results screen, not just the
    // player's place.
    hud.showFinish(place, time, raceManager.getStandings().map((r) => ({
      position: r.position,
      kart: r.kart,
      totalTime: r.kart?.totalTime,
    })), TRACK_ID === 2 ? 'Neon City' : 'Meadow Circuit');
    // Celebration burst as the player crosses the line (art-bible: reward juice).
    if (playerKart && playerKart.state) {
      const p = playerKart.state.position.clone();
      p.y += 1.2;
      particles.emit('confetti', p, { count: 80 });
      particles.emit('confetti', p, { count: 60, color: 0xffd166 });
      particles.emit('sparkle', p, { count: 40, speed: 4, size: 0.3, color: 0xffffff });
    }
    // Cruise mode (genre standard): the kart keeps driving automatically at
    // reduced speed, engine hums quietly and the music swells over the SFX.
    playerKart.cruiseSpeed = CONFIG.physics.maxSpeed * 0.6;
    raceManager.aiControllers.push(new AIController(playerKart, track, raceManager));
    audio.duckMusic(0.35, 2600); // AUDIT R59: duck de verdade (0.35 = música a 35% para destacar a fanfarra; era 1.0 = levantava a 100%)
    audio.play('finish');
    // Victory fanfare only for podium (was playing for EVERY finish).
    // AUDIT r3: the bare setTimeout fired victory over a fresh race if the
    // player restarted inside the 400ms window — guard on state + phase.
    if (place <= 3) {
      window.__victoryTimer = setTimeout(() => {
        if (getState() === STATES.FINISHED && raceManager.phase === 'finished') {
          audio.play('victory');
        }
      }, 400);
    }
    setState(STATES.FINISHED);
  };
  raceManager.onRaceOver = (standings) => {
    // The player can cross before the last AI. Refresh the result rows once
    // every kart has a real totalTime, eliminating stale em-dash entries.
    hud.updateFinishStandings(standings.map((r) => ({
      position: r.position,
      kart: r.kart,
      totalTime: r.kart?.totalTime,
    })));
  };
  playerKart.position = CONFIG.game.numKarts; // starts last on the grid
  menu.hide();
  hud.show();
  hud.reset();
  if (isTouchMode()) touch.show();
  audio.startMusic(TRACK_ID === 2 ? 'Neon Nights' : undefined);
  countdownT = 0;
  countdownIndex = -1;
  setState(STATES.COUNTDOWN);
  scheduleDeferredKartDisposals();
}

/** Toggle pause from keyboard or the mobile pause button. */
function togglePause() {
  const st = getState();
  if (st === STATES.RACE) {
    setState(STATES.PAUSED);
    audio.suspend?.();
    hud.showPause(true);
    touch.hide?.(); // AUDIT FIX: touch buttons (z 120) sat over the pause
    // overlay (z 6) and blocked tap-to-resume.
  } else if (st === STATES.PAUSED) {
    setState(STATES.RACE);
    audio.resume?.();
    hud.showPause(false);
    if (isTouchMode()) touch.show?.();
  }
}

function restartRace() {
  audio.clearEngineLoops(); // restart engine sounds from scratch (no echo/doubling)
  // The finish-cruise AIController on the player kart is dropped inside
  // RaceManager.restart() (single source of truth — AUDIT FIX: the cruise
  // controller used to survive here and fight the player's input).
  raceManager.restart();
  applyDifficulty();  // re-apply (menu choices may have changed between races)
  applyPlayerStats(); // Kart.restart() wipes cruiseSpeed — restore the stat target
  skids.clear();
  lastLap = 0;
  finalLapShown = false;
  // AUDIT FIX: stale held-item toast + off-road audio state carried into the
  // new race (the loop's `else if (!heldItem)` eventually clears them, but
  // explicit reset avoids a flash of the old item / gravel rumble at GO).
  lastHeldItem = null;
  lastHeldItem2 = null;
  suppressNextItemToast = 0;
  // AUDIT r8: no stale roulette reveal from the previous race (karts persist
  // across restart, but the pending setTimeout lives at module scope).
  clearTimeout(pickupRevealTimer);
  pickupRevealGen++;
  // AUDIT r4: a mid-hold restart must not fire the old item into the new race.
  itemPressT = -1;
  disarmRear();
  offroadT = 0.55;
  if (playerKart) playerKart.position = CONFIG.game.numKarts;
  hud.reset();
  hud.show();
  if (isTouchMode()) touch.show?.();
  countdownT = 0;
  countdownIndex = -1;
  setState(STATES.COUNTDOWN);
}

function gotoMenu() {
  raceManager.phase = 'idle';
  raceManager.raceOver = false;
  setState(STATES.MENU);
  hud.hide();
  menu.show();
  touch.hide?.(); // AUDIT FIX: touch buttons floated over the menu card
  audio.clearEngineLoops();
}

// Pause overlay is tappable ("tap to resume" — audit UX-F6).
hud.root.querySelector('.sk3d-pause')?.addEventListener('click', () => {
  if (getState() === STATES.PAUSED) togglePause();
});

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const _camDesired = new THREE.Vector3(); // camera scratch (no per-frame alloc)
const _camLook = new THREE.Vector3();    // camera scratch
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _fwd2 = new THREE.Vector3(); // skid-mark scratch
const _pos2 = new THREE.Vector3(); // skid-mark scratch

let baseFov = CONFIG.camera.fov;
let shakeTimer = 0;
let shakeMag = 0;
// Camera feel (audit r2): drift swing, speed pull-back, mini-boost kick.
const CAM_DRIFT_SWING = 1.7;     // lateral offset ∝ steer while drifting
const CAM_SPEED_PULLBACK = 0.15; // AUDIT r18-FIX: 0.35 pushed the chase
// 5.2→7.0m at top speed — the kart shrank to ~12-15% of the frame, killing
// the MK8D 25-30% composition the r17 camera pass added.
const CAM_BOOST_KICK = 0.9;      // extra pull-back on boost start
let camSwing = 0;                // smoothed lateral camera swing
let camBoostKick = 0;            // decaying boost kick
let camWasBoost = false;         // boost rising-edge detect

/** Wavy fabric animation for the finish-line banner (segmented plane). */
function waveBanner(t) {
  const banner = track?.startLine?.banner;
  if (!banner || !banner.geometry?.attributes?.position) return;
  const pos = banner.geometry.attributes.position;
  const amp = 0.12; // subtle fabric wave — keeps FINISH legible at distance
  const freq = 0.55;
  const speed = 2.4;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, Math.sin(x * freq + t * speed) * amp + Math.sin(x * freq * 2.1 - t * speed * 0.7) * amp * 0.35);
  }
  pos.needsUpdate = true;
  // NOTE: no computeVertexNormals() — the banner is MeshBasicMaterial
  // (unlit), so normals are never consumed; recomputing them every frame
  // was pure CPU churn on the main thread (audit UX-v3 F3).
}

function updateCamera(dt, t) {
  // Tight shadow frustum follows the player (audit r2): the shadow sun used
  // to span ±90m over the whole loop → ~9cm texels, blurry blob shadows.
  // Re-anchoring on the player keeps ~2.7cm texels under the kart.
  if (env.shadowSun && playerKart && env.sunDir) {
    const sp = playerKart.state.position;
    // AUDIT FIX R13h: frustum ±130m → sun a 150m (cobre o frustum inteiro;
    // a 90m a luz caía DENTRO do quadrado → sombras projetadas erradas perto
    // da borda).
    env.shadowSun.position.set(
      sp.x + env.sunDir.x * 150,
      sp.y + env.sunDir.y * 150,
      sp.z + env.sunDir.z * 150
    );
    env.shadowSun.target.position.copy(sp);
  }
  if (getState() === STATES.FINISHED) return;
  if (window.__freezeCam) return; // QA hook: freeze the chase camera
  if (DEMO) {
    // Cinematic autopilot: chase the player kart with a swaying side offset
    // so QA frames show karts, road and environment up close.
    if (playerKart) {
      const st = playerKart.state;
      const group = playerKart.group;
      _fwd.set(0, 0, 1).applyQuaternion(group.quaternion);
      _side.set(_fwd.z, 0, -_fwd.x);
      // DEMO must remain a player-facing chase camera. The previous cinematic
      // offsets (3.6–4.2m back and 3.4m lateral sway) made the kart leave the
      // visual subject region and let roadside props occlude the racing line.
      // Keep only a restrained sway and the same track-specific distance used
      // by normal gameplay so video QA exercises a truthful player view.
      const sway = Math.sin(t * 0.13) * 0.55;
      const demoBackDistance = CONFIG.camera.followDistance + (TRACK_ID === 2 ? (CONFIG.camera.neonFollowExtra || 0) : 0);
      _camDesired.copy(st.position)
        .addScaledVector(_fwd, -demoBackDistance)
        .addScaledVector(_side, sway);
      _camDesired.y += CONFIG.camera.followHeight + 0.2 + Math.sin(t * 0.4) * 0.15;
      const lerp = 1 - Math.exp(-2.4 * dt);
      camPos.lerp(_camDesired, lerp);
      camera.position.copy(camPos);
      _camLook.copy(st.position).addScaledVector(_fwd, 6);
      _camLook.y += 1.0;
      lookTarget.lerp(_camLook, Math.min(1, dt * 5));
      camera.lookAt(lookTarget);
    }
    return;
  }

  const k = playerKart;
  if (!k) return;
  const st = k.state;
  const group = k.group;

  _fwd.set(0, 0, 1).applyQuaternion(group.quaternion);
  _side.set(_fwd.z, 0, -_fwd.x);

  const speed01 = Math.min(1, Math.abs(st.speed) / CONFIG.physics.maxSpeed);

  // Camera feel (audit r2): lateral swing ∝ steer while drifting (smoothed
  // so entry/exit doesn't snap), follow distance ∝ speed, and a decaying
  // kick on boost start (mini-boost auto-fire / mushroom / rocket start).
  const steer = k.input && typeof k.input.steer === 'number' ? k.input.steer : 0;
  const swingTarget = st.drifting ? steer * CAM_DRIFT_SWING : 0;
  camSwing += (swingTarget - camSwing) * Math.min(1, 6 * dt);
  if (st.boost && !camWasBoost) camBoostKick = 1;
  camWasBoost = !!st.boost;
  camBoostKick *= Math.exp(-5.5 * dt);
  // AUDIT R11 (v5 5/10 vs baseline 7/10): dist +0.6 piorou (kart subiu e
  // bloqueou pista). REVERTIDO ao baseline exato — 7/10 era o teto mobile.
  const _mobile = isTouchMode(); // mobile/touch → chase mais aberta
  const dist =
    (CONFIG.camera.followDistance + (TRACK_ID === 2 ? (CONFIG.camera.neonFollowExtra || 0) : 0)) *
    (1 + speed01 * CAM_SPEED_PULLBACK) +
    camBoostKick * CAM_BOOST_KICK;

  camTarget.copy(st.position).addScaledVector(_fwd, CONFIG.camera.lookAhead);
  camTarget.y += CONFIG.camera.lookHeight;

  _camDesired.copy(st.position)
    .addScaledVector(_fwd, -dist)
    .addScaledVector(_side, camSwing);
  _camDesired.y += CONFIG.camera.followHeight + camBoostKick * 0.4;

  const lerp = 1 - Math.exp(-CONFIG.camera.lerp * dt);
  camPos.lerp(_camDesired, lerp);
  camera.position.copy(camPos);

  // Speed FOV: wider at high speed + extra punch on boost (arcade feel);
  // the decaying camBoostKick adds a short FOV punch on mini-boost.
  const targetFov = baseFov + (st.boost > 0 ? 6 : 0) + speed01 * 5 + camBoostKick * 3.5;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6);
  camera.updateProjectionMatrix();

  if (shakeTimer > 0) {
    shakeTimer -= dt;
    camera.position.x += (Math.random() - 0.5) * shakeMag;
    camera.position.y += (Math.random() - 0.5) * shakeMag;
  }

  lookTarget.lerp(camTarget, Math.min(1, dt * 8));
  camera.lookAt(lookTarget);
}

function addShake(mag, duration) {
  shakeMag = mag;
  shakeTimer = duration;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const loop = new GameLoop();
let menuAngle = 0;
let qaFrameN = 0; // QA: frame counter exposed via __sk3d (perf diagnostics)
window.__qaFrameN = 0;
// QA profiler: when __profEnabled is true, the loop records per-section ms.
window.__profEnabled = false;
window.__prof = {};

loop.start((dt, t) => {
  qaFrameN++;
  window.__qaFrameN = qaFrameN;
  const state = getState();
  const terminalPresentation = state === STATES.FINISHED;
  // Finished is a deterministic presentation: keep rendering the final frame,
  // but do not animate the race world underneath the results card.
  if (!terminalPresentation) {
    env.update(dt, t);
    updateWind(t);
  }

  // Mobile Neon boost: reduce only the turbo-pad glow envelope so the
  // emissive strip does not wash out lane markings/kart silhouettes at DPR2/3.
  const turboGlowScale = TRACK_ID === 2 && isTouchMode() ? 0.58 : 1;
  if (!terminalPresentation && turboGlowMat) {
    turboGlowMat.opacity = (0.06 + 0.08 * (0.5 + 0.5 * Math.sin(t * 2.6))) * turboGlowScale;
  }
  // Environment animation is paused during FINISHED; race states animate.

  if (state === STATES.MENU) {
    // Slow showcase orbit around the track.
    menuAngle += dt * 0.08;
    const r = 30;
    camera.position.set(Math.cos(menuAngle) * r, 14, Math.sin(menuAngle) * r);
    camera.lookAt(0, 3, 0);
  }

  if (state === STATES.COUNTDOWN) {
    countdownT += dt;
    const idx = Math.floor(countdownT / COUNTDOWN_STEP);
    if (idx !== countdownIndex && idx >= 0 && idx < COUNTDOWN_MARKS.length) {
      countdownIndex = idx;
      const mark = COUNTDOWN_MARKS[idx];
      hud.countdown(mark === 0 ? 'GO' : String(mark));
      audio.play(mark === 0 ? 'go' : 'countdown', mark < 3 ? { rate: 1 + (3 - mark) * 0.18 } : undefined); // rising pitch 3-2-1 (MK8 tension)
      setStartLights(mark === 0 ? 4 : mark); // 3/2/1 → red lamps, GO → green
      if (mark === 0) {
        // Camera kick on GO (arcade juice: the start feels like a launch).
        // The 'go' SFX already carries the low-kick punch.
        addShake(0.5, 0.5);
        // Rocket start (audit v5 #1): holding throttle at GO = launch boost —
        // the MK8/CTR signature opening skill. AUDIT r3: not free — the
        // perfect hold at GO = full 900ms; pressing within the next 0.35s
        // grants a scaled 300-900ms boost (timing reward, misses get nothing).
        window.__goAt = performance.now();
        window.__rocketFired = false;
        if (playerKart && playerKart.applyBoost && (input.throttle || settings.autoAccel || isTouchMode())) {
          window.__rocketFired = true;
          playerKart.applyBoost(900);
          particles.emit('boost', playerKart.group.position, { count: 22, speed: 9, size: 0.32 });
        }
      }
      if (mark === 0 && raceManager.karts.length) {
        // Start burst: tire smoke at every kart + confetti over the grid.
        for (const k of raceManager.karts) {
          if (!k.state) continue;
          particles.emit('exhaust', k.state.position, { count: 22, color: 0xcfd6e0, speed: 3.0 });
        }
        const gridKart = raceManager.karts[Math.floor(raceManager.karts.length / 2)];
        if (gridKart && gridKart.state) {
          particles.emit('confetti', gridKart.state.position, { count: 90 });
          particles.emit('confetti', gridKart.state.position, { count: 70, color: 0xffd166 });
        }
      }
    }
    if (countdownT >= COUNTDOWN_STEP * COUNTDOWN_MARKS.length) {
      raceManager.start();
      setState(STATES.RACE);
      hud.countdown(null); // clear
    }
    hud.update(raceManager, playerKart, raceManager.karts); // live rank during countdown too
    updateCamera(dt, t);
  }

  if (state === STATES.RACE || state === STATES.FINISHED) {
    waveBanner(t);
    if (state === STATES.RACE) {
      // Player input
      if (!DEMO) {
        readKeyboardInput();
        let steer = isTouchMode() ? touchSteer : input.steer;
        // Steer assist (accessibility, audit r3): soft pull toward the track
        // centerline (same signed-error math as AIController). It fades out as
        // the player's own input grows, so it nudges but never fights them.
        if (settings.steerAssist) {
          const assist = centerlineAssist();
          const authority = Math.max(0, 1 - Math.abs(steer) * CONFIG.assist.steerAssistAuthority);
          steer = THREE.MathUtils.clamp(steer + assist * authority * CONFIG.assist.steerAssistGain, -1, 1);
        }
        // Rocket-start timing window (audit r3): a NEW throttle press within
        // 0.35s of GO (not held at GO) still earns a scaled boost.
        if (window.__goAt && !window.__rocketFired && (input.throttle || settings.autoAccel)) {
          const sinceGo = (performance.now() - window.__goAt) / 1000;
          if (sinceGo >= 0 && sinceGo < 0.35) {
            window.__rocketFired = true;
            const ms = Math.round(300 + (1 - sinceGo / 0.35) * 600); // 900→300ms
            playerKart.applyBoost(ms);
            particles.emit('boost', playerKart.group.position, { count: 14, speed: 8, size: 0.28 });
          }
        }
        // Auto-accelerate (accessibility): keep the gas pinned unless braking.
        const rawThrottle = isTouchMode() ? 1 : input.throttle || (input.brake ? -1 : 0);
        const effThrottle = settings.autoAccel ? (input.brake ? -1 : 1) : rawThrottle;
        // Character stats → physics (audit r3): accel scales throttle input,
        // handling scales steer authority; speed is applied as cruiseSpeed.
        const statAccel = (playerKart && playerKart._statAccel) || 1;
        const statSteer = (playerKart && playerKart._statSteer) || 1;
        if (!playerKart) return; // AUDIT (Jarvis QA 2026-08-11): null-guard — playerKart can be torn down mid-restart (HMR/re-enter menu) and setControls on null froze the race loop
        playerKart.setControls({
          steer: steer * statSteer,
          throttle: effThrottle * statAccel,
          brake: input.brake,
          drift: input.drift,
          swapItem: input.swapItem,
        });
      }
      // Hold-to-throw-back (audit r4): crossing the hold threshold arms the
      // rear aim — the item bubble flips across the kart as the visual cue.
      if (itemPressT >= 0) {
        if (!rearArmed && performance.now() - itemPressT >= REAR_HOLD_MS) {
          rearArmed = true;
          playerKart?.setItemRear?.(true);
          audio.play('uiClick', { volume: 0.5 }); // arm cue
          hud.showRearHint?.(); // one-time tip (HUD persists the flag)
        }
      } else if (rearArmed) {
        disarmRear();
      }
      // AUDIT r11 (#6, code audit): RaceManager.update() already drives the
      // AI controllers every frame — a second loop here DOUBLED item-use
      // accumulation (effective itemUseChancePerSec 2x) and re-ran steering.
      raceManager.update(dt);
      // AUDIT r8 (MK8D blue-shell dodge counterplay): collecting an item box
      // grants a short invincibility window — the classic spiny dodge (drive
      // into a box as it dives). Pickups happen inside raceManager.update, so
      // detect fresh pickups for EVERY kart (AI included) by diffing the
      // held-slot count against the previous frame.
      for (const k of raceManager.karts) {
        if (!k || k.finished) continue;
        const have = (k.heldItem ? 1 : 0) + (k.heldItem2 ? 1 : 0);
        if (k._prevHeldCount !== undefined && have > k._prevHeldCount) {
          k._lastBoxAt = performance.now(); // PowerUp._blueDodged consults this
          k.setInvincible?.(true, 900);
        }
        k._prevHeldCount = have;
      }
      hud.update(raceManager, playerKart, raceManager.karts);
      // AUDIT R11: speedo reage ao boost (mushroom, turbo pad, star).
      hud.setBoost?.(!!(playerKart.state.boost || playerKart.state.turboBoostMs > 0));
      // AUDIT imersão R11: auto-hide — 4s sem input no touch esmaece o HUD
      // (MK8D); qualquer tecla/toque restaura (listeners abaixo resetam).
      if (hud._idle !== undefined && hud.setIdle) {
        hudIdleT += dt;
        if (hudIdleT > 4 && !hud._idle) hud.setIdle(true);
      }
      // Drift charge meter (white → yellow → orange; only while drifting).
      hud.setDriftCharge(playerKart.state.driftCharge, playerKart.state.drifting);
      // Lap fanfare — completing a lap was completely silent (dead 'lap' SFX).
      if (playerKart.state.lap > lastLap) {
        lastLap = playerKart.state.lap;
        audio.play('lap');
      }
      // FINAL LAP callout (audit v5 #5): banner + jingle on entering the last lap.
      if (playerKart.state.lap === CONFIG.game.totalLaps && !finalLapShown) {
        finalLapShown = true;
        hud.showMessage('🏁 FINAL LAP!');
        audio.play('posUp', { volume: 0.7 });
      }
      // Toast the item the player just picked up — ICON first, then name.
      // AUDIT r3 dual-slot: watches BOTH slots (a pickup lands in the reserve
      // when the primary is full) and shows ×N for triple stacks.
      if (playerKart.heldItem !== lastHeldItem || playerKart.heldItem2 !== lastHeldItem2) {
        // AUDIT r8: ANY held-slot change (pickup, use, lightning knock, swap)
        // supersedes a pending roulette reveal — the stale announce stays quiet.
        const gen = ++pickupRevealGen;
        if (suppressNextItemToast > 0) {
          suppressNextItemToast--; // swap already announced itself
        } else if (playerKart.heldItem || playerKart.heldItem2) {
          const primaryChanged = playerKart.heldItem !== lastHeldItem && playerKart.heldItem;
          const changed = primaryChanged ? playerKart.heldItem : playerKart.heldItem2;
          const count = changed === playerKart.heldItem
            ? playerKart._heldItemCount || 1
            : playerKart._heldItem2Count || 1;
          audio.play('itemPickup', { volume: 0.6 }); // item box = fanfarra MK8 (era o blip de moeda)
          hud.setItemRoulette(changed, count); // MK8 roulette spin (audit minor)
          // AUDIT r8 (item roulette anticipation): the HUD icons shuffle for
          // ~0.45s (MK8D roulette spins 0.4-0.5s) — delay the name reveal to
          // match, guarded by the generation counter above.
          // Keys match PowerUpType VALUES (lowercase): mushroom, shell, red_shell…
          const ITEMS = {
            mushroom: ['🍄', 'Mushroom'],
            shell: ['🐢', 'Green Shell'],
            red_shell: ['🐢', 'Red Shell'],
            banana: ['🍌', 'Banana'],
            star: ['⭐', 'Star'],
            lightning: ['⚡', 'Lightning'],
            blue_shell: ['💙', 'Blue Shell'],
          };
          const [icon, name] = ITEMS[changed] || ['❓', changed];
          const label = count > 1 ? `${icon} ${name} ×${count}` : `${icon} ${name}`;
          clearTimeout(pickupRevealTimer);
          pickupRevealTimer = setTimeout(() => {
            if (gen !== pickupRevealGen) return; // superseded — stay quiet
            hud.showMessage(label);
          }, ITEM_ROULETTE_MS);
        }
        lastHeldItem = playerKart.heldItem;
        lastHeldItem2 = playerKart.heldItem2;
      }
    } else {
      // FINISHED — cruise: AI drives the player at reduced speed, engines
      // keep humming quietly while the music swells (genre standard).
      // AUDIT r11 (#6): single driver — RaceManager.update() updates AIs.
      raceManager.update(dt);
      hud.update(raceManager, playerKart, raceManager.karts);
    }
    // Continuous engine loops — race AND cruise (pitch follows speed; in
    // cruise the reduced speed naturally lowers pitch + volume).
    // AUDIT r3: positional audio was DEAD — the StereoPanner/rolloff existed
    // but no pose was ever fed. Now every engine gets its world pose and the
    // listener is the chase camera, so a rival ahead/behind/left/right pans.
    const pSpeed01 = Math.min(1, Math.abs(playerKart.state.speed) / CONFIG.physics.maxSpeed);
    const pPos = playerKart.state.position;
    audio.setEngineLoop('player', pSpeed01, { x: pPos.x, z: pPos.z, heading: playerKart.state.heading });
    audio.setListenerPose({ x: camera.position.x, y: camera.position.y, z: camera.position.z, heading: playerKart.state.heading });
    // Crowd proximity (audit r3: grandstand boost + cheers were dead code —
    // setCrowdProximity was never called). Proximity to the start/finish
    // grandstand: 1 at the line, 0 beyond ~90m.
    if (track.startLine) {
      const gx = track.startLine.position.x;
      const gz = track.startLine.position.z;
      const gd = Math.hypot(pPos.x - gx, pPos.z - gz);
      audio.setCrowdProximity(THREE.MathUtils.clamp(1 - gd / 90, 0, 1));
    }
    // Drift tire screech (was dead code — drifting was audibly empty).
    if (playerKart.state.drifting && Math.abs(playerKart.state.speed) > 8) {
      driftScreechAcc += dt;
      if (driftScreechAcc >= 0.9) {
        driftScreechAcc = 0;
        audio.play('drift', { volume: 0.55 });
      }
    }
    // AI drift screech (audit v4 F5: AI drifts were silent — breaks immersion).
    if (aiKarts) {
      aiScreechAcc += dt;
      if (aiScreechAcc >= 0.7) {
        aiScreechAcc = 0;
        for (const k of aiKarts) {
          if (k.state.drifting && Math.abs(k.state.speed) > 8) {
            const pan = (k.group.position.x - (playerKart?.group.position.x ?? 0)) * 0.04;
            audio.play('drift', { volume: 0.22, pan: Math.max(-0.9, Math.min(0.9, pan)) });
            break; // one at a time keeps it readable
          }
        }
      }
    }
    for (let i = 0; i < aiKarts.length; i++) {
      const s01 = Math.min(1, Math.abs(aiKarts[i].state.speed) / CONFIG.physics.maxSpeed);
      const ap = aiKarts[i].state.position;
      // AUDIT R55: velocidade REAL (o *0.35 antigo era hack de pitch — o AI
      // soava 35% da velocidade real) + vol=0.28 (rivais distantes; o ganho
      // espacial ainda rola off com a distância em _updateSpatial).
      audio.setEngineLoop('ai' + i, s01, { x: ap.x, z: ap.z, heading: aiKarts[i].state.heading }, 0.28);
    }
    // Tire skid marks: both rears while drifting (player + AI).
    for (let i = 0; i < raceManager.karts.length; i++) {
      const k = raceManager.karts[i];
      if (!k || !k.state) continue;
      if (k.state.drifting && Math.abs(k.state.speed) > 8) {
        const acc = (k.skidAcc = (k.skidAcc || 0) + dt);
        if (acc >= 0.08) {
          k.skidAcc = 0;
          const h = k.state.heading;
          const fwd = _fwd2.set(Math.sin(h), 0, Math.cos(h));
          const pos = _pos2.copy(k.state.position).addScaledVector(fwd, -0.95);
          pos.y = k.state.position.y; // ground level
          // AUDIT R11: rastro escala com a carga de drift + faíscas laranja
          // no tier 3 (recompensa visual da derrapagem, MK8D).
          const charge = k.state.driftCharge || 0;
          skids.leave(pos, h, charge);
          if (charge > 0.66 && Math.random() < 0.5) {
            particles.emit('sparkle', pos, { count: 3, speed: 2.6, size: 0.2, color: 0xff9f45 });
          }
        }
      }
    }
    if (playerKart.state.boost > 0) {
      particles.emit('boost', playerKart.state.position, { color: 0xffa63d });
    }
    // AUDIT: fumaça de drift duplicada — o Kart.js já emite nas rodas
    // traseiras com cor por charge (branco→amarelo→laranja); o puff central
    // branco aqui dobrava o draw e lia "fumando no corpo". Removido.
    // Turbo pad boost: golden spark burst every ~0.1s while active.
    if (playerKart.state.turboBoostMs > 0) {
      turboParticleAcc += dt;
      if (turboParticleAcc >= 0.1) {
        turboParticleAcc = 0;
        particles.emit('boost', playerKart.state.position, {
          color: 0xffd166,
          count: 14,
          speed: 6.0,
          size: 0.3,
          spread: 1.6,
        });
      }
    } else {
      turboParticleAcc = 0;
    }
    // Off-road gravel rumble (feedback audit: surface/danger cue).
    if (playerKart.state.offRoad && playerKart.state.speed > 2) {
      offroadT += dt;
      if (offroadT >= 0.55) { offroadT = 0; audio.play('offroad', { volume: 0.5 }); }
      // Dust puffs kicking up from the rear wheels (dirt surface cue).
      dustAcc += dt;
      if (dustAcc >= 0.12) {
        dustAcc = 0;
        const h = playerKart.state.heading;
        const back = _fwd2.set(Math.sin(h), 0, Math.cos(h)).multiplyScalar(-1.1);
        particles.emit('dust', {
          x: playerKart.state.position.x + back.x,
          y: playerKart.state.position.y + 0.25,
          z: playerKart.state.position.z + back.z,
        }, { count: 6, speed: 1.4, size: 0.4, color: 0xb08d5a, gravity: -1.2, spread: 0.8 });
      }
    } else {
      offroadT = 0.55; // ready to fire immediately when leaving the road
    }
    updateCamera(dt, t);
  }

  if (!terminalPresentation) {
    particles.update(dt);
    skids.update(dt);
  }
  postfx.render(dt);

  if (window.__profEnabled) {
    const _now = performance.now();
    window.__prof.frameN = qaFrameN;
    window.__prof.state = getState();
    window.__prof.dtMs = (dt * 1000).toFixed(1);
    window.__prof.rawMs = (_now - (window.__prof.lastNow || _now)).toFixed(1);
    window.__prof.lastNow = _now;
  }
});

// ---------------------------------------------------------------------------
// Public QA hooks
// ---------------------------------------------------------------------------
window.__sk3d = {
  scene,
  camera,
  renderer,
  loop, // QA: deterministic harnesses may stop simulation after setup
  qualityProfile,
  capabilityProbe,
  renderReport: () => renderer.userData.qualityReport?.(),
  getState,
  raceManager,
  playerKart: () => playerKart,
  track,
  hud, // QA tick31: gameplay probes drive HUD states directly (toast/finish)
  audio,
  particles,
  postfx, // QA: post chain (passes can be toggled to bisect render bugs)
  startRace,
  restartRace,
  gotoMenu,
  addShake,
  // QA hook: fast-forward the 3-2-1 countdown (headless rAF is too slow to
  // observe a real race start otherwise). Same convention as __freezeCam.
  skipCountdown: () => {
    if (getState() === STATES.COUNTDOWN) {
      countdownT = COUNTDOWN_STEP * COUNTDOWN_MARKS.length;
    }
  },
  settings, // QA: current difficulty/assist settings { cc, autoAccel, steerAssist }
  setPlayerColor, // QA: kart paint override (roster color validation)
  updateCamera, // QA hook: can be stubbed to freeze the chase camera
  playerCharIndex: () => getPlayerCharIndex(), // QA: selected driver (audit r4)
  DEMO,
  // QA debug: countdown internals (restart-flow regression tests read these).
  get countdownT() { return countdownT; },
  get countdownIndex() { return countdownIndex; },
  // QA: AI controller roster — lets tests assert the cruise controller is
  // removed on restart (the user bug: AI kept driving the player kart).
  get aiControllerCount() { return raceManager.aiControllers.length; },
  get playerAIControlled() { return raceManager.aiControllers.some((c) => c.kart === playerKart); },
};

console.log('[Super Kart 3D.js] booted. Demo mode:', DEMO, '| State:', getState());
bootOverlay.complete();

// AUDIT (Jarvis QA loop 2026-08-11): runtime errors froze the game with NO
// visible feedback (the rAF loop dies silently). Surface them on screen so
// a crash is diagnosable instead of a mystery freeze.
(function installErrorOverlay() {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;max-width:70vw;background:rgba(160,20,20,0.92);color:#fff;font:11px/1.4 monospace;padding:6px 10px;border-radius:6px;display:none;white-space:pre-wrap;pointer-events:none';
  document.body.appendChild(box);
  let shown = 0;
  const show = (label, msg) => {
    if (++shown > 3) return;
    box.style.display = 'block';
    box.textContent = label + ': ' + String(msg).slice(0, 400);
  };
  window.addEventListener('error', (e) => show('ERRO', (e.error && e.error.stack) || e.message));
  window.addEventListener('unhandledrejection', (e) => show('REJEIÇÃO', (e.reason && e.reason.stack) || e.reason));
})();
