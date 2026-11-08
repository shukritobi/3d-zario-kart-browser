/**
 * Super Kart 3D.js — SkidMarks.
 * Pooled tire marks left on the road while drifting. Each mark is a flat
 * plane sitting just above the road ribbon (y+0.185) with polygonOffset so
 * it never z-fights; opacity fades out over `life` seconds, then the slot is
 * recycled. Cheap: fixed pool, no allocation per mark.
 */
import * as THREE from 'three';

const MARK_W = 0.5;
const MARK_L = 1.8;
const RIBBON_Y = 0.185; // road ribbon sits at y+0.18; sit just above it
const START_OPACITY = 0.28;
const LIFE = 3.0;

export class SkidMarks {
  /** @param {THREE.Scene} scene @param {number} [max] */
  constructor(scene, max = 80) {
    this.marks = [];
    const geo = new THREE.PlaneGeometry(MARK_W, MARK_L);
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x14171c,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.marks.push({ mesh, t: 0, life: 0 });
    }
    this.cursor = 0;
  }

  /**
   * Drop a tire mark at a world position, oriented along `heading` (radians).
   * @param {THREE.Vector3} pos ground position (y = ground level)
   * @param {number} heading kart heading in world radians
   * @param {number} [charge01=0] drift charge 0..1 — AUDIT R11: marcas mais
   *   longas/visíveis conforme a carga (o rastro vira recompensa visual).
   */
  leave(pos, heading, charge01 = 0) {
    const slot = this.marks[this.cursor];
    this.cursor = (this.cursor + 1) % this.marks.length;
    const m = slot.mesh;
    m.visible = true;
    m.position.set(pos.x, pos.y + RIBBON_Y, pos.z);
    // Flat plane; yaw so its length runs along the kart's travel direction.
    m.rotation.set(-Math.PI / 2, 0, -heading);
    slot.t = 0;
    slot.life = LIFE;
    // AUDIT R11: escala com a carga (0.7x vazio → 1.15x tier 3) + opacidade.
    const ch = Math.max(0, Math.min(1, charge01 || 0));
    m.scale.set(0.7 + ch * 0.45, 1, 1);
    m.material.opacity = START_OPACITY * (0.6 + ch * 0.5);
  }

  /** Fade + recycle expired marks. @param {number} dt seconds */
  update(dt) {
    for (const s of this.marks) {
      if (!s.mesh.visible) continue;
      s.t += dt;
      if (s.t >= s.life) {
        s.mesh.visible = false;
        continue;
      }
      s.mesh.material.opacity = Math.max(0, START_OPACITY * (1 - s.t / s.life));
    }
  }

  /** Hide everything (restart / menu). */
  clear() {
    for (const s of this.marks) {
      s.mesh.visible = false;
      s.mesh.material.opacity = 0;
    }
  }
}
