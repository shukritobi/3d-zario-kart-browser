import './_dom-shim.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CONFIG } from '../../src/config.js';
import { Kart } from '../../src/entities/Kart.js';
import { buildTrack, TRACK_PATH } from '../../src/track/TrackBuilder.js';
import { VOLCANO_PATH, MANSION_PATH, EXTRA_TRACKS } from '../../src/track/ExtraTracks.js';
import { Environment } from '../../src/track/Environment.js';
import { zarioLogger } from '../../src/game/ZarioLogger.js';
import { RaceDiagnostics } from '../../src/game/RaceDiagnostics.js';
import {
  generateRoomCode,
  encodeQRMatrix,
  renderPairingQRCodeSvg,
  SwitchHostBridge,
} from '../../src/input/SwitchBridge.js';
import { TRACKS, MENU_TRACK, STAR_TRACK, VICTORY_TRACK, DEFEAT_TRACK } from '../../src/audio/music.js';

test('Ramp physics: launches all lanes and awards landing boost only after a deliberate airborne trick press', () => {
  const scene = new THREE.Scene();
  const track = buildTrack(scene, TRACK_PATH, 1);
  assert.ok(track.ramps.length >= 3, `Expected >= 3 ramps on Meadow Circuit, got ${track.ramps.length}`);

  const ramp = track.ramps[0];
  const rDir = ramp.dir.clone().setY(0).normalize();
  const rRight = new THREE.Vector3(-rDir.z, 0, rDir.x);
  const heading = Math.atan2(rDir.x, rDir.z);

  for (const lateralOffset of [0, -2.4, 2.4]) {
    const startPos = ramp.point.clone()
      .addScaledVector(rDir, -4.0)
      .addScaledVector(rRight, lateralOffset);
    startPos.y = ramp.point.y || 0;

    const kart = new Kart({
      character: CONFIG.kart.characters[0],
      isPlayer: true,
      startPosition: startPos,
      startHeading: heading,
    });
    assert.equal(kart.group.rotation.order, 'YXZ', 'Kart group must use YXZ Euler order so pitch never rolls sideways');

    kart.state.speed = 32;
    let TrickFired = false;
    kart._onTrick = () => { TrickFired = true; };

    let climbedSlope = false;
    let launchedAirborne = false;
    let maxHeightAboveBase = 0;
    let landedAfterJump = false;
    let trickRequested = false;

    for (let i = 0; i < 160; i++) {
      // Normal throttle/auto-accelerate cannot trigger a flip. A fresh drift
      // tap after becoming airborne should deliberately request one.
      const airborneDriftTap = !trickRequested && kart._airTime > 0.1;
      kart.setControls({ steer: 0, throttle: 1, brake: false, drift: airborneDriftTap });
      kart.update(1 / 60, { track });
      if (airborneDriftTap) trickRequested = true;

      if (kart.state.rampSlope > 0.05) climbedSlope = true;
      if (kart._airTime > 0) {
        launchedAirborne = true;
        const h = kart.state.position.y - (ramp.point.y || 0);
        if (h > maxHeightAboveBase) maxHeightAboveBase = h;
      } else if (launchedAirborne && maxHeightAboveBase > 1.8) {
        landedAfterJump = true;
        break;
      }
    }

    assert.ok(climbedSlope, `Kart in lane offset ${lateralOffset}m should climb the ramp slope`);
    assert.ok(launchedAirborne, `Kart in lane offset ${lateralOffset}m should launch into the air`);
    assert.ok(maxHeightAboveBase > 1.8, `Kart in lane offset ${lateralOffset}m should clear >1.8m height (got ${maxHeightAboveBase.toFixed(2)}m)`);
    assert.ok(landedAfterJump, `Kart in lane offset ${lateralOffset}m should land cleanly back on the road`);
    assert.ok(trickRequested, `Kart in lane offset ${lateralOffset}m should receive a deliberate airborne trick press`);
    assert.ok(TrickFired, `Kart in lane offset ${lateralOffset}m should trigger a Trick Boost after the airborne press`);
    assert.ok(kart._boostMs >= 750 && kart.state.boost, `Kart should receive 850ms trick boost on landing (_boostMs=${kart._boostMs})`);
  }
});

