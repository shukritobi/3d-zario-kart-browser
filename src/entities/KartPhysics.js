/**
 * Super Kart 3D.js — arcade kart physics.
 * Pure-ish step mutating `kart.state` (plus a few private `kart._*` fields).
 * Model (all knobs from CONFIG.physics):
 *   - steer rate scales with speed (steerSpeedLow when slow, steerSpeed at
 *     speed, driftSteer while drifting)
 *   - drift: charge 0..1 while drifting above driftMinSpeed; releasing with
 *     charge >= driftReleaseBoost fires a mini-boost via kart.applyBoost()
 *   - lateral velocity with exponential grip (lateralGrip; looser while
 *     drifting) — produces the classic drift slide
 *   - friction, braking → reverse (reverseSpeed floor)
 *   - off-road: beyond road half-width, max speed scaled by
 *     CONFIG.track.offRoadMaxSpeedFactor
 *   - wall bounce at the road edge + grass margin (collisionBounce)
 *   - gravity / airtime with landing squash
 *   - squash & stretch: group.scale.y eases toward kart._scaleTarget
 *   - progress01 via lazy nearest-sample search on a cached waypoint lattice;
 *     lap increments when progress wraps 0→1 while facing startLine.direction
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { lateralVelocityStep, playerDriftSteerRate } from './handling.js';
// AUDIT r18-FIX (gameplay auditor): terrain now rolls ±5m beyond the
// corridor — off-road karts must ride it or they bury/float on the hills.
import { terrainHeight } from '../track/TrackBuilder.js';
import { advanceLapCheckpoint } from './lapCheckpoints.js';
import { horizontalDistanceSquared, projectTrackLattice } from './trackProjection.js';
import { zarioLogger } from '../game/ZarioLogger.js';

const SAMPLES = 384; // long tracks: maintain <=4m nearest-sample spacing // points around the loop for nearest-sample search

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/** Build (once per track) the sampled lattice: positions, tangents, cumulative length. */
// AUDIT PERF-R39 (2026-08-14, auditoria CPU #9): a lattice só depende do
// track — 6 karts construíam 6 cópias (2.300 avaliações de curva + hitch
// one-time no GO). Cache module-level keyed por track; só _sampleIndex é
// per-kart.
const _sampleCache = new Map();

function ensureSamples(kart, track) {
  if (kart._samples && kart._samples.track === track) return kart._samples;
  if (_sampleCache.has(track)) {
    kart._samples = _sampleCache.get(track);
    kart._sampleIndex = 0;
    return kart._samples;
  }
  const N = SAMPLES;
  const path = track.path;
  const pos = [];
  const tan = [];
  const len = [];
  let total = 0;
  let prev = path.getPointAt(0);
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const p = path.getPointAt(t);
    const tg = path.getTangentAt(t);
    if (i > 0) total += p.distanceTo(prev);
    pos.push(p.clone());
    tan.push(new THREE.Vector3(tg.x, 0, tg.z).normalize());
    // len[i] must be the distance AT sample i. The previous code
    // inserted an extra zero at len[0], shifting progress one waypoint.
    len.push(total);
    prev = p;
  }
  total += prev.distanceTo(pos[0]); // include the loop-closing segment
  const samples = { track, N, pos, tan, len, total: Math.max(total, 0.001) };
  _sampleCache.set(track, samples);
  kart._samples = samples;
  kart._sampleIndex = 0;
  return samples;
}

