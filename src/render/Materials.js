/**
 * Super Kart 3D.js — toon materials + procedural canvas textures.
 * The cartoon look is built here: 3-step gradient-map toon shading,
 * crisp dark outlines (inverted hull) and procedural textures.
 */
import * as THREE from 'three';

let _gradientMap = null;

/**
 * Toon gradient map shared by all toon materials.
 * AUDITOR FIX: the old map was 8x1 with THREE hard bands (2px dark / 4px
 * mid / 2px white, NearestFilter) — every large surface (road, terrain,
 * grandstand, chassis) shaded in harsh flat bands that read "low poly".
 * Now 64x1 with SMOOTH transitions (dark→mid→light with soft ramps): the
 * cel look survives, but surfaces shade like a premium cartoon, not a
 * 3-band posterize.
 */
export function getGradientMap() {
  if (_gradientMap) return _gradientMap;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0.0, '#3d4a63');   // shadow
  grad.addColorStop(0.22, '#3d4a63');  // hold shadow
  grad.addColorStop(0.42, '#8d97ab');  // soft ramp into mid
  grad.addColorStop(0.60, '#d8dee8');  // mid (neutral — keeps paint saturated)
  grad.addColorStop(0.78, '#eef1f5');  // soft ramp into lit
  grad.addColorStop(1.0, '#ffffff');   // lit
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.NearestFilter;  // still stepwise across the 64px ramp
  tex.magFilter = THREE.NearestFilter;  // (band count high enough to read smooth)
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  _gradientMap = tex;
  return tex;
}

/**
 * Cartoon material — AAA REBUILD (MK8D pipeline).
 * The old MeshToonMaterial + 3-band gradient map shaded every surface in
 * harsh flat bands — the single loudest "low-poly/draft" cue the user keeps
 * flagging. MK8D is PBR-stylized (vibrant colors, continuous shading, glossy
 * highlights), so this now returns MeshStandardMaterial: it responds to the
 * 3-point rig AND the sunny-sky IBL with smooth gradients + subtle sheen.
 * Contract is unchanged ({color, emissive, emissiveIntensity, transparent,
 * opacity, side, map}) — every existing call site keeps working.
 */
export function toonMaterial(color, opts = {}) {
  // AUDIT r2: clearcoat/envMapIntensity promote the material to
  // MeshPhysicalMaterial — glossy surfaces (racing line, wet surfaces) get
  // real specular instead of reading flat matte.
  const usePhysical = opts.clearcoat !== undefined || opts.envMapIntensity !== undefined;
  const mat = usePhysical
    ? new THREE.MeshPhysicalMaterial({
        color,
        roughness: opts.roughness ?? 0.82,
        metalness: opts.metalness ?? 0.0,
        emissive: opts.emissive || 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 0,
        clearcoat: opts.clearcoat ?? 0,
        clearcoatRoughness: opts.clearcoatRoughness ?? 0.3,
        envMapIntensity: opts.envMapIntensity ?? 1,
        transparent: !!opts.transparent,
        opacity: opts.opacity ?? 1,
        depthWrite: opts.depthWrite ?? true,
        side: opts.side ?? THREE.FrontSide,
        map: opts.map || null, // textures (e.g. the '?' box) must actually show
      })
    : new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.82,
        metalness: opts.metalness ?? 0.0,
        emissive: opts.emissive || 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 0,
        transparent: !!opts.transparent,
        opacity: opts.opacity ?? 1,
        depthWrite: opts.depthWrite ?? true,
        side: opts.side ?? THREE.FrontSide,
        map: opts.map || null, // textures (e.g. the '?' box) must actually show
      });
  if (opts.map) mat.needsUpdate = true;
  return mat;
}

/**
 * Shared glossy painted-plastic PBR material — the MK8 painted-plastic cue:
 * cartoon body shells read as polished toys, not raw matte plastic.
 * Requires scene.environment (set in main.js) to show reflections.
 * opts: { roughness, metalness, clearcoat, clearcoatRoughness, envMapIntensity }
 */
export function plasticMaterial(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: opts.roughness ?? 0.24,
    metalness: opts.metalness ?? 0.05,
    clearcoat: opts.clearcoat ?? 1.0,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.15,
    envMapIntensity: opts.envMapIntensity ?? 1.6,
  });
}

const _outlineTmp = new THREE.Mesh();

/**
 * PREMIUM PASS (2026-08-21): wind-sway vertex injection (shader cookbook
 * recipe c) — tips sway with a per-instance phase, base stays planted.
 * Use ONLY on InstancedMesh foliage/banners (grass tufts, palm fronds,
 * flags). Never on collidable geometry. The material keeps its PBR
 * lighting; the sway is 2 trig ops per vertex. uTime is driven by the
 * caller each frame via `windMaterials` registry (main.js update loop).
 */