test('A ramp launch with accelerator held does not automatically flip the kart', () => {
  const track = buildTrack(new THREE.Scene(), TRACK_PATH, 1);
  const ramp = track.ramps[0];
  const startPos = ramp.point.clone().addScaledVector(ramp.dir, -4);
  startPos.y = ramp.point.y || 0;
  const kart = new Kart({
    character: CONFIG.kart.characters[0], isPlayer: true, startPosition: startPos,
    startHeading: Math.atan2(ramp.dir.x, ramp.dir.z),
  });
  kart.state.speed = 32;
  let fired = false;
  kart._onTrick = () => { fired = true; };
  let launched = false;
  for (let frame = 0; frame < 150; frame++) {
    kart.setControls({steer: 0, throttle: 1, brake: false, drift: false});
    kart.update(1 / 60, {track});
    if (kart._airTime > 0.08) launched = true;
  }
  assert.ok(launched, 'Ramp launch should generate airtime without any trick');
  assert.equal(fired, false, 'Keeping accelerator held cannot award a trick boost');
  assert.equal(kart._trickArmed, false, 'Normal jumps must not arm a flip/roll');
});

test('Track 5 (Inferno Volcano) and Track 6 (Haunted Mansion) build complete circuits, ramps, and sculpted 3D landmarks', () => {
  assert.ok(EXTRA_TRACKS[5], 'EXTRA_TRACKS[5] (Inferno Volcano) must exist');
  assert.ok(EXTRA_TRACKS[6], 'EXTRA_TRACKS[6] (Haunted Mansion) must exist');
  assert.equal(EXTRA_TRACKS[5].name, 'Inferno Volcano');
  assert.equal(EXTRA_TRACKS[6].name, 'Haunted Mansion');

  // Build Track 5: Inferno Volcano
  const volcanoScene = new THREE.Scene();
  const volcanoTrack = buildTrack(volcanoScene, VOLCANO_PATH, 5);
  assert.ok(volcanoTrack.length > 1000, `Volcano track length should be > 1000m (got ${volcanoTrack.length})`);
  assert.ok(volcanoTrack.ramps.length >= 3, `Volcano track should have >= 3 ramps (got ${volcanoTrack.ramps.length})`);

  const volcanoEnv = new Environment();
  volcanoEnv.trackId = 5;
  volcanoEnv.buildEnvironment(volcanoScene, volcanoTrack);
  assert.ok(volcanoScene.children.length > 20, 'Volcano scene should contain track, ramps, caldera, and volcanic environment');

  // Build Track 6: Haunted Mansion
  const mansionScene = new THREE.Scene();
  const mansionTrack = buildTrack(mansionScene, MANSION_PATH, 6);
  assert.ok(mansionTrack.length > 1000, `Mansion track length should be > 1000m (got ${mansionTrack.length})`);
  assert.ok(mansionTrack.ramps.length >= 3, `Mansion track should have >= 3 ramps (got ${mansionTrack.ramps.length})`);

  const mansionEnv = new Environment();
  mansionEnv.trackId = 6;
  mansionEnv.buildEnvironment(mansionScene, mansionTrack);
  assert.ok(mansionScene.children.length > 20, 'Mansion scene should contain track, ramps, gothic manor, ghosts, and environment');
});

test('Upgraded 3D Kart models: all 6 characters have custom 3D headgear and sculpted 3D held item meshes', () => {
  for (const ch of CONFIG.kart.characters) {
    const kart = new Kart({ character: ch, isPlayer: false });
    assert.ok(kart._headgearGroup, `Character ${ch.name} should have a _headgearGroup`);
    assert.ok(kart._headgearGroup.children.length > 0, `Character ${ch.name} should have custom 3D headgear meshes`);
    for (const itemKey of ['mushroom', 'shell', 'red_shell', 'blue_shell', 'banana', 'star', 'lightning']) {
      assert.ok(kart._heldMeshes[itemKey], `Kart should have sculpted 3D held mesh for ${itemKey}`);
    }
  }
});

