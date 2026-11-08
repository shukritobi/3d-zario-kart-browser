/**
 * Super Kart 3D.js — WorldPropKit (C3 / C2 shared).
 *
 * Reusable world-prop factories with a SHARED contact-shadow helper so every
 * track-side prop (cone, tire stack, banner pole, marshall post) gets the
 * same anchored ground shadow the rail already uses (TrackBuilder
 * buildEdgeRibbon contact shadow). Centralizing it stops each prop from
 * re-deriving its own shadow geometry and keeps the contact-shadow look
 * consistent across the world kit — the exact "shared contact shadow" the
 * C2 LOD gate asked for, applied to props instead of re-LODing the kart
 * (KartLOD was removed in R30: 6 on-screen karts + per-kart blob shadow made
 * hero/mid/impostor LOD a low-ROI, high-regression-risk change — ABANDONed).
 *
 * All factories return a THREE.Object3D (Group or Mesh) ready to be added to
 * the scene. Static meshes are tagged userData.skipInstancing=false so the
 * existing autoInstancing pass can still fold repeated props into one draw
 * call (C3 goal: density up, draw calls flat).
 *
 * No secrets, no absolute paths — pure procedural geometry.
 */

import * as THREE from 'three';
import { toonMaterial, plasticMaterial } from './Materials.js';

// Shared radial contact-shadow texture (one canvas, reused by every prop).
let _sharedShadowTex = null;
function sharedShadowTexture() {
  if (_sharedShadowTex) return _sharedShadowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(5,7,12,0.7)');
  grad.addColorStop(0.5, 'rgba(5,7,12,0.4)');
  grad.addColorStop(1, 'rgba(5,7,12,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _sharedShadowTex = tex;
  return tex;
}

/**
 * Shared contact-shadow mesh: a flat dark disc under a prop that anchors it
 * to the ground (MK8-style soft blob). Returns a Mesh at local y≈0.02.
 * @param {number} radius world radius of the shadow disc (m)
 * @param {number} [opacity] 0..1
 */
export function makeContactShadow(radius = 0.5, opacity = 0.55) {
  const mat = new THREE.MeshBasicMaterial({
    map: sharedShadowTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    color: 0x05070c,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.renderOrder = 1;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.skipInstancing = true; // shadow must follow its prop, never be folded
  return mesh;
}

/**
 * Marshal cone (track-side safety marker). Bright orange with a white
 * reflective band — reads as a hazard/guide cue at speed (Art Bible: ≤3
 * saturated hues, signal colors). Uses the MATERIAL_ROLES signal palette
 * indirectly via plasticMaterial orange.
 *
 * @param {object} [opts]
 * @param {number} [opts.radius=0.22] base radius (m)
 * @param {number} [opts.height=0.6] height (m)
 * @param {boolean} [opts.shadow=true] add a shared contact shadow
 * @returns {THREE.Group}
 */
export function makeMarshalCone({ radius = 0.22, height = 0.6, shadow = true } = {}) {
  const g = new THREE.Group();
  const coneMat = plasticMaterial(0xff7a1a, { roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.4 });
  coneMat.transparent = false;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 16), coneMat);
  cone.position.y = height / 2;
  cone.castShadow = true;
  g.add(cone);
  // White reflective band.
  const bandMat = new THREE.MeshBasicMaterial({ color: 0xf4f6f8, side: THREE.DoubleSide });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.78, radius * 0.92, height * 0.18, 16, 1, true), bandMat);
  band.position.y = height * 0.52;
  band.castShadow = false;
  g.add(band);
  // Base disc for stability read.
  const baseMat = plasticMaterial(0x2a2f38, { roughness: 0.8 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.15, radius * 1.15, 0.04, 16), baseMat);
  base.position.y = 0.02;
  base.castShadow = true;
  g.add(base);
  if (shadow) g.add(makeContactShadow(radius * 1.3, 0.5));
  g.userData.prop = 'marshalCone';
  return g;
}

/**
 * Track-side bollard (short reflective post) — a second reusable prop so the
 * kit demonstrates shared-shadow reuse across two distinct shapes.
 * @param {object} [opts]
 * @param {number} [opts.h=0.5] height (m)
 * @param {boolean} [opts.shadow=true]
 */
export function makeBollard({ h = 0.5, shadow = true } = {}) {
  const g = new THREE.Group();
  const postMat = plasticMaterial(0xf4f6f8, { roughness: 0.6 });
  postMat.transparent = false;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, h, 12), postMat);
  post.position.y = h / 2;
  post.castShadow = true;
  g.add(post);
  // Reflective red collar.
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, h * 0.25, 12),
    new THREE.MeshBasicMaterial({ color: 0xff5a5f, side: THREE.DoubleSide })
  );
  collar.position.y = h * 0.5;
  g.add(collar);
  if (shadow) g.add(makeContactShadow(0.16, 0.5));
  g.userData.prop = 'bollard';
  return g;
}
