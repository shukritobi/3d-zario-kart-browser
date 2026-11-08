/**
 * Super Kart 3D.js — power-up logic.
 * Owns the item type enum + weighted roll, the shared kart-introspection
 * helpers (heading / position / progress), the useItem() effect dispatcher,
 * and the projectile / hazard classes (ShellProjectile, Banana, StarEffect).
 *
 * All kart calls are duck-typed (kart.applyBoost, kart.hitShell, ...) so this
 * module never needs to import Kart — no circular dependency risk.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { getToonMaterial, getCartoonOutlineMaterial } from '../render/MaterialLibrary.js';

// ---------------------------------------------------------------------------
// Item types & weighted roll
// ---------------------------------------------------------------------------

export const PowerUpType = Object.freeze({
  MUSHROOM: 'mushroom',
  SHELL: 'shell',
  RED_SHELL: 'red_shell',
  BANANA: 'banana',
  STAR: 'star',
  LIGHTNING: 'lightning',
  BLUE_SHELL: 'blue_shell',
});

/** Roll weights — must sum to 1.0 (default / mid-pack). */
export const ITEM_WEIGHTS = Object.freeze([
  { type: PowerUpType.MUSHROOM, weight: 0.30 },
  { type: PowerUpType.SHELL, weight: 0.22 },
  { type: PowerUpType.RED_SHELL, weight: 0.18 },
  { type: PowerUpType.BANANA, weight: 0.15 },
  { type: PowerUpType.STAR, weight: 0.08 },
  { type: PowerUpType.LIGHTNING, weight: 0.07 },
]);

/**
 * Position-aware item roll (genre rubber-band): the leader gets defensive
 * items, the tail gets comeback items. `position01` = placement: 0 = 1st.
 */
const ROLL_LEADER = [
  { type: PowerUpType.MUSHROOM, weight: 0.14 },
  { type: PowerUpType.SHELL, weight: 0.30 },
  { type: PowerUpType.RED_SHELL, weight: 0.28 },
  { type: PowerUpType.BANANA, weight: 0.20 },
  { type: PowerUpType.STAR, weight: 0.05 },
  { type: PowerUpType.LIGHTNING, weight: 0.03 },
];
const ROLL_BACK = [
  { type: PowerUpType.MUSHROOM, weight: 0.24 },
  { type: PowerUpType.SHELL, weight: 0.13 },
  { type: PowerUpType.RED_SHELL, weight: 0.10 },
  { type: PowerUpType.BANANA, weight: 0.11 },
  { type: PowerUpType.STAR, weight: 0.20 },
  { type: PowerUpType.LIGHTNING, weight: 0.14 },
  { type: PowerUpType.BLUE_SHELL, weight: 0.08 }, // targeted anti-leader weapon
];

/**
 * Weighted random PowerUpType. Default (mid-pack): MUSHROOM 30%, SHELL 22%,
 * RED_SHELL 18%, BANANA 15%, STAR 8%, LIGHTNING 7%.
 * @param {number} [position01=0.5] 0 = leader, 1 = last.
 */
export function rollPowerUpType(position01 = 0.5) {
  const table = position01 < 0.33 ? ROLL_LEADER : position01 > 0.66 ? ROLL_BACK : ITEM_WEIGHTS;
  const r = Math.random();
  let acc = 0;
  for (const entry of table) {
    acc += entry.weight;
    if (r < acc) return entry.type;
  }
  return PowerUpType.MUSHROOM;
}

// ---------------------------------------------------------------------------
// Shared kart introspection helpers (duck-typed, allocation-light)
// ---------------------------------------------------------------------------

/** Horizontal heading of a kart as a THREE.Vector2 (x = sin, y = cos of yaw;
 *  yaw 0 faces +Z). Falls back to the group quaternion if state.heading is
 *  missing. */
export function headingVector(kart) {
  const st = kart.state || {};
  if (typeof st.heading === 'number') {
    return new THREE.Vector2(Math.sin(st.heading), Math.cos(st.heading));
  }
  if (st.heading && typeof st.heading.x === 'number' && typeof st.heading.z === 'number') {
    const h = st.heading;
    const len = Math.hypot(h.x, h.z) || 1;
    return new THREE.Vector2(h.x / len, h.z / len);
  }
  if (kart.group) {
    const q = kart.group.quaternion;
    const x = 2 * (q.x * q.z + q.w * q.y);
    const z = 1 - 2 * (q.x * q.x + q.y * q.y);
    return new THREE.Vector2(x, z);
  }
  return new THREE.Vector2(0, 1);
}

/** World position of a kart (Object3D.position or state.position). */
export function kartPosition(kart) {
  const g = kart.group;
  if (g && g.position) return g.position;
  const st = kart.state || {};
  return st.position || { x: 0, y: 0, z: 0 };
}

/** Race progress score: lap * 1000 + progress01 (bigger = further along). */
export function progressScore(kart) {
  const st = kart.state || {};
  const lap = st.lap ?? kart.lap ?? 0;
  const prog = st.progress01 ?? kart.progress01 ?? 0;
  return lap * 1000 + prog;
}

/** Signed horizontal angle from vector a to vector b (radians, [-PI, PI]).
 *  Heading convention: h(v) = atan2(v.x, v.z); result = h(a) - h(b). */
export function signedAngle(a, b) {
  const cross = a.x * b.y - a.y * b.x;
  const dot = a.x * b.x + a.y * b.y;
  return Math.atan2(cross, dot);
}