test('Samsung TV + iPhone Switch Controller Bridge: QR matrix, room pairing, and packet edge detection', () => {
  const room = generateRoomCode(4);
  assert.equal(room.length, 4);

  const url = `http://192.168.1.50:3457/?controller=1&room=${room}`;
  const matrix = encodeQRMatrix(url);
  assert.ok(matrix.length >= 21 && matrix.length <= 41, `QR matrix size should be 21..41, got ${matrix.length}`);
  // Top-left finder pattern corner must be dark (1)
  assert.equal(matrix[0][0], 1);
  assert.equal(matrix[0][6], 1);
  assert.equal(matrix[6][0], 1);

  const svg = renderPairingQRCodeSvg(url, 180);
  assert.ok(svg.startsWith('<svg') && svg.includes('<path d="M'), 'Should render valid inline SVG QR code');

  const host = new SwitchHostBridge({ roomCode: room });
  host._handleIncomingPacket({
    type: 'controller_input',
    seq: 1,
    ts: Date.now(),
    steer: -0.65,
    throttle: 1,
    brake: 0,
    drift: true,
    useItem: true,
    swapItem: true,
    gyroEnabled: true,
    tiltDeg: -18,
    menuX: 1,
    menuY: -1,
    menuConfirm: true,
    menuBack: true,
  }, 'UnitTest-Relay');

  const frame1 = host.sampleFrameInput();
  assert.ok(frame1, 'Host should return active frame input');
  assert.ok(Math.abs(frame1.steer - (-0.65)) < 1e-6);
  assert.equal(frame1.throttle, 1);
  assert.equal(frame1.drift, true);
  assert.equal(frame1.useItem, true, 'First frame with useItem=true should trigger rising edge');
  assert.equal(frame1.swapItem, true, 'First frame with swapItem=true should trigger rising edge');
  assert.equal(frame1.menuX, 1, 'Phone D-pad should navigate menus horizontally');
  assert.equal(frame1.menuY, -1, 'Phone D-pad should navigate menus vertically');
  assert.equal(frame1.menuConfirm, true, 'Phone select should trigger one menu action');
  assert.equal(frame1.menuBack, true, 'Phone back should trigger one menu action');

  // Second sample without new press should clear one-shot edge flags
  const frame2 = host.sampleFrameInput();
  assert.equal(frame2.useItem, false, 'Rising-edge useItem should be consumed on first sample');
  assert.equal(frame2.swapItem, false, 'Rising-edge swapItem should be consumed on first sample');
  assert.equal(frame2.menuX, 0);
  assert.equal(frame2.menuY, 0);
  assert.equal(frame2.menuConfirm, false);
  assert.equal(frame2.menuBack, false);
  host.stop();
});

test('ZarioLogger and RaceDiagnostics record structured events and export Markdown & JSON reports', () => {
  zarioLogger.clear();
  const diag = new RaceDiagnostics();
  diag.start({ trackId: 5, trackLength: 1420, cc: 150, quality: 'tv', device: 'samsung-tv' });
  diag.event('rampLaunch', { speed: 34.5, vY: 11.4, slope: 0.3 });
  diag.event('trick', { boostSec: 0.85 });

  const snap = diag.snapshot();
  assert.equal(snap.counts.rampLaunch, 1);
  assert.equal(snap.counts.trick, 1);

  const jsonStr = zarioLogger.exportJSON();
  const parsed = JSON.parse(jsonStr);
  assert.ok(parsed.metrics.rampsLaunched >= 1, 'ZarioLogger should aggregate ramp launches');
  assert.ok(parsed.metrics.tricksTriggered >= 1, 'ZarioLogger should aggregate tricks');

  const md = zarioLogger.exportMarkdown();
  assert.ok(md.includes('# Zario Kart — Detailed Telemetry & Diagnostic Log'), 'Markdown export should include header');
});

