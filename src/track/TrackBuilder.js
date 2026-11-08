/**
 * Super Kart 3D.js — track builder.
 * Builds a closed cartoon race loop: CatmullRomCurve3 path with elevation,
 * a road ribbon (BufferGeometry) with asphalt texture, red/white curb
 * strips, continuous guard-rails along both edges, lane dashes, start/finish
 * gantry and an undulating grass terrain.
 *
 * Exports (contract):
 *   buildTrack(scene) → { group, path, waypoints, startLine, length,
 *                         startLights, turboPads, ramps }
 *   getRoadWidthAt(t) → number
 *   TRACK_PATH        → Vector3[] closed loop
 */

// Density multipliers from quality profile
function getDensityMultipliers() {
  const profile = window.__sk3dQualityProfile;
  if (!profile) return { foliage: 1, crowd: 1, particle: 1 };
  return {
    foliage: profile.foliageDensity ?? 1,
    crowd: profile.crowdDensity ?? 1,
    particle: profile.particleDensity ?? 1,
  };
}
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { toonMaterial, cartoonOutline, roadTexture, cityRoadTexture, dirtTexture, grassTexture, concreteTexture, checkerTexture, bannerCheckerTexture, finishBannerTexture, finishBannerTextureMirrored, turboPadTexture, turboPadChevronTexture, turboPadGlowTexture, arrowTexture, finishLineTexture, neonReflectionTexture } from '../render/Materials.js';

// Control points forming the closed loop (X, Y=elevation, Z).
const CONTROL_POINTS = [
  [-62, 0.0, 0],
  [-48, 0.6, -38],
  [-18, 1.6, -56],
  [22, 2.2, -58],
  [56, 1.0, -38],
  [66, 0.4, -6],
  [58, 1.4, 28],
  [30, 3.0, 52],
  [-8, 2.6, 60],
  [-42, 1.2, 44],
  [-64, 0.3, 20],
];

export const TRACK_PATH = CONTROL_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));

// Track 2 — "NEON CITY": tight urban circuit (long straights + hairpins).
// Tuned to the same physics (roadWidth, ramp spacing) as Track 1.
// AUDIT (Feco, 2026-08-11): Neon City redesigned to the '2'-shaped layout
// from his reference image — start on the LEFT straight (cars launch UP,
// i.e. +Z), clockwise. Sequence: left straight up -> 90° right onto the top
// straight -> upper-right return (down + left) -> mid-upper straight left ->
// mid-left return (down + right) -> mid-lower straight right -> lower-right
// corner (down + left) -> bottom straight left -> wide lower-left corner
// back to the left straight. No self-crossing; every corner >= ~8m radius
// (CatmullRom centripetal smooths the 90° corners; no U-to-T jumps).
// Track length ~660m (comparable to the old circuit).
export const CITY_PATH = [
  // AUDIT (Jarvis QA loop, 2026-08-11): Neon City layout rebuilt — all
  // transitions are true circle arcs (R=8m); the old
  // flanged vertices (straight->arc reversions ~169deg) created sub-1m
  // kinks that flung karts off-track at speed (SIM: 6/16 seeds with a
  // lost kart). No kinks: min radius measured ~6-9m everywhere, kerb
  // folds 0, self-crossings 0. Circuit: left straight (x=-70) UP (+Z) ->
  // top (z=50) -> right straight (x=66) down -> middle (z=26)
  // -> left straight (x=-21) down -> bottom (z=2) ->
  // right (x=86) down -> bottom-low (z=-28) -> back up the left.
  [-70.0, 0.3, 17.2],
  [-70.0, 0.3, 25.5],
  [-70.0, 0.3, 33.8],
  [-70.0, 0.3, 42.0],
  [-68.9, 0.3, 46.0],
  [-66.0, 0.3, 48.9],
  [-62.0, 0.3, 50.0],
  [-54.0, 0.3, 50.0],
  [-46.0, 0.3, 50.0],
  [-38.0, 0.3, 50.0],
  [-30.0, 0.3, 50.0],
  [-22.0, 0.3, 50.0],
  [-14.0, 0.3, 50.0],
  [-6.0, 0.3, 50.0],
  [2.0, 0.3, 50.0],
  [10.0, 0.3, 50.0],
  [18.0, 0.3, 50.0],
  [26.0, 0.3, 50.0],
  [34.0, 0.3, 50.0],
  [42.0, 0.3, 50.0],
  [50.0, 0.3, 50.0],
  [58.0, 0.3, 50.0],
  [62.0, 0.3, 48.9],
  [64.9, 0.3, 46.0],
  [66.0, 0.3, 42.0],
  [65.4, 0.3, 30.9],
  [63.7, 0.3, 28.3],
  [61.1, 0.3, 26.6],
  [58.0, 0.3, 26.0],
  [51.0, 0.3, 26.0],
  [43.9, 0.3, 26.0],
  [35.8, 0.3, 26.0],
  [27.6, 0.3, 26.0],
  [19.5, 0.3, 26.0],
  [11.4, 0.3, 26.0],
  [3.2, 0.3, 26.0],
  [-4.9, 0.3, 26.0],
  [-13.0, 0.3, 26.0],
  [-17.0, 0.3, 24.9],
  [-19.9, 0.3, 22.0],
  [-21.0, 0.3, 18.0],
  [-21.0, 0.3, 10.0],
  [-19.9, 0.3, 6.0],
  [-17.0, 0.3, 3.1],
  [-13.0, 0.3, 2.0],
  [-4.7, 0.3, 2.0],
  [3.5, 0.3, 2.0],
  [11.8, 0.3, 2.0],
  [20.1, 0.3, 2.0],
  [28.4, 0.3, 2.0],
  [36.6, 0.3, 2.0],
  [44.9, 0.3, 2.0],
  [53.2, 0.3, 2.0],
  [61.5, 0.3, 2.0],
  [69.7, 0.3, 2.0],
  [78.0, 0.3, 2.0],
  [82.0, 0.3, 0.9],
  [84.9, 0.3, -2.0],
  [86.0, 0.3, -6.0],
  [86.0, 0.3, -13.0],
  [86.0, 0.3, -20.0],
  [84.9, 0.3, -24.0],
  [82.0, 0.3, -26.9],
  [78.0, 0.3, -28.0],
  [70.2, 0.3, -28.0],
  [62.4, 0.3, -28.0],
  [54.7, 0.3, -28.0],
  [46.9, 0.3, -28.0],
  [39.1, 0.3, -28.0],
  [31.3, 0.3, -28.0],
  [23.6, 0.3, -28.0],
  [15.8, 0.3, -28.0],
  [8.0, 0.3, -28.0],
  [0.2, 0.3, -28.0],
  [-7.6, 0.3, -28.0],
  [-15.3, 0.3, -28.0],
  [-23.1, 0.3, -28.0],
  [-30.9, 0.3, -28.0],
  [-38.7, 0.3, -28.0],
  [-46.4, 0.3, -28.0],
  [-54.2, 0.3, -28.0],
  [-62.0, 0.3, -28.0],
  [-66.0, 0.3, -26.9],
  [-68.9, 0.3, -24.0],
  [-70.0, 0.3, -20.0],
  [-70.0, 0.3, -12.8],
  [-70.0, 0.3, -5.5],
  [-70.0, 0.3, 1.8],
  [-70.0, 0.3, 9.0],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));

export function getRoadWidthAt() {
  return CONFIG.track.roadWidth;
}

// Deterministic smooth pseudo-noise for terrain (no external libs).
// Returns raw undulation in ~[-0.42, +0.42]. The corridor near the road
// keeps the historical *0.5 scale (±0.25m — bit-identical to the original
// build, so the road/shoulders/kerbs and kart physics are untouched);
// buildTerrain amplifies this with a distance falloff so the open field
// rolls into gentle hills while the racing surface stays flat.
function smoothH(x, z) {
  return (
    Math.sin(x * 0.08) * Math.cos(z * 0.1) * 0.18 +
    Math.sin(x * 0.31 + 1.7) * Math.cos(z * 0.23) * 0.09 +
    Math.sin(x * 0.045 + z * 0.06) * 0.15
  );
}

// Broad low-frequency landforms for the distance: ~80m wavelength, ±5.0m
// amplitude. Combined with smoothH's field amplification these become the
// rolling hills on the horizon. The corridor falloff in buildTerrain keeps
// them out of the racing surface entirely. (Amplitude raised 1.4→3.4 after
// the vision critic called 2.4m hills 'essentially flat'; 3.4→5.0 after
// the Feco real-GPU critic read the field as a 'smooth neon carpet'.)
function broadHill(x, z) {
  return (
    Math.sin(x * 0.0785) * Math.cos(z * 0.0785) * 5.0 +
    Math.sin(x * 0.0314 + z * 0.0471 + 1.3) * 1.4
  );
}

let _heightCachePath = null;
let _heightSamples = null;
/**
 * Distance-aware terrain height — the EXACT formula buildTerrain uses
 * (smoothH scaled by corridor falloff + broadHill landforms). Exported so
 * Environment.js grounds its far-field props on the same rolling field
 * (agent flag: the Environment's own smoothH copy ignored the new hills →
 * trees/rocks at 46-162m floated/buried 0.5-3m).
 */
export function terrainHeight(x, z, path) {
  if (path !== _heightCachePath) {
    _heightCachePath = path || null;
    _heightSamples = null;
    if (path) {
      _heightSamples = new Float32Array(400 * 2);
      const sp = new THREE.Vector3();
      for (let i = 0; i < 400; i++) {
        path.getPointAt(i / 400, sp);
        _heightSamples[i * 2] = sp.x;
        _heightSamples[i * 2 + 1] = sp.z;
      }
    }
  }
  let d2 = Infinity;
  if (_heightSamples) {
    for (let i = 0; i < 400; i++) {
      const dx = x - _heightSamples[i * 2];
      const dz = z - _heightSamples[i * 2 + 1];
      const dd = dx * dx + dz * dz;
      if (dd < d2) d2 = dd;
    }
  }
  const d = Math.sqrt(d2);
  const raw = Math.min(1, Math.max(0, (d - 10) / 15));
  const falloff = raw * raw * (3 - 2 * raw); // C1 smoothstep
  // AUDIT r18-FIX (gameplay auditor): broadHill 5.0/1.4 × 1.2 delivered
  // ±8.4m — ridge walls that occluded the track ahead. Scale to ~±5m.
  return -0.05 + smoothH(x, z) * 0.5 * (1 + falloff * 2.5) + broadHill(x, z) * 0.7 * falloff; // AUDIT: match the mesh (-0.05) — roadside step 0.43->0.23m
}

