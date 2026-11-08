/**
 * Super Kart 3D.js — AI drivers.
 * Follows the track centerline with look-ahead steering, applies rubber-band
 * speed tuning vs the player, uses held items smartly (targeting the player),
 * and releases controls during crash/spin-out recovery.
 *
 * Kart API is duck-typed (kart.setControls, kart.state, kart.finished).
 * Uses raceManager.centerline (a cached sampled path) for navigation; falls
 * back to track.waypoints when the manager has no cache.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { headingVector, progressScore, signedAngle, PowerUpType, kartPosition } from './PowerUp.js';

/** Full steering lock reached at this heading error (radians). */
const STEER_FULL_AT = 0.7;

export class AIController {
  constructor(kart, track, raceManager, aiIndex = 0) {
    this.kart = kart;
    this.track = track;
    this.raceManager = raceManager;

    this.centerline = null;
    this.spacing = 2.5;
    this.nearIdx = 0;

    this.crashUntil = -1; // manager elapsed time when we may steer again
    this.itemAccum = 0; // item-use accumulator (chance per second)
    this._snapStreak = 0; // AUDIT r11-F4: consecutive anchor-rejection frames (hysteresis)

    // Apply the driver's stats (1-10) as a difficulty curve (audit F2):
    //   speed    → base cruise speed (0.95-1.05 x maxSpeed)
    //   accel    → throttle eagerness (0.75-1.0 floor)
    //   handling → steering authority (0.85-1.15 look-ahead steering gain)
    const st = kart.character?.stats || { speed: 7, accel: 7, handling: 7 };
    this.stats = st;
    // Per-driver lateral lane offset (audit v4 F3: all AI hugged the same
    // centerline → train formation). Deterministic golden-ratio spread seeded
    // from the roster index (NOT kart.position — that was 0 at construction,
    // so every rival got the identical offset and drove one behind the other).
    // AUDIT F2/F3 (game-design audits): the raw golden-ratio spread reached
    // ±2.79m — beyond the stable corridor on clockwise tracks (inside of
    // right-hand corners = right side), so LEFT lanes oscillated and the
    // largest offsets pinned karts into the guard rail (41 wall bounces/90s
    // SCALE the spread to ±0.6m instead of clamping: clamping
    // COLLAPSED two rivals onto the same lane (aiIndex 0 and 2 both hit
    // -0.6 → overlapping cloud). Scaling keeps every lane distinct while
    // staying inside the stable corridor. Rivals that still can't hold a
    // left line naturally fall onto the racing line (MK8D CPUs do the same).
    this.laneOffset = aiIndex !== undefined && aiIndex !== null
      ? (aiIndex * 0.61803398875 - Math.floor(aiIndex * 0.61803398875) - 0.5) * 1.2
      : 0;
    this._initPath();
  }

  /** Resolve the steering reference path (raceManager cache > waypoints). */
  _initPath() {
    const rm = this.raceManager;
    if (rm && rm.centerline && rm.centerline.length) {
      this.centerline = rm.centerline;
      this.spacing = rm.centerlineSpacing || 2.5;
      return;
    }
    const wp = this.track && this.track.waypoints;
    if (wp && wp.length) {
      this.centerline = wp;
      const len = (this.track && this.track.length) || wp.length * this.spacing;
      this.spacing = Math.max(1.2, len / wp.length);
    }
  }

  /** Called by RaceManager.restart() to clear per-race state. */
  reset() {
    this.nearIdx = 0;
    this.crashUntil = -1;
    this.itemAccum = 0;
    this._snapStreak = 0;
  }