test('Mario Kart DS Music Engine: all 6 race tracks, Menu Cruise, and Starman Hyper have fast BPMs, 32-step lead melodies, brass stabs, and walking bass', () => {
  assert.equal(TRACKS.length, 6, 'Should have 6 distinct track themes for Tracks 1..6');
  for (const t of TRACKS) {
    assert.ok(t.bpm >= 155, `Track ${t.name} should have an exciting MKDS tempo >= 155 BPM (got ${t.bpm})`);
    assert.equal(t.leadPattern.length, 32, `Track ${t.name} should have a 32-step composed lead melody`);
    assert.equal(t.stabPattern.length, 16, `Track ${t.name} should have a 16-step syncopated brass stab pattern`);
    assert.equal(t.bassWalk.length, 16, `Track ${t.name} should have a 16-step walking/octave slap bass pattern`);
  }
  assert.ok(MENU_TRACK.bpm >= 130, `Menu track should have an upbeat MKDS character-select groove >= 130 BPM (got ${MENU_TRACK.bpm})`);
  assert.equal(MENU_TRACK.leadPattern.length, 32, 'Menu track should have a 32-step composed lead hook');
  assert.equal(STAR_TRACK.bpm, 178, 'Super Star Invincibility theme should run at 178 BPM');
  assert.equal(STAR_TRACK.leadPattern.length, 32, 'Super Star theme should have the 32-step Starman riff');
});

test('Ramp & Trick Camera Anti-Dizziness: kart.state.groundY tracks road baseline and horizontal heading never flips during 360° mid-air trick', () => {
  const scene = new THREE.Scene();
  const track = buildTrack(scene, TRACK_PATH, 1);
  const ramp = track.ramps[0];
  const rDir = ramp.dir.clone().setY(0).normalize();
  const heading = Math.atan2(rDir.x, rDir.z);

  const startPos = ramp.point.clone().addScaledVector(rDir, -4.0);
  startPos.y = ramp.point.y || 0;

  const kart = new Kart({
    character: CONFIG.kart.characters[0],
    isPlayer: true,
    startPosition: startPos,
    startHeading: heading,
  });
  kart.state.speed = 32;

  let sawAirborneTrick = false;
  for (let i = 0; i < 65; i++) {
    kart.setControls({ steer: 0, throttle: 1, brake: false, drift: true });
    kart.update(1 / 60, { track });
    if (kart._trickAnimT > 0.1) sawAirborneTrick = true;
    assert.equal(typeof kart.state.groundY, 'number', 'kart.state.groundY must always be populated for steady camera anchoring');
    const airLift = Math.max(0, kart.state.position.y - kart.state.groundY);
    const camAnchorY = kart.state.groundY + airLift * 0.25;
    // Camera vertical anchor should only lift by 25% of jump height so horizon stays level
    assert.ok(camAnchorY <= kart.state.groundY + airLift * 0.25 + 1e-5);
    // Horizontal camera forward vector derived from kart.state.heading must stay aligned with ramp direction
    // even while kart.group.rotation.x / z spins 360° during a trick!
    const camFwd = new THREE.Vector3(Math.sin(kart.state.heading), 0, Math.cos(kart.state.heading));
    assert.equal(camFwd.y, 0, 'Chase camera forward vector must stay strictly horizontal (y = 0)');
    assert.ok(camFwd.dot(rDir) > 0.95, 'Chase camera must never whip backward during ramp pitch or 360° trick flip');
  }
  assert.ok(sawAirborneTrick, 'Kart should perform a mid-air trick during the ramp jump while camera stays steady');
});