// ---------------------------------------------------------------------------
// useItem — apply the held item's effect
// ---------------------------------------------------------------------------

/**
 * Apply the effect of kart.heldItem and consume it.
 * ctx = { scene, karts, raceManager, audio, particles, targetKart }
 * - scene: THREE.Scene to spawn projectiles into
 * - karts: all race karts (for homing targets / lightning victims)
 * - raceManager: used to register live items (addActiveItem) + particles/audio
 * - targetKart: preferred homing target (AI passes the player)
 * All audio/particle calls are optional-safe.
 */
export function useItem(kart, ctx = {}) {
  const type = kart.heldItem;
  if (!type) return;
  kart.heldItem = null; // consume immediately
  // AUDIT r4 (rear throw): main.js sets kart._rearThrow before releasing a
  // hold that crossed the arm threshold. Consumed here so it never leaks
  // into a later use (ctx.rear is the programmatic path — AI never sets it).
  const rear = !!(ctx.rear || kart._rearThrow);
  kart._rearThrow = false;
  const audio = ctx.audio;

  switch (type) {
    case PowerUpType.MUSHROOM:
      kart.applyBoost?.(CONFIG.items.mushroomBoostMs);
      audio?.play?.('boost');
      // Big-use juice (user: item use felt weak — the mushroom should POP).
      ctx.particles?.emit?.('boost', kartPosition(kart), { count: 18, speed: 8.5, size: 0.32 });
      ctx.particles?.emit?.('sparkle', kartPosition(kart), { count: 16, speed: 5, size: 0.28, color: 0xffd166 });
      break;

    case PowerUpType.SHELL: {
      const proj = new ShellProjectile(kart, { homing: false, rear, ...ctx });
      ctx.raceManager?.addActiveItem?.(proj);
      audio?.play?.('shell');
      ctx.particles?.emit?.('sparkle', kartPosition(kart), { count: 8, speed: 4, size: 0.22 });
      break;
    }

    case PowerUpType.RED_SHELL: {
      // Rear-thrown red shells home on the nearest rival BEHIND the shooter
      // (MK8D: backward reds punish chasers).
      const target = pickRedShellTarget(kart, ctx, rear);
      const proj = new ShellProjectile(kart, { homing: !!target, targetKart: target, rear, ...ctx });
      ctx.raceManager?.addActiveItem?.(proj);
      audio?.play?.('redShell');
      ctx.particles?.emit?.('sparkle', kartPosition(kart), { count: 8, speed: 4, size: 0.22 });
      break;
    }

    case PowerUpType.BLUE_SHELL: {
      // Spiny-style: homes in on the RACE LEADER (position 1). Un-dodgeable
      // pressure valve for tail-enders (MK8 blue-shell pillar).
      let leader = null;
      for (const k of ctx.karts || []) {
        if (k.finished) continue;
        if (!leader || k.position < leader.position) leader = k;
      }
      const proj = new ShellProjectile(kart, { homing: true, targetKart: leader, blue: true, rear, ...ctx });
      ctx.raceManager?.addActiveItem?.(proj);
      audio?.play?.('redShell');
      ctx.particles?.emit?.('sparkle', kartPosition(kart), { count: 12, speed: 5, size: 0.26, color: 0x1f3fc8 });
      break;
    }

    case PowerUpType.BANANA: {
      const banana = new Banana(kart, { ...ctx, rear });
      ctx.raceManager?.addActiveItem?.(banana);
      audio?.play?.('banana'); // cartoon boing (was generic 'useItem' blip)
      break;
    }

    case PowerUpType.STAR: {
      kart.setStarred?.(true);
      kart.applyBoost?.(CONFIG.items.starDurationMs);
      audio?.play?.('star');
      const fx = new StarEffect(kart, CONFIG.items.starDurationMs, ctx.raceManager);
      ctx.raceManager?.addActiveItem?.(fx);
      break;
    }

    case PowerUpType.LIGHTNING: {
      const karts = ctx.karts || [];
      for (const other of karts) {
        if (other === kart || other.finished) continue;
        if (other.starred || other.invincible) continue; // audit F4: invincible riders are protected
        other.applyScale?.(CONFIG.items.lightningScale, CONFIG.items.lightningDurationMs);
        other._onLightning?.(); // player feedback hook: electric flash + thunder
        // MK8-style: lightning knocks the held item away + a small hop
        // (audit v5 #4 — victims kept their shield AND had no shock animation).
        // AUDIT r3: knocks BOTH held slots (dual-slot) + triple stacks.
        if (other.heldItem) other.heldItem = null;
        other._heldItemCount = 1;
        if (other.heldItem2) other.heldItem2 = null;
        other._heldItem2Count = 1;
        other.state.vY = Math.max(other.state.vY ?? 0, 2.4);
        // Electric burst on each victim (art-bible: drama on hit).
        ctx.particles?.emit?.('lightning', kartPosition(other), { count: 18, speed: 7.5, size: 0.34 });
      }
      audio?.play?.('lightning');
      break;
    }

    default:
      break;
  }
}

/** Choose the homing target for a red shell: preferred target if it is ahead
 *  of the owner, otherwise the nearest rival ahead of the owner. With
 *  `behind` (rear throw, audit r4) it picks the nearest rival BEHIND the
 *  owner instead — backward reds hunt chasers, MK8D-style. */
