import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAngle, screenTilt, tiltToSteer } from '../../src/input/tiltMath.js';
import { lateralVelocityStep, playerDriftSteerRate } from '../../src/entities/handling.js';

test('landscape primary screen tilt is positive to the right, 270 is mirrored', () => {
  assert.equal(normalizeAngle(-90), 270);
  assert.equal(normalizeAngle(450), 90);
  assert.equal(screenTilt({ beta: 22, gamma: 4 }, 90), 22);
  assert.equal(screenTilt({ beta: 22, gamma: 4 }, 270), -22);
  assert.equal(screenTilt({ beta: 22, gamma: 4 }, 0), 4);
  assert.equal(screenTilt({ beta: 22, gamma: 4 }, 180), -4);
  assert.equal(screenTilt({ beta: 22, gamma: 4 }, 90, 'gamma'), 4);
  assert.equal(screenTilt({ beta: null, gamma: 7 }, 90), null);
});

test('gyro input has a calibrated deadzone and reverses symmetrically', () => {
  assert.equal(tiltToSteer(10, 10), 0);
  assert.equal(tiltToSteer(11, 10), 0);
  assert.ok(tiltToSteer(28, 10) > 0.4);
  assert.ok(tiltToSteer(-8, 10) < -0.4);
  assert.equal(tiltToSteer(10, null), 0);
  assert.equal(tiltToSteer(100, 10), 1);
  assert.equal(tiltToSteer(-80, 10), -1);
});

test('tight player drifting slides less and recovers faster than classic', () => {
  const run = (mode, released = false) => {
    let lateral = 0;
    for (let i = 0; i < 60; i++) lateral = lateralVelocityStep({
      lateral, dt: 1 / 60, steering: 1, drifting: true, isPlayer: true, gripMode: mode,
    });
    const atRelease = lateral;
    if (released) for (let i = 0; i < 15; i++) lateral = lateralVelocityStep({
      lateral, dt: 1 / 60, steering: 0, drifting: false, isPlayer: true, gripMode: mode,
    });
    return {lateral, atRelease};
  };
  const tight = run('tight', true);
  const classic = run('classic', true);
  assert.ok(tight.atRelease < classic.atRelease * 0.55, 'tight drift reduces side slip >45%');
  assert.ok(tight.lateral < tight.atRelease * 0.05, 'tight lateral velocity recovers in 250ms');
  assert.ok(tight.lateral < classic.lateral, 'tight recovery faster than classic');
  assert.ok(playerDriftSteerRate(3.6, true, 'tight') < playerDriftSteerRate(3.6, true, 'classic'));
  assert.equal(playerDriftSteerRate(3.6, false, 'tight'), 3.6, 'AI handling unchanged');
});

test('tight handling preserves some drift and cannot create drift when idle', () => {
  const lat = lateralVelocityStep({ lateral: 0, dt: 0.2, steering: 1, drifting: true, isPlayer: true, gripMode: 'tight' });
  assert.ok(lat > 0);
  assert.equal(lateralVelocityStep({ lateral: 0, dt: 1 / 60, steering: 0, drifting: false, isPlayer: true }), 0);
});