/** Nearest-sample search around the previous best index (O(1) typical). */
function nearestSample(kart, samples) {
  const N = samples.N;
  const start = ((kart._sampleIndex % N) + N) % N;
  const p = kart.state.position;
  let best = start;
  let bestD = horizontalDistanceSquared(samples.pos[start], p);
  const RADIUS = samples.track?.isCity ? 40 : 14;
  for (let r = 1; r <= RADIUS; r++) {
    const i1 = (start + r) % N;
    const d1 = horizontalDistanceSquared(samples.pos[i1], p);
    if (d1 < bestD) { bestD = d1; best = i1; }
    const i2 = (start - r + N) % N;
    const d2 = horizontalDistanceSquared(samples.pos[i2], p);
    if (d2 < bestD) { bestD = d2; best = i2; }
  }
  // AUDIT r11 (FECO BUG REPORT — AI drives backwards): the >30m full-scan
  // threshold let a kart launched/shoved >14 samples along the path keep a
  // STALE progress01 for many frames (the ±14 window can't track a jump);
  // AIController anchors its steering to progress01, so a stale lattice
  // corrupted the AI's race-progress reference. 12m ≈ 4-5 samples: far
  // enough to never fire in normal driving, tight enough to re-anchor
  // progress01 instantly after a launch / shove / respawn.
  if (bestD > 144) {
    // teleported/respawned far away — full scan.
    // AUDIT r11 (FECO BUG REPORT — 'os adversarios começam a correr para
    // trás'): a PURE distance scan picks the nearest sample IN SPACE, which
    // on a curved loop can be a DIFFERENT track segment (a 30m+ lateral
    // offset can land physically closer to a segment whose tangent points
    // the OPPOSITE way). That corrupts progress01 → the AI anchors its
    // steering to the wrong segment and the kart does a wrong-way dance.
    // When the kart is MOVING, prefer the nearest sample whose tangent
    // aligns with its heading (race progress always lives on the segment
    // the kart is following); fall back to the raw nearest only if no
    // aligned sample exists (e.g. a stationary respawn).
    const st = kart.state || {};
    const fwd = { x: Math.sin(st.heading || 0), y: Math.cos(st.heading || 0) };
    let bestAlt = -1;
    let bestAltD = Infinity;
    for (let i = 0; i < N; i++) {
      const d = horizontalDistanceSquared(samples.pos[i], p);
      if (d < bestD) { bestD = d; best = i; }
      if (Math.abs(st.speed || 0) > 2) {
        const dot = samples.tan[i].x * fwd.x + samples.tan[i].z * fwd.y;
        if (dot > 0.3 && d < bestAltD) { bestAltD = d; bestAlt = i; }
      }
    }
    if (bestAlt >= 0) { best = bestAlt; bestD = bestAltD; }
  }
  // Project onto the continuous pair of neighboring road segments rather
  // than snapping the road height and heading to a ~3m-wide waypoint.
  const near = projectTrackLattice(samples, best, p);
  kart._sampleIndex = near?.idx ?? best;
  return near;
}

function roadHalfWidth(track, t) {
  const w = typeof track.getRoadWidthAt === 'function'
    ? track.getRoadWidthAt(t)
    : CONFIG.track.roadWidth;
  return Math.max(1, w) / 2;
}

function dampAngle(cur, target, lambda, dt) {
  let d = target - cur;
  d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return cur + d * (1 - Math.exp(-lambda * dt));
}

function approach(cur, target, step) {
  if (cur < target) return Math.min(cur + step, target);
  return Math.max(cur - step, target);
}

// Drift auto-fire tiers (audit r2 — MK8D cadence): charge beeps at 0.33/0.66;
// holding at full charge for the grace window AUTO-RELEASES a full mini-boost
// without manual release (re-holding chains the next drift).
const DRIFT_TIER_1 = 0.33;
const DRIFT_TIER_2 = 0.66;
const DRIFT_TIER_3 = 0.9; // AUDIT r9: MK8D's third (purple) spark tier
const DRIFT_AUTO_FIRE_GRACE = 0.7; // seconds at full charge before auto-fire
// (audit r3: 0.5 made full-charge chains too easy; MK8D cadence ~2.6s total)
const DRIFT_AUTO_BOOST_MS = 750;   // auto-fire boost (matches full-charge manual)