function pickRedShellTarget(owner, ctx, behind = false) {
  const karts = ctx.karts || [];
  const preferred = ctx.targetKart;
  if (!behind && preferred && preferred !== owner && !preferred.finished && isAheadOf(owner, preferred)) {
    return preferred;
  }
  const opos = kartPosition(owner);
  const dir = headingVector(owner);
  let best = null;
  let bestD = Infinity;
  for (const k of karts) {
    if (k === owner || k.finished) continue;
    const p = kartPosition(k);
    const dx = p.x - opos.x;
    const dz = p.z - opos.z;
    const along = dx * dir.x + dz * dir.y; // positive = ahead of owner
    if (behind ? along >= 0 : along <= 0) continue;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

function isAheadOf(a, b) {
  return progressScore(b) - progressScore(a) > 0.001;
}

// ---------------------------------------------------------------------------
// ShellProjectile
// ---------------------------------------------------------------------------

// AUDIT r7 (shell motion trail): pooled ribbon length + per-quad fade.
const SHELL_TRAIL_LENGTH = 10;
const SHELL_TRAIL_FADE = 0.72;

/** A shell: green = straight, red = homing. Hits any kart (except the owner
 *  for the first 0.5s) within 1.0m → kart.hitShell(). Lifetime 8s, culled
 *  when it flies off the road. `rear` shells (hold-to-throw-back, audit r4)
 *  spawn at the kart tail and travel against its heading. */
export class ShellProjectile {
  constructor(ownerKart, opts = {}) {
    this.owner = ownerKart;
    this.homing = !!opts.homing;
    this.target = opts.targetKart || null;
    this.scene = opts.scene || null;
    this.raceManager = opts.raceManager || null;
    this.audio = opts.audio || this.raceManager?.audio || null;
    this.age = 0;
    this.life = 8; // seconds
    this.dead = false;
    this.speed = CONFIG.items.shellSpeed;
    this.rear = !!opts.rear;
    this.dir = headingVector(ownerKart);
    // Rear throws travel AGAINST the kart's heading (spawn lands at the tail
    // via the same offset math below — dir is already negated).
    if (this.rear) this.dir.multiplyScalar(-1);

    this.centerline = opts.centerline || this.raceManager?.centerline || null;
    this.spacing = opts.spacing || this.raceManager?.centerlineSpacing || 2.5;
    this._nearIdx = 0;
    this._offAccum = 0;

    const opos = kartPosition(ownerKart);
    const color = this.homing ? (opts.blue ? 0x1f3fc8 : 0xff3b3b) : 0x43d64b;
    this.blue = !!opts.blue;
    // AUDIT r4: blue shell ARC — the spiny flies HIGH with a ground shadow
    // warning before diving on the leader (MK8 drama, no more blue-painted
    // red shell). Resets on construction; the update() below drives it.
    this._arcT = 0;
    this._vY = 0;
    this._descended = false;
    this._shadow = null;
    this.mesh = buildShellMesh(color);
    // AUDIT (Feco, 2026-08-11): 'casco verde estático sem animação' — MK8
    // shells SPIN around their travel axis while flying. The mesh root holds
    // the yaw (rotation.y = heading), so body+spikes move into an inner
    // group that rolls on local +Z (the shell's forward axis).
    this._spin = new THREE.Group();
    while (this.mesh.children.length) this._spin.add(this.mesh.children[0]);
    this.mesh.add(this._spin);
    this.mesh.position.set(
      opos.x + this.dir.x * 1.5,
      opos.y + 0.35,
      opos.z + this.dir.y * 1.5
    );
    this.mesh.rotation.y = Math.atan2(this.dir.x, this.dir.y);
    this.mesh.castShadow = true;
    this.scene?.add(this.mesh);
    // AUDIT r7 (shell motion trail): pooled ribbon of small glowing quads
    // left behind the shell — MK8D shells streak. Skipped with no scene
    // (headless / unit-test harness).
    this._trail = null;
    if (this.scene) this._buildTrail(color);
  }

  update(dt, karts) {
    this.age += dt;
    if (this.age > this.life) {
      this.die();
      return;
    }
    // AUDIT r19 (Feco real-GPU 2026-08-14: 'crash ao usar powerup' —
    // ReferenceError: Cannot access 'n' before initialization): o fix r5
    // dizia 'hoisted here' mas o `m` ficou DEPOIS do throw-hop — o blue
    // shell seta _vY no ARC phase e no frame seguinte o throw-hop usa `m`
    // antes da declaração → TDZ. `m` agora é o PRIMEIRO statement.
    const m = this.mesh;
    // Spawn pop-in (ease-out scale, ~130ms).
    if (this._popT < 1) {
      this._popT = Math.min(1, this._popT + dt * 8);
      const e = 1 - (1 - this._popT) * (1 - this._popT);
      this.mesh.scale.setScalar(Math.max(0.001, e));
    }
    // Throw hop: toss up, gravity back down, settle at road level.
    if (this._vY) {
      m.position.y += this._vY * dt;
      this._vY -= 9.8 * dt;
      if (m.position.y <= 0.3) {
        m.position.y = 0.3;
        this._vY = 0;
      }
    }

    // Homing: steer toward the target kart at shellHomingTurnRate.
    if (this.homing && this.target && !this.target.finished) {
      const tp = kartPosition(this.target);
      const dx = tp.x - this.mesh.position.x;
      const dz = tp.z - this.mesh.position.z;
      const dl = Math.hypot(dx, dz) || 1;
      const desired = { x: dx / dl, y: dz / dl };
      const err = signedAngle(this.dir, desired); // h_dir - h_desired
      const maxTurn = CONFIG.items.shellHomingTurnRate * dt;
      const delta = THREE.MathUtils.clamp(-err, -maxTurn, maxTurn);
      this._rotateDir(delta);
    }

    // Blue shell ARC phase (audit r4): fly high toward the leader with a
    // ground shadow warning, then dive. Ground-homing only after descent.
    if (this.blue && !this._descended) {
      this._arcT += dt;
      if (!this._shadow) {
        this._shadow = new THREE.Mesh(
          new THREE.CircleGeometry(0.95, 20),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })
        );
        this._shadow.rotation.x = -Math.PI / 2;
        this._shadow.renderOrder = 5;
        this.scene?.add(this._shadow);
      }
      // AUDIT r6 (stale target): this.target was locked at throw time — an
      // overtaken/finished leader kept drawing the dive (or the shell flew
      // straight and died). MK8D spiny re-targets the CURRENT position-1
      // every frame, so re-resolve from the live standings here and re-lock
      // this.target so the descent + post-dive homing follow the new leader.
      const leader = this._resolveBlueLeader(karts);
      if (leader) {
        this.target = leader;
        const tp = kartPosition(leader);
        const dx = tp.x - m.position.x;
        const dz = tp.z - m.position.z;
        const dl = Math.hypot(dx, dz) || 1;
        const err = signedAngle(this.dir, { x: dx / dl, y: dz / dl });
        this._rotateDir(THREE.MathUtils.clamp(-err, -1.6 * dt, 1.6 * dt));
      }
      m.position.x += this.dir.x * this.speed * 1.7 * dt;
      m.position.z += this.dir.y * this.speed * 1.7 * dt;
      if (this._arcT < 0.12) this._vY = CONFIG.items.blueShellLift; // launch pop
      this._vY -= CONFIG.items.blueShellGravity * dt;
      m.position.y += this._vY * dt;
      if (this._shadow) this._shadow.position.set(m.position.x, 0.05, m.position.z);
      this._emitTrail();
      // Descend when falling back near the ground — switch to the normal
      // homing dive (the shadow warning has done its job).
      if (m.position.y <= 3.4 && this._arcT > 0.9) {
        this._descended = true;
        if (this._shadow) { this.scene?.remove(this._shadow); this._shadow = null; }
        m.position.y = 1.2;
      }
      return;
    }

    // Advance along current heading (m hoisted above the homing block).
    m.position.x += this.dir.x * this.speed * dt;
    m.position.z += this.dir.y * this.speed * dt;
    m.rotation.y = Math.atan2(this.dir.x, this.dir.y);
    if (this._spin) this._spin.rotation.z += dt * 18; // ~3 rev/s travel-axis spin
    this._emitTrail();

    // Green shell follows the racing line (MK8 behavior): steer toward the
    // nearest centerline tangent so it hugs the track instead of flying off
    // in a straight line and dying in the off-track culling — the classic
    // "shell does nothing" bug. Rear shells fly straight back instead.
    if (!this.homing && !this.rear && this.centerline && this.centerline.length) {
      const cl = this.centerline;
      const n = cl.length;
      let best = this._nearIdx;
      let bestD = Infinity;
      for (let i = this._nearIdx - 6; i <= this._nearIdx + 6; i++) {
        const j = ((i % n) + n) % n;
        const q = cl[j];
        const ddx = q.x - m.position.x;
        const ddz = q.z - m.position.z;
        const d = ddx * ddx + ddz * ddz;
        if (d < bestD) { bestD = d; best = j; }
      }
      this._nearIdx = best;
      const p0 = cl[best];
      const p1 = cl[(best + 1) % n];
      const tdx = p1.x - p0.x;
      const tdz = p1.z - p0.z;
      const tl = Math.hypot(tdx, tdz) || 1;
      const desired = { x: tdx / tl, y: tdz / tl };
      const err = signedAngle(this.dir, desired);
      const maxTurn = 2.4 * dt; // gentle — hugs wide corners without snaking
      const delta = THREE.MathUtils.clamp(-err, -maxTurn, maxTurn);
      this._rotateDir(delta);
    }

    // Collision with karts (radius 2.0 — a shell that passes near a kart
    // counts; 1.0 required near-perfect aim and felt like it "did nothing").
    // AUDIT r7: a blue shell only explodes on the CURRENT leader — a
    // mid-pack kart crossing the dive path used to eat the comeback weapon.
    const list = karts || [];
    for (const k of list) {
      if (k === this.owner && this.age < 0.5) continue; // spawn grace
      if (k.finished) continue;
      if (this.blue && this._descended && k !== this.target) continue; // leader only
      if (this.blue && !this._descended) continue; // arc phase never collides
      const p = kartPosition(k);
      const dx = p.x - m.position.x;
      const dz = p.z - m.position.z;
      if (dx * dx + dz * dz < 4.0) {
        // AUDIT r8 (MK8D blue-shell dodge counterplay): the spiny's dive is
        // dodgeable. A leader who is invincible (star / item-box pickup /
        // trick-landing i-frames granted in main.js) or mid-trick (airborne
        // with an armed trick about to land) shakes it off — the shell
        // explodes harmlessly and the leader keeps a fresh 900ms window.
        if (this.blue && this._descended && k === this.target && this._blueDodged(k)) {
          k.setInvincible?.(true, 900);
          this._explodeHarmless(p);
          return;
        }
        this._hit(k, p);
        return;
      }
    }

    // Cull when it leaves the road (throttled check).
    if (this.centerline && this.centerline.length) {
      this._offAccum += dt;
      if (this._offAccum >= 0.15) {
        this._offAccum = 0;
        if (this._isOffTrack()) this.die();
      }
    }
  }

  /** AUDIT r6: current race leader for the blue-shell dive — re-resolved
   *  every frame from the live standings (MK8D spiny re-targets position 1),
   *  never the stale throw-time this.target. Skips finished / invincible
   *  karts; falls back to a best-progress scan when the manager is absent. */
  _resolveBlueLeader(karts) {
    const rm = this.raceManager;
    if (rm && typeof rm.getStandings === 'function') {
      const rows = rm.getStandings();
      if (Array.isArray(rows) && rows.length) {
        // Standings are sorted by race progress; a kart that finished keeps
        // its row near the top, so position 1 may be stale — accept the top
        // kart still racing instead of flying at a finished leader.
        for (const r of rows) {
          const k = r && r.kart;
          if (!k || k.finished || k.invincible) continue;
          if (r.position === 1) return k;
        }
        for (const r of rows) {
          const k = r && r.kart;
          if (k && !k.finished && !k.invincible) return k;
        }
        return null; // everyone finished / invincible — shell flies straight
      }
    }
    // No standings — best-progress kart still racing (the old fallback just
    // took the first list entry, which is meaningless mid-race).
    let best = null;
    let bestScore = -Infinity;
    for (const k of karts || []) {
      if (!k || k.finished || k.invincible) continue;
      const s = progressScore(k);
      if (s > bestScore) { bestScore = s; best = k; }
    }
    return best;
  }

  /** AUDIT r7: build the pooled trail ribbon — one shared geometry, one
   *  material per quad so each quad fades independently. */
  _buildTrail(shellColor) {
    const geo = new THREE.CircleGeometry(0.26, 8);
    const pool = [];
    for (let i = 0; i < SHELL_TRAIL_LENGTH; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: shellColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const quad = new THREE.Mesh(geo, mat);
      quad.rotation.x = -Math.PI / 2; // flat on the road, like a light streak
      quad.visible = false;
      this.scene.add(quad);
      pool.push(quad);
    }
    this._trail = { geo, pool };
  }

  /** AUDIT r7: shift the ribbon one slot and plant the head at the shell.
   *  Each quad inherits its neighbour's position AND a faded opacity, so the
   *  trail stretches out behind the shell and dies away (no per-frame
   *  allocation). */
  _emitTrail() {
    // AUDIT PERF-R40 (2026-08-14, auditoria CPU #10): shift a cada 2 frames —
    // o trail se move a ~18m/s, 30Hz é contínuo; corta ~40 cópias/frame por shell.
    this._trailTick = (this._trailTick || 0) + 1;
    if (this._trailTick % 2 !== 0) return;
    const t = this._trail;
    if (!t) return;
    const pool = t.pool;
    const m = this.mesh.position;
    for (let i = pool.length - 1; i > 0; i--) {
      pool[i].position.copy(pool[i - 1].position);
      const o = pool[i - 1].material.opacity * SHELL_TRAIL_FADE;
      pool[i].material.opacity = o;
      pool[i].visible = o > 0.02;
    }
    pool[0].position.set(m.x, 0.06, m.z);
    pool[0].material.opacity = 0.75;
    pool[0].visible = true;
  }

  _rotateDir(delta) {
    const c = Math.cos(delta);
    const s = Math.sin(delta);
    const x = this.dir.x * c + this.dir.y * s;
    const y = -this.dir.x * s + this.dir.y * c;
    this.dir.set(x, y);
  }

  _hit(victim, pos) {
    this.raceManager?.particles?.emit?.('explosion', new THREE.Vector3(pos.x, pos.y + 0.6, pos.z));
    victim?.hitShell?.({ blue: !!this.blue }); // blue shells bypass item-hold (audit v4)
    // AUDIT r9: the spiny's explosion also knocks karts NEAR the leader
    // (MK8D splash) — small spin to anyone within 3.5m of the blast.
    if (this.blue && this.raceManager && this.raceManager.karts) {
      for (const k of this.raceManager.karts) {
        if (k === victim || k.finished || k.invincible || k.starred) continue;
        const kp = k.state?.position;
        if (!kp) continue;
        const dx = kp.x - pos.x;
        const dz = kp.z - pos.z;
        if (dx * dx + dz * dz < 12.25) { // 3.5m radius
          if (typeof k._spinMs === 'number') {
            k._spinMs = Math.max(k._spinMs || 0, 700);
            k._spinDir = Math.random() < 0.5 ? -1 : 1;
          } else {
            k.state.spinOut = true;
          }
        }
      }
    }
    this.audio?.play?.('crash');
    this.die();
  }

  /** AUDIT r8: MK8D blue-shell dodge check — the leader escapes the dive when
   *  invincible (star / post-pickup / post-trick i-frames wired in main.js),
   *  mid-trick (airborne with an armed trick about to land), or fresh off a
   *  trick/item-box pickup within the ~0.9s dodge window (timestamps are a
   *  safety net in case setInvincible was cleared early by another effect). */
  _blueDodged(k) {
    if (k.invincible) return true;
    if (k._trickArmed) return true;
    const now = performance.now();
    if (k._lastTrickAt && now - k._lastTrickAt < 900) return true;
    if (k._lastBoxAt && now - k._lastBoxAt < 900) return true;
    return false;
  }

  /** AUDIT r8: spiny dodge resolution — same drama as a hit (explosion +
   *  crash + consume the shell) but with NO kart damage. */
  _explodeHarmless(pos) {
    this.raceManager?.particles?.emit?.('explosion', new THREE.Vector3(pos.x, pos.y + 0.6, pos.z));
    this.audio?.play?.('crash');
    this.die();
  }

  _isOffTrack() {
    const cl = this.centerline;
    const n = cl.length;
    const m = this.mesh.position;
    let best = this._nearIdx;
    let bestD = Infinity;
    const r = 8;
    for (let i = this._nearIdx - r; i <= this._nearIdx + r; i++) {
      const j = ((i % n) + n) % n;
      const p = cl[j];
      const dx = p.x - m.x;
      const dz = p.z - m.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    this._nearIdx = best;
    const limit = CONFIG.track.roadWidth * 1.8;
    return bestD > limit * limit;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.scene?.remove(this.mesh);
    // AUDIT r4: drop the arc shadow if it died mid-flight (e.g. timeout).
    if (this._shadow) { this.scene?.remove(this._shadow); this._shadow = null; }
    // AUDIT r7: take the pooled trail ribbon out of the scene too.
    const t = this._trail;
    if (t) {
      for (const q of t.pool) this.scene?.remove(q);
      this._trail = null;
    }
  }

  dispose() {
    disposeObject(this.mesh);
    const t = this._trail;
    if (t) {
      t.geo.dispose?.();
      for (const q of t.pool) q.material?.dispose?.();
    }
  }
}

// ---------------------------------------------------------------------------
// Banana
// ---------------------------------------------------------------------------

/** A banana dropped behind the owner. Collision → kart.hitBanana() (spin-out).
 *  Fades out after 25s so stale hazards don't linger forever. `rear` drops
 *  (hold-to-throw-back, audit r4) land further back so they read as thrown. */
export class Banana {
  constructor(ownerKart, opts = {}) {
    this.owner = ownerKart;
    this.scene = opts.scene || null;
    this.raceManager = opts.raceManager || null;
    this.audio = opts.audio || this.raceManager?.audio || null;
    this.age = 0;
    this.life = 25;
    this.dead = false;

    this.centerline = opts.centerline || this.raceManager?.centerline || null;
    this.spacing = opts.spacing || this.raceManager?.centerlineSpacing || 2.5;
    this._nearIdx = 0;
    this._offAccum = 0;

    const opos = kartPosition(ownerKart);
    const drop = opts.rear ? -2.2 : -1.5; // rear drops land further behind
    const behind = headingVector(ownerKart).multiplyScalar(drop);
    this.mesh = buildBananaMesh();
    this.mesh.position.set(opos.x + behind.x, opos.y + 0.3, opos.z + behind.y);
    // AUDIT: MK8 banana deitada ATRAVESSA a pista (pontas de lado a lado) —
    // orienta o crescente perpendicular ao tráfego + jitter fino de variedade.
    const fwd = headingVector(ownerKart); // (sin h, cos h)
    this.mesh.rotation.y = Math.atan2(-fwd.x, fwd.y) + (Math.random() - 0.5) * 0.3;
    this.mesh.castShadow = true;
    // Sombra de contato no chão (mesmo truque da sombra do blue shell) —
    // ancora o hazard na pista e vende a altura do arremesso.
    this._shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })
    );
    this._shadow.rotation.x = -Math.PI / 2;
    this._shadow.position.set(this.mesh.position.x, 0.06, this.mesh.position.z);
    this.scene?.add(this._shadow);
    // AUDIT (Feco): 'não dá pra ver quando arremessa' — the banana appeared
    // at full size with zero feedback. Pop-in: scale 0 -> 1 in ~130ms with an
    // ease-out so the drop reads as a thrown object, not a materialization.
    this._popT = 0;
    this.mesh.scale.setScalar(0.001);
    // AUDIT (power-up audit): 'não dá pra ver quando arremessa' — a small
    // throw HOP (vY 2.2, gravity 9.8) makes the drop read as a tossed banana
    // landing on the road instead of materializing.
    this._vY = 2.2;
    this.scene?.add(this.mesh);
  }

  update(dt, karts) {
    this.age += dt;
    if (this.age > this.life) {
      this.die();
      return;
    }
    // AUDIT (Jarvis QA loop 2026-08-11, CRITICAL FIX): `m` was declared at
    // the BOTTOM of update() but used by the throw-hop block above — a thrown
    // banana (this._vY truthy) hit the TDZ and threw ReferenceError every
    // frame, freezing the race seconds after the start (the same bug class as
    // the Shell r5 fix, but this copy was never hoisted). Hoisted here.
    const m = this.mesh;
    // Spawn pop-in (ease-out scale, ~130ms).
    if (this._popT < 1) {
      this._popT = Math.min(1, this._popT + dt * 8);
      const e = 1 - (1 - this._popT) * (1 - this._popT);
      this.mesh.scale.setScalar(Math.max(0.001, e));
    }
    // Throw hop: toss up, gravity back down, settle at road level.
    if (this._vY) {
      m.position.y += this._vY * dt;
      this._vY -= 9.8 * dt;
      if (m.position.y <= 0.3) {
        m.position.y = 0.3;
        this._vY = 0;
      }
    }
    // Shadow follows the banana (anchors it to the road through the hop).
    if (this._shadow) this._shadow.position.set(m.position.x, 0.06, m.position.z);
    // Blink in the final seconds as a fair-play warning.
    if (this.age > this.life - 2.5) {
      this.mesh.visible = Math.floor(this.age * 6) % 2 === 0;
    }

    const radius = CONFIG.items.bananaRadius;
    const rr = radius * radius;
    const list = karts || [];
    for (const k of list) {
      if (k === this.owner && this.age < 0.5) continue; // spawn grace
      if (k.finished) continue;
      const p = kartPosition(k);
      const dx = p.x - m.position.x;
      const dz = p.z - m.position.z;
      if (dx * dx + dz * dz < rr) {
        k.hitBanana?.();
        this.audio?.play?.('crash');
        this.die();
        return;
      }
    }

    // Cull bananas that end up far off the road (throttled).
    if (this.centerline && this.centerline.length) {
      this._offAccum += dt;
      if (this._offAccum >= 0.5) {
        this._offAccum = 0;
        if (this._isOffTrack()) this.die();
      }
    }
  }

  _isOffTrack() {
    const cl = this.centerline;
    const n = cl.length;
    const m = this.mesh.position;
    let best = this._nearIdx;
    let bestD = Infinity;
    const r = 8;
    for (let i = this._nearIdx - r; i <= this._nearIdx + r; i++) {
      const j = ((i % n) + n) % n;
      const p = cl[j];
      const dx = p.x - m.x;
      const dz = p.z - m.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    this._nearIdx = best;
    const limit = CONFIG.track.roadWidth * 2.0;
    return bestD > limit * limit;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.scene?.remove(this.mesh);
    if (this._shadow) { this.scene?.remove(this._shadow); this._shadow = null; }
  }

  dispose() {
    disposeObject(this.mesh);
  }
}

