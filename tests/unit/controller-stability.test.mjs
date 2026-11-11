import './_dom-shim.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CONFIG} from '../../src/config.js';
import {Kart} from '../../src/entities/Kart.js';
import {ShellProjectile} from '../../src/entities/PowerUp.js';
import {SwitchHostBridge, SwitchClientBridge} from '../../src/input/SwitchBridge.js';

test('P1 and P2 pairing room IDs remain stable after host page reload', () => {
  const saved = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: k => saved.get(k) ?? null,
    setItem: (k,v) => saved.set(k,String(v)),
  };
  try {
    const p1a = new SwitchHostBridge({storageKey:'zario.host.room.p1'});
    const p2a = new SwitchHostBridge({storageKey:'zario.host.room.p2'});
    assert.notEqual(p1a.roomCode,p2a.roomCode,'Different players need unique rooms');
    const p1b = new SwitchHostBridge({storageKey:'zario.host.room.p1'});
    const p2b = new SwitchHostBridge({storageKey:'zario.host.room.p2'});
    assert.equal(p1a.roomCode,p1b.roomCode);
    assert.equal(p2a.roomCode,p2b.roomCode);
  } finally {
    globalThis.localStorage = previous;
  }
});

test('Bridge receives gyro state diagnostics and preserves one-shot menu navigation', () => {
  const host = new SwitchHostBridge({roomCode:'P1XY'});
  host._handleIncomingPacket({
    type:'controller_input',seq:1,ts:Date.now(),
    gyroEnabled:true,tiltDeg:14,sensorState:'receiving',permissionState:'granted',
    sensorAgeMs:32,sensorEventCount:18,screenAngle:90,
    menuX:1,menuConfirm:true,
  },'Test');
  const state=host.sampleFrameInput();
  assert.equal(state.menuX,1);
  assert.equal(state.menuConfirm,true);
  assert.equal(host.sampleFrameInput().menuX,0);
  const report=host.diagnosticReport();
  assert.equal(report.packetsReceived,1);
  assert.equal(report.gyroPacketsReceived,1);
  assert.equal(report.lastGyro.sensorState,'receiving');
  assert.equal(report.lastGyro.sensorAgeMs,32);
  assert.ok(report.events.some(x=>x.type==='gyro-status'));
  const client = new SwitchClientBridge({roomCode:'P1XY'});
  assert.equal(client.diagnosticReport().roomCode,'P1XY');
});

test('Kart tyres sit at the same surface anchor as the chassis ride height', () => {
  const k = new Kart({character:CONFIG.kart.characters[0],isPlayer:true});
  assert.equal(k.rideHeight,CONFIG.kart.wheelRadius + 0.04);
  assert.equal(k._wheels.length,4);
  for(const wheel of k._wheels) {
    assert.ok(Math.abs(wheel.root.position.y) < 0.0001,
      'Do not add the wheel radius a second time to its local mesh center');
  }
});

test('Shells are volumetric geometry with curved panels and layered rim', () => {
  const kart=new Kart({character:CONFIG.kart.characters[0],isPlayer:true});
  const projectile=new ShellProjectile(kart,{scene:null});
  const meshes=[];
  projectile.mesh.traverse(x=>{if(x.isMesh) meshes.push(x);});
  assert.ok(meshes.length>=20,'Multi-part shell should have carapace panels, rim and spikes');
  assert.ok(meshes.some(x=>x.geometry?.type==='TubeGeometry'),
    'Curved carapace panel seams are sculpted as 3D tubes');
  assert.ok(meshes.some(x=>x.geometry?.type==='SphereGeometry'));
  assert.ok(meshes.some(x=>x.geometry?.type==='TorusGeometry'));
  projectile.dispose();
});