  update(dt) {
    const kart = this.kart;
    const st = kart.state || {};
    const now = (this.raceManager && this.raceManager.elapsed) || 0;

    // Crash recovery: while spinning out, release all controls.
    // AUDIT r11 (FECO BUG REPORT — 'os adversarios começam a correr para
    // trás'): NEVER brake here. In this physics brake = REVERSE (see the
    // note in _drive): after the spinOut timer ends the kart sits at ~0
    // speed while crashUntil is still active, so brake 0.6/1 drove it
    // backward at up to reverseSpeed for a full second — the visible
    // 'running backwards' right after a crash.
    if (st.spinOut) {
      // AUDIT (Feco, 2026-08-11): UNIT BUG — crashRecoverMs is in
      // MILLISECONDS but `now` (raceManager.elapsed) is in SECONDS. The old
      // `now + crashRecoverMs` set crashUntil ~1200 SECONDS in the future
      // (20 minutes): after ANY spin/hit the AI released controls forever
      // and the kart froze in place — the 'bots travados' bug. Divide by
      // 1000 so the recovery window is 1.2 real seconds.
      this.crashUntil = now + CONFIG.ai.crashRecoverMs / 1000;
      kart.setControls?.({ steer: 0, throttle: 0, brake: 0, drift: false, useItem: false });
      return;
    }
    if (now < this.crashUntil) {
      kart.setControls?.({ steer: 0, throttle: 0, brake: 0, drift: false, useItem: false });
      return;
    }

    this._drive(dt, !!kart.finished);

    if (!kart.finished) this._maybeUseItem(dt);
  }

  // -------------------------------------------------------------------------
  // Steering / throttle
  // -------------------------------------------------------------------------