// ---------------------------------------------------------------------------
// StarEffect — rainbow trail + timed expiry
// ---------------------------------------------------------------------------

/** Drives the star power-up lifecycle: a VISIBLE 3D star + pulsing aura
 *  above the kart (MK8 star read), rainbow trail particles while active,
 *  and flips kart.setStarred(false) when the duration elapses.
 *  AUDIT (visual auditor 2026-08-12): the old effect was particle-only —
 *  nothing readable in a still frame. */
export class StarEffect {
  constructor(ownerKart, durationMs, raceManager) {
    this.owner = ownerKart;
    this.remaining = durationMs;
    this.raceManager = raceManager || null;
    this.dead = false;
    this._trailAccum = 0;
    this._spinAccum = 0;
    this._buildMesh();
  }

  _buildMesh() {
    const owner = this.owner;
    if (!owner || !owner.group) { this.mesh = null; return; }
    const g = new THREE.Group();
    // Golden spinning star (MK8 star read) — 5-point star via extrusion of
    // a 2D star path, standing upright above the kart.
    const starShape = new THREE.Shape();
    const R = 0.30, r = 0.13;
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? R : r;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (i === 0) starShape.moveTo(x, y);
      else starShape.lineTo(x, y);
    }
    starShape.closePath();
    const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3 });
    starGeo.center();
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffe14d, side: THREE.DoubleSide });
    starMat.toneMapped = false; // keep the gold hot
    const star = new THREE.Mesh(starGeo, starMat);
    star.position.y = 1.85;
    star.rotation.x = -0.15; // slight tilt toward the chase cam
    star.rotation.y = 0.4;   // 3/4 pose so the extrusion depth reads
    star.castShadow = false;
    g.add(star);
    // Hot halo disc behind the star (additive) — separates it from the
    // night sky / neon buildings (critic: 'compete with yellow windows').
    const haloTex = (() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const gc = c.getContext('2d');
      const grad = gc.createRadialGradient(32, 32, 3, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,225,120,0.9)');
      grad.addColorStop(0.45, 'rgba(255,200,80,0.35)');
      grad.addColorStop(1, 'rgba(255,190,60,0)');
      gc.fillStyle = grad;
      gc.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const haloMat = new THREE.MeshBasicMaterial({
      map: haloTex, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    haloMat.toneMapped = false;
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), haloMat);
    halo.position.y = 1.85;
    halo.rotation.x = -0.5;
    halo.castShadow = false;
    g.add(halo);
    this._halo = halo;
    // Pulsing golden aura (additive halo ring) around the kart body.
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    auraMat.toneMapped = false;
    const aura = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 18), auraMat);
    aura.scale.set(1.35, 0.95, 1.35);
    aura.castShadow = false;
    g.add(aura);
    owner.group.add(g);
    this.mesh = g;
    this._star = star;
    this._aura = aura;
  }

  update(dt) {
    this.remaining -= dt * 1000;
    if (this.remaining <= 0) {
      this.owner.setStarred?.(false);
      this.dead = true;
      return;
    }
    if (this._star) {
      this._spinAccum += dt;
      this._star.rotation.y += dt * 3.0; // slow spin
      this._star.position.y = 1.75 + Math.sin(this._spinAccum * 2.2) * 0.06; // float
      this._star.rotation.z = Math.sin(this._spinAccum * 2.2) * 0.12;
    }
    if (this._aura) {
      const s = 1 + Math.sin(this._spinAccum * 3.0) * 0.10;
      this._aura.scale.set(1.35 * s, 0.95 * s, 1.35 * s);
      this._aura.material.opacity = 0.42 + Math.sin(this._spinAccum * 3.4) * 0.14;
    }
    if (this._halo) {
      this._halo.material.opacity = 0.7 + Math.sin(this._spinAccum * 4.0) * 0.2;
    }
    this._trailAccum -= dt;
    if (this._trailAccum <= 0) {
      this._trailAccum = 0.045;
      const p = kartPosition(this.owner);
      this.raceManager?.particles?.emit?.('starTrail', new THREE.Vector3(p.x, p.y + 0.7, p.z));
    }
  }

  dispose() {
    if (this.mesh && this.owner && this.owner.group) {
      this.owner.group.remove(this.mesh);
    }
    this.mesh = null;
  }
}