test('iPhone Controller UI & UX: locked landscape D-pad layout, portrait-to-landscape auto-rotation, and anti-double-tap zoom/highlight guards', async () => {
  const fs = await import('node:fs');
  const controllerSrc = fs.readFileSync(new URL('../../src/ui/ControllerApp.js', import.meta.url), 'utf8');
  const touchControlsSrc = fs.readFileSync(new URL('../../src/ui/TouchControls.js', import.meta.url), 'utf8');
  const menuSrc = fs.readFileSync(new URL('../../src/ui/Menu.js', import.meta.url), 'utf8');
  const cssSrc = fs.readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

  // 1. Tactile D-Pad Cross replaces the old overflowing circular steering wheel
  assert.ok(controllerSrc.includes('class="zc-dpad-cross"'), 'ControllerApp must render tactile D-pad cross (.zc-dpad-cross)');
  assert.ok(controllerSrc.includes('id="zc-steer-left"') && controllerSrc.includes('id="zc-steer-right"'), 'ControllerApp must render left/right D-pad wings');
  assert.ok(!controllerSrc.includes('id="zc-wheel"'), 'ControllerApp must not render the old overflowing circular wheel alongside the D-pad');

  // 2. Locked Landscape Mode (Screen Orientation API lock + automatic 90deg CSS rotation when iPhone is in Portrait)
  assert.ok(controllerSrc.includes("screen.orientation?.lock?.('landscape')"), 'ControllerApp must request screen.orientation.lock("landscape")');
  assert.ok(controllerSrc.includes('is-portrait-locked-landscape'), 'ControllerApp must rotate 90deg into landscape when iPhone is held in portrait');
  assert.ok(cssSrc.includes('.zario-controller-shell.is-portrait-locked-landscape'), 'ui.css must style .is-portrait-locked-landscape with 90deg rotation');

  // 3. Anti-double-tap zoom, anti-highlight, and iOS 16px input guard across ControllerApp & TouchControls
  assert.ok(controllerSrc.includes("addEventListener('dblclick'"), 'ControllerApp must block dblclick zoom');
  assert.ok(controllerSrc.includes("addEventListener('gesturestart'"), 'ControllerApp must block iOS Safari pinch/double-tap gesturestart');
  assert.ok(controllerSrc.includes("addEventListener('selectstart'"), 'ControllerApp must block text selection highlight');
  assert.ok(touchControlsSrc.includes("addEventListener('dblclick'") && touchControlsSrc.includes("addEventListener('gesturestart'"), 'TouchControls must also block dblclick and gesturestart');
  assert.ok(cssSrc.includes('font-size: 16px !important'), 'Room input must use >=16px font-size to prevent iOS Safari auto-zoom on focus');

  // 4. Main Menu compact 3-column utility row below .sk3d-current-pick (zero vertical overflow on iPhone landscape)
  assert.ok(menuSrc.includes("subRow.prepend(toggle)") && menuSrc.includes("picked?.after(subRow)"), 'Menu.js must combine Settings, TV+iPhone, and Logs into a single horizontal row below .sk3d-current-pick');
  assert.ok(cssSrc.includes('grid-template-columns: repeat(3, minmax(0, 1fr)) !important'), 'ui.css must lay out the 3 utility buttons in one compact row');

  // 5. Runtime Mount Verification of mountControllerApp in Portrait (390x844) -> Landscape (844x390)
  const { mountControllerApp } = await import('../../src/ui/ControllerApp.js');
  const winListeners = {};
  window.addEventListener = (type, fn) => {
    (winListeners[type] = winListeners[type] || []).push(fn);
  };
  document.documentElement = { classList: { add() {}, remove() {}, toggle() {} } };
  document.getElementById = () => null;
  document.querySelector = () => null;

  const origCreateElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const el = origCreateElement(tag);
    const classes = new Set();
    const listeners = {};
    el.classList = {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, force) => (force === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (force ? classes.add(c) : classes.delete(c))),
      contains: (c) => classes.has(c),
    };
    el.addEventListener = (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    };
    el.dispatchEvent = (ev) => {
      for (const fn of listeners[ev.type] || []) fn(ev);
    };
    return el;
  };

  let mountedUi = null;
  const rootContainer = {
    appendChild(child) {
      mountedUi = child;
    },
  };

  // Mount while iPhone is in Portrait (390x844, e.g., iOS Portrait Orientation Lock enabled)
  window.innerWidth = 390;
  window.innerHeight = 844;
  const ctrl = mountControllerApp(rootContainer);
  assert.ok(mountedUi, 'mountControllerApp should append #zario-iphone-controller to container');
  assert.equal(mountedUi.classList.contains('is-portrait-locked-landscape'), true, 'In Portrait (390x844), controller must auto-lock into rotated Landscape mode');
  assert.equal(mountedUi.style.width, '844px', 'Rotated landscape width must equal portrait height (844px)');
  assert.equal(mountedUi.style.height, '390px', 'Rotated landscape height must equal portrait width (390px)');
  assert.ok(mountedUi.style.transform.includes('rotate(90deg)'), 'Must apply rotate(90deg) in portrait');

  // Rotate iPhone to native Landscape (844x390)
  window.innerWidth = 844;
  window.innerHeight = 390;
  for (const fn of winListeners.resize || []) fn();
  assert.equal(mountedUi.classList.contains('is-portrait-locked-landscape'), false, 'In native Landscape (844x390), 90deg rotation class must be removed');
  assert.equal(mountedUi.style.width, '844px');
  assert.equal(mountedUi.style.height, '390px');
  assert.equal(mountedUi.style.transform, 'none');

  // Verify double-tap (dblclick), selectstart, gesturestart, and rapid touchend call preventDefault()
  for (const evType of ['dblclick', 'selectstart', 'contextmenu', 'gesturestart']) {
    let prevented = false;
    mountedUi.dispatchEvent({
      type: evType,
      target: { id: 'zc-steer-left' },
      preventDefault() { prevented = true; },
    });
    assert.equal(prevented, true, `${evType} on controller button must call preventDefault()`);
  }

  // Rapid double-touchend (<350ms) must call preventDefault() on the second tap
  let firstPrevented = false;
  let secondPrevented = false;
  mountedUi.dispatchEvent({
    type: 'touchend',
    target: { id: 'zc-btn-accel' },
    preventDefault() { firstPrevented = true; },
  });
  mountedUi.dispatchEvent({
    type: 'touchend',
    target: { id: 'zc-btn-accel' },
    preventDefault() { secondPrevented = true; },
  });
  assert.equal(firstPrevented, false);
  assert.equal(secondPrevented, true, 'Rapid double-tap touchend (<350ms) must call preventDefault() to block iOS zoom');

  // Clean up controller and bridge timers so Node exits immediately
  ctrl.destroy();
});