export const windMaterials = new Set();
export function applyWindSway(mat, { strength = 0.08, speed = 1.5 } = {}) {
  if (!mat || mat.userData.windSway) return mat;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSwayStrength = { value: strength };
    shader.uniforms.uSwaySpeed = { value: speed };
    mat.userData.shader = shader;
    shader.vertexShader = 'uniform float uTime;\nuniform float uSwayStrength;\nuniform float uSwaySpeed;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float wPhase = instanceMatrix[3].x + instanceMatrix[3].z; // instance world offset
         #else
           float wPhase = 0.0;
         #endif
         float wH = max(transformed.y, 0.0); // base stays planted, tips move most
         transformed.x += sin(uTime * uSwaySpeed + wPhase) * uSwayStrength * wH;
         transformed.z += cos(uTime * uSwaySpeed * 0.73 + wPhase * 1.31) * uSwayStrength * 0.62 * wH;`
      );
  };
  // cache key ÚNICO por (strength,speed) — sem isso three pode entregar um
  // programa compilado de OUTRO material injetado (pitfall do cookbook).
  mat.customProgramCacheKey = () => 'wind-sway-' + strength + '-' + speed;
  mat.userData.windSway = true;
  windMaterials.add(mat);
  return mat;
}

/** Called once per frame from the main loop — advances every wind material. */
export function updateWind(t) {
  for (const m of windMaterials) {
    if (m.userData.shader) m.userData.shader.uniforms.uTime.value = t;
  }
}


/**
 * Adds a crisp dark cartoon outline to a mesh by cloning it as an
 * inverted-hull BackSide mesh (scaled slightly along normals). The outline
 * mesh is added to the same parent so it moves with the object.
 * Returns the outline mesh (store it if you need to toggle visibility).
 */
export function cartoonOutline(mesh, color = 0x1b2a41, thickness = 0.045) {
  // MeshBasicMaterial (was MeshToonMaterial) — the outline must not depend
  // on the retired toon gradient map; unlit black reads the same.
  const outlineMat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
  });
  const outline = new THREE.Mesh(mesh.geometry, outlineMat);
  outline.scale.set(
    1 + thickness,
    1 + thickness,
    1 + thickness
  );
  outline.renderOrder = -1;
  mesh.add(outline);
  return outline;
}

/**
 * Procedural canvas texture helper.
 * drawFn(ctx, size) draws the pattern; returns a CanvasTexture.
 * opts: { repeat, wrap } — repeat = [x, y] tile counts.
 */
export function canvasTexture(size, drawFn, opts = {}) {
  const cap = Number(window.__sk3dQualityProfile?.textureCap) || size;
  const resolvedSize = Math.max(64, Math.min(size, cap));
  const canvas = document.createElement('canvas');
  canvas.width = resolvedSize;
  canvas.height = resolvedSize;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, resolvedSize);
  const tex = new THREE.CanvasTexture(canvas);
  // AUDIT r2: global anisotropy kills the moiré shimmer on repeated grass /
  // dirt / concrete tiles at grazing chase-cam angles (only roadTexture set
  // it before).
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  return tex;
}

// ---------------------------------------------------------------------------
// Shared procedural textures (cached, created lazily)
// ---------------------------------------------------------------------------
let _grassTex = null;
let _cityRoadTex = null;
/** NEON CITY wet-reflection overlay: vertical light bands that read as the
 *  buildings' windows reflecting on wet asphalt (critic Neon R4 5/10: 'pista
 *  não parece molhada, faltam reflexos da cidade'). Additive ribbon over the
 *  road, low opacity — the classic MK8 wet-street cue. */
let _neonReflectTex = null;
export function neonReflectionTexture() {
  if (_neonReflectTex) return _neonReflectTex;
  _neonReflectTex = canvasTexture(
    128,
    (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      // tall vertical window bands — building reflections on wet asphalt
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * s;
        const w = 1 + Math.random() * 2.4;
        const h = 40 + Math.random() * 88;
        const y = s - h - Math.random() * 10;
        const roll = Math.random();
        // AUDIT R22f (CAUSA RAIZ FINAL do haze oliva): 45% das bandas eram
        // ÂMARELO (255,209,102) — a ribbon aditiva toneMapped:false acumulava
        // amarelo no ponto de fuga da pista + bloom = glow verde-oliva no
        // horizonte (vision 4-6.5/10 persistente). Reflexos agora só frios.
        const col = roll > 0.55 ? '160,220,255' : roll > 0.25 ? '120,220,255' : '255,120,220';
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, 'rgba(' + col + ',0)');
        g.addColorStop(0.5, 'rgba(' + col + ',0.55)');
        g.addColorStop(1, 'rgba(' + col + ',0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
      }
      // horizontal smear — perspective stretch of the reflections
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#88c8ff';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(Math.random() * s, 10 + Math.random() * (s - 40), 30 + Math.random() * 50, 1.5);
      }
      ctx.globalAlpha = 1;
      // AUDIT FIX R12e (Feco real-GPU: 'asfalto mudando de cor acompanhando
      // o carro'): a ribbon aditiva tinha BORDA RETA (as janelas chegavam em
      // V=0/V=1) — em additive, a transição abrupta virava uma faixa de cor
      // que parecia seguir o kart. Máscara vertical: alpha 0 nas bordas V,
      // pico no centro — o reflexo agora desvanece lateralmente (wet-street
      // MK8 real, sem corte visível).
      const mask = ctx.createLinearGradient(0, 0, 0, s);
      mask.addColorStop(0, 'rgba(255,255,255,0)');
      mask.addColorStop(0.18, 'rgba(255,255,255,0.9)');
      mask.addColorStop(0.82, 'rgba(255,255,255,0.9)');
      mask.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = mask;
      ctx.fillRect(0, 0, s, s);
      ctx.globalCompositeOperation = 'source-over';
    },
    { repeat: [1, 1] }
  );
  return _neonReflectTex;
}

let _grilleTex = null;
/** Kart side-intake grille (R12): rebaixo escuro + 6 slats horizontais com
 *  topo iluminado + divisor central — entrada de duto real, não patch liso. */
export function grilleTexture() {
  if (_grilleTex) return _grilleTex;
  _grilleTex = canvasTexture(64, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(10, 13, 18, 0.9)';
    ctx.fillRect(4, 8, s - 8, s - 16);
    for (let i = 0; i < 6; i++) {
      const y = 12 + i * 7;
      ctx.fillStyle = '#232b36';
      ctx.fillRect(8, y, s - 16, 3);
      ctx.fillStyle = '#4a5563';
      ctx.fillRect(8, y, s - 16, 1); // aresta iluminada do slat
    }
    ctx.fillStyle = '#1a212b';
    ctx.fillRect(s / 2 - 1.5, 10, 3, s - 20);
  });
  return _grilleTex;
}

/** NEON CITY asphalt: dark charcoal + subtle pink/cyan neon light spill baked
 *  into the texture (vision critic: 'the road needs to visibly receive the
 *  surrounding neon' — flat dark read as a void). */
export function cityRoadTexture() {
  if (_cityRoadTex) return _cityRoadTex;
  _cityRoadTex = canvasTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = '#4c5268'; // AUDIT R18: single readable charcoal-blue base
      ctx.fillRect(0, 0, s, s);
      // Fine grit only; large dark ribbons made the road read as two surfaces.
      for (let i = 0; i < 420; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#535a70' : '#42485c';
        ctx.fillRect(Math.random() * s, Math.random() * s, 1.2, 1.2);
      }
      // Micro wet-streaks: short, broken highlights add asphalt directionality
      // without recreating the old continuous horizontal wear bands.
      ctx.globalAlpha = 0.045;
      for (let i = 0; i < 36; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const w = 8 + Math.random() * 20;
        ctx.strokeStyle = i % 2 ? '#b4c8dc' : '#7d91aa';
        ctx.lineWidth = 0.7 + Math.random() * 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + (Math.random() - 0.5) * 1.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Neon reflection accents stay small and soft: they support the theme
      // without creating a giant translucent blob or a left/right seam.
      for (let i = 0; i < 6; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const r = 12 + Math.random() * 18;
        const roll = Math.random();
        const col = roll > 0.66 ? '255,46,196' : roll > 0.33 ? '46,196,255' : '255,209,102';
        const g = ctx.createRadialGradient(x, y, 1, x, y, r);
        g.addColorStop(0, 'rgba(' + col + ',0.24)');
        g.addColorStop(0.6, 'rgba(' + col + ',0.07)');
        g.addColorStop(1, 'rgba(' + col + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < 8; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const w = 12 + Math.random() * 18;
        const col3 = Math.random() > 0.5 ? '150,230,255' : '255,150,230';
        const lg3 = ctx.createLinearGradient(x, y, x + w, y);
        lg3.addColorStop(0, 'rgba(' + col3 + ',0)');
        lg3.addColorStop(0.5, 'rgba(' + col3 + ',0.3)');
        lg3.addColorStop(1, 'rgba(' + col3 + ',0)');
        ctx.fillStyle = lg3;
        ctx.fillRect(x, y, w, 2);
      }
      ctx.globalAlpha = 1;
    },
    { repeat: [40, 40] }
  );
  return _cityRoadTex;
}

let _roadTex = null;

let _concreteTex = null;
/** Urban concrete: grey pavement with speckle, expansion lines + patches.
 *  Used by NEON CITY's ground (vision critic: flat black void needs detail). */
export function concreteTexture() {
  if (_concreteTex) return _concreteTex;
  _concreteTex = canvasTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = '#62656f'; // AUDIT R21: neutral medium gray base
      // Reduced warm shift that caused olive band when viewed through fog
      ctx.fillRect(0, 0, s, s);
      // speckle
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#585b6c' : '#3c3f4e';
        ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      // expansion joints (horizontal + vertical lines)
      ctx.strokeStyle = '#33363f';
      ctx.lineWidth = 2;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (s / 4) * i);
        ctx.lineTo(s, (s / 4) * i);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo((s / 4) * i, 0);
        ctx.lineTo((s / 4) * i, s);
        ctx.stroke();
      }
      // worn dark patches
      ctx.globalAlpha = 0.25;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = '#33363f';
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s, 12 + Math.random() * 22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    { repeat: [80, 80] }
  );
  return _concreteTex;
}

let _dirtTex = null;
let _checkerTex = null;
let _bannerCheckerTex = null;
let _skyTex = null;
let _turboPadTex = null;

/** Dirt shoulder: tan earth with speckle + worn patches (audit V3 — the
 *  shoulder was a flat untextured ribbon, the loudest "draft" cue left). */
export function dirtTexture() {
  if (_dirtTex) return _dirtTex;
  _dirtTex = canvasTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = '#d9b98c';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 1800; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#c9a97c' : '#e2c69b';
        ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      // worn darker patches
      ctx.globalAlpha = 0.16;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = '#a5845c';
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s, 14 + Math.random() * 24, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // scattered pebbles
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#8f7452';
      for (let i = 0; i < 120; i++) {
        ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      ctx.globalAlpha = 1;
    },
    { repeat: [20, 20] }
  );
  return _dirtTex;
}

/** Grass: layered green noise + blade strokes + soft patches, tileable. */
export function grassTexture() {
  if (_grassTex) return _grassTex;
  _grassTex = canvasTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = '#3faf4e';
      ctx.fillRect(0, 0, s, s);
      // base two-tone speckle
      for (let i = 0; i < 2600; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        ctx.fillStyle = Math.random() > 0.5 ? '#47bb57' : '#379c45';
        ctx.fillRect(x, y, 2, 2);
      }
      // individual grass blades (short strokes, slight color variation)
      for (let i = 0; i < 320; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const len = 4 + Math.random() * 7;
        const a = Math.random() * Math.PI;
        ctx.strokeStyle = Math.random() > 0.5 ? '#4cc25e' : '#2f8f43';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
      // soft darker + lighter patches — SMALL and numerous (vision critic:
      // big patches read as banding; fine stipple reads as natural variation)
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = i % 2 ? '#2f8f43' : '#357f46';
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s, 9 + Math.random() * 16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < 22; i++) {
        ctx.fillStyle = '#55cc68';
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s, 8 + Math.random() * 14, 0, Math.PI * 2);
        ctx.fill();
      }
      // LARGE soft mow/stripe variation (audit r5: from chase distance the
      // fine stipple reads as uniform green — big low-alpha patches break
      // the monotony without banding).
      ctx.globalAlpha = 0.14;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#2f8f43' : '#57c96b';
        ctx.beginPath();
        ctx.ellipse(Math.random() * s, Math.random() * s, 34 + Math.random() * 30, 22 + Math.random() * 20, Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    { repeat: [50, 50] }
  );
  return _grassTex;
}

/** Asphalt: dark blue-grey with fine speckle + tire wear + cracks, tileable.
 *  USER/VISION FIX: the old tile had CONTINUOUS horizontal wear bands
 *  (fillRect across the whole tile) that repeated every ~16m and read as
 *  hard horizontal banding from the chase cam. Wear is now broken into
 *  irregular dashed ribbons + scattered patches so no straight line repeats.
 */
export function roadTexture() {
  if (_roadTex) return _roadTex;
  _roadTex = canvasTexture(
    512,
    (ctx, s) => {
      ctx.fillStyle = '#5a6b7d';
      ctx.fillRect(0, 0, s, s);
      // dense speckle (stone feel)
      for (let i = 0; i < 6200; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? '#52626f' : '#64768a';
        ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
      // Tire wear: TWO dashed ribbons (broken dashes, never a full line) —
      // the dash gaps break the periodic banding the old fillRect caused.
      const wearY = [s * 0.27, s * 0.64];
      for (const wy of wearY) {
        for (let x = 0; x < s; x += 7 + Math.random() * 10) {
          const len = 5 + Math.random() * 14;
          const alpha = 0.14 + Math.random() * 0.14;
          ctx.fillStyle = '#2e3846';
          ctx.globalAlpha = alpha;
          ctx.fillRect(x, wy + (Math.random() - 0.5) * 4, len, 3 + Math.random() * 2);
          ctx.globalAlpha = alpha * 0.7;
          ctx.fillStyle = '#252e3a';
          ctx.fillRect(x, wy + 4 + (Math.random() - 0.5) * 3, len, 2);
        }
      }
      // Racing-line rubber buildup: a heavier darkened band between the two
      // tire ribbons — SPLIT into overlapping irregular segments (a single
      // wide fillRect repeated every tile read as broad tonal striping).
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = '#3a4554';
      for (let x = -10; x < s + 10; x += 5 + Math.random() * 9) {
        ctx.fillRect(x, s * 0.43 + (Math.random() - 0.5) * 6, 9 + Math.random() * 12, s * 0.10 + Math.random() * 6);
      }
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = '#313b49';
      for (let x = -10; x < s + 10; x += 6 + Math.random() * 8) {
        ctx.fillRect(x, s * 0.45 + (Math.random() - 0.5) * 8, 4 + Math.random() * 8, 2 + Math.random() * 3);
      }
      ctx.globalAlpha = 1;
      // Scattered oil/rubber patches — MEDIUM size, many, low alpha (big
      // single blobs repeated = visible macro banding; small many = natural).
      for (let i = 0; i < 26; i++) {
        // AUDIT (vision): dark circular marks read as ARTIFACTS — lower the
        // alpha + soften the colors so they stay as subtle wear, not blobs.
        ctx.globalAlpha = 0.05 + Math.random() * 0.07;
        ctx.fillStyle = Math.random() > 0.5 ? '#3a4454' : '#414d5e';
        ctx.beginPath();
        ctx.ellipse(Math.random() * s, Math.random() * s, 8 + Math.random() * 16, 4 + Math.random() * 9, Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      // Slightly lighter worn sheen patches (rubbered-in racing line).
      for (let i = 0; i < 18; i++) {
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = '#6d7f92';
        ctx.beginPath();
        ctx.ellipse(Math.random() * s, Math.random() * s, 10 + Math.random() * 18, 5 + Math.random() * 10, Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // subtle cracks (short dark jagged strokes)
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = '#2f3844';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * s;
        const y = Math.random() * s;
        const len = 8 + Math.random() * 22;
        const a = Math.random() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5);
        ctx.lineTo(x + Math.cos(a + 0.4) * len, y + Math.sin(a + 0.4) * len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // fine white wear flecks along the racing line
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 90; i++) {
        ctx.fillRect(Math.random() * s, s * 0.27 + Math.random() * 8 - 4, 3 + Math.random() * 3, 1);
      }
      ctx.globalAlpha = 1;
    },
    { repeat: [4, 4] }
  );
  return _roadTex;
}

/** Checkered start line (2x8 squares, classic black/white). 2 across the
 *  short axis (3.2m travel length) x 8 along the road width (7.8m) — the
 *  box UVs stretch U along X (short) and V along Z (wide), so 2x8 gives
 *  near-square checker squares on the asphalt.
 *  AUDIT r11 (FECO): 128px -> 512px so painted checkers read crisp, not
 *  blocky, at chase-cam distance. */
export function checkerTexture() {
  if (_checkerTex) return _checkerTex;
  _checkerTex = canvasTexture(
    512,
    (ctx, s) => {
      const cw = s / 2;
      const ch = s / 8;
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 8; j++) {
          ctx.fillStyle = (i + j) % 2 === 0 ? '#ffffff' : '#1b2a41';
          ctx.fillRect(i * cw, j * ch, cw, ch);
        }
      }
    }
  );
  return _checkerTex;
}

/** Gantry edge checker: crisp 8x2 (8 along, 2 tall) black/white checker,
 *  256px. PURE pattern — the FINISH text lives in finishBannerTexture.
 *  AUDIT r11 (FECO): the old 512px SQUARE canvas baked 118px glyphs that
 *  mapped ~4.7x wider than tall across the wide banner plane — the
 *  'stretched low-res' banner. Used now as the checkered trim on the
 *  gantry beam's track-facing faces. */
export function bannerCheckerTexture() {
  if (_bannerCheckerTex) return _bannerCheckerTex;
  _bannerCheckerTex = canvasTexture(
    256,
    (ctx, s) => {
      const cw = s / 8;
      const ch = s / 2;
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 === 0 ? '#ffffff' : '#0f1218';
          ctx.fillRect(i * cw, j * ch, cw, ch);
        }
      }
    }
  );
  return _bannerCheckerTex;
}

/** Gantry FINISH banner: 512x128 — aspect-matched to the ~9.8m x 2.1m
 *  banner plane (~4.7:1), so the artwork maps 1:1 with NO stretching
 *  (AUDIT r11 FECO: the old square 512px canvas made the FINISH glyphs
 *  4.7x wider than tall — the stretched low-res look). Navy field, big
 *  white FINISH, crisp checkered bands top + bottom — MK8D style. */
let _finishBannerTex = null;
export function finishBannerTexture() {
  if (_finishBannerTex) return _finishBannerTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  // Navy field.
  g.fillStyle = '#14213d';
  g.fillRect(0, 0, 512, 128);
  // Checkered bands (top + bottom edges): 16 crisp cells across.
  const bandH = 22;
  const cells = 16;
  const cw = 512 / cells;
  for (const by of [0, 128 - bandH]) {
    for (let i = 0; i < cells; i++) {
      g.fillStyle = i % 2 === 0 ? '#ffffff' : '#0f1218';
      g.fillRect(i * cw, by, cw, bandH);
    }
  }
  // Pinstripe separators so the bands read as a designed border.
  g.fillStyle = '#3d4f78';
  g.fillRect(0, bandH, 512, 2);
  g.fillRect(0, 128 - bandH - 2, 512, 2);
  const mobileViewport =
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
    window.innerWidth <= 768;
  const bannerFontPx = mobileViewport ? 36 : 58;
  g.font = `900 ${bannerFontPx}px "Baloo 2", "Nunito", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // soft gold glow behind the glyphs (reads at distance, not just up close)
  g.shadowColor = 'rgba(255,209,102,0.55)';
  g.shadowBlur = 14;
  g.fillStyle = '#0a1120';
  g.fillText('START / FINISH', 258, 68);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.fillText('START / FINISH', 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  _finishBannerTex = tex;
  return _finishBannerTex;
}

/** Mirrored FINISH banner texture (horizontal flip) for the BACK face of
 *  the gantry banner — the DoubleSide material showed 'HSINIF' reversed
 *  when the player passed under it (visual auditor 2026-08-12). */
let _finishBannerTexMirrored = null;
export function finishBannerTextureMirrored() {
  if (_finishBannerTexMirrored) return _finishBannerTexMirrored;
  const base = finishBannerTexture();
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.translate(512, 0);
  g.scale(-1, 1);
  g.drawImage(base.image, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  _finishBannerTexMirrored = tex;
  return _finishBannerTexMirrored;
}

/** Direction arrow painted on the road at sharp corners (white chevron on
 *  a transparent card, so MeshBasicMaterial reads it unlit over asphalt). */
let _arrowTex = null;
export function arrowTexture() {
  if (_arrowTex) return _arrowTex;
  _arrowTex = canvasTexture(
    128,
    (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.translate(s / 2, s / 2);
      // Two chevrons pointing "up" the road direction.
      ctx.strokeStyle = '#f4f6f8';
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-34, 16);
      ctx.lineTo(0, -26);
      ctx.lineTo(34, 16);
      ctx.moveTo(-18, 40);
      ctx.lineTo(0, 0);
      ctx.lineTo(18, 40);
      ctx.stroke();
      // Thin amber outline for pop.
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  );
  return _arrowTex;
}

/** Finish-line painted on the asphalt: classic 8x2 checker band.
 *  AUDIT r11 (FECO): 1024px + 8x2 — the ~1.1m squares stay razor crisp
 *  across the ~8.8m plane under the gantry (no stretched low-res strip). */
let _finishTex = null;
export function finishLineTexture() {
  if (_finishTex) return _finishTex;
  // AUDIT (Feco, 2026-08-11): the 8x2 texture on a 9m road made 1.125m
  // cells that read as a dark blob-strip, not a checker. 12x2 cells =
  // 0.75m square cells on a 9m road (MK8D finish strips use smaller,
  // crisper checkers). Anisotropy 8 keeps them sharp at grazing angles.
  _finishTex = canvasTexture(
    512, // AUDIT PERF-R31 (2026-08-14, auditoria memória #2): 1024→512 — célula ~42px ainda nítida com aniso 8; economiza ~4MB RAM+GPU (maior textura isolada)
    (ctx, s) => {
      const cw = s / 12;
      const ch = s / 4;
      for (let i = 0; i < 12; i++) {
        for (let j = 0; j < 4; j++) {
          ctx.fillStyle = (i + j) % 2 === 0 ? '#f4f6f8' : '#0f1218';
          ctx.fillRect(i * cw, j * ch, cw, ch);
        }
      }
    },
    { anisotropy: 8 }
  );
  return _finishTex;
}

/** Sky gradient dome texture: painted sun disc + glow + horizon haze
 *  (audit V3 — was a bare 2px gradient, read as a placeholder backdrop). */
export function skyTexture() {
  if (_skyTex) return _skyTex;
  _skyTex = canvasTexture(
    512,
    (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, '#2e9be8');
      g.addColorStop(0.4, '#6fc4f2');
      g.addColorStop(0.72, '#b8e6ff');
      g.addColorStop(0.88, '#e8f7ff'); // horizon haze
      g.addColorStop(1, '#d9f4ff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      // sun disc + halo (center of the dome — visible straight ahead)
      const sunX = s * 0.5;
      const sunY = s * 0.18;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#fff7cf';
      ctx.beginPath();
      ctx.arc(sunX, sunY, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fffdf0';
      ctx.beginPath();
      ctx.arc(sunX, sunY, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
      // a few faint high cloud wisps
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 4; i++) {
        const cx = Math.random() * s;
        const cy = s * (0.1 + Math.random() * 0.35);
        ctx.beginPath();
        ctx.ellipse(cx, cy, s * (0.06 + Math.random() * 0.05), s * 0.012, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  );
  return _skyTex;
}

/** Turbo pad: MK8-style boost strip — a LONG amber ribbon (not a square) with
 *  glowing white ">>>" chevrons down its length + bright leading/trailing
 *  edges. Canvas is 1:3 (matches the 3.6 x 11.2m pad plane) so the pattern
 *  doesn't stretch. The additive glow overlay (built in buildTurboPads) makes
 *  it breathe in-game; tips point +X so the rotateZ in buildTurboPads aims
 *  them down-track. */
/** Turbo pad: MK8-style boost strip — a LONG amber ribbon (not a square) with
 *  glowing white ">>>" chevrons down its length + bright leading/trailing
 *  edges. Canvas is 3:1 (matches the 11.2 x 3.6m pad plane, after the
 *  buildTurboPads rotateZ inversion) so the pattern doesn't stretch. Tips
 *  point +X (down-track). The material is toneMapped=false so ACES doesn't
 *  dull the amber into brown (Feco QA 2026-08-12). */
/** Turbo pad: MK8-style boost strip — a LONG amber ribbon (not a square) with
 *  glowing white ">>>" chevrons down its length + bright leading/trailing
 *  edges. Canvas 5.5:1 matches the 18 x 3.2m pad (post rotateZ inversion).
 *  Tips point +X (down-track). toneMapped=false so ACES doesn't dull the
 *  amber into brown (Feco QA 2026-08-12). */
/** Turbo pad: MK8-style boost strip — a LONG amber ribbon (not a square) with
 *  glowing white ">>>" chevrons down its length. NO white outer frame — a
 *  solid bright border read as a floating "plate" (Feco QA 2026-08-12); the
 *  MK8 pad is a painted amber strip. Canvas 4:1 matches the 18 x 4.5m pad.
 *  Tips point +X (down-track). toneMapped=false so ACES keeps the amber hot. */
export function turboPadTexture() {
  if (_turboPadTex) return _turboPadTex;
  const W = 512;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  // Warm amber gradient DOWN THE STRIP (long axis = travel direction).
  // (Feco QA 2026-08-12: the old #ffd94a start + white wash read as a blown
  // white blob with no arrow contrast — MK8 amber is a MEDIUM gold.)
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#ffb52e');
  g.addColorStop(0.5, '#f5971a');
  g.addColorStop(1, '#d96a00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // TICK25 (pad edge definition): o pad lia como laje amarela chapada sem
  // borda (mobile portrait: metade do frame). Moldura escura em TODA a volta
  // da textura (laterais = topo/fundo do canvas, V across; entrada/saída =
  // esq/dir, U travel) + filete interno claro. As setas têm 12% de margem
  // (R12c), então a moldura de 10/6px nunca as toca.
  ctx.fillStyle = '#5f2f00';
  ctx.fillRect(0, 0, W, 10);          // lateral edge (V=0)
  ctx.fillRect(0, H - 10, W, 10);     // lateral edge (V=1)
  ctx.fillRect(0, 0, 6, H);           // entry edge (U=0)
  ctx.fillRect(W - 6, 0, 6, H);       // exit edge (U=1)
  ctx.fillStyle = 'rgba(255,217,122,0.9)';
  ctx.fillRect(0, 10, W, 2);
  ctx.fillRect(0, H - 12, W, 2);
  // Three BIG ">>>" chevrons down the length, tips +X, strong glow.
  // AUDIT R78 (crítico pós-R77: 'chevrons estourados, sem definição'): a
  // BASE do pad ainda tinha lineWidth 22 + shadow 0.9 — chevrons viravam
  // manchas. Mesma calibração do glow R67: 14/0.6/6 + setas menores.
  // AUDIT R83 (Feco real-GPU 2026-08-15: 'setas suaves/borradas'): no GPU
  // real a textura 512×128 com chevrons 14px fica suave a distância — o
  // contraste laranja/branco precisa ser mais alto. Aumenta lineWidth p/
  // 18 + contorno escuro fino nas setas (borda #a35a00 separa do laranja).
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,255,255,0.65)';
  ctx.shadowBlur = 5;
  // AUDIT FIX R12c (Feco real-GPU: 'pads cortando'): com PAD_LEN dinâmico
  // (7-18m), os chevrons em 0.20/0.50/0.80 eram cortados pela borda quando o
  // pad encolhia. Centraliza as setas com margem de 12% nas pontas: o corte
  // cai no fundo laranja, nunca no meio da seta.
  for (const fx of [0.26, 0.50, 0.74]) {
    const cx = W * fx;
    const cy = H / 2;
    const half = W * 0.09;
    const hh = H * 0.30;
    ctx.beginPath();
    ctx.moveTo(cx - half, cy - hh);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx - half, cy + hh);
    ctx.stroke();
  }
  // Contorno escuro fino para separar as setas do laranja (definição).
  // TICK25: 2.5/0.55 → 3.5/0.75 — no mobile o branco lavava no âmbar claro.
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(120,60,0,0.75)';
  ctx.lineWidth = 3.5;
  for (const fx of [0.26, 0.50, 0.74]) {
    const cx = W * fx;
    const cy = H / 2;
    const half = W * 0.09;
    const hh = H * 0.30;
    ctx.beginPath();
    ctx.moveTo(cx - half, cy - hh);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx - half, cy + hh);
    ctx.stroke();
  }
  ctx.restore();
  // Extra soft halo pass (bigger blur, lower alpha).
  ctx.shadowBlur = 12;
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  for (const fx of [0.26, 0.50, 0.74]) {
    const cx = W * fx;
    const cy = H / 2;
    const half = W * 0.09;
    const hh = H * 0.30;
    ctx.beginPath();
    ctx.moveTo(cx - half, cy - hh);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx - half, cy + hh);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  _turboPadTex = tex;
  return _turboPadTex;
}
/** Ramp chevron decal. */
let _turboPadChevronTex = null;
export function turboPadChevronTexture() {
  if (_turboPadChevronTex) return _turboPadChevronTex;
  _turboPadChevronTex = canvasTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = '#ffc233';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = s * 0.075;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(255,255,255,1)';
      ctx.shadowBlur = 10;
      for (let i = 0; i < 3; i++) {
        const cx = s * (0.5 + (i - 1) * 0.26);
        const cy = s * 0.5;
        const half = s * 0.12;
        ctx.beginPath();
        ctx.moveTo(cx - half, cy - half);
        ctx.lineTo(cx + half, cy);
        ctx.lineTo(cx - half, cy + half);
        ctx.stroke();
      }
    }
  );
  return _turboPadChevronTex;
}

/** AUDIT R51b (Feco 2026-08-14): glow aditivo do turbo pad com máscara SÓ
 *  dos chevrons (fundo PRETO = soma zero no aditivo; branco = brilha só nas
 *  setas). O glow anterior usava a textura inteira do pad (laranja + branco)
 *  e o aditivo DOBRAVA o laranja / estourava o branco. */
let _turboPadGlowTex = null;
export function turboPadGlowTexture() {
  if (_turboPadGlowTex) return _turboPadGlowTex;
  const W = 512;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H); // black bg → additive adds nothing outside the chevrons
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 14; // AUDIT R67: 22→14 — chevrons mais definidos (crítico: 'manchas brancas, sem separação')
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 8; // AUDIT R67: 10→8 — halo menor
  // TICK25: 0.20/0.50/0.80 → 0.26/0.50/0.74 + half 0.11→0.09 — a máscara do
  // glow DESALINHADA da base criava duplo fantasma permanente no pulse
  // 0.06-0.14 (30px de offset em 512). Mesmos centros e largura da base;
  // o halo continua vindo do shadowBlur.
  for (const fx of [0.26, 0.50, 0.74]) {
    const cx = W * fx;
    const cy = H / 2;
    const half = W * 0.09; // AUDIT R67: 0.13→0.11 — setas menores, separadas
    const hh = H * 0.30;   // AUDIT R67: 0.34→0.30
    ctx.beginPath();
    ctx.moveTo(cx - half, cy - hh);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx - half, cy + hh);
    ctx.stroke();
  }
  ctx.shadowBlur = 14;
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  for (const fx of [0.26, 0.50, 0.74]) {
    const cx = W * fx;
    const cy = H / 2;
    const half = W * 0.09;
    const hh = H * 0.30;
    ctx.beginPath();
    ctx.moveTo(cx - half, cy - hh);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx - half, cy + hh);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  _turboPadGlowTex = tex;
  return _turboPadGlowTex;
}

