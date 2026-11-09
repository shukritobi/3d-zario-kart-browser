import test from 'node:test';
import assert from 'node:assert/strict';
import {projectTrackLattice, projectTrackSegment} from '../../src/entities/trackProjection.js';
import {PerformanceGovernor} from '../../src/render/PerformanceGovernor.js';
import {RaceDiagnostics} from '../../src/game/RaceDiagnostics.js';

test('road projection follows slopes continuously between sample vertices',()=>{
  const samples={
    N:4,total:40,
    pos:[{x:0,y:0,z:0},{x:10,y:5,z:0},{x:10,y:5,z:10},{x:0,y:0,z:10}],
    len:[0,10,20,30],
  };
  const a=projectTrackLattice(samples,0,{x:2.5,y:11,z:0.4});
  const b=projectTrackLattice(samples,0,{x:7.5,y:11,z:0.4});
  assert.ok(Math.abs(a.groundY-1.25)<.001);
  assert.ok(Math.abs(b.groundY-3.75)<.001);
  assert.ok(a.progress01<b.progress01);
  assert.ok(a.lateralDist<0);
  const seam=projectTrackLattice(samples,3,{x:0.1,y:0,z:2});
  assert.ok(seam.progress01>.8);
  assert.ok(seam.t>.8);
});
test('segment projection clamps outside ends and handles zero-length spans',()=>{
  const a={x:0,z:0},b={x:10,z:0};
  assert.equal(projectTrackSegment(a,b,{x:-3,z:4}).alpha,0);
  assert.equal(projectTrackSegment(a,b,{x:15,z:4}).alpha,1);
  assert.equal(projectTrackSegment(a,a,{x:2,z:0}).alpha,0);
});
test('adaptive pixel ratio only decreases after sustained slow frames and cooldown',()=>{
  const g=new PerformanceGovernor({initial:1.4,min:.9,max:1.4});
  g.reset();
  let result=null;
  for(let i=0;i<13*60;i++)result=g.update(34,1/60)||result;
  assert.ok(result !== null && result<1.4);
  assert.ok(g.scale>=.9);
  assert.equal(g.update(100,0,false),null);
  let changes=0;
  for(let i=0;i<4*60;i++)if(g.update(34,1/60))changes++;
  assert.equal(changes,0);
});
test('no adaptive changes on explicit quality override',()=>{
  const g=new PerformanceGovernor({initial:1.25,enabled:false});
  for(let i=0;i<60*60;i++)g.update(42,1/60,true);
  assert.equal(g.status().changes,0);
  assert.equal(g.scale,1.25);
});
test('flight recorder limits memory and reports jumps, contacts, and rescues',()=>{
  const d=new RaceDiagnostics({sampleHz:60,maxSamples:3,maxEvents:3});
  const player={state:{position:{x:0,y:1,z:0},speed:20,lap:0,progress01:.2},_latVel:0};
  d.start({track:2});
  for(let i=0;i<10;i++){
    player.state.position.x+=.3;
    d.tick({dt:1/30,player,frameMs:16,pixelRatio:1.25,audioState:'running'});
  }
  player.state.position.x+=50;
  d.tick({dt:1/30,player,frameMs:40});
  d.event('wall',{overshoot:.4});
  d.event('rescue',{reason:'offRoad'});
  assert.equal(d.counts['position-jump'],1);
  assert.equal(d.counts.wall,1);
  assert.equal(d.counts.rescue,1);
  assert.ok(d.snapshot().samples.length<=3);
  assert.ok(d.snapshot().events.length<=3);
  assert.equal(JSON.parse(d.exportJSON()).metadata.track,2);
  d.start({track:3});
  assert.equal(d.snapshot().counts.wall,0);
});