  _drive(dt, finished) {
    const kart = this.kart;
    const st = kart.state || {};
    const pos = kartPosition(kart);
    const heading = headingVector(kart);

    // Look-ahead waypoint: steerPredictAhead meters along the path from the
    // kart's nearest centerline sample.
    let target;
    const near = this._findNearest(pos);
    if (near >= 0 && this.centerline) {
      const look = Math.max(1, Math.round(CONFIG.ai.steerPredictAhead / this.spacing));
      const idx = (near + look) % this.centerline.length;
      target = this.centerline[idx];
      // Lateral lane offset: hold a personal racing line (audit v4 F3).
      // AUDIT #4 (code audit): on very tight hairpins the offset point can
      // sit BEHIND the kart (err > 90°) — skip the offset when the raw
      // heading error to the centerline target is already extreme; the
      // corner is taken on the centerline and the lane resumes after.
      if (this.laneOffset) {
        const p0 = this.centerline[idx];
        const p1 = this.centerline[(idx + 1) % this.centerline.length];
        let tx = p1.x - p0.x;
        let tz = p1.z - p0.z;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        const baseErr = signedAngle(heading, { x: tx, y: tz });
        if (Math.abs(baseErr) <= 0.9) {
          target = { x: p0.x + -tz * this.laneOffset, z: p0.z + tx * this.laneOffset };
        }
      }
    } else {
      // No path data — dead-reckon straight ahead.
      target = { x: pos.x + heading.x * 10, z: pos.z + heading.y * 10 };
    }

    const toTargetX = target.x - pos.x;
    const toTargetZ = target.z - pos.z;
    const tl = Math.hypot(toTargetX, toTargetZ) || 1;
    const err = signedAngle(heading, { x: toTargetX / tl, y: toTargetZ / tl });

    // signedAngle(a,b) = h(a) - h(b). With the current physics, positive
    // steer DECREASES heading (turns right). Target right of kart → err > 0
    // → positive steer. (Was -err before the steering-sign fix.)
    // Handling stat scales steering authority (audit F2 difficulty curve).
    const hGain = 0.85 + (this.stats?.handling || 7) / 10 * 0.3 + (this.track?.isCity ? 0.15 : 0);
    let steer = THREE.MathUtils.clamp((err / STEER_FULL_AT) * hGain, -1, 1);

    // Hazard avoidance (audit r3: CPUs were free banana/shell fodder — no
    // steering response to hazards on their line). Steer away from any live
    // item within ~5m roughly ahead.
    const items = this.raceManager?.activeItems;
    if (items && items.length) {
      for (const it of items) {
        const m = it && it.mesh;
        if (!m) continue;
        const hx = m.position.x - pos.x;
        const hz = m.position.z - pos.z;
        const dist = Math.hypot(hx, hz);
        if (dist > 5 || dist < 0.01) continue;
        const dot = (hx / dist) * heading.x + (hz / dist) * heading.y; // ~ahead?
        if (dot < 0.6) continue;
        // Cross product sign: >0 → hazard left of the kart → steer right.
        const side = (heading.x * hz - heading.y * hx) / dist;
        // AUDIT MED: 0.75 = perfect dodge — bananas never worked vs AI. MK8D
        // CPUs CLIP hazards; 0.3 still swerves visibly but bananas land.
        steer = THREE.MathUtils.clamp(steer + (side > 0 ? 1 : -1) * 0.3, -1, 1);
        break;
      }
    }

    let throttle = 1;
    let brake = 0;
    let drift = false;
    const absErr = Math.abs(err);
    // NOTE: never set brake for slow-down — in this physics brake = reverse.
    // Slowing is handled by easing the throttle; the path-pull turns the kart.
    if (absErr > 0.9) {
      // Hairpin: crawl while the damp-pull rotates us toward the path.
      throttle = 0.3;
    } else if (absErr > 0.5) {
      // Soft corner: lift a bit.
      throttle = 0.8;
    }
    if (this.track?.isCity && absErr > 0.35) throttle = Math.min(throttle, 0.72);

    const speed = st.speed ?? 0;
    if (speed < -0.5) {
      // Reversing (after a collision) — throttle FORWARD to exit reverse.
      // (brake would accelerate backwards toward reverseSpeed in this physics.)
      throttle = 1;
      brake = 0;
    }

    // Rubber-band: speed up when behind, ease off when ahead.
    // AUDIT F1 (game-design audit): the rubber band used to be PLAYER-relative
    // only — chasing-AI vs the rival AHEAD got 0, so on twisty tracks the
    // order froze into a procession (City: 45 standings changes in 4500
    // frames vs 3489 on meadow). Add an AI-vs-AI chase term: a kart behind
    // the rival immediately ahead gets up to +6% cruise (capped inside the
    // 12% rubberBandCap), so mid-pack passes happen without the leader
    // running away.
    const player = this.raceManager && this.raceManager.player;
    if (player && player !== kart) {
      const d = progressScore(player) - progressScore(kart); // >0 → AI behind
      // NOTE: d is a progress diff in 0..1, so the divisor must be ~1.5 — the
      // old /400 made the whole term ~0.001 (rubber-band numerically dead).
      const factor = THREE.MathUtils.clamp((d * CONFIG.ai.rubberBandFactor) / 1.5, -0.12, 0.3);
      // Real comeback: throttle alone can't raise TOP SPEED (physics caps at
      // maxSpeed/boostSpeed), so behind-AIs also get a cruiseSpeed override.
      // The driver's speed stat scales the whole cruise envelope.
      // AUDIT r2: when the AI is AHEAD the statScale caps at 1.0 — leading
      // rivals used to out-pace the player without items (feels unfair).
      // AUDIT F2: that min-cap also made the SPEED STAT DEAD while leading
      // (every leader ran exactly maxSpeed). Leaders now keep a stat spread
      // (0.96-0.992) below the ceiling — Comet(9) still outpaces Daisy(5)
      // when both lead, but nobody out-paces the player for free.
      const statScale = d > 0.03
        ? 0.95 + (this.stats?.speed || 7) / 10 * 0.1
        : 0.92 + (this.stats?.speed || 7) / 10 * 0.08;
      const rival = this._rivalAhead();
      let chaseBoost = 0;
      if (rival && rival !== player) {
        const dr = progressScore(rival) - progressScore(kart); // >0 → behind a rival
        if (dr > 0.02 && dr < 1) chaseBoost = Math.min(0.06, dr * 0.25);
      }
      if (d > 0.03) {
        const boost = Math.min(0.12, d * 0.3); // audit v4: capped +12% (was +22% — felt like cheating)
        kart.cruiseSpeed = CONFIG.physics.maxSpeed * (1 + Math.min(boost + chaseBoost, 0.12)) * statScale;
      } else {
        kart.cruiseSpeed = CONFIG.physics.maxSpeed * (1 + chaseBoost) * statScale;
      }
      throttle = THREE.MathUtils.clamp(throttle * (1 + factor), 0, 1.35);
    }

    if (this.track?.isCity) {
      const cornerCap = absErr > 0.35 ? 0.78 : 0.88;
      kart.cruiseSpeed = Math.min(kart.cruiseSpeed || CONFIG.physics.maxSpeed, CONFIG.physics.maxSpeed * cornerCap);
    }

    // Drift style through committed corners (only while racing).
    // Accel stat raises the throttle floor → eager starters pull away (F2).
    const aGain = 0.6 + (this.stats?.accel || 7) / 10 * 0.5;
    if (!finished && absErr > 0.55 && speed > CONFIG.physics.driftMinSpeed) {
      drift = true;
      throttle = this.track?.isCity ? 0.72 : Math.max(throttle * aGain, 1);
    }

    kart.setControls?.({ steer, throttle, brake, drift, useItem: false });
  }