// ---------------------------------------------------------------------------
// Visual builders
// ---------------------------------------------------------------------------

function buildShellMesh(color) {
  const g = new THREE.Group();
  // AUDIT (power-up audit, 2026-08-11): the old mesh was a 10x8 sphere with
  // 6-sided cones — raw MeshToonMaterial, no outline; read as a draft. Now
  // higher segments, the shared PBR toon pipeline (smooth shading + sheen)
  // and a cartoon outline; spikes spread like MK8 shells (3 top, 2 rear).
  const bodyMat = getToonMaterial(color, { emissive: color, emissiveIntensity: 0.25 });
  // AUDIT GPU-real (2026-08-23): shell leria ~25% do kart — MK8 shell é ~60%
  // da largura. SphereGeometry 0.34→0.52 (pop-in usa mesh.scale, então a
  // escala vai na GEOMETRIA, não no group).
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.52, 24, 16), bodyMat);
  body.scale.set(1.05, 0.85, 1.55);
  const outlineMat = getCartoonOutlineMaterial(0x1b2a41, 0.05);
  const hull = new THREE.Mesh(body.geometry.clone(), outlineMat);
  hull.scale.setScalar(1.05);
  hull.castShadow = false;
  body.add(hull);
  g.add(body);

  const spikeMat = getToonMaterial(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.15 });
  const spikeGeo = new THREE.ConeGeometry(0.14, 0.40, 8);
  for (let i = 0; i < 3; i++) {
    const spike = new THREE.Mesh(spikeGeo, spikeMat);
    spike.position.set((i - 1) * 0.40, 0.46, 0);
    g.add(spike);
  }
  // Two smaller rear spikes on the shell's tail (MK8 silhouette).
  for (let i = 0; i < 2; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 8), spikeMat);
    spike.position.set((i - 0.5) * 0.31, 0.43, 0.95);
    g.add(spike);
  }
  return g;
}

