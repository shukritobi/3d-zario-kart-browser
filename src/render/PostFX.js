/**
 * Super Kart 3D.js — post-processing chain.
 * RenderPass → BloomPass → Vignette → OutputPass. All knobs from
 * CONFIG.render. Falls back to plain renderer.render if the composer fails
 * to initialize (e.g. very old GPU).
 *
 * HISTORY: the custom ColorGradeShader (saturation/contrast) was REMOVED
 * because chained as bloom→colorgrade→vignette it rendered black on
 * software GL (three chained HalfFloat passes). AUDIT r9: re-added GATED
 * on non-software GL (GPU only) — real GPUs handle the HalfFloat chain and
 * get the MK8 punchy grade; software keeps the safe chain. ACES tone
 * mapping in OutputPass still carries the base grade.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { CONFIG } from '../config.js';

const ColorGradeShader = {
  name: 'ColorGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: CONFIG.render.colorGradeSaturation },
    contrast: { value: CONFIG.render.colorGradeContrast },
    // PREMIUM PASS (2026-08-21): warm MK8 grade — lift sombras levemente
    // azuis + realce de altas luzes quentes (golden hour) sem matar brancos.
    // AUDIT R21e (GPU real): warmth 0.06 + sat 1.45 AMPLIFICAVAM o glow do
    // bloom âmbar sobre o chão noturno → faixa oliva. Neutro p/ noite.
    warmth: { value: 0.02 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float warmth;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 sat = mix(vec3(l), c.rgb, saturation);
      vec3 con = (sat - 0.5) * contrast + 0.5;
      // warm grade: realça R, derruba B proporcional à luminância (só nas
      // altas luzes — sombras ficam neutras/frias, contraste preservado).
      float hi = smoothstep(0.35, 0.9, l);
      con.r += warmth * hi;
      con.b -= warmth * 0.6 * hi;
      gl_FragColor = vec4(con, c.a);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, qualityProfile = null) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = false;
    this.composer = null;

    try {
      // NOTE: a custom HalfFloat + samples:4 target made SwiftShader render
      // black once the scene moved to PBR (MeshStandardMaterial everywhere) —
      // the stock EffectComposer target (also HalfFloat, no MSAA) is the
      // stable path; antialias comes from the renderer's default framebuffer
      // on the final OutputPass composite.
      this.composer = new EffectComposer(renderer);
      this.composer.addPass(new RenderPass(scene, camera));

      // BLOOM — UnrealBloomPass (proven on real GPUs; the classic BloomPass
      // rendered BLACK on the user's device — GitHub Pages). Software GL
      // (SwiftShader/llvmpipe) drops bloom: bisection proved Unreal renders
      // black there with the PBR scene. ?nobl=1 forces it off everywhere.
      const params = new URLSearchParams(window.location.search);
      const forceNoBloom = params.has('nobl');
      const gl = renderer.getContext();
      let softGL = !!qualityProfile?.info?.software;
      try {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const rn = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
        softGL = /swiftshader|llvmpipe|softpipe|software/i.test(rn);
      } catch { /* no ext */ }
      this.bloom = forceNoBloom || softGL || qualityProfile?.bloom === false
        ? null
        : new UnrealBloomPass(
            // AUDIT PERF-R44 (2026-08-14, auditoria render #8): threshold a
            // MEIA-resolução (w/2,h/2) — o blur interno do UnrealBloom já é
            // downsampled; o threshold full-res só gastava fill-rate (pode
            // valer 2-4ms em GPU integrada). Perda visual imperceptível.
            new THREE.Vector2(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2)),
            CONFIG.render.bloomStrength,
            CONFIG.render.bloomRadius,
            CONFIG.render.bloomThreshold
          );
      if (this.bloom) this.composer.addPass(this.bloom);

      // AUDIT r9: the color-grade (saturation 1.2 / contrast 1.15) was
      // removed because bloom→grade→vignette chained THREE HalfFloat passes
      // rendered black on software GL. Real GPUs handle it fine, and the
      // MK8 punchy grade only matters there — so the pass comes back ONLY on
      // non-software GL (same gate as bloom). Software keeps the safe chain.
      if (!softGL && !forceNoBloom && qualityProfile?.colorGrade !== false) {
        this.composer.addPass(new ShaderPass(ColorGradeShader));
      }

      // Vignette — the color-grade pass above is gated to real GPUs (audit
      // r9); software GL never saw the HalfFloat chain that broke it.
      this.vignette = new ShaderPass(VignetteShader);
      this.vignette.uniforms.offset.value = 1 - CONFIG.render.vignetteStrength * 0.6;
      this.vignette.uniforms.darkness.value = CONFIG.render.vignetteStrength;
      this.composer.addPass(this.vignette);

      this.composer.addPass(new OutputPass());
      this.enabled = true;
    } catch (err) {
      console.warn('[PostFX] composer unavailable, using plain render.', err);
      this.enabled = false;
    }

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    // AUDIT r7: cheap sun lens flare — bright disc sprite + horizontal glare
    // streak hung in the sky along the key-light direction (day track only).
    this.buildSunFlare();
  }

  _onResize() {
    if (!this.composer) return;
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  setBloom(strength) {
    if (this.bloom) this.bloom.strength = strength;
  }

  /**
   * SAFETY NET (user hit a black screen on GitHub Pages): after the first
   * handful of composer frames, read the CENTER pixel of the canvas. If the
   * whole frame is black (lum < 8) the post chain is broken on this device
   * (it constructs fine and only fails at render — try/catch can't see it).
   * Drop the composer and fall back to plain renderer.render() forever.
   */
  _safetyFrame() {
    if (this._safetyDisabled) return;
    if (this._safetyN === undefined) this._safetyN = 0;
    if (++this._safetyN < 4) return; // wait past menu/loading frames
    this._safetyDisabled = true;
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    try {
      gl.readPixels(
        Math.floor(gl.drawingBufferWidth / 2),
        Math.floor(gl.drawingBufferHeight / 2),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px
      );
      const lum = (px[0] + px[1] + px[2]) / 3;
      if (lum < 8) {
        console.warn('[postfx] first frames black — composer disabled on this device');
        this.enabled = false;
        this.composer = null;
      }
    } catch { /* readPixels can fail on some drivers — assume OK */ }
  }

  /** Mirrors main.js TRACK_ID resolution: ?track=2 / __sk3dTrack /
   *  localStorage sk3d.track → neon city (night, no sun flare). */
  _isDayTrack() {
    let saved = 0;
    try { saved = Number(localStorage.getItem('sk3d.track')); } catch { /* private mode */ }
    const q = new URLSearchParams(window.location.search);
    const id = Number(window.__sk3dTrack) === 2 || saved === 2 || Number(q.get('track')) === 2 ? 2 : 1;
    return id !== 2;
  }

  /**
   * AUDIT r7: cheap sun lens flare — a bright sun disc sprite + a small
   * horizontal anamorphic glare line, both additive MeshBasicMaterials in
   * the sky along the key-light direction (same axis as Environment's sun
   * glow at 70,90,40). Static (the sun never moves); the additive white
   * core is what UnrealBloom picks up as the flare. Deterministic textures,
   * two draw calls, fog-free so they stay crisp past the fog far plane.
   */
  buildSunFlare() {
    if (!this.scene || !this._isDayTrack()) return;
    const pos = new THREE.Vector3(70, 90, 40).normalize().multiplyScalar(340);

    // Sun disc sprite (bright core, soft warm falloff).
    if (!this._sunDiscTex) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.25, 'rgba(255,246,214,0.9)');
      grad.addColorStop(0.6, 'rgba(255,238,190,0.35)');
      grad.addColorStop(1, 'rgba(255,235,180,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      this._sunDiscTex = new THREE.CanvasTexture(c);
      this._sunDiscTex.colorSpace = THREE.SRGBColorSpace;
      const disc = new THREE.Mesh(
        new THREE.PlaneGeometry(26, 26),
        new THREE.MeshBasicMaterial({
          map: this._sunDiscTex,
          transparent: true,
          depthWrite: false,
          fog: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        })
      );
      disc.position.copy(pos);
      disc.lookAt(0, 0, 0);
      this._sunDisc = disc;
      this.scene.add(disc);
    }

    // Horizontal glare line — a radial gradient squashed into a thin streak
    // (reads as the anamorphic lens flare crossing the sun).
    if (!this._glareTex) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const g = c.getContext('2d');
      g.translate(128, 32);
      g.scale(1, 0.24);
      g.translate(-128, -32);
      const grad = g.createRadialGradient(128, 32, 2, 128, 32, 124);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.4, 'rgba(255,244,214,0.45)');
      grad.addColorStop(1, 'rgba(255,235,190,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 64);
      this._glareTex = new THREE.CanvasTexture(c);
      this._glareTex.colorSpace = THREE.SRGBColorSpace;
      const glare = new THREE.Mesh(
        new THREE.PlaneGeometry(110, 7),
        new THREE.MeshBasicMaterial({
          map: this._glareTex,
          transparent: true,
          depthWrite: false,
          fog: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        })
      );
      glare.position.copy(pos);
      glare.lookAt(0, 0, 0);
      this._glare = glare;
      this.scene.add(glare);
    }
  }

  render() {
    if (this.enabled && this.composer) {
      this.composer.render();
      this._safetyFrame();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    if (this.composer) this.composer.dispose();
  }
}