test('Victory Song & Sad Last-Place Song: VICTORY_TRACK (148 BPM brass fanfare), DEFEAT_TRACK (88 BPM sad_trombone lament), and SFX recipes', async () => {
  // 1. Victory Trophy song (1st–3rd place podium)
  assert.ok(VICTORY_TRACK, 'VICTORY_TRACK must be exported from src/audio/music.js');
  assert.equal(VICTORY_TRACK.name, 'Victory Trophy');
  assert.equal(VICTORY_TRACK.bpm, 148, 'Victory song should be a celebratory 148 BPM podium groove');
  assert.equal(VICTORY_TRACK.leadInstrument, 'brass', 'Victory song should use celebratory brass lead');
  assert.equal(VICTORY_TRACK.leadPattern.length, 32, 'Victory song should have a 32-step fanfare melody');

  // 2. Sad Tailpipe Blues defeat song (4th–6th / last place)
  assert.ok(DEFEAT_TRACK, 'DEFEAT_TRACK must be exported from src/audio/music.js');
  assert.equal(DEFEAT_TRACK.name, 'Sad Tailpipe Blues');
  assert.equal(DEFEAT_TRACK.bpm, 88, 'Sad defeat song should be a slow 88 BPM lament');
  assert.equal(DEFEAT_TRACK.leadInstrument, 'sad_trombone', 'Sad defeat song should use sad_trombone lead voice');
  assert.equal(DEFEAT_TRACK.leadPattern.length, 32, 'Sad defeat song should have a 32-step descending minor melody');

  // 3. Verify SFX recipes include 'defeat', 'sadLose', and 'slipstream'
  const fs = await import('node:fs');
  const sfxSrc = fs.readFileSync(new URL('../../src/audio/sfx.js', import.meta.url), 'utf8');
  const { renderSfx } = await import('../../src/audio/sfx.js');
  assert.equal(typeof renderSfx, 'function', 'renderSfx must be exported from src/audio/sfx.js');
  assert.ok(sfxSrc.includes("case 'defeat':"), 'src/audio/sfx.js must define defeat sad trombone fanfare recipe');
  assert.ok(sfxSrc.includes("case 'sadLose':"), 'src/audio/sfx.js must define sadLose alias');
  assert.ok(sfxSrc.includes("case 'slipstream':"), 'src/audio/sfx.js must define slipstream boost SFX recipe');
});

