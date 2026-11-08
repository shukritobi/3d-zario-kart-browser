/**
 * Super Kart 3D.js — race orchestration.
 * Owns the race loop: countdown, kart/AI/item-box/projectile updates,
 * standings, finish detection and item pickups. Karts are built by the
 * controller and passed in via init() — this module never constructs them.
 *
 * Kart API is duck-typed wherever possible; Kart is imported only for an
 * instanceof sanity check in init().
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Kart } from '../entities/Kart.js';
import { AIController } from '../entities/AIController.js';
import { createItemBoxes } from '../entities/ItemBox.js';
import { rollPowerUpType, useItem as applyItemEffect } from '../entities/PowerUp.js';

const COUNTDOWN_SECONDS = CONFIG.game.countdownMs[0] || 3;
const FINISH_SCORE_BASE = 1e9;

// ---- Kart-contact physics (audit r2) --------------------------------------
const CONTACT_R = 1.55;
const CONTACT_R2 = CONTACT_R * CONTACT_R;
const CONTACT_SNAP_MAX = 0.42;     // max positional correction/frame (no teleport)
const CONTACT_SPIN_LAT_MIN = 7.0;  // m/s lateral closing speed to trigger a spin-out
const CONTACT_SPIN_MS = 550;       // rammer spin duration (mild side-swipe)
const CONTACT_SPIN_MS_MAX = 950;   // rammer spin duration (severe T-bone)
const CONTACT_RAM_COOLDOWN = 1.1;  // s per kart between spin triggers
const CONTACT_SFX_COOLDOWN = 0.22; // s between crash SFX (pack collisions)
const NEARMISS_R = 3.2;            // graze band outside CONTACT_R (AAA VFX: near-miss telegraph)
const NEARMISS_R2 = NEARMISS_R * NEARMISS_R;
const NEARMISS_COOLDOWN = 0.6;     // s between near-miss sparks per pair

// ---------------------------------------------------------------------------
// Coin pickups (audit r3: "no coins") — small gold cylinders near the road
// edge. Each coin grants +1% top speed (cap +10%, CONFIG.items.coinSpeedCap)
// via kart.addCoin(); Kart exposes `cruiseSpeed` as base * (1 + coins*0.01),
// which KartPhysics targets every frame. Placement is deterministic (fixed
// jitter like createItemBoxes), single-collect per race, reset on restart.
// ---------------------------------------------------------------------------

class Coin {
  /** @param {object|null} [at] optional explicit world position — used by
   *  AUDIT r8 dropped coins so they land where the kart scattered them
   *  (instead of along the track's coin row). */
  constructor(track, t, side, jitter, at = null) {
    this.track = track;
    this.t = t;
    this.side = side;
    this.active = true;
    this.bobPhase = (t * 40 + side * 3) % (Math.PI * 2);
    this.base = at
      ? { x: at.x, y: at.y, z: at.z }
      : this._computeBase(track, t, side, jitter);
    this.mesh = this._buildMesh();
  }

  /** Center point on the road, offset laterally toward the EDGE (off the
   *  racing line, on the asphalt — MK8 coin rows hug the kerb). */
  _computeBase(track, t, side, jitter) {
    const path = track.path;
    const tt = Math.min(Math.max(t, 0.001), 0.999);
    const point = path.getPointAt(tt);
    const tangent = path.getTangentAt(tt);
    // perpendicular in the XZ plane (same math as ItemBox)
    const px = -tangent.z;
    const pz = tangent.x;
    const pl = Math.hypot(px, pz) || 1;
    const lateral = CONFIG.track.roadWidth * (0.36 + jitter * 0.08) * side;
    return {
      x: point.x + (px / pl) * lateral,
      y: point.y + 0.45,
      z: point.z + (pz / pl) * lateral,
    };
  }

  _buildMesh() {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.06, 18),
      // AUDIT R16b (critic Rewards 1/3 'coins sem vida/visibilidade'): emissive
      // 0.35→0.9 — a coin destaca da pista à distância da chase cam, sem ficar
      // apagada (MK8 coins são LUMINOSAS).
      new THREE.MeshToonMaterial({ color: 0xffd166, emissive: 0xffaa00, emissiveIntensity: 0.9 })
    );
    mesh.position.set(this.base.x, this.base.y, this.base.z);
    mesh.castShadow = true;
    // bright rim so the coin reads as a coin, not a pebble
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.17, 0.02, 8, 18),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4 })
    );
    rim.rotation.x = Math.PI / 2;
    mesh.add(rim);
    // AUDIT R16b: glow halo (sprite circular) — dá à coin um 'brilho de moeda'
    // legível à distância; additive + low alpha, sem toneMapped:false (lição
    // R14: additive+toneMapped:false+bloom estoura em branco no GPU real).
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = 64; haloCanvas.height = 64;
    const hg = haloCanvas.getContext('2d');
    const hgrad = hg.createRadialGradient(32, 32, 8, 32, 32, 32);
    hgrad.addColorStop(0, 'rgba(255,214,90,0.55)');
    hgrad.addColorStop(0.6, 'rgba(255,180,40,0.18)');
    hgrad.addColorStop(1, 'rgba(255,180,40,0)');
    hg.fillStyle = hgrad;
    hg.fillRect(0, 0, 64, 64);
    const haloTex = new THREE.CanvasTexture(haloCanvas);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.set(0.9, 0.9, 1);
    mesh.add(halo);
    return mesh;
  }

  reset() {
    this.active = true;
    if (this.mesh) this.mesh.visible = true;
  }

  update(dt, karts, raceManager) {
    if (!this.active) return;
    this.bobPhase += dt * 2.6;
    if (this.mesh) {
      this.mesh.position.y = this.base.y + Math.sin(this.bobPhase) * 0.12;
      this.mesh.rotation.y += dt * 3.2; // spinning coin
    }
    const list = karts || [];
    const r = CONFIG.items.coinPickupRadius;
    const rr = r * r;
    for (const kart of list) {
      if (!kart || kart.finished) continue;
      const p = kart.group ? kart.group.position : kart.state?.position;
      if (!p) continue;
      const dx = p.x - this.base.x;
      const dz = p.z - this.base.z;
      if (dx * dx + dz * dz < rr) {
        if (this._collect(kart, raceManager)) break;
      }
    }
  }

  _collect(kart, raceManager) {
    if (!kart.addCoin || !kart.addCoin()) return false; // capped — coin stays for rivals
    this.active = false;
    if (this.mesh) this.mesh.visible = false;
    // Player gets the sparkle + blip; AI stays quiet (matches item pickups).
    if (raceManager && kart === raceManager.player) {
      raceManager.audio?.play?.('pickup', { volume: 0.55 }); // moeda = blip curto (era a fanfarra)
      raceManager.particles?.emit?.('sparkle', new THREE.Vector3(this.base.x, this.base.y + 0.2, this.base.z), {
        count: 10, speed: 3.2, size: 0.18, color: 0xffd166,
      });
    }
    return true;
  }

  dispose() {
    this.mesh?.geometry?.dispose?.();
    this.mesh?.material?.dispose?.();
  }
}