function buildBananaMesh() {
  const g = new THREE.Group();
  // AUDIT R11 (visual critic, 6 iterations): extruded shapes kept producing
  // dark artifacts that dominated the silhouette. REVERT to the readable
  // torus crescent (R3: 6/10 'reconhecível como banana') and PAINT the brown
  // tips + body shading into a canvas texture mapped around the torus — the
  // 2D art is fully controllable, no geometry fighting the silhouette.
  const peelTex = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const gc = c.getContext('2d');
    // Banana body: warm yellow with a soft vertical shading band (reads as
    // volume even on a flat torus).
    const grad = gc.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#ffdf66');
    grad.addColorStop(0.5, '#ffc933');
    grad.addColorStop(1, '#f0a91f');
    gc.fillStyle = grad;
    gc.fillRect(0, 0, 256, 128);
    // Brown tips painted at the arc ENDS of the torus UV (u=0 and u=1).
    const tipGrad = gc.createLinearGradient(0, 0, 40, 0);
    tipGrad.addColorStop(0, '#6d4213');
    tipGrad.addColorStop(1, 'rgba(109,66,19,0)');
    gc.fillStyle = tipGrad;
    gc.fillRect(0, 0, 46, 128);
    const tipGrad2 = gc.createLinearGradient(216, 0, 256, 0);
    tipGrad2.addColorStop(0, 'rgba(109,66,19,0)');
    tipGrad2.addColorStop(1, '#6d4213');
    gc.fillStyle = tipGrad2;
    gc.fillRect(210, 0, 46, 128);
    // Subtle ridge lines along the length (banana flutes).
    gc.strokeStyle = 'rgba(190,120,20,0.35)';
    gc.lineWidth = 3;
    for (const yy of [30, 64, 98]) {
      gc.beginPath();
      gc.moveTo(10, yy);
      gc.lineTo(246, yy + (yy === 64 ? 0 : 6));
      gc.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const peelMat = new THREE.MeshBasicMaterial({ map: peelTex });
  peelMat.toneMapped = false;
  // Thick crescent torus (MK8 banana scale), arc 1.15π laid flat.
  // AUDIT GPU-real (2026-08-23): banana leria minúscula vs kart (~2m) —
  // MK8 banana ≈ 45-50% da largura do kart. Torus 0.42/0.16 → 0.62/0.24.
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.24, 12, 20, Math.PI * 1.15), peelMat);
  arc.rotation.x = Math.PI / 2;
  arc.castShadow = true;
  g.add(arc);
  // Dark cartoon outline (BackSide shell) for contrast on dark asphalt.
  const outline = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.24, 12, 20, Math.PI * 1.15),
    new THREE.MeshBasicMaterial({ color: 0x2a1c00, side: THREE.BackSide })
  );
  outline.scale.setScalar(1.07);
  outline.rotation.x = Math.PI / 2;
  g.add(outline);
  return g;
}

/** Dispose geometry + materials of an Object3D subtree. */
export function disposeObject(obj) {
  obj?.traverse?.((child) => {
    if (child.geometry) child.geometry.dispose?.();
    const mats = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
    for (const m of mats) {
      if (m && typeof m.dispose === 'function') m.dispose();
    }
  });
}