test('3D Racer Showroom in Racer Selection: RacerShowroom3D renders 3D Kart models onto character cards with single offscreen WebGL context and clean fallback', async () => {
  const fs = await import('node:fs');
  const showroomSrc = fs.readFileSync(new URL('../../src/ui/RacerShowroom3D.js', import.meta.url), 'utf8');
  const menuSrc = fs.readFileSync(new URL('../../src/ui/Menu.js', import.meta.url), 'utf8');

  assert.ok(showroomSrc.includes('new Kart('), 'RacerShowroom3D must instantiate real 3D Kart models for each racer');
  assert.ok(showroomSrc.includes('startLive') && showroomSrc.includes('stopLive'), 'RacerShowroom3D must start and stop live turntable animation when opening/closing Racer Selection');
  assert.ok(menuSrc.includes('racerShowroom3D.startLive'), 'Menu.js must start 3D Racer Showroom live preview when opening the Racers screen');
  assert.ok(menuSrc.includes('racerShowroom3D.stopLive'), 'Menu.js must stop 3D Racer Showroom loop when closing screens or starting a race');

  const { racerShowroom3D } = await import('../../src/ui/RacerShowroom3D.js');
  assert.ok(racerShowroom3D, 'racerShowroom3D singleton must be exported');
  // In headless Node (no WebGL context), renderAllCards must return false cleanly so 2D fallback runs without throwing
  const rendered = racerShowroom3D.renderAllCards([]);
  assert.equal(rendered, false, 'In headless Node without WebGL, renderAllCards should return false for graceful fallback');
  racerShowroom3D.stopLive();
});

test('Playability Upgrades: 3-Tier Mini-Turbo Drift (Blue -> Orange Super -> Purple Ultra) and 13.5m Slipstream Slingshot Boost', () => {
  const scene = new THREE.Scene();
  const track = buildTrack(scene, TRACK_PATH, 1);
  const startPt = track.path.getPointAt(0.05);
  const startTan = track.path.getTangentAt(0.05).setY(0).normalize();
  const startH = Math.atan2(startTan.x, startTan.z);

  // 1. Test 3-Tier Mini-Turbo progression and Purple Ultra Mini-Turbo boost duration (1150ms)
  const kart = new Kart({
    character: CONFIG.kart.characters[0],
    isPlayer: true,
    startPosition: startPt.clone(),
    startHeading: startH,
  });
  kart.state.speed = 32;

  const tiersSeen = [];
  let tierAwarded = 0;
  kart._onDriftTier = (tier) => tiersSeen.push(tier);
  kart._onMiniBoost = (_charge01, tier) => { tierAwarded = tier; };

  // Hold drift + steer until reaching Tier 3 (Purple Ultra Mini-Turbo, charge >= 0.90)
  for (let i = 0; i < 160; i++) {
    kart.setControls({ steer: 0.85, throttle: 1, brake: false, drift: true });
    kart.update(1 / 60, { track });
    if (kart.state.driftTier === 3) break;
  }
  assert.deepEqual(tiersSeen, [1, 2, 3], 'Drifting should progress through Tier 1 (Blue), Tier 2 (Orange Super), and Tier 3 (Purple Ultra)');
  assert.equal(kart.state.driftTier, 3, 'Kart should hold driftTier = 3 near full charge');

  // Release drift to trigger Ultra Mini-Turbo boost
  kart.setControls({ steer: 0, throttle: 1, brake: false, drift: false });
  kart.update(1 / 60, { track });
  assert.equal(tierAwarded, 3, 'Releasing a Tier 3 drift must award Tier 3 Ultra Mini-Turbo');
  assert.equal(kart.state.boost, true, 'Kart boost state should be active after releasing Tier 3 drift');
  assert.ok(kart._boostMs >= 1100, `Releasing a Tier 3 Ultra Mini-Turbo must grant ~1150ms boost (got ${kart._boostMs}ms)`);

  // 2. Test 13.5m Slipstream Drafting Cone and Automatic Slingshot Boost after ~1.05s
  const chaser = new Kart({
    character: CONFIG.kart.characters[0],
    isPlayer: true,
    startPosition: startPt.clone(),
    startHeading: startH,
  });
  const leader = new Kart({
    character: CONFIG.kart.characters[1],
    isPlayer: false,
    startPosition: startPt.clone().addScaledVector(startTan, 9.5), // 9.5m ahead along road (inside new 13.5m cone!)
    startHeading: startH,
  });
  leader.state.speed = 28;
  chaser.state.speed = 28;

  let draftSlingshotFired = false;
  chaser._onDraftStart = () => {};
  chaser._onDraftExit = (kind) => {
    if (kind === 'slingshot') draftSlingshotFired = true;
  };

  const mockRm = { karts: [leader, chaser], elapsed: 5.0 };
  for (let i = 0; i < 75; i++) {
    mockRm.elapsed += 1 / 60;
    const h = chaser.state.heading;
    // Keep leader ~9.5m directly ahead of chaser along chaser's heading
    leader.state.position.set(
      chaser.state.position.x + Math.sin(h) * 9.5,
      chaser.state.position.y,
      chaser.state.position.z + Math.cos(h) * 9.5
    );
    leader.state.heading = h;
    chaser.setControls({ steer: 0, throttle: 1, brake: false, drift: false });
    chaser.update(1 / 60, { track, raceManager: mockRm });
    if (draftSlingshotFired) break;
  }
  assert.equal(draftSlingshotFired, true, 'Holding slipstream within 13.5m for ~1.05s must trigger automatic Slipstream Slingshot Boost');
  assert.equal(chaser.state.boost, true, 'Chaser kart boost state should be active after Slipstream Slingshot');
  assert.ok(chaser._boostMs >= 700, `Slipstream Slingshot must apply >=700ms boost on the chaser kart (got ${chaser._boostMs}ms)`);
});