  /** Nearest centerline sample index — PROGRESS-ANCHORED (audit r11, FECO BUG
   *  REPORT: 'os adversarios começam a correr para trás').
   *
   *  Root cause: the old rolling distance window (±8 samples ≈ 13-22m) lags
   *  whenever a shove / ramp launch / off-road excursion carries the kart
   *  more than the window radius along the path. The stale index then puts
   *  the look-ahead target BEHIND the kart, so the AI turns around and
   *  drives backwards 'out of nowhere'. The r10 full-scan fallback only
   *  fired past 20×spacing (~33-54m) — the dangerous band was 13→33m.
   *
   *  Fix: the kart's race progress (state.progress01, an arc-length fraction
   *  from KartPhysics) is the ONLY authoritative anchor — it is monotonic
   *  per lap, immune to lateral displacement, and maps directly onto the
   *  arc-length-uniform centerline. The distance window is kept only as a
   *  fast path and is trusted solely while it agrees with the anchor; on
   *  disagreement the anchor wins, so the look-ahead target can never sit
   *  behind the kart's race progress. */
  _findNearest(pos) {
    const cl = this.centerline;
    if (!cl || !cl.length) return -1;
    const n = cl.length;
    const prog = this.kart.state?.progress01;
    const progIdx = (typeof prog === 'number' && prog >= 0 && prog <= 1)
      ? Math.min(n - 1, Math.max(0, Math.round(prog * n)))
      : -1;

    // Fast path: rolling distance window around the last index.
    const r = 8;
    let best = this.nearIdx;
    let bestD = Infinity;
    for (let i = this.nearIdx - r; i <= this.nearIdx + r; i++) {
      const j = ((i % n) + n) % n;
      const p = cl[j];
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }

    if (progIdx >= 0) {
      // Trust the window only when it is both CLOSE to the kart and CLOSE to
      // the progress anchor. Otherwise snap to the anchor (re-searching a
      // tiny window around it — the kart may sit slightly behind its
      // progress point after a shove, never far ahead).
      // AUDIT r11-F4: 2-frame hysteresis — a single transient rejection
      // (lattice quantization during wall-slide chaos) used to yank the
      // reference and re-aim the target; the snap now needs two consecutive
      // rejections (~33ms — still instant for a genuinely stale window).
      const windowOk = bestD <= (this.spacing * 6) ** 2 && Math.abs(best - progIdx) <= 12;
      if (!windowOk) {
        this._snapStreak = (this._snapStreak || 0) + 1;
        if (this._snapStreak >= 2) {
          best = progIdx;
          bestD = Infinity;
          for (let j = best - 4; j <= best + 4; j++) {
            const k = ((j % n) + n) % n;
            const p = cl[k];
            const d = (p.x - pos.x) * (p.x - pos.x) + (p.z - pos.z) * (p.z - pos.z);
            if (d < bestD) { bestD = d; best = k; }
          }
        }
      } else {
        this._snapStreak = 0;
      }
    }
    this.nearIdx = best;
    return best;
  }

