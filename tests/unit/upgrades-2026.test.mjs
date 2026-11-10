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
import { TRACKS, MENU_TRACK, STAR_TRACK } from '../../src/audio/music.js';

test('Ramp physics: launches across center, left (-2.4m), and right (+2.4m) lanes and lands with 850ms Trick Boost', () => {
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

    for (let i = 0; i < 160; i++) {
      kart.setControls({ steer: 0, throttle: 1, brake: false, drift: true });
      kart.update(1 / 60, { track });

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
    assert.ok(TrickFired, `Kart in lane offset ${lateralOffset}m should trigger a Mario Kart Trick Boost upon landing`);
    assert.ok(kart._boostMs >= 750 && kart.state.boost, `Kart should receive 850ms trick boost on landing (_boostMs=${kart._boostMs})`);
  }
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
  }, 'UnitTest-Relay');

  const frame1 = host.sampleFrameInput();
  assert.ok(frame1, 'Host should return active frame input');
  assert.ok(Math.abs(frame1.steer - (-0.65)) < 1e-6);
  assert.equal(frame1.throttle, 1);
  assert.equal(frame1.drift, true);
  assert.equal(frame1.useItem, true, 'First frame with useItem=true should trigger rising edge');
  assert.equal(frame1.swapItem, true, 'First frame with swapItem=true should trigger rising edge');

  // Second sample without new press should clear one-shot edge flags
  const frame2 = host.sampleFrameInput();
  assert.equal(frame2.useItem, false, 'Rising-edge useItem should be consumed on first sample');
  assert.equal(frame2.swapItem, false, 'Rising-edge swapItem should be consumed on first sample');
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
