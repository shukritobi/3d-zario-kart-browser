import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CANYON_PATH,SKY_PATH} from '../../src/track/ExtraTracks.js';
import {nearestCenterlineIndex} from '../../src/entities/itemTargeting.js';

test('both new circuits are full-length without sudden near-180 corners', () => {
  for(const [name,points] of [['Canyon',CANYON_PATH],['Cloudtop',SKY_PATH]]) {
    const path=new THREE.CatmullRomCurve3(points,true,'catmullrom',0.5);
    const length=path.getLength();
    assert.ok(length>1000&&length<2100, name+' too short or long '+length);
    const N=300;
    for(let i=0;i<N;i++){
      const a=path.getTangentAt(i/N),b=path.getTangentAt(((i+1)%N)/N);
      assert.ok(a.angleTo(b)<0.35, name+' abrupt tangent at '+i);
    }
    const pos=path.getPointAt(0);
    const last=path.getPointAt(1);
    assert.ok(pos.distanceTo(last)<0.0001, name+' not closed');
  }
});

test('nearest point lookup initializes away from start line and recovers lost hints', () => {
  const curve=new THREE.CatmullRomCurve3(CANYON_PATH,true,'catmullrom',0.5);
  const pts=curve.getSpacedPoints(240).slice(0,240);
  for(const t of [.05,.21,.41,.63,.89]){
    const pos=curve.getPointAt(t);
    const first=nearestCenterlineIndex(pts,pos.x,pos.z);
    assert.ok(first.distanceSquared<26, 'initial search missed '+t+' '+first.distanceSquared);
    const wrongHint=nearestCenterlineIndex(pts,pos.x,pos.z,(first.index+120)%240,12);
    assert.equal(wrongHint.index,first.index, 'off-road cleanup stayed anchored to wrong side');
  }
});

test('local nearest point lookup wraps smoothly over track seam', () => {
  const n=240;
  const pts=Array.from({length:n},(_,i)=>({x:100*Math.cos(i/n*Math.PI*2),z:100*Math.sin(i/n*Math.PI*2)}));
  const p=pts[2],result=nearestCenterlineIndex(pts,p.x,p.z,n-2);
  assert.equal(result.index,2);
});


test('shell sweep detects hits even when projectile jumps past opponent in one frame',async()=>{
  const {pointSegmentDistanceSquared}=await import('../../src/entities/itemTargeting.js');
  assert.ok(pointSegmentDistanceSquared(5,0,0,0,10,0)<0.0001);
  assert.ok(pointSegmentDistanceSquared(5,2.1,0,0,10,0)<5.29);
  assert.ok(pointSegmentDistanceSquared(5,3,0,0,10,0)>5.29);
  assert.equal(pointSegmentDistanceSquared(3,4,0,0,0,0),25);
});


test('upcoming turns use metric look-ahead with consistent LEFT and RIGHT signs',async()=>{
  const {computeUpcomingTurn}=await import('../../src/ui/RouteHints.js');
  const mk=side=>({getTangentAt(t){
    const angle=t<.2?0:t<.5?side*Math.PI/4:side*Math.PI/2;
    return {x:Math.sin(angle),z:Math.cos(angle)};
  }});
  assert.equal(computeUpcomingTurn(mk(1),.1,200,0,22)?.direction,'RIGHT');
  assert.equal(computeUpcomingTurn(mk(-1),.1,200,0,22)?.direction,'LEFT');
  assert.equal(computeUpcomingTurn(mk(1),.1,200,Math.PI,22),null);
  assert.equal(computeUpcomingTurn(mk(1),.1,200,0,0),null);
});
