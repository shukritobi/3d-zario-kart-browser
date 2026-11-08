/**
 * Super Kart 3D.js — environment builder.
 * Sky dome, sun + hemisphere light, fog, animated clouds, layered
 * mountains, palm trees, water and crowd props. Cartoon saturated style
 * per DESIGN.md. update(dt, t) animates clouds, water and flags.
 *
 * DENSE, non-low-poly geometry throughout (24-seg mountains with snow
 * caps, 14x10 canopies, detail-1 rocks, 16x14 balloons) and PLANNED
 * placement: trees every ~12m along the track, clustered rocks/bushes,
 * wildflower patches, staggered cloud lanes — nothing scattered at random.
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
import { toonMaterial, cartoonOutline, applyWindSway } from '../render/Materials.js';
import { terrainHeight } from './TrackBuilder.js';
import { makeMarshalCone, makeBollard, makeContactShadow } from '../render/WorldPropKit.js';

// Mirrors TrackBuilder.terrainHeight so props sit at the same terrain height
// (incl. the rolling hills — the old flat smoothH copy made far props float).
function smoothH(x, z) {
  return (
    Math.sin(x * 0.08) * Math.cos(z * 0.1) * 0.18 +
    Math.sin(x * 0.31 + 1.7) * Math.cos(z * 0.23) * 0.09 +
    Math.sin(x * 0.045 + z * 0.06) * 0.15
  );
}

// Deterministic pseudo-random generator (seedable) — prop placement is
// PLANNED: the same organized layout every load, with organic-looking
// jitter instead of frame-to-frame scatter.
function rnd(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Structural mountain geometry (MK8-style alpine backdrop)
// ---------------------------------------------------------------------------
// Deterministic angular noise for the ridge: a pure function of angle (and
// seed) so every layer of a mountain (rock bands, snowline, summit crest)
// can reuse the SAME noise family and stay glued to one ridgeline. Octave
// mix keeps the profile jagged but never spiky.
function ridgeNoise(a, seed) {
  const s = seed * 0.01;
  return (
    Math.sin(a * 3 + s * 13.7) * 0.55 +
    Math.sin(a * 7 + s * 29.3) * 0.3 +
    Math.sin(a * 13 + s * 47.1) * 0.15
  );
}

/**
 * One mountain as a SINGLE columnar mesh (no cone + cap pair): per-vertex
 * color layers + a per-segment broken snowline, so the range reads as
 * geology instead of repeated triangles.
 *
 * Structural differences vs the old ridged cone + straight-cut cap:
 *  - CONE PROFILE: small radial jitter (0.05-0.10) from ridgeNoise, growing
 *    toward the summit (0.3 + 0.7t), clamped to 5% of baseR so rings never
 *    collapse into degenerate triangles that rasterize black.
 *  - SUMMIT CREST: the top ring is a tiny loop whose HEIGHT varies per
 *    segment (apexH = 1 + peakAmp * noise) — the silhouette is a broken
 *    crest line, never a single triangle apex.
 *  - 3 VALUE-CONTRAST LAYERS via a 'color' attribute: dark rock base → mid
 *    rock → snow cap. The snow boundary is NOT a horizontal cut: every
 *    segment gets its own threshold snowT[i] (two noise octaves), so the
 *    snowline zigzags down the gullies and up the ridges — a BROKEN edge.
 *    The dark/mid boundary is likewise noise-modulated, so the bands read
 *    as shaded ridge flanks, not stripes.
 *  - profile: 'peak' (cone), 'dome' (rounded, cosine falloff) or 'butte'
 *    (flat summit plateau + snow cap fan).
 * Hand-computed RADIAL normals (point outward in XZ) — vertex jitter
 * inverts some windings and computeVertexNormals averaged those inward,
 * rasterizing black; the caller also uses DoubleSide. Unlit
 * MeshBasicMaterial ignores normals anyway (backdrop), but the attribute
 * stays correct. Deterministic: every value derives from the passed seeds.
 */