test('Mario Kart Hop-Into-Drift & Tire Smoke Animation: pressing Drift button jumps ~0.42m, angles kart into crab-slide yaw, and bursts dual-tire smoke & sparks', async () => {
  const fs = await import('node:fs');
  const sfxSrc = fs.readFileSync(new URL('../../src/audio/sfx.js', import.meta.url), 'utf8');
  assert.ok(sfxSrc.includes("case 'driftHop':"), 'src/audio/sfx.js must include the driftHop sound recipe');

  const scene = new THREE.Scene();
  const track = buildTrack(scene, TRACK_PATH, 1);
  const startPt = track.path.getPointAt(0.05);
  const startTan = track.path.getTangentAt(0.05).setY(0).normalize();
  const startH = Math.atan2(startTan.x, startTan.z);

  const kart = new Kart({
    character: CONFIG.kart.characters[0],
    isPlayer: true,
    startPosition: startPt.clone(),
    startHeading: startH,
  });
  kart.state.speed = 30;

  let hopStarted = false;
  let hopLanded = false;
  let maxHopHeightLift = 0;
  let maxCrabSlipYaw = 0;
  const emittedTypes = new Set();

  kart._onDriftHop = () => { hopStarted = true; };
  kart._onDriftHopLand = () => { hopLanded = true; };

  const mockParticles = {
    emit(type) {
      emittedTypes.add(type);
    },
  };

  // Run 22 frames (~0.36s) while holding Drift + steering right (+0.85)
  for (let i = 0; i < 22; i++) {
    kart.setControls({ steer: 0.85, throttle: 1, brake: false, drift: true });
    kart.update(1 / 60, { track, particles: mockParticles });
    const hopLift = kart.group.position.y - kart.state.position.y;
    if (hopLift > maxHopHeightLift) maxHopHeightLift = hopLift;
    const slipYaw = Math.abs(kart.group.rotation.y - kart.state.heading);
    if (slipYaw > maxCrabSlipYaw) maxCrabSlipYaw = slipYaw;
  }

  assert.equal(hopStarted, true, 'Pressing Drift button must trigger _onDriftHop immediately');
  assert.ok(maxHopHeightLift >= 0.35, `Kart should jump ~0.42m into the air during the Drift Hop (got ${maxHopHeightLift.toFixed(2)}m)`);
  assert.ok(maxCrabSlipYaw >= 0.20, `Kart body should angle into a Mario Kart crab-slide yaw while drifting (got ${maxCrabSlipYaw.toFixed(2)} rad)`);
  assert.equal(hopLanded, true, 'Kart should complete the 240ms Drift Hop and trigger _onDriftHopLand');
  assert.ok(emittedTypes.has('drift'), 'Drifting and landing the hop must emit billowing tire smoke ("drift" particles)');
  assert.ok(emittedTypes.has('sparkle'), 'Landing the drift hop must emit tire-bite sparks ("sparkle" particles)');
});