/** Deterministic coin row: fixed jitter, alternating sides, near the kerb. */
export function createCoins(track, count = 10) {
  const coins = [];
  const n = Math.max(4, count);
  const jitter = [0.0, 0.5, -0.4, 0.3, -0.5, 0.4, -0.3, 0.5, -0.2, 0.2, -0.6, 0.6];
  for (let i = 0; i < n; i++) {
    const t = 0.06 + (i / n) * 0.88 + ((i % 5) - 2) * 0.012;
    const side = i % 2 === 0 ? 1 : -1;
    coins.push(new Coin(track, t, side, jitter[i % jitter.length]));
  }
  return coins;
}

export class RaceManager {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    this.karts = [];
    this.aiControllers = [];
    this.itemBoxes = [];
    this.coins = []; // gold coin pickups (audit r3)
    this.droppedCoins = []; // AUDIT r8: coins scattered by kart hits (recollectable)
    this.activeItems = []; // ShellProjectile / Banana / StarEffect

    this.player = null;
    this.track = null;
    this.audio = null;
    this.particles = null;

    this.elapsed = 0;
    this.phase = 'idle'; // idle | countdown | race | finished
    this.countdown = 0;
    this.raceOver = false;
    this.finishOrder = [];
    this.playerFinished = false;
    this.onRaceOver = null;
    this._raceOverNotified = false;