  // -------------------------------------------------------------------------
  // Item usage
  // -------------------------------------------------------------------------

  /** Accumulate a per-second use chance; fire when it crosses 1. */
  _maybeUseItem(dt) {
    const kart = this.kart;
    // AUDIT r6 (reserve slot): this used to early-return on an empty primary,
    // so heldItem2 rotted forever — _blockWithHeldItem consumed the primary
    // shield and the reserve was never promoted. Promote the reserve into the
    // primary (existing swapHeldItems API, stack counts included) whenever
    // the primary is empty.
    if (!kart.heldItem) {
      if (!kart.heldItem2) {
        this.itemAccum = 0;
        return;
      }
      kart.swapHeldItems?.();
      if (!kart.heldItem) {
        this.itemAccum = 0;
        return;
      }
    }
    this.itemAccum += CONFIG.ai.itemUseChancePerSec * dt;
    if (this.itemAccum < 1) return;
    this.itemAccum = 0;
    // AUDIT r7 (defensive rear play): a chased AI used to hoard its shell or
    // banana forever (the forward-use checks refuse when nothing is ahead).
    // MK8D pack AI drops/throws backward — rear-throw the held shell/banana
    // at a chaser. Checked before forward use: the immediate threat wins.
    if (this._rearDefense()) return;
    // Dead-weight primary (a block-hold the use check would refuse — shell
    // with nobody ahead, banana held while not leading): swap the reserve in
    // BEFORE the use check so it gets a chance instead of rotting. The
    // unusable item stays in reserve and still works as an item-hold shield.
    if (kart.heldItem2 && this._primaryDeadWeight()) {
      kart.swapHeldItems?.();
    }
    if (this._shouldUseItem()) {
      this.raceManager?.useItem?.(kart);
    }
  }

  /** AUDIT r6: is the primary a block-hold the use check will refuse forever?
   *  The _blockWithHeldItem consumables (shell/red/banana) are dead weight
   *  when the situational check refuses — a shell with nobody ahead can never
   *  fire, and a banana held mid-pack is only a shield. Comeback items
   *  (mushroom/star/lightning) are kept: they become usable later. */
  _primaryDeadWeight() {
    const kart = this.kart;
    const type = kart.heldItem;
    if (type !== PowerUpType.SHELL && type !== PowerUpType.RED_SHELL && type !== PowerUpType.BANANA) {
      return false;
    }
    const rival = this._rivalAhead() || (this.raceManager && this.raceManager.player);
    const d = rival ? progressScore(rival) - progressScore(kart) : 0;
    if (type === PowerUpType.BANANA) return d >= -10; // trap only with a safe lead
    return d <= 0; // shell/red need somebody ahead to hit
  }

