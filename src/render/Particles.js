/**
 * Super Kart 3D.js — ParticleSystem.
 * Pooled GPU point particles (custom ShaderMaterial) with three draw groups:
 *   - additive : boost flames, star trails, sparkles, lightning (glow)
 *   - normal   : exhaust, drift smoke, explosion smoke, crash dust
 *   - square   : confetti (square points, normal blending, flutter)
 * Lifetime + fade handled CPU-side; dead particles swap-removed (no per-frame
 * allocation). Total capacity capped at ~600 particles; over-cap emissions
 * recycle the oldest slot (FIFO ring cursor).
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const MAX_ADDITIVE = 240;
const MAX_NORMAL = 260;
const MAX_SQUARE = 100;

const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * (520.0 / max(0.1, -mv.z)), 1.0, 96.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
uniform float uShape; // 0.0 round, 1.0 square
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float a;
  if (uShape > 0.5) {
    float m = max(abs(uv.x), abs(uv.y));
    a = (1.0 - smoothstep(0.30, 0.46, m)) * vAlpha;
  } else {
    float d = length(uv);
    a = smoothstep(0.5, 0.12, d) * vAlpha;
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}`;

/**
 * Per-type emitter presets.
 * system : which draw group the particles go to
 * up     : extra upward velocity bias (confetti pops)
 */
const TYPES = {
  exhaust: {
    system: 'normal', count: 1, speed: 2.4, size: 0.20, life: 0.55,
    drag: 2.0, grav: 1.6, grow: 1.6, spread: 0.45, color: 0xd7dde4,
  },
  boost: {
    system: 'additive', count: 3, speed: 7.5, size: 0.40, life: 0.30,
    drag: 5.0, grav: -0.8, grow: 1.2, spread: 1.0, color: 0xffb25e,
  },
  drift: {
    system: 'normal', count: 1, speed: 1.4, size: 0.34, life: 0.85,
    drag: 1.4, grav: 0.8, grow: 2.4, spread: 0.4, color: 0xf2f5f8,
    alpha: 0.5, // wake smoke reads as solid white blobs at alpha 1 (GPU Neon)
  },
  pickup: {
    system: 'additive', count: 10, speed: 3.2, size: 0.14, life: 0.6,
    drag: 2.5, grav: -1.5, grow: 0.9, spread: 2.2, color: 0xffe066,
  },
  explosion: {
    // flash — emits both this and 'explosionSmoke' together
    system: 'additive', count: 10, speed: 7.0, size: 0.42, life: 0.28,
    drag: 4.0, grav: 0.0, grow: 2.2, spread: 3.0, color: 0xffc94d,
  },
  explosionSmoke: {
    system: 'normal', count: 14, speed: 3.2, size: 0.50, life: 1.1,
    drag: 1.8, grav: 2.2, grow: 2.6, spread: 1.8, color: 0x8d97a3,
  },
  confetti: {
    system: 'square', count: 48, speed: 5.5, size: 0.24, life: 1.7,
    drag: 0.5, grav: 7.5, grow: 0.0, spread: 3.0, up: 1.3,
    color: CONFIG.kart.playerColors,
  },
  starTrail: {
    system: 'additive', count: 3, speed: 0.8, size: 0.26, life: 0.55,
    drag: 1.0, grav: 0.0, grow: 1.4, spread: 0.3, color: null, // rainbow
  },
  lightning: {
    system: 'additive', count: 16, speed: 6.5, size: 0.32, life: 0.35,
    drag: 2.0, grav: 0.0, grow: 0.6, spread: 3.2, color: 0x9adcff,
  },
  crash: {
    system: 'normal', count: 8, speed: 2.6, size: 0.30, life: 0.5,
    drag: 2.0, grav: 2.5, grow: 1.2, spread: 1.2, color: 0xc9b28a,
  },
  dust: {
    system: 'normal', count: 5, speed: 1.6, size: 0.45, life: 0.9,
    drag: 1.6, grav: 1.4, grow: 1.8, spread: 0.9, color: 0xb08d5a,
  },
  sparkle: {
    // tiny bright star burst (mini-boost release, finish line) — additive
    system: 'additive', count: 8, speed: 3.0, size: 0.16, life: 0.55,
    drag: 2.0, grav: -0.8, grow: 0.6, spread: 1.6, color: 0xffe066,
  },
  shield: {
    // invincibility / star protective ripple — expanding ring read as a
    // absorbed-impact shell (AAA VFX: clarity over clutter)
    system: 'additive', count: 14, speed: 4.5, size: 0.30, life: 0.45,
    drag: 3.0, grav: 0.0, grow: 2.4, spread: 2.6, color: 0x6cf0ff,
  },
  nearMiss: {
    // side spark when a rival passes within graze distance without contact
    system: 'additive', count: 6, speed: 5.0, size: 0.14, life: 0.35,
    drag: 2.5, grav: 0.0, grow: 1.0, spread: 1.4, color: 0xfff0a0,
  },
  combo: {
    // drift-chain combo pop — rewards sustained drift tiers
    system: 'additive', count: 10, speed: 4.0, size: 0.20, life: 0.5,
    drag: 2.0, grav: -0.5, grow: 1.2, spread: 1.8, color: 0xffd166,
  },
  speedline: {
    // thin additive wind streaks at high velocity (MK8 speed-line cue)
    system: 'additive', count: 2, speed: 14, size: 0.09, life: 0.22,
    drag: 0.4, grav: 0.0, grow: 1.6, spread: 0.15, color: 0xe8f4ff,
  },
};