function updateDrift(kart, input, dt, speedAbs) {
  const s = kart.state;
  const P = CONFIG.physics;
  const can = speedAbs >= P.driftMinSpeed && !s.spinOut;
  if (input.drift && can) {
    if (!s.drifting) {
      s.drifting = true;
      s.driftCharge = 0;
      kart._driftFullT = 0;
      kart._driftTier1 = false;
      kart._driftTier2 = false;
      kart._driftTier3 = false; // AUDIT r9: MK8D's third (purple) spark tier
    }
    s.driftCharge = Math.min(1, s.driftCharge + P.driftChargeRate * dt * (1 + Math.abs(input.steer) * 0.6));
    // Charge tiers (audit r2/r9): one-shot spark + beep cue at 0.33 / 0.66 /
    // 0.9 (MK8 spark levels: blue/orange/purple). Tier 3 near full charge
    // rewards the longest holds.
    if (!kart._driftTier1 && s.driftCharge >= DRIFT_TIER_1) {
      kart._driftTier1 = true;
      kart._onDriftTier?.(1);
    } else if (kart._driftTier1 && !kart._driftTier2 && s.driftCharge >= DRIFT_TIER_2) {
      kart._driftTier2 = true;
      kart._onDriftTier?.(2);
    } else if (kart._driftTier2 && !kart._driftTier3 && s.driftCharge >= DRIFT_TIER_3) {
      kart._driftTier3 = true;
      kart._onDriftTier?.(3);
    }
    // Full charge: short grace window, then AUTO-RELEASE a full mini-boost
    // without manual release (MK8D: holding past the top fires the turbo for
    // you; still holding re-enters the drift and chains).
    if (s.driftCharge >= 1) {
      kart._driftFullT = (kart._driftFullT || 0) + dt;
      if (kart._driftFullT >= DRIFT_AUTO_FIRE_GRACE) {
        kart.applyBoost(DRIFT_AUTO_BOOST_MS);
        kart._onMiniBoost?.(1); // drama hook (SFX + spark burst) wired in main.js
        s.drifting = false;
        s.driftCharge = 0;
        kart._driftFullT = 0;
        kart._driftTier1 = false;
        kart._driftTier2 = false;
      }
    }
  } else if (s.drifting) {
    if (s.driftCharge >= P.driftReleaseBoost) {
      // Charge-scaled mini-boost (was a fixed 750ms): full charge = full kick,
      // partial = short kick — risk/reward on how long you hold the drift.
      const charge01 = Math.min(1, s.driftCharge);
      const ms = Math.round(300 + charge01 * 450); // 300..750ms
      kart.applyBoost(ms);
      kart._onMiniBoost?.(charge01); // drama hook (SFX + spark burst) wired in main.js
    } else if (s.driftCharge > 0.15) {
      // Sub-threshold release: no boost, so NO boost feedback (AUDIT MED:
      // the old cue played mini-boost SFX + gold sparks while applyBoost
      // never ran — a fake reward. MK8D keeps sub-threshold releases quiet.)
    }
    s.drifting = false;
    s.driftCharge = 0;
    kart._driftFullT = 0;
    kart._driftTier1 = false;
    kart._driftTier2 = false;
  }
}

function updateLap(kart, near) {
  const s=kart.state,p=near.progress01;
  const facing=_fwd.set(Math.sin(s.heading),0,Math.cos(s.heading));
  const aligned=facing.dot(kart._startDir)>0.35;
  const result=advanceLapCheckpoint(kart._lapCheckpoint||0,kart._lastProgress,p,aligned,Math.abs(s.speed));
  kart._lapCheckpoint=result.stage;
  kart._lastProgress=p;
  if(result.completed&&!kart.finished){
    s.lap+=1;
    kart._onLap?.({lap:s.lap});
  }
}

function heading2d(kart) {
  const h = kart.state.heading;
  return { x: Math.sin(h), z: Math.cos(h) };
}

