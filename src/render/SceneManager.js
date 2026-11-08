/**
 * Super Kart 3D.js — renderer / scene / camera factory.
 * Controller-owned base. PostFX (bloom etc.) is added by the track agent.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createQualityProfile, createCapabilityProbe, qualityReport } from './VisualQualityProfile.js';

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: CONFIG.render.antialias,
    powerPreference: 'high-performance',
  });
  // Set DPR before sizing so the drawing buffer, camera and EffectComposer
  // all start from the same physical dimensions on high-DPR mobile devices.
  const qualityProfile = createQualityProfile(renderer);
  const capabilityProbe = createCapabilityProbe(renderer);
  // One policy drives DPR/shadows/postfx/world density. `?quality=` remains
  // an explicit override for QA and real-device comparison.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityProfile.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.userData ||= {};
  renderer.userData.qualityProfile = qualityProfile;
  window.__sk3dQualityProfile = qualityProfile;
  renderer.userData.capabilityProbe = capabilityProbe;
  renderer.userData.qualityReport = () => qualityReport(renderer, qualityProfile);
  if (qualityProfile.info.software) {
    console.info('[render] software profile:', qualityProfile.name, qualityProfile.info.renderer);
  }
  if (qualityProfile.shadows && CONFIG.render.shadows) {
    renderer.shadowMap.enabled = true;
    // PCF + shadow.radius gives VISIBLY softer edges (the lighting agent
    // flagged: radius is INERT with PCFSoftShadowMap — the vision critic
    // wanted softer contact shadows). QA/?test drops to 1024.
    const TEST = typeof window !== 'undefined' && new URLSearchParams(location.search).has('test');
    renderer.shadowMap.type = TEST ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    // NOTE: shadow map size is applied per-light in Environment.js (sun.shadow.mapSize).
    // renderer.shadowMap has no .mapSize property — it is a WebGLShadowMap, not LightShadow.
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  container.appendChild(renderer.domElement);

  // AUDIT (Jarvis QA loop 2026-08-11): WebGL context loss froze the game
  // silently (the rAF loop dies with no JS error — no handler existed).
  // Real-GPU post chains (UnrealBloom HalfFloat) can crash the GPU process
  // seconds into the race; without a handler the game just freezes. Prevent
  // the default (so the browser CAN restore) and, if we don't recover fast,
  // reload with bloom disabled (?nobl=1) so the race is still playable.
  const glCanvas = renderer.domElement;
  let _ctxLostAt = 0;
  glCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    _ctxLostAt = Date.now();
    console.warn('[Super Kart] WebGL context lost — attempting recovery (fallback: ?nobl=1)');
    // If the browser doesn't restore quickly, hard-reload without bloom.
    setTimeout(() => {
      if (Date.now() - _ctxLostAt >= 2000) {
        const url = new URL(window.location.href);
        if (!url.searchParams.has('nobl')) url.searchParams.set('nobl', '1');
        window.location.href = url.toString();
      }
    }, 2000);
  });
  glCanvas.addEventListener('webglcontextrestored', () => {
    console.warn('[Super Kart] WebGL context restored');
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // replaced by sky dome later

  const camera = new THREE.PerspectiveCamera(
    CONFIG.camera.fov,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(0, 4, 9);
  camera.lookAt(0, 1, 0);

  return { scene, camera, renderer, qualityProfile, capabilityProbe };
}