    // Cached sampled centerline (for AI look-ahead + off-track culling).
    this.centerline = null;
    this.centerlineSpacing = 2.5;
  }

  /**
   * init({ track, playerKart, aiKarts, itemBoxes, audio })
   * `particles` is accepted as an extra optional field (kart.update ctx).
   * Item boxes are auto-created from the track when not supplied.
   */
  init({ track, playerKart, aiKarts, itemBoxes, audio, particles }) {
    this.track = track || null;
    this.player = playerKart || null;
    this.karts = playerKart ? [playerKart, ...(aiKarts || [])] : [...(aiKarts || [])];
    this.audio = audio || null;
    this.particles = particles || null;

    if (playerKart && Kart && !(playerKart instanceof Kart)) {
      console.warn('[RaceManager] playerKart is not a Kart instance — continuing with duck-typed API.');
    }

    // AUDIT r8: coin-drop-on-hit — every kart reports scattered coins through
    // this hook; RaceManager respawns them near the kart (MK8D drops up to 3
    // per shell/banana hit). Re-wired on every init (idempotent).
    for (const k of this.karts) {
      k._onCoinDrop = (dropped, kart) => this._spawnDroppedCoins(kart, dropped);
    }

    // AUDIT r3: leak fix — Menu→StartRace re-added boxes without removing
    // the previous ones (scene grew unbounded). Drop the old set first.
    if (this.itemBoxes && this.scene) {
      for (const box of this.itemBoxes) {
        if (box.mesh) this.scene.remove(box.mesh);
        if (box.beam) this.scene.remove(box.beam);
        if (box.arrows) this.scene.remove(box.arrows);
        box.mesh?.geometry?.dispose?.();
      }
    }

    this.itemBoxes =
      itemBoxes && itemBoxes.length ? itemBoxes : track ? createItemBoxes(track) : [];

    // Add item-box meshes (+ golden beams) to the scene — they were never
    // added before, so pickups were invisible on the track.
    if (this.scene) {
      for (const box of this.itemBoxes) {
        if (box.mesh) this.scene.add(box.mesh);
        if (box.beam) this.scene.add(box.beam);
        if (box.arrows) this.scene.add(box.arrows);
      }
    }

    // AUDIT r3: coin pickups — drop the previous set (leak-safe), then place
    // a deterministic row near the road edge from the track path.
    if (this.coins && this.scene) {
      for (const c of this.coins) {
        if (c.mesh) this.scene.remove(c.mesh);
        c.dispose?.();
      }
    }
    this.coins = track ? createCoins(track, CONFIG.items.coinCount) : [];
    if (this.scene) {
      for (const c of this.coins) if (c.mesh) this.scene.add(c.mesh);
    }

    // AUDIT r8: drop coins from a previous race/visit (leak-safe).
    for (const c of this.droppedCoins) {
      if (c.mesh) this.scene?.remove(c.mesh);
      c.dispose?.();
    }
    this.droppedCoins = [];

    // AUDIT r11 (#2, code audit): the navigation cache MUST exist BEFORE the
    // AIController constructors run — _initPath() reads rm.centerline at
    // construction and never re-runs. With the old order (controllers first)
    // every rival fell back to the coarse 90-point track.waypoints and the
    // 240-point arc-length cache (progress-anchored steering, seam-slice)
    // was dead code in the real game; only the harness exercised it.
    if (track && track.path && typeof track.path.getSpacedPoints === 'function') {
      // AUDIT r11: getSpacedPoints(240) returns 241 points on a CLOSED curve
      // — the last is an exact duplicate of the first (seam). Slice it off:
      // the AI's progress01→index mapping (round(prog * n)) assumes exactly
      // n arc-length-uniform samples; a duplicate at n-1 sat right on the
      // finish seam where every kart crosses it.
      this.centerline = track.path.getSpacedPoints(240).slice(0, 240);
      const len = track.length || 500;
      this.centerlineSpacing = Math.max(1.5, len / 240);
    } else if (track && track.waypoints && track.waypoints.length) {
      this.centerline = track.waypoints;
      const len = track.length || 500;
      this.centerlineSpacing = Math.max(1.5, len / track.waypoints.length);
    }

    this.aiControllers = (aiKarts || []).map((k, i) => new AIController(k, track, this, i));

    // AUDIT r8: rank arrows only exist during a live race — hidden in menu.
    this._setRankArrowsVisible(false);

    return this;
  }

  /** Begin a fresh race (countdown first). */
  start() {
    this.elapsed = 0;
    // The visual 3-2-1-GO countdown is driven by main.js (GameState COUNTDOWN).
    // Going straight to 'race' avoids a SECOND hidden countdown here — which
    // made karts sit still for another ~3s game-time after GO.
    this.phase = 'race';
    this.raceOver = false;
    this.finishOrder = [];
    this.playerFinished = false;
    this._raceOverNotified = false;
    // AUDIT r8: MK8D rank arrows float above every kart the moment GO hits.
    this._setRankArrowsVisible(true);
    // AUDIT r4: ~2s spawn protection at GO — the grid pack used to shell-train
    // the player before the first corner.
    for (const k of this.karts) {
      if (k && typeof k.setInvincible === 'function') k.setInvincible(true, 2000);
      // AUDIT r6: AI rocket start — MK8D CPUs execute a start boost too; the
      // player's 900ms start was a one-sided free advantage.
      if (k && k !== this.player && typeof k.applyBoost === 'function') {
        k.applyBoost(600 + Math.random() * 300); // 600-900ms, slight variance
      }
    }
  }

  /** Reset karts / hazards / boxes and start over. */
  restart() {
    for (const it of this.activeItems) {
      if (it.mesh) this.scene?.remove(it.mesh);
      it.dispose?.();
    }
    this.activeItems = [];
    for (const box of this.itemBoxes) box.reset?.();
    for (const coin of this.coins) coin.reset?.();
    // AUDIT r8: scattered coins don't survive a restart (per-race state).
    for (const c of this.droppedCoins) {
      if (c.mesh) this.scene?.remove(c.mesh);
      c.dispose?.();
    }
    this.droppedCoins = [];
    // AUDIT FIX (gameplay): the finish handler pushes a cruise controller for
    // the player kart; rebuild would re-randomize AI lanes (kart.position is
    // rank, all reset to numKarts), so instead drop the player's extra
    // controller (unless the demo autopilot owns the player) and reset the
    // rest in place.
    this.aiControllers = this.aiControllers.filter((c) => c.kart !== this.player || this._playerAI);
    for (const ctrl of this.aiControllers) ctrl.reset?.();
    for (const kart of this.karts) this._resetKart(kart);
    this.start();
  }

  /** Intended to be overridden by the controller: onPlayerFinish(place, totalTime). */
  onPlayerFinish(_place, _totalTime) {
    // default no-op
  }

  get countdownInt() {
    return Math.max(0, Math.ceil(this.countdown));
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  update(dt) {
    // FINISHED is a terminal presentation state. Keep the final kart/camera
    // pose and race clock stable; only the UI loop may continue rendering.
    if (this.phase === 'idle' || this.phase === 'finished') return;

    this.elapsed += dt;

    for (const box of this.itemBoxes) box.update?.(dt, this.karts, this);
    // Full-primary karts can still grab a box into their RESERVE slot
    // (ItemBox only picks up into an empty primary — audit r3 dual-slot).
    this._updateReservePickups();
    for (const coin of this.coins) coin.update?.(dt, this.karts, this);
    // AUDIT r8: scattered coins behave exactly like pickups (bob, spin,
    // collect); collected ones are swept out of the scene.
    for (const coin of this.droppedCoins) coin.update?.(dt, this.karts, this);
    for (let i = this.droppedCoins.length - 1; i >= 0; i--) {
      const c = this.droppedCoins[i];
      if (!c.active) {
        if (c.mesh) this.scene?.remove(c.mesh);
        c.dispose?.();
        this.droppedCoins.splice(i, 1);
      }
    }
    this._updateActiveItems(dt);

    if (this.phase === 'countdown') {
      this._setRankArrowsVisible(false); // AUDIT r8: no arrows before GO
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = 'race';
        this.audio?.play?.('go');
      }
      return;
    }

    // race / finished: karts keep driving (finished ones cruise around).
    const ctx = { track: this.track, raceManager: this, particles: this.particles };
    for (const kart of this.karts) kart.update?.(dt, ctx);
    for (const ctrl of this.aiControllers) ctrl.update(dt);
    this._resolveKartCollisions(dt);
    this._updateRescues(dt);

    if (this.phase === 'race') {
      this._updateStandings();
      this._checkFinishes();
      // AUDIT (2026-08-11, same unit-bug class as crashUntil): raceTimeoutMs
      // is MILLISECONDS (300000) but elapsed is SECONDS — the old compare
      // fired after ~83 HOURS, so the race-timeout force-finish never ran.
      if (this.elapsed >= CONFIG.game.raceTimeoutMs / 1000) this._forceFinish();
      if (this.raceOver) {
        this.phase = 'finished';
        this._setRankArrowsVisible(false); // AUDIT r8: arrows retire at the flag
        if (!this._raceOverNotified) {
          this._raceOverNotified = true;
          this.onRaceOver?.(this.getStandings());
        }
      }
    }
  }

  /** Off-track rescue (audit r4 — the Lakitu): a kart shoved into grass
   *  crawls at 45% with no way back. After 2s stuck off-road and slow,
   *  respawn it on its own progress point of the racing line with a hop. */
  _updateRescues(dt) {
    if (this.phase !== 'race' || !this.track?.path) return;
    for (const kart of this.karts) {
      if (kart.finished || kart.invincible || kart.starred) {
        kart._stuckT = 0;
        continue;
      }
      const st = kart.state || {};
      // AUDIT (Jarvis QA loop 2026-08-11): OUT-OF-BOUNDS rescue — a kart
      // flung past the map edge (hard shove/boost at a tight corner) used to
      // drive away forever (SIM seed 2918: z went to -126, v=4.6 never
      // triggered the <3 m/s stuck rescue). Any kart beyond the world bounds
      // gets the Lakitu IMMEDIATELY (1s grace), no speed threshold.
      const oob = Math.abs(st.position?.x || 0) > 95 || Math.abs(st.position?.z || 0) > 62;
      if (oob) {
        kart._stuckT = (kart._stuckT || 0) + dt;
        if (kart._stuckT >= 1) {
          const pR = this.track.path.getPointAt(Math.min(0.999, Math.max(0.001, st.progress01 || 0)));
          const tanR = this.track.path.getTangentAt(Math.min(0.999, Math.max(0.001, st.progress01 || 0)));
          if (pR) {
            st.position.set(pR.x, pR.y + 0.5, pR.z);
            st.heading = Math.atan2(tanR.x, tanR.z);
            st.speed = 0;
            st.vY = 3.5;
            st.spinOut = false;
            if (typeof st.progress01 === 'number') {
              kart._sampleIndex = Math.min(191, Math.max(0, Math.round(st.progress01 * 192)));
            }
            kart._stuckT = 0;
            // R25: same MK8D semantics as the stuck rescue below — a rescued
            // kart shouldn't keep a free shield/shell, and the player gets
            // the Lakitu feedback (was _onRescue: no such hook, silent no-op).
            kart.heldItem = null;
            kart.heldItem2 = null;
            kart._onRescued?.();
          }
        }
        continue;
      }
      if (st.offRoad && Math.abs(st.speed) < 3 && typeof st.progress01 === 'number') {
        kart._stuckT = (kart._stuckT || 0) + dt;
        if (kart._stuckT >= 2) {
          const p = this.track.path.getPointAt(st.progress01);
          const tan = this.track.path.getTangentAt(st.progress01);
          if (p) {
            st.position.set(p.x, p.y + 0.5, p.z);
            st.heading = Math.atan2(tan.x, tan.z);
            st.speed = 0;
            // AUDIT r11: re-seed the physics nearest-sample index so the
            // rescue doesn't leave a stale lattice (progress01 glitch → AI
            // steering anchor wobbles). progress01 is arc-length fraction →
            // index on the 192-sample arc-uniform lattice.
            if (typeof st.progress01 === 'number') {
              kart._sampleIndex = Math.min(191, Math.max(0, Math.round(st.progress01 * 192)));
            }
            st.vY = 3.5; // the little pop the Lakitu gives you
            st.spinOut = false;
            kart._stuckT = 0;
            // AUDIT r6: Lakitu removes the held item (MK8D) — a rescued kart
            // shouldn't keep a free shield/shell.
            kart.heldItem = null;
            kart.heldItem2 = null;
            kart._onRescued?.();
            if (kart === this.player && typeof window !== 'undefined' && window.__sk3d?.addShake) {
              window.__sk3d.addShake(0.3, 0.3);
            }
          }
        }
      } else {
        kart._stuckT = 0;
      }
    }
  }

  /** Push overlapping karts apart (speed-aware circle collision).
   *  AUDIT FIX (gameplay): the old version pushed BOTH karts symmetrically
   *  with a fixed nudge — a 64 m/s rear-end shoved the front kart sideways
   *  as hard as the rear-ender, and finished/cruising karts were rammed like
   *  targets. Now the impulse scales with the relative speed along the
   *  contact normal (the rear-ender loses more speed), and finished karts
   *  are only separated, never accelerated.
   *  AUDIT r2: the positional snap is clamped so karts never visibly
   *  teleport, and side-swipe / T-bone contacts spin out the RAMMER. */
  _resolveKartCollisions(dt = 0.016) {
    const karts = this.karts;
    for (let i = 0; i < karts.length; i++) {
      const a = karts[i];
      if (!a.state) continue;
      const ac = a._ramCooldown || 0;
      if (ac > 0) a._ramCooldown = Math.max(0, ac - dt);
      for (let j = i + 1; j < karts.length; j++) {
        const b = karts[j];
        if (!b.state) continue;
        const bc = b._ramCooldown || 0;
        if (bc > 0) b._ramCooldown = Math.max(0, bc - dt);
        const dx = b.state.position.x - a.state.position.x;
        const dz = b.state.position.z - a.state.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= NEARMISS_R2 || d2 <= 0.0001) continue;
        const d = Math.sqrt(d2);
        // AAA VFX: near-miss telegraph — graze band just outside contact.
        if (d2 >= CONTACT_R2) {
          const acd = a._nearMissCd || 0;
          const bcd = b._nearMissCd || 0;
          if (acd <= 0 && bcd <= 0 && this.particles) {
            const mx = (a.state.position.x + b.state.position.x) / 2;
            const mz = (a.state.position.z + b.state.position.z) / 2;
            const my = (a.state.position.y + b.state.position.y) / 2 + 0.5;
            this.particles.emit('nearMiss', new THREE.Vector3(mx, my, mz), { count: 6, speed: 5, size: 0.14 });
            a._nearMissCd = NEARMISS_COOLDOWN;
            b._nearMissCd = NEARMISS_COOLDOWN;
          }
          if (acd > 0) a._nearMissCd = Math.max(0, acd - dt);
          if (bcd > 0) b._nearMissCd = Math.max(0, bcd - dt);
          continue;
        }
        const overlap = (CONTACT_R - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        // Speed-aware: how fast is B approaching A along the contact normal?
        // Positive = B is closing on A (rear-ender). Scale the positional
        // shove and speed penalty by that closing speed — clamped so even a
        // hard 64 m/s hit can't snap karts across the track in one frame.
        const relSpeed = (b.state.speed || 0) - (a.state.speed || 0);
        const closing = Math.max(0, Math.abs(relSpeed) * 0.35);
        const rawA = overlap + closing * 0.02;
        const rawB = overlap - closing * 0.01;
        const pushA = Math.max(-CONTACT_SNAP_MAX, Math.min(CONTACT_SNAP_MAX, rawA));
        const pushB = Math.max(-CONTACT_SNAP_MAX, Math.min(CONTACT_SNAP_MAX, rawB));
        a.state.position.x -= nx * pushA;
        a.state.position.z -= nz * pushA;
        b.state.position.x += nx * pushB;
        b.state.position.z += nz * pushB;
        // Finished karts are obstacles, not pinballs: never accelerate them.
        if (!a.finished) a.nudge?.({ x: -nx, y: 0, z: -nz });
        if (!b.finished) b.nudge?.({ x: nx, y: 0, z: nz });
        // Rear-ender pays a small speed penalty for the shove.
        if (relSpeed > 1 && !b.finished) b.state.speed *= 0.985;
        // Lateral-shear contact (audit r2): side-swipes and T-bones spin out
        // the rammer; rear-ends have ~zero lateral component and stay gentle
        // shoves.
        this._resolveContactSpin(a, b, nx, nz);
      }
    }
  }

  /** Side-swipe / T-bone spin-out (audit r2). The lateral closing speed is
   *  the relative velocity PERPENDICULAR to the contact normal — ~0 for
   *  rear-ends, large for rams. Above the threshold, the kart moving most
   *  laterally across the contact (the rammer) gets a brief spin-out via the
   *  kart's existing _spinMs timer (KartPhysics spins s.heading + decays
   *  speed while it runs; AIController releases controls during it). */
  _resolveContactSpin(a, b, nx, nz) {
    const ha = a.state.heading || 0;
    const hb = b.state.heading || 0;
    const vaX = Math.sin(ha) * (a.state.speed || 0);
    const vaZ = Math.cos(ha) * (a.state.speed || 0);
    const vbX = Math.sin(hb) * (b.state.speed || 0);
    const vbZ = Math.cos(hb) * (b.state.speed || 0);
    const relX = vbX - vaX;
    const relZ = vbZ - vaZ;
    // |relV × n| (2D) — the lateral component of the relative velocity.
    const latClose = Math.abs(relX * nz - relZ * nx);
    if (latClose < CONTACT_SPIN_LAT_MIN) return;
    // Rammer = the kart whose own motion is most lateral to the contact.
    const latA = Math.abs(vaX * nz - vaZ * nx);
    const latB = Math.abs(vbX * nz - vbZ * nx);
    const rammer = latB > latA ? b : a;
    if (rammer.finished || rammer.invincible || rammer.starred) return;
    if ((rammer._ramCooldown || 0) > 0) return;
    rammer._ramCooldown = CONTACT_RAM_COOLDOWN;
    const severity = Math.min(1, (latClose - CONTACT_SPIN_LAT_MIN) / 18);
    const spinMs = Math.round(CONTACT_SPIN_MS + (CONTACT_SPIN_MS_MAX - CONTACT_SPIN_MS) * severity);
    if (typeof rammer._spinMs === 'number') {
      rammer._spinMs = Math.max(rammer._spinMs || 0, spinMs);
      rammer._spinDir = Math.random() < 0.5 ? -1 : 1;
    } else {
      rammer.state.spinOut = true; // duck-typed fallback
    }
    this._playContactSfx(a, b, latClose);
    // Small camera shake — only when the player is part of the hit.
    if ((a === this.player || b === this.player) && typeof window !== 'undefined' && window.__sk3d?.addShake) {
      window.__sk3d.addShake(Math.min(0.55, 0.18 + severity * 0.3), 0.35);
    }
  }

  /** Impact SFX ('crash') with world-X pan + volume scaled by lateral speed. */
  _playContactSfx(a, b, latClose) {
    if (!this.audio?.play) return;
    if (this._lastCrashSfx !== undefined && this.elapsed - this._lastCrashSfx < CONTACT_SFX_COOLDOWN) return;
    this._lastCrashSfx = this.elapsed;
    const midX = (a.state.position.x + b.state.position.x) / 2;
    const midZ = (a.state.position.z + b.state.position.z) / 2;
    const pan = (midX - (this.player?.state?.position.x ?? midX)) * 0.04;
    const vol = Math.min(0.85, 0.35 + (latClose / 30) * 0.5);
    // AUDIT R61: crash de kart longe do player atenua por distância (antes
    // tocava volume cheio a 200m).
    this.audio.play('crash', { volume: vol, pan: Math.max(-0.9, Math.min(0.9, pan)), pos: { x: midX, z: midZ } });
  }

  /** Advance projectiles/effects; sweep dead ones out of the scene. */
  _updateActiveItems(dt) {
    const items = this.activeItems;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.dead) {
        if (it.mesh) this.scene?.remove(it.mesh);
        it.dispose?.();
        items.splice(i, 1);
        continue;
      }
      it.update?.(dt, this.karts);
    }
  }

  /** Register a live item (projectile / hazard / star effect). */
  addActiveItem(item) {
    this.activeItems.push(item);
  }

  /** AUDIT r8: respawn coins scattered by a kart hit (MK8D drops up to 3,
   *  recollectable by anyone). Coins land BEYOND the pickup radius so the
   *  hit kart can't instantly re-grab its own loss; scatter is deterministic
   *  (fixed lateral pattern from the kart's heading — no Math.random).
   *  Reuses the Coin pickup mesh/behaviour; the dropping kart's sparkle +
   *  blip only play for the player (matches pickup fanfare rules). */
  _spawnDroppedCoins(kart, count) {
    if (!kart || !this.scene || !this.track) return;
    const h = kart.state?.heading ?? kart.group?.rotation?.y ?? 0;
    const fx = Math.sin(h); // forward (world XZ)
    const fz = Math.cos(h);
    const rx = Math.cos(h); // right
    const rz = -Math.sin(h);
    const p = kart.state?.position ?? kart.group?.position;
    if (!p) return;
    // Land on the ROAD (track height at the kart's progress) so a mid-air hit
    // doesn't strand the coins in the sky — MK8D coins fall to the asphalt.
    let roadY = p.y;
    try {
      const pp = this.track.path?.getPointAt?.(Math.min(Math.max(kart.state?.progress01 ?? 0, 0.001), 0.999));
      if (pp && Number.isFinite(pp.y)) roadY = pp.y;
    } catch { /* keep kart height */ }
    // Fixed scatter: left, right, ahead — all outside coinPickupRadius (2.4).
    const scatter = [
      { x: rx * 2.9, z: rz * 2.9 },
      { x: -rx * 2.9, z: -rz * 2.9 },
      { x: fx * 2.9, z: fz * 2.9 },
    ];
    for (let i = 0; i < count; i++) {
      const off = scatter[i % scatter.length];
      const coin = new Coin(this.track, 0.5 + i * 0.13, i % 2 === 0 ? 1 : -1, 0, {
        x: p.x + off.x,
        y: roadY + 0.45,
        z: p.z + off.z,
      });
      this.droppedCoins.push(coin);
      if (coin.mesh) this.scene.add(coin.mesh);
    }
    if (kart === this.player) {
      this.particles?.emit?.('sparkle', new THREE.Vector3(p.x, p.y + 0.4, p.z), {
        count: 8, speed: 3.2, size: 0.16, color: 0xffd166,
      });
      this.audio?.play?.('pickup', { volume: 0.5 });
    }
  }

  /** AUDIT r8: show/hide every kart's floating rank arrow. Only a live race
   *  shows the MK8D ordinals — menu, countdown and finish hide them. */
  _setRankArrowsVisible(v) {
    for (const k of this.karts) k.setRankVisible?.(v);
  }

  // -------------------------------------------------------------------------
  // Standings & finish detection
  // -------------------------------------------------------------------------

  /**
   * getStandings() → [{ kart, position, lap, progress01, finished }]
   * Sorted by race progress: finished karts first (by finish order), then
   * lap * 1000 + progress01 descending. Also writes kart.position (1-based).
   */
  getStandings() {
    // AUDIT PERF-R29 (2026-08-14, auditoria CPU #2): getStandings era chamado
    // ~6×/frame (1× _updateStandings + 5× AIs _rivalAhead) → ~50 alocações +
    // 6 sorts/frame. Cache por frame: _updateStandings computa uma vez e
    // reusa; staleness de 1 frame é invisível a 60fps (kart.position já é do
    // frame anterior).
    if (this._standingsFrame === this.elapsed && this._standingsRows) {
      return this._standingsRows;
    }
    const rows = this.karts.map((kart) => {
      const st = kart.state || {};
      const lap = st.lap ?? kart.lap ?? 0;
      const progress01 = st.progress01 ?? kart.progress01 ?? 0;
      const finished = !!(kart.finished || st.finished);
      let score = lap * 1000 + progress01;
      if (finished) {
        const fi = this.finishOrder.indexOf(kart);
        score = FINISH_SCORE_BASE - (fi >= 0 ? fi : this.karts.length) * 1000;
      }
      return { kart, position: 0, lap, progress01, finished, score };
    });
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((r, i) => {
      r.position = i + 1;
      r.kart.position = i + 1;
      delete r.score;
    });
    this._standingsRows = rows;
    this._standingsFrame = this.elapsed;
    return rows;
  }

  _updateStandings() {
    this.getStandings(); // also refreshes kart.position (cached per frame)
  }

  _checkFinishes() {
    const total = CONFIG.game.totalLaps;
    for (const kart of this.karts) {
      if (kart.finished) continue;
      const st = kart.state || {};
      const lap = st.lap ?? kart.lap ?? 0;
      if (lap >= total) {
        kart.finished = true;
        kart.totalTime = this.elapsed;
        this.finishOrder.push(kart);
        if (kart === this.player && !this.playerFinished) {
          this.playerFinished = true;
          this.onPlayerFinish(this.finishOrder.length, this.elapsed);
        }
      }
    }
    if (this.finishOrder.length >= this.karts.length && this.karts.length > 0) {
      this.raceOver = true;
    }
  }

  /** Timeout safety net: award everyone the remaining spots. */
  _forceFinish() {
    for (const kart of this.karts) {
      if (kart.finished) continue;
      kart.finished = true;
      kart.totalTime = this.elapsed;
      this.finishOrder.push(kart);
    }
    if (this.player && !this.playerFinished) {
      this.playerFinished = true;
      this.onPlayerFinish(this.finishOrder.indexOf(this.player) + 1, this.elapsed);
    }
    this.raceOver = true;
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  /** Roll a weighted PowerUpType and hand it to the kart. The roll is
   *  position-aware: leaders get defensive items, tail-enders get comebacks.
   *  AUDIT r3 dual-slot: fills the primary first, the reserve slot otherwise;
   *  ~1-in-6 boxes grant a TRIPLE (3 identical items queued as a stack —
   *  using one auto-queues the next via useItem). */
  pickupItem(kart) {
    if (!kart || (kart.heldItem && kart.heldItem2)) return null; // both slots full
    const n = this.karts.length || 6;
    const pos01 = n > 1 ? Math.max(0, Math.min(1, (kart.position - 1) / (n - 1))) : 0.5;
    const type = rollPowerUpType(pos01);
    // Triple box: the whole stack rides in ONE slot (MK8: your hold slot
    // shows ×3 and refills itself as you use it). Reserved for the free slot
    // so a full primary + empty reserve still queues behind heldItem2.
    const triple = Math.random() < CONFIG.items.tripleChance;
    if (kart.heldItem) {
      kart.heldItem2 = type;
      kart._heldItem2Count = triple ? 3 : 1;
    } else {
      kart.heldItem = type;
      kart._heldItemCount = triple ? 3 : 1;
    }
    // Player gets the full 'pickup' fanfare from main.js's heldItem change
    // hook; AI pickups keep a quiet discrete blip (no double chime — audit F2).
    // AUDIT R18 (Feco real-GPU 2026-08-14: 'som de powerup AI deve ser por
    // PROXIMIDADE e bem mais baixo que o do player'): volume cai com a
    // distância até o player — longe ≈ silêncio, perto ≈ 0.18 (player = 0.5).
    if (kart !== this.player) {
      const pp = this.player?.state?.position ?? this.player?.group?.position;
      const kp = kart.state?.position ?? kart.group?.position;
      if (pp && kp) {
        const dx = pp.x - kp.x, dz = pp.z - kp.z;
        const dist = Math.hypot(dx, dz);
        // audível até ~42m, volume máx 0.18 quando colado no player
        const vol = Math.max(0, 0.18 * (1 - dist / 42));
        if (vol > 0.004) {
          const pan = Math.max(-0.9, Math.min(0.9, dx * 0.03));
          this.audio?.play?.('itemPickup', { volume: vol, pan });
        }
      } else {
        this.audio?.play?.('itemPickup', { volume: 0.08 });
      }
    }
    return type;
  }

  /** Reserve-slot pickup pass: ItemBox.update() skips karts whose PRIMARY
   *  slot is full, so it can never fill heldItem2. This pass extends box
   *  eligibility to karts with a full primary + empty reserve (MK8 dual-slot:
   *  hold a defensive item AND carry a second one for later). */
  _updateReservePickups() {
    // AUDIT PERF-R41 (2026-08-14, auditoria CPU #11): early-out global — o
    // scan 12×6 rodava COMPLETO mesmo sem nenhum kart elegível (full-primary
    // + empty-reserve). Agora se nenhum kart tem reserve vazio, retorna já.
    let anyEligible = false;
    for (const kart of this.karts) {
      if (kart && !kart.finished && kart.heldItem && !kart.heldItem2) { anyEligible = true; break; }
    }
    if (!anyEligible) return;
    const r = CONFIG.items.pickupRadius;
    const rr = r * r;
    for (const box of this.itemBoxes) {
      if (!box || !box.active || !box.mesh) continue;
      for (const kart of this.karts) {
        if (!kart || kart.finished) continue;
        if (!kart.heldItem || kart.heldItem2) continue; // only full-primary, empty-reserve
        const p = kart.group ? kart.group.position : kart.state?.position;
        if (!p) continue;
        const dx = p.x - box.mesh.position.x;
        const dz = p.z - box.mesh.position.z;
        if (dx * dx + dz * dz < rr) {
          this.pickupItem(kart); // primary full -> lands in heldItem2
          box._consume?.();
          break;
        }
      }
    }
  }

  /** Central item-usage entry point — builds the ctx for PowerUp.useItem.
   *  AI shells/red shells target the nearest rival AHEAD of the shooter
   *  (standings-based, not always the player — audit r2); the player passes
   *  none (PowerUp then picks the nearest rival ahead itself).
   *  AUDIT r3 dual-slot: an empty primary pulls the reserve slot forward
   *  (Space always works); triple stacks auto-queue the next item after use. */
  useItem(kart) {
    if (!kart || (!kart.heldItem && !kart.heldItem2)) return;
    if (!kart.heldItem && kart.heldItem2) this._promoteHeldItem(kart);
    if (!kart.heldItem) return;
    const stackCount = kart._heldItemCount || 1;
    const stackType = kart.heldItem;
    const targetKart = kart === this.player ? null : this._pickRivalAhead(kart);
    applyItemEffect(kart, {
      scene: this.scene,
      karts: this.karts,
      raceManager: this,
      audio: this.audio,
      particles: this.particles,
      targetKart,
    });
    // MK8 triple: the next of a triple stack refills the freed hold slot.
    if (stackType && stackCount > 1) {
      kart._heldItemCount = stackCount - 1;
      kart.heldItem = stackType;
    } else {
      kart._heldItemCount = 1;
    }
  }

  /** Move the reserve slot into the primary (whole stack moves; the primary
   *  is empty when called). Slot-2 singles promote too, so pressing use with
   *  only a reserve item still fires it. */
  _promoteHeldItem(kart) {
    if (!kart.heldItem2) return;
    kart.heldItem = kart.heldItem2;
    kart._heldItemCount = kart._heldItem2Count || 1;
    kart.heldItem2 = null;
    kart._heldItem2Count = 1;
  }

  /** Nearest rival AHEAD of the shooter by race standings (position 1 =
   *  leader; getStandings() rows before the shooter are all ahead). Returns
   *  null when nobody is ahead (leader / unknown kart). */
  _pickRivalAhead(shooter) {
    const rows = this.getStandings();
    let myIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].kart === shooter) { myIdx = i; break; }
    }
    if (myIdx <= 0) return null;
    const myScore = rows[myIdx].lap * 1000 + rows[myIdx].progress01;
    let best = null;
    let bestDiff = Infinity;
    for (let i = 0; i < myIdx; i++) {
      const r = rows[i];
      if (r.finished) continue;
      const diff = r.lap * 1000 + r.progress01 - myScore;
      if (diff > 0 && diff < bestDiff) { bestDiff = diff; best = r.kart; }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Restart helpers
  // -------------------------------------------------------------------------

  _resetKart(kart) {
    kart.finished = false;
    kart.totalTime = null;
    kart.position = 0;
    kart.heldItem = null;
    kart.heldItem2 = null; // dual-slot + triple stacks reset with the race
    kart._heldItemCount = 1;
    kart._heldItem2Count = 1;
    kart._coins = 0;
    if (typeof kart.restart === 'function') {
      kart.restart();
      return;
    }
    const st = kart.state;
    if (st) {
      if (kart.startPosition && st.position) st.position.copy(kart.startPosition);
      if (typeof kart.startHeading === 'number') st.heading = kart.startHeading;
      st.speed = 0;
      st.lap = 0;
      st.progress01 = 0;
      st.spinOut = false;
      st.offRoad = false;
    }
  }
}