  /** Smart use conditions — items are held until the moment is right. */
  _shouldUseItem() {
    const kart = this.kart;
    const type = kart.heldItem;
    const player = this.raceManager && this.raceManager.player;
    // AUDIT r3: item decisions were player-relative — an AI in 2nd behind an
    // AI leader hoarded its shell forever and mid-pack drama died. Now target
    // the rival IMMEDIATELY ahead in the standings (fallback: the player).
    const rival = this._rivalAhead() || player;
    const d = rival ? progressScore(rival) - progressScore(kart) : 0;

    switch (type) {
      case PowerUpType.STAR:
        return true; // always pop it
      case PowerUpType.MUSHROOM:
        if (kart.state && kart.state.offRoad) return true; // recover speed
        if (d > 0.03) return true; // big catch-up gap (AUDIT: was d>30 — progressScore in-lap range is -1..1, so the branch was dead code)
        {
          const err = this._headingErrorTo(rival);
          return err !== null && Math.abs(err) < 0.4 && d > 0;
        }
      case PowerUpType.SHELL:
      case PowerUpType.RED_SHELL:
        if (d <= 0) return false; // nobody ahead to hit
        {
          const err = this._headingErrorTo(rival);
          return err === null || Math.abs(err) < 1.2;
        }
      case PowerUpType.BANANA:
        // AUDIT (game-design review): -0.12 (12% lap lead) made mid-pack AI
        // hoard traps forever; -0.03 (3% lead) still means the rival behind
        // can't grab it before the trap is useful — livelier item play.
        return d < -0.03;
      case PowerUpType.LIGHTNING:
        return d > 0.03 && d < 2.0; // rival ahead within ~2 laps worth; was d>5 (dead — progressScore delta is -1..1 per lap, 1000 per lap)
      default:
        return true;
    }
  }

  /** AUDIT r7: defensive rear play — when a rival is close BEHIND, arm the
   *  existing rear-throw path (kart._rearThrow, read + cleared by
   *  PowerUp.useItem) and fire the held shell/banana backward (MK8D pack AI
   *  drops a banana/shell behind when chased) instead of hoarding forever.
   *  Returns true when the item was consumed (or the throw was attempted). */
  _rearDefense() {
    const kart = this.kart;
    const type = kart.heldItem;
    if (type !== PowerUpType.SHELL && type !== PowerUpType.RED_SHELL && type !== PowerUpType.BANANA) {
      return false;
    }
    if (!this._chased()) return false;
    // Mirror main.js hold-to-throw (rear = true → kart._rearThrow → useItem):
    // arm the rear flag, fire, then clear it even if useItem bailed (empty
    // slot race) so the flag never leaks into a later forward use.
    kart._rearThrow = true;
    this.raceManager?.useItem?.(kart);
    kart._rearThrow = false;
    return true;
  }

  /** Is a rival close BEHIND us? Either criterion fires:
   *   - standings gap: progressScore(rival) - progressScore(kart) < -5.
   *     (lap*1000 dominates the 0..1 progress01, so this mainly catches
   *     lapping chasers; within a lap the gap range is only -1..0.)
   *   - physical: a rival within 8m BEHIND our heading (the pack-chase
   *     case that actually drives MK8D-style defensive drops). */
  _chased() {
    const karts = this.raceManager?.karts;
    if (!Array.isArray(karts)) return false;
    const kart = this.kart;
    const opos = kartPosition(kart);
    const dir = headingVector(kart);
    const myScore = progressScore(kart);
    for (const k of karts) {
      if (!k || k === kart || k.finished) continue;
      const d = progressScore(k) - myScore; // < 0 → rival behind in standings
      const p = kartPosition(k);
      const dx = p.x - opos.x;
      const dz = p.z - opos.z;
      const behind = dx * dir.x + dz * dir.y; // < 0 → physically behind us
      if (behind >= 0) continue; // only rivals behind count as chasers
      if (d < -5 || Math.hypot(dx, dz) < 8) return true;
    }
    return false;
  }

  /** The kart one place AHEAD in the standings (null if leading). */
  _rivalAhead() {
    const rm = this.raceManager;
    if (!rm || typeof rm.getStandings !== 'function') return null;
    const standings = rm.getStandings();
    const myIdx = standings.findIndex((s) => s.kart === this.kart);
    if (myIdx > 0) return standings[myIdx - 1].kart;
    return null;
  }

  /** Signed heading error toward a kart, or null if no kart given. */
  _headingErrorTo(targetKart) {
    if (!targetKart) return null;
    const pos = kartPosition(this.kart);
    const pp = kartPosition(targetKart);
    const dx = pp.x - pos.x;
    const dz = pp.z - pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 1) return 0;
    return signedAngle(headingVector(this.kart), { x: dx / l, y: dz / l });
  }
}