export class KartPhysics {
  /**
   * Advance one kart by dt seconds.
   * @param {object} kart  — Kart instance (state + group + effect hooks)
   * @param {object} input — { steer, throttle, brake, drift, useItem }
   * @param {number} dt    — seconds
   * @param {object} track — { path, startLine, getRoadWidthAt? }
   */
  static step(kart, input, dt, track, raceManager) {
    if (!track || !track.path || dt <= 0) return;
    const s = kart.state;
    const P = CONFIG.physics;
    const T = CONFIG.track;

    const samples = ensureSamples(kart, track);
    const near = nearestSample(kart, samples);
    const halfW = roadHalfWidth(track, near.t);
    // Guardrail visual center = road half-width + 0.45m (TrackBuilder).
    // Reserve the kart's outer wheel radius before that center: constraining
    // only the kart origin let the outside wheel/body pierce the rail.
    // Use the WIDTH OF THIS ROAD SEGMENT, not CONFIG.track.roadWidth.
    // Wide straights previously inherited the narrow section's invisible
    // wall, bouncing a kart ~1.5m inside the visible asphalt.
    const wallAt = Math.max(0.9, halfW - 0.16);
    // AUDIT r18-FIX: off-road karts ride the rolling terrain — the path
    // samples are flat; beyond the corridor the field rolls ±5m and a kart
    // shoved into the grass would bury or float up to 5m without this.
    if (Math.abs(near.lateralDist) > halfW + 0.5) {
      // AUDIT (user: 'still sinks a little'): the dirt SHOULDER ribbon is
      // visible at p.y + 0.14 (buildRoadRibbon yOffset 0.14, PATH-RELATIVE),
      // but off-road karts rode the terrain (-0.05) → below the shoulder.
      // Ride the shoulder while on it, then the terrain beyond it.
      // AUDIT 2026-09-04: groundY was an ABSOLUTE 0.14 — on Meadow's hills
      // (path.y up to ~3m) the kart snapped meters below the visible ribbon
      // (single-step probe: err 3.065m HIGH / 0.30m Neon flat). Relative +=
      // mirrors the on-road branch (+= 0.18) and the ribbon builder.
      const shoulderEdge = halfW + 1.7;
      if (Math.abs(near.lateralDist) < shoulderEdge) {
        near.groundY += 0.14;
      } else {
        near.groundY = Math.max(terrainHeight(s.position.x, s.position.z, track.path), near.groundY - 0.3); // AUDIT: hard clamp — never more than 0.3m below the path (karts used to dive 0.6m) // near.groundY IS sp.y (from nearestSample) — sp is not in step scope
      }
    } else {
      // ON-ROAD: the visible road ribbon sits at path.y + 0.18 (buildRoadRibbon
      // yOff). Without this offset the kart body sank 0.18m INTO the asphalt,
      // and the MK8 banking (8deg roll) pushed the outer wheel ~0.4m below the
      // surface in corners — the reported 'falling into the subsoil'.
      near.groundY += 0.18; // sp.y (the path height) was already in groundY from nearestSample
    }

    s.progress01 = near.progress01;
    updateLap(kart, near);

    // Turbo pads: within 0.015 of a pad's t (and not already boosting) →
    // start a 1.2s turbo. Guarded so it only fires once per pass (the
    // timer outlasts the trigger window while the kart crosses the pad).
    // AUDIT r5: dropped the `!s.boost` gate — MK8D pads fire even mid-boost
    // (a drift-boost pass over a pad used to get nothing).
    if (track.turboPads && track.turboPads.ts && s.turboBoostMs <= 0) {
      for (let i = 0; i < track.turboPads.ts.length; i++) {
        if (Math.abs(s.progress01 - track.turboPads.ts[i]) <= 0.015) {
          s.turboBoostMs = 1200;
      kart._onTurboBoost?.();
          break;
        }
      }
    }

    const tan = near.tan;
    const speedAbs = Math.abs(s.speed);

    // ---- wrong-way detection ----
    const headingSin = Math.sin(s.heading);
    const headingCos = Math.cos(s.heading);
    const dot = headingSin * tan.x + headingCos * tan.z;
    const wrongWayThreshold = -0.2;
    const minSpeed = 2.0;
    const wrongWayTimeNeeded = 0.55;
    const cooldownTime = 2.0;
    if (dot < wrongWayThreshold && speedAbs > minSpeed) {
      s.wrongWayTimer = Math.min(s.wrongWayTimer + dt, wrongWayTimeNeeded);
    } else {
      s.wrongWayTimer = Math.max(s.wrongWayTimer - dt * 2, 0);
    }
    if (s.wrongWayCooldown > 0) {
      s.wrongWayCooldown = Math.max(s.wrongWayCooldown - dt, 0);
    }
    if (s.wrongWayTimer >= wrongWayTimeNeeded && s.wrongWayCooldown <= 0) {
      s.wrongWayCooldown = cooldownTime;
      s.wrongWayTimer = 0;
      kart._onWrongWay?.();
    }
    const fwd = _fwd.set(Math.sin(s.heading), 0, Math.cos(s.heading));
    const right = _right.set(tan.z, 0, -tan.x);

    // ---- steering ---------------------------------------------------------
    if (s.spinOut) {
      s.heading += kart._spinDir * 8.5 * dt;
      s.speed = approach(s.speed, 0, 20 * dt);
      s.drifting = false;
    } else {
      const speed01 = Math.min(1, speedAbs / P.maxSpeed);
      let rate = P.steerSpeed + (P.steerSpeedLow - P.steerSpeed) * (1 - speed01);
      if (s.drifting) rate = playerDriftSteerRate(P.driftSteer, kart.isPlayer, kart._gripMode);
      if (kart._airTime > 0.05) rate *= P.airControl * 0.4; // reduced control airborne
      const steerSign = s.speed < 0 ? -1 : 1;
      const steerEff = input.steer * steerSign * (speedAbs > 0.25 ? 1 : 0.3);
      // NOTE: heading += would turn LEFT on positive steer (Three.js right-hand
      // rule: forward +Z, right = -X). Invert so +steer = right turn.
      s.heading -= steerEff * rate * dt;
      // gentle pull toward the path tangent (forgiving handling, helps AI)
      const tanAngle = Math.atan2(tan.x, tan.z);
      // Off-road: weaken the pull so the player can steer BACK to the track
      // (a strong pull keeps the kart running parallel in the grass forever).
      // On-road path pull: reduced from 0.45 → 0.18 (auditor: 0.45 auto-steered
      // the kart and masked steering feel; 0.18 lets the player hold a racing
      // line while still recentering after a bump). Off-road 0.1 unchanged.
      // AUDIT R49 (Feco mobile 2026-08-14: 'direção forçada com assist off'):
      // o pull rodava SEMPRE (inclusive player com steerAssist=false — no
      // mobile o toque fraco era dominado e o kart parecia dirigir sozinho).
      // kart._disablePathPull é setado pelo main.js = !settings.steerAssist
      // (só o player); AIs mantêm o pull normal.
      const pull = kart._disablePathPull ? 0 : s.offRoad ? 0.1 : s.drifting ? 0.2 : 0.18;
      s.heading = dampAngle(s.heading, tanAngle, pull, dt);
      updateDrift(kart, input, dt, speedAbs);
    }

    // ---- speed -------------------------------------------------------------
    let target = (s.boost || s.turboBoostMs > 0) ? P.boostSpeed : (kart.cruiseSpeed || P.maxSpeed);
    // Lightning: victims are shrunk AND slowed. The slow uses the DEDICATED
    // _slowFactor (set only by lightning) — the visual _scaleTarget squash
    // (landing/wall/banana/shell) must NEVER tax speed (AUDIT HIGH-1).
    if (kart._slowMs > 0) {
      target *= kart._slowFactor;
    }
    // Slipstream/drafting (MK8 core comeback): a kart riding in the wake of
    // another (same heading, behind by ~1-3m, lateral < 2.2m) gets a +8% top
    // speed ramp. Disabled while boosting or spinning.
    s.draft = false;
    if (!s.boost && !s.spinOut && !kart.finished && raceManager && raceManager.karts) {
      const heading = heading2d(kart);
      for (const other of raceManager.karts) {
        if (other === kart || other.finished) continue;
        const op = other.state.position;
        const dx = op.x - s.position.x;
        const dz = op.z - s.position.z;
        // same heading (dot > 0.95) and the other kart is AHEAD on that heading
        const dot = heading.x * dx + heading.z * dz;
        if (dot < 1.0) continue; // must be ahead (and roughly in front)
        const dist = Math.hypot(dx, dz);
        if (dist > 4.0 || dist < 0.6) continue;
        // lateral offset: perpendicular distance to the leader's line
        const px = heading.z * dx - heading.x * dz;
        if (Math.abs(px) > 2.2) continue;
        // leader must be moving (so drafting means catching up)
        if (other.state.speed < 2) continue;
        s.draft = true;
        target *= 1.08;
        break;
      }
    }
    // Draft-exit boost (audit v4 LOW / v5 #3): leaving a wake gives a real
    // slingshot (600ms) with a cooldown so it can't be chained.
    if (!s.draft && kart._wasDrafting && !s.spinOut) {
      const now = raceManager ? raceManager.elapsed : 0;
      if (!kart._lastDraftExit || now - kart._lastDraftExit > 3) {
        // AUDIT r5: draft exit-kick is PLAYER-only — AI trains used to chain
        // free 600ms boosts, quietly widening the rubber band.
        if (!kart.isPlayer) {
          kart._wasDrafting = false;
        } else {
          kart._lastDraftExit = now;
          kart.applyBoost(600);
          kart._onDraftExit?.();
        }
      }
    }
    kart._wasDrafting = s.draft;
    s.offRoad = Math.abs(near.lateralDist) > halfW;
    // AUDIT r5: boost ignores terrain slowdown (MK8D) — a drift-boost/star
    // carry over grass no longer gets cut by the 0.45× off-road factor.
    if (s.offRoad && !s.boost && s.turboBoostMs <= 0) target *= T.offRoadMaxSpeedFactor;
    // AUDIT r3: off-road exit kick — a grass dive that's actually held pays
    // a small recovery boost back on tarmac (risky lines now have a payoff).
    if (s.offRoad) {
      kart._offRoadT = (kart._offRoadT || 0) + dt;
    } else if (kart._offRoadT > 0) {
      if (kart._offRoadT >= 0.7) {
        const kick = Math.min(360, 120 + kart._offRoadT * 160); // 0.7s→232ms, 1.5s→360ms
        kart.applyBoost(kick);
        kart._onGrassExit?.();
      }
      kart._offRoadT = 0;
    }
    if (s.spinOut) target = 0;

    const maxAbs = Math.abs(target);
    if (!s.spinOut) {
      // AUDIT r5: clamp throttle to 1.0 — AI easing passed >1 (up to 1.35)
      // and KartPhysics scales accel by it, inflating the comeback.
      const thr = Math.min(1, Math.max(0, input.throttle || 0));
      // AUDIT r11-F1 (code + game-design audits): the over-target approach
      // step (14*dt) is SMALLER than full accel (26*dt), so full-throttle
      // speed crept PAST maxSpeed indefinitely (sim: 86-113 m/s vs 42) —
      // the cap leaked, the rubber-band/coin ceiling (cruiseSpeed ≤ ~47) was
      // meaningless and rivals became rockets. Gate accel on the cap: once
      // at/over target speed, only friction + approach act (hard ceiling).
      if (thr > 0.02 && Math.abs(s.speed) < maxAbs) s.speed += P.acceleration * dt * Math.max(0.15, thr); // AI corner-lift 0.3/0.8 scales accel (audit F3)
      if (input.brake) s.speed -= P.braking * dt;
    }
    const fr = P.friction * (s.offRoad ? 1.8 : 1);
    s.speed -= Math.sign(s.speed) * Math.min(speedAbs, fr * dt);
    if (Math.abs(s.speed) > maxAbs) {
      s.speed = approach(s.speed, Math.sign(s.speed) * maxAbs, (s.offRoad ? 22 : 14) * dt);
    }
    if (s.speed < P.reverseSpeed) s.speed = P.reverseSpeed;

    // ---- lateral velocity (drift slide) -------------------------------------
    let lat = kart._latVel || 0;
    lat = lateralVelocityStep({
      lateral: lat, dt, steering: s.spinOut ? 0 : input.steer,
      drifting: s.drifting, isPlayer: kart.isPlayer,
      gripMode: kart._gripMode, normalGrip: P.lateralGrip,
    });
    kart._latVel = lat;

    // ---- integrate position ---------------------------------------------------
    // Integrate the newly steered heading, not the heading from BEFORE the
    // steering step. This removes one physics tick of directional lag.
    _fwd.set(Math.sin(s.heading), 0, Math.cos(s.heading));
    _right.set(Math.cos(s.heading), 0, -Math.sin(s.heading));
    _move.copy(_fwd).multiplyScalar(s.speed).addScaledVector(_right, lat);
    s.position.addScaledVector(_move, dt);
    if (kart._nudgeVel && kart._nudgeVel.lengthSq() > 1e-6) {
      s.position.addScaledVector(kart._nudgeVel, dt);
      kart._nudgeVel.multiplyScalar(Math.exp(-3.5 * dt));
      if (kart._nudgeVel.lengthSq() < 0.002) kart._nudgeVel.set(0, 0, 0);
    }

    // ---- wall bounce at road edge + grass margin -------------------------------
    // Collision reference is progress-anchored, not the nearest point in
    // space. Neon hairpins bring separate track segments close together; a
    // pure nearest-point lookup can select the wrong segment and trigger a
    // false rail bounce while the kart is visually centered.
    const progressGuess = ((s.progress01 + (s.speed * dt) / samples.total) % 1 + 1) % 1;
    // Continuous post-integration boundary avoids ±1 sample oscillations
    // in the normal on hairpins, which looked like an invisible rock.
    const progressPoint = track.path.getPointAt(progressGuess);
    const progressTan = track.path.getTangentAt(progressGuess);
    const postRight = _right.set(progressTan.z, 0, -progressTan.x);
    const lateralDist = _tmp.copy(s.position).sub(progressPoint).dot(postRight);
    kart._wallReportCooldown = Math.max(0, (kart._wallReportCooldown || 0) - dt);
    if (Math.abs(lateralDist) > wallAt) {
      const overshoot = Math.abs(lateralDist) - wallAt;
      if (overshoot > 0.06 && kart._wallReportCooldown <= 0) {
        kart._onPhysicsEvent?.({
          type:'wall', overshoot, speed:s.speed, progress:s.progress01,
          lateral:lateralDist, wallAt,
        });
        kart._wallReportCooldown = 0.4;
      }
      // Correct only actual penetration. A 1.2x overshoot correction,
      // severe speed penalties and rapid steering produced visible
      // side-to-side jitter on iPhone at every curved guardrail.
      s.position.addScaledVector(postRight, -Math.sign(lateralDist) * (overshoot + 0.015));
      kart._latVel = -lat * Math.min(0.25, P.collisionBounce);
      s.speed *= Math.max(0.82, 1 - overshoot * 0.12);
      if (overshoot > 0.18) {
        s.heading = dampAngle(s.heading, Math.atan2(progressTan.x, progressTan.z), 3, dt);
        kart._bounce = Math.min(1, overshoot * 0.4);
        kart._bounceTimer = 0.15;
      }
    }

    // ---- height / gravity / Mario Kart Ramp & Jump Physics --------------------
    // Fixed ramp physics:
    // 1. Projects onto the normalized 2D ramp axis (dirX, dirZ) so longitudinal
    //    `along` and `lateral` distances are exact even on hilly track sections.
    // 2. Supports the full ramp width (`halfW + 0.65m`) instead of the old
    //    broken `dx*dx + dz*dz < 7.3` circular check that missed outer lanes.
    // 3. Smoothly climbs the wedge from `-halfL` up to the launch zone
    //    (`along >= halfL * 0.45`), then triggers a clean upward launch (`vY`)
    //    with a cooldown so the rising ramp surface does not immediately re-ground
    //    the kart on the next frame.
    const baseGroundY = near.groundY + kart.rideHeight;
    s.groundY = baseGroundY;
    kart._rampLaunchCooldown = Math.max(0, (kart._rampLaunchCooldown || 0) - dt);
    let rampLift = 0;
    let onRampNow = false;
    let activeRampSlope = 0;
    let launchRamp = null;
    let launchAlong = 0;
    let launchLateral = 0;
    let launchIndex = -1;

    if (track.ramps && track.ramps.length) {
      for (let ri = 0; ri < track.ramps.length; ri++) {
        const r = track.ramps[ri];
        const rdx = s.position.x - r.point.x;
        const rdz = s.position.z - r.point.z;
        const dirLen = Math.hypot(r.dir.x, r.dir.z) || 1;
        const dirX = r.dir.x / dirLen;
        const dirZ = r.dir.z / dirLen;
        const along = rdx * dirX + rdz * dirZ;
        const lateral = Math.abs(rdx * dirZ - rdz * dirX);
        const rLen = r.length ?? 5.4;
        const rHeight = r.height ?? 1.15;
        const halfL = rLen / 2;
        const halfW = (r.width ?? CONFIG.track.roadWidth * 0.84) / 2;

        if (along >= -halfL - 0.45 && along <= halfL + 0.75 && lateral <= halfW + 0.65) {
          const climb = Math.max(0, Math.min(1, (along + halfL) / (halfL * 2)));
          const lift = rHeight * climb;
          if (lift >= rampLift) {
            rampLift = lift;
            activeRampSlope = rHeight / rLen;
          }
          onRampNow = true;
          if (!kart._wasOnRamp && kart.isPlayer) {
            zarioLogger.recordRampClimb('player', {
              rampIndex: ri,
              along: Math.round(along * 100) / 100,
              lateral: Math.round(lateral * 100) / 100,
              climb: Math.round(climb * 100) / 100,
              rampLift: Math.round(lift * 100) / 100,
              speed: Math.round(s.speed * 100) / 100,
            });
          }
          // Trigger launch when reaching the upper half of the ramp while moving forward
          if (along >= halfL * 0.42 && s.speed > 4.5 && kart._rampLaunchCooldown <= 0) {
            launchRamp = r;
            launchAlong = along;
            launchLateral = lateral;
            launchIndex = ri;
          }
        }
      }
    }
    kart._wasOnRamp = onRampNow;

    // While actively ascending in the first 0.26s after a ramp launch, compare
    // against baseGroundY so the ramp's front lip never snags the ascending kart.
    const effectiveGroundY =
      kart._rampLaunchCooldown > 0.16 && s.vY > 0 ? baseGroundY : baseGroundY + rampLift;

    if (launchRamp && s.position.y <= baseGroundY + rampLift + 0.35) {
      const rLen = launchRamp.length ?? 5.4;
      const rHeight = launchRamp.height ?? 1.15;
      const slopeRatio = rHeight / rLen;
      const launchVy = Math.max(8.8, Math.min(13.2, Math.abs(s.speed) * slopeRatio + 6.4));
      s.vY = launchVy;
      // Lift the kart cleanly to lip height + clearance so it enters the airborne arc
      s.position.y = Math.max(s.position.y + 0.14, baseGroundY + rHeight + 0.12);
      s.onRamp = true;
      s.rampSlope = slopeRatio;
      kart._rampLaunchCooldown = 0.45;
      kart._airTime = Math.max(kart._airTime || 0, 0.04);
      kart._peakAirHeight = rHeight + 0.12;
      // Mario Kart ramp dash boost on launch
      const rampBoostMs = 480;
      kart.applyBoost?.(rampBoostMs);
      // Auto-arm trick if player is holding drift/hop or throttle on the ramp lip
      if (input.drift || input.throttle) {
        kart._trickArmed = true;
        if (!kart._trickAnimT || kart._trickAnimT <= 0) {
          kart._trickAnimT = 0.001;
          kart._trickCount = (kart._trickCount || 0) + 1;
          kart._trickType = kart._trickCount % 2 === 0 ? 'roll' : 'flip';
          if (kart.isPlayer) {
            zarioLogger.recordTrick('player', {
              phase: 'start',
              trickType: kart._trickType,
              speed: Math.round(s.speed * 100) / 100,
              vY: Math.round(launchVy * 100) / 100,
            });
          }
        }
      }
      kart._onPhysicsEvent?.({
        type: 'rampLaunch',
        speed: s.speed,
        vY: launchVy,
        along: launchAlong,
        lateral: launchLateral,
        boostMs: rampBoostMs,
        rampIndex: launchIndex,
      });
      if (kart.isPlayer && !kart._onPhysicsEvent) {
        zarioLogger.recordRampLaunch('player', {
          speed: s.speed,
          vY: launchVy,
          along: launchAlong,
          lateral: launchLateral,
          boostMs: rampBoostMs,
          rampIndex: launchIndex,
        });
      }
    } else if (onRampNow && kart._rampLaunchCooldown <= 0) {
      s.onRamp = true;
      s.rampSlope = activeRampSlope;
      // Keep momentum climbing the ramp slope
      if (input.throttle && s.speed > 0 && s.speed < P.maxSpeed * 0.92) {
        s.speed = Math.min(P.maxSpeed, s.speed + P.acceleration * 0.45 * dt);
      }
    }

    if (s.position.y > effectiveGroundY + 0.05 || (kart._rampLaunchCooldown > 0.2 && s.vY > 0)) {
      // Airborne trajectory
      s.vY += P.gravity * dt;
      s.position.y += s.vY * dt;
      kart._airTime = (kart._airTime || 0) + dt;
      const heightAboveRoad = s.position.y - baseGroundY;
      if (heightAboveRoad > (kart._peakAirHeight || 0)) {
        kart._peakAirHeight = heightAboveRoad;
      }
      if (s.position.y <= effectiveGroundY && s.vY <= 0) {
        s.position.y = effectiveGroundY;
        s.vY = 0;
        const landedAirTime = kart._airTime;
        const peakH = kart._peakAirHeight || 0;
        if (landedAirTime > 0.05) {
          kart._scaleTarget = 0.91; // landing squash
          kart._scaleMs = Math.max(kart._scaleMs, 260);
          kart._onLand?.(); // landing thump hook
          if (kart.isPlayer) {
            zarioLogger.recordAirLanding('player', {
              airTime: landedAirTime,
              peakHeight: peakH,
              trickBoost: !!kart._trickArmed,
            });
          }
        }
        kart._airTime = 0;
        kart._peakAirHeight = 0;
        s.onRamp = false;
        s.rampSlope = 0;
      }
    } else {
      s.position.y = effectiveGroundY;
      s.vY = 0;
      kart._airTime = 0;
      kart._peakAirHeight = 0;
      if (!onRampNow) {
        s.onRamp = false;
        s.rampSlope = 0;
      }
      // squash rolling off a fast drop
      if (effectiveGroundY < kart._prevY - 0.16) {
        kart._scaleTarget = 0.94;
        kart._scaleMs = Math.max(kart._scaleMs, 240);
      }
    }
    kart._prevY = effectiveGroundY;

    // ---- squash & stretch -------------------------------------------------------
    if (kart._scaleMs > 0) kart._scaleMs -= dt * 1000;
    else kart._scaleTarget = 1;
    if (kart._slowMs > 0) kart._slowMs -= dt * 1000;
    else kart._slowFactor = 1;
    // AUDIT (power-up audit, 2026-08-11): apply the lightning shrink on ALL
    // three axes (interpolated, so the shrink eases in and the recovery pops
    // back up), instead of force-resetting x/z to 1 (Y-only pancake).
    if (kart._shrinkMs > 0) kart._shrinkMs -= dt * 1000;
    else kart._shrinkScale = 1;
    const sh = kart._shrinkScale || 1;
    const sy = kart.group.scale.y;
    kart.group.scale.y = sy + (kart._scaleTarget - sy) * Math.min(1, 10 * dt);
    const sx = kart.group.scale.x;
    const nx = sx + (sh - sx) * Math.min(1, 10 * dt);
    kart.group.scale.x = nx;
    kart.group.scale.z = nx;

    if (kart._bounceTimer > 0) kart._bounceTimer -= dt;
    else kart._bounce = 0;

    // keep heading in a sane range
    s.heading = ((s.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }
}

/** Bare-function alias for callers that prefer a plain step(). */
export const step = (kart, input, dt, track) => KartPhysics.step(kart, input, dt, track);