function mountainGeometry(baseR, h, segs, rings, opts = {}) {
  const {
    jitter = 0.07,
    seed = 1,
    profile = 'peak',
    snowT0 = 0.6,
    snowAmp = 0.12,
    snowSeed = 2,
    midT0 = 0.36,
    midAmp = 0.1,
    midSeed = 3,
    peakAmp = 0.1,
    colors = null, // { dark, mid, snow } — THREE.Color
  } = opts;
  const positions = [];
  const normals = [];
  const colArr = [];
  const indices = [];
  const s0 = seed * 0.01;
  const s1 = snowSeed * 0.013;
  const s2 = midSeed * 0.017;

  // Vertical radius profile (fraction of baseR at height t: 0 = ground,
  // 1 = summit). Cone tapers straight; dome keeps a fat base and rounds
  // over; butte holds a near-constant rim then a thin skirt.
  const radFn = (t) => {
    if (profile === 'butte') {
      const bt = 0.82;
      const rim = 0.82;
      return t < bt
        ? 1 - (1 - rim) * (t / bt)
        : rim * (1 - 0.06 * ((t - bt) / (1 - bt)));
    }
    if (profile === 'dome') return Math.pow(Math.cos(t * Math.PI * 0.5), 0.8);
    return 1 - t;
  };

  // Per-segment broken boundaries + crest heights (computed once per column).
  const snowT = new Array(segs);
  const midT = new Array(segs);
  const apexH = new Array(segs);
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const nS = Math.sin(a * 5 + s1 * 13.1) * 0.6 + Math.sin(a * 11 + s1 * 29.7) * 0.4;
    const nM = Math.sin(a * 4 + s2 * 11.3) * 0.55 + Math.sin(a * 9 + s2 * 23.9) * 0.45;
    snowT[i] = Math.min(0.95, Math.max(0.18, snowT0 + nS * snowAmp));
    midT[i] = Math.min(snowT[i] - 0.1, Math.max(0.06, midT0 + nM * midAmp));
    apexH[i] = 1 + peakAmp * (Math.sin(a * 6 + s0 * 17.3) * 0.65 + Math.sin(a * 13 + s0 * 31.9) * 0.35);
  }

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const yBase = h * t;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const j = ridgeNoise(a, seed) * jitter * (0.3 + 0.7 * t);
      const rad = Math.max(baseR * 0.05, baseR * radFn(t) * (1 + j));
      const y = yBase * apexH[i];
      positions.push(Math.cos(a) * rad, y, Math.sin(a) * rad);
      // RADIAL normals (outward in XZ) — never computeVertexNormals here.
      normals.push(Math.cos(a), 0, Math.sin(a));
      if (colors) {
        const col = t >= snowT[i] ? colors.snow : t >= midT[i] ? colors.mid : colors.dark;
        colArr.push(col.r, col.g, col.b);
      }
    }
  }
  // Ring-column quads, CORRECTLY indexed: (r,i)->(r+1,i)->(r,i+1)->(r+1,i+1).
  // The old cone builder used d = b + (i+1)%segs, which overran the last
  // ring (dropped triangles at the summit) and twisted the wrap column
  // (degenerate b,b,c) — invisible slivers at a cone apex, but holes along a
  // dome/butte rim. d is now the true (r+1, i+1) vertex: in-range every ring.
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < segs; i++) {
      const ni = (i + 1) % segs;      // next segment (wraps)
      const a = r * segs + i;         // (r, i)
      const b = a + segs;             // (r+1, i)
      const c = r * segs + ni;        // (r, i+1)
      const d = (r + 1) * segs + ni;  // (r+1, i+1) — always in range
      indices.push(a, b, c, b, d, c);
    }
  }
  // Flat snow summit for buttes: the top ring is a wide plateau loop, so
  // close it with a fan (snow color, up-facing normal).
  if (profile === 'butte' && colors) {
    const ci = positions.length / 3;
    positions.push(0, h, 0);
    normals.push(0, 1, 0);
    colArr.push(colors.snow.r, colors.snow.g, colors.snow.b);
    const top0 = rings * segs;
    for (let i = 0; i < segs; i++) {
      const t0 = top0 + i;
      const t1 = top0 + ((i + 1) % segs);
      indices.push(ci, t1, t0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  geo.setIndex(indices);
  return geo;
}

/** One 3D grass blade: a TAPERED BOX (thin stretched box — not a flat quad).
 *  w wide along its lean azimuth, th thick across, h tall, leaning `lean`·h
 *  toward azimuth az. 8 corners + 4 side faces; the tip cap is skipped (it is
 *  sub-centimetre, invisible, and saves 2 tris). A box cross-section reads 3D
 *  from every angle — the old flat billboard quads were the 16-bit cue. */
function grassBladeBox(positions, indices, v, w, th, h, lean, az) {
  const dx = Math.cos(az);
  const dz = Math.sin(az);
  const px = -dz; // thickness axis (perpendicular to the lean azimuth)
  const pz = dx;
  const tipX = dx * lean * h;
  const tipZ = dz * lean * h;
  const hw = w / 2;
  const ht = th / 2;
  const tw = w * 0.22; // narrowed tip
  const thh = th * 0.55;
  // base ring: ±hw along the azimuth, ±ht across (a real box cross-section)
  positions.push(hw * dx + ht * px, 0, hw * dz + ht * pz);
  positions.push(hw * dx - ht * px, 0, hw * dz - ht * pz);
  positions.push(-hw * dx - ht * px, 0, -hw * dz - ht * pz);
  positions.push(-hw * dx + ht * px, 0, -hw * dz + ht * pz);
  // tip ring: narrowed, shifted toward the lean direction
  positions.push(tipX + tw * dx + thh * px, h, tipZ + tw * dz + thh * pz);
  positions.push(tipX + tw * dx - thh * px, h, tipZ + tw * dz - thh * pz);
  positions.push(tipX - tw * dx - thh * px, h, tipZ - tw * dz - thh * pz);
  positions.push(tipX - tw * dx + thh * px, h, tipZ - tw * dz + thh * pz);
  // 4 side quads (base ring -> tip ring)
  indices.push(v, v + 4, v + 5, v, v + 5, v + 1);
  indices.push(v + 1, v + 5, v + 6, v + 1, v + 6, v + 2);
  indices.push(v + 2, v + 6, v + 7, v + 2, v + 7, v + 3);
  indices.push(v + 3, v + 7, v + 4, v + 3, v + 4, v);
  return v + 8;
}

/** One 3D grass tuft variant: 3-6 tapered-box blades arranged in TWO CROSSED
 *  planes (azimuths 90° apart, per-blade jitter ±10° so they never fan into a
 *  flat paper silhouette) with varied height / lean / width / thickness.
 *  Each variant is one geometry; 4 variants x ~90 InstancedMesh instances =
 *  ~4 draw calls for the whole verge. Deterministic per seed. */
function grassTuftVariant(seed) {
  const r = rnd(seed);
  const positions = [];
  const indices = [];
  let v = 0;
  const n = 3 + ((r() * 4) | 0); // 3-6 blades per tuft
  const a0 = r() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    // alternate between the two crossed planes (a0, a0 + PI/2) + jitter
    const az = (k % 2 === 0 ? a0 : a0 + Math.PI / 2) + (r() - 0.5) * 0.35;
    const h = 0.3 + r() * 0.4;      // 0.30-0.70m tall
    const lean = 0.1 + r() * 0.18;  // lean 10-28% of height
    const w = 0.05 + r() * 0.045;   // 5-9.5cm wide
    const th = 0.016 + r() * 0.014; // 1.6-3cm thick
    v = grassBladeBox(positions, indices, v, w, th, h, lean, az);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Gravel verge texture (local to Environment.js — Materials.js untouched).
// Warm dry gravel: tan/grey base with dense pebble speckle + occasional larger
// stones + worn moist patches. Rendered at LOW OPACITY over the dirt shoulder
// ribbon it reads as a soft gravel transition band between asphalt and grass
// (FECO: the verge read as a flat 16-bit strip).
// ---------------------------------------------------------------------------
let _gravelTex = null;
function gravelTexture() {
  if (_gravelTex) return _gravelTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b8a183';
  g.fillRect(0, 0, 256, 256);
  // dense pebble speckle — varied warm greys/tans (2-4px stones)
  for (let i = 0; i < 2600; i++) {
    const roll = Math.random();
    g.fillStyle = roll < 0.3 ? '#a08c6f' : roll < 0.55 ? '#c4ae8d' : roll < 0.8 ? '#8f7c62' : '#6f6150';
    const s = 1 + ((Math.random() * 2.5) | 0);
    g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  // occasional larger stones
  for (let i = 0; i < 70; i++) {
    g.fillStyle = Math.random() > 0.5 ? '#cbb697' : '#7d6e58';
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 2.5, 0, Math.PI * 2);
    g.fill();
  }
  // worn darker patches (moist gravel)
  g.globalAlpha = 0.18;
  for (let i = 0; i < 10; i++) {
    g.fillStyle = '#6f6150';
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, 12 + Math.random() * 20, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  _gravelTex = tex;
  return tex;
}

// ---------------------------------------------------------------------------
// Soft cloud shadow patch (AUDIT r7) — a dark radial blob projected on the
// ground beneath each cloud, drifting with it. Shared geometry + material
// (14 cheap quads, one texture); update() re-pins the Y to the terrain
// every frame so the patch follows the rolling hills.
// ---------------------------------------------------------------------------
let _cloudShadowTex = null;
let _cloudShadowGeo = null;
let _cloudShadowMat = null;
function getCloudShadowParts() {
  if (!_cloudShadowTex) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(14,20,34,0.6)');
    grad.addColorStop(0.55, 'rgba(14,20,34,0.34)');
    grad.addColorStop(1, 'rgba(14,20,34,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    _cloudShadowTex = new THREE.CanvasTexture(c);
    _cloudShadowGeo = new THREE.CircleGeometry(1, 24);
    _cloudShadowMat = new THREE.MeshBasicMaterial({
      map: _cloudShadowTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }
  return { geo: _cloudShadowGeo, mat: _cloudShadowMat };
}

// ---------------------------------------------------------------------------
// Fake-AO grounding disc (FECO 'flat props'): a soft dark radial blob laid
// flat on the field under every tree/bush — MK8-style contact grounding so
// foliage reads as PLANTED, never pasted. One shared circle geometry + one
// shared radial-gradient texture; each disc is one InstancedMesh instance.
// ---------------------------------------------------------------------------
let _aoDiscTex = null;
let _aoDiscGeo = null;
let _aoDiscMat = null;
function getAODiscParts() {
  if (!_aoDiscTex) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(10,22,14,0.42)');
    grad.addColorStop(0.55, 'rgba(10,22,14,0.26)');
    grad.addColorStop(1, 'rgba(10,22,14,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    _aoDiscTex = new THREE.CanvasTexture(c);
    _aoDiscGeo = new THREE.CircleGeometry(1, 20);
    _aoDiscMat = new THREE.MeshBasicMaterial({
      map: _aoDiscTex,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }
  return { geo: _aoDiscGeo, mat: _aoDiscMat };
}

/** Triangle-strip ribbon following the track path (mirrors TrackBuilder's
 *  buildRoadRibbon geometry so it sits exactly on the shoulder plane) — used
 *  for the gravel verge band. Up-facing normals, UVs 0..1 along path/across
 *  width; the material sets the texture repeat. */
function vergeRibbonGeometry(path, width, segments = 520) {
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices = [];
  const tan = new THREE.Vector3();
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const half = width / 2;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    nrm.set(-tan.z, 0, tan.x).normalize();
    const b = i * 2;
    positions[b * 3 + 0] = p.x + nrm.x * half;
    positions[b * 3 + 1] = p.y;
    positions[b * 3 + 2] = p.z + nrm.z * half;
    positions[(b + 1) * 3 + 0] = p.x - nrm.x * half;
    positions[(b + 1) * 3 + 1] = p.y;
    positions[(b + 1) * 3 + 2] = p.z - nrm.z * half;
    uvs[b * 2 + 0] = t;
    uvs[b * 2 + 1] = 1;
    uvs[(b + 1) * 2 + 0] = t;
    uvs[(b + 1) * 2 + 1] = 0;
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    indices.push(a, c, b, b, c, d); // up-facing winding (same as buildRoadRibbon)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Fixed water bodies (mirrors buildWater) so organized props never spawn
// inside the lakes. The field pond (buildFieldLandmarks) is listed here too
// so generic rocks/bushes/flowers/trees keep clear of its disc and rim.
const WATER_SPOTS = [
  { x: 120, z: 130, r: 34 },
  { x: -110, z: 110, r: 29 },
  { x: 115, z: -80, r: 5 },
];
function inWater(x, z, margin = 4) {
  for (const w of WATER_SPOTS) {
    const dx = x - w.x;
    const dz = z - w.z;
    if (dx * dx + dz * dz < (w.r + margin) * (w.r + margin)) return true;
  }
  return false;
}

// Field landmark centers (buildFieldLandmarks) — forest clumps keep a
// buffer around them so big canopies never clip the hill / rocks / windmill.
const LANDMARK_SPOTS = [
  { x: -95, z: -80, r: 20 }, // hilltop grove (hill is 12m radius)
  { x: -100, z: 75, r: 13 }, // rock formation
  { x: 90, z: 80, r: 11 },   // windmill (blades sweep ~3m)
];
function nearLandmark(x, z, margin = 0) {
  for (const l of LANDMARK_SPOTS) {
    const dx = x - l.x;
    const dz = z - l.z;
    if (dx * dx + dz * dz < (l.r + margin) * (l.r + margin)) return true;
  }
  return false;
}

export class Environment {
  constructor() {
    this.clouds = [];
    this.balloons = [];
    this.waterMeshes = [];
    this.flagMeshes = [];
    this.windmillRotors = [];
    this.sun = null;
    this._track = null;
    this._trackSamples = null;
    this._contactAOs = []; // coletor p/ buildContactShadows (AUDIT AAA)
  }

  /** True when (x,z) is within margin of the cached track centerline. */
  _onTrack(x, z, margin = 6) {
    if (!this._trackSamples) return false;
    const r = CONFIG.track.roadWidth / 2 + margin;
    const r2 = r * r;
    for (const p of this._trackSamples) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  buildEnvironment(scene, track = null) {
    this._track = track;
    this._trackSamples = null;
    this._trackPath = track?.path ?? null;
    // AUDIT r3: deterministic world — the same track every load so QA frames
    // are reproducible (grass/hay/palms/roadside used Math.random() and the
    // world drifted between loads, breaking before/after comparison).
    this._rand = rnd(0xC0FFEE);
    // Ground props on the SAME rolling field as the terrain (incl. hills).
    this._gy = (x, z) =>
      this._trackPath ? terrainHeight(x, z, this._trackPath) : smoothH(x, z) * 0.5 - 0.25;
    if (track && track.path) {
      // Cache centerline samples for _onTrack checks.
      // AUDIT R79d (audit-geometry 2026-08-15): 60 amostras = ~10m entre
      // pontos num loop de 600m — em CURVAS fechadas a amostra mais próxima
      // ficava a vários metros da pista real → _onTrack dizia "fora" para
      // objetos DENTRO da pista (arbustos/lobes a 0.8m passavam). 240
      // amostras (~2.5m de espaçamento) resolvem a subestimação em curva.
      this._trackSamples = [];
      for (let i = 0; i < 240; i++) {
        this._trackSamples.push(track.path.getPointAt(i / 240));
      }
    }
    // --- fog & background ------------------------------------------------
    // trackId 2 (NEON CITY) swaps the sunny meadow for an urban night theme:
    // night fog color matches the sky horizon so the dome blends seamlessly.
    const night = this.trackId === 2;
    // AUDIT: night haze carries a purple tint so distance reads neon-lit, not void-black
    scene.fog = new THREE.Fog(night ? 0x141034 : 0xbfe6ff, night ? 120 : 70, night ? 420 : 430);

    // Sky dome — PREMIUM PASS (2026-08-21): ShaderMaterial procedural (cookbook
    // gradient-sky recipe) substitui a textura canvas. Gradiente contínuo sem
    // banding, sol/lua com disc+halo físicos (pow), estrelas hash na noite,
    // horizonte quente de sunset casando com o fog. 1 draw call, zero texturas.
    // keyPos/sunDir definidos aqui (ANTES das luzes) — o sol do domo usa a
    // MESMA direção da key light: o que se vê no céu é de onde a luz vem.
    const keyPos = night ? [90, 115, -72] : [70, 90, 40];
    this.sunDir = new THREE.Vector3(...keyPos).normalize();
    const skyUniforms = {
      uTop:      { value: new THREE.Color(night ? 0x241a4e : 0x2e8fd8) },
      uMid:      { value: new THREE.Color(night ? 0x2a2a5a : 0x7cc3f0) },
      uHorizon:  { value: new THREE.Color(night ? 0x141034 : 0xd8f0fc) }, // AUDIT R21: horizonte noturno azul-roxo profundo — o tom anterior (0x251a3a) + fog amarelado das luzes lia como banda OLIVA no horizonte central
      uSunColor: { value: new THREE.Color(night ? 0xe8ecf8 : 0xfff2cc) },
      uSunDir:   { value: this.sunDir.clone() },
      uNight:    { value: night ? 1 : 0 },
    };
    const sky = new THREE.Mesh(
      // AUDIT FIX: 24 segments faceted the horizon (~135m chords at 520m
      // radius); 64x32 reads smooth even from the high chase camera.
      new THREE.SphereGeometry(520, 64, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: skyUniforms,
        vertexShader: /* glsl */`
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */`
          varying vec3 vDir;
          uniform vec3 uTop, uMid, uHorizon, uSunColor, uSunDir;
          uniform float uNight;
          float hash21(vec2 p) {
            p = fract(p * vec2(234.34, 435.345));
            p += dot(p, p + 34.23);
            return fract(p.x * p.y);
          }
          void main() {
            float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
            // 3-stop: horizonte → mid → topo (pow abre o mid, céu mais alto)
            vec3 col = mix(uHorizon, uMid, smoothstep(0.42, 0.62, h));
            col = mix(col, uTop, smoothstep(0.60, 0.95, pow(h, 0.72)));
            // sol/lua: disc nítido + halo largo (físico pow, sem textura)
            float d = clamp(dot(normalize(vDir), normalize(uSunDir)), 0.0, 1.0);
            float disc = pow(d, ${night ? '2400.0' : '900.0'});
            float halo = pow(d, ${night ? '18.0' : '7.0'}) * ${night ? '0.22' : '0.30'};
            col += uSunColor * (disc + halo);
            // warm sunset band perto do horizonte no dia (MK8 golden hour)
            if (uNight < 0.5) {
              float band = exp(-abs(h - 0.50) * 14.0) * 0.16;
              col += vec3(1.0, 0.82, 0.55) * band;
            }
            // estrelas determinísticas só na noite (células hash, fade no horizonte)
            if (uNight > 0.5 && vDir.y > 0.06) {
              vec2 cell = floor(vDir.xz / vDir.y * 38.0);
              float star = step(0.994, hash21(cell));
              float twinkle = 0.55 + 0.45 * sin(hash21(cell + 7.31) * 40.0);
              col += vec3(0.9, 0.94, 1.0) * star * twinkle * smoothstep(0.06, 0.25, vDir.y);
            }
            gl_FragColor = vec4(col, 1.0);
          }`,
      })
    );
    sky.position.y = -10;
    scene.add(sky);

    // AUDIT PISTA R11 (2026-08-16): anel de nevoeiro — camada atmosférica
    // entre a pista e as montanhas (banda mais próxima = r146). Profundidade
    // sem tocar no fog principal nem custar draw calls caros (30 placas).
    // AUDIT R21g (GPU real): à noite o anel NÃO é construído — ele era a
    // superfície roxa clara (fog:false, depthWrite:false) sobre a qual o
    // bloom âmbar pintava a "COLINA VERDE-OLIVA" do horizonte. Sem postfx
    // (?nobl) ela sumia; com anel removido à noite, some também.
    if (!night) this.buildHazeRing(scene, 0xbfe6ff, 185, 30);
    // AUDIT R12 (2ª camada de profundidade — Meadow): névoa BAIXA na base
    // das colinas (a camada R146/y6.5 é alta; sem a baixa a base lê recorte).
    if (!night) this.buildGroundHaze(scene, 0xbfe6ff, 100, 2.0, 38, 4.2, 0.5);

    // --- lights (AAA rig: key + fill + sky/ground hemi + rim) --------------
    // NEON CITY swaps the warm sunny rig for dim cool moonlight (the moon
    // disc in buildNeonCity sits on the same axis, so shadows match it).
    // AUDIT r4: lit faces got ~2.8 irradiance vs ~1.55 in shadow — an ACES
    // contrast ratio under 2:1 = "flat, washed out". The shadow sun is now
    // the SOLE key; hemi/fill cut hard so shadow sides stay shaded.
    const hemi = new THREE.HemisphereLight(night ? 0x40509a : 0xd8e8ff, night ? 0x141430 : 0x7bca7f, night ? 0.45 : 0.22); // AUDIT R16a: 0.35→0.22 — sombras mais profundas (MK8 contraste)
    scene.add(hemi);

    // KEY: primary illumination — warm day sun, or cool moonlit blue at night.
    // The shadow sun below carries BOTH the light and the shadows now.
    // AUDIT r5: this non-casting light sat IDENTICAL to the shadow sun (their
    // combined 3.35 lit faces clipped ACES) — it's now a zero placeholder
    // (kept for the night-city headlight rig wiring, not emitted).
    // PREMIUM PASS: keyPos/sunDir agora definidos no bloco do céu (o shader
    // do domo usa a MESMA direção — sol visível = direção da key light).
    const keyColor = night ? 0x8fa8ff : 0xfff2d0;
    const key = new THREE.DirectionalLight(keyColor, 0);
    key.position.copy(this.sunDir).multiplyScalar(150);
    scene.add(key);
    scene.add(key.target);

    // FILL: opposite-side bounce — lifts the shadow sides so unlit faces
    // read as shaded blue, never black (deep indigo at night).
    const fill = new THREE.DirectionalLight(night ? 0x2a3a7a : 0x9fc8ff, night ? 0.3 : 0.22);
    fill.position.set(night ? 80 : -70, 60, night ? 60 : -40);
    scene.add(fill);
    scene.add(fill.target);

    // RIM (audit r3): a cool back-light separates karts/props from the
    // background — the 'pasted on' flatness came from no edge definition.
    const rim = new THREE.DirectionalLight(night ? 0x5a7ad8 : 0xfff0c8, night ? 0.45 : 0.9); // AUDIT R16a: 0.7→0.9 — rim mais forte (separação kart/fundo)
    // AUDIT GPU-real (2026-08-23, LXC 105): karts IA somem no Neon — King roxo
    // lê 6.5/10 no crítico cego 720p ("cor pouco contrastante"). Rim noturno
    // 0.45 é fraco p/ separar cores escuras do fundo indigo. 0.45→0.85 +
    // tint mais claro (mais separação de edge sem lavar a cena).
    rim.color.set(night ? 0x9ab4ff : 0xfff0c8);
    if (night) rim.intensity = 0.85;
    rim.position.set(night ? -40 : 30, 40, night ? -30 : 25); // opposite the key
    scene.add(rim);
    scene.add(rim.target);

    // Shadow-casting sun — kept as the key's shadow companion: same tint and
    // direction so shadowed areas match the key light (dim blue at night).
    const sun = new THREE.DirectionalLight(keyColor, night ? 0.55 : 2.6); // AUDIT R16a: 2.0→2.6 — key mais forte (contraste lit/shadow MK8)
    // AUDIT r4: the shadow sun is now the SOLE key (was 1.2 beside the
    // duplicate 1.0 key). radius 2 → 4.5 for penumbra (kart shadows read as
    // dark stickers otherwise), bias relaxed, far extended to match fog so
    // distant trees/stands still project.
    sun.position.set(...keyPos);
    sun.castShadow = true;
    if (CONFIG.render.shadows) {
      const testMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('test');
      sun.shadow.mapSize.set(testMode ? CONFIG.render.testShadowMapSize : CONFIG.render.shadowMapSize, testMode ? CONFIG.render.testShadowMapSize : CONFIG.render.shadowMapSize);
      sun.shadow.radius = 9; // AUDIT FIX R13d (Feco real-GPU: 'anéis nas
      // rodas' — o crítico do playtest-sim provou que o 'anel' é a SOMBRA
      // PROJETADA do kart no chão: elipse escura sob a roda com borda dura
      // que lê como anel na chase cam. O modelo 3D está limpo (sem peças
      // extras — flare/lip/wishbone já removidos). radius 4.5 → 9 = penumbra
      // bem mais suave; a elipse deixa de ter borda dura → não lê mais como
      // anel, vira sombra natural de kart.
      sun.shadow.camera.left = -130; // AUDIT FIX R13h (Feco real-GPU: 'asfalto
      sun.shadow.camera.right = 130; // mudando de cor seguindo o corredor' —
      sun.shadow.camera.top = 130;   // PERSISTE após R12h ±70m): a borda do
      sun.shadow.camera.bottom = -130; // quadrado do shadow map está a 70m do
      // kart e a chase cam olha ~80-100m à frente → a borda (que se move com
      // o kart) cruza a pista no frame = 'faixa de cor seguindo o corredor'.
      // ±130m: a borda fica FORA do alcance visual da câmera; trade-off:
      // texels 260/2048 ≈ 12.7cm (sombra de kart mais suave — MK8 também tem
      // sombras suaves, aceitável vs borda visível que era o bug real).
      sun.shadow.camera.far = 430; // match fog so distant props still project
      sun.shadow.bias = -0.0008;
      this.shadowSun = sun; // main.js re-positions it to follow the player
    }
    scene.add(sun);
    scene.add(sun.target);
    this.sunDir = new THREE.Vector3(...keyPos).normalize(); // shadow follow (main.js)
    this.sun = sun;

    // NEON CITY dressing: glowing moon disc + lit-window skyline. (Neon
    // roadside strips are built inside buildLightPoles below.)
    if (night) {
      this.buildNeonCity(scene, track);
      // AUDIT R12 (2ª camada — Neon): névoa baixa na base das torres (50-90m)
      this.buildGroundHaze(scene, 0x141034, 72, 2.3, 34, 4.6, 0.75); // AUDIT R21f: alpha 0.55→0.75 — o haze mais denso abafa o glow bloom residual no horizonte
      this.buildNeonGrid(scene, track); // AUDIT 2026-09-02 AAA: grid neon infinito substitui chão oliva (critic 1/10)
    }

    if (!night) {
      // --- horizon haze (warm rings behind the mountains) ------------------
      this.buildHorizonHaze(scene);

      // --- mountains (four haze layers) ------------------------------------
      this.buildMountains(scene);

      // --- clouds ----------------------------------------------------------
      this.buildClouds(scene);
      this.buildSunGlow(scene);

      // --- water -----------------------------------------------------------
      this.buildWater(scene);

      // --- palms & props ---------------------------------------------------
      this.buildPalms(scene);
      this.buildForest(scene);
      this.buildProps(scene, track);
      this.buildFieldLandmarks(scene);
      this.buildInfield(scene, track); // r5: densify the enclosed infield grass
      this.buildRoadsideFlowersAndRocks(scene, track);
      this.buildVergeGravel(scene, track); // soft gravel verge band (FECO: flat 16-bit verge)
      this.buildGrassTufts(scene, track); // 3D blade tufts along the verges
      this.buildMeadowGrassField(scene, track); // AUDIT R12: densidade meadow (faixa 4.5-22m)
      this.buildLightPoles(scene, track); // meadow light poles
      this.buildDistanceMarks(scene); // 100m/200m posts (was dead code — never called)
      this.buildCornerSigns(scene, track);
      this.buildGrandstand(scene);
      this.buildRoadsideCrowd(scene, track);
      this.buildFlags(scene);
      this.buildBalloons(scene);
      this.buildTracksideBanners(scene, track);
      this.buildTireStacks(scene, track);
      this.buildHayBales(scene, track);
      this.buildSponsorBoards(scene, track);
      this.buildCornerFlags(scene, track);
      this.buildInfieldTufts(scene, track); // r6: 3D tufts inside the enclosed infield — LAST so this._rand() never perturbs earlier builders
      this.buildContactShadows(scene); // AAA: AO p/ postes/banners/pneus/etc
      this.buildWorldPropKit(scene, track, false); // C3: marshal cones + bollards (meadow)
    } else {
      // City keeps the neon poles (buildLightPoles branches on night) but
      // drops the meadow dressing — a city track must read URBAN, not
      // "meadow with neon trim" (vision critic, track2 1/10 identity).
      this.buildLightPoles(scene, track); // neon strips in night mode
      this.buildStreetFurniture(scene, track); // AUDIT R12: hidrantes + semáforos
      this.buildWorldPropKit(scene, track, true); // C3: bollards (neon urban)
      this.buildContactShadows(scene); // AUDIT AAA tick: o coletor _contactAOs
      // também recebe discs no modo night (postes neon + torres roadside);
      // sem esta chamada os discs Neon nunca eram instanciados.
      // (no meadow roadside crowd — the city reads as empty street, which is
      // correct for a night circuit; the crowd was the top 'placeholder'
      // complaint from the vision critic)
    }
  }

  /**
   * C3 WorldPropKit: places reusable track-side props (marshal cones,
   * bollards) along the racing line using the shared contact-shadow helper
   * (WorldPropKit.makeContactShadow) so every prop is anchored to the ground
   * like the rail/crowd. Props are static + opaque → the existing
   * autoInstancing pass folds repeats into one draw call (density up, calls
   * flat). Deterministic placement (seeded) so the layout is identical every
   * load. Cones are OUTSIDE the road edge (lateral 5.4m) so they never
   * collide with the ribbon (roadWidth/2 = 4.5m) or the shoulder.
   * @param {THREE.Scene} scene
   * @param {object} track buildTrack result (has .path)
   * @param {boolean} neon true = neon city (bollards only, urban)
   */
  buildWorldPropKit(scene, track, neon) {
    if (!track || !track.path) return;
    const path = track.path;
    const SAMPLES = 90;
    const lateral = 5.4; // outside the road edge (roadWidth/2 = 4.5m)
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const rnd = (seed) => { let s = (seed * 2654435761) >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    const rand = rnd(0x5f3759df);
    // Skip the start/finish straight (d1..d8 avoid gantry + grid) and a few
    // tight apexes — cones go on the open straights where they read best.
    const skip = (t) => (t < 0.06 || t > 0.94);
    let placed = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / SAMPLES;
      if (skip(t)) continue;
      path.getPointAt(t, p);
      path.getTangentAt(t, tan);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const side = (i % 2 === 0) ? 1 : -1; // alternate sides
      const px = p.x + nrm.x * lateral * side;
      const pz = p.z + nrm.z * lateral * side;
      const gy = terrainHeight ? terrainHeight(px, pz, path) : p.y;
      let prop;
      if (neon) {
        prop = makeBollard({ h: 0.5, shadow: true });
      } else {
        // ~1 in 3 straights gets a cone cluster (2 cones) for hazard read
        prop = makeMarshalCone({ shadow: true });
        if (rand() < 0.33) {
          const c2 = makeMarshalCone({ shadow: false });
          c2.position.set(0.35 * side, 0, 0.2);
          prop.add(c2);
        }
      }
      prop.position.set(px, gy, pz);
      prop.rotation.y = rand() * Math.PI * 2;
      scene.add(prop);
      placed++;
    }
    console.log('[WorldPropKit] placed', placed, 'props (neon=' + !!neon + ')');
  }

  /**
   * Anel de nevoeiro atmosférico: N placas verticais com gradiente vertical
   * da cor do fog (alpha 0.34 no meio → 0 nas pontas) ao redor da pista.
   * Separa pista → meio-fundo → montanhas em 3 planos claros (haze banding
   * MK8). fog:false no material — a cor já é a do fog; não é duplamente
   * atenuado. AUDIT PISTA R11.
   */
  buildHazeRing(scene, fogHex, fogHaze, count) {
    const R = 146; // cobre o meio-fundo (props a 10-60m, montanhas a 200m+)
    const ring = new THREE.Group();
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 128;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.34)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 128);
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: fogHex, transparent: true, opacity: 1,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
    const geo = new THREE.PlaneGeometry(36, 13);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * R, 6.5, Math.sin(a) * R);
      dummy.lookAt(Math.cos(a) * (R + 30), 6.5, Math.sin(a) * (R + 30)); // face o centro
      dummy.rotation.z = 0;
      dummy.updateMatrix();
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * R, 6.5, Math.sin(a) * R);
      m.lookAt(Math.cos(a) * (R + 30), 6.5, Math.sin(a) * (R + 30));
      m.frustumCulled = false;
      ring.add(m);
    }
    scene.add(ring);
  }

  /**
   * AUDIT R12 (profundidade — 'haze ring já existe, precisa de segunda
   * camada?'): SIM. buildHazeRing é a camada ALTA (R146, y 6.5) que separa
   * pista → montanhas/skyline. Esta é a BAIXA: névoa rente ao chão que
   * envolve a BASE do meio-fundo (Meadow: colinas a ~100m; Neon: torres
   * C/D a ~72m) — sem ela a base dos volumes distantes lê recorte nítido.
   * MK8 usa 2-3 bandas atmosféricas. fog:false (a cor já é a do fog),
   * ~24 quads, 1 material — custo desprezível.
   */
  buildGroundHaze(scene, fogHex, R, yCenter, panelW, panelH, peakAlpha) {
    const count = 24;
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 128;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.30)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 128);
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: fogHex, transparent: true, opacity: peakAlpha,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
    const geo = new THREE.PlaneGeometry(panelW, panelH);
    const ring = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * R, yCenter, Math.sin(a) * R);
      m.lookAt(Math.cos(a) * (R + 30), yCenter, Math.sin(a) * (R + 30));
      m.frustumCulled = false;
      ring.add(m);
    }
    scene.add(ring);
  }

  buildMountains(scene) {
    // MK8D layered ranges — FOUR depth bands with true ATMOSPHERIC
    // PERSPECTIVE: each band's three layer colors are mixed toward the fog
    // color by distance (band.haze), so far bands are pale desaturated
    // silhouettes and the near band keeps full value contrast (dark slate
    // base / mid rock / snow-white cap). Every mountain is ONE columnar
    // mesh with a per-segment BROKEN snowline, a jagged summit crest and a
    // per-peak profile roll (jagged cone / rounded dome / flat-top butte)
    // with aggressive height + width spread — no two peaks share a
    // silhouette. All grounded on the rolling terrain (this._gy). Unlit
    // MeshBasicMaterial (backdrop-safe) with vertexColors for the 3 value
    // layers and DoubleSide so jitter-inverted windings never rasterize
    // black. Deterministic local rnd() — this._rand is never touched.
    const bands = [
      { radius: 318, count: 14, rock: 0x93a7cf, dark: 0x5f739e, snow: 0xbdc9ea, baseH: 40, seed: 11, offset: 0.6, haze: 0.35, snowLift: 0.22 }, // farthest — TICK32: da chase-cam baixa só o topo passa do horizonte; neve azulada (glacial distante) + snowline alta p/ não ler slab branco
      { radius: 262, count: 13, rock: 0x93a5e0, dark: 0x51619c, snow: 0xc6d4ea, baseH: 34, seed: 27, offset: 0.2, haze: 0.24, snowLift: 0.14 }, // AUDIT r20: 0.42 washed the snow patches out — 0.3 keeps the ridge contrast; TICK32: 0.3→0.24 p/ separar da banda far; neve azulada (slabs brancos persistem nesta banda)
      { radius: 202, count: 12, rock: 0x5d70c4, dark: 0x36428c, snow: 0xd2dff0, baseH: 28, seed: 43, offset: 0.2, haze: 0.16, snowLift: 0.1 }, // AUDIT r20: 0.28 → 0.18; TICK32: 0.18→0.16 + neve azulada + snowLift (banda intocada era dona dos slabs restantes)
      { radius: 146, count: 10, rock: 0x39468e, dark: 0x1c2658, snow: 0xffffff, baseH: 24, seed: 61, offset: 0.2, haze: 0.12 },  // closest — deepest + brightest
    ];
    // Day fog color = the atmospheric haze target (scene.fog is 0xbfe6ff).
    const fogCol = new THREE.Color(0xbfe6ff);
    for (const band of bands) {
      const group = new THREE.Group();
      // Per-band haze tint (mixed toward the sky/fog color) for the base discs.
      const hazeMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(band.rock).lerp(fogCol, band.haze),
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        fog: false, // TICK32: scene fog (70→430) lavava 60%+ p/ branco chapado; o haze baked (band.haze) é o controle de perspectiva aérea
      });
      for (let i = 0; i < band.count; i++) {
        const rand = rnd(band.seed * 1000 + i);
        // Profile roll: ~28% flat-top buttes (can be TALL), ~24% low rounded
        // domes (wide), the rest jagged peaks — three silhouette languages.
        const roll = rand();
        const profile = roll < 0.28 ? 'butte' : roll < 0.52 ? 'dome' : 'peak';
        // Angle jitter breaks the even ring spacing — no two neighbors sit at
        // the same angular step, so the range never reads as repeated peaks.
        const a = (i / band.count + (rand() - 0.5) * 0.3) * Math.PI * 2 + band.offset;
        const r = band.radius * (0.78 + rand() * 0.44);
        let h;
        if (profile === 'dome') h = band.baseH * (0.5 + rand() * 0.5);       // low rounded hills
        else if (profile === 'butte') h = band.baseH * (0.9 + rand() * 0.85); // tall buttes
        else h = band.baseH * (0.7 + rand() * 0.9);                           // mixed peaks
        const baseR = h * (0.34 + rand() * 0.22) * (profile === 'dome' ? 1.15 : 1);
        // Aggressive XZ stretch: some peaks elongate into ridge walls, domes
        // sit wide, buttes can be narrow towers.
        const wide = profile === 'dome' ? 1.25 : 1;
        const sx = wide * (0.5 + rand() * 1.6);
        const sz = wide * (0.5 + rand() * 1.6);
        const cx = Math.cos(a) * r;
        const cz = Math.sin(a) * r;
        const yBase = this._gy(cx, cz) - 0.5;

        const seed = (band.seed * 7919 + i * 131) >>> 0;
        const segs = 24 + ((rand() * 9) | 0); // 24-32 dense facets
        const jitter = 0.05 + rand() * 0.05;  // small radial ridge (0.05-0.10)

        // 3 VALUE-CONTRAST layers, mixed toward the fog color by distance so
        // far bands separate as haze: dark slate base / mid rock / snow cap.
        const dark = new THREE.Color(band.dark).lerp(fogCol, band.haze);
        const mid = new THREE.Color(band.rock).lerp(fogCol, band.haze);
        const snow = new THREE.Color(band.snow).lerp(fogCol, band.haze * 0.85);
        const layerColors = { dark, mid, snow };
        // Unlit backdrop material: vertexColors for the layers, DoubleSide so
        // jitter-inverted windings never rasterize black. fog:false (TICK32):
        // o haze baked por banda controla a perspectiva aérea; o fog da cena
        // misturava 60%+ de 0xbfe6ff a 300m e achatava tudo em slabs brancos.
        const rockMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });

        const geo = mountainGeometry(baseR, h, segs, 12, {
          jitter,
          seed,
          profile,
          peakAmp: profile === 'peak' ? 0.14 + rand() * 0.1 : profile === 'dome' ? 0.05 : 0.03,
          snowT0: Math.min(0.85, 0.5 + rand() * 0.25 + (band.snowLift || 0)), // TICK32: bandas distantes com neve até a base liam bloco branco; snowLift sobe a snowline
          snowAmp: 0.1 + rand() * 0.1,
          snowSeed: (seed + 7) >>> 0,
          midT0: 0.34 + rand() * 0.12,
          midAmp: 0.08 + rand() * 0.08,
          midSeed: (seed + 13) >>> 0,
          colors: layerColors,
        });
        const rock = new THREE.Mesh(geo, rockMat);
        rock.position.set(cx, yBase, cz);
        rock.rotation.set((rand() - 0.5) * 0.08, rand() * Math.PI, (rand() - 0.5) * 0.08);
        rock.scale.set(sx, 1, sz);
        rock.castShadow = false;
        group.add(rock);

        // Companion mass on jagged peaks only — a lower rounded shoulder
        // offset from the main body breaks the single-peak triangle silhouette.
        if (profile === 'peak') {
          const r2 = baseR * (0.35 + rand() * 0.45);
          const h2 = h * (0.3 + rand() * 0.55);
          const cSeed = (seed + 101) >>> 0;
          const cGeo = mountainGeometry(r2, h2, Math.max(18, segs - 6), 9, {
            jitter: jitter * 0.9,
            seed: cSeed,
            profile: 'dome',
            peakAmp: 0.08 + rand() * 0.08,
            snowT0: 0.55 + rand() * 0.3,
            snowAmp: 0.1 + rand() * 0.08,
            snowSeed: (cSeed + 7) >>> 0,
            midT0: 0.34,
            midAmp: 0.08,
            midSeed: (cSeed + 13) >>> 0,
            colors: layerColors,
          });
          const ridge = new THREE.Mesh(cGeo, rockMat);
          ridge.position.set(cx + (rand() - 0.5) * baseR * 1.5, yBase, cz + (rand() - 0.5) * baseR * 1.5);
          ridge.rotation.set((rand() - 0.5) * 0.14, rand() * Math.PI, (rand() - 0.5) * 0.14);
          ridge.scale.set(0.7 + rand() * 1.1, 1, 0.7 + rand() * 1.1);
          group.add(ridge);
        }

        // Soft haze disc at the base — atmospheric lift that fades the foot
        // of each mountain into the distance.
        const haze = new THREE.Mesh(
          new THREE.CircleGeometry(baseR * (1.4 + rand() * 0.6), 20),
          hazeMat
        );
        haze.rotation.x = -Math.PI / 2;
        haze.position.set(cx, yBase + 0.05, cz);
        group.add(haze);
      }
      scene.add(group);
    }
  }

  buildClouds(scene) {
    // Prominent volumetric cumulus: 6-10 puffs per cloud (denser billow than
    // the old 4-6), a soft blue emissive so the undersides never read black,
    // and fog:false so clouds stay WHITE and readable past the fog far plane
    // (vision critic: clouds existed but vanished into the fog wash). Each
    // cloud keeps the classic flat-bottomed cumulus silhouette: a big puffy
    // top over a squashed base fill, with a subtle rim-light glow.
    // AUDIT PERF-R34 (2026-08-14, auditoria render #3): 14 nuvens × ~8-11
    // meshes = ~130 meshes Standard → ~130 calls. Agora puffs+base são UMA
    // InstancedMesh por nuvem (SphereGeometry unitária, escala na matriz) —
    // 1 call por nuvem para puffs+base. Material Standard mantido (look
    // idêntico); halo/shadow continuam 1 mesh cada.
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      emissive: 0xbfd8ff,
      emissiveIntensity: 0.30,
      fog: false,
    });
    const puffUnit = new THREE.SphereGeometry(1, 14, 10);
    const dummy = new THREE.Object3D();
    const group = new THREE.Group();
    // Organized sky lanes: clouds every ~29 m along a drift band, staggered
    // across three z-lanes — a planned parade, not a scatter.
    for (let i = 0; i < 14; i++) {
      const rand = rnd(500 + i);
      const c = new THREE.Group();
      const puffs = 6 + Math.floor(rand() * 5); // 6-10 puffs — dense billow
      const maxPuffs = 12;
      const cloudIM = new THREE.InstancedMesh(puffUnit, cloudMat, maxPuffs);
      let puffIdx = 0;
      for (let p = 0; p < puffs; p++) {
        const s = 5.5 + rand() * 5.5; // 5.5-11 m — big readable puffs
        dummy.position.set(p * s * 0.62 - puffs * s * 0.31, (rand() - 0.5) * 1.7, (rand() - 0.5) * 3.6);
        dummy.scale.set(s, s * 0.55, s); // puff.scale.y = 0.55 squash
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        cloudIM.setMatrixAt(puffIdx++, dummy.matrix);
      }
      // squashed base fill — flattens the underside like a real cumulus
      const bs = 7.5 + rand() * 4.5;
      dummy.position.set(0, -2.0, 0);
      dummy.scale.set(bs * 1.75, bs * 0.34, bs * 1.3);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      cloudIM.setMatrixAt(puffIdx++, dummy.matrix);
      cloudIM.count = puffIdx;
      cloudIM.instanceMatrix.needsUpdate = true;
      cloudIM.name = 'cloud-instanced';
      c.add(cloudIM);
      // soft glow halo under the cloud — catches the bloom pass subtly
      const halo = new THREE.Mesh(
        new THREE.CircleGeometry(8 + rand() * 5, 20),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.10,
          fog: false,
          depthWrite: false,
        })
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = -2.3;
      c.add(halo);
      c.position.set(
        -215 + i * 29 + (rand() - 0.5) * 10,
        46 + rand() * 24,
        (i % 3) * 48 - 48 + (rand() - 0.5) * 12
      );
      c.userData.speed = 0.6 + rand() * 1.4;
      c.userData.baseX = c.position.x;
      c.userData.radius = 60 + rand() * 90;
      // AUDIT r7: soft shadow patch on the ground below this cloud (child of
      // the cloud group so it drifts with it; update() re-pins the Y each
      // frame). Deterministic size from the seeded rand() — added AFTER all
      // existing draws so no earlier placement shifts.
      const parts = getCloudShadowParts();
      const shadow = new THREE.Mesh(parts.geo, parts.mat);
      shadow.rotation.x = -Math.PI / 2;
      const br = 9 + rand() * 7; // 9-16m radius patch (bigger than the cloud)
      shadow.scale.set(br * 2, br * 1.6, 1);
      shadow.position.y = this._gy(c.position.x, c.position.z) - c.position.y;
      shadow.renderOrder = 1;
      c.add(shadow);
      c.userData.shadowBlob = shadow;
      group.add(c);
      this.clouds.push(c);
    }
    scene.add(group);
  }

  /**
   * Subtle sun glow billboard — a soft additive disc hung in the sky toward
   * the key light, so bloom catches it and the sun reads as a light SOURCE,
   * not a flat painted disc in the dome texture. fog:false keeps it crisp.
   */
  buildSunGlow(scene) {
    if (this._sunGlowTex) {
      this._sunGlow.position.copy(this._sunGlowPos);
      scene.add(this._sunGlow);
      return;
    }
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,252,235,1)');
    grad.addColorStop(0.22, 'rgba(255,244,200,0.85)');
    grad.addColorStop(0.5, 'rgba(255,238,180,0.32)');
    grad.addColorStop(1, 'rgba(255,235,170,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._sunGlowTex = tex;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    // hang it along the key-light direction (sun at 70,90,40), far out but
    // inside the dome — between the mountain bands and the sky texture sun.
    const dir = new THREE.Vector3(70, 90, 40).normalize();
    const pos = dir.multiplyScalar(300);
    this._sunGlowPos = pos.clone();
    glow.position.copy(pos);
    glow.lookAt(0, 0, 0);
    this._sunGlow = glow;
    scene.add(glow);
  }

  buildWater(scene) {
    const make = (x, z, w, d, a) => {
      // Reflective lake surface — MeshStandardMaterial with high metalness /
      // low roughness so the sunny-sky env map (scene.environment) + the sun
      // glow actually REFLECT off the water (vision critic: 'water is a flat
      // cyan sheet'). The animated shimmer in update() keeps working: it
      // drives opacity, hue-hold brightness and emissive pulse on the same
      // material.
      const water = new THREE.Mesh(
        // AUDIT PERF-R43: 20×20→1×1 segmentos (441 vértices → 4) — superfície
        // PLANA, shader faz o look; o update anima material, não geometria.
        new THREE.PlaneGeometry(w, d, 1, 1),
        new THREE.MeshStandardMaterial({
          color: 0x2f9fd8,
          metalness: 0.85,
          roughness: 0.18,
          envMapIntensity: 1.1,
          transparent: true,
          opacity: 0.82,
          emissive: 0x1e9bd6,
          emissiveIntensity: 0.35,
        })
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(x, -0.2 + Math.sin(a) * 0.1, z);
      water.userData = { baseY: water.position.y, phase: a, baseColor: 0x2f9fd8 };
      scene.add(water);
      this.waterMeshes.push(water);

      // deep-water base layer — darker disc half a metre down: the lake now
      // reads as TWO water planes (depth + shore), not one flat cyan sheet.
      const deep = new THREE.Mesh(
        new THREE.CircleGeometry(Math.max(w, d) / 2 + 3, 16), // AUDIT PERF-R43: 28→16 segs (disco sob a água, borda suave já tem foam)
        new THREE.MeshStandardMaterial({
          color: 0x1479b8,
          transparent: true,
          opacity: 0.6,
          emissive: 0x0e5a94,
          emissiveIntensity: 0.3,
          roughness: 0.35,
          metalness: 0.1,
        })
      );
      deep.rotation.x = -Math.PI / 2;
      deep.position.set(x, -0.85 + Math.sin(a) * 0.1, z);
      scene.add(deep);

      // foam edge ring (simple bright rim)
      const foam = new THREE.Mesh(
        new THREE.RingGeometry(w / 2 - 0.6, w / 2, 24), // AUDIT PERF-R43: 40→24 segs — borda circular, 24 é suave o suficiente
        new THREE.MeshBasicMaterial({
          color: 0xd9f4ff,
          transparent: true,
          opacity: 0.55,
        })
      );
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(x, -0.12, z);
      scene.add(foam);
    };
    make(120, 130, 60, 60, 0);
    make(-110, 110, 50, 40, 1.8);
  }

  buildPalms(scene) {
    // AUDIT PERF-R26 (2026-08-14, loop performance): 18 palmeiras × 16
    // meshes = 288 meshes com toonMaterial NOVO cada — o auto-instancing
    // não agrupava (materiais únicos) → ~270 draw calls. Agora InstancedMesh
    // por tipo (tronco/anel/folha-clara/folha-escura/coco) + materiais
    // COMPARTILHADOS: 5 draw calls no total.
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 4.2, 12);
    const ringGeo = new THREE.CylinderGeometry(0.26, 0.28, 0.07, 12);
    const leafGeo = new THREE.ConeGeometry(0.17, 2.4, 10);
    const nutGeo = new THREE.SphereGeometry(0.22, 12, 8);
    const trunkMat = toonMaterial(0xb07a4f, {});
    const ringMat = toonMaterial(0x8f6842, {});
    const leafMat = applyWindSway(toonMaterial(0x2fa84f, {}), { strength: 0.05, speed: 1.1 });
    const leafMatDark = applyWindSway(toonMaterial(0x279142, {}), { strength: 0.05, speed: 1.25 });
    const nutMat = toonMaterial(0x8a5a33, {});
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    // 18 spots, one per ~40° around the loop. The original list had 9 spots
    // sitting within the road clearance band (they were silently skipped by
    // _onTrack — half the palms never spawned, and the survivors leaned
    // south). All spots are now >12.5m from the centerline, N/S balanced
    // 9/9, L/R 8/10.
    const spots = [
      [-74, 32], [-52, -64], [30, -78], [68, -44], [62, 44],
      [36, 74], [-14, 82], [-52, 62], [-40, -14], [0, -40],
      [24, -20], [-20, 20], [80, 8], [-80, -20], [55, 60],
      [-30, -66], [10, 36], [90, -8],
    ];

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, spots.length * 3);
    const leafsL = new THREE.InstancedMesh(leafGeo, leafMat, spots.length * 11);
    const leafsD = new THREE.InstancedMesh(leafGeo, leafMatDark, spots.length * 11);
    const nuts = new THREE.InstancedMesh(nutGeo, nutMat, spots.length);
    trunks.castShadow = true; rings.castShadow = true;
    leafsL.castShadow = true; leafsD.castShadow = true;
    [trunks, rings, leafsL, leafsD, nuts].forEach(m => { m.name = 'palm-instanced'; });
    scene.add(trunks, rings, leafsL, leafsD, nuts);

    let ti = 0, ri = 0, li = 0, di = 0, ni = 0;
    // AUDIT R69 (Feco real-GPU 2026-08-14: 'árvores desmontadas — tronco
    // separado da copa, esfera flutuando'): as folhas/coco do R26 eram
    // instanciados com a matriz LOCAL (0,0.2,0 + rotação + translateX) e o
    // offset do top adicionado aos elements — mas o TILT do top (rx/rz) e a
    // posição (cx, 4.2, cz) não eram aplicados como MATRIZ PAI. No original
    // as folhas eram CHILD do top (herdavam tilt+posição). Agora: M_world =
    // T(cx,4.2,cz) * R(rx,0,rz) * M_leaf — réplica exata da hierarquia.
    const topPos = new THREE.Vector3();
    const topQuat = new THREE.Quaternion();
    const topScale = new THREE.Vector3(1, 1, 1);
    const topMat = new THREE.Matrix4();
    const leafMat4 = new THREE.Matrix4();
    for (const [x, z] of spots) {
      if (this._onTrack(x, z, 8)) continue; // never place a palm on the road
      const rx = (this._rand() - 0.5) * 0.22;
      const rz = (this._rand() - 0.5) * 0.22;
      const cx = x + Math.sin(rz) * 2;
      const cz = z + Math.sin(rx) * 2;
      // Matriz do top (pai): posição no mundo + tilt
      topPos.set(cx, 4.2, cz);
      topQuat.setFromEuler(new THREE.Euler(rx, 0, rz));
      topMat.compose(topPos, topQuat, topScale);

      dummy.position.set(x, 2.1, z);
      dummy.rotation.set(rx, 0, rz);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      trunks.setMatrixAt(ti++, dummy.matrix);
      for (let rk = 0; rk < 3; rk++) {
        dummy.position.set(x, 1.0 + rk * 1.05, z);
        dummy.rotation.set(rx, 0, rz);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        rings.setMatrixAt(ri++, dummy.matrix);
      }
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2 + this._rand() * 0.3;
        // Replica o leaf original: pos(0,0.2,0) + rot(z=PI/2,y=a,x=0.95) +
        // translateX(1.05) (eixo local pós-rotação), e multiplica pela
        // matriz do top (tilt + offset) — R69.
        dummy.position.set(0, 0.2, 0);
        dummy.rotation.set(0.95, a, Math.PI / 2);
        dummy.scale.set(1, 1, 1);
        dummy.translateX(1.05);
        dummy.updateMatrix();
        leafMat4.copy(dummy.matrix).premultiply(topMat);
        if (i % 2 === 0) leafsL.setMatrixAt(li++, leafMat4);
        else leafsD.setMatrixAt(di++, leafMat4);
      }
      // AUDIT R82 (Feco real-GPU 2026-08-15: 'palmeira desmontada — coco
      // flutuando acima da copa'): o coco estava em 4.2+0.35 = 4.55m, mas o
      // topo do tronco é 4.2 e a copa (folhas) nasce em ~4.4 — o coco lia
      // como esfera marrom SOLTA 0.35m acima. Agora 4.2+0.08 = dentro da
      // copa (entre as folhas, como um coco real).
      dummy.position.set(cx, 4.2 + 0.08, cz);
      dummy.rotation.set(rx, 0, rz);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      nuts.setMatrixAt(ni++, dummy.matrix);
    }
    trunks.count = ti; rings.count = ri; leafsL.count = li; leafsD.count = di; nuts.count = ni;
    trunks.instanceMatrix.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;
    leafsL.instanceMatrix.needsUpdate = true;
    leafsD.instanceMatrix.needsUpdate = true;
    nuts.instanceMatrix.needsUpdate = true;
  }

  buildForest(scene) {
    // Enhanced forest with 3 tree species featuring layered canopies.
    // Species 1: Pine-like - tall with a stacked-CONE canopy (3 cones,
    //   radius decreasing up the trunk -> a real pine silhouette)
    // Species 2: Oak-like - medium with wide layered sphere canopy
    // Species 3: Palm-like (kept for variety) - tall trunk with frond canopy
    
    // Tree species definitions. All three species share the layered-canopy
    // layout pattern but get DISTINCT canopy GEOMETRY below: pine layers are
    // cones (radius decreasing up the trunk -> a real stacked-cone pine),
    // oak layers stay spheres (wide rounded crown), palm keeps fronds.
    const species = [
      {
        // Pine species - tall and narrow, stacked-CONE canopy
        name: 'pine',
        trunkHeight: 4.2,
        trunkTopRadius: 0.22,
        trunkBottomRadius: 0.28,
        trunkSegs: 12,
        canopyLayers: [
          { radius: 1.4, yOffset: 2.4, height: 3.4 },   // bottom skirt - widest cone
          { radius: 1.05, yOffset: 3.3, height: 2.4 },  // middle cone
          { radius: 0.65, yOffset: 4.3, height: 1.8 }   // apex cone - narrowest
        ],
        trunkColor: 0x6d4c41,
        canopyColor: 0x287b3e,
        count: 0.4 // 40% of trees
      },
      {
        // Oak species - medium and wide, layered SPHERE canopy
        name: 'oak',
        trunkHeight: 3.0,
        trunkTopRadius: 0.28,
        trunkBottomRadius: 0.35,
        trunkSegs: 12,
        canopyLayers: [
          { radius: 1.8, yOffset: 2.0, segments: 14 },
          { radius: 1.3, yOffset: 2.6, segments: 12 },
          { radius: 0.8, yOffset: 3.0, segments: 10 }
        ],
        trunkColor: 0x8b6941,
        canopyColor: 0x2e8b57,
        count: 0.4 // 40% of trees
      },
      {
        // Palm species - tropical (existing)
        name: 'palm',
        trunkHeight: 4.2,
        trunkTopRadius: 0.22,
        trunkBottomRadius: 0.34,
        trunkSegs: 12,
        canopyLayers: [
          { radius: 1.0, yOffset: 4.2, segments: 10, isPalmFrond: true }
        ],
        trunkColor: 0xb07a4f,
        canopyColor: 0x2fa84f,
        count: 0.2 // 20% of trees
      }
    ];

    const trees = []; // { x, z, s, speciesIdx }
    const halfW = CONFIG.track.roadWidth / 2;
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();

    // Helper to select species deterministically
    function selectSpecies(seed) {
      const rand = rnd(seed);
      let cumulative = 0;
      for (let i = 0; i < species.length; i++) {
        cumulative += species[i].count;
        if (rand() < cumulative) return i;
      }
      return species.length - 1;
    }

    if (this._track && this._track.path) {
      const path = this._track.path;
      const len = path.getLength();
      const n = Math.floor(len / 12);
      for (let i = 0; i < n; i++) {
        const rand = rnd(9000 + i);
        const t = (((i / n + (rand() - 0.5) * (3 / len)) % 1) + 1) % 1; // ±1.5 m along path
        path.getPointAt(t, p);
        path.getTangentAt(t, tan);
        nrm.set(-tan.z, 0, tan.x).normalize();
        const side = i % 2 === 0 ? 1 : -1;
        const off = halfW + 11 + rand() * 4; // consistent 15.5-19.5 m standoff
        const x = p.x + nrm.x * side * off + (rand() - 0.5) * 3; // ±1.5 m lateral
        const z = p.z + nrm.z * side * off + (rand() - 0.5) * 3;
        if (inWater(x, z, 5)) continue;
        // AUDIT R19 (Feco: 'mato na pista'): árvores NÃO verificavam _onTrack
        // — em curvas o offset lateral podia trazer um tronco/canopy para a
        // faixa. Margem 3 = tronco fora da pista + kerb.
        if (this._onTrack(x, z, 3)) continue;
        const speciesIdx = selectSpecies(9000 + i);
        trees.push({ x, z, s: 0.95 + rand() * 0.75, speciesIdx });
      }
    }

    // 8 clumps × 45° fans = one per compass octant. The old 7-fan ring
    // (0.4 offset) leaned right: 4 fans in x>0 vs 3 in x<0 → 13L/19R trees.
    // 8 fans rebalance to 4/4; nearLandmark keeps canopies off the field
    // landmarks (hill / rock formation / windmill).
    const clusterCount = 8;
    for (let c = 0; c < clusterCount; c++) {
      const rand = rnd(7000 + c);
      const ca = (c / clusterCount) * Math.PI * 2 + 0.4;
      const cr = 92 + rand() * 70; // 92-162 m out
      const cx = Math.cos(ca) * cr;
      const cz = Math.sin(ca) * cr;
      if (this._onTrack(cx, cz, 18) || inWater(cx, cz, 8) || nearLandmark(cx, cz, 6)) continue;
      const per = 5 + Math.floor(rand() * 3); // 5-7 trees per clump
      for (let k = 0; k < per; k++) {
        const r2 = rnd(7000 + c * 10 + k);
        const a2 = ca + (k - per / 2) * 0.24 + (r2() - 0.5) * 0.3;
        const r3 = cr + (r2() - 0.5) * 12;
        const x = Math.cos(a2) * r3;
        const z = Math.sin(a2) * r3;
        if (inWater(x, z, 4) || nearLandmark(x, z, 4)) continue;
        // AUDIT R19 (Feco: 'mato na pista'): membro do clump também sem
        // _onTrack — re-verifica (clumps ficam a 92-162m, mas segurança).
        if (this._onTrack(x, z, 3)) continue;
        const speciesIdx = selectSpecies(7000 + c * 10 + k);
        trees.push({ x, z, s: 1.0 + r2() * 0.9, speciesIdx });
      }
    }

    // Create geometry templates for each species
    const trunkGeoms = species.map(s =>
      new THREE.CylinderGeometry(s.trunkTopRadius, s.trunkBottomRadius, s.trunkHeight, s.trunkSegs)
    );
    const trunkMats = species.map(s => toonMaterial(s.trunkColor, {}));

    // Per-species canopy GEOMETRY (AUDIT r3: pine and oak used to share ONE
    // SphereGeometry, so both were sphere-stacks and the whole forest read
    // as a single species of lollipop). Pine now gets a unit CONE scaled per
    // layer into a stacked-cone crown; oak keeps layered spheres; palm keeps
    // its frond canopy (built separately).
    const canopyGeoms = species.map(s => {
      if (s.name === 'pine') return new THREE.ConeGeometry(1.0, 1.0, 24); // AUDIT R12: 18 segs ainda liam low-poly na chase cam — 24
      if (s.name === 'palm') return new THREE.SphereGeometry(0.1, 10, 8); // tiny placeholder, fronds handled separately
      return new THREE.SphereGeometry(1.0, 20, 14); // oak — smoother crown
    });
    // One base canopy material per species. Per-instance HSL lightness jitter
    // (setColorAt -> instanceColor, ±8%) below replaces the old two fixed
    // alternating light/dark materials.
    const canopyMats = species.map(s => toonMaterial(s.canopyColor, {}));

    // Palm frond geometry
    const palmFrondGeo = new THREE.ConeGeometry(0.18, 2.5, 8);
    const palmFrondMat = toonMaterial(0x2fa84f, {});

    // Branch stub geometry
    const branchGeo = new THREE.CylinderGeometry(0.08, 0.04, 0.6, 6);
    const branchMat = toonMaterial(0x6d4c41, {});

    // FINAL instanced meshes (real geometries, the ONLY ones added to the
    // scene). AUDIT FIX: matrices were written into dead meshes holding
    // empty BufferGeometry while these scene meshes never got a matrix —
    // every trunk/canopy rendered piled at world origin (a visible blob).
    // finalCanopies carries the pine cone-stack, finalDarkCanopies the oak
    // spheres (names kept for compatibility) — both exact-sized per species
    // so no instance slot is ever dead.
    let pineLayerCount = 0;
    let oakLayerCount = 0;
    trees.forEach(tree => {
      const sp = species[tree.speciesIdx];
      if (sp.name === 'pine') pineLayerCount += sp.canopyLayers.length;
      else if (sp.name === 'oak') oakLayerCount += sp.canopyLayers.length;
    });
    const finalTrunks = new THREE.InstancedMesh(trunkGeoms[0], trunkMats[0], trees.length);
    const finalCanopies = new THREE.InstancedMesh(canopyGeoms[0], canopyMats[0], pineLayerCount);
    const finalDarkCanopies = new THREE.InstancedMesh(canopyGeoms[1], canopyMats[1], oakLayerCount);
    const branchStubs = new THREE.InstancedMesh(branchGeo, branchMat, trees.length * 2); // 2 branch stubs per tree
    // let: reassigned below with the real frond count (const-in-block shadowed
    // the outer binding → TDZ ReferenceError at scene.remove — user bug #2)
    let palmFronds = new THREE.InstancedMesh(palmFrondGeo, palmFrondMat, 0); // Will resize for palms

    // Fake-AO grounding discs (FECO 'flat foliage'): a soft dark radial blob
    // laid flat under EVERY tree — MK8-style contact grounding so trunks read
    // as planted, not pasted. One shared circle geometry + texture, one
    // InstancedMesh for the whole forest (deterministic per tree).
    const { geo: aoDiscGeo, mat: aoDiscMat } = getAODiscParts();
    const aoDiscs = new THREE.InstancedMesh(aoDiscGeo, aoDiscMat, trees.length);

    const dummy = new THREE.Object3D();
    let pineLayer = 0;
    let oakLayer = 0;
    let palmCount = 0;

    // Reused scratch for per-instance HSL lightness jitter (±8%).
    const canopyHSL = { h: 0, s: 0, l: 0 };
    const canopyColor = new THREE.Color();

    // Per-instance HSL lightness jitter around the species' base canopy
    // color: neighboring same-species trees never share an exact color, so
    // the forest reads organic instead of cloned. Deterministic per-instance
    // seed (no Math.random — placement must stay reproducible).
    // AUDIT R12 (crítico cego: 'árvores como volumes recortados com
    // sombreamento simples'): two-tone MK8 — layerFrac aplica gradiente
    // luz/sombra na copa (topo +claro, base -escuro, ±6.5%) sobre o jitter
    // ±8% existente (total ±14%) + hue/sat jitter p/ espécie não-clone.
    function jitterCanopyColor(mesh, index, baseHex, seed, layerFrac = 0.5) {
      const rand = rnd(seed);
      canopyColor.set(baseHex);
      canopyColor.getHSL(canopyHSL);
      canopyHSL.l = Math.min(1, Math.max(0, canopyHSL.l + (rand() - 0.5) * 0.16 + (layerFrac - 0.5) * 0.13));
      canopyHSL.h = Math.min(1, Math.max(0, canopyHSL.h + (rand() - 0.5) * 0.03));
      canopyHSL.s = Math.min(1, Math.max(0, canopyHSL.s + (rand() - 0.5) * 0.08));
      canopyColor.setHSL(canopyHSL.h, canopyHSL.s, canopyHSL.l);
      mesh.setColorAt(index, canopyColor);
    }

    // Count palms first to allocate frond instances
    trees.forEach(tree => {
      if (species[tree.speciesIdx].name === 'palm') palmCount++;
    });
    if (palmCount > 0) {
      // Replace palm fronds mesh with proper sizing (reassign, don't redeclare)
      scene.remove(palmFronds);
      palmFronds = new THREE.InstancedMesh(palmFrondGeo, palmFrondMat, palmCount * 12); // 12 fronds per palm
    }

    let palmInstance = 0;

    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i];
      const speciesData = species[tree.speciesIdx];
      const { x, z, s } = tree;

      // Position based on terrain height
      const h = this._gy(x, z);
      const baseY = h + 1.0 * s;

      // Position and scale trunk
      dummy.position.set(x, baseY + speciesData.trunkHeight * s * 0.5, z);
      dummy.scale.set(s, s * speciesData.trunkHeight / 3.4, s); // Normalize height
      dummy.rotation.set(0, rnd(5000 + i)() * Math.PI, 0);
      dummy.updateMatrix();
      finalTrunks.setMatrixAt(i, dummy.matrix); // AUDIT FIX: was never written

      // Position canopy layers
      for (let layerIdx = 0; layerIdx < speciesData.canopyLayers.length; layerIdx++) {
        const layer = speciesData.canopyLayers[layerIdx];
        const canopyY = baseY + layer.yOffset * s;

        if (speciesData.name === 'palm') {
          // Special handling for palm fronds
          for (let frond = 0; frond < 12; frond++) {
            const frondAngle = (frond / 12) * Math.PI * 2;
            dummy.position.set(
              x + Math.cos(frondAngle) * 0.8 * s,
              canopyY,
              z + Math.sin(frondAngle) * 0.8 * s
            );
            dummy.rotation.set(
              Math.PI * 0.6, // Angle fronds upward
              frondAngle,
              0
            );
            dummy.scale.set(s * 0.8, s * 1.2, s * 0.8);
            dummy.updateMatrix();
            palmFronds.setMatrixAt(palmInstance, dummy.matrix); // AUDIT FIX: fronds were never placed
            jitterCanopyColor(palmFronds, palmInstance, speciesData.canopyColor, 15000 + i * 3 + frond);
            palmInstance++;
          }
        } else if (speciesData.name === 'pine') {
          // Stacked-CONE canopy: each layer is a cone from the unit pine
          // geometry scaled to (layer.radius × s, layer.height × s). The
          // three cones overlap with decreasing radius up the trunk — a
          // stepped pine silhouette instead of the old sphere stack.
          dummy.position.set(x, canopyY, z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(layer.radius * s, layer.height * s, layer.radius * s);
          dummy.updateMatrix();
          finalCanopies.setMatrixAt(pineLayer, dummy.matrix); // AUDIT FIX: was written to a dead mesh
          jitterCanopyColor(finalCanopies, pineLayer, speciesData.canopyColor, 13000 + i * 7 + layerIdx,
            speciesData.canopyLayers.length > 1 ? layerIdx / (speciesData.canopyLayers.length - 1) : 0.5); // AUDIT R12: two-tone por camada
          pineLayer++;
        } else {
          // Oak: layered sphere canopy (unchanged silhouette).
          dummy.position.set(x, canopyY, z);
          const layerScale = layer.radius * s / 1.6; // Normalize to base radius of 1.6
          dummy.scale.set(layerScale, layerScale, layerScale);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          finalDarkCanopies.setMatrixAt(oakLayer, dummy.matrix); // AUDIT FIX: was written to a dead mesh
          jitterCanopyColor(finalDarkCanopies, oakLayer, speciesData.canopyColor, 14000 + i * 7 + layerIdx,
            speciesData.canopyLayers.length > 1 ? layerIdx / (speciesData.canopyLayers.length - 1) : 0.5); // AUDIT R12: two-tone por camada
          oakLayer++;
        }
      }

      // Add branch stubs (2 per tree, randomized but deterministic)
      for (let branch = 0; branch < 2; branch++) {
        const branchRand = rnd(8000 + i * 10 + branch);
        const branchAngle = branchRand() * Math.PI * 2;
        const branchHeight = 0.3 + branchRand() * 0.4;
        dummy.position.set(
          x + Math.cos(branchAngle) * 0.3 * s,
          baseY + speciesData.trunkHeight * s * 0.7 + branchHeight * s,
          z + Math.sin(branchAngle) * 0.3 * s
        );
        dummy.rotation.set(
          branchRand() * Math.PI * 0.5,
          branchAngle,
          0
        );
        dummy.scale.set(s * 0.5, s * (0.3 + branchRand() * 0.4), s * 0.5);
        dummy.updateMatrix();
        branchStubs.setMatrixAt(i * 2 + branch, dummy.matrix);
      }

      // Grounding disc: radius tracks the species' widest canopy layer so the
      // shadow hugs the skirt. Laid flat (rotation.x = -PI/2 turns the circle
      // up), just above the terrain, deterministic per tree.
      const discR = (speciesData.name === 'oak' ? 2.1 : speciesData.name === 'palm' ? 1.3 : 1.6) * s;
      dummy.position.set(x, h + 0.03, z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(discR, discR, 1);
      dummy.updateMatrix();
      aoDiscs.setMatrixAt(i, dummy.matrix);
    }

    // All matrices were written into the FINAL meshes above (audit fix).
    finalTrunks.instanceMatrix.needsUpdate = true;
    if (pineLayerCount > 0) finalCanopies.instanceMatrix.needsUpdate = true;
    if (oakLayerCount > 0) finalDarkCanopies.instanceMatrix.needsUpdate = true;
    branchStubs.instanceMatrix.needsUpdate = true;
    if (palmCount > 0) palmFronds.instanceMatrix.needsUpdate = true;
    // Per-instance canopy colors (setColorAt created the instanceColor buffers)
    if (finalCanopies.instanceColor) finalCanopies.instanceColor.needsUpdate = true;
    if (finalDarkCanopies.instanceColor) finalDarkCanopies.instanceColor.needsUpdate = true;
    if (palmCount > 0 && palmFronds.instanceColor) palmFronds.instanceColor.needsUpdate = true;

    // Add to scene
    // AUDIT AAA (2026-08-15): a floresta NUNCA projetou sombra (palmeiras sim).
    // Copas varrendo o infield/verge = dappled light + grounding. InstancedMesh
    // suporta shadow; o frustum ±28m que segue o jogador cobre as árvores de
    // 15-19m da pista, e instâncias distantes são culled pela shadow camera.
    [finalTrunks, finalCanopies, finalDarkCanopies, branchStubs].forEach((m) => { m.castShadow = true; });
    if (palmCount > 0) palmFronds.castShadow = true; // fronds reassignados
    scene.add(finalTrunks, branchStubs);
    if (pineLayerCount > 0) scene.add(finalCanopies);
    if (oakLayerCount > 0) scene.add(finalDarkCanopies);
    if (palmCount > 0) scene.add(palmFronds);
    aoDiscs.instanceMatrix.needsUpdate = true;
    scene.add(aoDiscs);

  }

  buildProps(scene, track) {
    // --- Rocks: grouped boulders (2-3 per cluster) on organized ring
    //     positions — detail-1 dodecahedrons stay faceted, not flat.
    const rockGeo = new THREE.DodecahedronGeometry(0.7, 1);
    const rockMat = toonMaterial(0xa9a9b8, {});
    const rockSpots = [];
    const rockClusters = 11;
    for (let c = 0; c < rockClusters; c++) {
      const rand = rnd(4000 + c);
      const ca = (c / rockClusters) * Math.PI * 2 + 0.9;
      const cr = 46 + rand() * 118;
      const cx = Math.cos(ca) * cr;
      const cz = Math.sin(ca) * cr;
      if (this._onTrack(cx, cz, 16) || inWater(cx, cz, 6)) continue;
      const per = 2 + ((rand() * 2) | 0); // 2-3 rocks per cluster
      for (let k = 0; k < per; k++) {
        const r2 = rnd(4000 + c * 8 + k);
        const rx2 = cx + (r2() - 0.5) * 2.6;
        const rz2 = cz + (r2() - 0.5) * 2.6;
        // AUDIT R19 (Feco: 'mato na pista'): mesmo bug dos bushes — o clump
        // só verificava _onTrack no CENTRO, membro podia cair na pista.
        if (this._onTrack(rx2, rz2, 3) || inWater(rx2, rz2, 3)) continue;
        rockSpots.push({
          x: rx2,
          z: rz2,
          s: 0.55 + r2() * 1.3,
          ry: r2() * Math.PI,
          rx: (r2() - 0.5) * 0.5,
          rz: (r2() - 0.5) * 0.5,
        });
      }
    }
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
    rocks.castShadow = true; // AUDIT r5: contact shadows ground the props
    const dummy = new THREE.Object3D();
    rockSpots.forEach((r, i) => {
      dummy.position.set(r.x, this._gy(r.x, r.z) + 0.33 * r.s, r.z);
      dummy.scale.setScalar(r.s);
      dummy.rotation.set(r.rx, r.ry, r.rz);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    });
    rocks.instanceMatrix.needsUpdate = true;
    scene.add(rocks);

    // --- Mid-field ring (AUDIT r3: the 20-45m band between the trees and
    //     the landmark ring was EMPTY — the critic's 'sparse' at chase-cam
    //     distance). ~70 bushes/rocks/flowers seeded 25-40m, one draw call.
    const midGeo = new THREE.SphereGeometry(0.7, 10, 8);
    const midMat = toonMaterial(0x2f8f43, {});
    const midSpots = [];
    const MID_N = 70;
    const aoSpots = []; // fake-AO disc placements (mid-ring + bushes + roadside)
    for (let c = 0; c < MID_N; c++) {
      const mr = rnd(9000 + c);
      const ma = (c / MID_N) * Math.PI * 2 + 0.55;
      const mrad = 25 + mr() * 15;
      const mx = Math.cos(ma) * mrad;
      const mz = Math.sin(ma) * mrad;
      if (this._onTrack(mx, mz, 14) || inWater(mx, mz, 5)) continue;
      midSpots.push({ x: mx, z: mz, s: 0.5 + mr() * 0.8, ry: mr() * Math.PI });
    }
    // r11: fake-AO grounding disc under every mid-ring prop.
    midSpots.forEach((r) => aoSpots.push({ x: r.x, z: r.z, r: 0.85 * r.s, ry: r.ry }));
    if (midSpots.length) {
      const mids = new THREE.InstancedMesh(midGeo, midMat, midSpots.length);
      mids.castShadow = false; // AUDIT PERF-R33: mids pequenos sub-pixel no shadow map — sombra só custava fill
      const col = new THREE.Color();
      const MPAL = [0x2f8f43, 0x3faf4e, 0x6d4c41, 0x7f8c8d, 0xc9a86a];
      midSpots.forEach((r, i) => {
        dummy.position.set(r.x, this._gy(r.x, r.z) + 0.2 * r.s, r.z);
        dummy.scale.setScalar(r.s);
        dummy.rotation.set(0, r.ry, 0);
        dummy.updateMatrix();
        mids.setMatrixAt(i, dummy.matrix);
        col.setHex(MPAL[i % MPAL.length]);
        mids.setColorAt(i, col);
      });
      mids.instanceMatrix.needsUpdate = true;
      if (mids.instanceColor) mids.instanceColor.needsUpdate = true;
      scene.add(mids);
    }

    // --- Bushes: clumped undergrowth (2-3 per spot) on organized ring
    //     positions — smoother 12x8 spheres, no flat facets.
    const bushGeo = new THREE.SphereGeometry(0.9, 12, 8);
    const bushMat = toonMaterial(0x2f8f43, {});
    const bushSpots = [];
    const bushClusters = 10;
    for (let c = 0; c < bushClusters; c++) {
      const rand = rnd(6000 + c);
      const ca = (c / bushClusters) * Math.PI * 2 + 0.2;
      const cr = 50 + rand() * 108;
      const cx = Math.cos(ca) * cr;
      const cz = Math.sin(ca) * cr;
      if (this._onTrack(cx, cz, 15) || inWater(cx, cz, 6)) continue;
      const per = 2 + ((rand() * 2) | 0); // 2-3 bushes per clump
      for (let k = 0; k < per; k++) {
        const r2 = rnd(6000 + c * 8 + k);
        const bx = cx + (r2() - 0.5) * 2.4;
        const bz = cz + (r2() - 0.5) * 2.4;
        // AUDIT R19 (Feco real-GPU 2026-08-14: 'mato no meio da pista'): o
        // clump só verificava _onTrack no CENTRO — um membro com jitter
        // podia cair NA PISTA. Re-verifica cada membro (margem 3 = fora da
        // faixa e do kerb).
        if (this._onTrack(bx, bz, 3) || inWater(bx, bz, 3)) continue;
        bushSpots.push({
          x: bx,
          z: bz,
          s: 0.95 + r2() * 0.6,
          ry: r2() * Math.PI,
        });
      }
    }
    // r11 (FECO 'flat bushes'): each bush SPOT becomes a CLUSTER of 2-3
    // overlapping spheres (offset lobes, smaller + slightly higher — the MK8
    // undergrowth look) instead of one lone sphere. Still ONE InstancedMesh,
    // per-sphere tone variation, plus a fake-AO disc under each cluster.
    const bushLobes = []; // flat list of sphere instances
    bushSpots.forEach((b, i) => {
      const hScale = 0.75 + rnd(6100 + i)() * 0.25; // original per-spot shape rng (kept)
      const cr = rnd(6150 + i); // dedicated cluster rng (deterministic)
      const n = 2 + ((cr() * 2) | 0); // 2-3 overlapping spheres
      const a0 = cr() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const off = k === 0 ? 0 : 0.34 + cr() * 0.14; // lobe offset (frac of s)
        const a = k === 0 ? 0 : a0 + k * 2.1;         // spread lobes around
        const lx = b.x + Math.cos(a) * off * b.s;
        const lz = b.z + Math.sin(a) * off * b.s;
        // AUDIT R79 (audit-geometry 2026-08-15: ACHOU lobes a 0.8m da
        // centerline): o R19 verificava os SPOTS com _onTrack, mas os LOBES
        // (offset até 0.48×scale = ~0.7m) eram empurrados DEPOIS sem
        // re-check — um lobe deslocado cruzava a pista. Era o 'arbusto no
        // meio da pista' real que o usuário viu e o headless não pegou.
        // AUDIT R79c (audit-geometry ainda achou 44): o gate usava margem
        // 2.5 do CENTRO, mas o lobe tem RAIO 0.9×scale (até ~1.4m) — a
        // EXTENSÃO cruza. Margem = 2.5 + raio real do lobe (com scale).
        if (k > 0) {
          const lobeR = 0.9 * b.s * (k === 0 ? 1 : 0.7 + cr() * 0.18);
          if (this._onTrack(lx, lz, 2.5 + lobeR)) continue;
        }
        bushLobes.push({
          x: lx,
          z: lz,
          s: b.s * (k === 0 ? 1 : 0.7 + cr() * 0.18), // lobes shrink outward
          hScale,
          ry: b.ry,
          lift: k * 0.1 * b.s, // back lobes sit higher (depth cue)
        });
      }
      aoSpots.push({ x: b.x, z: b.z, r: 1.1 * b.s, ry: b.ry });
    });
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushLobes.length);
    bushes.castShadow = true; // AUDIT r5: contact shadows
    const bushCol = new THREE.Color();
    const BUSH_TONES = [0x2f8f43, 0x3faf4e, 0x4cc25e]; // 3-tone undergrowth (FECO: flat green)
    bushLobes.forEach((b, i) => {
      dummy.position.set(b.x, this._gy(b.x, b.z) + 0.55 * b.s + b.lift, b.z);
      dummy.scale.set(b.s, b.s * b.hScale, b.s);
      dummy.rotation.y = b.ry;
      dummy.updateMatrix();
      bushes.setMatrixAt(i, dummy.matrix);
      bushCol.setHex(BUSH_TONES[i % BUSH_TONES.length]);
      bushes.setColorAt(i, bushCol);
    });
    bushes.instanceMatrix.needsUpdate = true;
    if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
    scene.add(bushes);

    // Roadside greenery: dense bushes hugging the track edge (known spots).
    // FECO fix: 3-tone per-instance greens + tiny bright flower dots on some
    // bushes so the undergrowth reads as layered vegetation, not flat color.
    const ROAD_TONES = [0x2f8f43, 0x3faf4e, 0x4cc25e];
    const dotGeo = new THREE.SphereGeometry(0.09, 8, 6); // flower dot on the canopy
    const dotMat = toonMaterial(0xffffff, {});
    const dotColors = [0xff5a5f, 0xffd166, 0xffffff, 0xff9f45];
    const dotSpots = [];
    const edgeSpots = [
      [-58, 14], [-40, -44], [-14, -60], [26, -62], [52, -42], [64, -10],
      [56, 26], [30, 52], [-6, 60], [-36, 48], [-58, 26], [-24, -30],
      [8, -44], [44, -20], [18, 24], [-16, 12], [36, 8], [-48, -8],
      [12, 44], [-30, 36],
    ];
    // r11: roadside bushes are CLUSTERS of 2-3 overlapping spheres too (the
    // ones closest to the camera — lone spheres read as flat green blobs).
    const roadClusters = [];
    for (let i = 0; i < edgeSpots.length; i++) {
      const [x, z] = edgeSpots[i];
      // Try growing offsets until the bush clears the road.
      let bx = x;
      let bz = z;
      for (let attempt = 0; attempt < 4; attempt++) {
        const off = (i % 2 === 0 ? 1 : -1) * (7 + attempt * 9 + this._rand() * 4);
        bx = x + off * 0.7;
        bz = z + off * 0.7;
        if (!this._onTrack(bx, bz, 6)) break;
      }
      // AUDIT R79e (audit-geometry 2026-08-15): se as 4 tentativas ficaram
      // DENTRO da pista (curvas fechadas — o offset é na tangente, não na
      // normal), o loop usava o último bx/bz (on-track) SEM rejeitar — um
      // bush nascia no asfalto. Rejeita o spot inteiro.
      if (this._onTrack(bx, bz, 6)) continue;
      const gy = this._gy(bx, bz);
      const ry = this._rand() * Math.PI;
      const hScale = 0.9 + this._rand() * 0.5; // same _rand() call order as before
      const cr = rnd(7650 + i); // dedicated cluster rng (deterministic)
      const n = 2 + ((cr() * 2) | 0);
      const a0 = cr() * Math.PI * 2;
      for (let k = 0; k < n; k++) {
        const offD = k === 0 ? 0 : 0.34 + cr() * 0.14;
        const a = k === 0 ? 0 : a0 + k * 2.1;
        const lobeS = k === 0 ? 1.2 : 1.2 * (0.7 + cr() * 0.18);
        const lx = bx + Math.cos(a) * offD * 1.2;
        const lz = bz + Math.sin(a) * offD * 1.2;
        // AUDIT R79: lobes do roadside também sem re-check (mesmo bug dos
        // bushLobes — lobe deslocado podia cruzar a pista).
        // AUDIT R79c: margem inclui o RAIO do lobe (0.9×lobeS).
        if (k > 0 && this._onTrack(lx, lz, 2.5 + 0.9 * lobeS)) continue;
        roadClusters.push({
          x: lx,
          z: lz,
          s: lobeS,
          hScale,
          ry,
          lift: k * 0.1 * 1.2,
        });
      }
      aoSpots.push({ x: bx, z: bz, r: 1.3, ry: 0 }); // fake-AO under the cluster
      // flower dots on ~60% of bushes (dedicated seeds — shared _rand untouched)
      const dr = rnd(7500 + i);
      if (dr() < 0.6) {
        dotSpots.push({
          x: bx + (dr() - 0.5) * 0.7,
          z: bz + (dr() - 0.5) * 0.7,
          y: gy + 0.95 + dr() * 0.45,
          s: 0.7 + dr() * 0.7,
          color: dotColors[(dr() * dotColors.length) | 0],
        });
      }
    }
    const roadside = new THREE.InstancedMesh(bushGeo, bushMat, roadClusters.length);
    roadside.castShadow = true; // AUDIT r5: contact shadows
    roadClusters.forEach((c, i) => {
      dummy.position.set(c.x, this._gy(c.x, c.z) + 0.55 * c.s + c.lift, c.z);
      dummy.scale.set(c.s, c.s * c.hScale, c.s);
      dummy.rotation.y = c.ry;
      dummy.updateMatrix();
      roadside.setMatrixAt(i, dummy.matrix);
      roadside.setColorAt(i, new THREE.Color(ROAD_TONES[i % ROAD_TONES.length]));
    });
    roadside.instanceMatrix.needsUpdate = true;
    if (roadside.instanceColor) roadside.instanceColor.needsUpdate = true;
    scene.add(roadside);

    // Fake-AO grounding discs under every bush (mid-ring + ring clusters +
    // roadside) — soft dark radial blobs laid flat on the field so the
    // undergrowth reads as planted, not floating (FECO 'flat props').
    const { geo: aoDiscGeo, mat: aoDiscMat } = getAODiscParts();
    const aoDiscs = new THREE.InstancedMesh(aoDiscGeo, aoDiscMat, aoSpots.length);
    aoSpots.forEach((d, i) => {
      dummy.position.set(d.x, this._gy(d.x, d.z) + 0.03, d.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(d.r, d.r, 1);
      dummy.updateMatrix();
      aoDiscs.setMatrixAt(i, dummy.matrix);
    });
    aoDiscs.instanceMatrix.needsUpdate = true;
    scene.add(aoDiscs);
    if (dotSpots.length) {
      const dots = new THREE.InstancedMesh(dotGeo, dotMat, dotSpots.length);
      dotSpots.forEach((d, i) => {
        dummy.position.set(d.x, d.y, d.z);
        dummy.scale.setScalar(d.s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        dots.setMatrixAt(i, dummy.matrix);
        dots.setColorAt(i, new THREE.Color(d.color));
      });
      dots.instanceMatrix.needsUpdate = true;
      if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
      scene.add(dots);
    }

    // Wildflowers: tight clustered patches (5-8 heads per patch, ~1.5 m
    // spread) — the meadow reads designed, never random confetti. Each
    // flower is a green stem + smooth 8x6 head.
    const flowerGeo = new THREE.SphereGeometry(0.16, 8, 6);
    const stemGeo = new THREE.CylinderGeometry(0.025, 0.045, 0.55, 6);
    const flowerMat = toonMaterial(0xffffff, {});
    const stemMat = toonMaterial(0x2f8f43, {});
    const flowerColors = [0xff5a5f, 0xffd166, 0x2ec4ff, 0xc86bff, 0xffffff];
    const flowerSpots = [];
    const flowerPatches = 15;
    for (let c = 0; c < flowerPatches; c++) {
      const rand = rnd(8000 + c);
      const ca = (c / flowerPatches) * Math.PI * 2 + 0.6;
      const cr = 26 + rand() * 148;
      const cx = Math.cos(ca) * cr;
      const cz = Math.sin(ca) * cr;
      if (this._onTrack(cx, cz, 16) || inWater(cx, cz, 8)) continue;
      const per = 5 + Math.floor(rand() * 4); // 5-8 flowers per patch
      for (let k = 0; k < per; k++) {
        const r2 = rnd(8000 + c * 12 + k);
        flowerSpots.push({
          x: cx + (r2() - 0.5) * 2.8,
          z: cz + (r2() - 0.5) * 2.8,
          s: 0.85 + r2() * 0.8,
          ry: r2() * Math.PI,
          color: flowerColors[(r2() * flowerColors.length) | 0],
        });
      }
    }
    const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerSpots.length);
    flowers.castShadow = false; // AUDIT PERF-R33: flores 0.16m sub-pixel no shadow map 2048 — sombra só custava fill; manter rocks/bushes (contato real)
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, flowerSpots.length);
    flowerSpots.forEach((f, i) => {
      const gy = smoothH(f.x, f.z) * 0.5 - 0.25;
      dummy.position.set(f.x, gy + 0.3 * f.s, f.z);
      dummy.scale.set(f.s, f.s, f.s);
      dummy.rotation.set(0, f.ry, 0);
      dummy.updateMatrix();
      stems.setMatrixAt(i, dummy.matrix);
      dummy.position.set(f.x, gy + 0.58 * f.s, f.z);
      dummy.scale.setScalar(f.s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      flowers.setMatrixAt(i, dummy.matrix);
      flowers.setColorAt(i, new THREE.Color(f.color));
    });
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    stems.instanceMatrix.needsUpdate = true;
    scene.add(flowers, stems);

    // Billboards with the game logo along the track.
    const boardCanvas = document.createElement('canvas');
    boardCanvas.width = 256;
    boardCanvas.height = 128;
    const bctx = boardCanvas.getContext('2d');
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(0, 0, 256, 128);
    bctx.fillStyle = '#2ec4ff';
    bctx.fillRect(0, 0, 256, 22);
    bctx.fillStyle = '#ff5a5f';
    bctx.fillRect(0, 106, 256, 22);
    bctx.fillStyle = '#1b2a41';
    bctx.font = 'bold 34px sans-serif';
    bctx.textAlign = 'center';
    bctx.fillText('SUPER KART', 128, 72);
    bctx.font = 'bold 22px sans-serif';
    bctx.fillStyle = '#ff9f45';
    bctx.fillText('3D.js', 128, 98);
    const boardTex = new THREE.CanvasTexture(boardCanvas);
    boardTex.colorSpace = THREE.SRGBColorSpace;

    const boardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    boardMat.map = boardTex;
    const boardGeo = new THREE.BoxGeometry(4.6, 2.3, 0.35);
    // Path-relative stations: the old hardcoded world coords all fell
    // inside the _onTrack guard (radius roadWidth/2+8 = 12.5m) on the
    // current Meadow layout, so ZERO boards spawned. Six stations spread
    // around the loop, alternating sides, clear of the sponsor-board
    // stations (t 0.05/0.28/0.55/0.82 at halfW+2.6) and facing the road.
    const spots = [
      { t: 0.10, side: 1 }, { t: 0.26, side: -1 }, { t: 0.42, side: 1 },
      { t: 0.59, side: -1 }, { t: 0.75, side: 1 }, { t: 0.91, side: -1 },
    ];
    const lateral = CONFIG.track.roadWidth / 2 + 11; // 15.5m: outside the 12.5m guard + 3m slack
    const bp = new THREE.Vector3();
    const btan = new THREE.Vector3();
    const bnrm = new THREE.Vector3();
    for (const s of spots) {
      track.path.getPointAt(s.t, bp);
      track.path.getTangentAt(s.t, btan);
      bnrm.set(-btan.z, 0, btan.x).normalize();
      const bx = bp.x + bnrm.x * lateral * s.side;
      const bz = bp.z + bnrm.z * lateral * s.side;
      if (this._onTrack(bx, bz, 8)) continue; // keep billboards off the road
      const bgy = this._gy(bx, bz);
      const board = new THREE.Mesh(boardGeo, boardMat);
      const by = bgy + 1.5;
      board.position.set(bx, by, bz);
      board.lookAt(bp.x, by, bp.z); // face the road, stays vertical
      board.castShadow = true;
      scene.add(board);
      // legs (fold-proof: NEVER read board.rotation.y after lookAt —
      // Euler-XYZ extracts y as asin(m13), folding true yaws beyond ±90°
      // (e.g. true 2.02 reads as 1.12) and stranding the poles ~1.6m off
      // the board face. Build the road-facing frame directly instead.)
      const dxr = bp.x - bx, dzr = bp.z - bz;
      const rl = Math.hypot(dxr, dzr) || 1;
      const sx = dzr / rl, sz = -dxr / rl; // local +X = cross(up, roadDir)
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.09, 1.5, 8),
          toonMaterial(0x8b7a5c, {})
        );
        const lx = bx + side * 2.0 * sx;
        const lz = bz + side * 2.0 * sz;
        leg.position.set(lx, this._gy(lx, lz) + 0.75, lz);
        scene.add(leg);
      }
    }
  }

  /**
   * Distant "points of interest" for the open field (vision audit: beyond
   * the track verge the field read empty — MK8 fills it with readable
   * landmarks). Four organized clusters, one per compass quadrant, all
   * >60m from the centerline (guarded with _onTrack margin 50 so nothing
   * ever touches the road):
   *   pond (SE), hilltop grove (SW), rock formation (NW), windmill (NE).
   * Deterministic seeded rnd; every prop sits at smoothH terrain height.
   */
  buildFieldLandmarks(scene) {
    const gy = (x, z) => this._gy(x, z);
    // Place only when the spot clears the road (>50m from centerline).
    const place = (x, z, fn) => {
      if (!this._onTrack(x, z, 50)) fn();
    };

    // --- (a) pond: flat blue disc + darker rim ring + 3 edge rocks ---
    place(88, -62, () => {
      const px = 88;
      const pz = -62;
      const baseY = gy(px, pz);
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(4, 24),
        new THREE.MeshStandardMaterial({
          color: 0x3ec6ff,
          transparent: true,
          opacity: 0.8,
          emissive: 0x1e9bd6,
          emissiveIntensity: 0.35,
          roughness: 0.3,
        })
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(px, baseY + 0.06, pz);
      water.userData = { baseY: baseY + 0.06, phase: 3.9, baseColor: 0x3ec6ff };
      scene.add(water);
      this.waterMeshes.push(water); // shimmers with the lakes in update()
      // darker rim ring hugging the disc edge
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(3.2, 4, 24),
        toonMaterial(0x1e8ecf, {})
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(px, baseY + 0.03, pz);
      scene.add(rim);
      // 3 rocks banked on the rim (same dodecahedron style as buildProps)
      const rockGeo = new THREE.DodecahedronGeometry(0.55, 1);
      const rockMat = toonMaterial(0x9aa0ad, {});
      for (let i = 0; i < 3; i++) {
        const rand = rnd(46000 + i);
        const a = (i / 3) * Math.PI * 2 + rand() * 1.2;
        const r = 4.1 + rand() * 0.8;
        const s = 0.5 + rand() * 0.45;
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.set(px + Math.cos(a) * r, baseY + 0.3 * s, pz + Math.sin(a) * r);
        rock.scale.setScalar(s);
        rock.rotation.set((rand() - 0.5) * 0.6, rand() * Math.PI, (rand() - 0.5) * 0.6);
        rock.castShadow = true;
        scene.add(rock);
      }
    });

    // --- (b) hilltop grove: flattened-cone hill + 6 trees on the slope ---
    place(-95, -80, () => {
      const hx = -95;
      const hz = -80;
      const baseY = gy(hx, hz);
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(12, 2, 24),
        toonMaterial(0x3f9e4d, {})
      );
      hill.position.set(hx, baseY + 1, hz); // base at ground, 2m tall
      hill.castShadow = true;
      hill.receiveShadow = true;
      scene.add(hill);
      // 6 compact trees (smaller than forest trees) fanned around the peak
      const trunkMat = toonMaterial(0x6d4c41, {});
      const leafMat = toonMaterial(0x2e8b57, {});
      const leafMatDark = toonMaterial(0x256b41, {});
      const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 2.0, 10);
      const leafGeo = new THREE.SphereGeometry(0.9, 12, 9);
      for (let i = 0; i < 6; i++) {
        const rand = rnd(47000 + i);
        const a = (i / 6) * Math.PI * 2 + 0.5;
        const r = 2.5 + rand() * 5.5; // 2.5-8m from the peak
        const tx = hx + Math.cos(a) * r;
        const tz = hz + Math.sin(a) * r;
        const h = 2 * (1 - r / 12); // hill height under the tree
        const s = 0.8 + rand() * 0.4;
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(tx, baseY + h + 1.0 * s, tz);
        trunk.rotation.z = (rand() - 0.5) * 0.2;
        trunk.rotation.x = (rand() - 0.5) * 0.2;
        trunk.castShadow = true;
        scene.add(trunk);
        const leaf = new THREE.Mesh(leafGeo, i % 2 ? leafMatDark : leafMat);
        leaf.position.set(tx, baseY + h + 2.2 * s, tz);
        leaf.scale.set(s * 1.05, s * 0.9, s * 1.05);
        leaf.castShadow = true;
        scene.add(leaf);
      }
    });

    // --- (c) big rock formation: 4 large dodecahedra (1.6-2.4m) grouped ---
    place(-100, 75, () => {
      const rx = -100;
      const rz = 75;
      const baseY = gy(rx, rz);
      const geo = new THREE.DodecahedronGeometry(1, 1);
      const mat = toonMaterial(0xa9a9b8, {});
      const scales = [2.4, 1.9, 1.6, 2.1];
      for (let i = 0; i < scales.length; i++) {
        const rand = rnd(48000 + i);
        const a = (i / scales.length) * Math.PI * 2 + 0.9;
        const d = 2.2 + rand() * 2.4; // 2.2-4.6m from the cluster center
        const s = scales[i];
        const rock = new THREE.Mesh(geo, mat);
        rock.position.set(rx + Math.cos(a) * d, baseY + 0.33 * s, rz + Math.sin(a) * d);
        rock.scale.set(s, s * 0.9, s);
        rock.rotation.set((rand() - 0.5) * 0.5, rand() * Math.PI, (rand() - 0.5) * 0.5);
        rock.castShadow = true;
        scene.add(rock);
      }
    });

    // --- (d) windmill: cylinder tower + red cap + 4 box blades on a hub ---
    place(90, 80, () => {
      const wx = 90;
      const wz = 80;
      const baseY = gy(wx, wz);
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.68, 6, 12),
        toonMaterial(0xf4f0e6, {})
      );
      tower.position.set(wx, baseY + 3, wz);
      tower.castShadow = true;
      scene.add(tower);
      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(0.85, 1.1, 12),
        toonMaterial(0xe2504f, {}) // red cap reads at race distance
      );
      cap.position.set(wx, baseY + 6.5, wz);
      scene.add(cap);
      // rotor faces the track; the inner spin group turns the blades
      const rotor = new THREE.Group();
      rotor.position.set(wx, baseY + 6.2, wz);
      rotor.rotation.y = 2.5;
      const spin = new THREE.Group();
      const bladeGeo = new THREE.BoxGeometry(0.22, 3.0, 0.09);
      const bladeMat = toonMaterial(0xf4f0e6, {});
      for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.y = 1.5;
        blade.rotation.z = (i / 4) * Math.PI * 2;
        blade.castShadow = true;
        spin.add(blade);
      }
      const hub = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 10, 8),
        toonMaterial(0xe2504f, {})
      );
      spin.add(hub);
      rotor.add(spin);
      scene.add(rotor);
      this.windmillRotors.push(spin); // update() spins the blades
    });
  }


  /**
   * Infield densification (vision critic r5): the enclosed grass INSIDE the
   * loop read EMPTY from the chase cam — a flat, under-populated green void.
   * Adds seeded bush/rock/flower CLUSTERS, bright flower PATCHES and big rock
   * OUTCROPS, all strictly inside the loop (point-in-polygon on a high-res
   * centerline sample) and >=9m from the centerline (~4.5m past the guard
   * rail) so nothing touches the road. Grounded on this._gy (the same rolling
   * terrain every other prop sits on). Every prop is instanced (4 draw calls
   * for the whole infield) and placement uses fixed LOCAL seeds — never
   * Math.random, and the shared this._rand stream is untouched so every
   * existing builder keeps its bit-identical layout.
   */
  buildInfield(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const halfW = CONFIG.track.roadWidth / 2;
    const dummy = new THREE.Object3D();

    // High-res closed polyline of the centerline: inside-loop test (ray cast)
    // + exact road clearance (point-to-segment). 60 samples is too coarse to
    // prove a point sits INSIDE the loop.
    const LOOP_N = 240;
    const loop = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < LOOP_N; i++) {
      const p = path.getPointAt(i / LOOP_N);
      loop.push(p.x, p.z);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const inLoop = (x, z) => {
      let inside = false;
      for (let i = 0, j = loop.length - 2; i < loop.length; j = i, i += 2) {
        const xi = loop[i], zi = loop[i + 1];
        const xj = loop[j], zj = loop[j + 1];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    };
    const distToLoop = (x, z) => {
      let best = Infinity;
      for (let i = 0; i < loop.length; i += 2) {
        const j = (i + 2) % loop.length;
        const ax = loop[i], az = loop[i + 1];
        const bx = loop[j], bz = loop[j + 1];
        const abx = bx - ax, abz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz)));
        const dx = ax + abx * t - x;
        const dz = az + abz * t - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      return Math.sqrt(best);
    };

    // Feature centers are >=9m from the centerline (road edge is at halfW=4.5,
    // guard rail at halfW+1.1) and separated from every other feature.
    const ROAD_CLEAR = 9;
    const used = [];
    const trySpot = (rng, minSep, roadClear = ROAD_CLEAR) => {
      for (let a = 0; a < 160; a++) {
        const x = minX + rng() * (maxX - minX);
        const z = minZ + rng() * (maxZ - minZ);
        if (!inLoop(x, z)) continue;
        if (distToLoop(x, z) < roadClear) continue;
        if (inWater(x, z, 4)) continue;
        // AUDIT R79b: gate adicional — distância à CENTERLINE (não só ao
        // polygon do loop) com margem real. Em curvas o distToLoop mede a
        // distância ao polígono que pode estar DENTRO da faixa.
        if (this._onTrack(x, z, Math.max(3, roadClear - 6))) continue;
        let ok = true;
        for (const u of used) {
          const dx = x - u.x;
          const dz = z - u.z;
          if (dx * dx + dz * dz < minSep * minSep) { ok = false; break; }
        }
        if (!ok) continue;
        used.push({ x, z });
        return { x, z };
      }
      return null;
    };

    // Shared prop style (mirrors buildProps / buildRoadsideFlowersAndRocks).
    const bushGeo = new THREE.SphereGeometry(0.85, 12, 8);
    const bushMat = toonMaterial(0x2f8f43, {});
    const rockGeo = new THREE.DodecahedronGeometry(0.7, 1);
    const rockMat = toonMaterial(0xa9a9b8, {});
    const flowerHeadGeo = new THREE.ConeGeometry(0.11, 0.12, 6); // bright bud
    const flowerStemGeo = new THREE.CylinderGeometry(0.018, 0.032, 0.42, 5);
    const flowerHeadMat = toonMaterial(0xffffff, {});
    const flowerStemMat = toonMaterial(0x2f8f43, {});
    const flowerPalette = [0xff5a5f, 0xffd166, 0x2ec4ff, 0xc86bff, 0xffffff, 0xff9f45];
    const bushes = []; // {x,z,gy,s,hScale,ry}
    const rocks = []; // {x,z,gy,s,rx,ry,rz} — cluster rocks + outcrops + pebbles
    const flowers = []; // {x,z,gy,s,ry,color}

    // --- 1) clustered vegetation: 11 clusters x 4-8 bushes/rocks/flowers ---
    const CLUSTERS = 11;
    for (let c = 0; c < CLUSTERS; c++) {
      const rand = rnd(52000 + c);
      const spot = trySpot(rand, 9);
      if (!spot) continue;
      const per = 4 + ((rand() * 5) | 0); // 4-8 props per cluster
      for (let k = 0; k < per; k++) {
        const r2 = rnd(52000 + c * 13 + k);
        const ox = spot.x + (r2() - 0.5) * 4.4;
        const oz = spot.z + (r2() - 0.5) * 4.4;
        if (distToLoop(ox, oz) < halfW + 6) continue; // every prop clears the rail
        // AUDIT R79b: membro do cluster com jitter — re-verifica na centerline
        // (o spot passou, mas o membro ±2.2m pode cruzar em curvas).
        if (this._onTrack(ox, oz, 3)) continue;
        const gy = this._gy(ox, oz);
        const roll = r2();
        if (roll < 0.55) {
          bushes.push({ x: ox, z: oz, gy, s: 0.9 + r2() * 0.6, hScale: 0.75 + r2() * 0.3, ry: r2() * Math.PI });
        } else if (roll < 0.85) {
          rocks.push({ x: ox, z: oz, gy, s: 0.4 + r2() * 0.25, ry: r2() * Math.PI, rx: (r2() - 0.5) * 0.35, rz: (r2() - 0.5) * 0.35 });
        } else {
          flowers.push({ x: ox, z: oz, gy, s: 0.9 + r2() * 0.3, ry: r2() * Math.PI, color: flowerPalette[(r2() * flowerPalette.length) | 0] });
        }
      }
    }

    // --- 2) flower patches: 5 patches x ~28-32 bright flowers (disc) -------
    const PATCHES = 5;
    for (let p = 0; p < PATCHES; p++) {
      const rand = rnd(53000 + p);
      // Centers sit deep (>=halfW+8 from centerline) so even the patch rim
      // stays >=8m inside the loop — nothing reads near the rail.
      const spot = trySpot(rand, 7, halfW + 8);
      if (!spot) continue;
      const radius = 1.7 + rand() * 1.1;
      const per = 28 + ((rand() * 5) | 0);
      for (let k = 0; k < per; k++) {
        const r2 = rnd(53000 + p * 17 + k);
        const a = r2() * Math.PI * 2;
        const rr = Math.sqrt(r2()) * radius; // uniform disc fill
        const fx = spot.x + Math.cos(a) * rr;
        const fz = spot.z + Math.sin(a) * rr;
        flowers.push({ x: fx, z: fz, gy: this._gy(fx, fz), s: 0.85 + r2() * 0.4, ry: r2() * Math.PI, color: flowerPalette[(r2() * flowerPalette.length) | 0] });
      }
    }

    // --- 3) rock outcrops: 4 big dodecahedrons (1.5-2.5) + 2 pebbles each ---
    const OUTCROPS = 4;
    for (let o = 0; o < OUTCROPS; o++) {
      const rand = rnd(54000 + o);
      const spot = trySpot(rand, 8);
      if (!spot) continue;
      const ox = spot.x + (rand() - 0.5) * 2.0;
      const oz = spot.z + (rand() - 0.5) * 2.0;
      const s = 1.5 + rand() * 1.0; // 1.5-2.5m scale — breaks the flat grass
      rocks.push({ x: ox, z: oz, gy: this._gy(ox, oz), s, ry: rand() * Math.PI, rx: (rand() - 0.5) * 0.35, rz: (rand() - 0.5) * 0.35 });
      for (let k = 0; k < 2; k++) {
        const r2 = rnd(54000 + o * 9 + k);
        const px = ox + (r2() - 0.5) * 3.4;
        const pz = oz + (r2() - 0.5) * 3.4;
        rocks.push({ x: px, z: pz, gy: this._gy(px, pz), s: 0.35 + r2() * 0.4, ry: r2() * Math.PI, rx: (r2() - 0.5) * 0.4, rz: (r2() - 0.5) * 0.4 });
      }
    }

    // --- 4) CASTLE landmark (vision critic r5: 'iconic structures that
    // define the location') — the Meadow's identity piece: a warm-stone keep
    // (0xc9b38f) with 4 corner turrets, slate cone roofs, a darker-stone
    // plinth/trim (0xb3a17e) and a waving banner pennant on the keep roof.
    // Centered on the loop CENTROID (deepest point of the infield, ~58m
    // from the road — reads as the track's landmark from every camera
    // without ever touching the racing line). Placement uses a fixed LOCAL
    // seed so the shared this._rand stream stays untouched (every later
    // builder keeps its bit-identical layout). Grounded on this._gy. ---
    {
      const rand = rnd(56000);
      const n = loop.length / 2;
      let ccx = 0;
      let ccz = 0;
      for (let i = 0; i < loop.length; i += 2) { ccx += loop[i]; ccz += loop[i + 1]; }
      ccx /= n;
      ccz /= n;
      // Small deterministic nudge so the keep isn't dead-on the centroid.
      ccx += (rand() - 0.5) * 4;
      ccz += (rand() - 0.5) * 4;
      // Belt & suspenders: only build when the spot really is deep inside.
      if (inLoop(ccx, ccz) && distToLoop(ccx, ccz) >= 15) {
        // Keep the base clear: drop any infield prop within 6m of the keep.
        const clearR2 = 36;
        for (const arr of [bushes, rocks, flowers]) {
          for (let i = arr.length - 1; i >= 0; i--) {
            const dx = arr[i].x - ccx;
            const dz = arr[i].z - ccz;
            if (dx * dx + dz * dz < clearR2) arr.splice(i, 1);
          }
        }
        const gy = this._gy(ccx, ccz);
        const castle = new THREE.Group();
        // AUDIT r4: the flat stone merged with the grass — the keep now wears
        // a procedural stone-block+course canvas texture (tinted per part so
        // the r6 palette survives: keep darker 0x9d8a6c, walls lighter
        // 0xc9b38f), the slate roofs become deep-red TILE textures, and the
        // keep gains emissive windows + a big logo banner on the front wall.
        const stoneMat = toonMaterial(0x9d8a6c, { map: this._castleStoneTexture([3, 2]) });   // keep + turrets
        const trimMat = toonMaterial(0x8a7a5e, {});    // darker trim + plinth
        const roofMat = toonMaterial(0xffffff, { map: this._roofTileTexture([3, 1]) });       // keep roof — red tiles
        const turretRoofMat = toonMaterial(0xffffff, { map: this._roofTileTexture([2, 1]) }); // turret roofs
        const poleMat = toonMaterial(0x5d4e3f, {});    // banner pole (wood)
        const pennantMat = toonMaterial(0xd8433c, {}); // red pennant (bright)
        // base plinth — plants the keep on the rolling turf
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 3.0, 0.6, 16), trimMat);
        plinth.position.set(ccx, gy + 0.3, ccz);
        plinth.castShadow = true;
        castle.add(plinth);
        // keep body — the main tower (castleShadow on)
        const keep = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.6, 3.8, 16), stoneMat);
        keep.position.set(ccx, gy + 0.6 + 1.9, ccz);
        keep.castShadow = true;
        castle.add(keep);
        // darker trim ring just below the parapet
        const trim = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.28, 16), trimMat);
        trim.position.set(ccx, gy + 4.1, ccz);
        castle.add(trim);
        // keep roof — slate cone with a slight overhang
        const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(1.85, 1.3, 16), roofMat);
        keepRoof.position.set(ccx, gy + 4.4 + 0.65, ccz);
        keepRoof.castShadow = true;
        castle.add(keepRoof);
        // 4 corner turrets (diagonal corners of the keep) + cone roofs
        const turretGeo = new THREE.CylinderGeometry(0.5, 0.62, 2.8, 12);
        const turretRoofGeo = new THREE.ConeGeometry(0.78, 1.15, 12);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4; // corners at 45 deg
          const tx = ccx + Math.cos(a) * 1.9;
          const tz = ccz + Math.sin(a) * 1.9;
          const turret = new THREE.Mesh(turretGeo, stoneMat);
          turret.position.set(tx, gy + 0.6 + 1.4, tz);
          turret.castShadow = true;
          castle.add(turret);
          const troof = new THREE.Mesh(turretRoofGeo, turretRoofMat);
          troof.position.set(tx, gy + 0.6 + 2.8 + 0.575, tz);
          troof.castShadow = true;
          castle.add(troof);
        }
        // 3 emissive window strips on the keep — warm lit glass so the tower
        // reads as a lived-in castle, not a blank cylinder. Spread 120° apart
        // (clear of the 45° corner turrets), slightly proud of the wall face.
        const winFrameMat = toonMaterial(0x2b3242, {});
        const winGlassMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
        for (let k = 0; k < 3; k++) {
          const wa2 = 0.35 + k * ((Math.PI * 2) / 3);
          const wy = 1.8 + k * 0.9; // up the keep face (keep spans 0.6..4.4)
          const frame = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.82, 0.1), winFrameMat);
          frame.position.set(ccx + Math.cos(wa2) * 1.55, gy + wy, ccz + Math.sin(wa2) * 1.55);
          frame.rotation.y = Math.PI / 2 - wa2; // faces radially outward
          castle.add(frame);
          const glass = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.055), winGlassMat);
          glass.position.set(ccx + Math.cos(wa2) * 1.61, gy + wy, ccz + Math.sin(wa2) * 1.61);
          glass.rotation.y = Math.PI / 2 - wa2;
          castle.add(glass);
        }
        // banner pole + waving pennant on the keep roof
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.7, 6), poleMat);
        pole.position.set(ccx, gy + 5.7 + 0.85, ccz);
        castle.add(pole);
        const pennantPivot = new THREE.Group();
        const pennant = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.95, 3), pennantMat);
        pennant.rotation.z = -Math.PI / 2; // fly horizontally off the pole
        pennant.position.x = 0.475;        // base at the pole, tip pointing out
        pennantPivot.add(pennant);
        pennantPivot.position.set(ccx, gy + 5.7 + 1.7, ccz);
        castle.add(pennantPivot);
        this.flagMeshes.push(pennantPivot); // update() waves the pennant
        // AUDIT r6: the keep read as a gazebo — scale the mass up and add a
        // battlement ring so the silhouette says CASTLE at race distance.
        // r6b: 1.5 still small in the huge infield — 2.2 reads across it.
        castle.scale.setScalar(2.2);
        const wallMat = toonMaterial(0xc9b38f, { map: this._castleStoneTexture([4, 2]) }); // lighter stone + blocks
        const merlonMat = toonMaterial(0xb3a17e, {});
        const WALL_R = 5.2;
        const wallH = 1.5;
        for (let w = 0; w < 8; w++) {
          const wa = (w / 8) * Math.PI * 2 + Math.PI / 8;
          const wx = ccx + Math.cos(wa) * WALL_R;
          const wz = ccz + Math.sin(wa) * WALL_R;
          const wall = new THREE.Mesh(new THREE.BoxGeometry(3.1, wallH, 0.42), wallMat);
          wall.position.set(wx, gy + 0.6 + wallH / 2, wz);
          wall.rotation.y = -wa + Math.PI / 2;
          wall.castShadow = true;
          castle.add(wall);
          for (let m = -1; m <= 1; m++) {
            const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.5), merlonMat);
            merlon.position.set(
              wx + Math.cos(wa) * 0 + Math.sin(wa) * (m * 1.15),
              gy + 0.6 + wallH + 0.25,
              wz + Math.cos(wa) * (m * 1.15) * -1 + Math.sin(wa) * 0
            );
            // orient merlon along the wall tangent
            merlon.rotation.y = -wa + Math.PI / 2;
            merlon.castShadow = true;
            castle.add(merlon);
          }
        }
        // ONE large logo banner on the battlement wall FACING THE TRACK —
        // deep-red field, gold border, white shield + coral wheel (the game's
        // billboard palette: #ff5a5f / #ffd166 / #2ec4ff / #1b2a41). The
        // "front" wall is the one whose outward normal points at the nearest
        // loop point, so the banner greets the karts.
        {
          const bannerMat = toonMaterial(0xffffff, { map: this._castleBannerTexture(), side: THREE.DoubleSide });
          let bd = Infinity;
          let fnx = loop[0];
          let fnz = loop[1];
          for (let qi = 0; qi < loop.length; qi += 2) {
            const qdx = loop[qi] - ccx;
            const qdz = loop[qi + 1] - ccz;
            const qd = qdx * qdx + qdz * qdz;
            if (qd < bd) { bd = qd; fnx = loop[qi]; fnz = loop[qi + 1]; }
          }
          const frontA = Math.atan2(fnz - ccz, fnx - ccx);
          let fw = 0;
          let fBest = Infinity;
          for (let w = 0; w < 8; w++) {
            const wa = (w / 8) * Math.PI * 2 + Math.PI / 8;
            let diff = Math.abs(wa - frontA);
            diff = Math.min(diff, Math.PI * 2 - diff);
            if (diff < fBest) { fBest = diff; fw = w; }
          }
          const wa = (fw / 8) * Math.PI * 2 + Math.PI / 8;
          const banner = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), bannerMat);
          banner.position.set(ccx + Math.cos(wa) * 5.55, gy + 0.6 + 0.75, ccz + Math.sin(wa) * 5.55);
          banner.rotation.y = Math.PI / 2 - wa; // same orientation as the wall — faces outward
          castle.add(banner);
        }
        // 4 turret pennants — BIG red flags on the corner turrets (audit r6:
        // tiny flags were invisible at race distance — these read).
        const turretPennantMat = toonMaterial(0xd8433c, {});
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          const tx = ccx + Math.cos(a) * 1.9;
          const tz = ccz + Math.sin(a) * 1.9;
          const tp = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 3), turretPennantMat);
          tp.rotation.z = -Math.PI / 2;
          tp.rotation.y = a;
          tp.position.set(tx + Math.cos(a) * 0.75, gy + 0.6 + 4.35, tz + Math.sin(a) * 0.75);
          castle.add(tp);
        }
        scene.add(castle);
      }
    }

    // --- instanced meshes (4 draw calls for the whole infield) -------------
    if (bushes.length) {
      const mesh = new THREE.InstancedMesh(bushGeo, bushMat, bushes.length);
      const col = new THREE.Color();
      const PAL = [0x3faf4e, 0x4cc25e, 0x379c45, 0x58b368];
      bushes.forEach((b, i) => {
        dummy.position.set(b.x, b.gy + 0.55 * b.s, b.z);
        dummy.scale.set(b.s, b.s * b.hScale, b.s);
        dummy.rotation.set(0, b.ry, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        col.setHex(PAL[i % PAL.length]);
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
    }
    if (rocks.length) {
      const mesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
      const col = new THREE.Color();
      const PAL = [0xa9a9b8, 0x8f93a6, 0x9aa3ad, 0x8d7a5c];
      rocks.forEach((r, i) => {
        dummy.position.set(r.x, r.gy + 0.42 * r.s, r.z);
        dummy.scale.set(r.s, r.s * 0.72, r.s);
        dummy.rotation.set(r.rx, r.ry, r.rz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        col.setHex(PAL[i % PAL.length]);
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
    }
    if (flowers.length) {
      const heads = new THREE.InstancedMesh(flowerHeadGeo, flowerHeadMat, flowers.length);
      const stems = new THREE.InstancedMesh(flowerStemGeo, flowerStemMat, flowers.length);
      const col = new THREE.Color();
      flowers.forEach((f, i) => {
        dummy.position.set(f.x, f.gy + 0.22 * f.s, f.z); // stem base at grass
        dummy.scale.setScalar(f.s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        stems.setMatrixAt(i, dummy.matrix);
        dummy.position.set(f.x, f.gy + 0.51 * f.s, f.z); // head on the stem tip
        dummy.rotation.set(0, f.ry, 0);
        dummy.updateMatrix();
        heads.setMatrixAt(i, dummy.matrix);
        col.setHex(f.color);
        heads.setColorAt(i, col);
      });
      heads.instanceMatrix.needsUpdate = true;
      if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
      stems.instanceMatrix.needsUpdate = true;
      scene.add(heads, stems);
    }
  }

  /**
   * Warm atmospheric haze rings at the horizon, behind the mountain bands —
   * the sky-terrain seam reads as layered air instead of a hard edge
   * (vision critic: horizon haze was missing entirely). fog:false keeps the
   * bands visible past the fog far plane; low opacity keeps them subtle.
   */
  buildHorizonHaze(scene) {
    const bands = [
      { r: 230, y: 4.5, color: 0xfff2d8, opacity: 0.16 },
      { r: 285, y: 6.5, color: 0xffe9c9, opacity: 0.14 },
      { r: 345, y: 8.5, color: 0xd9ecff, opacity: 0.12 },
    ];
    for (const b of bands) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(b.r - 14, b.r + 14, 72),
        new THREE.MeshBasicMaterial({
          color: b.color,
          transparent: true,
          opacity: b.opacity,
          fog: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = b.y;
      scene.add(ring);
    }
  }

  /**
   * Sponsor banner strips along the straights, both sides, just outside the
   * guard-rail (rail at halfW+1.1, banners at halfW+2.4 — beyond rail+1.3,
   * so the tall poles never clip the chase camera). Bold diagonal racing
   * stripes + SUPER KART GP text read as trackside life at race distance.
   */
  buildTracksideBanners(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const halfW = CONFIG.track.roadWidth / 2;
    // SK3D FIX (2026-08-20, Feco real-GPU): BUG RAIZ das faixas esticadas.
    // _castleBannerTexture() (linha ~4231) também seta this._bannerTex como
    // uma textura 256×256 QUADRADA e é chamada ANTES deste builder → o
    // if(!this._bannerTex) aqui era falso e esta textura 512×128 NUNCA era
    // criada. O banner usava a textura quadrada do castle num Plane 4:1 →
    // esticamento "too wide/short". Renomeado para _tracksideBannerTex
    // (slot próprio) para não colidir com o _bannerTex do castle.
    if (!this._tracksideBannerTex) {
      const c = document.createElement('canvas');
      // AUDIT r6: 256x64 read soft on the 5.6m board (~46px/m) — 512x128
      // matches the finish/gantry texture standard.
      c.width = 512;
      c.height = 128;
      const g = c.getContext('2d');
      // diagonal racing stripes — reads as a sponsor banner at distance
      const colors = ['#e2504f', '#f4f6f8', '#2e9be8', '#ffd166'];
      for (let i = 0; i < 16; i++) {
        g.fillStyle = colors[i % colors.length];
        g.beginPath();
        g.moveTo(i * 32 - 32, 128);
        g.lineTo(i * 32 + 32, 128);
        g.lineTo(i * 32 + 64, 0);
        g.lineTo(i * 32, 0);
        g.closePath();
        g.fill();
      }
      g.fillStyle = 'rgba(27,42,65,0.85)';
      g.fillRect(0, 44, 512, 40);
      g.fillStyle = '#ffffff';
      g.font = '900 52px "Baloo 2", "Nunito", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('SUPER KART GP', 256, 64);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this._tracksideBannerTex = tex;
    }
    const bannerMat = new THREE.MeshBasicMaterial({ map: this._tracksideBannerTex, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const poleMat = toonMaterial(0x8b7a5c, {});
    // AUDIT r10 (FECO): the BoxGeometry mapped the banner texture on ALL six
    // faces — the 0.08m-thick side faces showed the whole 5.6m texture
    // stretched into thin strips (the 'distorted banners'). Only the ±Z
    // faces carry the print; edges get a neutral trim.
    // AUDIT PERF-R47 (2026-08-14, auditoria render #2): o BoxGeometry
    // multi-material (6 grupos por banner) = 6 draw calls por banner
    // (~216 calls). Agora FRAME (Box fino, edgeMat) + PRINT (Plane com a
    // textura) separados — 2 InstancedMesh (1 frame + 1 print) + postes
    // instanced: ~6 calls no total.
    const bannerEdgeMat = toonMaterial(0x6a5c48, {});
    const frameGeo = new THREE.BoxGeometry(5.6, 1.475, 0.08); // 4:1 (banner 5.5×1.375) — AUDIT FIX SK3D (2026-08-20): era 5.6×1.0 (5.6:1) com textura 512×128 (4:1) → esticava o logo ~1.4x. Agora geometry e textura têm o MESMO ratio.
    const printGeo = new THREE.PlaneGeometry(5.5, 1.375); // 4:1 — matching _bannerTex (512×128)
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 3.0, 8);
    const dummyB = new THREE.Object3D();
    const maxBanners = 40;
    const frames = new THREE.InstancedMesh(frameGeo, bannerEdgeMat, maxBanners);
    // AUDIT R70 (Feco real-GPU 2026-08-14: 'faixas esticadas + cobertura
    // MARROM por cima'): no R47 o print (Plane z=0) ficava DENTRO do frame
    // (Box 0.08) — a face frontal marrom do box vencia o depth test e
    // cobria a textura. Agora o print é deslocado para z=+0.05 (1cm À
    // FRENTE da face frontal) + espelho em z=-0.05 (fundo) — o marrom só
    // aparece nas laterais finas, como um quadro.
    const printsF = new THREE.InstancedMesh(printGeo, bannerMat, maxBanners);
    const printsB = new THREE.InstancedMesh(printGeo, bannerMat, maxBanners);
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, maxBanners * 2);
    [frames, printsF, printsB, poles].forEach((m) => { m.name = 'banner-instanced'; });
    scene.add(frames, printsF, printsB, poles);
    const tan = new THREE.Vector3();
    const tan2 = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    let made = 0;
    for (let i = 0; i < 220; i++) {
      const t = i / 220;
      path.getTangentAt(t, tan);
      path.getTangentAt(Math.min(0.999, t + 1 / 220), tan2);
      const curv = 1 - Math.min(1, Math.max(-1, tan.dot(tan2)));
      if (curv > 0.0008) continue; // straights only (same gate as light poles)
      if (i % 6 !== 0) continue; // one banner every ~16m along a straight
      path.getPointAt(t, p);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const side = (i / 6) % 2 === 0 ? 1 : -1;
      // AAA tick 2026-09-04 (banner-skim): halfW+2.4 punha o print de 5.6m a
      // ~1.5m da chase cam quando o kart corre junto à borda — o banner
      // preenchia 1/3 da tela (skim-pre.png determinístico, t=0.0275).
      // halfW+3.4 dá 1m de folga à câmera; o banner segue legível (5.6m).
      const bx = p.x + nrm.x * side * (halfW + 3.4);
      const bz = p.z + nrm.z * side * (halfW + 3.4);
      if (this._onTrack(bx, bz, 2)) continue; // never on the road
      const by = p.y; // anchor at path elevation (rail base line)
      for (const off of [-1, 1]) {
        // poles at the banner's WIDTH ends — along the tangent (the board
        // is only 0.08m thick laterally, so lateral poles would float)
        dummyB.position.set(bx + tan.x * off * 2.7, by + 1.5, bz + tan.z * off * 2.7);
        dummyB.rotation.set(0, 0, 0);
        dummyB.scale.set(1, 1, 1);
        dummyB.updateMatrix();
        poles.setMatrixAt(made * 2 + (off === -1 ? 0 : 1), dummyB.matrix);
      }
      // frame
      dummyB.position.set(bx, by + 2.5, bz);
      dummyB.lookAt(p.x, by + 2.5, p.z); // face the track
      // NOTE (2026-09-04): NEVER zero rotation.z after lookAt here. lookAt
      // yields pure yaw (target at same elevation), but its XYZ-euler form
      // carries x=z=PI for |yaw|>90deg; forcing z=0 then rebuilds a
      // different basis with the local X axis negated — normal still faces
      // the track, but the print reads MIRRORED. Pure yaw needs no fixup.
      dummyB.scale.set(1, 1, 1);
      dummyB.updateMatrix();
      frames.setMatrixAt(made, dummyB.matrix);
      this._contactAOs.push({ x: bx, z: bz, r: 3.0 }); // AUDIT AAA: AO do banner
      // print front (+z local 0.05, 1cm à frente do box) e espelho back (-z)
      dummyB.position.set(bx, by + 2.5, bz);
      dummyB.lookAt(p.x, by + 2.5, p.z);
      dummyB.translateZ(0.05);
      dummyB.scale.set(1, 1, 1);
      dummyB.updateMatrix();
      printsF.setMatrixAt(made, dummyB.matrix);
      dummyB.position.set(bx, by + 2.5, bz);
      dummyB.lookAt(p.x, by + 2.5, p.z);
      dummyB.translateZ(-0.05);
      // AUDIT 2026-08-25 (GPU real LXC105): a cópia de trás herdava a mesma
      // orientação → o texto lia ESPELHADO quando o banner era visto por trás.
      // Girar 180° em Y faz a face de trás mostrar o texto correto.
      dummyB.rotateY(Math.PI);
      dummyB.scale.set(1, 1, 1);
      dummyB.updateMatrix();
      printsB.setMatrixAt(made, dummyB.matrix);
      made++;
      if (made >= maxBanners) break;
    }
    frames.count = made;
    printsF.count = made;
    printsB.count = made;
    poles.count = made * 2;
    frames.instanceMatrix.needsUpdate = true;
    printsF.instanceMatrix.needsUpdate = true;
    printsB.instanceMatrix.needsUpdate = true;
    poles.instanceMatrix.needsUpdate = true;
  }

  /**
   * Racing tire stacks (3 tires, middle one painted white) along the
   * straights — the classic paddock dressing that reads instantly as
   * motorsport. Lateral halfW+2.6 (rail+1.5) so the ~1.3m stacks stay clear
   * of the chase-camera line, and every stack is _onTrack-guarded.
   */
  buildTireStacks(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const len = path.getLength();
    const halfW = CONFIG.track.roadWidth / 2;
    const tireGeo = new THREE.TorusGeometry(0.42, 0.2, 10, 18);
    // AUDIT R3 (critic 2/10: 'volumes verdes, sem furo, sem cores'):
    // MeshStandardMaterial recebia a luz AMBIENTE VERDE do gramado e tingia
    // o instanceColor (preto virava verde-oliva). MeshBasicMaterial (unlit)
    // mostra a COR PURA — pneus são decoração, unlit é aceitável e o
    // instanceColor preto-branco-preto finalmente lê.
    const tireMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const stacks = [];
    const tan = new THREE.Vector3();
    const tan2 = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    // AUDIT R5 (1 stack só): gate 0.004 AINDA descartava quase tudo na
    // Meadow (curvas suaves constantes) + _onTrack margin 2. Gate 0.01 (só
    // hairpins excluídos) + offset lateral 3.2 (longe do _onTrack) + densidade
    // len/18 → ~30+ pilhas.
    const n = Math.max(18, Math.round(len / 16));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      // AUDIT R7: gate de curvatura REMOVIDO — a Meadow é sinuosa e qualquer
      // gate (0.0008/0.004/0.01) descartava quase tudo (1-2 pilhas só).
      // Pilhas em curvas são normais em kartódromos; o offset lateral 4.5 +
      // _onTrack já garantem que não ficam na pista.
      path.getTangentAt(t, tan); // SEMPRE precisa do tan p/ normal lateral
      path.getPointAt(t, p);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const side = i % 2 === 0 ? 1 : -1;
      const tx = p.x + nrm.x * side * (halfW + 4.5);
      const tz = p.z + nrm.z * side * (halfW + 4.5);
      if (this._onTrack(tx, tz, 2)) continue; // nunca na pista (margem 4.5 cobre)
      // AUDIT R10: variação por ÍNDICE (determinística — não usa _rand p/
      // não mudar o stream): altura 2-4, yaw ±0.35, escala 0.9-1.1.
      stacks.push({ x: tx, z: tz, gy: p.y, ry: Math.atan2(tan.x, tan.z), v: i % 3, yaw: ((i * 37) % 70) / 100 - 0.35, sc: 0.9 + ((i * 13) % 21) / 100 });
      this._contactAOs.push({ x: tx, z: tz, r: 1.6 }); // AUDIT AAA: AO da pilha de pneus
    }
    if (!stacks.length) return;
    const tires = new THREE.InstancedMesh(tireGeo, tireMat, stacks.length * 4);
    const col = new THREE.Color();
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (const s of stacks) {
      // AUDIT R10 (critic 7/10: 'pilhas idênticas, parecem cópias'): altura
      // VARIA (2-4 pneus), yaw aleatório ±0.35, escala leve — não lê como
      // instância repetida.
      const count = 2 + (s.v % 3); // 2..4
      for (let k = 0; k < count; k++) {
        dummy.position.set(s.x, s.gy + 0.24 + k * 0.47, s.z); // AUDIT R9: gap 0.47 separa as camadas (critico pedia 'pneus individuais')
        dummy.rotation.set(Math.PI / 2, 0, s.ry + s.yaw); // torus laid flat + yaw aleatório
        dummy.scale.set(s.sc, 1, s.sc);
        dummy.updateMatrix();
        tires.setMatrixAt(idx, dummy.matrix);
        // middle tire painted white — classic racing stack contrast
        // AUDIT R2 (critic: 'volumes verdes, sem furo'): cores mais fortes
        // (branco quase puro / preto mais escuro) p/ vencer a luz do gramado.
        col.setHex(k === 1 ? 0xffffff : 0x14161c);
        tires.setColorAt(idx, col);
        idx++;
      }
    }
    tires.instanceMatrix.needsUpdate = true;
    if (tires.instanceColor) tires.instanceColor.needsUpdate = true;
    scene.add(tires);
  }

  /** Soft gravel verge band (FECO fix: the verge read as a flat 16-bit
   *  color strip). A ribbon slightly WIDER than the dirt shoulder (shoulder =
   *  roadW + 3.4, this = roadW + 5.4) laid 5mm above it with a low-opacity
   *  gravel texture, so asphalt -> shoulder -> grass reads as a graded gravel
   *  verge. Transparent + depthWrite off + polygonOffset blends it over the
   *  shoulder/terrain without z-fighting; the guard-rail footings (top 0.16)
   *  still poke through (0.145). */
  buildVergeGravel(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const len = path.getLength();
    const width = CONFIG.track.roadWidth + 5.4; // 2m wider than the dirt shoulder
    const geo = vergeRibbonGeometry(path, width);
    const tex = gravelTexture().clone();
    tex.needsUpdate = true;
    tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; // AUDIT PERF-R42: overlay plano — mipmaps não minificam de forma relevante
    tex.repeat.set(Math.max(20, len / 4), width / 4); // ~4m square gravel tiles
    // AUDIT PERF-R42 (2026-08-14, auditoria render #13): MeshStandardMaterial
    // transparent full-loop era shader PBR caro p/ um overlay de 38% — o look
    // vem do mapa; MeshBasicMaterial corta ~50-70% do custo de fragmento.
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.145; // 5mm above the dirt shoulder (0.14)
    mesh.renderOrder = 1;
    scene.add(mesh);
  }

  /**
   * 3D grass tufts along both verges (FECO fix: the old crossed flat quads
   * read as 16-bit billboards). Each tuft is 3-6 TAPERED-BOX blades arranged
   * in 2 crossed planes (grassTuftVariant) — a real 3D silhouette from every
   * camera angle. 4 variant geometries round-robined along the path, ~4
   * InstancedMesh draw calls for the whole loop, per-instance green tint /
   * yaw / scale. Deterministic: same _rand call count/order as before, so
   * downstream builders keep their exact placements.
   */
  buildGrassTufts(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const len = path.getLength();
    const halfW = CONFIG.track.roadWidth / 2;
    const variants = [
      grassTuftVariant(0xB1ADE1),
      grassTuftVariant(0xB1ADE2),
      grassTuftVariant(0xB1ADE3),
      grassTuftVariant(0xB1ADE4),
    ];
    // r6: keep the variant geometries for buildInfieldTufts (called LAST in
    // build(), after every other _rand consumer) so the enclosed infield
    // reuses these exact tuft shapes without touching the _rand stream.
    this._tuftVariants = variants;
    const n = Math.max(140, Math.round(len / 2.4));
    const tan = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const dummy = new THREE.Object3D();
    const spots = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      path.getPointAt(t, p);
      path.getTangentAt(t, tan);
      nrm.set(-tan.z, 0, tan.x).normalize();
      for (const side of [-1, 1]) {
        // AUDIT R74 (Feco real-GPU 2026-08-14: 'arbusto no meio da pista'):
        // off mínimo era halfW + 2.0m — em CURVAS a borda do asfalto fica
        // MAIS PERTO do que halfW (o offset lateral é na tangente do path,
        // mas a face interna da curva aproxima a borda) → o tuft (blades
        // de ~0.6m + scale 1.6) cruzava o asfalto e lia como um arbusto
        // verde no meio da pista. Novo mínimo halfW + 3.4m (bem fora da
        // borda real em qualquer curvatura) + gate _onTrack margem 3.
        const off = halfW + 3.4 + (i % 3) * 0.75 + this._rand() * 0.6;
        const tx = p.x + nrm.x * side * off;
        const tz = p.z + nrm.z * side * off;
        if (this._onTrack(tx, tz, 3)) continue;
        spots.push({ x: tx, z: tz, gy: this._gy(tx, tz), sc: 0.8 + this._rand() * 0.8, v: (i + (side === 1 ? 1 : 0)) % variants.length, c: (i + (side === 1 ? 1 : 0)) % 3 });
      }
    }
    if (!spots.length) return;
    const baseMat = toonMaterial(0xffffff, {});
    // PREMIUM PASS: grama VIVA — sway nos tips por instância (base plantada).
    applyWindSway(baseMat, { strength: 0.10, speed: 1.6 });
    const col = new THREE.Color();
    const PAL = [0x3faf4e, 0x4cc25e, 0x379c45];
    for (let vi = 0; vi < variants.length; vi++) {
      const list = spots.filter((s) => s.v === vi);
      if (!list.length) continue;
      const grass = new THREE.InstancedMesh(variants[vi], baseMat, list.length);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        dummy.position.set(s.x, s.gy, s.z);
        dummy.rotation.set(0, this._rand() * Math.PI, 0);
        dummy.scale.set(s.sc, s.sc * (0.9 + this._rand() * 0.35), s.sc);
        dummy.updateMatrix();
        grass.setMatrixAt(i, dummy.matrix);
        col.setHex(PAL[s.c]);
        grass.setColorAt(i, col);
      }
      grass.instanceMatrix.needsUpdate = true;
      if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
      scene.add(grass);
    }
  }

  /**
   * AUDIT R12 (densidade meadow — crítico cego 6/10 'grama esparsa,
   * low-poly'): buildGrassTufts cobre só a beira (halfW+3.4..5.5m, 1 tuft
   * a cada 2.4m) e a faixa 6-25m lia COBERTURA ZERO (textura repetida +
   * bushes esparsos a 25m+). Escova 4.5-22m dos DOIS lados: ~1 tuft por
   * 1.6m de pista + ~16% de patches de GRAMA ALTA/secada (escala 1.6-2.3x,
   * tons quentes) — variação de prado MK8. Reusa os 4 variants
   * (this._tuftVariants): 4-6 draw calls. rnd() LOCAL por spot — NÃO
   * consome this._rand(), então os builders a jusante mantêm o layout.
   */
  buildMeadowGrassField(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const len = path.getLength();
    const halfW = CONFIG.track.roadWidth / 2;
    const variants = this._tuftVariants || [
      grassTuftVariant(0xB1ADE1),
      grassTuftVariant(0xB1ADE2),
      grassTuftVariant(0xB1ADE3),
      grassTuftVariant(0xB1ADE4),
    ];
    const baseMat = toonMaterial(0xffffff, {});
    const tan = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const PAL = [0x3faf4e, 0x4cc25e, 0x379c45, 0x9aae4a, 0x7a9c3f]; // + capim alto seco
    const n = Math.max(160, Math.round(len / 1.6)); // ~1 tuft a cada 1.6m
    const spots = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (t < 0.025 || t > 0.975) continue;
      path.getPointAt(t, p);
      path.getTangentAt(t, tan);
      nrm.set(-tan.z, 0, tan.x).normalize();
      for (const side of [-1, 1]) {
        const j = (i * 2 + (side === 1 ? 1 : 0)) * 7919;
        const r1 = (Math.sin(j) * 43758.5453) % 1;
        const r2 = (Math.sin(j + 13) * 43758.5453) % 1;
        const r3 = (Math.sin(j + 29) * 43758.5453) % 1;
        // R26-FIX: % keeps the sign, so r2/r3 land in (-1,1); only r1 was
        // normalized below. Raw r2<0 counted as tall (r2<0.16) → ~56% dry
        // tall tufts instead of the designed ~16%, and raw r3 biased the
        // tangent jitter. Normalize r2/r3 exactly like r1.
        const r1n = r1 < 0 ? r1 + 1 : r1;
        const r2n = r2 < 0 ? r2 + 1 : r2;
        const r3n = r3 < 0 ? r3 + 1 : r3;
        const off = halfW + 4.5 + r1n * 17.5; // 4.5..22m
        const tall = r2n < 0.16; // ~16% grama alta seca
        const fx = p.x + nrm.x * off * side + tan.x * (r3n - 0.5) * 0.8;
        const fz = p.z + nrm.z * off * side + tan.z * (r3n - 0.5) * 0.8;
        const gy = this._gy(fx, fz);
        const sc = tall ? 1.6 + r2n * 0.7 : 0.8 + r1n * 0.6;
        spots.push({ x: fx, z: fz, gy, sc, v: (i + side) % variants.length, c: tall ? 3 + ((i % 2)) : (i % 3) });
      }
    }
    for (let vi = 0; vi < variants.length; vi++) {
      const list = spots.filter((s) => s.v === vi);
      if (!list.length) continue;
      const grass = new THREE.InstancedMesh(variants[vi], baseMat, list.length);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        dummy.position.set(s.x, s.gy, s.z);
        dummy.rotation.set(0, s.x * 13.37, 0);
        dummy.scale.set(s.sc, s.sc * 1.1, s.sc);
        dummy.updateMatrix();
        grass.setMatrixAt(i, dummy.matrix);
        col.setHex(PAL[s.c]);
        grass.setColorAt(i, col);
      }
      grass.instanceMatrix.needsUpdate = true;
      if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
      scene.add(grass);
    }
  }

  /**
   * r6 (FECO): 3D grass tufts INSIDE the enclosed infield — the infield
   * grass was flat-texture-only and read as a 16-bit green pancake from
   * above. Reuses the same tuft variant geometries as buildGrassTufts
   * (this._tuftVariants) and scatters ~120 tufts deep inside the loop
   * (>=12m from the centerline, so nothing clips the guard rail), grounded
   * on _gy and deterministic via this._rand(). Called LAST in build() —
   * it consumes _rand only after every other builder, so all existing
   * placements stay bit-identical.
   */
  buildInfieldTufts(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    // Same 4 variant geometries as the verges (built here as a fallback if
    // buildGrassTufts never ran — e.g. defensive ordering).
    const variants = this._tuftVariants || [
      grassTuftVariant(0xB1ADE1),
      grassTuftVariant(0xB1ADE2),
      grassTuftVariant(0xB1ADE3),
      grassTuftVariant(0xB1ADE4),
    ];
    // High-res closed polyline of the centerline: inside-loop ray cast +
    // exact road clearance (point-to-segment) — mirrors buildInfield.
    const LOOP_N = 240;
    const loop = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < LOOP_N; i++) {
      const q = path.getPointAt(i / LOOP_N);
      loop.push(q.x, q.z);
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.z < minZ) minZ = q.z;
      if (q.z > maxZ) maxZ = q.z;
    }
    const inLoop = (x, z) => {
      let inside = false;
      for (let i = 0, j = loop.length - 2; i < loop.length; j = i, i += 2) {
        const xi = loop[i], zi = loop[i + 1];
        const xj = loop[j], zj = loop[j + 1];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    };
    const distToLoop = (x, z) => {
      let best = Infinity;
      for (let i = 0; i < loop.length; i += 2) {
        const j = (i + 2) % loop.length;
        const ax = loop[i], az = loop[i + 1];
        const bx = loop[j], bz = loop[j + 1];
        const abx = bx - ax, abz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz)));
        const dx = ax + abx * t - x;
        const dz = az + abz * t - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      return Math.sqrt(best);
    };
    const ROAD_CLEAR = 12; // >=12m from centerline (guard rail sits at halfW+1.1)
    const TARGET = 120;
    const spots = [];
    let guard = 0;
    while (spots.length < TARGET && guard < 2000) {
      guard++;
      const x = minX + this._rand() * (maxX - minX);
      const z = minZ + this._rand() * (maxZ - minZ);
      if (!inLoop(x, z)) continue;
      if (distToLoop(x, z) < ROAD_CLEAR) continue;
      if (inWater(x, z, 4)) continue;
      spots.push({
        x, z,
        gy: this._gy(x, z),
        sc: 0.7 + this._rand() * 0.9,
        v: (this._rand() * variants.length) | 0,
        c: (this._rand() * 3) | 0,
      });
    }
    if (!spots.length) return;
    const baseMat = toonMaterial(0xffffff, {});
    // PREMIUM PASS: meadow grass também respira (mesmo shader de sway).
    applyWindSway(baseMat, { strength: 0.12, speed: 1.4 });
    const col = new THREE.Color();
    const PAL = [0x3faf4e, 0x4cc25e, 0x379c45]; // same green tints as the verges
    const dummy = new THREE.Object3D();
    for (let vi = 0; vi < variants.length; vi++) {
      const list = spots.filter((s) => s.v === vi);
      if (!list.length) continue;
      const grass = new THREE.InstancedMesh(variants[vi], baseMat, list.length);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        dummy.position.set(s.x, s.gy, s.z);
        dummy.rotation.set(0, this._rand() * Math.PI, 0);
        dummy.scale.set(s.sc, s.sc * (0.9 + this._rand() * 0.35), s.sc);
        dummy.updateMatrix();
        grass.setMatrixAt(i, dummy.matrix);
        col.setHex(PAL[s.c]);
        grass.setColorAt(i, col);
      }
      grass.instanceMatrix.needsUpdate = true;
      if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
      scene.add(grass);
    }
  }

  /**
   * Contact shadows (fake-AO) para a mobília engineered (postes, banners,
   * pneus, feno, placas) — AUDIT AAA 2026-08-15: árvores/arbustos tinham AO
   * discs, a mobília não. Um InstancedMesh compartilhado; spots coletados
   * pelos builders via this._contactAOs. Não consome _rand (seguro após
   * buildInfieldTufts). Na Neon City a lista fica vazia -> skip.
   */
  buildContactShadows(scene) {
    const list = this._contactAOs || [];
    if (!list.length) return;
    const { geo, mat } = getAODiscParts();
    const discs = new THREE.InstancedMesh(geo, mat, list.length);
    const dummy = new THREE.Object3D();
    list.forEach((d, i) => {
      dummy.position.set(d.x, this._gy(d.x, d.z) + 0.04, d.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(d.r, d.r, 1);
      dummy.updateMatrix();
      discs.setMatrixAt(i, dummy.matrix);
    });
    discs.instanceMatrix.needsUpdate = true;
    scene.add(discs);
  }

  /** Hay bales (racing venue cue) laid flat along the straights. */
  buildHayBales(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const len = path.getLength();
    const halfW = CONFIG.track.roadWidth / 2;
    const hayGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.1, 14);
    const hayMat = toonMaterial(0xffffff, {});
    const n = Math.max(10, Math.round(len / 55));
    const tan = new THREE.Vector3();
    const tan2 = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const dummy = new THREE.Object3D();
    const spots = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      path.getTangentAt(t, tan);
      path.getTangentAt(Math.min(0.999, t + 1 / n), tan2);
      if (1 - Math.min(1, Math.max(-1, tan.dot(tan2))) > 0.0008) continue; // straights
      path.getPointAt(t, p);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const side = i % 2 === 0 ? 1 : -1;
      const tx = p.x + nrm.x * side * (halfW + 3.4);
      const tz = p.z + nrm.z * side * (halfW + 3.4);
      if (this._onTrack(tx, tz, 2)) continue;
      spots.push({ x: tx, z: tz, gy: this._gy(tx, tz), ry: Math.atan2(tan.x, tan.z) });
      this._contactAOs.push({ x: tx, z: tz, r: 1.2 }); // AUDIT AAA: AO do feno
    }
    if (!spots.length) return;
    const hay = new THREE.InstancedMesh(hayGeo, hayMat, spots.length);
    const col = new THREE.Color();
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      dummy.position.set(s.x, s.gy + 0.42, s.z);
      dummy.rotation.set(Math.PI / 2, 0, s.ry); // laid flat along the track
      dummy.scale.set(1, 1, 0.85 + this._rand() * 0.3);
      dummy.updateMatrix();
      hay.setMatrixAt(i, dummy.matrix);
      col.setHex(this._rand() > 0.5 ? 0xe0b84e : 0xd3a93f);
      hay.setColorAt(i, col);
    }
    hay.instanceMatrix.needsUpdate = true;
    if (hay.instanceColor) hay.instanceColor.needsUpdate = true;
    scene.add(hay);
  }

  /** Sponsor boards on 3D frames with posts along the straights (AAA density). */
  buildSponsorBoards(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const len = path.getLength();
    const halfW = CONFIG.track.roadWidth / 2;
    // AUDIT PERF-R48 (2026-08-14, auditoria render #6): 7 placas × 4 meshes
    // em Groups (parent uuid único → autoInstancing não cruza) = ~28 calls.
    // Agora 3 InstancedMesh (panel/back/post) — ~3 calls.
    const panelTex = this._sponsorBoardTexture();
    const panelMat = toonMaterial(0xffffff, { map: panelTex, roughness: 0.4, envMapIntensity: 1.0 }); // glossy plastic board
    const frameMat = toonMaterial(0x2b3242, {});
    const postMat = toonMaterial(0x8b7a5c, {});
    const panelGeo = new THREE.BoxGeometry(2.6, 1.3, 0.07);
    const backGeo = new THREE.BoxGeometry(2.72, 1.42, 0.05);
    const postGeo = new THREE.CylinderGeometry(0.06, 0.09, 2.3, 8);
    const n = 7;
    const dummyS = new THREE.Object3D();
    const panels = new THREE.InstancedMesh(panelGeo, panelMat, n);
    const backs = new THREE.InstancedMesh(backGeo, frameMat, n);
    const posts = new THREE.InstancedMesh(postGeo, postMat, n * 2);
    [panels, backs, posts].forEach((m) => { m.name = 'sponsor-instanced'; });
    scene.add(panels, backs, posts);
    let made = 0;
    const tan = new THREE.Vector3();
    const tan2 = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) / n + 0.08) % 1;
      path.getTangentAt(t, tan);
      path.getTangentAt(Math.min(0.999, t + 1 / n), tan2);
      if (1 - Math.min(1, Math.max(-1, tan.dot(tan2))) > 0.0008) continue; // straights
      path.getPointAt(t, p);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const side = i % 2 === 0 ? 1 : -1;
      const tx = p.x + nrm.x * side * (halfW + 3.6);
      const tz = p.z + nrm.z * side * (halfW + 3.6);
      if (this._onTrack(tx, tz, 2)) continue;
      const gy = this._gy(tx, tz);
      const yaw = Math.atan2(tan.x, tan.z) + Math.PI / 2; // face the road
      dummyS.position.set(tx, gy + 1.7, tz);
      dummyS.rotation.set(0, yaw, 0);
      dummyS.scale.set(1, 1, 1);
      dummyS.updateMatrix();
      panels.setMatrixAt(made, dummyS.matrix);
      backs.setMatrixAt(made, dummyS.matrix);
      this._contactAOs.push({ x: tx, z: tz, r: 2.0 }); // AUDIT AAA: AO do sponsor board
      for (const s of [-1, 1]) {
        dummyS.position.set(tx + Math.cos(yaw) * s * 1.2, gy + 1.15, tz - Math.sin(yaw) * s * 1.2);
        dummyS.rotation.set(0, yaw, 0);
        dummyS.scale.set(1, 1, 1);
        dummyS.updateMatrix();
        posts.setMatrixAt(made * 2 + (s === -1 ? 0 : 1), dummyS.matrix);
      }
      made++;
    }
    panels.count = made;
    backs.count = made;
    posts.count = made * 2;
    panels.instanceMatrix.needsUpdate = true;
    backs.instanceMatrix.needsUpdate = true;
    posts.instanceMatrix.needsUpdate = true;
  }

  /** Corner marshal flags on poles at the sharpest apexes (racing cue). */
  buildCornerFlags(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const len = path.getLength();
    const halfW = CONFIG.track.roadWidth / 2;
    const flagTex = this._cornerFlagTexture();
    const flagMat = toonMaterial(0xffffff, { map: flagTex, side: THREE.DoubleSide });
    const poleMat = toonMaterial(0x3a4152, {});
    const n = Math.max(24, Math.round(len / 16));
    const tan = new THREE.Vector3();
    const tan2 = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      path.getTangentAt(t, tan);
      path.getTangentAt(Math.min(0.999, t + 1 / n), tan2);
      const curv = 1 - Math.min(1, Math.max(-1, tan.dot(tan2)));
      if (curv < 0.0016) continue; // corners only
      path.getPointAt(t, p);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const side = i % 2 === 0 ? 1 : -1;
      const tx = p.x + nrm.x * side * (halfW + 2.4);
      const tz = p.z + nrm.z * side * (halfW + 2.4);
      if (this._onTrack(tx, tz, 2)) continue;
      const grp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.0, 8), poleMat);
      pole.position.y = 1.0;
      grp.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.55), flagMat);
      flag.position.set(0, 1.75, 0.12);
      grp.add(flag);
      grp.position.set(tx, this._gy(tx, tz), tz);
      grp.rotation.y = Math.atan2(tan.x, tan.z) + Math.PI / 2;
      scene.add(grp);
      this._contactAOs.push({ x: tx, z: tz, r: 1.0 }); // AUDIT AAA: AO da bandeira de canto
      placed++;
      if (placed >= 8) break; // a few well-placed flags, not a forest
    }
  }

  /** Procedural sponsor panel: brand-color block + fake wordmark + logo disc. */
  _sponsorBoardTexture() {
    if (this._sponsorTex) return this._sponsorTex;
    const c = document.createElement('canvas');
    // SK3D FIX (2026-08-20): 256×128 → 512×256 (2:1, mesma proporção do
    // panelGeo Box 2.6×1.3) — resolução maior evita borrão do logo à distância.
    c.width = 512;
    c.height = 256;
    const g = c.getContext('2d');
    // SK3D FIX (2026-08-20, Feco real-GPU): remover vermelho puro da paleta
    // — lia como "faixa vermelha esticada nas laterais". Azul/cinza/verde
    // sóbrios mantêm identidade sem confundir com kerb.
    const COLORS = ['#2ec4ff', '#3fa44e', '#ffd166', '#6c8cff', '#c86bff', '#ff9f45'];
    const col = COLORS[Math.floor(this._rand() * COLORS.length)];
    g.fillStyle = col;
    g.fillRect(0, 0, 512, 256);
    // AUDIT r5: wordmark menor/suave + banda escura sutil (não checker).
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 192, 512, 64);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = '800 52px "Baloo 2", "Nunito", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SK GP', 256, 96);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = '700 28px "Baloo 2", "Nunito", Arial, sans-serif';
    g.fillText('SUPER KART', 256, 224);
    // SK3D FIX: símbolo de velocidade (raio/estrela) CLARO e central,
    // sem orbe que pareça olho. 3 raios brancos saindo de um ponto.
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 5;
    const cx = 256, cy = 160;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26);
      g.stroke();
    }
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(cx, cy, 7, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._sponsorTex = tex;
    return tex;
  }

  /** Corner flag texture: red field with a white diagonal cross. */
  _cornerFlagTexture() {
    if (this._flagTex) return this._flagTex;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#e63946';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(128, 128);
    g.moveTo(128, 0);
    g.lineTo(0, 128);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._flagTex = tex;
    return tex;
  }

  /**
   * Dense, ORGANIZED roadside dressing (vision audit: flowers/bushes too
   * sparse near the track): wildflower patches every ~12m along BOTH road
   * edges just outside the guard-rail, plus 8-10 rock groups alternating
   * sides. Everything is sampled from the real track path (like
   * buildRoadsideCrowd) so it follows every curve, anchors at the path
   * elevation like the rail/crowd/poles, and stays under 0.8m tall so the
   * chase-camera line is never blocked. Offsets clear the guard rail
   * (rail sits at roadW/2 + 1.1) — nothing spawns on the road or inside it.
   */
  buildRoadsideFlowersAndRocks(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const len = path.getLength();
    const halfW = CONFIG.track.roadWidth / 2;
    const RAIL = halfW + 1.1; // guard-rail lateral offset (TrackBuilder)
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const dummy = new THREE.Object3D();

    // Same prop geometry/style as buildProps wildflowers & rocks.
    const flowerGeo = new THREE.SphereGeometry(0.16, 8, 6);
    const stemGeo = new THREE.CylinderGeometry(0.025, 0.045, 0.55, 6);
    const flowerMat = toonMaterial(0xffffff, {});
    const stemMat = toonMaterial(0x2f8f43, {});
    const flowerColors = [0xff5a5f, 0xffd166, 0x2ec4ff, 0xc86bff, 0xffffff, 0xff9f45];
    const rockGeo = new THREE.DodecahedronGeometry(0.7, 1);
    const rockMat = toonMaterial(0xa9a9b8, {});

    // t-ranges where the painted crowd stands (buildRoadsideCrowd) — flower
    // patches skip those slots so nothing spawns inside a spectator.
    const crowdSegs = [
      [0.945, 0.055], [0.10, 0.15], [0.19, 0.25],
      [0.30, 0.37], [0.45, 0.56], [0.62, 0.68],
    ];
    const inCrowd = (t) => {
      for (const [a, b] of crowdSegs) {
        if (a <= b) { if (t >= a && t <= b) return true; }
        else if (t >= a || t <= b) return true; // wraps past 1.0
      }
      return false;
    };

    // --- flower patches: one every ~12m, BOTH sides, 1.2-2.0m off the rail.
    const flowerSpots = [];
    const n = Math.floor(len / 9); // AUDIT R12: 12m → 9m (flores densas)
    for (let i = 0; i < n; i++) {
      const rand = rnd(33000 + i);
      const t = (((i / n + (rand() - 0.5) * (2.5 / len)) % 1) + 1) % 1; // ±1.25m along path
      if (inCrowd(t)) continue;
      path.getPointAt(t, p);
      path.getTangentAt(t, tan);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const gy = p.y; // anchor at path elevation (rail base line)
      for (const side of [1, -1]) {
        const off = RAIL + 1.2 + rand() * 0.8; // 6.8-7.6m from centerline
        const cx = p.x + nrm.x * side * off + (rand() - 0.5) * 1.2;
        const cz = p.z + nrm.z * side * off + (rand() - 0.5) * 1.2;
        if (inWater(cx, cz, 4)) continue;
        // AUDIT R12: 2 → 2-3 sub-clusters; 3-5 → 4-7 flores por cluster
        for (let c = 0; c < 2 + ((rand() * 2) | 0); c++) {
          const r2 = rnd(33000 + i * 10 + c * 5 + (side === 1 ? 1 : 0));
          const per = 4 + ((r2() * 4) | 0);
          const scx = cx + (r2() - 0.5) * 1.1;
          const scz = cz + (r2() - 0.5) * 1.1;
          for (let k = 0; k < per; k++) {
            const r3 = rnd(33000 + i * 10 + c * 5 + k * 3 + (side === 1 ? 2 : 0));
            flowerSpots.push({
              x: scx + (r3() - 0.5) * 0.7,
              z: scz + (r3() - 0.5) * 0.7,
              gy,
              s: 0.85 + r3() * 0.3, // head ≤ 0.67m — under the camera line
              ry: r3() * Math.PI,
              color: flowerColors[(r3() * flowerColors.length) | 0],
            });
          }
        }
      }
    }
    if (flowerSpots.length) {
      const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerSpots.length);
      const stems = new THREE.InstancedMesh(stemGeo, stemMat, flowerSpots.length);
      flowerSpots.forEach((f, i) => {
        dummy.position.set(f.x, f.gy + 0.3 * f.s, f.z);
        dummy.scale.set(f.s, f.s, f.s);
        dummy.rotation.set(0, f.ry, 0);
        dummy.updateMatrix();
        stems.setMatrixAt(i, dummy.matrix);
        dummy.position.set(f.x, f.gy + 0.58 * f.s, f.z);
        dummy.scale.setScalar(f.s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        flowers.setMatrixAt(i, dummy.matrix);
        flowers.setColorAt(i, new THREE.Color(f.color));
      });
      flowers.instanceMatrix.needsUpdate = true;
      if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
      stems.instanceMatrix.needsUpdate = true;
      scene.add(flowers, stems);
    }

    // --- rock groups: 8-10 groups, alternating sides, 3-5m off the rail.
    const rockSpots = [];
    const groups = Math.min(10, Math.max(8, Math.round(len / 25)));
    for (let g = 0; g < groups; g++) {
      const rand = rnd(34000 + g);
      const t = (((g / groups + (rand() - 0.5) * (1.5 / len)) % 1) + 1) % 1; // ±0.75m along path
      const side = g % 2 === 0 ? 1 : -1;
      path.getPointAt(t, p);
      path.getTangentAt(t, tan);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const off = RAIL + 3 + rand() * 2; // 8.6-10.6m from centerline
      const gx = p.x + nrm.x * side * off + (rand() - 0.5) * 1.0;
      const gz = p.z + nrm.z * side * off + (rand() - 0.5) * 1.0;
      if (inWater(gx, gz, 4)) continue;
      const gy = p.y;
      const per = 2 + ((rand() * 2) | 0); // 2-3 rocks per group
      for (let k = 0; k < per; k++) {
        const r2 = rnd(34000 + g * 7 + k);
        rockSpots.push({
          x: gx + (r2() - 0.5) * 2.0,
          z: gz + (r2() - 0.5) * 2.0,
          gy,
          s: 0.42 + r2() * 0.16, // squat → top ≤ 0.55m — under the camera line
          ry: r2() * Math.PI,
          rx: (r2() - 0.5) * 0.3,
          rz: (r2() - 0.5) * 0.3,
        });
      }
    }
    if (rockSpots.length) {
      const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
      rockSpots.forEach((r, i) => {
        dummy.position.set(r.x, r.gy + 0.42 * r.s, r.z);
        dummy.scale.set(r.s, r.s * 0.72, r.s); // low profile near the rail
        dummy.rotation.set(r.rx, r.ry, r.rz);
        dummy.updateMatrix();
        rocks.setMatrixAt(i, dummy.matrix);
      });
      rocks.instanceMatrix.needsUpdate = true;
      scene.add(rocks);
    }
  }

  buildBalloons(scene) {
    // Hot-air balloons drifting high above — instant cartoon charm.
    // Dense 16x14 envelope + 24-seg stripe ring, and an ORGANIZED skyline:
    // balloons fly a diagonal corridor at even spacing with a consistent
    // altitude step — a planned parade, not random dots in the sky.
    this.balloons = [];
    const colors = [0xff5a5f, 0xffd166, 0x6cff8f, 0xc86bff];
    for (let i = 0; i < 6; i++) {
      const rand = rnd(300 + i);
      const g = new THREE.Group();
      const bal = new THREE.Mesh(
        new THREE.SphereGeometry(2.8, 16, 14),
        toonMaterial(colors[i % colors.length], {})
      );
      bal.scale.set(1, 1.15, 1);
      bal.position.y = 2.6;
      g.add(bal);
      // Vertical contrasting stripe + side panels — the classic balloon
      // silhouette (reads as "hot-air balloon", not a floating sphere).
      const stripe = new THREE.Mesh(
        new THREE.TorusGeometry(2.5, 0.35, 10, 24),
        toonMaterial(0xf4f6f8, {})
      );
      stripe.scale.set(1, 1.18, 1);
      stripe.position.y = 2.7;
      g.add(stripe);
      const basket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.9, 1.1, 12),
        toonMaterial(0xb07a4f, {})
      );
      basket.position.y = 0;
      g.add(basket);
      const rope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6),
        toonMaterial(0x8b7a5c, {})
      );
      rope.position.y = 1.4;
      g.add(rope);
      g.position.set(
        -180 + i * 72 + (rand() - 0.5) * 14,
        44 + i * 8 + (rand() - 0.5) * 6,
        -130 + i * 52 + (rand() - 0.5) * 14
      );
      g.userData = { baseY: g.position.y, speed: 0.05 + i * 0.012, phase: i * 1.57 };
      scene.add(g);
      this.balloons.push(g);
    }
  }

  /**
   * REMOVED buildCrowd: the old "colorful standing blocks" read as loose
   * placeholder cubes on the grass. Real spectators now come from
   * buildGrandstand (body+head figures) and buildRoadsideCrowd (start
   * straight line). Keeping the empty method is a trap — delete it entirely.
   */

  buildGrandstand(scene) {
    // Big grandstand with striped awning near a curve — crowd anchor.
    const grandstandSpots = [
      { x: -50, z: -14, ry: 1.5 },  // beside the start straight, IN FRONT of the grid camera
      { x: -10, z: -72, ry: -0.3 },
      { x: 56, z: 50, ry: 2.2 },
    ];
    // AUDIT (agent: palette was flat/loud neon): cloth-toned shirts in
    // saturated-but-wearable colors — red, orange, green, blue, purple, pink,
    // white, steel, navy — reads as a dressed crowd, not candy blobs.
    const crowdColors = [0xe74c4c, 0xf4a93e, 0x5cb85c, 0x4a90d9, 0x9b6fd4, 0xe8789a, 0xf5f5f5, 0x7b8a9e, 0x34495e];
    // Painted sponsor fascia (SUPER KART text) — cached once, shared by all
    // stands. MeshBasicMaterial keeps it readable at race distance.
    if (!this._fasciaTex) {
      // AUDIT FIX 2026-08-16 (Feco real-GPU: 'as placas na lateral estão com
      // a imagem esticada'): textura 512×96 (ratio 5.3:1) aplicada no mesh
      // 20×2.2m (ratio 9.1:1) esticava o texto ~1.7× horizontal. Canvas
      // agora 1024×112 ≈ 9.1:1 — o texto mantém a proporção real no mesh.
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 112;
      const g = c.getContext('2d');
      g.fillStyle = '#e2504f';
      g.fillRect(0, 0, 1024, 112);
      g.fillStyle = '#ffd166';
      g.fillRect(0, 0, 1024, 10);
      g.fillRect(0, 102, 1024, 10);
      g.fillStyle = '#ffffff';
      g.font = '900 52px "Baloo 2", "Nunito", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('SUPER KART 3D.js', 512, 56);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this._fasciaTex = tex;
    }
    const fasciaMat = new THREE.MeshBasicMaterial({ map: this._fasciaTex });
    for (const gs of grandstandSpots) {
      // USER BUG FIX (grandstand on the road): only the CENTER was checked
      // against the track — a 16m-wide stand whose center sat ~9m off the
      // centerline passed the test while one corner still crossed the
      // asphalt. Check all four corners (rotated by ry) with a margin.
      // AUDIT R3 (grandstands NUNCA criados!): corners ±8m + margin 4 (raio
      // 8.5m) descartavam TODOS os 3 spots — o corner interno caía dentro do
      // raio do centerline. Corners reduzidos p/ ±3.5m + margin 2: checa que
      // o NÚCLEO do grandstand está fora da pista (o awning pode avançar).
      const cos = Math.cos(gs.ry);
      const sin = Math.sin(gs.ry);
      let cornerOnTrack = false;
      for (const [lx, lz] of [[3.5, 1.5], [-3.5, 1.5], [3.5, -1.5], [-3.5, -1.5]]) {
        const wx = gs.x + lx * cos - lz * sin;
        const wz = gs.z + lx * sin + lz * cos;
        if (this._onTrack(wx, wz, 2)) { cornerOnTrack = true; break; }
      }
      if (cornerOnTrack) continue; // grandstand off the road (tight margin)
      const grp = new THREE.Group();
      // steps (3 tiers) — red / white / blue stadium rows via per-instance
      // color so the stand reads as SEATING, not grey boxes.
      // AUDIT R10 (critic 6/10 'tiers sutis'): 0.8→1.0 altura, gap 1.1→1.3
      // AUDIT R21 (critic W1 5/10 'tiers sutis, plateia espaçada'):
      // 1.0→1.3 altura + gap 1.3→1.6 (degrau REAL entre fileiras, lê como
      // arquibancada) — e profundidade 2.4→2.0 (fileiras mais próximas).
      // AUDIT R24 (critic W2b mobile 5/10 'gramado vazio entre fileiras'):
      // gap vertical tiers 1.3→1.1 + spacing lateral 0.49→0.42 — compacta a
      // plateia (sem vãos verdes), mantém degrau legível.
      const tier = new THREE.InstancedMesh(new THREE.BoxGeometry(16, 1.3, 2.0), toonMaterial(0xffffff, {}), 3);
      const tierCols = [0xe2504f, 0xf4f6f8, 0x2e9be8];
      const dummy = new THREE.Object3D();
      const col = new THREE.Color();
      for (let i = 0; i < 3; i++) {
        dummy.position.set(0, 1.3 + i * 1.1, -i * 2.0);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        tier.setMatrixAt(i, dummy.matrix);
        tier.setColorAt(i, col.setHex(tierCols[i]));
      }
      tier.instanceMatrix.needsUpdate = true;
      if (tier.instanceColor) tier.instanceColor.needsUpdate = true;
      grp.add(tier);
      // spectators on each tier: body block (bright color) + white head ball.
      // AUDIT R10 (critic 6/10: 'densidade, variedade de poses, tiers'):
      // 45→72 (24 x 3), poses variadas (2 braços / 1 braço / 0 braços),
      // tiers +0.35m mais altos p/ arquibancada legível, bandeirinhas.
      // AUDIT R11 (critic 6/10 'plateia espaçada'): 24→30 por tier (90),
      // spacing 0.72→0.58 — arquibancada LOTADA, sem gaps.
      // AUDIT R24 (critic W2b mobile 5/10): 40→48 por tier (144 espectadores).
      const N = 144;
      const spec = new THREE.InstancedMesh(new THREE.BoxGeometry(1.05, 1.2, 1.0), toonMaterial(0xffffff, {}), N);
      const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 12, 8), toonMaterial(0xf4f6f8, {}), N);
      // Raised arms (cheering people, not blocks with heads).
      const armGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.55, 8);
      const armsL = new THREE.InstancedMesh(armGeo, toonMaterial(0xffd9b3, {}), N);
      const armsR = new THREE.InstancedMesh(armGeo, toonMaterial(0xffd9b3, {}), N);
      // Flags: tiny colored pennant on a pole for ~1 in 6 fans (variety cue).
      const flagGeo = new THREE.ConeGeometry(0.45, 0.9, 3);
      const flags = new THREE.InstancedMesh(flagGeo, toonMaterial(0xf5f5f5, {}), N);
      let sIdx = 0;
      const baseY = new Array(N);
      const headDummy = new THREE.Object3D();
      const armDummy = new THREE.Object3D();
      const legDummy = new THREE.Object3D();
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 48; j++) {
          // AUDIT FIX 2026-08-16 (Feco real-GPU: 'plateia empilhada sem
          // definição'): os espectadores iam de x=-10.1 a +9.64 (20.16m)
          // num degrau de 16m (BoxGeometry 16) — as bordas transbordavam
          // ~2m de cada lado e empilhavam fora do assento. Distribuição
          // corrigida para ±7.6m (48 × 0.42 = 20.16 → 48 × 0.316 ≈ 15.2m).
          dummy.position.set(-7.6 + j * 0.316, 1.9 + i * 1.1, -i * 2.0 + 0.3);
          dummy.scale.set(1, 1, 1); // AUDIT FIX 2026-08-16: sem sy (0.9-1.3 esticava o corpo)
          dummy.rotation.set(0, 0, 0);
          baseY[sIdx] = dummy.position.y;
          dummy.updateMatrix();
          spec.setMatrixAt(sIdx, dummy.matrix);
          col.setHex(crowdColors[Math.floor(this._rand() * crowdColors.length)]);
          spec.setColorAt(sIdx, col);
          headDummy.position.set(dummy.position.x, dummy.position.y + 0.95, dummy.position.z);
          headDummy.scale.set(1, 1, 1);
          headDummy.rotation.set(0, 0, 0);
          headDummy.updateMatrix();
          heads.setMatrixAt(sIdx, headDummy.matrix);
          // Arms raised outward (cheering silhouette) — angled UP so they read
          // as limbs with a shoulder, not straight rods poking sideways.
          // AUDIT R10: poses VARIADAS — 55% dois braços, 30% um braço,
          // 15% braços abaixados (não lê como robôs em sincronia).
          const pose = this._rand();
          if (pose < 0.85) {
            armDummy.position.set(dummy.position.x - 0.4, dummy.position.y + 0.7, dummy.position.z);
            armDummy.rotation.set(0, 0, -1.25);
            armDummy.updateMatrix();
            armsL.setMatrixAt(sIdx, armDummy.matrix);
          } else {
            // braço abaixado (descansando)
            armDummy.position.set(dummy.position.x - 0.4, dummy.position.y + 0.35, dummy.position.z);
            armDummy.rotation.set(0, 0, -0.35);
            armDummy.updateMatrix();
            armsL.setMatrixAt(sIdx, armDummy.matrix);
          }
          if (pose < 0.55) {
            armDummy.position.set(dummy.position.x + 0.4, dummy.position.y + 0.7, dummy.position.z);
            armDummy.rotation.set(0, 0, 1.25);
            armDummy.updateMatrix();
            armsR.setMatrixAt(sIdx, armDummy.matrix);
          } else {
            armDummy.position.set(dummy.position.x + 0.4, dummy.position.y + 0.35, dummy.position.z);
            armDummy.rotation.set(0, 0, 0.35);
            armDummy.updateMatrix();
            armsR.setMatrixAt(sIdx, armDummy.matrix);
          }
          // Bandeirinha: ~1 em 6 fãs agita um pennant colorido (variedade).
          if (sIdx % 6 === 0) {
            const fD = new THREE.Object3D();
            fD.position.set(dummy.position.x + 0.55, dummy.position.y + 0.8, dummy.position.z);
            fD.rotation.set(0, 0, -0.5);
            fD.updateMatrix();
            flags.setMatrixAt(sIdx, fD.matrix);
            const fc = new THREE.Color();
            fc.setHex(crowdColors[(sIdx / 6 | 0) % crowdColors.length]);
            flags.setColorAt(sIdx, fc);
          }
          sIdx++;
        }
      }
      spec.instanceMatrix.needsUpdate = true;
      if (spec.instanceColor) spec.instanceColor.needsUpdate = true;
      spec.userData.baseY = baseY;
      armsL.instanceMatrix.needsUpdate = true;
      armsR.instanceMatrix.needsUpdate = true;
      flags.instanceMatrix.needsUpdate = true;
      if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
      grp.add(spec, heads, armsL, armsR, flags);
      (this.crowdMeshes = this.crowdMeshes || []).push(spec);
      // painted front fascia — sponsor wall in front of the first tier
      // AUDIT R2 (critic 5/10: 'SUPER KART não visível'): fascia MAIOR
      // (20x2.2m) e MAIS ALTA (1.6m) — ficava atrás do awning e ilegível.
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(20, 2.2, 0.15), fasciaMat);
      fascia.position.set(0, 1.6, 1.35);
      grp.add(fascia);
      // striped awning (roof) + canvas scallop fringe on its front edge
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(18, 0.25, 5.4),
        toonMaterial(0xff5a5f, {})
      );
      awning.position.set(0, 4.4, -3.2);
      awning.rotation.x = 0.16;
      grp.add(awning);
      // awning stripes (white bars)
      const barGeo = new THREE.BoxGeometry(1.1, 0.3, 5.5);
      const barMat = toonMaterial(0xffffff, {});
      for (let i = -7; i <= 7; i += 2) {
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.position.set(i * 1.1, 4.42, -3.2);
        bar.rotation.x = 0.16;
        grp.add(bar);
      }
      // scalloped fringe hanging from the awning's front edge
      const scallopGeo = new THREE.BoxGeometry(0.6, 0.55, 0.06);
      const scallopRed = toonMaterial(0xff5a5f, {});
      const scallopWhite = toonMaterial(0xffffff, {});
      for (let i = -7; i <= 7; i++) {
        const scallop = new THREE.Mesh(scallopGeo, i % 2 === 0 ? scallopRed : scallopWhite);
        scallop.position.set(i * 0.9, 3.92, -0.42);
        scallop.rotation.x = 0.16;
        grp.add(scallop);
      }
      // support posts — AUDIT R12: z -3.4 ficava NA LINHA de visão da câmera
      // (crítico: 'objeto preto grande no centro bloqueia a plateia') → -5.6,
      // fora do frame frontal.
      const postGeo = new THREE.CylinderGeometry(0.14, 0.14, 4.4, 8);
      const postMat = toonMaterial(0x8b7a5c, {});
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(side * 8, 2.2, -5.6);
        grp.add(post);
      }
      grp.position.set(gs.x, this._gy(gs.x, gs.z), gs.z);
      grp.rotation.y = gs.ry;
      scene.add(grp);
    }
  }

  buildDistanceMarks(scene) {
    // 100m/200m distance posts along the far stretches (cheap racing flavor).
    const marks = [
      { x: -30, z: -52, ry: 0.5, label: '100' },
      { x: 30, z: -60, ry: -0.4, label: '200' },
      { x: 62, z: -20, ry: 1.5, label: '100' },
      { x: 46, z: 56, ry: 2.0, label: '200' },
      { x: -40, z: 52, ry: -2.0, label: '100' },
    ];
    // Distance board texture: amber panel with a bold dark label (the old
    // boards were plain amber boxes — user flagged them as unreadable yellow
    // cubes).
    if (!this._distTex) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#ffd166';
      g.fillRect(0, 0, 128, 64);
      g.strokeStyle = '#1b2a41';
      g.lineWidth = 6;
      g.strokeRect(4, 4, 120, 56);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this._distTexBase = tex;
    }
    const postMat = toonMaterial(0x8b7a5c, {});
    for (const m of marks) {
      if (this._onTrack(m.x, m.z, 8)) continue; // distance marks off the road
      this._contactAOs.push({ x: m.x, z: m.z, r: 1.1 }); // AUDIT AAA: AO do poste de distância
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.6, 8), postMat);
      post.position.set(m.x, smoothH(m.x, m.z) * 0.5 - 0.25 + 0.8, m.z);
      post.rotation.y = m.ry;
      scene.add(post);
      // Per-label texture (cache by label).
      const key = 'dist_' + m.label;
      if (!this._distTexes) this._distTexes = {};
      if (!this._distTexes[key]) {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 64;
        const g = c.getContext('2d');
        g.drawImage(this._distTexBase.image, 0, 0);
        g.fillStyle = '#1b2a41';
        g.font = 'bold 42px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(m.label + 'm', 64, 34);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        this._distTexes[key] = tex;
      }
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.5, 0.08),
        new THREE.MeshBasicMaterial({ map: this._distTexes[key], color: 0xffffff })
      );
      board.position.set(m.x, smoothH(m.x, m.z) * 0.5 - 0.25 + 1.35, m.z);
      board.rotation.y = m.ry;
      scene.add(board);
    }
  }

  /**
   * Spectator line along the start straight and the key corners (both sides
   * of the road, just outside the ribbon). r11 (FECO 'paper crowd'): the
   * painted canvas BILLBOARDS are gone — every fan is now a REAL 3D figure
   * (instanced body box + head sphere + raised arms, the same build as
   * buildGrandstand), so the crowd reads dense and volumetric from every
   * camera angle instead of flat paper cutouts.
   */
  buildRoadsideCrowd(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const halfW = CONFIG.track.roadWidth / 2;
    // Spectator segments along the track (t0..t1 wraps at 1.0): the start
    // straight, the back straight, and after turn 1 — so ANY race frame has
    // cheering people beside the road, not just the grid. n bumped ~40%
    // again (r11): 3D figures are cheap (4 instanced meshes total), so the
    // crowd packs in like MK8D instead of a sparse scatter.
    const SEGMENTS = [
      { t0: 0.945, t1: 0.055, n: 39 }, // start straight (WRAPS past 1.0)
      { t0: 0.10, t1: 0.15, n: 20 },    // exit of turn 1
      { t0: 0.19, t1: 0.25, n: 22 },   // turn 1
      { t0: 0.30, t1: 0.37, n: 20 },    // climb
      { t0: 0.45, t1: 0.56, n: 25 },   // back straight
      { t0: 0.62, t1: 0.68, n: 20 },    // descent
      { t0: 0.72, t1: 0.80, n: 17 },     // turn 4 approach
      { t0: 0.855, t1: 0.915, n: 17 },   // final esses
    ];
    // 3 rows deep per side (kept from r10).
    // AUDIT R73 (Feco real-GPU 2026-08-14: 'plateia indo pra cima da pista'):
    // ROWS = [1.9, 3.5, 5.1] colocava a 1ª fileira a apenas halfW+1.9m —
    // com o jitter lateral ((rand-0.5)*0.6), o berm 2.2m e corpos de 0.5m,
    // o espectador cruzava a borda do asfalto (lê como plateia NA PISTA).
    // Agora 3.2/4.9/6.6m (sempre >3.2m fora da borda, berm inteiro no
    // gramado) + gate _onTrack por figura (segurança dupla).
    const ROWS = [3.2, 4.9, 6.6];
    const segN = SEGMENTS.reduce((a, s) => a + s.n, 0);
    const total = (segN * ROWS.length * 2) * getDensityMultipliers().foliage;
    const crowdColors = [0xe74c4c, 0xf4a93e, 0x5cb85c, 0x4a90d9, 0x9b6fd4, 0xe8789a, 0xf5f5f5, 0x7b8a9e, 0x34495e];
    // AUDIT (agent: 'repeated in nearly identical poses'): 4 pose variants.
    const POSES = [
      { armL: -1.25, armR: 1.25, armY: 0.7, armX: 0.4, bodyOff: 0.36, bob: 0.26 },   // cheer (audit F3: 0.2 -> 0.26, 22% of body height)
      { armL: -0.15, armR: 0.15, armY: 0.62, armX: 0.32, bodyOff: 0.36, bob: 0.08 }, // relaxed
      { armL: -1.25, armR: 0.18, armY: 0.72, armX: 0.4, bodyOff: 0.36, bob: 0.13 },  // wave
      { armL: -0.35, armR: 0.35, armY: 0.52, armX: 0.3, bodyOff: 0.3, bob: 0.05 },   // seated (lower)
    ];
    // 3D spectator parts — one InstancedMesh per part for the WHOLE crowd
    // (4 draw calls): body box + head sphere + two raised arms, exactly the
    // figure buildGrandstand uses, so the roadside fans match the stands.
    // AUDIT (user: 'the crowd look like deformed dolls'): the 1.05x1.2 body
    // box read as tall square blocks with a tiny head. Human-proportioned
    // torso: narrow shoulders, shorter, head scaled to match.
    // AUDIT (vision: 'cream-white blobs, heads as big as the body'): the 0.3
    // head was half the torso width. Smaller head + neck + feet + a contact
    // shadow makes the figure read as a tiny person standing on the grass.
    // AUDIT (agent-0 human proportions): torso narrower+shorter, legs wear
    // navy pants (not skin), feet wear dark shoes — a dressed little person.
    const bodyGeo = new THREE.BoxGeometry(0.52, 0.6, 0.34);
    const headGeo = new THREE.SphereGeometry(0.18, 12, 8);
    const neckGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.1, 8);
    const armGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.55, 8);
    const legGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.5, 8);
    const footGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.035, 8);
    const pantsMat = toonMaterial(0x334155, {});
    const shoeMat = toonMaterial(0x1e293b, {});
    // Contact shadow (kart blob-shadow pattern): radial gradient disc.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 64;
    const sg = shadowCanvas.getContext('2d');
    const grad = sg.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.42)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 64, 64);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowGeo = new THREE.CircleGeometry(0.42, 20);
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
    const bodyMat = toonMaterial(0xffffff, {}); // per-instance suit colors below
    const skinMat = toonMaterial(0xffd9b3, {});
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, total);
    const heads = new THREE.InstancedMesh(headGeo, skinMat, total);
    const armsL = new THREE.InstancedMesh(armGeo, skinMat, total);
    const armsR = new THREE.InstancedMesh(armGeo, skinMat, total);
    const legsL = new THREE.InstancedMesh(legGeo, pantsMat, total);
    const legsR = new THREE.InstancedMesh(legGeo, pantsMat, total);
    const necks = new THREE.InstancedMesh(neckGeo, skinMat, total);
    const feetL = new THREE.InstancedMesh(footGeo, shoeMat, total);
    const feetR = new THREE.InstancedMesh(footGeo, shoeMat, total);
    const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, total);
    // Raised BERM strip — the crowd stands on a visible earth bank (agent-1
    // grounding: figures were floating over the grass with no base).
    // Striped-shirt band (agent-2): a white sash across ~30% of torsos.
    const stripeGeo = new THREE.BoxGeometry(0.56, 0.13, 0.37);
    const stripeMat = toonMaterial(0xf5f5f5, {});
    const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, total);
    const bermGeo = new THREE.BoxGeometry(2.2, 0.3, 1.4);
    const bermMat = toonMaterial(0x6b8e4e, {});
    const berms = new THREE.InstancedMesh(bermGeo, bermMat, total);
    const dummy = new THREE.Object3D();
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const col = new THREE.Color();
    // baseY per part keeps the crowd-bounce (update()) in sync: instance i
    // of every part is the SAME spectator, so the whole figure bobs as one.
    const bodyBaseY = new Array(total);
    const headBaseY = new Array(total);
    const armBaseY = new Array(total);
    const legBaseY = new Array(total);
    const neckBaseY = new Array(total);
    const footBaseY = new Array(total);
    const bobArr = new Array(total);
    const phaseArr = new Array(total);
    let idx = 0;
    for (const seg of SEGMENTS) {
      for (let side = -1; side <= 1; side += 2) {
        for (const rowOff of ROWS) {
          let _gap = 0;
          for (let i = 0; i < seg.n; i++) {
            if (idx >= total) break; // AUDIT FIX (céu roxo): nunca escrever além do buffer
            if (_gap > 0) { _gap--; continue; }
            if (this._rand() < 0.12) _gap = 1 + Math.floor(this._rand() * 3);
            // The wrap segment spans the SHORT arc past 1.0 (0.945→0.055),
            // not the whole circuit (USER BUG FIX kept from r6).
            const span = (seg.t1 - seg.t0 + 1) % 1;
            // AUDIT (agent-2): positional jitter breaks the picket-fence grid.
            const t = (seg.t0 + ((i + (this._rand() - 0.5) * 0.6) / seg.n) * span + 1) % 1;
            path.getPointAt(t, p);
            path.getTangentAt(t, tan);
            nrm.set(-tan.z, 0, tan.x).normalize();
            // Ground on the rolling TERRAIN at the figure's own spot.
            const fx = p.x + nrm.x * (side * (halfW + rowOff));
            const fz = p.z + nrm.z * (side * (halfW + rowOff));
            // AUDIT R73: gate por figura — nunca um fã sobre o asfalto (o
            // berm 2.2m + corpo + jitter não podem cruzar a borda).
            if (this._onTrack(fx, fz, 1.5)) { _gap = 2; continue; }
            const gy = this._gy(fx, fz);
            // Roll-free yaw facing the track (box +Z = the figure's front).
            const faceX = -side * nrm.x;
            const faceZ = -side * nrm.z;
            const yaw = Math.atan2(faceX, faceZ);
            // Per-figure height jitter (organic), FEET grounded on the field.
            // Family-clustered height (agent-2): random walk — neighbours share
            // a height band instead of every figure being independently random.
            // AUDIT FIX 2026-08-16 (Feco real-GPU: 'a plateia está toda
            // deformada sentada'): sy (0.85-1.4) era aplicado na ESCALA das
            // partes (cabeça esférica virava ovo esticado, braços/pernas
            // deformavam). Agora sy afeta só a POSIÇÃO vertical; as partes
            // mantêm escala unitária e proporção humana.
            if (idx % 5 === 0) this._crowdH = this._rand();
            this._crowdH = Math.min(1.25, Math.max(0.9, this._crowdH + (this._rand() - 0.5) * 0.07));
            const sy = this._crowdH;
            const pose = POSES[(this._rand() * POSES.length) | 0];
            const bodyY = gy + 0.30 + pose.bodyOff * sy; // ON the berm
            // Body — per-instance suit color from the crowd palette.
            dummy.position.set(fx, bodyY, fz);
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            bodies.setMatrixAt(idx, dummy.matrix);
            col.setHex(crowdColors[Math.floor(this._rand() * crowdColors.length)]);
            bodies.setColorAt(idx, col);
            bodyBaseY[idx] = bodyY;
            bobArr[idx] = pose.bob;
            phaseArr[idx] = this._rand() * Math.PI * 2; // per-figure jump phase (audit F4)
            // Berm under the figure — visible earth bank.
            dummy.position.set(fx, gy + 0.15, fz);
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            berms.setMatrixAt(idx, dummy.matrix);
            // Striped-shirt sash (30% of the crowd). AUDIT FIX (céu roxo):
            // slot SEMPRE escrito — sem faixa = escala zero (slot nunca fica
            // com matriz vazia nem vira caixa fantasma na origem).
            if (this._rand() < 0.3) {
              dummy.position.set(fx, bodyY - 0.02 * sy, fz);
              dummy.rotation.set(0, yaw, 0);
              dummy.scale.set(1, 1, 1); // AUDIT FIX 2026-08-16: sem sy (deformava)
            } else {
              dummy.position.set(0, 0, 0);
              dummy.rotation.set(0, 0, 0);
              dummy.scale.set(0, 0, 0);
            }
            dummy.updateMatrix();
            stripes.setMatrixAt(idx, dummy.matrix);
            // Contact shadow ON the berm top.
            dummy.position.set(fx, gy + 0.315, fz);
            dummy.rotation.set(-Math.PI / 2, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            shadows.setMatrixAt(idx, dummy.matrix);
            // Neck between torso top and head — scaled with the figure.
            dummy.position.set(fx, bodyY + 0.32 * sy, fz);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1); // AUDIT FIX 2026-08-16: sem sy
            dummy.updateMatrix();
            necks.setMatrixAt(idx, dummy.matrix);
            neckBaseY[idx] = bodyY + 0.47 * sy;
            // Head (skin tone) — smaller, sits on the neck, scaled with body.
            dummy.position.set(fx, bodyY + 0.46 * sy, fz);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1); // AUDIT FIX 2026-08-16: sem sy (cabeça não vira ovo)
            dummy.updateMatrix();
            heads.setMatrixAt(idx, dummy.matrix);
            headBaseY[idx] = bodyY + 0.46 * sy;
            // Arms — pose from the table (cheer/relax/wave/seated).
            dummy.position.set(fx - pose.armX * Math.cos(yaw), bodyY + (pose.armY - 0.54) * sy, fz + pose.armX * Math.sin(yaw));
            dummy.rotation.set(0, yaw, pose.armL);
            dummy.scale.set(1, 1, 1); // AUDIT FIX 2026-08-16: sem sy
            dummy.updateMatrix();
            armsL.setMatrixAt(idx, dummy.matrix);
            dummy.position.set(fx + pose.armX * Math.cos(yaw), bodyY + (pose.armY - 0.54) * sy, fz - pose.armX * Math.sin(yaw));
            dummy.rotation.set(0, yaw, pose.armR);
            dummy.updateMatrix();
            armsR.setMatrixAt(idx, dummy.matrix);
            armBaseY[idx] = bodyY + (pose.armY - 0.54) * sy;
            // Two separate legs — from the ground up to the torso bottom.
            const legLen = Math.max(0.3, bodyY - gy - 0.05); // legs hang to the berm top
            dummy.position.set(fx - 0.13 * Math.cos(yaw), gy + legLen * 0.5, fz + 0.13 * Math.sin(yaw));
            dummy.rotation.set(0, yaw, 0.12);
            dummy.scale.set(1, Math.max(0.6, Math.min(1.15, legLen / 0.5)), 1); // AUDIT FIX 2026-08-16: clamp 0.6-1.15 (antes até 1.5 esticava)
            dummy.updateMatrix();
            legsL.setMatrixAt(idx, dummy.matrix);
            legBaseY[idx] = gy + legLen * 0.5;
            dummy.position.set(fx + 0.13 * Math.cos(yaw), gy + legLen * 0.5, fz - 0.13 * Math.sin(yaw));
            dummy.rotation.set(0, yaw, -0.12);
            dummy.updateMatrix();
            legsR.setMatrixAt(idx, dummy.matrix);
            legBaseY[idx] = gy + legLen * 0.5;
            // Feet — flattened under each leg, CLAMPED to the terrain so a
            // short figure (sy 0.9) never sinks its feet into the grass.
            const footY = Math.max(bodyY - 0.55, gy + 0.32); // feet on the berm
            dummy.position.set(fx - 0.12 * Math.cos(yaw), footY, fz + 0.12 * Math.sin(yaw));
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            feetL.setMatrixAt(idx, dummy.matrix);
            footBaseY[idx] = footY;
            dummy.position.set(fx + 0.12 * Math.cos(yaw), footY, fz - 0.12 * Math.sin(yaw));
            dummy.rotation.set(0, yaw, 0);
            dummy.updateMatrix();
            feetR.setMatrixAt(idx, dummy.matrix);
            footBaseY[idx] = footY;
            idx++;
          }
        }
      }
    }
    // AUDIT FIX (2026-08-21, 'céu roxo'): count sincronizado com as figuras
    // realmente escritas (o buffer pode ser maior que o usado por gaps/gate
    // _onTrack; sem isso o count fracionário do alloc lia slots vazios).
    bodies.count = idx; heads.count = idx; armsL.count = idx; armsR.count = idx;
    legsL.count = idx; legsR.count = idx; necks.count = idx;
    feetL.count = idx; feetR.count = idx;
    shadows.count = idx; berms.count = idx; stripes.count = idx;
    bodies.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    armsL.instanceMatrix.needsUpdate = true;
    armsR.instanceMatrix.needsUpdate = true;
    legsL.instanceMatrix.needsUpdate = true;
    legsR.instanceMatrix.needsUpdate = true;
    necks.instanceMatrix.needsUpdate = true;
    feetL.instanceMatrix.needsUpdate = true;
    feetR.instanceMatrix.needsUpdate = true;
    shadows.instanceMatrix.needsUpdate = true;
    berms.instanceMatrix.needsUpdate = true;
    stripes.instanceMatrix.needsUpdate = true;
    // AUDIT F3 (crowd audit): bob/phase arrays are shared by ALL parts so a
    // spectator's head/arms/legs move with its body — previously only the
    // body had bobArr and the head/arms fell back to 0.18 (head bobbed 2.25x
    // the body, or detached from a static torso).
    bodies.userData.baseY = bodyBaseY;
    bodies.userData.bob = bobArr;
    bodies.userData.phase = phaseArr;
    heads.userData.baseY = headBaseY;
    heads.userData.bob = bobArr;
    heads.userData.phase = phaseArr;
    armsL.userData.baseY = armBaseY;
    armsL.userData.bob = bobArr;
    armsL.userData.phase = phaseArr;
    armsR.userData.baseY = armBaseY;
    armsR.userData.bob = bobArr;
    armsR.userData.phase = phaseArr;
    legsL.userData.baseY = legBaseY;
    legsL.userData.bob = bobArr;
    legsL.userData.phase = phaseArr;
    legsR.userData.baseY = legBaseY;
    legsR.userData.bob = bobArr;
    legsR.userData.phase = phaseArr;
    necks.userData.baseY = neckBaseY;
    necks.userData.bob = bobArr;
    necks.userData.phase = phaseArr;
    feetL.userData.baseY = footBaseY;
    feetL.userData.bob = bobArr;
    feetL.userData.phase = phaseArr;
    feetR.userData.baseY = footBaseY;
    feetR.userData.bob = bobArr;
    feetR.userData.phase = phaseArr;
    scene.add(bodies, heads, armsL, armsR, legsL, legsR, necks, feetL, feetR, shadows, berms, stripes);
    (this.crowdMeshes = this.crowdMeshes || []).push(bodies, heads, armsL, armsR, legsL, legsR, necks, feetL, feetR);
  }

  /**
   * Procedural castle stone texture: block courses with per-block tonal
   * jitter, dark mortar and translucent moss patches. Drawn near-grayscale
   * and tinted by the material color, so the r6 palette (darker keep /
   * lighter walls) survives with the block detail on top. repeat = [x, y]
   * tile count per mesh, cached per repeat so keep/turrets/walls each get
   * their own wrap. Uses a dedicated local seed (rnd(56011)) — never touches
   * this._rand, so every later builder keeps its bit-identical layout.
   */
  _castleStoneTexture(repeat) {
    const key = repeat[0] + 'x' + repeat[1];
    if (this._stoneTexs?.[key]) return this._stoneTexs[key];
    if (!this._stoneTexBase) {
      const s = 512;
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      const g = c.getContext('2d');
      const rand = rnd(56011);
      // dark mortar bed shows through the block gaps
      g.fillStyle = '#5c5543';
      g.fillRect(0, 0, s, s);
      const cols = 6;
      const rows = 6;
      const cell = s / cols;
      const mort = 5;
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          // per-block tonal jitter (grayscale — the material color tints it)
          const v = 0.95 + rand() * 0.3;
          g.fillStyle = `rgb(${(v * 236) | 0},${(v * 228) | 0},${(v * 210) | 0})`;
          g.fillRect(col * cell + mort, r * cell + mort, cell - mort * 2, cell - mort * 2);
          // carved lower edge on some blocks
          if (rand() < 0.45) {
            g.fillStyle = 'rgba(60,54,40,0.28)';
            g.fillRect(col * cell + mort, r * cell + cell - mort - 5, cell - mort * 2, 5);
          }
        }
      }
      // translucent moss patches clustered on the courses
      for (let i = 0; i < 24; i++) {
        const mx = rand() * s;
        const my = rand() * s;
        g.fillStyle = `rgba(96,122,66,${0.16 + rand() * 0.3})`;
        g.beginPath();
        g.arc(mx, my, 3 + rand() * 7, 0, Math.PI * 2);
        g.fill();
      }
      // heavier moss lines along a few horizontal mortar rows
      for (let i = 0; i < 5; i++) {
        const ly = (1 + rand() * (rows - 1)) * cell;
        for (let k = 0; k < 9; k++) {
          g.fillStyle = `rgba(96,122,66,${0.14 + rand() * 0.24})`;
          g.fillRect(rand() * s, ly - 2 + rand() * 4, 6 + rand() * 11, 3);
        }
      }
      this._stoneTexBase = c;
    }
    const tex = new THREE.CanvasTexture(this._stoneTexBase);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    this._stoneTexs = this._stoneTexs || {};
    this._stoneTexs[key] = tex;
    return tex;
  }

  /**
   * Deep-red roof tile texture: 8x8 tile grid with per-tile tonal jitter,
   * occasional darker tiles, a shadow course under each row and a highlight
   * lip on top — reads as tiled roofing on the cone roofs. Own seed
   * (rnd(56012)); cached per repeat.
   */
  _roofTileTexture(repeat) {
    const key = repeat[0] + 'x' + repeat[1];
    if (this._roofTexs?.[key]) return this._roofTexs[key];
    if (!this._roofTexBase) {
      const s = 256;
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      const g = c.getContext('2d');
      const rand = rnd(56012);
      g.fillStyle = '#7a241f'; // deep-red mortar bed
      g.fillRect(0, 0, s, s);
      const cols = 8;
      const rows = 8;
      const cw = s / cols;
      const ch = s / rows;
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const dark = rand() < 0.16;
          const mul = dark ? 0.68 : 1;
          const rr = (150 + rand() * 26) * mul;
          const gg = (52 + rand() * 12) * mul;
          const bb = (46 + rand() * 10) * mul;
          g.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
          g.fillRect(col * cw + 1, r * ch + 1, cw - 2, ch - 2);
          // shadow course + highlight lip (tile rows)
          g.fillStyle = 'rgba(60,16,14,0.5)';
          g.fillRect(col * cw + 1, r * ch + ch - 4, cw - 2, 3);
          g.fillStyle = 'rgba(255,190,170,0.22)';
          g.fillRect(col * cw + 1, r * ch + 1, cw - 2, 2);
        }
      }
      this._roofTexBase = c;
    }
    const tex = new THREE.CanvasTexture(this._roofTexBase);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    this._roofTexs = this._roofTexs || {};
    this._roofTexs[key] = tex;
    return tex;
  }

  /**
   * Castle banner texture: deep-red field with a gold border and the game's
   * billboard palette (white shield + cyan band + coral #ff5a5f wheel + navy
   * #1b2a41 accents). The emblem is drawn in the middle 128px band of the
   * square canvas — the banner plane is 2:1, so that band maps 1:1 with no
   * distortion (the plain red top/bottom thirds squish harmlessly).
   */
  _castleBannerTexture() {
    if (this._bannerTex) return this._bannerTex;
    const s = 256;
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const g = c.getContext('2d');
    g.fillStyle = '#d8433c'; // matches the pennant red
    g.fillRect(0, 0, s, s);
    const x0 = 24;
    const x1 = 232;
    const y0 = 64;
    const y1 = 192;
    // gold inner border
    g.strokeStyle = '#ffd166';
    g.lineWidth = 8;
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    // white shield + cyan top band
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(128, 74);
    g.lineTo(182, 92);
    g.lineTo(182, 138);
    g.lineTo(128, 178);
    g.lineTo(74, 138);
    g.lineTo(74, 92);
    g.closePath();
    g.fill();
    g.fillStyle = '#2ec4ff';
    g.beginPath();
    g.moveTo(128, 74);
    g.lineTo(182, 92);
    g.lineTo(182, 102);
    g.lineTo(74, 102);
    g.lineTo(74, 92);
    g.closePath();
    g.fill();
    g.strokeStyle = '#1b2a41';
    g.lineWidth = 5;
    g.stroke();
    // coral steering wheel (game logo color)
    g.fillStyle = '#ff5a5f';
    g.beginPath();
    g.arc(128, 132, 32, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b2a41';
    g.beginPath();
    g.arc(128, 132, 11, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1b2a41';
    g.lineWidth = 6;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      g.beginPath();
      g.moveTo(128 + Math.cos(a) * 11, 132 + Math.sin(a) * 11);
      g.lineTo(128 + Math.cos(a) * 30, 132 + Math.sin(a) * 30);
      g.stroke();
    }
    this._bannerTex = new THREE.CanvasTexture(c);
    this._bannerTex.anisotropy = 8;
    this._bannerTex.colorSpace = THREE.SRGBColorSpace;
    return this._bannerTex;
  }

  /**
   * Periodic roadside light poles along straights (audit V3: mid-straights
   * read empty — MK8 lines straights with poles/stands/banners).
   */
  buildLightPoles(scene, track) {
    if (!track || !track.path) return;
    // NEON CITY: the day poles are replaced by glowing pink/cyan neon strips.
    if (this.trackId === 2) {
      this.buildNeonPoles(scene, track);
      return;
    }
    const path = track.path;
    const halfW = CONFIG.track.roadWidth / 2;
    // AUDIT PERF-R32 (2026-08-14, auditoria render #5): geometrias eram
    // criadas dentro do loop (auto-instancing não agrupava) → ~50 calls.
    // Agora 2 InstancedMesh (pole+head) com geometria/material compartilhados.
    const poleMat = toonMaterial(0x7d8a99, {});
    const headMat = toonMaterial(0xffd166, {});
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.09, 3.4, 8);
    const headGeo = new THREE.BoxGeometry(0.5, 0.14, 0.22);
    const dummy = new THREE.Object3D();
    const tan = new THREE.Vector3();
    const tan2 = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const maxPoles = 48;
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, maxPoles);
    const heads = new THREE.InstancedMesh(headGeo, headMat, maxPoles);
    poles.name = 'lightpole-instanced';
    heads.name = 'lightpole-head-instanced';
    scene.add(poles, heads);
    let made = 0;
    for (let i = 0; i < 200; i++) {
      const t = i / 200;
      path.getTangentAt(t, tan);
      path.getTangentAt(Math.min(0.999, t + 1 / 200), tan2);
      const curv = 1 - Math.min(1, Math.max(-1, tan.dot(tan2)));
      // Straight sections only (curv < 0.0008) → "empty runs" get rhythm.
      if (curv > 0.0008) continue;
      if (made % 2 === 0 && i % 4 !== 0) continue; // every 4th sample on straights
      path.getPointAt(t, p);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const side = made % 2 === 0 ? 1 : -1;
      const px = p.x + nrm.x * (side * (halfW + 3.6));
      const pz = p.z + nrm.z * (side * (halfW + 3.6));
      dummy.position.set(px, p.y + 1.7, pz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poles.setMatrixAt(made, dummy.matrix);
      this._contactAOs.push({ x: px, z: pz, r: 1.7 }); // AUDIT AAA: AO do poste de luz
      // lamp head faces the track
      dummy.position.set(px, p.y + 3.45, pz);
      dummy.lookAt(p.x, p.y + 3.45, p.z);
      dummy.rotation.z = 0;
      dummy.updateMatrix();
      heads.setMatrixAt(made, dummy.matrix);
      made++;
      if (made >= maxPoles) break;
    }
    poles.count = made;
    heads.count = made;
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  /** Night sky dome texture: dark blue-purple gradient + faint stars.
   *  Gradient follows the theme spec: 0x1a1a3a horizon → 0x2a2a5a mid →
   *  0x3a2a6a zenith (canvas y=0 is the dome top in three's sphere UVs). */
  _nightSkyTexture() {
    if (this._nightSkyTex) return this._nightSkyTex;
    const s = 512;
    const canvas = document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#3a2a6a'); // zenith
    g.addColorStop(0.5, '#2a2a5a');
    g.addColorStop(1, '#1a1a3a'); // horizon — matches the night fog color
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // sparse deterministic star field (upper sky only)
    const rand = rnd(777);
    for (let i = 0; i < 90; i++) {
      const x = rand() * s;
      const y = rand() * s * 0.72;
      ctx.globalAlpha = 0.25 + rand() * 0.65;
      ctx.fillStyle = rand() > 0.8 ? '#cfe0ff' : '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 0.5 + rand() * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this._nightSkyTex = new THREE.CanvasTexture(canvas);
    this._nightSkyTex.colorSpace = THREE.SRGBColorSpace;
    return this._nightSkyTex;
  }

  /** Building facade texture: dark blue-grey wall + grid of lit window
   *  cells. MeshBasicMaterial keeps the facade self-lit at night, and the
   *  per-instance color tints every lit cell (dark walls × tint stay dark,
   *  so only the windows glow in orange / electric blue / yellow). */
  _windowTexture(opts = {}) {
    // FIX 2026-09-04 (facade-grade): a row near (11-19m) estica a textura
    // quadrada 12x16 em faces de até 30m de altura (box 10x14x8, escala
    // h/14) — janelas gigantes borradas no 1º plano (GPU frame_0008). Grade
    // portrait por row (near 8x22, demais 12x16) = densidade de grade, não
    // reshuffle de células (lição W4: reshuffle é sub-perceptual). Cache por
    // chave; sem física/input/áudio/assets/geometria.
    const seed = opts.seed ?? 4242;
    const cols = opts.cols ?? 12;
    const rows = opts.rows ?? 16;
    const mullion = !!opts.mullion; // FIX 2026-09-04 (near-mullion): células
    // da row near têm ~1.5m no mundo — de perto leem como painéis gigantes
    // lisos. Cruz de caixilho na cor da parede divide cada célula acesa em
    // 4 panes (detalhe close-range; no mipmap funde e o look 55m não muda).
    // Só na textura near: legada mantém chave/layout/RNG byte-idênticos.
    const key = `${seed}-${cols}x${rows}${mullion ? '-m' : ''}`;
    if (!this._windowTexCache) this._windowTexCache = {};
    if (this._windowTexCache[key]) return this._windowTexCache[key];
    const s = 256;
    const canvas = document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d1322'; // AUDIT 2026-08-25: parede mais escura/azul —
    // janelas amarelas (0xffe23c) minificadas a 120m+ misturavam com a parede
    // e liam como uma BANDA OLIVA no horizonte. Parede mais fria/escura
    // aumenta o contraste e a média de cor volta ao azul-noturno.
    ctx.fillRect(0, 0, s, s);
    const rand = rnd(seed);
    // AUDIT R2 (blind critic 2026-08-13: 'windows look like light panels,
    // not inhabited buildings'): 6x7 cells with per-cell INTENSITY variety,
    // warm/cool mix, curtain tints, some whole dark floors. Reads as offices
    // and apartments, not uniform lit strips.
    // AUDIT GPU-real (2026-08-23, LXC 105): prédios próximos da row A esticam
    // a textura 256px por ~14m — janelas viram retângulos gigantes borrados
    // (fachada lisa preta no 1º plano). Grid 6x7→12x16: células menores,
    // fachadas próximas leem como janelas, distantes mantêm o brilho.
    // Grade dimensionada p/ caber no canvas 256 em qualquer densidade:
    // célula = (s - gaps)/n por eixo (near 8x22 → ~27x8.8px). A grade
    // padrão 12x16 mantém o layout legado exato (célula 15 centralizada)
    // para as demais rows não mudarem 1 texel.
    const gap = 3;
    const legacy = cols === 12 && rows === 16;
    const cw = legacy ? 15 : (s - (cols - 1) * gap) / cols;
    const ch = legacy ? 15 : (s - (rows - 1) * gap) / rows;
    const startX = legacy ? (s - (cols * cw + (cols - 1) * gap)) / 2 : 0;
    const startY = legacy ? (s - (rows * ch + (rows - 1) * gap)) / 2 : 0;
    // AUDIT R21h: 100% FRIAS — o último tint quente (#ffe9c4) × material
    // color claro das rows × bloom × warm grade = MASSA OLIVA nas fachadas
    // distantes (medido: texel [183,175,156] × #8b8a92 → bege → oliva).
    const litTints = ['#cfe4ff', '#d8e8ff', '#cfe4ff', '#d8e8ff', '#eef6ff'];
    // Dark floors: pick 2-3 rows that stay mostly unlit (office closed).
    const darkFloors = new Set();
    const nDark = 2 + ((rand() * 2) | 0);
    while (darkFloors.size < nDark) darkFloors.add((rand() * rows) | 0);
    for (let r = 0; r < rows; r++) {
      const floorLit = !darkFloors.has(r);
      for (let c = 0; c < cols; c++) {
        // AUDIT R3 (critic: 'too regular, no per-window variety'): jitter
        // position + size so the facade reads as real windows, not a grid.
        const jx = (rand() - 0.5) * (cw * 0.5);
        const jy = (rand() - 0.5) * (ch * 0.5);
        const w = cw * (0.7 + rand() * 0.5);
        const h = ch * (0.7 + rand() * 0.5);
        const x = startX + c * (cw + gap) + jx;
        const y = startY + r * (ch + gap) + jy;
        if (!floorLit) {
          // mostly dark floor — one dim survivor window
          if (rand() < 0.14) {
            ctx.fillStyle = '#2a3550';
            ctx.fillRect(x, y, w, h);
          }
          continue;
        }
        const roll = rand();
        if (roll < 0.38) { // AUDIT R21d: 0.5→0.38 — menos janelas acesas (fachada não vira parede de luz)
          // lit window: intensity 0.4-1.0 — some barely lit, some blazing
          const bright = 0.4 + rand() * 0.6;
          ctx.globalAlpha = bright;
          ctx.fillStyle = litTints[(rand() * litTints.length) | 0];
          ctx.fillRect(x, y, w, h);
          ctx.globalAlpha = 1;
          if (mullion) {
            // caixilho 4-panes: barras na cor da parede, sem rand() novo
            // (layout/RNG idênticos; só detalhe adicionado).
            ctx.fillStyle = '#0d1322';
            ctx.fillRect(x + w * 0.43, y, Math.max(1, w * 0.14), h);
            ctx.fillRect(x, y + h * 0.42, w, Math.max(1.5, h * 0.16));
          }
          // curtain divider — thin vertical darker slit (visible at this size)
          if (rand() < 0.45) {
            ctx.fillStyle = 'rgba(10,14,30,0.55)';
            ctx.fillRect(x + w * 0.45, y, w * 0.12, h);
          }
        } else if (roll < 0.72) {
          // unlit dark glass with faint cool reflection
          ctx.fillStyle = '#0e1426';
          ctx.fillRect(x, y, w, h);
          if (rand() < 0.5) {
            ctx.fillStyle = 'rgba(120,150,210,0.10)';
            ctx.fillRect(x + 2, y + 2, w - 4, 4);
          }
        } else {
          // bright accent window — a "someone left the light on" hot cell
          // AUDIT R21h: accent agora FRIO (#dceaff) — o quente (#fff2d0)
          // era a última fonte de âmbar nas fachadas (massa oliva à distância).
          ctx.fillStyle = '#dceaff';
          ctx.globalAlpha = 0.7;
          ctx.fillRect(x, y, w, h);
          ctx.globalAlpha = 1;
          if (mullion) {
            ctx.fillStyle = '#0d1322';
            ctx.fillRect(x + w * 0.43, y, Math.max(1, w * 0.14), h);
            ctx.fillRect(x, y + h * 0.42, w, Math.max(1.5, h * 0.16));
          }
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._windowTexCache[key] = tex;
    return tex;
  }

  /**
   * NEON CITY skyline: glowing moon disc + two concentric rows of instanced
   * towers (12-16 each) 65-90m out. Towers are 6x(12-30)x6 boxes offset
   * along the outward radial from the loop centroid — that direction always
   * moves AWAY from the road, so nothing ever spawns on the track (belt &
   * suspenders: an _onTrack guard runs anyway). Each tower carries the
   * window-grid texture tinted per-instance with a hot neon color.
   */
  buildNeonCity(scene, track) {
    // --- moon: small glowing white disc + soft halo, high in the night sky.
    //     fog:false so it stays crisp past the fog far plane.
    const moon = new THREE.Group();
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(5.4, 24),
      new THREE.MeshBasicMaterial({ color: 0xaac4ff, transparent: true, opacity: 0.3, fog: false, depthWrite: false })
    );
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(2.7, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff4e0, fog: false })
    );
    disc.position.z = 0.2; // avoid z-fight with the halo
    moon.add(halo, disc);
    moon.position.set(150, 195, -115); // same axis as the night key light
    moon.lookAt(0, 0, 0); // face the track
    scene.add(moon);

    // --- building skyline ---
    if (!track || !track.path) return;
    const path = track.path;
    const len = path.getLength();
    // Loop centroid → outward radial offset is guaranteed road-safe.
    const cent = new THREE.Vector3();
    const probe = new THREE.Vector3();
    for (let i = 0; i < 64; i++) {
      path.getPointAt(i / 64, probe);
      cent.add(probe);
    }
    cent.multiplyScalar(1 / 64);

    const geo = new THREE.BoxGeometry(10, 14, 8);
    // A shallow overhanging roof plate gives each skyline block a readable
    // architectural termination without touching the emissive window material.
    // One instanced layer per row keeps the detail inside the city draw budget.
    const roofGeo = new THREE.BoxGeometry(10.8, 0.22, 8.8);
    const roofMat = new THREE.MeshBasicMaterial({ color: 0x27324a, fog: false });
    // Narrow corner pilasters break the repeated box silhouette and give each
    // tower a readable hard-surface frame without covering the emissive window
    // texture. One instanced layer per row keeps the city cost predictable.
    const pilasterGeo = new THREE.BoxGeometry(0.24, 13.2, 0.24);
    const pilasterBase = new THREE.Color(0x596884);
    const antGeo = new THREE.CylinderGeometry(0.06, 0.1, 3.2, 5);
    const antMat = new THREE.MeshBasicMaterial({ color: 0x8892b8 });
    const tankGeo = new THREE.CylinderGeometry(0.5, 0.55, 1.1, 8);
    const tankMat = new THREE.MeshBasicMaterial({ color: 0x3a4152 });
    // AUDIT R21d (final): paleta FRIA dominante — janelas laranja/âmbar em
    // massa liam como fachadas oliva (perto E longe). Noite urbana real:
    // maioria branca-fria/azul, âmbar como ACENTO raro.
    const windowColors = [0x9fc8ff, 0xd8e8ff, 0xff9a3c, 0x9fc8ff, 0xd8e8ff]; // 2/5 âmbar→peso 20%
    // Deterministic palette telemetry: records the effective distribution after
    // road-safety rejection, without touching materials or instance transforms.
    const paletteCounts = new Array(windowColors.length).fill(0);
    const paletteRows = [];
    const dummy = new THREE.Object3D();
    const dir = new THREE.Vector3();
    // FIX 2026-09-04 (shop-sign): footprints da fileira proxima (row-A,
    // 11-19m radial) para os letreiros desviarem das torres em vez de
    // nascerem embutidos nas fachadas. So a row near importa: letreiros
    // ficam a ~11.5m da pista; fileiras B+ estao alem de 26m.
    const nearTowers = [];
    // Row A hugs the track (16-26m); row B sits behind it (26-38m); row C is
    // a LOWER midground fill (50-62m) so the city has depth layers (vision
    // critic: 'few buildings at intermediate and far distances').
    // AUDIT r20-FIX: per-row haze — one InstancedMesh per row, material
    // color multiplied toward the night fog so depth reads (the shared
    // material flattened the far row into the near one).
    const rows = [
      { seed: 21000, base: 11, range: 8, haze: 0.0, near: true }, // AUDIT MED: hug the roadside (was 16m — 9m dead band)
      { seed: 22000, base: 26, range: 12, haze: 0.5 }, // AUDIT R21b: haze + — amarelo vazava
      { seed: 23000, base: 50, range: 12, low: true, haze: 0.75 },
      { seed: 24000, base: 74, range: 16, low: true, haze: 0.92 }, // far silhouette layer
    ];
    // AUDIT PISTA R11 (2026-08-16): alvo de bruma roxo-azulado MAIS CLARO —
    // as fileiras longe liam como silhueta preta (0x1a2436 ~ vazio); agora a
    // cidade na distância lê como bruma iluminada (profundidade real MK8).
    const fogCol = new THREE.Color(0x141034); // AUDIT R21b: alinhado ao novo fog 0x141034
    for (const row of rows) {
      const rand = rnd(row.seed);
      const count = 24 + Math.floor(rand() * 5); // 24-28 per row (denser skyline — vision critic: sparse)
      const rowMat = new THREE.MeshBasicMaterial({
        // FIX 2026-09-04 (facade-grade): row near (11-19m) usa grade
        // portrait 8x22 p/ janelas menores/nítidas no 1º plano; demais rows
        // mantêm o layout 12x16 legado byte-idêntico.
        map: row.near ? this._windowTexture({ seed: row.seed, cols: 8, rows: 22, mullion: true }) : this._windowTexture(),
        color: new THREE.Color(1, 1, 1).lerp(fogCol, row.haze),
        fog: false,
        toneMapped: false, // AUDIT R11: janelas acesas brilham sob ACES
      });
      const paletteRowCounts = new Array(windowColors.length).fill(0);
      const towers = new THREE.InstancedMesh(geo, rowMat, count);
      const roofTops = new THREE.InstancedMesh(roofGeo, roofMat, count);
      // FIX tick33 (pilaster-haze): antes material único 0x596884 sem haze —
      // na fileira far (haze 0.92) a torre sumia na bruma e a pilastra fina
      // continuava acesa, lendo como risco pálido no céu. Mesmo lerp da torre.
      const pilasterMat = new THREE.MeshBasicMaterial({
        color: pilasterBase.clone().lerp(fogCol, row.haze),
        fog: false,
      });
      const pilasters = new THREE.InstancedMesh(pilasterGeo, pilasterMat, count * 4);
      pilasters.name = `neon-facade-pilasters-${row.seed}`;
      roofTops.name = `neon-roof-caps-${row.seed}`;
      let idx = 0;
      for (let i = 0; i < count; i++) {
        const t = (((i / count + (rand() - 0.5) * (6 / len)) % 1) + 1) % 1; // ±3m along path
        path.getPointAt(t, probe);
        dir.copy(probe).sub(cent).setY(0);
        if (dir.lengthSq() < 1) continue;
        dir.normalize();
        const off = row.base + rand() * row.range; // 65-90m out
        const x = probe.x + dir.x * off;
        const z = probe.z + dir.z * off;
        if (this._onTrack(x, z, 6)) continue; // never on the road
        // F3 zone silhouette pass: random height alone makes the skyline read
        // as one repeated wall. Four path sectors now have deliberate scale
        // bands while keeping the same instanced geometry and row haze.
        const zoneIndex = Math.min(3, Math.floor(t * 4));
        const zoneScale = row.low
          ? [0.72, 1.12, 0.84, 1.28][zoneIndex]
          : [0.86, 1.18, 0.78, 1.04][zoneIndex];
        const h = (row.low ? 8 + rand() * 8 : 12 + rand() * 18) * zoneScale;
        const gy = this._gy(x, z);
        dummy.position.set(x, gy + h / 2, z);
        // AUDIT MED: vary the footprint so towers are blocks, not identical
        // monoliths; roof antennas on the tallest.
        const sx = 0.55 + rand() * 0.95;
        const sz = 0.55 + rand() * 0.95;
        // AUDIT AAA tick: contact-AO disc fitted to the tower footprint, only
        // for the roadside row (11-19m) where the chase camera can read
        // grounding. Far rows skipped: geometry candidates there were
        // pixel-identical in paired A/B, and a flat disc reads even less.
        if (row.near) this._contactAOs.push({ x, z, r: Math.max(sx * 10, sz * 8) * 0.5 + 1.5 });
        // FIX 2026-09-04: a geometria do box tem 14m de altura, logo a
        // escala Y é h/14 para o topo real ser gy+h (antes h/12 enterrava o
        // roof cap 0.67-2.50m dentro do box, invisível em todas as alturas).
        dummy.scale.set(sx, h / 14, sz);
        if (h > 22) {
          const ant = new THREE.Mesh(antGeo, antMat);
          ant.position.set(x, gy + h + 1.6, z);
          scene.add(ant);
          // AUDIT: rooftop machinery — a water tank beside the antenna
          // FIX 2026-09-04: assenta na roof plate (topo gy+h+0.22).
          const tank = new THREE.Mesh(tankGeo, tankMat);
          tank.position.set(x + (sx * 2.6), gy + h + 0.77, z);
          scene.add(tank);
        }
        dummy.rotation.set(0, rand() * 0.25, 0);
        dummy.updateMatrix();
        towers.setMatrixAt(idx, dummy.matrix);
        // FIX 2026-09-04 (shop-sign): registra footprint da row-A para o
        // desvio dos letreiros (hx=sx*5, hz=sz*4 do box 10x14x8).
        if (row.near) nearTowers.push({ x, z, hx: sx * 5, hz: sz * 4, yaw: dummy.rotation.y });
        dummy.position.y = gy + h + 0.11;
        dummy.scale.set(sx, 1, sz);
        dummy.updateMatrix();
        roofTops.setMatrixAt(idx, dummy.matrix);
        const cos = Math.cos(dummy.rotation.y);
        const sin = Math.sin(dummy.rotation.y);
        // FIX 2026-09-04: cantos orgulhosos da fachada (face externa 0.06
        // para fora da superfície do box); antes 4.86/3.86 enterrava a
        // pilastra (0.24 de largura) dentro da torre p/ sx >= ~0.86.
        const cornerX = sx * 5 - 0.06;
        const cornerZ = sz * 4 - 0.06;
        const corners = [[-cornerX, -cornerZ], [cornerX, -cornerZ], [cornerX, cornerZ], [-cornerX, cornerZ]];
        corners.forEach(([localX, localZ], cornerIndex) => {
          const px = x + localX * cos - localZ * sin;
          const pz = z + localX * sin + localZ * cos;
          dummy.position.set(px, gy + h / 2, pz);
          dummy.scale.set(1, h / 13.2, 1);
          dummy.updateMatrix();
          pilasters.setMatrixAt(idx * 4 + cornerIndex, dummy.matrix);
        });
        const paletteIndex = (rand() * windowColors.length) | 0;
        towers.setColorAt(idx, new THREE.Color(windowColors[paletteIndex]));
        paletteRowCounts[paletteIndex]++;
        idx++;
      }
      if (idx > 0) {
        towers.count = idx;
        roofTops.count = idx;
        pilasters.count = idx * 4;
        paletteRowCounts.forEach((n, colorIndex) => { paletteCounts[colorIndex] += n; });
        paletteRows.push({ seed: row.seed, count: idx, counts: paletteRowCounts });
        towers.instanceMatrix.needsUpdate = true;
        roofTops.instanceMatrix.needsUpdate = true;
        pilasters.instanceMatrix.needsUpdate = true;
        if (towers.instanceColor) towers.instanceColor.needsUpdate = true;
        towers.castShadow = false;
        roofTops.castShadow = false;
        pilasters.castShadow = false;
        scene.add(towers, roofTops, pilasters);
      }
    }

    if (typeof window !== 'undefined') {
      window.__sk3dNeonPalette = {
        colors: windowColors.slice(),
        counts: paletteCounts.slice(),
        rows: paletteRows.map((row) => ({ seed: row.seed, count: row.count, counts: row.counts.slice() })),
        total: paletteCounts.reduce((sum, n) => sum + n, 0),
      };
    }

    // --- glowing shop signs on the CLOSE tower row (street-level neon
    // signage — MK8 city courses are lined with lit storefronts) ---
    {
      const signGeo = new THREE.BoxGeometry(3.4, 0.8, 0.14);
      const signCols = [0xff2ec4, 0x2ec4ff, 0xffe23c, 0x3cff9a];
      const signLegMat = new THREE.MeshBasicMaterial({ color: 0x232a3a });
      // FIX 2026-09-05 (shop-sign-text): letreiros eram caixas de cor sólida
      // (close-up determinístico lia placeholder em branco). Textura canvas
      // por cor: palavra real + disco logo; mesma textura frente+verso
      // (BoxGeometry mapeia UV por face p/ leitura correta de fora);
      // laterais emolduradas escuras.
      const SHOP_WORDS = ['TURBO', 'NITRO', 'APEX', 'PISTON'];
      const _shopCss = (hex) => '#' + hex.toString(16).padStart(6, '0');
      const shopTex = (bgCss, word) => {
        const cv = document.createElement('canvas');
        cv.width = 256; cv.height = 64;
        const c = cv.getContext('2d');
        c.fillStyle = bgCss; c.fillRect(0, 0, 256, 64);
        c.fillStyle = '#141030';
        c.beginPath(); c.arc(30, 32, 18, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#ffffff';
        c.beginPath(); c.arc(30, 32, 9, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#141030';
        c.font = '900 40px "Baloo 2", "Nunito", Arial, sans-serif';
        c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillText(word, 58, 34, 190);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      const _shopEdge = new THREE.MeshBasicMaterial({ color: 0x141030 });
      const _shopMats = signCols.map((col, i) => {
        const css = _shopCss(col);
        const face = new THREE.MeshBasicMaterial({ map: shopTex(css, SHOP_WORDS[i]) });
        return [_shopEdge, _shopEdge, _shopEdge, _shopEdge, face, face];
      });
      const s2Rand = rnd(5551);
      const shopProbe = new THREE.Vector3();
      const shopTan = new THREE.Vector3();
      const shopNrm = new THREE.Vector3();
      // FIX 2026-09-04 (shop-sign): row-A fica a 11-19m radial do centroide
      // e o letreiro a 11.5m da normal da pista — 2/12 nasciam DENTRO das
      // torres (sonda GPU pos-fix v1: embedded=true). Desvia ao longo da
      // tangente em passos de 4m (alternando o sentido, ate +/-16m); se
      // nenhum ponto livrar, pula o letreiro (menos letreiro > embutido).
      // Pad 2.0m cobre o corpo (3.4m) + pernas (+/-1.3m).
      const _shopInTower = (qx, qz, pad) => {
        for (const fp of nearTowers) {
          const lx = qx - fp.x, lz = qz - fp.z;
          const c = Math.cos(-fp.yaw), s = Math.sin(-fp.yaw);
          const rx = lx * c - lz * s, rz = lx * s + lz * c;
          if (Math.abs(rx) < fp.hx + pad && Math.abs(rz) < fp.hz + pad) return true;
        }
        return false;
      };
      const _shopLat = CONFIG.track.roadWidth / 2 + 7;
      for (let i = 0; i < 12; i++) {
        const side = s2Rand() < 0.5 ? -1 : 1;
        let sx = 0, sz = 0, found = false;
        for (let attempt = 0; attempt < 9 && !found; attempt++) {
          const step = attempt === 0 ? 0 : ((attempt % 2 === 1 ? 1 : -1) * Math.ceil(attempt / 2) * 4) / len;
          const t = (((i + 0.5) / 12 + step) % 1 + 1) % 1;
          path.getPointAt(t, shopProbe);
          path.getTangentAt(t, shopTan);
          shopNrm.set(-shopTan.z, 0, shopTan.x).normalize();
          const cx = shopProbe.x + shopNrm.x * side * _shopLat;
          const cz = shopProbe.z + shopNrm.z * side * _shopLat;
          if (this._onTrack(cx, cz, 2)) continue;
          if (_shopInTower(cx, cz, 2.0)) continue;
          sx = cx; sz = cz; found = true;
        }
        if (!found) continue;
        const sy = this._gy(sx, sz);
        const cy = sy + 2.6 + s2Rand() * 0.8;
        const sign = new THREE.Mesh(signGeo, _shopMats[(s2Rand() * 4) | 0]);
        // Yaw fold-proof via atan2 da direcao ao centro da pista (NUNCA
        // ler rotation apos lookAt: Euler XYZ folda o yaw real). Mesma
        // altura => lookAt puro yaw => rotation.y direta equivale.
        const _syaw = Math.atan2(shopProbe.x - sx, shopProbe.z - sz);
        sign.position.set(sx, cy, sz);
        sign.rotation.y = _syaw;
        scene.add(sign);
        // Pernas no frame rotacionado: local +X sob rotationY =
        // (cos, 0, -sin). Altura do chao a base do letreiro, por perna.
        const _scos = Math.cos(_syaw);
        const _ssin = Math.sin(_syaw);
        const _sbot = cy - 0.4;
        for (const dx of [-1.3, 1.3]) {
          const px = sx + dx * _scos;
          const pz = sz - dx * _ssin;
          const pgy = this._gy(px, pz);
          const poleH = Math.max(0.5, _sbot - pgy);
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1, 0.18), signLegMat);
          leg.scale.y = poleH;
          leg.position.set(px, pgy + poleH / 2, pz);
          leg.rotation.y = _syaw;
          scene.add(leg);
        }
      }
    }

    // --- LARGE billboards (vision critic: 'no readable signage' — MK8 city
    // tracks have big illuminated ad panels; bars read as fake text) ---
    {
      const bbTex = (bg, fg, accent, word) => {
        const cv = document.createElement('canvas');
        cv.width = 256; cv.height = 128; // AUDIT R25: 128→256 — texto real legível a distância
        const c = cv.getContext('2d');
        // NOTA 2026-09-05: BoxGeometry já mapeia UV por face p/ leitura
        // correta de fora (evidência GPU: canvas pré-espelhado lia ESPELHADO
        // no verso). Mesma textura frente+verso — sem canvas espelhado.
        c.fillStyle = bg; c.fillRect(0, 0, 256, 128);
        // bold logo disc + REAL WORD (critic Neon 7.5/10 'letreiros ilegíveis')
        c.fillStyle = fg;
        c.beginPath(); c.arc(60, 64, 32, 0, Math.PI * 2); c.fill();
        c.fillStyle = accent;
        c.beginPath(); c.arc(60, 64, 16, 0, Math.PI * 2); c.fill();
        c.fillStyle = fg;
        c.font = '900 64px "Baloo 2", "Nunito", Arial, sans-serif'; // AUDIT R25b: 52→64px
        c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillText(word || 'NEON', 110, 52, 140); // maxWidth: NEON 900 64px ≈180px estourava o canvas 256 (lia "NEO")
        c.font = '800 36px "Baloo 2", "Nunito", Arial, sans-serif';
        c.fillText('KART', 110, 96, 140);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      const bbEdgeMat = new THREE.MeshBasicMaterial({ color: 0x141030 });
      const bbMats = [
        new THREE.MeshBasicMaterial({ map: bbTex('#141030', '#ff2ec4', '#fff', 'NEON') }),
        new THREE.MeshBasicMaterial({ map: bbTex('#1a1440', '#2ec4ff', '#fff', 'NEO') }),
        new THREE.MeshBasicMaterial({ map: bbTex('#23103a', '#ffd23c', '#fff', 'KART') }),
      ];
      // AUDIT (city redesign, 2026-08-11): billboards follow the path too
      // (old hardcoded spots sat 10-16m into the infield of the new layout).
      const _bp = new THREE.Vector3();
      const _bt = new THREE.Vector3();
      const _bn = new THREE.Vector3();
      const _cityPath = this._trackPath || (this._track && this._track.path) || (track && track.path);
      const _BB_TS = [0.28, 0.52, 0.82];
      const bbPos = [];
      for (let bi = 0; bi < _BB_TS.length; bi++) {
        const tt = _BB_TS[bi];
        _cityPath.getPointAt(tt, _bp);
        _cityPath.getTangentAt(tt, _bt);
        _bn.set(-_bt.z, 0, _bt.x).normalize();
        const bside = bi % 2 === 0 ? 1 : -1;
        bbPos.push({
          // AUDIT R25d: 11→7m da pista (billboard entra no frame mobile + chase cam)
          p: [_bp.x + _bn.x * bside * (CONFIG.track.roadWidth / 2 + 7), 5.4, _bp.z + _bn.z * bside * (CONFIG.track.roadWidth / 2 + 7)],
          // AUDIT R25c: era Math.PI/3.2 (56°) — texto quase de PERFIL p/
          // câmera. rotation 0 deixa a face +Z paralela à pista (câmera vê a
          // lateral). Agora lookAt o CENTRO da pista (face p/ o jogador).
          look: [_bp.x, 4.5, _bp.z],
          m: bi,
        });
      }
      for (const b of bbPos) {
        // AUDIT R25b: 7→9m largura (texto legível a distância da chase cam)
        const board = new THREE.Mesh(
          new THREE.BoxGeometry(9, 4.4, 0.4),
          [bbEdgeMat, bbEdgeMat, bbEdgeMat, bbEdgeMat, bbMats[b.m], bbMats[b.m]]
        );
        board.position.set(...b.p);
        // AUDIT R25c: lookAt o centro da pista — face frontal visível
        if (b.look) {
          board.lookAt(b.look[0], b.look[1], b.look[2]);
        } else {
          board.rotation.set(...b.r);
        }
        scene.add(board);
        // FIX 2026-09-04 (pole-yaw): os postes flanqueavam o board em
        // eixo-mundo (b.p[0]+dx) mesmo após o lookAt — com yaw ~±90° os
        // postes paravam no CENTRO do board, 3.4m fora do plano
        // (half-thickness 0.2). Yaw fold-proof via atan2 da direção
        // lookAt (NUNCA ler rotation após lookAt: Euler XYZ folda o yaw
        // real). Local +X sob rotationY(yaw) = (cos, 0, -sin).
        // Postes assentados no chão: altura do topo do board ao _gy.
        const _lx = b.look ? b.look[0] - b.p[0] : 0;
        const _lz = b.look ? b.look[2] - b.p[2] : 1;
        const _yawB = Math.atan2(_lx, _lz);
        const _cosB = Math.cos(_yawB);
        const _sinB = Math.sin(_yawB);
        const _topY = b.p[1] + 2.2; // borda superior do board (9×4.4)
        const poleMat2 = toonMaterial(0x3a4152, {});
        for (const dx of [-3.4, 3.4]) {
          const px = b.p[0] + dx * _cosB;
          const pz = b.p[2] - dx * _sinB;
          const pgy = this._gy(px, pz);
          const poleH = Math.max(0.5, _topY - pgy);
          const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1, 0.25), poleMat2);
          pole.scale.y = poleH;
          pole.position.set(px, pgy + poleH / 2, pz);
          pole.rotation.y = _yawB;
          scene.add(pole);
        }
      }
    }

    // --- construction cranes (AUDIT set dressing: distinctive city
    // silhouettes — the critic asked for rooftop machinery/cranes) ---
    {
      const craneMat = toonMaterial(0xd24a2a, {}); // safety-orange boom
      const craneDark = toonMaterial(0x2a2d38, {});
      // AUDIT (city redesign, 2026-08-11): cranes follow the path (old spots
      // landed 22m from the new road / in the void).
      const _cp = new THREE.Vector3();
      const _ct = new THREE.Vector3();
      const _cn = new THREE.Vector3();
      const _cityPath = this._trackPath || (this._track && this._track.path) || (track && track.path);
      const _CRANE_TS = [0.06, 0.46];
      const craneSpots = [];
      for (let ci = 0; ci < _CRANE_TS.length; ci++) {
        const tt = _CRANE_TS[ci];
        _cityPath.getPointAt(tt, _cp);
        _cityPath.getTangentAt(tt, _ct);
        _cn.set(-_ct.z, 0, _ct.x).normalize();
        const cside = ci % 2 === 0 ? 1 : -1;
        craneSpots.push({ p: [_cp.x + _cn.x * cside * 26, 0, _cp.z + _cn.z * cside * 26], ry: cside * 0.5 });
      }
      for (const cs of craneSpots) {
        const gy = this._gy(cs.p[0], cs.p[2]);
        const mast = new THREE.Mesh(new THREE.BoxGeometry(0.8, 26, 0.8), craneDark);
        mast.position.set(cs.p[0], gy + 13, cs.p[2]);
        mast.rotation.y = cs.ry;
        mast.castShadow = true;
        scene.add(mast);
        const boom = new THREE.Mesh(new THREE.BoxGeometry(18, 0.7, 0.7), craneMat);
        boom.position.set(cs.p[0] + Math.cos(cs.ry) * 8, gy + 24.5, cs.p[2] + Math.sin(cs.ry) * 8);
        boom.rotation.y = cs.ry;
        boom.castShadow = true;
        scene.add(boom);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.2), craneMat);
        cab.position.set(cs.p[0], gy + 23.4, cs.p[2]);
        cab.rotation.y = cs.ry;
        scene.add(cab);
        const line = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6, 3), craneDark);
        line.position.set(cs.p[0] + Math.cos(cs.ry) * 13, gy + 21.5, cs.p[2] + Math.sin(cs.ry) * 13);
        scene.add(line);
      }
    }

    // --- carros estacionados (AUDIT AAA 2026-08-15): a faixa 9-16m entre a
    // calçada e a fileira A lia VAZIA. 14 sedans nas retas, paralelos à pista
    // (halfW+8.5..11), com disco de contato. Unlit (MeshBasic) p/ cor pura.
    // AUDIT R12 (crítico cego: 'carros não se distinguem claramente'): a
    // paleta cinza/marrom sumia contra o asfalto escuro. Cores VIVAS de
    // taxi noturno MK8 (vermelho/amarelo/ciano/magenta/mint/laranja).
    {
      const _cp = new THREE.Vector3();
      const _ct = new THREE.Vector3();
      const _cn = new THREE.Vector3();
      const ct2 = new THREE.Vector3();
      const _cityPath = this._trackPath || (this._track && this._track.path) || (track && track.path);
      const carBodyGeo = new THREE.BoxGeometry(1.9, 0.85, 4.0);
      const carCabinGeo = new THREE.BoxGeometry(1.7, 0.7, 2.1);
      const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10);
      const bodyMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      // TICK28 (crítico cego: cabine = 'tijolo preto' sólido): a cabine vira
      // VIDRO azul-aço (#39586e, unlit) + teto fino na cor da carroceria —
      // separação vidro/teto quebra a leitura de bloco chapado.
      const cabinMat = new THREE.MeshBasicMaterial({ color: 0x39586e });
      const roofGeo = new THREE.BoxGeometry(1.74, 0.16, 2.14);
      const roofMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const wheelMat = new THREE.MeshBasicMaterial({ color: 0x14161c });
      // AUDIT R12: paleta viva de taxi noturno (antes cinza apagado)
      // AUDIT R21d: 0xffd23c FORA — o reflexo wet ADITIVO do carro amarelo
      // criava uma poça OLIVA GIGANTE no chão (a mancha da esquerda).
      const carCols = [0xff2e4d, 0x2ec4ff, 0xff2ec4, 0x3cff9a, 0xff9a3c, 0x8a5cff];
      const { geo: aoGeo, mat: aoMat } = getAODiscParts();
      const carN = 22; // AUDIT R12: 14 → 22 (~1 a cada 15-28m de reta)
      const bodies = new THREE.InstancedMesh(carBodyGeo, bodyMat, carN);
      const cabins = new THREE.InstancedMesh(carCabinGeo, cabinMat, carN);
      const roofs = new THREE.InstancedMesh(roofGeo, roofMat, carN);
      const wheels = new THREE.InstancedMesh(wheelGeo, wheelMat, carN * 4);
      const aoDiscs = new THREE.InstancedMesh(aoGeo, aoMat, carN);
      // AUDIT R12: faróis (2/carro, branco-quente) + lanternas (2/carro,
      // vermelho) emissivos — luzes acesas, cue noturno MK8.
      const lightGeo = new THREE.BoxGeometry(0.14, 0.07, 0.04);
      const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0, toneMapped: false });
      const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false });
      const headLights = new THREE.InstancedMesh(lightGeo, headMat, carN * 2);
      const tailLights = new THREE.InstancedMesh(lightGeo, tailMat, carN * 2);
      // AUDIT R12 (reflexo): os carros estão FORA da ribbon wet (cobre só o
      // asfalto) e hoje não refletem nada na rua molhada. Elipse ADITIVA cor
      // da carroceria sob cada carro (smear wet-street MK8).
      // AUDIT R21d: opacity 0.24→0.10 — o smear aditivo de carros laranja
      // (0xff9a3c) criava POÇAS OLIVA GIGANTES no concreto (a mancha do
      // infield). Reflexo sutil, não poça de tinta.
      const carReflGeo = new THREE.PlaneGeometry(2.6, 5.4);
      const carReflMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.1,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false,
      });
      const carRefls = new THREE.InstancedMesh(carReflGeo, carReflMat, carN);
      const cd = new THREE.Object3D();
      const col = new THREE.Color();
      const carRand = rnd(6666);
      let carIdx = 0;
      for (let i = 0; i < 160; i++) {
        const tt = (i + 0.5) / 160;
        _cityPath.getTangentAt(tt, _ct);
        _cityPath.getTangentAt(Math.min(0.999, tt + 1 / 160), ct2);
        if (1 - Math.min(1, Math.max(-1, _ct.dot(ct2))) > 0.0012) continue; // retas
        _cityPath.getPointAt(tt, _cp);
        _cn.set(-_ct.z, 0, _ct.x).normalize();
        const side = carIdx % 2 === 0 ? 1 : -1;
        // AUDIT FIX R12h (Feco real-GPU: 'carro atravessando o guardrail'
        // — persiste): o gate _onTrack usa amostras ~2.5m e em curva fechada
        // um carro a 14m perpendicular pode ter a amostra mais próxima a
        // ~10m → passava. Fix duplo: (a) margem 6.5 (>11.1m do path — bem
        // além do rail em 5.05m); (b) só coloca carro em trechos de BAIXA
        // curvatura (a distância perpendicular ≈ distância real ao path em
        // retas; em curvas o offset lateral NÃO garante distância ao rail).
        const off = CONFIG.track.roadWidth / 2 + 9.5 + carRand() * 1.5;
        const px = _cp.x + _cn.x * side * off;
        const pz = _cp.z + _cn.z * side * off;
        if (this._onTrack(px, pz, 6.5) || inWater(px, pz, 3)) continue;
        // (b) curvatura local no spot — retas quase retas, nada de curvas.
        const ta = _cityPath.getTangentAt(Math.max(0.001, tt - 0.75 / _cityPath.getLength()));
        const tb = _cityPath.getTangentAt(Math.min(0.999, tt + 0.75 / _cityPath.getLength()));
        const curv = 1 - Math.min(1, Math.max(-1, ta.dot(tb)));
        if (curv > 0.0012) continue; // mesma régua das retas (sponsor boards)
        const gy = this._gy(px, pz);
        const yaw = Math.atan2(_ct.x, _ct.z);
        const s = 0.9 + carRand() * 0.25;
        cd.position.set(px, gy + 0.43, pz);
        cd.rotation.set(0, yaw, 0);
        cd.scale.set(s, 1, s);
        cd.updateMatrix();
        bodies.setMatrixAt(carIdx, cd.matrix);
        col.setHex(carCols[(carIdx * 7) % carCols.length]);
        bodies.setColorAt(carIdx, col);
        cd.position.set(px, gy + 0.85, pz);
        cd.rotation.set(0, yaw, 0);
        cd.scale.set(s, 1, s);
        cd.updateMatrix();
        cabins.setMatrixAt(carIdx, cd.matrix);
        // TICK28: teto fino na cor da carroceria sobre o vidro (cabin top =
        // 0.85+0.35=1.2 → teto centrado em 1.28).
        cd.position.set(px, gy + 1.28, pz);
        cd.rotation.set(0, yaw, 0);
        cd.scale.set(s, 1, s);
        cd.updateMatrix();
        roofs.setMatrixAt(carIdx, cd.matrix);
        roofs.setColorAt(carIdx, col);
        for (let w = 0; w < 4; w++) {
          const lx = (w % 2 === 0 ? -1 : 1) * 1.25; // lateral no frame do carro
          const lz = (w < 2 ? -1 : 1) * 1.35;       // longitudinal
          const wx = px + Math.cos(yaw) * lx + Math.sin(yaw) * lz;
          const wz = pz - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
          cd.position.set(wx, gy + 0.32, wz);
          cd.rotation.set(0, yaw, -Math.PI / 2); // eixo Y do cilindro -> lateral do carro
          cd.scale.set(1, 1, 1);
          cd.updateMatrix();
          wheels.setMatrixAt(carIdx * 4 + w, cd.matrix);
        }
        cd.position.set(px, gy + 0.04, pz);
        cd.rotation.set(-Math.PI / 2, 0, 0);
        cd.scale.set(3.2, 4.6, 1); // elipse no chão (pegada do carro)
        cd.updateMatrix();
        aoDiscs.setMatrixAt(carIdx, cd.matrix);
        // Faróis na frente (+z local do carro) e lanternas atrás (-z).
        const lzF = 2.0;
        for (const lr of [-1, 1]) {
          const hx = px + Math.cos(yaw) * lr * 0.75 + Math.sin(yaw) * lzF;
          const hz = pz - Math.sin(yaw) * lr * 0.75 + Math.cos(yaw) * lzF;
          cd.position.set(hx, gy + 0.62, hz);
          cd.rotation.set(0, yaw, 0);
          cd.scale.set(1, 1, 1);
          cd.updateMatrix();
          headLights.setMatrixAt(carIdx * 2 + (lr === -1 ? 0 : 1), cd.matrix);
          const tx2 = px + Math.cos(yaw) * lr * 0.75 - Math.sin(yaw) * lzF;
          const tz2 = pz - Math.sin(yaw) * lr * 0.75 - Math.cos(yaw) * lzF;
          cd.position.set(tx2, gy + 0.62, tz2);
          cd.rotation.set(0, yaw, 0);
          cd.scale.set(1, 1, 1);
          cd.updateMatrix();
          tailLights.setMatrixAt(carIdx * 2 + (lr === -1 ? 0 : 1), cd.matrix);
        }
        // Reflexo wet: elipse aditiva cor da carroceria, deitada na tangente.
        cd.position.set(px, gy + 0.05, pz);
        cd.rotation.set(-Math.PI / 2, 0, -yaw);
        cd.scale.set(s, s, 1);
        cd.updateMatrix();
        carRefls.setMatrixAt(carIdx, cd.matrix);
        carRefls.setColorAt(carIdx, col);
        carIdx++;
        if (carIdx >= carN) break;
      }
      if (carIdx > 0) {
        bodies.count = carIdx; cabins.count = carIdx; roofs.count = carIdx; wheels.count = carIdx * 4; aoDiscs.count = carIdx;
        headLights.count = carIdx * 2; tailLights.count = carIdx * 2; carRefls.count = carIdx;
        bodies.instanceMatrix.needsUpdate = true;
        if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
        cabins.instanceMatrix.needsUpdate = true;
        roofs.instanceMatrix.needsUpdate = true;
        if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
        wheels.instanceMatrix.needsUpdate = true;
        aoDiscs.instanceMatrix.needsUpdate = true;
        headLights.instanceMatrix.needsUpdate = true;
        tailLights.instanceMatrix.needsUpdate = true;
        carRefls.instanceMatrix.needsUpdate = true;
        if (carRefls.instanceColor) carRefls.instanceColor.needsUpdate = true;
        scene.add(bodies, cabins, roofs, wheels, aoDiscs, headLights, tailLights, carRefls);
      }
    }

    // --- neon point lights: pink + cyan LIGHTS near the road so the
    // pavement actually receives colored bounce (vision critic: neon was
    // only emissive strips, never illuminating anything) ---
    {
      // AUDIT (city redesign, 2026-08-11): the hardcoded old-city light
      // positions put lamps DEAD CENTER on the new start straight (0.0m) and
      // ON the asphalt, plus 4 lights in the void (old layout ran to z~118).
      // Lights are now placed ALONG THE PATH (t-sampled, lateral offset) so
      // they follow every current/future city layout: 8 lamps alternating
      // pink/cyan around the circuit, ~5.5m outside the kerb.
      const _lp = new THREE.Vector3();
      const _lt = new THREE.Vector3();
      const _ln = new THREE.Vector3();
      const _cityPath = this._trackPath || (this._track && this._track.path) || (track && track.path);
      const _LIGHT_TS = [0.03, 0.14, 0.26, 0.40, 0.52, 0.64, 0.76, 0.90];
      const neonLights = [];
      for (let li = 0; li < _LIGHT_TS.length; li++) {
        const tt = _LIGHT_TS[li];
        _cityPath.getPointAt(tt, _lp);
        _cityPath.getTangentAt(tt, _lt);
        _ln.set(-_lt.z, 0, _lt.x).normalize();
        const lside = li % 2 === 0 ? 1 : -1;
        neonLights.push({
          color: li % 2 === 0 ? 0xff2ec4 : 0x2ec4ff,
          pos: [_lp.x + _ln.x * lside * (CONFIG.track.roadWidth / 2 + 5.5), 4.2, _lp.z + _ln.z * lside * (CONFIG.track.roadWidth / 2 + 5.5)],
        });
      }
      for (const nl of neonLights) {
        const pl = new THREE.PointLight(nl.color, 3.0, 66, 1.4); // AUDIT: spill onto karts/road (critic: color reads but never lands on geometry)
        pl.position.set(...nl.pos);
        scene.add(pl);
        // AUDIT MED: every light needs a visible FIXTURE — a glowing lamp
        // pole so the light comes from something, not empty air.
        const lamp = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.12, 3.4, 6),
          new THREE.MeshBasicMaterial({ color: nl.color })
        );
        lamp.position.set(nl.pos[0], 1.7, nl.pos[2]);
        scene.add(lamp);
      }

      // --- piscinas de luz neon NA PISTA (AUDIT AAA 2026-08-15): o reflexo wet
      // existia, mas a luz dos postes não pousava no asfalto. Pools aditivos
      // projetados sob cada lâmpada (mesmos ts/lado), 1 InstancedMesh.
      // AUDIT PISTA R11 (2026-08-16): poça MK8 — elipse elongada (2.8 x 7.2m,
      // canvas 128x256) com núcleo QUENTE (alpha 0.95), halo colorido e o
      // STREAK especular horizontal da lâmpada (cue clássico de rua molhada).
      {
        const poolCv = document.createElement('canvas');
        poolCv.width = 128; poolCv.height = 256;
        const pg = poolCv.getContext('2d');
        const grad = pg.createRadialGradient(64, 128, 2, 64, 128, 120);
        // AUDIT R21i: núcleo 0.95→0.5 — pools aditivos fortes + bloom + warm
        // grade pintavam manchas oliva no chão (a faixa horizontal central).
        grad.addColorStop(0, 'rgba(255,255,255,0.5)');
        grad.addColorStop(0.16, 'rgba(255,255,255,0.3)');
        grad.addColorStop(0.45, 'rgba(255,255,255,0.12)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        pg.fillStyle = grad;
        // compressão vertical: elipse alongada no comprimento da pista
        pg.save();
        pg.translate(64, 128);
        pg.scale(1, 0.38);
        pg.translate(-64, -128);
        pg.fillRect(0, 0, 128, 256);
        pg.restore();
        // streak especular horizontal da lâmpada (meio da poça)
        const sg = pg.createLinearGradient(0, 116, 0, 140);
        sg.addColorStop(0, 'rgba(255,255,255,0)');
        sg.addColorStop(0.5, 'rgba(255,255,255,0.9)');
        sg.addColorStop(1, 'rgba(255,255,255,0)');
        pg.fillStyle = sg;
        pg.fillRect(8, 116, 112, 24);
        // smear vertical do poste refletido na água (acima do streak)
        pg.fillStyle = 'rgba(255,255,255,0.35)';
        pg.fillRect(56, 48, 16, 60);
        const poolTex = new THREE.CanvasTexture(poolCv);
        const poolGeo = new THREE.PlaneGeometry(2.8, 7.2);
        const poolMat = new THREE.MeshBasicMaterial({
          map: poolTex, transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide,
        });
        poolMat.toneMapped = false;
        const POOL_TS = [0.03, 0.14, 0.26, 0.40, 0.52, 0.64, 0.76, 0.90];
        const poolDummy = new THREE.Object3D();
        const _pp = new THREE.Vector3();
        const _pt = new THREE.Vector3();
        const _pn = new THREE.Vector3();
        const _cityPath = this._trackPath || (this._track && this._track.path) || (track && track.path);
        const pools = new THREE.InstancedMesh(poolGeo, poolMat, POOL_TS.length);
        pools.renderOrder = 4; // acima do reflexo wet (renderOrder 3, y 0.195)
        pools.frustumCulled = false;
        const poolCol = new THREE.Color();
        const poolJitter = rnd(4521); // AUDIT R11: variação determinística de tamanho
        let poolIdx = 0;
        for (let li = 0; li < POOL_TS.length; li++) {
          const tt = POOL_TS[li];
          _cityPath.getPointAt(tt, _pp);
          _cityPath.getTangentAt(tt, _pt);
          _pn.set(-_pt.z, 0, _pt.x).normalize();
          const lside = li % 2 === 0 ? 1 : -1;
          const px = _pp.x + _pn.x * lside * (CONFIG.track.roadWidth / 2 - 1.2);
          const pz = _pp.z + _pn.z * lside * (CONFIG.track.roadWidth / 2 - 1.2);
          poolDummy.position.set(px, _pp.y + 0.197, pz); // 2mm acima do wet reflect (0.195)
          poolDummy.lookAt(px + _pt.x, _pp.y, pz + _pt.z);
          poolDummy.rotateX(-Math.PI / 2); // deitado (padrão lane dashes)
          const jit = 0.75 + poolJitter() * 0.5; // AUDIT R11: 0.75-1.25x
          poolDummy.scale.set(jit, 1, jit);
          poolDummy.updateMatrix();
          pools.setMatrixAt(poolIdx, poolDummy.matrix);
          poolCol.setHex(li % 2 === 0 ? 0xff2ec4 : 0x2ec4ff); // casa com as lâmpadas
          pools.setColorAt(poolIdx, poolCol);
          poolIdx++;
        }
        pools.count = poolIdx;
        pools.instanceMatrix.needsUpdate = true;
        if (pools.instanceColor) pools.instanceColor.needsUpdate = true;
        scene.add(pools);
      }
    }

    // --- neon street signs (vision critic: 'street-level detail' — small
    // glowing billboards on poles along the sidewalks, every ~60m) ---
    const poleMat = toonMaterial(0x3a4152, {});
    // Sign textures with a REAL word per color (tick 26: the fake 2-line
    // bars read as placeholder slabs in close-up chase frames — same class
    // already fixed on shop signs in tick 23). Portrait 128x192 canvas for
    // the 1.4x2.4 board: frame + logo disc + word + sub-line.
    const signTex = (bg, fg, accent, word, sub) => {
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 192;
      const c = cv.getContext('2d');
      c.fillStyle = bg; c.fillRect(0, 0, 128, 192);
      c.strokeStyle = fg; c.lineWidth = 6;
      c.strokeRect(5, 5, 118, 182);
      c.fillStyle = fg;
      c.beginPath(); c.arc(64, 48, 22, 0, Math.PI * 2); c.fill();
      c.fillStyle = accent;
      c.beginPath(); c.arc(64, 48, 11, 0, Math.PI * 2); c.fill();
      c.fillStyle = fg;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 26px "Baloo 2", "Nunito", Arial, sans-serif';
      c.fillText(word, 64, 106, 112);
      c.font = '800 20px "Baloo 2", "Nunito", Arial, sans-serif';
      c.fillText(sub, 64, 140, 112);
      c.fillStyle = accent; c.fillRect(34, 158, 60, 8);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const signEdgeMat = new THREE.MeshBasicMaterial({ color: 0x141030 });
    const signMats = [
      [signEdgeMat, signEdgeMat, signEdgeMat, signEdgeMat,
        new THREE.MeshBasicMaterial({ map: signTex('#ff2ec4', '#ffffff', '#2ec4ff', 'TURBO', 'GP') }),
        new THREE.MeshBasicMaterial({ map: signTex('#ff2ec4', '#ffffff', '#2ec4ff', 'TURBO', 'GP') })],
      [signEdgeMat, signEdgeMat, signEdgeMat, signEdgeMat,
        new THREE.MeshBasicMaterial({ map: signTex('#2ec4ff', '#141030', '#ff2ec4', 'NITRO', 'GP') }),
        new THREE.MeshBasicMaterial({ map: signTex('#2ec4ff', '#141030', '#ff2ec4', 'NITRO', 'GP') })],
      [signEdgeMat, signEdgeMat, signEdgeMat, signEdgeMat,
        new THREE.MeshBasicMaterial({ map: signTex('#ffd23c', '#141030', '#ff2ec4', 'APEX', 'GP') }),
        new THREE.MeshBasicMaterial({ map: signTex('#ffd23c', '#141030', '#ff2ec4', 'APEX', 'GP') })],
    ];
    const sRand = rnd(9917);
    const signProbe = new THREE.Vector3();
    const signTan = new THREE.Vector3();
    const signNrm = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      const t = (i + 0.5) / 24;
      path.getPointAt(t, signProbe);
      path.getTangentAt(t, signTan);
      signNrm.set(-signTan.z, 0, signTan.x).normalize();
      const side = sRand() < 0.5 ? -1 : 1;
      const sx = signProbe.x + signNrm.x * side * (5.6 + sRand() * 2);
      const sz = signProbe.z + signNrm.z * side * (5.6 + sRand() * 2);
      if (this._onTrack(sx, sz, 1.2)) continue;
      const sy = this._gy(sx, sz);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.1, 0.14), poleMat);
      pole.position.set(sx, sy + 1.55, sz);
      pole.castShadow = true;
      scene.add(pole);
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 2.4, 0.12),
        signMats[(sRand() * 3) | 0]
      );
      sign.position.set(sx, sy + 3.4, sz);
      scene.add(sign);
    }
  }

  /**
   * NEON CITY light poles: glowing pink/cyan neon strips instead of day
   * poles — thin 0.1x4x0.1 emissive boxes every ~40m along the straights,
   * both road sides at roadW/2 + 2.0 (6.5m from centerline; clears the road
   * by 2m — beyond the 6.0m minimum). Emissive intensity 2 makes the strips
   * read as lit neon tubes even under the dim moonlight.
   */
  buildNeonPoles(scene, track) {
    const path = track.path;
    const len = path.getLength();
    const halfW = CONFIG.track.roadWidth / 2;
    const stripGeo = new THREE.BoxGeometry(0.1, 4, 0.1);
    const pinkMat = toonMaterial(0x0e1220, { emissive: 0xff2ec4, emissiveIntensity: 2 });
    const cyanMat = toonMaterial(0x0e1220, { emissive: 0x2ec4ff, emissiveIntensity: 2 });
    // AUDIT R12: 24 → 40 (postes a cada 22m — densidade de avenida MK8)
    const pink = new THREE.InstancedMesh(stripGeo, pinkMat, 40);
    const cyan = new THREE.InstancedMesh(stripGeo, cyanMat, 40);
    const dummy = new THREE.Object3D();
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const tan2 = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    let pinkIdx = 0;
    let cyanIdx = 0;
    const n = Math.max(10, Math.round(len / 22)); // AUDIT R12: 40 → 22m
    for (let i = 0; i < n; i++) {
      const t = i / n;
      path.getTangentAt(t, tan);
      path.getTangentAt(Math.min(0.999, t + 1 / n), tan2);
      const curv = 1 - Math.min(1, Math.max(-1, tan.dot(tan2)));
      if (curv > 0.0016) continue; // straights only (same gate as corner signs)
      path.getPointAt(t, p);
      nrm.set(-tan.z, 0, tan.x).normalize();
      for (const side of [-1, 1]) {
        const off = halfW + 2.0; // roadW/2 + 2.0
        const x = p.x + nrm.x * side * off;
        const z = p.z + nrm.z * side * off;
        dummy.position.set(x, p.y + 2, z); // 4m strip centered 2m up
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        const toPink = (i + (side === 1 ? 1 : 0)) % 2 === 0;
        const target = toPink ? pink : cyan;
        const idx = toPink ? pinkIdx++ : cyanIdx++;
        if (idx >= target.count) continue;
        target.setMatrixAt(idx, dummy.matrix);
      }
    }
    if (pinkIdx) {
      pink.count = pinkIdx;
      pink.instanceMatrix.needsUpdate = true;
      scene.add(pink);
    }
    if (cyanIdx) {
      cyan.count = cyanIdx;
      cyan.instanceMatrix.needsUpdate = true;
      scene.add(cyan);
    }
  }

  /**
   * AUDIT R12 (densidade urbana — crítico cego Neon 7/10 'cenário arcade'):
   * street furniture MK8 na faixa morta entre o guard-rail (halfW+0.6) e a
   * calçada (7.2m): 14 hidrantes vermelhos (1 InstancedMesh) + 5 semáforos
   * (haste + cabeçote com 3 discos emissivos vermelho/amarelo/verde TODOS
   * acesos — noite de cidade real). rnd() LOCAL — não toca this._rand().
   */
  buildStreetFurniture(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const len = path.getLength();
    const halfW = CONFIG.track.roadWidth / 2;
    const tan = new THREE.Vector3();
    const tan2 = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const dummy = new THREE.Object3D();

    // --- hidrantes: cilindro vermelho (unlit — noite), ~1 a cada 45m de reta
    const hydGeo = new THREE.CylinderGeometry(0.13, 0.17, 0.55, 8);
    const hydMat = new THREE.MeshBasicMaterial({ color: 0xd32f2f, toneMapped: false });
    const hydN = 14;
    const hydrants = new THREE.InstancedMesh(hydGeo, hydMat, hydN);
    let hydIdx = 0;
    for (let i = 0; i < 160 && hydIdx < hydN; i++) {
      const t = (i + 0.5) / 160;
      path.getTangentAt(t, tan);
      path.getTangentAt(Math.min(0.999, t + 1 / 160), tan2);
      if (1 - Math.min(1, Math.max(-1, tan.dot(tan2))) > 0.0012) continue; // retas
      path.getPointAt(t, p);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const side = hydIdx % 2 === 0 ? 1 : -1;
      const off = halfW + 2.8;
      const hx = p.x + nrm.x * side * off;
      const hz = p.z + nrm.z * side * off;
      if (this._onTrack(hx, hz, 3) || inWater(hx, hz, 3)) continue;
      const gy = this._gy(hx, hz);
      dummy.position.set(hx, gy + 0.275, hz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      hydrants.setMatrixAt(hydIdx, dummy.matrix);
      hydIdx++;
    }
    if (hydIdx > 0) {
      hydrants.count = hydIdx;
      hydrants.instanceMatrix.needsUpdate = true;
      scene.add(hydrants);
    }

    // --- semáforos: haste + cabeçote com 3 discos emissivos (vermelho/
    // amarelo/verde TODOS acesos — noite de cidade), 5 cruzamentos
    const TL_TS = [0.10, 0.24, 0.42, 0.62, 0.82];
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.07, 3.4, 8);
    const poleMat = toonMaterial(0x2a3140, {});
    const headGeo = new THREE.BoxGeometry(0.42, 1.05, 0.18);
    const headMat = toonMaterial(0x1b2028, {});
    const discGeo = new THREE.CircleGeometry(0.11, 12);
    const discMats = {
      r: new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false }),
      y: new THREE.MeshBasicMaterial({ color: 0xffd23c, toneMapped: false }),
      g: new THREE.MeshBasicMaterial({ color: 0x3cff9a, toneMapped: false }),
    };
    for (let li = 0; li < TL_TS.length; li++) {
      const t = TL_TS[li];
      path.getPointAt(t, p);
      path.getTangentAt(t, tan);
      nrm.set(-tan.z, 0, tan.x).normalize();
      const side = li % 2 === 0 ? 1 : -1;
      const off = halfW + 2.2;
      const sx = p.x + nrm.x * side * off;
      const sz = p.z + nrm.z * side * off;
      const gy = this._gy(sx, sz);
      const grp = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 1.7;
      grp.add(pole);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 3.55;
      grp.add(head);
      const seq = [
        { m: discMats.r, y: 3.85 },
        { m: discMats.y, y: 3.55 },
        { m: discMats.g, y: 3.25 },
      ];
      for (const d of seq) {
        const disc = new THREE.Mesh(discGeo, d.m);
        disc.position.set(0, d.y, 0.1);
        disc.rotation.y = Math.PI; // face a pista
        grp.add(disc);
      }
      grp.position.set(sx, gy, sz);
      grp.rotation.y = Math.atan2(tan.x, tan.z) + Math.PI / 2;
      scene.add(grp);
    }
  }

  /**
   * Corner warning signs (pole + arrow panel) on the outside of the sharpest
   * corners — real race-track signage, part of the MK8 dressing density bar.
   */
  buildCornerSigns(scene, track) {
    if (!track || !track.path) return;
    const path = track.path;
    const halfW = CONFIG.track.roadWidth / 2;
    // Sign panel texture: white with a bold black directional arrow.
    const texKey = 'corner_sign';
    if (!this._signTex) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 96;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 128, 96);
      g.strokeStyle = '#1b2a41';
      g.lineWidth = 8;
      g.strokeRect(4, 4, 120, 88);
      g.fillStyle = '#1b2a41';
      // bold arrow pointing right (curve direction)
      g.beginPath();
      g.moveTo(30, 18); g.lineTo(100, 48); g.lineTo(30, 78); g.lineTo(30, 58); g.lineTo(14, 58); g.lineTo(14, 38); g.lineTo(30, 38);
      g.closePath();
      g.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this._signTex = tex;
    }
    const signMat = new THREE.MeshBasicMaterial({ map: this._signTex, color: 0xffffff, side: THREE.DoubleSide });
    const poleMat = toonMaterial(0x8b7a5c, {});
    const tan = new THREE.Vector3();
    const tan2 = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    let lastT = -1;
    let made = 0;
    for (let i = 0; i < 160; i++) {
      const t = i / 160;
      path.getTangentAt(t, tan);
      path.getTangentAt(Math.min(0.999, t + 1 / 160), tan2);
      const curv = 1 - Math.min(1, Math.max(-1, tan.dot(tan2)));
      if (curv > 0.0016 && t - lastT > 0.08) {
        lastT = t;
        path.getPointAt(t, p);
        nrm.set(-tan.z, 0, tan.x).normalize();
        // Two signs per corner: inside + outside edge (bigger + closer —
        // auditor: signs were too small to read at race distance).
        for (const side of [-1, 1]) {
          const px = p.x + nrm.x * (side * (halfW + 2.2));
          const pz = p.z + nrm.z * (side * (halfW + 2.2));
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 8), poleMat);
          pole.position.set(px, p.y + 1.1, pz);
          scene.add(pole);
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.05), signMat);
          panel.position.set(px, p.y + 2.5, pz);
          panel.lookAt(p.x, p.y + 2.5, p.z); // face the track
          // AUDIT R72 (Feco real-GPU 2026-08-14: 'placas apontando caminho
          // INVERSO'): com lookAt + up padrão, o +X local do painel =
          // -side*tan — no lado +1 a seta (que aponta +X na textura) ficava
          // CONTRA o fluxo. Girar 180° no lado +1 alinha com a tangente.
          panel.rotation.z = side === 1 ? Math.PI : 0;
          scene.add(panel);
          made++;
        }
      }
    }
    // Track created panels for the cheering/bounce update? no — static props.
    this._signCount = made;
  }

  buildFlags(scene) {
    // Strings of small triangular flags along the start-straight grass
    // corridor — two lines now (the original short one + a second long line
    // extending the same decoration east). USER FIX: the old posts at
    // z=-58 sat ~1m from the centerline (ON the asphalt) — both strings are
    // moved to z=-65, 8m+ off the road (rail at halfW+1.1), and every post
    // is _onTrack-guarded. All geometry is grounded on terrainHeight.
    const flagMat = toonMaterial(0xffd166, {});
    const flagMat2 = toonMaterial(0x2ec4ff, {});
    const postGeo = new THREE.CylinderGeometry(0.06, 0.09, 9, 8);
    const postMat = toonMaterial(0x8b7a5c, {});
    const strings = [
      { x0: -11, x1: 23, z: -65, flags: 11 },
      { x0: 30, x1: 64, z: -65, flags: 11 },
    ];
    for (const s of strings) {
      const posts = [[s.x0, s.z], [s.x1, s.z]];
      let skipped = false;
      for (const [px, pz] of posts) {
        if (this._onTrack(px, pz, 1.5)) { skipped = true; break; }
      }
      if (skipped) continue; // never erect pennant posts on the road
      for (const [px, pz] of posts) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(px, this._gy(px, pz) + 4.5, pz);
        scene.add(post);
      }
      const span = s.x1 - s.x0;
      const rope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, span + 0.5, 6),
        toonMaterial(0x8b7a5c, {})
      );
      rope.position.set((s.x0 + s.x1) / 2, this._gy((s.x0 + s.x1) / 2, s.z) + 9, s.z);
      rope.rotation.x = Math.PI / 2;
      scene.add(rope);

      for (let i = 0; i < s.flags; i++) {
        const fx = s.x0 + (span / (s.flags - 1)) * i;
        const flag = new THREE.Mesh(
          new THREE.ConeGeometry(0.46, 0.95, 3),
          i % 2 === 0 ? flagMat : flagMat2
        );
        flag.position.set(fx, this._gy(fx, s.z) + 9.3, s.z);
        flag.userData.baseRot = 0;
        scene.add(flag);
        this.flagMeshes.push(flag);
      }
    }
  }

  update(dt, t) {
    // Clouds drift along X, wrapping around a radius.
    for (const c of this.clouds) {
      const r = c.userData.radius;
      c.position.x = c.userData.baseX + Math.sin(t * c.userData.speed * 0.1) * r;
      c.position.z += Math.cos(t * c.userData.speed * 0.07) * dt * 1.2;
      // AUDIT r7: keep the cloud's shadow patch pinned to the terrain below.
      const blob = c.userData.shadowBlob;
      if (blob && this._gy) blob.position.y = this._gy(c.position.x, c.position.z) - c.position.y;
    }
    // Hot-air balloons bob gently.
    for (const b of this.balloons || []) {
      b.position.y = b.userData.baseY + Math.sin(t * b.userData.speed + b.userData.phase) * 1.6;
      b.rotation.y += dt * 0.02;
    }
    // Windmill blades turn lazily in the breeze.
    for (const r of this.windmillRotors || []) {
      r.rotation.z += dt * 1.5;
    }
    // Water shimmer: bob + opacity pulse + hue-hold brightness pulse and a
    // glow pulse on the emissive, so the surface reads as LIVE water (the
    // old code only moved the plane — the cyan stayed static and flat).
    for (const w of this.waterMeshes) {
      const ph = w.userData.phase || 0;
      const bob = Math.sin(t * 1.4 + ph);
      w.position.y = w.userData.baseY + bob * 0.08;
      w.material.opacity = 0.78 + Math.sin(t * 1.1 + ph) * 0.06;
      const shim = 0.5 + 0.5 * Math.sin(t * 1.7 + ph * 2);
      if (w.userData.baseColor !== undefined && w.material.color) {
        w.material.color.setHex(w.userData.baseColor);
        w.material.color.offsetHSL(0, 0, (shim - 0.5) * 0.06);
      }
      if (w.material.emissive) w.material.emissiveIntensity = 0.3 + shim * 0.35;
    }
    if (this.neonGridMat) this.neonGridMat.uniforms.uTime.value = t;
    // Flags wave
    for (let i = 0; i < this.flagMeshes.length; i++) {
      const f = this.flagMeshes[i];
      f.rotation.z = Math.sin(t * 5 + i * 0.7) * 0.28;
    }
    // Crowd cheer bounce (Y wave across the grandstands).
    // AUDIT (Feco, 2026-08-11): 'a velocidade que o público pula está meio
    // lenta, não natural como um humano' — the old sine ran at t*3.2 rad/s =
    // 0.51 Hz, i.e. ONE jump every ~2s (a float, not a jump). A natural
    // human cheer jump is ~1.7-2.5 Hz (~0.4-0.55s per cycle). Now 12.6 rad/s
    // (~2 Hz) with a half-sine (max(0, sin)) so each spectator has a clear
    // airborne phase and a grounded pause — reads as hopping, not levitating.
    // Phase offset i*0.9 keeps the wave traveling through the stands.
    // AUDIT PERF-R28 (2026-08-14, auditoria CPU #1): o loop fazia
    // getMatrixAt+setMatrixAt por instância × 9 meshes (~9.864 round-trips
    // + Math.pow por frame). Agora: (1) throttle 2 frames (30Hz — bounce
    // 2Hz não precisa de 60fps); (2) escreve DIRETO no Float32Array do
    // instanceMatrix (elemento 13 = Y) — sem get/setMatrixAt; (3) o rise é
    // calculado UMA vez por índice e aplicado nas 9 meshes (mesmo bobArr).
    this._crowdTick = (this._crowdTick || 0) + 1;
    if (this._crowdTick % 2 !== 0) return;
    const crowd = this.crowdMeshes || [];
    if (!crowd.length) return;
    // Compute rise once per spectator index (max count across meshes)
    const nMax = Math.max(...crowd.map((s) => s.count || 0));
    if (!this._crowdRise || this._crowdRise.length < nMax) this._crowdRise = new Float32Array(nMax);
    const riseArr = this._crowdRise;
    const srcPhase = crowd[0].userData.phase;
    const srcBob = crowd[0].userData.bob;
    for (let i = 0; i < nMax; i++) {
      const ph = srcPhase ? srcPhase[i] : i * 0.9;
      const s = Math.sin(t * 12.566 + ph);
      const bobAmp = srcBob ? srcBob[i] : 0.18;
      riseArr[i] = (s > 0 ? Math.pow(s, 0.7) : 0) * bobAmp;
    }
    for (const spec of crowd) {
      const base = spec.userData.baseY;
      if (!base) continue;
      const arr = spec.instanceMatrix.array;
      const n = spec.count;
      for (let i = 0; i < n; i++) {
        arr[i * 16 + 13] = base[i] + riseArr[i];
      }
      spec.instanceMatrix.needsUpdate = true;
    }
  }

  /** AUDIT 2026-09-02 AAA: grid neon infinito — substitui o chão oliva plano (critic 1/10). */
  buildNeonGrid(scene, track) {
    const size = 900;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; varying vec3 vWorld; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        varying vec2 vUv; varying vec3 vWorld;
        uniform float uTime;
        void main(){
          vec2 uv = vWorld.xz;
          float dist = length(uv);
          float fade = 1.0 - smoothstep(180.0, 420.0, dist);
          // grid lines: 8m spacing — thickness grows with distance to avoid moiré
          float spacing = 8.0;
          float w = fwidth(uv.x / spacing) * 3.0; // adaptive line width
          vec2 g = abs(fract(uv / spacing - 0.5) - 0.5) / w;
          float line = min(g.x, g.y);
          float grid = 1.0 - min(line, 1.0);
          grid = pow(grid, 1.0);
          // distance fade: thin out grid beyond 300m
          float distFade = 1.0 - smoothstep(280.0, 450.0, dist);
          grid *= distFade;
          // pulse
          float pulse = 0.85 + 0.15 * sin(uTime * 1.2 + dist * 0.02);
          vec3 col = mix(vec3(0.08,0.02,0.20), vec3(0.25,0.85,1.0), grid) * pulse;
          // horizon fade to fog indigo
          col = mix(vec3(0.08,0.04,0.20), col, fade);
          float alpha = grid * fade * 0.85 + 0.06 * fade;
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.08; // just above ground, below wet reflect 0.195
    mesh.renderOrder = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
    this.neonGrid = mesh;
    this.neonGridMat = mat;
  }
}
