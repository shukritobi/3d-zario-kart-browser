/**
 * Super Kart 3D.js — tiered material library.
 * Caches materials keyed by (qualityProfileName, materialType, corePropsHash).
 * Respects texture caps from VisualQualityProfile via Materials.canvasTexture.
 * Does NOT alter gameplay — only visual fidelity tiers.
 */
import * as THREE from 'three';
import { createQualityProfile, qualityReport } from './VisualQualityProfile.js';
import {
  toonMaterial,
  plasticMaterial,
  cartoonOutline,
  canvasTexture,
  getGradientMap,
  neonReflectionTexture,
  grilleTexture,
  cityRoadTexture,
  concreteTexture,
  dirtTexture,
  checkerTexture,
  bannerCheckerTexture,
  finishBannerTexture,
  finishBannerTextureMirrored,
  arrowTexture,
  finishLineTexture,
  skyTexture,
  turboPadTexture,
  turboPadChevronTexture,
  turboPadGlowTexture,
  grassTexture,
} from './Materials.js';

const _cache = new Map();

function hashCoreProps(props) {
  // Simple deterministic hash for material core props (color, emissive, etc.)
  // Exclude opts that affect texture cap (already handled by canvasTexture).
  const keys = Object.keys(props).filter(k => !['map', 'textureCap'].includes(k));
  return keys.map(k => `${k}:${props[k]}`).join('|');
}

function getQualityProfileName() {
  return typeof window !== 'undefined' ? window.__sk3dQualityProfile?.name ?? 'medium' : 'medium';
}

/**
 * Returns a toon material cached by quality tier.
 * The underlying toonMaterial() already uses MeshStandard/MeshPhysical.
 */
export function getToonMaterial(color, opts = {}) {
  const profileName = getQualityProfileName();
  const cacheKey = `toon|${profileName}|${hashCoreProps({ color, ...opts })}`;
  let mat = _cache.get(cacheKey);
  if (!mat) {
    mat = toonMaterial(color, opts);
    _cache.set(cacheKey, mat);
  }
  return mat;
}

/**
 * Returns a plastic material cached by quality tier.
 */
export function getPlasticMaterial(color, opts = {}) {
  const profileName = getQualityProfileName();
  const cacheKey = `plastic|${profileName}|${hashCoreProps({ color, ...opts })}`;
  let mat = _cache.get(cacheKey);
  if (!mat) {
    mat = plasticMaterial(color, opts);
    _cache.set(cacheKey, mat);
  }
  return mat;
}

/**
 * Returns a cartoon outline material (always cheap, but cached for consistency).
 */
export function getCartoonOutlineMaterial(color = 0x1b2a41, thickness = 0.045) {
  const profileName = getQualityProfileName();
  const cacheKey = `outline|${profileName}|${color}|${thickness}`;
  let mat = _cache.get(cacheKey);
  if (!mat) {
    // Outline is a MeshBasicMaterial — cheap, but we cache it anyway.
    mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.BackSide,
    });
    _cache.set(cacheKey, mat);
  }
  return mat;
}

/**
 * Returns a procedural texture (grass, dirt, etc.) respecting textureCap.
 * canvasTexture() already enforces the cap, so we just cache the result.
 */
export function getGrassTexture() {
  const profileName = getQualityProfileName();
  const cacheKey = `grass|${profileName}`;
  let tex = _cache.get(cacheKey);
  if (!tex) {
    tex = grassTexture();
    _cache.set(cacheKey, tex);
  }
  return tex;
}

export function getCityRoadTexture() {
  const profileName = getQualityProfileName();
  const cacheKey = `cityRoad|${profileName}`;
  let tex = _cache.get(cacheKey);
  if (!tex) {
    tex = cityRoadTexture();
    _cache.set(cacheKey, tex);
  }
  return tex;
}

export function getConcreteTexture() {
  const profileName = getQualityProfileName();
  const cacheKey = `concrete|${profileName}`;
  let tex = _cache.get(cacheKey);
  if (!tex) {
    tex = concreteTexture();
    _cache.set(cacheKey, tex);
  }
  return tex;
}

export function getDirtTexture() {
  const profileName = getQualityProfileName();
  const cacheKey = `dirt|${profileName}`;
  let tex = _cache.get(cacheKey);
  if (!tex) {
    tex = dirtTexture();
    _cache.set(cacheKey, tex);
  }
  return tex;
}

export function getNeonReflectionTexture() {
  const profileName = getQualityProfileName();
  const cacheKey = `neonReflect|${profileName}`;
  let tex = _cache.get(cacheKey);
  if (!tex) {
    tex = neonReflectionTexture();
    _cache.set(cacheKey, tex);
  }
  return tex;
}

export function getGrilleTexture() {
  const profileName = getQualityProfileName();
  const cacheKey = `grille|${profileName}`;
  let tex = _cache.get(cacheKey);
  if (!tex) {
    tex = grilleTexture();
    _cache.set(cacheKey, tex);
  }
  return tex;
}

/**
 * Clear the entire material/texture cache — useful when quality profile
 * changes at runtime (via ?quality=) and we want to force rebuild with new caps.
 */
export function clearMaterialCache() {
  _cache.clear();
}

/**
 * Debug: return cache size and keys.
 */
export function getMaterialCacheInfo() {
  return {
    size: _cache.size,
    keys: Array.from(_cache.keys()),
  };
}

// Auto-clear cache if quality profile changes at runtime.
let _lastProfileName = getQualityProfileName();
const _profileCheck = setInterval(() => {
  const current = getQualityProfileName();
  if (current !== _lastProfileName) {
    console.info('[MaterialLibrary] quality profile changed', _lastProfileName, '→', current);
    clearMaterialCache();
    _lastProfileName = current;
  }
}, 1500);

/**
 * Named material-role kit (threejs-aaa-graphics-builder / technical-art.md).
 * Central reference for shared material roles so every surface that plays the
 * same part reuses one identity instead of one-off colors. UI/world signal
 * colors are shared between HUD and diegetic markers (danger, reward, boost,
 * shield, objective). Use getToonMaterial/getPlasticMaterial with these hexes
 * rather than inventing new colors per call site.
 */
export const MATERIAL_ROLES = Object.freeze({
  bodyPrimary: 0x2ec4ff,    // dominant player/world shell (neon cyan)
  bodySecondary: 0xffd166,   // panel contrast (gold)
  trim: 0x1b2a41,            // rails, bevel highlights, borders, edge highlights
  hazard: 0xff5a5f,          // danger surfaces, damage cues, warning stripes
  reward: 0xffd166,          // collectible surfaces with readable value (gold)
  shieldBoost: 0x6cf0ff,     // shield, boost, status states (cyan glow)
  glass: 0xa8d8ff,           // cockpit, shield, lens, visor
  emissiveSignal: 0xff2ec4,  // authored glow strips, status lights, beacon cores (neon pink)
  groundContact: 0x0d1117,   // dark matte surfaces, shadow receivers
  decalDark: 0x1b2a41,       // panel lines, scratches, numbers, icons
  decalLight: 0xf4f6f8,      // light trim, markings
});

/** Shared UI/world signal colors (hex strings for CSS + canvas parity). */
export const SIGNAL_COLORS = Object.freeze({
  danger: '#ff5a5f',
  reward: '#ffd166',
  boost: '#ff9f45',
  shield: '#6cf0ff',
  objective: '#2ec4ff',
});
