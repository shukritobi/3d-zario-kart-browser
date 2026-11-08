/**
 * Runtime render policy shared by renderer, post FX and world systems.
 * It deliberately degrades optional effects before the game becomes
 * unplayable. Physics and gameplay never read this module.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const QUALITY_PROFILES = Object.freeze({
  low: Object.freeze({
    name: 'low', maxPixelRatio: 1.25, textureCap: 256, shadowMapSize: 512,
    shadows: false, bloom: true, colorGrade: false, vignette: true,
    particleDensity: 0.35, foliageDensity: 0.3,
  }),
  medium: Object.freeze({
    name: 'medium', maxPixelRatio: 1.5, textureCap: 512, shadowMapSize: 1024,
    shadows: true, bloom: true, colorGrade: false, vignette: true,
    particleDensity: 0.6, foliageDensity: 0.6,
  }),
  high: Object.freeze({
    name: 'high', maxPixelRatio: 2, textureCap: 1024, shadowMapSize: 2048,
    shadows: true, bloom: true, colorGrade: true, vignette: true,
    particleDensity: 1, foliageDensity: 1,
  }),
  ultra: Object.freeze({
    name: 'ultra', maxPixelRatio: 2, textureCap: 2048, shadowMapSize: 2048,
    shadows: true, bloom: true, colorGrade: true, vignette: true,
    particleDensity: 1.25, foliageDensity: 1.2,
  }),
});

function queryOverride() {
  const q = new URLSearchParams(location.search).get('quality');
  return q && QUALITY_PROFILES[q] ? q : null;
}

function isCoarse() {
  return !!window.matchMedia?.('(pointer: coarse)').matches ||
    (navigator.maxTouchPoints || 0) > 0;
}

function glInfo(renderer) {
  const gl = renderer?.getContext?.();
  let vendor = 'unknown';
  let rendererName = 'unknown';
  let webgl2 = false;
  let maxTextureSize = 0;
  let maxSamples = 0;
  try {
    webgl2 = !!gl && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL));
      rendererName = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
    }
    maxTextureSize = gl?.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    maxSamples = gl?.getParameter(gl.MAX_SAMPLES) || 0;
  } catch { /* capability report stays conservative */ }
  const software = /swiftshader|llvmpipe|softpipe|software|mesa offscreen/i.test(rendererName);
  return { vendor, renderer: rendererName, webgl2, software, maxTextureSize, maxSamples };
}

export function createQualityProfile(renderer) {
  const info = glInfo(renderer);
  const coarse = isCoarse();
  const memory = Number(navigator.deviceMemory) || 0;
  const cores = Number(navigator.hardwareConcurrency) || 0;
  let name = queryOverride();
  if (!name) {
    if (info.software || (coarse && ((memory && memory <= 4) || (cores && cores <= 4)))) name = 'low';
    else if (coarse) name = 'medium';
    else if (/RTX|Radeon RX|Arc A|Apple M[0-9]/i.test(info.renderer)) name = 'ultra';
    else name = 'high';
  }
  const base = QUALITY_PROFILES[name] || QUALITY_PROFILES.high;
  const profile = { ...base, info, coarse, memory, cores };
  if (info.software) {
    profile.bloom = false;
    profile.colorGrade = false;
    profile.shadows = false;
    profile.maxPixelRatio = Math.min(profile.maxPixelRatio, 1);
  }
  if (info.maxTextureSize > 0) profile.textureCap = Math.min(profile.textureCap, info.maxTextureSize);
  if (coarse && !info.software) {
    // Mobile screenshots are commonly displayed above CSS-pixel size. A low
    // 1.25x render gets visibly smeared by the device compositor; recover
    // crisp geometry up to 2x without allowing pathological DPR values.
    profile.maxPixelRatio = Math.min(2, Math.max(profile.maxPixelRatio, window.devicePixelRatio || 1));
  }
  profile.maxPixelRatio = clamp(profile.maxPixelRatio, 0.75, 2);
  return Object.freeze(profile);
}

export function qualityReport(renderer, profile) {
  const gl = renderer?.getContext?.();
  const info = profile?.info || glInfo(renderer);
  return {
    profile: profile?.name || 'unknown',
    vendor: info.vendor,
    renderer: info.renderer,
    webgl2: info.webgl2,
    software: info.software,
    maxTextureSize: info.maxTextureSize,
    maxSamples: info.maxSamples,
    pixelRatio: renderer?.getPixelRatio?.() || 0,
    drawingBuffer: gl ? { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight } : null,
    calls: renderer?.info?.render?.calls ?? 0,
    triangles: renderer?.info?.render?.triangles ?? 0,
    textures: renderer?.info?.memory?.textures ?? 0,
    geometries: renderer?.info?.memory?.geometries ?? 0,
  };
}

export function createCapabilityProbe(renderer) {
  const info = glInfo(renderer);
  const gl = renderer?.getContext?.();
  const testTarget = (internalFormat, format, type) => {
    if (!gl) return false;
    const texture = gl.createTexture();
    const fb = gl.createFramebuffer();
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 8, 8, 0, format, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    } catch { return false; }
    finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(texture);
    }
  };
  return Object.freeze({
    ...info,
    rgba8Renderable: testTarget(gl?.RGBA8, gl?.RGBA, gl?.UNSIGNED_BYTE),
    rgba16fRenderable: !!gl?.RGBA16F && testTarget(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
  });
}