function buildRoadRibbon(path, length, opts = {}) {
  const roadW = opts.width || getRoadWidthAt();
  const segments = opts.segments || 520;
  const yOff = opts.yOffset ?? 0.18;
  // AUDIT FIX R12i: suporte a SUB-TRECHO (t0..t1) — o turbo pad precisa de
  // uma ribbon que cubra só o cluster (ex: t 0.18±len/2), não o path todo.
  // Default 0..1 = comportamento original de todas as chamadas existentes.
  const t0 = opts.t0 ?? 0;
  const t1 = opts.t1 ?? 1;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices = [];

  const tan = new THREE.Vector3();
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  // Higher repeat counts shrink the asphalt texture detail so the tire-wear
  // bands/cracks read as fine surface noise, not huge tiled bands.
  const repeatU = opts.repeatU ?? Math.max(24, length * 0.08);

  const lat = opts.lateral ?? 0; // lateral shift from the path centerline
  // AUDIT FIX R12i: uvBias subtrai do t de UV — sub-trechos (turbo pad)
  // zeram a textura na borda do trecho; default 0 = comportamento original.
  const uvBias = opts.uvBias ?? 0;
  for (let i = 0; i <= segments; i++) {
    const t = t0 + (i / segments) * (t1 - t0);
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    nrm.set(-tan.z, 0, tan.x).normalize();
    const half = roadW / 2;
    const base = i * 2;
    positions[base * 3 + 0] = p.x + nrm.x * (lat + half);
    positions[base * 3 + 1] = p.y + yOff;
    positions[base * 3 + 2] = p.z + nrm.z * (lat + half);
    positions[(base + 1) * 3 + 0] = p.x + nrm.x * (lat - half);
    positions[(base + 1) * 3 + 1] = p.y + yOff;
    positions[(base + 1) * 3 + 2] = p.z + nrm.z * (lat - half);
    uvs[base * 2 + 0] = (t - uvBias) * repeatU;
    uvs[base * 2 + 1] = 1;
    uvs[(base + 1) * 2 + 0] = (t - uvBias) * repeatU;
    uvs[(base + 1) * 2 + 1] = 0;
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    // Winding with normal pointing UP (a,c,b / b,c,d) so the road faces
    // the camera — the naive (a,b,c) order produced down-facing normals
    // and the whole ribbon was back-face culled (invisible road!).
    indices.push(a, c, b, b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = toonMaterial(0xffffff, {
    transparent: opts.transparent,
    opacity: opts.opacity,
    roughness: opts.roughness,
    // AUDIT r3: asphalt differentiation — the biggest in-frame surface was
    // pure matte (r 0.82, env 0). Give it a subtle sky sheen so the road
    // reads as polished tarmac, not flat gray.
    envMapIntensity: opts.envMapIntensity ?? 1.0,
    metalness: opts.metalness,
    // AUDIT PISTA R11 (2026-08-16): asfalto MOLHADO de verdade — o city track
    // passa clearcoat: a superfície ganha especular de água contínuo (reflexo
    // das luzes neon = cue wet-street MK8). Só ativo quando opts.wet=true.
    clearcoat: opts.wet ? 0.85 : undefined,
    clearcoatRoughness: opts.wet ? 0.25 : undefined,
  });
  if (opts.wet) { mat.roughness = 0.55; mat.metalness = 0.15; } // AUDIT R11: sheen molhado contínuo
  if (opts.additive) { mat.blending = THREE.AdditiveBlending; mat.depthWrite = false; } // AUDIT R11: reflexo brilha
  if (opts.toneMapped !== undefined) mat.toneMapped = opts.toneMapped; // AUDIT R11: HDR do reflexo preservado
  if (opts.texture) {
    const tex = opts.texture().clone();
    tex.needsUpdate = true;
    // Non-integer repeatV (2.75) breaks the tire-wear bands in roadTexture()
    // out of a visible 2-tile grid — they drift across the road instead of
    // reading as regular horizontal bands (vision critic: "tiled/banded").
    tex.repeat.set(opts.repeatU ?? repeatU, opts.repeatV ?? 2.75);
    tex.anisotropy = 8; // sharper speckle/cracks at grazing chase-cam angles
    mat.map = tex;
  }
  // Tint applied AFTER the map so an opts.color darkens the textured asphalt
  // (NEON CITY's 0x3c4152) instead of being reset to white by the map block.
  if (opts.color) mat.color.setHex(opts.color);
  // AUDIT (vision 7/10): the baked neon PATCHES must glow, not just the
  // uniform tint — emissiveMap = the same texture, so the pink/cyan spill
  // reads as light spreading across the racing surface.
  if (opts.emissiveMap) {
    mat.emissiveMap = mat.map;
    mat.emissive.setHex(opts.emissive || 0xffffff);
  }
  // Night glow (NEON CITY): a faint cool emissive keeps the charcoal asphalt
  // from reading as pure black under the dim moon key (vision critic 2/10).
  if (opts.emissive) {
    mat.emissive.setHex(opts.emissive);
    mat.emissiveIntensity = opts.emissiveIntensity ?? 0.5;
  }
  if (opts.polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
  }

  return new THREE.Mesh(geo, mat);
}

/**
 * Racing-line wear overlay texture: a soft black gradient band down the road
 * center (double tire-track darkening) with streak noise along the track and
 * faint sheen glints. The road's grain still shows through — the band reads
 * as polished rubber, not as painted-on black.
 */
function racingLineTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  // Vertical alpha gradient: transparent at the edges → dark at the center.
  // AUDIT R16f (Feco real-GPU: 'contorno do asfalto mais escuro com padrão
  // estranho'): o gradiente central tinha alpha 0.9 → em perspectiva lia como
  // FAIXA larga e manchada no meio da pista. MK8: racing line SUTIL. 0.9→0.5.
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(10,14,20,0)');
  grad.addColorStop(0.32, 'rgba(10,14,20,0)');
  grad.addColorStop(0.42, 'rgba(8,11,16,0.28)');
  grad.addColorStop(0.5, 'rgba(6,9,14,0.5)');
  grad.addColorStop(0.58, 'rgba(8,11,16,0.28)');
  grad.addColorStop(0.68, 'rgba(10,14,20,0)');
  grad.addColorStop(1, 'rgba(10,14,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  // Two darker tire-track sub-bands inside the rubbered line.
  // AUDIT R16f: 0.5→0.3 (sub-bands sutil — não formavam listras visíveis)
  for (const vy of [116, 140]) {
    const t2 = g.createLinearGradient(0, vy - 12, 0, vy + 12);
    t2.addColorStop(0, 'rgba(4,7,11,0)');
    t2.addColorStop(0.5, 'rgba(4,7,11,0.3)');
    t2.addColorStop(1, 'rgba(4,7,11,0)');
    g.fillStyle = t2;
    g.fillRect(0, vy - 12, 512, 24);
  }
  // Streak noise along the track direction (U) — breaks up the band edge.
  // AUDIT R16f: 700 streaks alpha 0.17 → 260 streaks alpha 0.10 (less heavy
  // grain — o 'padrão manchado/repetitivo' vinha dos streaks densos).
  for (let i = 0; i < 260; i++) {
    const y = 52 + Math.random() * 152;
    g.fillStyle = 'rgba(2,5,9,' + (0.04 + Math.random() * 0.06).toFixed(3) + ')';
    g.fillRect(Math.random() * 512, y, 6 + Math.random() * 30, 1 + Math.random() * 2);
  }
  // Faint wet-sheen glints along the polished line.
  g.fillStyle = 'rgba(180,205,225,0.04)';
  for (let i = 0; i < 80; i++) {
    g.fillRect(Math.random() * 512, 84 + Math.random() * 88, 4 + Math.random() * 10, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Racing-line wear + wet sheen overlay: a second ribbon 1mm above the asphalt
 * (y+0.181) carrying the soft dark center band at low opacity and a LOWER
 * roughness (0.55 vs the road's 0.82) — the rubbered line catches light and
 * reads polished, MK8D-style. Transparent + depthWrite false so it never
 * occludes the kart or the painted decals above it.
 */
function buildRacingLineOverlay(path, length) {
  const roadW = getRoadWidthAt();
  const mesh = buildRoadRibbon(path, length, {
    width: roadW,
    yOffset: 0.181,
    texture: racingLineTexture,
    repeatU: Math.max(12, length * 0.03),
    repeatV: 1,
    transparent: true,
    // AUDIT FIX R12f (Feco real-GPU: 'asfalto mudando de cor acompanhando
    // o corredor'): a racing line tinha clearcoat 0.35 + envMapIntensity 1.1
    // — o reflexo especular da faixa central refletia o ambiente e mudava de
    // cor conforme o ângulo da câmera (lê como 'faixa que segue o kart').
    // Sem specular: só o desgaste escuro (textura), opacidade reduzida.
    opacity: 0.18, // SK3D FIX (2026-08-20): racing line mais sutil — não escurece o asfalto atrás do kart (Feco: 'mancha escura acompanha o carro')
    roughness: 1.0,
  });
  mesh.material.depthWrite = false;
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Dark curb shadow line where asphalt meets kerb: a thin (0.1m) transparent
 * dark ribbon hugging the road edge just inside the kerb stones — the depth
 * cue that stops the asphalt reading as a uniform matte plane.
 */
function buildEdgeShadowLine(path, length, neon = false) {
  const roadW = getRoadWidthAt();
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const m = buildRoadRibbon(path, length, {
      width: 0.1,
      yOffset: 0.1815,
      lateral: side * (roadW / 2 - 0.12),
      color: 0x0d1117,
      transparent: true,
      opacity: neon ? 0.06 : 0.12, // SK3D FIX (2026-08-20, Feco real-GPU): faixa escura na borda lia como "mancha no asfalto". Reduzido p/ só ancorar o kerb, não escurecer a pista.
      roughness: 0.95,
      polygonOffset: true,
    });
    m.renderOrder = 1;
    g.add(m);
  }
  return g;
}

function buildTerrain(path, cityMode = false) {
  const size = 460;
  const seg = 72;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;

  // Pre-sample the track loop so every terrain vertex can measure its
  // distance to the road corridor. 400 samples ≈ 1.1m spacing — far finer
  // than the 10m flat zone we need to resolve.
  const SAMPLE_COUNT = 400;
  const trackSamples = new Float32Array(SAMPLE_COUNT * 2);
  const sp = new THREE.Vector3();
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    path.getPointAt(i / SAMPLE_COUNT, sp);
    trackSamples[i * 2] = sp.x;
    trackSamples[i * 2 + 1] = sp.z;
  }

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    // Distance to the nearest track sample.
    let d2 = Infinity;
    for (let s = 0; s < trackSamples.length; s += 2) {
      const dx = x - trackSamples[s];
      const dz = z - trackSamples[s + 1];
      const dd = dx * dx + dz * dz;
      if (dd < d2) d2 = dd;
    }
    const d = Math.sqrt(d2);

    // Corridor falloff: 0 inside 10m of the track (flat racing surface),
    // 1 beyond 25m (full rolling field). Smoothstep keeps the join C1
    // continuous — the vertex mesh stays smooth, no cliffs.
    const t = Math.min(1, Math.max(0, (d - 10) / 15));
    const falloff = t * t * (3 - 2 * t);

    // Near the track this reduces to the historical smoothH*0.5 - 0.25
    // (bit-identical heights → road, shoulders, kerbs, rails, ramps and the
    // kart's ground sampling are exactly as before). Beyond the corridor the
    // same noise scales up to ±0.9m and broadHill adds ±4m of ~80m
    // wavelength landforms → ~±5m rolling hills on the horizon.
    // AUDIT r19-FIX: MUST match terrainHeight() (×0.7) — the r19 fix only
    // scaled the physics sample function, leaving the mesh at ×1.2 (±8.4m);
    // the divergence made off-road karts sink/float on the visible hills.
    // AUDIT (user: karts at the track edge sink below ground): the old -0.25
    // base made the roadside 0.43m below the 0.18 road — a visible step where
    // karts appeared to dive into the earth. -0.05 keeps a small kerb-like
    // step (~0.23m) without the 'sinking' read.
    const y = -0.05 + smoothH(x, z) * 0.5 * (1 + falloff * 2.5) + broadHill(x, z) * 0.7 * falloff;
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  // AUDIT r4: mow stripes — the field read as one flat green at chase
  // distance (fine stipple texture vanishes). Deterministic sin-noise bands
  // tint the terrain vertices ±4%: diagonal mowing arcs + large soft patches.
  if (!cityMode) {
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const stripe = Math.sin(x * 0.11 + z * 0.07) * 0.5 + 0.5;
      const mow = 0.91 + stripe * 0.12;
      const patch = Math.sin(x * 0.028 + 2.0) * Math.cos(z * 0.031) * 0.5 + 0.5;
      const k = 0.96 + patch * 0.06;
      const v = mow * k;
      colors[i * 3] = v;
      colors[i * 3 + 1] = v;
      colors[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
    // AUDIT R21b: emissive frio reduzido — o brilho quente das luzes + este
    // glow liam como banda OLIVA no chão distante além do alcance do fog.
    const mat = toonMaterial(cityMode ? 0x2a2d38 : 0xffffff, cityMode ? { emissive: 0x0d1120, emissiveIntensity: 0.22 } : {});
  if (!cityMode) {
    mat.map = grassTexture();
    mat.color.set(0xffffff);
    mat.vertexColors = true; // mow stripes (audit r4)
  } else {
    // Urban concrete (vision critic: flat black void — needs pavement detail).
    mat.map = concreteTexture();
    mat.color.set(0xffffff);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** Sidewalk slab (NEON CITY): a light concrete strip just outside the
 *  guard-rail — the "street furniture" cue the vision critic asked for. */
function buildSidewalk(path, length, side) {
  const roadW = getRoadWidthAt();
  const offset = side * (roadW / 2 + 1.6); // outside rail (+1.1) + margin
  const w = 1.1;
  const segs = 520;
  const positions = new Float32Array((segs + 1) * 2 * 3);
  const uvs = new Float32Array((segs + 1) * 2 * 2);
  const indices = [];
  const tan = new THREE.Vector3();
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    nrm.set(-tan.z, 0, tan.x).normalize();
    const base = i * 2;
    positions[base * 3 + 0] = p.x + nrm.x * offset;
    positions[base * 3 + 1] = p.y + 0.03;
    positions[base * 3 + 2] = p.z + nrm.z * offset;
    positions[(base + 1) * 3 + 0] = p.x + nrm.x * (offset + w);
    positions[(base + 1) * 3 + 1] = p.y + 0.03;
    positions[(base + 1) * 3 + 2] = p.z + nrm.z * (offset + w);
    uvs[base * 2] = t * 40;
    uvs[base * 2 + 1] = 0;
    uvs[(base + 1) * 2] = t * 40;
    uvs[(base + 1) * 2 + 1] = 1;
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = toonMaterial(0x8a90a0, {});
  mat.map = concreteTexture();
  mat.color.set(0xffffff);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Beveled curb profile (cross-section extruded along Z): vertical sides with
 * chamfered top corners and a flat top. Reads with real thickness from the
 * chase camera, unlike a plain box (vision critic: kerbs were "flat tiles").
 * The kerb sits partially embedded in the asphalt, so only the upper band
 * shows — with the chamfer at the top edge it reads as a rounded kerb stone.
 */
function beveledCurbGeometry(width, height, length, chamfer) {
  const W = width / 2;
  const H = height;
  const C = Math.min(chamfer, H / 2, W - 0.02);
  const L = length / 2;
  // Cross-section (X-Y), clockwise from bottom-left:
  //   bottom-left → bottom-right → right chamfer lower → right chamfer upper
  //   → left chamfer upper → left chamfer lower
  const prof = [
    [-W, 0],
    [W, 0],
    [W, H - C],
    [W - C, H],
    [-W + C, H],
    [-W, H - C],
  ];
  const N = prof.length;
  const verts = [];
  for (let i = 0; i < N; i++) {
    const [x, y] = prof[i];
    verts.push(x, y, -L, x, y, L); // back ring (z=-L), front ring (z=+L)
  }
  const idx = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const a = i * 2, b = j * 2, c = j * 2 + 1, d = i * 2 + 1;
    idx.push(a, c, b, b, c, d); // side wall
  }
  // end caps (material is DoubleSide — winding here is belt-and-braces)
  for (let i = 1; i < N - 1; i++) {
    idx.push(0, i * 2, (i + 1) * 2); // back cap (z=-L)
    idx.push(1, (i + 1) * 2 + 1, i * 2 + 1); // front cap (z=+L)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function buildCurbs(path, length, side, opts = {}) {
  const roadW = getRoadWidthAt();
  // AUDIT PERF/QA R50 (Feco real-GPU 2026-08-14: 'zebrado do canto ainda
  // estranho do mesmo jeito'): stones 3D retangulares rotacionadas em CURVAS
  // sempre abrem cunhas/sobreposição nas juntas (o chamfer 0.002 do R20
  // reduziu mas não elimina — geometria 3D em curva é o limite). Solução MK8
  // definitiva: RIBBON CONTÍNUA com textura zebra (UV ao longo do comprimento,
  // repeat = nº de pedras) — a zebra segue a curva perfeitamente, zero juntas.
  const offset = roadW / 2 + 0.15;
  const curbW = 0.68;
  const curbH = 0.20;
  const N = 800; // SK3D FIX (2026-08-20): 400→800 — kerb zebra segue curvas sem esticamento (Feco: 'faixa vermelha lateral esticada')
  const nrm = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const p = new THREE.Vector3();
  const pPrev = new THREE.Vector3();
  const pos = [];
  const uv = [];
  const idx = [];
  const edgeLen = length;
  const stoneLen = 0.5;
  const repeats = Math.max(2, Math.round(edgeLen));
  let arcAcc = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    path.getPointAt(t, p);
    if (i > 0) arcAcc += p.distanceTo(pPrev);
    pPrev.copy(p);
    path.getTangentAt(t, tan);
    nrm.set(-tan.z, 0, tan.x).normalize();
    const cx = p.x + nrm.x * side * offset;
    const cz = p.z + nrm.z * side * offset;
    const ox = nrm.x * (curbW / 2);
    const oz = nrm.z * (curbW / 2);
    const y0 = p.y + 0.24;
    const y1 = p.y + 0.26;
    const u = arcAcc; // SK3D FIX: UV por comprimento de arco REAL (não i/N) — zero esticamento em curvas
    pos.push(cx - ox, y0, cz - oz); uv.push(u, 0);
    pos.push(cx + ox, y0, cz + oz); uv.push(u, 0);
    pos.push(cx + ox, y1, cz + oz); uv.push(u, 1);
    pos.push(cx - ox, y1, cz - oz); uv.push(u, 1);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 4;
    const b = a + 4;
    // top face (the zebra) — 2 triangles
    idx.push(a + 3, a + 2, b + 2, a + 3, b + 2, b + 3);
    // outer side
    idx.push(a, a + 3, b + 3, a, b + 3, b);
    // inner side
    idx.push(a + 1, b + 1, b + 2, a + 1, b + 2, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // Zebra texture: red/white alternating stones along U. AUDIT PISTA R11:
  // 256x16 → 256x32 — metade superior zebra (topo, v 0.5..1), metade inferior
  // PEDRA escura (faces laterais, v 0..0.5): o kerb lê como volume de concreto
  // (MK8) e não como fita plana pintada.
  const zebraTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 32;
    const c = cv.getContext('2d');
    const half = 128;
    // topo (v 0.5..1 -> face superior): zebra vermelho/branco (inalterado)
    c.fillStyle = '#e63b3b'; c.fillRect(0, 0, half, 16);
    c.fillStyle = '#f8f9fb'; c.fillRect(half, 0, half, 16);
    // lateral (v 0..0.5 -> faces externa/interna): PEDRA escura com ruído —
    // o kerb lê 3D (volume de concreto) em vez de fita plana.
    c.fillStyle = '#3a3f4a';
    c.fillRect(0, 16, 256, 16);
    c.fillStyle = '#2f333d';
    for (let i = 0; i < 90; i++) c.fillRect(Math.floor(Math.random() * 256), 16 + Math.floor(Math.random() * 16), 2, 2);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    // AUDIT R68 (Feco real-GPU 2026-08-14: 'kerb virou um RISCO ROSA'):
    // o UV ia até `repeats` E o repeat era `repeats/2` → UV efetivo = repeats²/2
    // → textura repetia milhões de vezes → aliasing = rosa. Agora UV = nº de
    // repetições EXATO (edgeLen/1.0, pois a textura = 1 par de pedras por m)
    // e repeat=1. Mipmaps + aniso para matar o shimmer em ângulo raso.
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 8;
    return t;
  })();

  const mat = opts.neon
    ? new THREE.MeshBasicMaterial({ map: zebraTex, color: 0xff2ec4, side: THREE.DoubleSide })
    : new THREE.MeshBasicMaterial({ map: zebraTex, color: 0xffffff, side: THREE.DoubleSide });
  mat.map.repeat.set(1, 1); // R68: repeat=1 (o UV já codifica as repetições)
  mat.map.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

/**
 * Solid rectangular-section ribbon (closed box) following the path at a
 * fixed lateral offset and height band — the guard-rail's continuous darker
 * top rail. Top/bottom/side faces make it read from any camera angle.
 */
function buildEdgeRibbon(path, lateralOffset, yBase, w, h, mat) {
  const N = 100; // AUDIT PERF-R35 (2026-08-14): 200→100 — segmentos de ~7m num rail reto contínuo, imperceptível; corta ~50% dos tris das ribbons
  const nrm = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const p = new THREE.Vector3();
  const pos = [];
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    nrm.set(-tan.z, 0, tan.x).normalize();
    const cx = p.x + nrm.x * lateralOffset;
    const cz = p.z + nrm.z * lateralOffset;
    const ox = nrm.x * (w / 2);
    const oz = nrm.z * (w / 2);
    const y0 = p.y + yBase;
    const y1 = p.y + yBase + h;
    pos.push(cx - ox, y0, cz - oz); // 0 outer-bottom
    pos.push(cx + ox, y0, cz + oz); // 1 inner-bottom
    pos.push(cx + ox, y1, cz + oz); // 2 inner-top
    pos.push(cx - ox, y1, cz - oz); // 3 outer-top
  }
  for (let i = 0; i < N; i++) {
    const a = i * 4;
    const b = a + 4;
    // bottom face
    idx.push(a, b, a + 1, a + 1, b, b + 1);
    // top face
    idx.push(a + 3, a + 2, b + 2, a + 3, b + 2, b + 3);
    // outer side
    idx.push(a, a + 3, b + 3, a, b + 3, b);
    // inner side
    idx.push(a + 1, b + 1, b + 2, a + 1, b + 2, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Armco-style guard-rail along ONE road edge: a continuous main rail + a
 * continuous lower barrier line (double steel rail), box posts every ~3.5m
 * with visible footing base plates. Placed at roadWidth/2 + 1.1 so it never
 * intrudes on the racing line (the kart wall bounce lives further out, at
 * +roadEdge). Reads as ONE engineered barrier — asphalt → curbs → armco →
 * grass — instead of thin bars with sparse posts (vision critic).
 */
function buildGuardRail(path, length, side, opts = {}) {
  const roadW = getRoadWidthAt();
  // LOW + FAR from the racing line so the chase camera never clips/obscures:
  // rail top ~0.71m at road edge +1.1m.
  const lateral = side * (roadW / 2 + 0.45); // AUDIT R4: barrier CLOSE to the kerb (street circuit); +1.1 left it floating 1m behind
  // Posts every ~3.5m (count = round → spacing = length / count ≈ 3.5m) so
  // there's no seam gap where the loop closes at start.
  const count = Math.max(1, Math.round(length / 3.5));

  // Steel palette. NEON CITY: SILVER armco + thin emissive pink top stripe —
  // the old dark body + wide pink band read as a floating neon tube (visual
  // auditor 2026-08-12). Silver keeps the engineered barrier read; the
  // stripe keeps the neon identity.
  // AUDIT R2 (blind critic: PÓS read as 'floating neon tube' — toon can't
  // render metalness, so the silver read as emissive). Real MeshStandardMaterial
  // with a dim envMap gives the armco its metal body; the pink stripe stays the
  // only emissive element.
  const mainMat = new THREE.MeshStandardMaterial({ color: opts.neon ? 0xbfd9e8 : 0xe8eef4, metalness: 0.8, roughness: 0.3, emissive: opts.neon ? 0x10283c : 0x000000, emissiveIntensity: opts.neon ? 0.25 : 0, side: THREE.DoubleSide });
  const lowerMat = new THREE.MeshStandardMaterial({ color: opts.neon ? 0x71889a : 0x9aa6b2, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide });
  const postMat = toonMaterial(opts.neon ? 0x8a9aa8 : 0x2a3140, {}); // AUDIT R3: lighter still — posts must read as structure
  const plateMat = toonMaterial(opts.neon ? 0x3a4554 : 0x222a38, {});

  // Continuous double rail (no seams): main rail band 0.55..0.71m, lower
  // rail band 0.28..0.40m — the classic armco barrier profile.
  const mainRail = buildEdgeRibbon(path, lateral, 0.05 + 0.52, 0.5, 0.22, mainMat); // AUDIT R2: 0.16→0.22 (armco mass)
  const lowerRail = buildEdgeRibbon(path, lateral, 0.05 + 0.24, 0.42, 0.16, lowerMat);
  // AUDIT PERF-R35: rails NÃO projetam sombra (posts instanciados já o fazem;
  // a sombra do rail é uma linha que z-fights no shadow map) — economiza ~50%
  // do fill do shadow pass.
  mainRail.castShadow = false;
  lowerRail.castShadow = false;
  // AUDIT R3: W-beam specular cue — a bright thin edge on top of the main
  // rail reads as the folded metal lip of an armco profile (critic: profile flat).
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, metalness: 0.85, roughness: 0.25, side: THREE.DoubleSide });
  const lipRail = buildEdgeRibbon(path, lateral, 0.05 + 0.735, 0.5, 0.035, lipMat);
  lipRail.castShadow = false;
  // Neon: thin emissive pink stripe ON TOP of the silver main rail (0.05m
  // tall, sits at 0.69..0.74 — the accent, not the structure).
  let topStripe = null;
  if (opts.neon) {
    const stripeMat = toonMaterial(0xff2ec4, { side: THREE.DoubleSide, emissive: 0xff2ec4, emissiveIntensity: 0.55 });
    topStripe = buildEdgeRibbon(path, lateral, 0.05 + 0.73, 0.03, 0.03, stripeMat); // AUDIT R2b: thinner/dimmer — silver rail leads the hierarchy
    topStripe.castShadow = false;
    topStripe.renderOrder = 2;
  }

  // Box posts (0.13 x 0.40 x 0.13) from the ground to the main rail, each on
  // a visible footing plate (0.40 x 0.08 x 0.40) set into the shoulder.
  const postGeo = new THREE.BoxGeometry(0.32, 0.80, 0.18); // AUDIT R5: 2x wider posts (subpixel at chase cam distance)
  const plateGeo = new THREE.BoxGeometry(0.60, 0.10, 0.60); // AUDIT R3: bigger base plates (critic: plates not visible)
  const posts = new THREE.InstancedMesh(postGeo, postMat, count);
  const plates = new THREE.InstancedMesh(plateGeo, plateMat, count);
  posts.castShadow = true;
  plates.castShadow = true;

  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const t = i / count; // one post per joint
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    nrm.set(-tan.z, 0, tan.x).normalize();
    const px = p.x + nrm.x * lateral;
    const pz = p.z + nrm.z * lateral;
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(px, p.y + 0.39, pz); // AUDIT R4: post spans 0.0..0.78
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
    dummy.position.set(px, p.y + 0.06, pz); // plate spans 0.015..0.105 — set into the shoulder
    dummy.updateMatrix();
    plates.setMatrixAt(i, dummy.matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  plates.instanceMatrix.needsUpdate = true;

  // AUDIT R4: contact shadow under the barrier — a dark ribbon at the base
  // anchors the kerb+rail to the ground (critic: 'floats, no contact shadow').
  const shadowMat = toonMaterial(0x05070c, { side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
  const contactShadow = buildEdgeRibbon(path, lateral, 0.05 + 0.03, 1.4, 0.08, shadowMat); // AUDIT R5: darker+wider (critic: shadow invisible)
  contactShadow.castShadow = false;
  contactShadow.renderOrder = 1;

  const g = new THREE.Group();
  g.add(mainRail, lowerRail, lipRail, posts, plates, contactShadow);
  if (topStripe) g.add(topStripe);
  return g;
}

/** Painted lane dash card: warm yellow with a worn darker border + grime
 *  speckle, so markings read as worn paint on asphalt (vision critic). */
function dashTexture(neon = false) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  // Neon City needs a clean, unlit-by-asphalt marking. The old worn brown
  // border became a row of dark rectangles on the wet charcoal road.
  g.fillStyle = neon ? '#ffe88a' : '#ffd166';
  g.fillRect(0, 0, 128, 128);
  if (!neon) {
    // Worn darker border — slightly irregular, hand-painted feel.
    g.strokeStyle = 'rgba(120,82,18,0.55)';
    g.lineWidth = 7;
    g.strokeRect(3, 3, 122, 122);
    g.strokeStyle = 'rgba(90,60,10,0.4)';
    g.lineWidth = 3;
    g.strokeRect(8, 8, 112, 112);
  }
  // Grime speckle + worn patches.
  for (let i = 0; i < 170; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(60,40,8,0.14)' : 'rgba(255,236,180,0.12)';
    g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 3, 1 + Math.random() * 2);
  }
  g.globalAlpha = 0.16;
  g.fillStyle = '#8a6420';
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.arc(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 11, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildLaneDashes(path, length, neon = false) {
  // AUDIT R16e (Feco real-GPU: 'component tracejado amarelo no centro' + o
  // contorno escuro): o lane dashes era AMARELO com count = length/3 = 131
  // dashs de 2.6m com gap de só 0.4m → virtualmente UMA LINHA CONTÍNUA, não
  // um tracejado. MK8: traço curto (~1.2m) + gap grande (~2.4m) = divisão de
  // faixa legível. Nova cadência: 1.4m de traço + 2.4m de gap = 3.8m ciclo.
  const dashLen = 1.4;
  const gapLen = 2.4;
  const cycle = dashLen + gapLen;
  const count = Math.floor(length / cycle);
 // Flat plane laid on the asphalt (was a 0.04-thick box that read as a
  // floating sliver). polygonOffset wins the depth test against the ribbon —
  // the classic decal technique.
  const geo = new THREE.PlaneGeometry(0.42, dashLen); // AUDIT R16e: 0.45×2.6 → 0.42×1.4 (dash curto, não linha)
  // Solid paint on both tracks: the old canvas/grime card made perspective
  // edges read as irregular shapes. A flat color keeps every dash rectangular.
  const mat = new THREE.MeshBasicMaterial({
    color: neon ? 0xffe88a : 0xffd166,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
  });
  mat.toneMapped = false;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  mat.depthWrite = false;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.renderOrder = 2;

  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    // AUDIT R16e: avança o ciclo completo (traço + gap) — não traço contínuo
    const t = (i * cycle + dashLen / 2) / length;
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    // Road ribbon sits at y+0.18 — the dashes must sit ABOVE it (y+0.21) or
    // they're buried inside the asphalt (the classic decal-height pitfall).
    dummy.position.set(p.x, p.y + 0.185, p.z); // 5mm above road ribbon: no grazing-angle z-fight
    // PlaneGeometry is XY. Rotate it flat, then yaw its long axis to the
    // tangent; lookAt()+rotateX() introduced skewed/parallelogram cards.
    dummy.rotation.set(-Math.PI / 2, 0, Math.atan2(tan.x, tan.z));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/**
 * Turbo pads: bright zebra-striped boost pads laid on the road centerline,
 * clustered around the t positions in CONFIG.track.turboPadTs (4 pads per
 * cluster, ~2.8m apart along the path). Wider than lane dashes so they read
 * as a distinct "drive over me" strip. Returns the instanced mesh plus the
 * normalized ts and world points KartPhysics uses for boost detection.
 */
/** MK8-style turbo boost strips (Feco QA 2026-08-12): ONE long amber ribbon
 *  per cluster (11.2m) instead of four small squares — reads as a speed pad
 *  from any distance. Base decal + an additive glow overlay (glowMat) that
 *  the main loop breathes (opacity pulse). The physics ts/points are kept at
 *  the old 4-per-cluster spots so boost detection is unchanged. */
function buildTurboPads(path, length) {
  const clusters = CONFIG.track.turboPadTs || [];
  const perCluster = 4;
  const spacing = 2.8; // m between detection spots in a cluster
  const dt = spacing / length;

  // Flat painted decal (was a 0.04 box that read as floating). polygonOffset
  // keeps it glued to the asphalt at grazing angles.
  // AUDIT (Feco QA 2026-08-12): the lookAt+rotateX(-90)+rotateZ(-90) chain
  // INVERTS the plane axes (X ends up down-track, Y across), so the pad
  // geometry must be WIDE on X (depth) and SHORT on Y (width): 11.2 x 3.6.
  // toneMapped=false keeps the amber from going brown under ACES.
  const PAD_W = 4.5;    // MK8 pad spans nearly a lane — 3.2m read as a small rectangle
  // AUDIT FIX 2026-08-16 (Feco real-GPU: 'os turbo pads estão cortando'): um
  // pad RETO de 18m numa pista curva não acompanha a curvatura — as pontas
  // saem do asfalto/cortam as bordas (o crítico confirmou 'bordas abruptas,
  // trapézio que não acompanha a curva'). PAD_LEN agora é DINÂMICO por
  // cluster: mede o DESVIO ANGULAR TOTAL ao longo do comprimento candidato
  // (amostras nas duas pontas do pad, não curvatura local de 1m — um pad de
  // 18m acumula desvio mesmo com curvatura local baixa) e usa 18m em retas
  // (desvio < 2°), 14m médio, 10m em curvas fechadas.
  const padLenAt = (c) => {
    const tanA = new THREE.Vector3();
    const tanB = new THREE.Vector3();
    path.getTangentAt(Math.max(0.001, c - 9 / length), tanA);
    path.getTangentAt(Math.min(0.999, c + 9 / length), tanB);
    const dot = Math.min(1, Math.max(-1, tanA.dot(tanB)));
    const devDeg = (Math.acos(dot) * 180) / Math.PI; // desvio total ponta-a-ponta
    if (devDeg < 2) return 18;
    if (devDeg < 6) return 14;
    if (devDeg < 12) return 10;
    return 7; // curva fechada — pad curto, nunca corta as bordas
  };
  // MeshBasicMaterial: unlit so the pad stays bright amber/white in shadow.
  const mat = new THREE.MeshBasicMaterial({ map: turboPadTexture(), color: 0xffffff, side: THREE.DoubleSide });
  mat.toneMapped = false; // MK8 pads glow at full saturation — ACES would dull amber→brown
  // Decal technique (same recipe as buildLaneDashes, which never floats):
  // polygonOffset wins the depth test against the coplanar ribbon, and
  // depthWrite:false stops the biased pad from leaving a "hover" gap at
  // grazing chase-cam angles (A/B/C headless experiment 2026-08-12: A
  // floated 2-4px, B with depthWrite:false read as glued, C without
  // polygonOffset let the road overlays draw OVER the pad).
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  mat.depthWrite = false;
  mat.transparent = true;
  // Additive glow overlay — pulses via glowMat.opacity (main.js update loop).
  // AUDIT R51 (Feco real-GPU 2026-08-14: 'parte dos pads estranhos — glow
  // branco estourado, mal recortado'): o glow era um retângulo BRANCO aditivo
  // puro (color 0xffffff, sem map) → clareava/lavava o pad inteiro. Agora usa
  // a MESMA textura do pad como máscara — o brilho aditivo só acende nas
  // áreas do desenho (laranja + chevrons), integrado, sem estourar.
  const glowMat = new THREE.MeshBasicMaterial({
    map: turboPadGlowTexture(), // AUDIT R51b: máscara SÓ dos chevrons (fundo preto = soma zero; antes a textura inteira dobrava o laranja)
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  glowMat.toneMapped = false;
  // AUDIT FIX 2026-08-16: meshes criados por cluster abaixo (PAD_LEN dinâmico
  // por curvatura) — sem InstancedMesh global.

  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  const ts = [];
  const points = [];

  // AUDIT FIX R12g (Feco real-GPU: 'turbo pad cortando' — persiste): um pad
  // PLANO RETO (mesmo de 7m) numa pista curva tem as pontas LATERAIS fora do
  // asfalto — o crítico headless dava 8/10 mas no GPU real o corte é óbvio.
  // Solução definitiva: o pad agora é uma RIBBON que SEGUE o path (mesma
  // técnica do buildRoadRibbon) — largura fixa, comprimento curvo, yOffset
  // 0.185 (acima dos overlays), sem corte em curva nenhuma.
  const group = new THREE.Group();
  let vi = 0;
  for (const c of clusters) {
    const padLen = padLenAt(c);
    // Detection spots — na borda de entrada da ribbon (boost ao tocar).
    const spotDt = 3.0 / length;
    for (let k = 0; k < perCluster; k++) {
      const t = Math.min(0.999, Math.max(0.001, c - (padLen / 2) / length + k * spotDt));
      path.getPointAt(t, p);
      ts.push(t);
      points.push(p.clone());
    }
    // Ribbon CURVA centrada no cluster: t0..t1 = padLen ao longo do path.
    // buildRoadRibbon cria a malha seguindo a curva — bordas sempre dentro
    // do asfalto, sem trapézio.
    const t0 = Math.max(0.001, c - (padLen / 2) / length);
    const t1 = Math.min(0.999, c + (padLen / 2) / length);
    const spanLen = Math.max(1, (t1 - t0) * length);
    const segs = Math.max(4, Math.round(spanLen / 1.2)); // ~1.2m por segmento
    // AUDIT FIX R13c (crítico: 'faixa totalmente lisa, sem chevrons'): o UV
    // da ribbon é (t - uvBias) * repeatU, com t no sub-trecho t0..t1. O
    // repeatU antigo (spanLen*0.055=0.99) mapeava SÓ 4.5% da textura (os
    // chevrons em 0.26/0.50/0.74 ficavam fora). Para a textura INTEIRA (com
    // os 3 chevrons) caber no pad: repeatU = 1/(t1-t0) = length/spanLen.
    const padRepeatU = 1 / Math.max(0.0001, t1 - t0); // textura inteira por pad

    // Material base (mesmo recipe do plano antigo): unlit + polygonOffset.
    const baseMat = new THREE.MeshBasicMaterial({
      map: turboPadTexture(),
      color: 0xffffff,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      depthWrite: false,
      transparent: true,
    });
    baseMat.toneMapped = false;

    const ribbonMesh = buildRoadRibbon(path, length, {
      width: PAD_W,
      yOffset: 0.185,
      segments: segs,
      lateral: 0,
      t0, t1, // AUDIT FIX R12i: só o trecho do cluster (não o path todo)
      uvBias: t0, // textura zera na borda do trecho
      texture: () => turboPadTexture(),
      repeatU: padRepeatU, // AUDIT FIX R13c: textura inteira por pad
      repeatV: 1,
      transparent: true,
      opacity: 1,
      roughness: 1,
    });
    // Substitui o material da ribbon pelo material pad (unlit + offsets).
    ribbonMesh.material.dispose?.();
    ribbonMesh.material = baseMat;
    ribbonMesh.renderOrder = 2;
    ribbonMesh.frustumCulled = false;
    group.add(ribbonMesh);

    // Glow aditivo (mesma ribbon, máscara dos chevrons).
    const glowMesh = buildRoadRibbon(path, length, {
      width: PAD_W,
      yOffset: 0.186,
      segments: segs,
      lateral: 0,
      t0, t1, // AUDIT FIX R12i: só o trecho do cluster (não o path todo)
      uvBias: t0, // textura zera na borda do trecho
      texture: () => turboPadGlowTexture(),
      repeatU: padRepeatU, // AUDIT FIX R13c: textura inteira por pad (chevrons do glow)
      repeatV: 1,
      transparent: true,
      opacity: 0,
      roughness: 1,
    });
    glowMesh.material.dispose?.();
    glowMesh.material = glowMat;
    glowMesh.renderOrder = 3;
    glowMesh.frustumCulled = false;
    group.add(glowMesh);

    vi++;
  }
  return { mesh: group, glowMat, ts, points };
}

function buildGantry(startLine) {
  const group = new THREE.Group();
  const roadW = getRoadWidthAt();
  const nrm = new THREE.Vector3(-startLine.direction.z, 0, startLine.direction.x).normalize();

  const pillarGeo = new THREE.CylinderGeometry(0.28, 0.36, 6.8, 10); // AUDIT R76: 6.1→6.8 (beam subiu p/ lampas visíveis)
  // SK3D FIX (2026-08-20, Feco real-GPU): pillars vermelhos (0xff5a5f) liam
  // como "arco berrante sem estrutura". MK8D usa pilares CINZA estruturais.
  const pillarMat = toonMaterial(0x3a4152, {});
  const footingGeo = new THREE.BoxGeometry(0.95, 0.16, 0.95);
  const footingMat = toonMaterial(0x2b3340, {});
  const braceMat = toonMaterial(0x2b3340, {});
  const beamGeo = new THREE.BoxGeometry(roadW + 5, 0.28, 0.7);
  const beamMat = toonMaterial(0x1b2a41, {});
  // AUDIT r11 (FECO): crisp checkered trim on the beam's track-facing
  // faces — the classic MK8D arch edge. MeshBasicMaterial keeps it unlit
  // and readable like the banner (groups 4/5 = +/-Z in BoxGeometry).
  const beamCheckerMat = new THREE.MeshBasicMaterial({ map: bannerCheckerTexture() });

  // Pillars now run from the ground (y 0.0) up to the beam — no more
  // floating poles — each with a visible footing plate set into the shoulder.
  const pillarBaseL = startLine.position.clone().addScaledVector(nrm, -(roadW / 2 + 1.6));
  const pillarBaseR = startLine.position.clone().addScaledVector(nrm, roadW / 2 + 1.6);
  for (const base of [pillarBaseL, pillarBaseR]) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.copy(base);
    // AUDIT r20-FIX: 6.1m pillar centered at y 2.8 sank its base 0.25m
    // into the grass — center at 3.05 so it spans 0.0..6.1 flush with
    // the footing and the beam top (6.1).
    // AUDIT R76: beam subiu p/ 6.45 — pillar center 3.4 (0..6.8).
    pillar.position.y = 3.4;
    pillar.castShadow = true;
    group.add(pillar);
    cartoonOutline(pillar, 0x1b2a41, 0.03);
    const footing = new THREE.Mesh(footingGeo, footingMat);
    footing.position.copy(base);
    footing.position.y = 0.08; // spans 0.0..0.16 — proud of the shoulder top (0.14)
    footing.castShadow = true;
    group.add(footing);
  }

  // AUDIT r3: the diagonal cross-braces read as an X across the racing line
  // in the start-grid camera — the critic scored them as broken geometry
  // every round ('dark diagonal lines crossing the track'). MK8D finish
  // arches are clean beams; the truss look isn't worth the visual noise.
  const aL = pillarBaseL.clone(); aL.y += 0.5;
  const aR = pillarBaseR.clone(); aR.y += 0.5;
  const bL = pillarBaseL.clone(); bL.y += 2.7;
  const bR = pillarBaseR.clone(); bR.y += 2.7;

  const beam = new THREE.Mesh(
    beamGeo,
    [beamMat, beamMat, beamMat, beamMat, beamCheckerMat, beamCheckerMat]
  );
  beam.position.copy(startLine.position);
  beam.position.y = 6.45; // AUDIT R76: 5.85→6.45 — beam ABOVE the lamp tops (6.14), as lampas ficavam METADE dentro do beam (5.60..6.10) = '5ª luz escondida' do usuário
  beam.lookAt(startLine.position.clone().add(startLine.direction));
  group.add(beam);
  cartoonOutline(beam, 0x1b2a41, 0.02);

  // FINISH banner hanging from the beam. finishBannerTexture is a 512x128
  // canvas aspect-matched to this ~4.7:1 plane (roadW+2 x 2.1m), so the
  // navy field, glyphs and checkered bands map 1:1 — no stretching (AUDIT
  // r11 FECO: the old square 512px canvas read 4.7x wider than tall).
  // The 14 width segments are REQUIRED: main.js waves them like fabric
  // (a segmented plane's UVs still span 0..1 across the whole face, so
  // segmentation never distorts the texture).
  // MeshBasicMaterial: the toon gradient was washing the checker out.
  const mobileViewport =
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
    window.innerWidth <= 768;
  const bannerWidth = mobileViewport ? roadW - 2.6 : roadW + 0.8;
  const banner = new THREE.Mesh(
    // Keep the landmark readable while reducing the solid visual wall in the
    // chase-camera horizon. The segmented geometry still preserves the fabric
    // wave, but the lower profile leaves more of the racing line visible.
    new THREE.PlaneGeometry(bannerWidth, 0.68, 14, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide }) // AUDIT 2026-09-02 mobile: reduzido para não bloquear linha de visão
  );
  banner.material.map = finishBannerTexture();
  banner.position.copy(startLine.position);
  // AUDIT r17 (Feco critic): the 2.1m banner at y 4.3 dominated the frame
  // and read as the subject. Smaller (1.55m) + higher (y 5.15, top at the
  // 5.85 beam) so it stays a finish structure, not a billboard wall.
  // AUDIT R22 (critic W1 finish 7/10: 'elementos circulares escuros cobrem
  // o FINISH'): o banner (4.375..5.925) se sobrepunha às 5 lampas do
  // start-light panel (y 5.62) — as luzes escuras tapavam o texto. MK8
  // real: luzes no beam, banner ABAIXO. y 5.15→4.55 (2.375..2.375+1.55
  // = 3.775..5.325 — abaixo do panel 5.62).
  banner.position.y = 4.92;
  // Explicit yaw: normal +Z faces the START CAMERA (-direction), so the
  // DoubleSide material shows the text un-mirrored from the player's view.
  banner.rotation.y = Math.atan2(-startLine.direction.x, -startLine.direction.z);
  group.add(banner);
  // Back-face banner (AUDIT visual 2026-08-12): the DoubleSide material
  // showed the text REVERSED ('HSINIF') from behind. A second plane with the
  // mirrored texture, FrontSide, flipped 180°, shares the SAME geometry so
  // main.js's waveBanner animates both faces together.
  const bannerBack = new THREE.Mesh(
    banner.geometry, // AUDIT PERF-R45: compartilha a geometria JÁ (antes criava uma PlaneGeometry que era abandonada sem dispose)
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide })
  );
  bannerBack.material.map = finishBannerTextureMirrored();
  bannerBack.position.copy(startLine.position);
  bannerBack.position.y = 4.92; // acompanha o banner frontal (abaixo das lampas)
  bannerBack.rotation.y = banner.rotation.y + Math.PI;
  group.add(bannerBack);

  // Start lights (5 lamps on the beam — AUDIT r20-FIX: MK8D's signature
  // 5-light countdown, was 3) — raceManager/main animate them: red lamps
  // light up during countdown, all green on GO.
  const startLights = [];
  // AUDIT FIX SK3D (2026-08-20, Feco real-GPU): o painel preto 6x0.66
  // flutuava a y5.62 SEM conexão ao beam (y6.45) — lia como "bloco escuro
  // com bolas" no céu. MK8D: as 5 luzes ficam numa CAIXA BRANCA sólida
  // pendurada no beam por 2 braçadeiras. Troca o painel preto por housing
  // claro + braçadeiras estruturais ligando ao beam.
  const lampPanel = new THREE.Mesh(
    new THREE.BoxGeometry(6.0, 0.62, 0.26),
    toonMaterial(0xf4f6f8, {}) // housing claro (MK8D: caixa branca, não preta)
  );
  lampPanel.position.copy(startLine.position).addScaledVector(nrm, 0);
  lampPanel.position.y = 5.62;
  lampPanel.rotation.y = banner.rotation.y;
  lampPanel.castShadow = false;
  group.add(lampPanel);
  // Moldura escura fina ao redor do housing (legibilidade das luzes).
  const panelTrim = new THREE.Mesh(
    new THREE.BoxGeometry(6.2, 0.74, 0.14),
    toonMaterial(0x1b2a41, {})
  );
  panelTrim.position.copy(lampPanel.position);
  panelTrim.rotation.y = banner.rotation.y;
  panelTrim.position.z -= 0.08;
  panelTrim.castShadow = false;
  group.add(panelTrim);
  // 2 braçadeiras verticais ligando o beam (y6.45) ao housing (y5.62).
  const bracketMat = toonMaterial(0x2b3340, {});
  for (const bx of [-2.6, 2.6]) {
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 1.0, 0.18),
      bracketMat
    );
    bracket.position.copy(startLine.position).addScaledVector(nrm, bx);
    bracket.position.y = 6.05; // span ~5.55..6.55 (liga housing ao beam)
    bracket.rotation.y = banner.rotation.y;
    bracket.castShadow = false;
    group.add(bracket);
  }
  // Light sockets: discos pretos atrás de cada lâmpada (buraco de luz) —
  // as lâmpadas leem como MONTADAS no housing, não esferas flutuantes.
  const socketGeo = new THREE.CircleGeometry(0.34, 16);
  const socketMat = toonMaterial(0x0a0e16, {});
  // 5 lamp bodies — MK8D: lâmpadas VERMELHAS apagadas (acendem verde no GO).
  const lampGeo = new THREE.SphereGeometry(0.38, 18, 16); // SK3D FIX: 0.42→0.38 — menos "bola", mais "luz"
  const lampMat = toonMaterial(0x1b2a41, { emissive: 0xff2a2a, emissiveIntensity: 0.0 });
  for (let i = -2; i <= 2; i++) {
    const socket = new THREE.Mesh(socketGeo, socketMat);
    socket.position.copy(startLine.position).addScaledVector(nrm, i * 1.08);
    socket.position.y = 5.62;
    socket.position.z += 0.02;
    socket.lookAt(socket.position.clone().add(startLine.direction));
    socket.castShadow = false;
    group.add(socket);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.copy(startLine.position).addScaledVector(nrm, i * 1.08);
    lamp.position.y = 5.62;
    lamp.position.z += 0.16;
    lamp.castShadow = false;
    group.add(lamp);
    startLights.push(lamp);
  }

  // Banner flags REMOVIDAS do gantry (2026-08-20, Feco real-GPU): cones
  // amarelos a y7.2 liam como "luzes verdes flutuantes" confundindo o
  // semáforo. O gantry mantém banner FINISH + caixa de luzes + pillars.

  return { group, startLights, banner };
}

/**
 * Checkered finish line PAINTED on the asphalt under the gantry.
 * A flat plane with explicit yaw (like the banner): lookAt faces the
 * direction, rotateX(-PI/2) lays it flat — this time it reads as painted,
 * not as a loose floating slab (the old decal had the wrong orientation).
 */
function buildFinishLine(startLine) {
  const w = getRoadWidthAt();
  // AUDIT (Feco visual QA, 2026-08-11): finish strip must read as a
  // CHECKER, not a dark blob-strip. 12x2 texture on a w x w/12*2 plane
  // (9 x 1.5m) → 0.75m SQUARE cells; opacity 0.9 so the paint sits on the
  // asphalt like a real decal (opacity 1.0 made the black cells dominate
  // and read as 'weird markings' at speed).
  // AUDIT R2 (blind critic 2026-08-12): 1.5m depth compressed to a sliver in
  // chase perspective — the critic could NOT see the checker. MK8 finish
  // strips are ~3m along the racing line. 12x4 cells (0.75m squares) on a
  // w x w/12*4 plane (9 x 3m).
  const geo = new THREE.PlaneGeometry(w, (w / 12) * 4);
  const mat = new THREE.MeshBasicMaterial({ map: finishLineTexture(), transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  // polygonOffset wins the depth test against the road ribbon at grazing
  // angles (classic decal technique — plain y-offset z-fights).
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.position.copy(startLine.position);
  mesh.position.y += 0.21; // road ribbon sits at y+0.18; sit just above it
  mesh.lookAt(
    startLine.position.x + startLine.direction.x,
    startLine.position.y,
    startLine.position.z + startLine.direction.z
  );
  mesh.rotateX(-Math.PI / 2);
  return mesh;
}

// ---------------------------------------------------------------------------
// Start-grid pole numbers (AUDIT r7)
// White number on a dark disc painted on the asphalt at every grid slot,
// MK8-style. One merged BufferGeometry (N quads, one draw call) with a
// single atlas texture holding all N discs; deterministic — no Math.random.
// ---------------------------------------------------------------------------
let _gridNumberAtlas = null; // { count, tex }
function gridNumberAtlas(count) {
  if (_gridNumberAtlas && _gridNumberAtlas.count === count) return _gridNumberAtlas.tex;
  const c = document.createElement('canvas');
  c.width = 128 * count;
  c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < count; i++) {
    const cx = i * 128 + 64;
    // dark disc with a soft radial falloff (reads as paint, not a sticker)
    const grad = g.createRadialGradient(cx, 64, 8, cx, 64, 58);
    grad.addColorStop(0, '#242c3a');
    grad.addColorStop(0.75, '#1a212c');
    grad.addColorStop(1, 'rgba(20,26,36,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, 64, 58, 0, Math.PI * 2);
    g.fill();
    // crisp white rim ring
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, 64, 51, 0, Math.PI * 2);
    g.stroke();
    // bold white number
    g.fillStyle = '#ffffff';
    g.font = '900 72px "Baloo 2", "Nunito", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1), cx, 66);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  _gridNumberAtlas = { count, tex };
  return tex;
}

/**
 * Painted start-grid numbers. Replicates main.js buildGridPositions():
 * 2 rows x 3 cols behind the start line (row 3.6m, col 2.7m) for karts
 * 1..min(8, numKarts). Each slot gets a flat 1.9m disc sitting just above
 * the asphalt (y+0.21, same decal layer as the finish line), oriented so
 * the digit is upright from the start camera behind the grid.
 */
function buildGridNumbers(startLine) {
  const count = Math.min(8, CONFIG.game.numKarts || 6);
  if (count <= 0) return null;
  const tex = gridNumberAtlas(count);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  mat.renderOrder = 2;

  const dir3 = startLine.direction.clone().normalize();
  const dir = new THREE.Vector3(dir3.x, 0, dir3.z).normalize(); // horizontal (decal lies flat)
  const perp = new THREE.Vector3(-dir.z, 0, dir.x);
  const S = 0.95; // half-size → 1.9m disc (fits the 2.7m lane spacing)

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i < count; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = startLine.position.x + dir3.x * (-(row + 1) * 3.6) + perp.x * ((col - 1) * 2.7);
    const cz = startLine.position.z + dir3.z * (-(row + 1) * 3.6) + perp.z * ((col - 1) * 2.7);
    const cy = startLine.position.y + 0.21; // same decal layer as the finish line
    const u0 = i / count;
    const u1 = (i + 1) / count;
    // corners in the flat XZ plane; texture V up = +dir (readable from behind)
    const p = (dx, dz) => positions.push(cx + dx, cy, cz + dz);
    p(dir.x * S + perp.x * S, dir.z * S + perp.z * S); // (u1, v1)
    p(dir.x * S - perp.x * S, dir.z * S - perp.z * S); // (u1, v0)
    p(-dir.x * S - perp.x * S, -dir.z * S - perp.z * S); // (u0, v0)
    p(-dir.x * S + perp.x * S, -dir.z * S + perp.z * S); // (u0, v1)
    uvs.push(u1, 1, u1, 0, u0, 0, u0, 1);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    const b = i * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3); // up-facing winding
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return new THREE.Mesh(geo, mat);
}

/**
 * Painted direction chevrons at the sharpest corners (curvature > threshold),
 *  so the road reads "race track" and not a plain strip. */
function buildDirectionArrows(path) {
  const SAMPLES = 160;
  const tan = new THREE.Vector3();
  const tan2 = new THREE.Vector3();
  const p = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  const spots = [];
  let lastT = -1;
  const dt = 1 / SAMPLES;
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    path.getTangentAt(t, tan);
    path.getTangentAt(Math.min(1, t + dt), tan2);
    const curv = 1 - Math.min(1, Math.max(-1, tan.dot(tan2))); // 0 = straight
    if (curv > 0.0022 && t - lastT > 0.045) {
      // Skip the very first straight segment (start grid) — keep it clean.
      if (t > 0.05 && t < 0.95) {
        path.getPointAt(t, p);
        spots.push({ x: p.x, y: p.y, z: p.z, tx: tan.x, tz: tan.z });
        lastT = t;
      }
    }
  }
  if (spots.length === 0) return null;
  const geo = new THREE.PlaneGeometry(3.4, 3.4); // big chevrons (MK8-style corner signage)
  const mat = new THREE.MeshBasicMaterial({ map: arrowTexture(), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  mesh.renderOrder = 2;
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    dummy.position.set(s.x, s.y + 0.21, s.z); // road ribbon sits at y+0.18
    dummy.lookAt(s.x + s.tx, s.y, s.z + s.tz);
    // LAY FLAT on the asphalt (was standing vertical — the floating board the
    // critic saw). Chevron tips point at the texture's top (+Y); after
    // lookAt+rotateX the plane's +Y faces backward, so spin 180° to point
    // the arrows along the direction of travel.
    dummy.rotateX(-Math.PI / 2);
    dummy.rotateZ(Math.PI);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/**
 * Tire-stack barriers on the outside of the sharpest corners (classic kart
 * track dressing). Reuses the same curvature scan as the direction arrows.
 */
function buildTireBarriers(path, roadW) {
  const SAMPLES = 160;
  const tan = new THREE.Vector3();
  const tan2 = new THREE.Vector3();
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  const spots = [];
  let lastT = -1;
  const dt = 1 / SAMPLES;
  const halfW = roadW / 2;
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    path.getTangentAt(t, tan);
    path.getTangentAt(Math.min(1, t + dt), tan2);
    const curv = 1 - Math.min(1, Math.max(-1, tan.dot(tan2)));
    if (curv > 0.0022 && t - lastT > 0.06 && t > 0.05 && t < 0.95) {
      path.getPointAt(t, p);
      nrm.set(-tan.z, 0, tan.x).normalize();
      // A tire STACK (3 tires high) on each side, just off the road — and
      // outside the guard-rail (rail sits at halfW+0.6, so +1.5 clears it).
      for (let side = -1; side <= 1; side += 2) {
        spots.push({ x: p.x + nrm.x * (side * (halfW + 1.5)), y: p.y, z: p.z + nrm.z * (side * (halfW + 1.5)), ry: Math.atan2(tan.x, tan.z) });
      }
      lastT = t;
    }
  }
  if (spots.length === 0) return null;
  const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  const tireMat = toonMaterial(0x23272e, {});
  // Hub caps (audit v4 F3: tire stacks read as dark stumps — a bright disc
  // per side makes them read AS TIRES instantly).
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10);
  const hubMat = toonMaterial(0xdfe6ee, {});
  const mesh = new THREE.InstancedMesh(tireGeo, tireMat, spots.length * 3);
  const hubMesh = new THREE.InstancedMesh(hubGeo, hubMat, spots.length * 6);
  let idx = 0;
  let hidx = 0;
  for (const s of spots) {
    for (let h = 0; h < 3; h++) {
      dummy.position.set(s.x, s.y + 0.15 + h * 0.3, s.z);
      dummy.rotation.set(0, s.ry, 0); // standing tire ring facing along the road
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
      // hub caps on both faces (local X ±0.19 → world via ry rotation)
      const cx = Math.cos(s.ry);
      const cz = Math.sin(s.ry);
      for (const sgn of [-1, 1]) {
        dummy.position.set(s.x + cx * 0.19 * sgn, s.y + 0.15 + h * 0.3, s.z - cz * 0.19 * sgn);
        dummy.rotation.set(0, s.ry, 0);
        dummy.updateMatrix();
        hubMesh.setMatrixAt(hidx++, dummy.matrix);
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  hubMesh.instanceMatrix.needsUpdate = true;
  const g = new THREE.Group();
  g.add(mesh);
  g.add(hubMesh);
  return g;
}

// ---------------------------------------------------------------------------
// Track-side density ("dense world, not sparse"): organized, LOW, non-blocking
// props layered OUTSIDE the guard-rail hierarchy:
//   asphalt → curbs (+0.15) → guard rail (+1.1) → grass tufts (+1.8) →
//   tire stacks (corners, +1.5) → sponsor boards (+2.6).
// ---------------------------------------------------------------------------

/** Deterministic 0..1 hash for per-instance jitter (no RNG → stable layout). */
function hash01(...args) {
  let h = 2166136261;
  for (const a of args) {
    h ^= (a | 0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Procedural billboard face: toon base color + clean sponsor lockup
 *  (circle badge + wordmark bars) + dark frame. AUDIT FIX 2026-08-16
 *  (Feco real-GPU: 'faixas vermelhas esticadas e ruim definição'): a
 *  textura antiga (128×64, 3 stripes diagonais) aplicada nas faces do
 *  BoxGeometry esticava o desenho (laterais/topo esmagavam a stripe) e
 *  lia como "oval borrado" em perspectiva. Nova: 256×128 com um logotipo
 *  simples e legível — círculo + 2 barras — que permanece coerente mesmo
 *  com a perspectiva da chase cam. */
function billboardTexture(baseHex, stripeHex) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const base = '#' + baseHex.toString(16).padStart(6, '0');
  const accent = '#' + stripeHex.toString(16).padStart(6, '0');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 128);
  // Duas faixas horizontais accent (topo/base) — identidade de sponsor.
  g.fillStyle = accent;
  g.fillRect(0, 0, 256, 18);
  g.fillRect(0, 110, 256, 18);
  // Badge circular central (logo) com anel interno — legível a distância.
  g.beginPath();
  g.arc(128, 64, 30, 0, Math.PI * 2);
  g.fillStyle = '#f4f6f8';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = accent;
  g.stroke();
  g.beginPath();
  g.arc(128, 64, 14, 0, Math.PI * 2);
  g.fillStyle = base;
  g.fill();
  // Wordmark: duas barras assimétricas (finge texto sem esticar).
  g.fillStyle = accent;
  g.fillRect(70, 84, 62, 8);
  g.fillRect(70, 98, 42, 6);
  // Frame escuro fino.
  g.strokeStyle = 'rgba(18,28,44,0.9)';
  g.lineWidth = 5;
  g.strokeRect(3, 3, 250, 122);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Sponsor boards: 4 small roadside billboards (2.2x1.1x0.15 board on a 2.2m
 * pole) on the low-curvature straights (t = 0.05 / 0.28 / 0.55 / 0.82, all
 * curv < 0.0012), alternating sides so both edges read. Placed OUTSIDE the
 * guard-rail at roadW/2 + 2.6, boards face the road. Alternate 3 stripe
 * color schemes for organized variation.
 */
function buildSponsorBoards(path) {
  const halfW = getRoadWidthAt() / 2;
  const lateral = halfW + 2.6;
  const SPOTS = [
    { t: 0.05, side: 1, scheme: 0 },
    { t: 0.28, side: -1, scheme: 1 },
    { t: 0.55, side: 1, scheme: 2 },
    { t: 0.82, side: -1, scheme: 0 },
  ];
  const SCHEMES = [
    { base: 0x2ec4ff, stripe: 0xffffff }, // cyan / white
    { base: 0xff9f45, stripe: 0x1b2a41 }, // orange/white — was red/white (0xff5a5f), "placa vermelha lateral"
    { base: 0xffd166, stripe: 0x1b2a41 }, // yellow / navy
  ];
  const boardGeo = new THREE.BoxGeometry(2.2, 1.1, 0.15);
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 2.2, 8);
  const poleMat = toonMaterial(0x2b3340, {});
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const group = new THREE.Group();
  for (const s of SPOTS) {
    path.getPointAt(s.t, p);
    path.getTangentAt(s.t, tan);
    nrm.set(-tan.z, 0, tan.x).normalize();
    const bx = p.x + nrm.x * lateral * s.side;
    const bz = p.z + nrm.z * lateral * s.side;
    const scheme = SCHEMES[s.scheme];
    const mat = toonMaterial(0xffffff, { map: billboardTexture(scheme.base, scheme.stripe) });
    const board = new THREE.Mesh(boardGeo, mat);
    const by = p.y + 2.25 + 0.55; // pole top (2.2) + board half-height (0.55)
    board.position.set(bx, by, bz);
    // Face the road center at the SAME elevation → yaw only, board stays
    // vertical (no pitch from the track slope).
    board.lookAt(p.x, by, p.z);
    board.castShadow = true;
    group.add(board);
    cartoonOutline(board, 0x1b2a41, 0.035);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(bx, p.y + 0.05 + 1.1, bz); // base in the grass, top meets board
    pole.castShadow = true;
    group.add(pole);
  }
  return group;
}

/**
 * Roadside grass tufts: instanced clusters of 4 thin green cones (~0.08r x
 * 0.48h) every ~6m along BOTH edges, just outside the guard-rail at
 * roadW/2 + 1.8. Deliberately low (max ~0.58m, under the 0.6m camera
 * clearance) so they dress the ground without ever entering the view.
 * One InstancedMesh, per-instance green shade / yaw / scale jitter.
 */
function buildGrassTufts(path, length) {
  const halfW = getRoadWidthAt() / 2;
  const lateral = halfW + 1.8;
  const clusterCount = Math.max(1, Math.round(length / 4.5)); // AUDIT R12: 6m→4.5m — a beira lia 'esparsa'
  const perCluster = 5; // AUDIT R12: 4→5 cones
  // AUDIT FIX (2026-08-21, 'céu roxo na largada'): o multiplicador de
  // densidade escalava SÓ o buffer; o loop abaixo itera TODOS os clusters e
  // escrevia além da capacidade — a GPU lia matrizes de lixo e renderizava
  // cones gigantes esticados cobrindo o céu. Buffer agora tem capacidade
  // TOTAL do loop; a densidade é aplicada no count final (pós-loop).
  const total = clusterCount * 2 * perCluster; // both sides
  const tuftDensity = getDensityMultipliers().foliage;
  const geo = new THREE.ConeGeometry(0.08, 0.48, 6);
  const mat = toonMaterial(0xffffff, {});
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  const GREENS = [0x3fae4f, 0x57c05e, 0x2f8f3e, 0x6ccf6a];
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let idx = 0;
  for (let i = 0; i < clusterCount; i++) {
    const t = (i + 0.5) / clusterCount;
    // Keep the start/finish straight clear (gantry pillars sit at t≈0).
    if (t < 0.025 || t > 0.975) continue;
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    nrm.set(-tan.z, 0, tan.x).normalize();
    for (const side of [-1, 1]) {
      const baseX = p.x + nrm.x * lateral * side;
      const baseZ = p.z + nrm.z * lateral * side;
      for (let k = 0; k < perCluster; k++) {
        const jLat = (hash01(i, side, k, 0) - 0.5) * 0.9; // ±0.45m lateral
        const jFwd = (hash01(i, side, k, 1) - 0.5) * 1.1; // ±0.55m along track
        const hScale = 0.7 + hash01(i, side, k, 2) * 0.5; // 0.34..0.58m < 0.6m
        dummy.position.set(
          baseX + nrm.x * jLat + tan.x * jFwd,
          p.y + (0.48 * hScale) / 2 + (hash01(i, side, k, 3) - 0.5) * 0.06,
          baseZ + nrm.z * jLat + tan.z * jFwd
        );
        dummy.rotation.set(0, hash01(i, side, k, 4) * Math.PI * 2, 0);
        dummy.scale.set(hScale, hScale, hScale);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        col.setHex(GREENS[(i + side + k) % GREENS.length]);
        mesh.setColorAt(idx, col);
        idx++;
      }
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // AUDIT FIX (céu roxo): count = instâncias escritas, limitado pela fração
  // de densidade — nunca acima do que o buffer comporta.
  mesh.count = Math.min(idx, Math.floor(total * tuftDensity)); // skip unused slots (start-straight clearance)

  // AUDIT PISTA R11: flores 3D perto da pista — pontinhos de cor (branco/
  // amarelo/rosa/magenta/roxo) no prado; o crítico apontou 'grama uniforme,
  // textura simples'. 1 InstancedMesh extra (~1 flor a cada 2.5m por lado).
  const flowerTotal = Math.max(1, Math.round(clusterCount * 2.2)); // AUDIT R12: 1.4→2.2 (~1 flor a cada 2m por lado)
  const flowerGeo = new THREE.CircleGeometry(0.12, 8);
  const flowerMat = new THREE.MeshBasicMaterial({
    map: flowerTexture(), transparent: true, alphaTest: 0.05,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerTotal * 2);
  const FLOWERS = [0xffffff, 0xffd94a, 0xff8fb0, 0xd64a9a, 0xb07ae0, 0xffb066];
  let fidx = 0;
  for (let i = 0; i < flowerTotal; i++) {
    const t = (i + 0.5) / flowerTotal;
    if (t < 0.025 || t > 0.975) continue;
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    nrm.set(-tan.z, 0, tan.x).normalize();
    for (const side of [-1, 1]) {
      const off = halfW + 1.8 + hash01(i, side, 0, 7) * 1.6; // halfW+1.8..3.4
      const fx = p.x + nrm.x * off * side + tan.x * (hash01(i, side, 0, 8) - 0.5) * 0.8;
      const fz = p.z + nrm.z * off * side + tan.z * (hash01(i, side, 0, 8) - 0.5) * 0.8;
      const fs = 0.6 + hash01(i, side, 0, 9) * 0.5;
      dummy.position.set(fx, p.y + 0.055, fz);
      dummy.rotation.set(-Math.PI / 2, 0, hash01(i, side, 0, 10) * Math.PI * 2);
      dummy.scale.set(fs, fs, 1);
      dummy.updateMatrix();
      flowerMesh.setMatrixAt(fidx, dummy.matrix);
      col.setHex(FLOWERS[(i * 3 + side * 2 + 1) % FLOWERS.length]);
      flowerMesh.setColorAt(fidx, col);
      fidx++;
    }
  }
  flowerMesh.instanceMatrix.needsUpdate = true;
  if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
  flowerMesh.count = fidx;
  return [mesh, flowerMesh];
}

/** Pétalas de flor pintadas em canvas (corte circular com alphaTest). */
function flowerTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  // 6 pétalas elípticas em volta do centro (círculo branco de base).
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(32, 32, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff9e8';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.save();
    g.translate(32 + Math.cos(a) * 14, 32 + Math.sin(a) * 14);
    g.rotate(a);
    g.beginPath(); g.ellipse(0, 0, 7, 4.5, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Apex cone markers: small orange cones + white base rings along the kerb
 * (roadW/2 + 0.2) on the INSIDE edge of the 3 sharpest corners (curvature
 * scan → top local maxima), 5 cones per corner spaced 3m. Visual-only
 * (no collider) so they never block the kart.
 */
function buildApexCones(path, length, roadW) {
  const SAMPLES = 160;
  const dt = 1 / SAMPLES;
  const tan = new THREE.Vector3();
  const tan2 = new THREE.Vector3();
  const rows = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    path.getTangentAt(t, tan);
    path.getTangentAt(Math.min(1, t + dt), tan2);
    const curv = 1 - Math.min(1, Math.max(-1, tan.dot(tan2)));
    rows.push({ t, curv });
  }
  const peaks = [];
  for (let i = 1; i < SAMPLES - 1; i++) {
    const r = rows[i];
    if (r.curv > 0.0022 && r.curv >= rows[i - 1].curv && r.curv >= rows[i + 1].curv) {
      peaks.push(r);
    }
  }
  peaks.sort((a, b) => b.curv - a.curv);
  const apexes = [];
  for (const pk of peaks) {
    if (apexes.every((o) => Math.min(Math.abs(o.t - pk.t), 1 - Math.abs(o.t - pk.t)) > 0.1)) {
      apexes.push(pk);
      if (apexes.length === 3) break;
    }
  }
  if (apexes.length === 0) return null;

  const halfW = roadW / 2;
  const perCorner = 5;
  const dtSpacing = 3 / length; // 3m along the path
  const coneGeo = new THREE.ConeGeometry(0.16, 0.4, 8);
  const ringGeo = new THREE.CylinderGeometry(0.185, 0.185, 0.06, 12);
  const coneMat = toonMaterial(0xff7b2e, {});
  const ringMat = toonMaterial(0xffffff, {});
  // AUDIT FIX (2026-08-21, 'céu roxo'): buffer com capacidade TOTAL do loop
  // (≤15 instâncias — fator de densidade desnecessário neste volume); count
  // sincronizado pós-loop. Antes: buffer ×0.3 com loop cheio e count nunca
  // atribuído (ficava fracionário, ex. 4.5).
  const total = apexes.length * perCorner;
  const cones = new THREE.InstancedMesh(coneGeo, coneMat, total);
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, total);
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  let idx = 0;
  for (const apex of apexes) {
    // Inside edge = side the curvature center lies on. Signed 2D cross of
    // tangents: cross<0 → path bends toward -nrm → inside is the -nrm side
    // (verified: dot(centerDir, nrm*inside) ≈ 1 at every apex).
    path.getTangentAt(apex.t, tan);
    path.getTangentAt(Math.min(1, apex.t + dt), tan2);
    const inside = tan.x * tan2.z - tan.z * tan2.x < 0 ? -1 : 1;
    for (let k = 0; k < perCorner; k++) {
      const t = Math.min(0.999, Math.max(0.001, apex.t + (k - (perCorner - 1) / 2) * dtSpacing));
      path.getPointAt(t, p);
      path.getTangentAt(t, tan);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const cx = p.x + nrm.x * inside * (halfW + 0.2);
      const cz = p.z + nrm.z * inside * (halfW + 0.2);
      const baseY = p.y + 0.29; // kerb top (curb box center 0.22 + half-height 0.07)
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.position.set(cx, baseY + 0.2, cz); // cone center = base + half 0.4
      dummy.updateMatrix();
      cones.setMatrixAt(idx, dummy.matrix);
      dummy.position.set(cx, baseY + 0.03, cz); // white ring collar around the base
      dummy.updateMatrix();
      rings.setMatrixAt(idx, dummy.matrix);
      idx++;
    }
  }
  // AUDIT FIX (céu roxo): count sincronizado com as instâncias escritas.
  cones.count = idx;
  rings.count = idx;
  cones.instanceMatrix.needsUpdate = true;
  rings.instanceMatrix.needsUpdate = true;
  const g = new THREE.Group();
  g.add(cones, rings);
  return g;
}

/**
 * Brake boards "30/20/10" (AUDIT AAA 2026-08-15): placas de freada na borda
 * EXTERNA das 3 curvas mais fechadas (mesma varredura do buildApexCones), a
 * 27/18/9m antes do apex, viradas para o kart que se aproxima. Frame
 * instanced + 3 InstancedMesh de print (uma por rótulo) = 4 draw calls.
 */
function buildBrakeBoards(path, length, roadW) {
  const SAMPLES = 160;
  const dt = 1 / SAMPLES;
  const tan = new THREE.Vector3();
  const tan2 = new THREE.Vector3();
  const rows = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    path.getTangentAt(t, tan);
    path.getTangentAt(Math.min(1, t + dt), tan2);
    rows.push({ t, curv: 1 - Math.min(1, Math.max(-1, tan.dot(tan2))) });
  }
  const peaks = [];
  for (let i = 1; i < SAMPLES - 1; i++) {
    const r = rows[i];
    if (r.curv > 0.0022 && r.curv >= rows[i - 1].curv && r.curv >= rows[i + 1].curv) peaks.push(r);
  }
  peaks.sort((a, b) => b.curv - a.curv);
  const apexes = [];
  for (const pk of peaks) {
    if (apexes.every((o) => Math.min(Math.abs(o.t - pk.t), 1 - Math.abs(o.t - pk.t)) > 0.1)) {
      apexes.push(pk);
      if (apexes.length === 3) break;
    }
  }
  if (!apexes.length) return null;
  const BOARD_T = [27 / length, 18 / length, 9 / length];
  const LABELS = ['30', '20', '10'];
  const halfW = roadW / 2;
  const frameGeo = new THREE.BoxGeometry(1.15, 0.8, 0.09);
  const printGeo = new THREE.PlaneGeometry(1.05, 0.7);
  const frameMat = toonMaterial(0x2b3242, {});
  const labelTex = (txt) => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 96);
    g.strokeStyle = '#1b2a41';
    g.lineWidth = 7;
    g.strokeRect(3, 3, 122, 90);
    g.fillStyle = '#1b2a41';
    g.font = '900 52px "Baloo 2", "Nunito", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(txt, 64, 50);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const labelMats = LABELS.map((l) => new THREE.MeshBasicMaterial({ map: labelTex(l), side: THREE.DoubleSide }));
  // AUDIT FIX (2026-08-21, 'céu roxo'): buffer com capacidade TOTAL do loop
  // (≤9 frames — densidade desnecessária neste volume); count sincronizado
  // pós-loop. Antes: buffer ×0.3 com loop escrevendo até 9 e count fracionário.
  const total = apexes.length * BOARD_T.length;
  const frames = new THREE.InstancedMesh(frameGeo, frameMat, total);
  const prints = labelMats.map((m) => new THREE.InstancedMesh(printGeo, m, apexes.length));
  const dummy = new THREE.Object3D();
  const nrm = new THREE.Vector3();
  const p = new THREE.Vector3();
  let fIdx = 0;
  for (const apex of apexes) {
    path.getTangentAt(apex.t, tan);
    path.getTangentAt(Math.min(1, apex.t + dt), tan2);
    const inside = tan.x * tan2.z - tan.z * tan2.x < 0 ? -1 : 1;
    const apexIdx = apexes.indexOf(apex);
    for (let b = 0; b < BOARD_T.length; b++) {
      const t = Math.max(0.001, apex.t - BOARD_T[b]);
      if (t < 0.02 || t > 0.98) continue; // longe do grid/looping
      path.getPointAt(t, p);
      path.getTangentAt(t, tan);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const bx = p.x + nrm.x * (-inside) * (halfW + 1.6); // lado EXTERNO (oposto dos cones)
      const bz = p.z + nrm.z * (-inside) * (halfW + 1.6);
      const by = p.y + 0.55;
      dummy.position.set(bx, by, bz);
      dummy.lookAt(p.x - tan.x * 8, by, p.z - tan.z * 8); // face p/ quem se aproxima
      dummy.updateMatrix();
      frames.setMatrixAt(fIdx, dummy.matrix);
      dummy.translateZ(0.05); // print 5cm à frente da face do box (padrão R70 dos banners)
      dummy.updateMatrix();
      prints[b].setMatrixAt(apexIdx, dummy.matrix);
      fIdx++;
    }
  }
  // AUDIT FIX (céu roxo): count sincronizado com as instâncias escritas.
  frames.count = fIdx;
  frames.instanceMatrix.needsUpdate = true;
  prints.forEach((m) => { m.instanceMatrix.needsUpdate = true; });
  const g = new THREE.Group();
  g.add(frames, ...prints);
  return g;
}

/** Road sponsor decal card: a faded brand-color block with a worn darker
 *  border, text-like noise (pseudo-glyph wordmark) and grime — paint on
 *  asphalt, not a floating board. */
function roadDecalTexture(baseHex, accentHex) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const base = '#' + baseHex.toString(16).padStart(6, '0');
  const accent = '#' + accentHex.toString(16).padStart(6, '0');
  g.globalAlpha = 0.92;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 128);
  // Worn border (irregular paint edge).
  g.globalAlpha = 0.55;
  g.strokeStyle = 'rgba(10,14,20,0.8)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 122);
  // Text-like noise: a row of pseudo-glyph strokes that reads as a sponsor
  // wordmark without spelling anything.
  g.globalAlpha = 0.9;
  g.fillStyle = accent;
  let x = 16;
  while (x < 232) {
    const w = 6 + Math.random() * 5;
    const h = 26 + Math.random() * 18;
    const y = 42 + Math.random() * 10;
    g.fillRect(x, y, w, h); // vertical stem
    if (Math.random() > 0.45) g.fillRect(x, y + h - 6, w + 16, 5); // crossbar
    if (Math.random() > 0.65) g.fillRect(x + w + 2, y + 6, 8, 5); // mid bar
    x += 10 + Math.random() * 8;
  }
  // Logo disc.
  g.beginPath();
  g.arc(226, 26, 15, 0, Math.PI * 2);
  g.fillStyle = accent;
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = base;
  g.stroke();
  // Grime + tire streaks (karts drive over these).
  g.globalAlpha = 0.18;
  g.fillStyle = '#0a0e14';
  for (let i = 0; i < 240; i++) {
    g.fillRect(Math.random() * 256, Math.random() * 128, 2 + Math.random() * 4, 1 + Math.random() * 2);
  }
  g.globalAlpha = 0.28;
  g.fillRect(0, 44, 256, 3);
  g.fillRect(0, 82, 256, 3);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Painted sponsor decals ON the asphalt near the straights — large faded
 * brand-color blocks with text-like noise and grime, exactly like real
 * circuits paint their sponsors on the racing surface. Painted at y+0.21
 * with polygonOffset (same decal technique as the finish line), slightly
 * transparent so the asphalt grain shows through the paint.
 */
function buildRoadSponsorDecals(path) {
  // AUDIT (Feco, 2026-08-11, 2x): 'marcações estranhas com texto no chão' —
  // the painted 'sponsor' decals read as smudged lettering on the asphalt
  // ("MARIO KART" at speed) and break the clean road. Real MK8 surfaces don't
  // put text on the racing line; removed entirely (the call site no-ops).
  return null;
  /* eslint-disable no-unreachable */
  const halfW = getRoadWidthAt() / 2;
  const SCHEMES = [
    { base: 0x1fa8d8, accent: 0xffffff },
    { base: 0xd8493f, accent: 0xffffff },
    { base: 0xe87a2a, accent: 0x1b2a41 },
    { base: 0x3fa44e, accent: 0xffffff },
    { base: 0xe2b13c, accent: 0x1b2a41 },
    { base: 0x7b5cbf, accent: 0xffffff },
  ];
  // Low-curvature straights, clear of the start grid (t<0.07), the ramps
  // (0.30/0.86) and the turbo clusters (0.18/0.72).
  const CANDIDATES = [0.08, 0.46, 0.50, 0.62, 0.80, 0.92];
  const RAMP_TS = [0.30, 0.86]; // sponsor-decals clearance (historical ts)
  const TURBO_TS = CONFIG.track.turboPadTs || [];
  const tan = new THREE.Vector3();
  const tan2 = new THREE.Vector3();
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const dt = 1 / 160;
  const spots = [];
  for (const t of CANDIDATES) {
    path.getTangentAt(t, tan);
    path.getTangentAt(Math.min(1, t + dt), tan2);
    const curv = 1 - Math.min(1, Math.max(-1, tan.dot(tan2)));
    if (curv > 0.0012) continue;
    let clash = false;
    for (const rt of RAMP_TS) {
      if (Math.min(Math.abs(t - rt), 1 - Math.abs(t - rt)) < 0.05) clash = true;
    }
    for (const tt of TURBO_TS) {
      if (Math.min(Math.abs(t - tt), 1 - Math.abs(t - tt)) < 0.05) clash = true;
    }
    if (!clash) spots.push(t);
  }
  if (spots.length === 0) return null;

  const group = new THREE.Group();
  // X = across the road, Y = along the track (finish-line convention).
  const geo = new THREE.PlaneGeometry(3.6, 5.4);
  for (let i = 0; i < spots.length; i++) {
    const t = spots[i];
    const scheme = SCHEMES[i % SCHEMES.length];
    const mat = new THREE.MeshStandardMaterial({
      map: roadDecalTexture(scheme.base, scheme.accent),
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    nrm.set(-tan.z, 0, tan.x).normalize();
    const side = i % 2 === 0 ? 1 : -1;
    const lx = nrm.x * side * halfW * 0.3;
    const lz = nrm.z * side * halfW * 0.3;
    mesh.position.set(p.x + lx, p.y + 0.21, p.z + lz);
    mesh.lookAt(p.x + tan.x + lx, p.y, p.z + tan.z + lz);
    mesh.rotateX(-Math.PI / 2);
    mesh.rotation.z += (hash01(i, 3) - 0.5) * 0.03; // hand-painted yaw jitter
    group.add(mesh);
  }
  return group;
}

export function buildTrack(scene, trackPath = TRACK_PATH) {
  const group = new THREE.Group();

  // NEON CITY (track 2, ?track=2) restyles the road dark, the kerbs neon and
  // the rails metallic. Visual-only: roadWidth, ramps and all placement
  // logic stay identical, so the kart physics is untouched.
  const isCity = trackPath === CITY_PATH;

  // Closed curve with elevation.
  const pts = trackPath.map((v) => v.clone());
  const path = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  const length = path.getLength();

  const startT = 0;
  const startPos = path.getPointAt(startT);
  const startDir = path.getTangentAt(startT).normalize();

  const cityMode = trackPath === CITY_PATH;
  const terrain = buildTerrain(path, cityMode);
  group.add(terrain);

  // Dirt shoulders either side of the asphalt (softens the road→grass edge).
  // Textured now — was a flat tan ribbon (audit V3).
  // AUDIT R21z (CAUSA RAIZ FINAL, GPU real): o shoulder TAN (#d9b98c) existia
  // também no Neon — a faixa de terra em perspectiva + bloom + warm grade =
  // a "COLINA/FIXA OLIVA" do horizonte (pixels medidos 70,61,2). Na cidade o
  // shoulder vira concreto escuro (calçada urbana), não terra.
  const shoulder = buildRoadRibbon(path, length, {
    width: getRoadWidthAt() + 3.4,
    yOffset: 0.14,
    texture: isCity ? concreteTexture : dirtTexture,
    repeatU: length * 0.04,
    repeatV: 1,
    ...(isCity ? { color: 0x3a3f4d } : {}),
  });
  shoulder.receiveShadow = true;
  group.add(shoulder);

  const ribbonOpts = { texture: roadTexture };
  if (isCity) {
    ribbonOpts.texture = cityRoadTexture; // baked neon spill on the asphalt
    ribbonOpts.emissiveMap = true; // the spill patches GLOW (vision 7/10 pass)
    ribbonOpts.color = 0xffffff; // deixar a textura cityRoadTexture (charcoal #4c5268) ser a cor base — o opts.color sobrescreve o material depois de mat.map ser setado, então 0xffffff preserva o charcoal natural
    // AUDIT R4: emissive 0xffffff carrega as cores reais do mapa (magenta/ciano/amarelo) sem saturar.
    // TICK 20:00Z (isolamento GPU V0/V1 streaky, V2/V3 limpo): intensity 0.8
    // amplificava as micro-streaks/poças do mapa em GLOW multicolorido que em
    // grazing lia como sujeira; 0.3 mantém o spill legível sem o smear.
    ribbonOpts.emissive = 0xffffff;
    ribbonOpts.emissiveIntensity = 0.3;
    // AUDIT PISTA R11 (2026-08-16): asfalto MOLHADO — clearcoat + sheen
    // especular contínuo (cue wet-street MK8); sem ele a rua lia matte.
    ribbonOpts.wet = true;
  }
  const ribbon = buildRoadRibbon(path, length, ribbonOpts);
  ribbon.receiveShadow = true;
  group.add(ribbon);

  // AUDIT R5 (critic Neon R4 5/10: 'pista não parece molhada'): overlay de
  // reflexo — ribbon aditiva com as janelas da cidade refletidas (faixas
  // verticais), o cue clássico MK8 de rua molhada.
  if (isCity) {
    const reflect = buildRoadRibbon(path, length, {
      width: getRoadWidthAt() * 0.82, // não cobre as bordas (barreiras)
      yOffset: 0.195, // acima da ribbon (0.18) e dos overlays (0.181-0.182)
      texture: neonReflectionTexture,
      repeatU: length * 0.05,
      repeatV: 2.5, // AUDIT R6: mais faixas ACROSS (V) — liam como uma faixa
      transparent: true,
      opacity: 0.35, // AUDIT R6: 0.22 sumia na textura da pista
      depthWrite: false,
      // AUDIT PISTA R11: reflexo ADITIVO + toneMapped=false — o reflexo das
      // janelas BRILHA de verdade (não só escurece/ilumina sutilmente).
      additive: true,
      toneMapped: false,
    });
    reflect.renderOrder = 3; // desenha DEPOIS da pista (transparent pass)
    group.add(reflect);

    // AUDIT AAA (2026-08-15): ruas de cidade têm linha de borda SÓLIDA.
    // 2 ribbons brancas contínuas logo dentro da borda (±4.12m), 2mm acima do
    // racing-line overlay (0.181), polygonOffset anti-z-fight (padrão edge shadow).
    for (const side of [-1, 1]) {
      const edgeLine = buildRoadRibbon(path, length, {
        width: 0.14,
        yOffset: 0.182,
        lateral: side * (getRoadWidthAt() / 2 - 0.38),
        color: 0xf4f7fb,
        transparent: true,
        opacity: 0.9,
        roughness: 0.7,
        polygonOffset: true,
      });
      edgeLine.material.toneMapped = false; // branco puro sob ACES (padrão lane dashes)
      edgeLine.renderOrder = 1;
      group.add(edgeLine);
    }
  }

  // City asphalt already carries a restrained, uniform neon reflection map.
  // The full-width rubber overlay made Neon look split into two road materials.
  if (!isCity) group.add(buildRacingLineOverlay(path, length));
  // Dark curb shadow line where asphalt meets kerb (edge depth cue).
  group.add(buildEdgeShadowLine(path, length, isCity));

  // Red/white kerbs along both edges (kart-circuit look — was disabled due to
  // the y+0.11-buried + rotateX bugs; now fixed). NEON CITY swaps them for
  // alternating emissive pink/cyan.
  const curbL = buildCurbs(path, length, -1, { neon: isCity });
  const curbR = buildCurbs(path, length, 1, { neon: isCity });
  group.add(curbL, curbR);

  // NEON CITY sidewalks (light concrete strips flanking the road).
  if (isCity) {
    group.add(buildSidewalk(path, length, -1), buildSidewalk(path, length, 1));
  }

  // Continuous guard-rails along both edges. Edge hierarchy is now organized:
  // asphalt → curbs → guard rail (roadW/2 + 0.6) → grass. Placed outside the
  // curb so the racing line is never blocked. NEON CITY: metallic dark rails
  // with an emissive pink top strip.
  group.add(buildGuardRail(path, length, -1, { neon: isCity }), buildGuardRail(path, length, 1, { neon: isCity }));

  // Track-side density: sponsor boards on the straights, low grass tufts
  // along both edges, and orange apex cones on the inside of the sharpest
  // corners — all OUTSIDE the racing line (visual-only, no colliders).
  // Meadow dressing (grass tufts, sponsor boards, apex cones) is SUNNY-MEADOW
  // specific — NEON CITY must read urban, not 'meadow with neon trim'
  // (vision critic: repeated spherical tufts read as procedural placeholders).
  if (!isCity) {
    group.add(buildSponsorBoards(path));
    group.add(...buildGrassTufts(path, length)); // AUDIT R11: retorna [tufts, flores]
    const apexCones = buildApexCones(path, length, getRoadWidthAt());
    if (apexCones) group.add(apexCones);
    // AUDIT AAA: placas de freada 30/20/10 na borda externa antes do apex
    const brakeBoards = buildBrakeBoards(path, length, getRoadWidthAt());
    if (brakeBoards) group.add(brakeBoards);
  }

  // Painted sponsor decals on the asphalt near the straights (real circuits
  // paint their sponsors on the road surface — large faded blocks).
  const roadDecals = buildRoadSponsorDecals(path);
  if (roadDecals) group.add(roadDecals);

  const dashes = buildLaneDashes(path, length, isCity);
  group.add(dashes);

  const arrows = buildDirectionArrows(path);
  if (arrows) group.add(arrows);

  const tires = buildTireBarriers(path, getRoadWidthAt());
  if (tires) group.add(tires);

  const turbo = buildTurboPads(path, length);
  group.add(turbo.mesh);

  // AUDIT (city redesign, 2026-08-11): the old hardcoded ts [0.30, 0.86]
  // put a ramp INSIDE the new top-right return corner (curvature ~0.08-0.10,
  // not <0.001 as the old comment claimed) — a vY=6.5 launch there flies
  // ~40m across the rail. New ts sit mid-straights (0.13 = top straight,
  // 0.84 = bottom straight) AND every candidate is curvature-checked
  // (skipped unless the local radius is straight enough).
  const RAMP_TS = [0.20, 0.57]; // top straight + mid straight (curv ~0)
  const rampT = [];
  for (const rt of RAMP_TS) {
    const ta = path.getTangentAt(Math.max(0.001, rt - 0.005));
    const tb = path.getTangentAt(Math.min(0.999, rt + 0.005));
    const curv = ta.angleTo(tb) / 0.01; // rad per meter
    if (curv < 0.03) rampT.push(rt); // straight enough to launch
  }
  const ramps = buildRamps(path, length, rampT);
  for (const r of ramps) {
    group.add(r.mesh);
    // chev is parented to r.mesh now (stays flush on the slope) — it must
    // NOT be re-added here or it would detach from the ramp.
  }

  const startLine = { position: startPos.clone(), direction: startDir.clone(), width: getRoadWidthAt() };
  const gantry = buildGantry(startLine);
  group.add(gantry.group);
  startLine.banner = gantry.banner; // main.js waves it like fabric

  // Checkered finish line painted on the asphalt (proper yaw this time —
  // reads as paint, not a floating slab).
  group.add(buildFinishLine(startLine));

  // AUDIT r7: start-grid pole numbers — a numbered disc painted on the
  // asphalt at every grid slot (white number on a dark disc, MK8-style).
  // Mirrors main.js buildGridPositions() slot layout so each kart sits on
  // its own number; the discs read upright from the start camera behind
  // the grid (texture V points along the direction of travel).
  group.add(buildGridNumbers(startLine));

  // Finish checkered strip on the road itself at startT.
  // REMOVED — the painted decal read as a floating board in the middle of
  // the track. The hanging gantry banner is the finish marker now.
  // const checker = new THREE.Mesh(...)

  scene.add(group);

  const waypoints = [];
  const WAY_COUNT = 90;
  for (let i = 0; i < WAY_COUNT; i++) {
    waypoints.push(path.getPointAt(i / WAY_COUNT).clone());
  }

  return { group, path, waypoints, startLine, length, isCity, startLights: gantry.startLights, turboPads: { ts: turbo.ts, points: turbo.points }, ramps };
}

/**
 * Trick ramps on two straights — the air system (vY/gravity/_airTime) was
 * dead code with nothing ever setting vY > 0. A ramp launches the kart;
 * pressing throttle mid-air arms a trick → landing mini-boost (MK8 pillar).
 *
 * Geometry (USER BUG FIX): the old ramp was a plain BoxGeometry rotated
 * x=0.3 around its CENTER — the low end sank ~0.34m INTO the asphalt and
 * the high end floated, reading "crooked, half buried". It is now a wedge
 * (prism) whose bottom face is flat on the asphalt; the slope is built
 * into the geometry, so the base never penetrates the road.
 */
function buildRampGeometry(width, height, length) {
  const geo = new THREE.BufferGeometry();
  const W = width / 2;
  const H = height;
  const L = length / 2;
  const verts = [];
  const tri = (a, b, c) => verts.push(...a, ...b, ...c);
  // Ground corners (y=0) — back at -L, front at +L.
  const bl = [-W, 0, -L];
  const br = [W, 0, -L];
  const fl = [-W, 0, L];
  const fr = [W, 0, L];
  // Top corners at the tall (front) end.
  const tl = [-W, H, L];
  const tr = [W, H, L];
  // Ramp surface (inclined top, normal up/forward)
  tri(bl, tl, tr); tri(bl, tr, br);
  // Front face (vertical at the tall end, normal +Z)
  tri(fl, fr, tr); tri(fl, tr, tl);
  // Left side triangle (normal -X)
  tri(bl, fl, tl);
  // Right side triangle (normal +X)
  tri(br, tr, fr);
  // Bottom face (normal -Y — sits on the asphalt)
  tri(bl, br, fr); tri(bl, fr, fl);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Trapezoid side brace for the trick ramp: a thin plate under the tall end
 * that follows the ramp's slope (the back-top vertex sits ON the top face),
 * so it reads as structural support without poking through the surface.
 * Built centered on X=0 with `thickness` in X; instance it at ±(width/2 + m).
 */
function buildRampBraceGeometry(rampWidth, rampHeight, rampLen, braceLen, thickness) {
  const L = rampLen / 2;
  const H = rampHeight;
  const yBack = (H * (2 * L - braceLen)) / (2 * L); // ramp surface height at the brace's back edge
  const t = thickness / 2;
  const verts = [];
  const tri = (a, b, c) => verts.push(...a, ...b, ...c);
  // Two rings at x=±t: back-bottom, front-bottom, front-top, back-top.
  const bb = [-t, 0, L - braceLen]; const bb2 = [t, 0, L - braceLen];
  const fb = [-t, 0, L]; const fb2 = [t, 0, L];
  const ft = [-t, H, L]; const ft2 = [t, H, L];
  const bt = [-t, yBack, L - braceLen]; const bt2 = [t, yBack, L - braceLen];
  tri(bb2, fb2, ft2); tri(bb2, ft2, bt2);   // outer face (+X)
  tri(bb, bt, ft); tri(bb, ft, fb);         // inner face (-X)
  tri(bb, bb2, fb2); tri(bb, fb2, fb);      // bottom
  tri(bb, bt, bt2); tri(bb, bt2, bb2);      // back edge
  tri(fb, fb2, ft2); tri(fb, ft2, ft);      // front edge
  tri(bt, ft, ft2); tri(bt, ft2, bt2);      // sloped top edge
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

function buildRamps(path, length, rampTs) {
  const ramps = [];
  // Toon ramp body (audit v4 F1: was the only non-toon surface — read as a
  // flat orange crate) + painted chevrons on the top face.
  // AUDIT visual 2026-08-12: ramp read as a flat brown block at night
  // (toon darkened under low light + chevrons amber-on-orange = no contrast).
  // Brighter orange + emissive keeps the ramp saturated; white chevrons
  // (turboPadChevronTexture already draws white on amber) pop against it.
  const mat = toonMaterial(0xe07b2e, { side: THREE.DoubleSide, emissive: 0xc96f2c, emissiveIntensity: 0.3 });
  const chevMat = new THREE.MeshBasicMaterial({ map: turboPadChevronTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide });
  chevMat.toneMapped = false;
  const tan = new THREE.Vector3();
  const p = new THREE.Vector3();
  // Taller + longer so the ramp reads as a LAUNCH RAMP, not a speed bump
  // (vision critic: "too low, almost flush with the road"). r.point stays at
  // the path point (the ramp's top-center) — the KartPhysics <2.7m trigger
  // and vY=6.5 launch are untouched. The kart rises ~6.5 m/s vs the ramp's
  // ~0.14*forwardSpeed climb, so it clears the slope without clipping.
  const rampLen = 5.4;
  const rampHeight = 1.0; // AUDIT visual 2026-08-12: taller slope reads as a ramp (7.9°→10.5°)
  const rampWidth = CONFIG.track.roadWidth * 0.78;
  const rampGeo = buildRampGeometry(rampWidth, rampHeight, rampLen);
  // Side support braces: trapezoid fins under the tall end, flush against the
  // wedge's side faces (they follow the slope exactly — no poking through).
  const braceGeo = buildRampBraceGeometry(rampWidth, rampHeight, rampLen, 2.2, 0.1);
  const braceMat = toonMaterial(0x2b3340, { side: THREE.DoubleSide });
  // Slope of the top face, for the chevron decal to lie flush on it.
  const slopeAngle = Math.atan2(rampHeight, rampLen);
  // Ramps on the long straights, placed + curvature-checked by the caller
  // (buildTrack filters to straight candidates; clear of turbo clusters).
  for (const t of rampTs || []) {
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    const mesh = new THREE.Mesh(rampGeo, mat);
    // Base sits flat on the asphalt top (ribbon y+0.18) + 2mm clearance —
    // NO rotation.x: the wedge already carries the slope, so neither end
    // sinks into the road nor floats above it.
    mesh.position.set(p.x, p.y + 0.18 + 0.02, p.z);
    mesh.rotation.y = Math.atan2(tan.x, tan.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Side support braces (one per side, just outside the wedge's side faces).
    for (const sx of [-1, 1]) {
      const brace = new THREE.Mesh(braceGeo, braceMat);
      brace.position.set(sx * (rampWidth / 2 + 0.05), 0, 0);
      brace.castShadow = true;
      mesh.add(brace);
      // AUDIT R2: dark skirt fin along the wedge side face — the incline
      // profile reads even from the chase cam (critic: 'bloco laranja plano').
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, rampHeight, rampLen),
        braceMat
      );
      skirt.position.set(sx * (rampWidth / 2 + 0.03), rampHeight / 2, 0);
      skirt.castShadow = false;
      mesh.add(skirt);
    }
    // Chevron decal PARENTED to the ramp: lies flush on the inclined top
    // face. rotation -PI/2 - slopeAngle makes the plane's normal match the
    // surface normal (the old +sign tilted it 2*slope off the face — half
    // buried at the tall end). The Z-spin turns the ">>>" so they point UP
    // the ramp, along the direction of travel.
    const chev = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.0), chevMat); // AUDIT R2: bigger chevrons read as arrows at speed
    chev.rotation.set(-Math.PI / 2 - slopeAngle, 0, -Math.PI / 2);
    chev.position.set(0, rampHeight / 2 + 0.006, 0);
    chev.renderOrder = 1;
    mesh.add(chev);
    ramps.push({ t, point: p.clone(), dir: tan.clone(), mesh, chev, length: rampLen, height: rampHeight });
  }
  return ramps;
}