const _randDir = new THREE.Vector3();

export class ParticleSystem {
  /**
   * @param {THREE.Scene} scene — systems are added to the scene here.
   */
  constructor(scene) {
    this.scene = scene;
    this._time = 0;
    this._systems = {
      additive: this._createSystem(MAX_ADDITIVE, THREE.AdditiveBlending, 0.0),
      normal: this._createSystem(MAX_NORMAL, THREE.NormalBlending, 0.0),
      square: this._createSystem(MAX_SQUARE, THREE.NormalBlending, 1.0),
    };
  }

  _createSystem(capacity, blending, shape) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uShape: { value: shape } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 10;
    this.scene.add(points);

    const sys = {
      points, geo, mat, capacity,
      count: 0, cursor: 0,
      // pre-allocated per-slot state (no per-frame allocation)
      pos: [], vel: [], col: [], phase: [],
      life: [], maxLife: [], size0: [], grow: [], drag: [], grav: [],
      alpha0: [], flutter: [],
    };
    for (let i = 0; i < capacity; i++) {
      sys.pos.push(new THREE.Vector3());
      sys.vel.push(new THREE.Vector3());
      sys.col.push(new THREE.Color());
      sys.phase.push(0);
      sys.life.push(0);
      sys.maxLife.push(1);
      sys.size0.push(0);
      sys.grow.push(0);
      sys.drag.push(0);
      sys.grav.push(0);
      sys.alpha0.push(1);
      sys.flutter.push(0);
    }
    return sys;
  }

  /**
   * Spawn particles. `position` is a world-space Vector3.
   * opts: { color, count, speed, size, duration, velocity, spread, gravity,
   *         grow, alpha, jitter, up }
   *   velocity — base velocity (Vector3, copied); particles scatter around it.
   *   color    — number, or array of numbers (random pick).
   */
  emit(type, position, opts = {}) {
    if (!position) return;
    if (type === 'explosion') {
      // Flash + smoke in one call.
      this._burst('explosion', position, opts);
      this._burst('explosionSmoke', position, opts);
      return;
    }
    this._burst(type, position, opts);
  }

  _burst(type, position, opts) {
    const cfg = TYPES[type];
    if (!cfg) return;
    const sys = this._systems[cfg.system];
    const count = Math.min(opts.count ?? cfg.count, 140);
    const baseSpeed = opts.speed ?? cfg.speed;
    const size = opts.size ?? cfg.size;
    const life = opts.duration ?? cfg.life;
    const spread = opts.spread ?? cfg.spread;
    const pal = Array.isArray(opts.color) ? opts.color : (Array.isArray(cfg.color) ? cfg.color : null);
    const color = pal ? null : (opts.color ?? cfg.color);
    const velocity = opts.velocity;

    for (let k = 0; k < count; k++) {
      let slot;
      if (sys.count < sys.capacity) {
        slot = sys.count++;
      } else {
        slot = sys.cursor; // over capacity: recycle oldest-ish
        sys.cursor = (sys.cursor + 1) % sys.capacity;
      }

      _randDir.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      sys.pos[slot].copy(position).addScaledVector(_randDir, opts.jitter ?? 0.06);

      if (velocity) sys.vel[slot].copy(velocity);
      else sys.vel[slot].set(0, 0, 0);
      _randDir.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      sys.vel[slot].addScaledVector(_randDir, spread * (0.5 + Math.random() * 0.5));
      if (cfg.up) sys.vel[slot].y += cfg.up * baseSpeed;
      else if (cfg.grav < 0) sys.vel[slot].y += baseSpeed * 0.15;

      sys.life[slot] = life * (0.8 + Math.random() * 0.4);
      sys.maxLife[slot] = sys.life[slot];
      sys.size0[slot] = Math.max(0.02, size * (0.7 + Math.random() * 0.6));
      sys.grow[slot] = cfg.grow;
      sys.drag[slot] = cfg.drag;
      sys.grav[slot] = opts.gravity ?? cfg.grav;
      sys.phase[slot] = Math.random() * Math.PI * 2;
      sys.alpha0[slot] = opts.alpha ?? cfg.alpha ?? 1;
      sys.flutter[slot] = cfg.system === 'square' ? 1 : 0;

      if (pal) {
        sys.col[slot].setHex(pal[(Math.random() * pal.length) | 0]);
      } else if (type === 'starTrail') {
        sys.col[slot].setHSL((this._time * 0.6 + k * 0.07) % 1, 1.0, 0.62);
      } else {
        sys.col[slot].setHex(color);
      }
    }
  }

  /** Advance all particles. Call once per frame from the race loop. */
  update(dt) {
    this._time += dt;
    for (const key in this._systems) {
      const sys = this._systems[key];
      const { geo } = sys;
      const positions = geo.attributes.position.array;
      const colors = geo.attributes.aColor.array;
      const sizes = geo.attributes.aSize.array;
      const alphas = geo.attributes.aAlpha.array;

      let i = 0;
      while (i < sys.count) {
        sys.life[i] -= dt;
        if (sys.life[i] <= 0) {
          // swap-remove: pull the last live particle into this slot
          const last = sys.count - 1;
          if (i !== last) {
            sys.pos[i].copy(sys.pos[last]);
            sys.vel[i].copy(sys.vel[last]);
            sys.col[i].copy(sys.col[last]);
            sys.life[i] = sys.life[last];
            sys.maxLife[i] = sys.maxLife[last];
            sys.size0[i] = sys.size0[last];
            sys.grow[i] = sys.grow[last];
            sys.drag[i] = sys.drag[last];
            sys.grav[i] = sys.grav[last];
            sys.phase[i] = sys.phase[last];
            sys.alpha0[i] = sys.alpha0[last];
            sys.flutter[i] = sys.flutter[last];
          }
          sys.count = last;
          continue; // re-process slot i (now holds the swapped particle)
        }

        const age = 1 - sys.life[i] / sys.maxLife[i];
        const v = sys.vel[i];
        sys.pos[i].addScaledVector(v, dt);
        v.y += sys.grav[i] * dt;
        v.multiplyScalar(Math.max(0, 1 - sys.drag[i] * dt));
        if (sys.flutter[i]) {
          sys.pos[i].x += Math.sin(this._time * 3.2 + sys.phase[i]) * 0.9 * dt;
        }

        const i3 = i * 3;
        positions[i3] = sys.pos[i].x;
        positions[i3 + 1] = sys.pos[i].y;
        positions[i3 + 2] = sys.pos[i].z;
        colors[i3] = sys.col[i].r;
        colors[i3 + 1] = sys.col[i].g;
        colors[i3 + 2] = sys.col[i].b;
        sizes[i] = Math.max(0.02, sys.size0[i] * (1 + sys.grow[i] * age));
        alphas[i] = sys.alpha0[i] * Math.pow(1 - age, 1.2);
        i++;
      }

      geo.setDrawRange(0, sys.count);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    }
  }

  /** Kill all particles (used on race restart). */
  clear() {
    for (const key in this._systems) {
      const sys = this._systems[key];
      sys.count = 0;
      sys.cursor = 0;
      sys.geo.setDrawRange(0, 0);
    }
  }

  dispose() {
    for (const key in this._systems) {
      const sys = this._systems[key];
      this.scene.remove(sys.points);
      sys.geo.dispose();
      sys.mat.dispose();
    }
  }
}
