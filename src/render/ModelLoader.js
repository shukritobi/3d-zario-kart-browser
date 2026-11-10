/**
 * Zario Kart — GLTF / GLB 3D Asset Pipeline (`ModelLoader.js`).
 *
 * Provides asynchronous loading, caching, bounding-box normalization, and
 * stylized Mario Kart PBR material adaptation for external `.glb` / `.gltf`
 * models (e.g., from Kenney Racing Kit, Quaternius Arcade Vehicles, Poly Pizza,
 * or AI-generated models from Hunyuan3D-2 / TRELLIS / TripoSR).
 *
 * By default, Zario Kart uses its zero-network sculpted procedural meshes for
 * instant startup and headless test compatibility. Dropping `.glb` files into
 * `public/models/karts/<name>.glb` or enabling `?models=glb` seamlessly
 * swaps in external 3D assets at runtime.
 */
import * as THREE from 'three';
import { zarioLogger, LogCategory } from '../game/ZarioLogger.js';

const _modelCache = new Map();
const _pendingPromises = new Map();
let _gltfLoaderInstance = null;

/**
 * Registry of optional external GLB paths (placed under `public/models/`).
 */
export const MODEL_MANIFEST = Object.freeze({
  karts: {
    standard: './models/karts/kart-standard.glb',
    speed: './models/karts/kart-speed.glb',
    heavy: './models/karts/kart-heavy.glb',
    compact: './models/karts/kart-compact.glb',
  },
  items: {
    mushroom: './models/items/mushroom.glb',
    shell: './models/items/shell.glb',
    banana: './models/items/banana.glb',
    star: './models/items/star.glb',
  },
  landmarks: {
    volcano: './models/landmarks/volcano-caldera.glb',
    mansion: './models/landmarks/haunted-manor.glb',
  },
});

async function getGLTFLoader() {
  if (_gltfLoaderInstance) return _gltfLoaderInstance;
  try {
    const mod = await import('three/examples/jsm/loaders/GLTFLoader.js');
    if (mod && mod.GLTFLoader) {
      _gltfLoaderInstance = new mod.GLTFLoader();
      return _gltfLoaderInstance;
    }
  } catch (err) {
    zarioLogger.warn(LogCategory.MODEL, 'GLTFLoader dynamic import unavailable', {
      error: String((err && err.message) || err),
    });
  }
  return null;
}

/**
 * Normalizes a loaded GLTF scene so its bottom sits at `y = 0`, centered in X/Z,
 * and scaled uniformly to fit `targetLength` along Z.
 */
export function normalizeModelTransform(root, targetLength = 2.1, opts = {}) {
  const wrapper = new THREE.Group();
  const clone = root.clone(true);
  const box = new THREE.Box3().setFromObject(clone);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxSpan = Math.max(size.x, size.y, size.z, 0.001);
  const scale = targetLength / maxSpan;
  clone.scale.multiplyScalar(scale);

  // Recompute after scaling
  box.setFromObject(clone);
  box.getCenter(center);
  clone.position.x -= center.x;
  clone.position.z -= center.z;
  clone.position.y -= box.min.y - (opts.yOffset || 0);

  // Adapt materials to stylized Mario Kart glossy clearcoat look
  clone.traverse((node) => {
    if (!node || !node.isMesh) return;
    node.castShadow = opts.castShadow !== undefined ? !!opts.castShadow : true;
    node.receiveShadow = true;
    if (node.material) {
      const m = node.material.clone();
      if (opts.tintColor && m.color && m.name && /body|paint|shell|primary/i.test(m.name)) {
        m.color.setHex(opts.tintColor);
      }
      if ('roughness' in m) m.roughness = Math.min(m.roughness ?? 0.4, 0.35);
      node.material = m;
    }
  });

  wrapper.add(clone);
  return wrapper;
}

/**
 * Loads a `.glb` / `.gltf` file from `url` and caches the template scene.
 * Resolves to `null` if the file is not present or running in headless Node.
 */
export async function loadGLBModel(url, options = {}) {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return null;
  if (_modelCache.has(url)) {
    const cached = _modelCache.get(url);
    return cached ? normalizeModelTransform(cached, options.targetLength || 2.1, options) : null;
  }
  if (_pendingPromises.has(url)) {
    const scene = await _pendingPromises.get(url);
    return scene ? normalizeModelTransform(scene, options.targetLength || 2.1, options) : null;
  }

  const loadPromise = (async () => {
    try {
      const headResp = await fetch(url, { method: 'HEAD' });
      if (!headResp.ok) {
        _modelCache.set(url, null);
        return null;
      }
      const loader = await getGLTFLoader();
      if (!loader) return null;
      const gltf = await new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
      const scene = (gltf && gltf.scene) || null;
      _modelCache.set(url, scene);
      if (scene) {
        zarioLogger.metrics.modelsBuilt.glbLoaded += 1;
        zarioLogger.info(LogCategory.MODEL, 'Loaded external GLB 3D model: ' + url);
      }
      return scene;
    } catch (_e) {
      _modelCache.set(url, null);
      return null;
    } finally {
      _pendingPromises.delete(url);
    }
  })();

  _pendingPromises.set(url, loadPromise);
  const loadedScene = await loadPromise;
  return loadedScene ? normalizeModelTransform(loadedScene, options.targetLength || 2.1, options) : null;
}

/**
 * Optional hook called by `Kart`: if `?models=glb` or `window.__zarioUseGLBModels`
 * is enabled and a matching `.glb` file exists in `public/models/karts/`, attaches it.
 */
export function tryAttachCustomKartModel(kart) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search || '');
  if (!params.has('models') && !window.__zarioUseGLBModels) return;
  const cls = kart.bodyClass || 'standard';
  const url = (MODEL_MANIFEST.karts && MODEL_MANIFEST.karts[cls]) || MODEL_MANIFEST.karts.standard;
  loadGLBModel(url, { targetLength: 2.05, tintColor: kart.bodyColor, yOffset: 0.08 }).then((glbGroup) => {
    if (!glbGroup || !kart || !kart.group) return;
    glbGroup.name = 'custom-glb-kart';
    kart.group.add(glbGroup);
  });
}
