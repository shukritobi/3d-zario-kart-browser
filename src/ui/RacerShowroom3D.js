/**
 * Zario Kart — 3D Racer & Kart Showroom Preview (`RacerShowroom3D.js`)
 *
 * Replaces the flat 2D vector silhouette in the Racer Selection screen with
 * a live Three.js 3D Mario Kart Showroom turntable preview of the actual 3D
 * `Kart` + Driver model (complete with sculpted chassis, custom 3D headgear,
 * spinning wheels, front steering sweep, and glowing showroom pedestal).
 *
 * Architecture & Performance:
 *   - Uses a SINGLE shared offscreen `THREE.WebGLRenderer` (400×280) and blits
 *     into the `.sk3d-char-canvas` elements via 2D `drawImage()`. This avoids
 *     exceeding mobile/TV WebGL context limits while keeping `.sk3d-char-canvas`
 *     standard and lightweight.
 *   - Renders an initial 3D showroom portrait for all 6 character cards, and
 *     runs a 60 FPS live turntable loop ONLY while the Racer Selection screen
 *     is open (0% GPU/CPU cost during actual racing).
 *   - Supports interactive touch/mouse drag on the card to manually rotate the
 *     3D kart 360°.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Kart } from '../entities/Kart.js';

const SHOWROOM_W = 400;
const SHOWROOM_H = 280;

function hexCss(num) {
  return '#' + (num >>> 0).toString(16).padStart(6, '0');
}

export class RacerShowroom3D {
  constructor() {
    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._pedestalGroup = null;
    this._rimRingMat = null;
    this._keyLight = null;
    this._rimLight = null;
    this._karts = [];
    this._activeKartIdx = -1;
    this._rafId = 0;
    this._running = false;
    this._turntableAngle = 0.62; // Heroic 3/4 front-right Mario Kart showroom angle
    this._userAngleOffset = 0;
    this._dragging = false;
    this._dragStartX = 0;
    this._dragStartAngle = 0;
    this._clock = 0;
    this._webglAvailable = null;
    this._boundCards = new WeakSet();
  }

  _initThree() {
    if (this._webglAvailable === false) return false;
    if (this._renderer) return true;
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      this._webglAvailable = false;
      return false;
    }

    try {
      const offCanvas = document.createElement('canvas');
      offCanvas.width = SHOWROOM_W;
      offCanvas.height = SHOWROOM_H;

      // Verify WebGL context creation succeeds (graceful fallback in headless Node shims)
      const probeGl = offCanvas.getContext && (offCanvas.getContext('webgl2') || offCanvas.getContext('webgl'));
      if (!probeGl || typeof probeGl.getExtension !== 'function') {
        this._webglAvailable = false;
        return false;
      }

      const renderer = new THREE.WebGLRenderer({
        canvas: offCanvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      renderer.setSize(SHOWROOM_W, SHOWROOM_H, false);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.18;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, SHOWROOM_W / SHOWROOM_H, 0.1, 40);
      camera.position.set(0, 1.52, 4.15);
      camera.lookAt(0, 0.48, 0);

      // Studio 3-point lighting for glossy Mario Kart clearcoat paint
      const hemi = new THREE.HemisphereLight(0xeef6ff, 0x1e293b, 1.35);
      scene.add(hemi);

      const keyLight = new THREE.DirectionalLight(0xfff7e6, 2.2);
      keyLight.position.set(3.2, 4.8, 3.6);
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0x90caf9, 1.1);
      fillLight.position.set(-3.5, 2.4, 2.2);
      scene.add(fillLight);

      const rimLight = new THREE.PointLight(0x38bdf8, 2.4, 10);
      rimLight.position.set(0, 2.2, -2.8);
      scene.add(rimLight);

      // Mario Kart 3D Showroom Turntable Pedestal
      const pedestalGroup = new THREE.Group();
      const baseGeo = new THREE.CylinderGeometry(1.48, 1.62, 0.16, 40);
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x162032,
        metalness: 0.65,
        roughness: 0.28,
      });
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -0.08;
      pedestalGroup.add(baseMesh);

      // Top dark mirror deck
      const deckGeo = new THREE.CylinderGeometry(1.38, 1.38, 0.03, 40);
      const deckMat = new THREE.MeshStandardMaterial({
        color: 0x24344d,
        metalness: 0.45,
        roughness: 0.22,
      });
      const deckMesh = new THREE.Mesh(deckGeo, deckMat);
      deckMesh.position.y = 0.005;
      pedestalGroup.add(deckMesh);

      // Glowing character-colored neon rim torus
      const rimGeo = new THREE.TorusGeometry(1.44, 0.042, 12, 48);
      const rimRingMat = new THREE.MeshStandardMaterial({
        color: 0xff5a5f,
        emissive: 0xff5a5f,
        emissiveIntensity: 0.85,
        roughness: 0.2,
      });
      const rimMesh = new THREE.Mesh(rimGeo, rimRingMat);
      rimMesh.rotation.x = Math.PI / 2;
      rimMesh.position.y = 0.01;
      pedestalGroup.add(rimMesh);

      // Subtle inner gold accent ring
      const innerRimGeo = new THREE.TorusGeometry(1.12, 0.018, 10, 40);
      const innerRimMat = new THREE.MeshStandardMaterial({
        color: 0xffd166,
        emissive: 0xffd166,
        emissiveIntensity: 0.45,
        roughness: 0.3,
      });
      const innerRimMesh = new THREE.Mesh(innerRimGeo, innerRimMat);
      innerRimMesh.rotation.x = Math.PI / 2;
      innerRimMesh.position.y = 0.022;
      pedestalGroup.add(innerRimMesh);

      scene.add(pedestalGroup);

      // Build one 3D Kart per character in the roster
      const chars = CONFIG.kart.characters || [];
      const karts = chars.map((ch, idx) => {
        const k = new Kart({
          character: ch,
          color: ch.color,
          isPlayer: true,
          number: idx + 1,
          startPosition: new THREE.Vector3(0, 0.02, 0),
          startHeading: 0,
        });
        if (k._rankArrow) k._rankArrow.visible = false;
        if (k._blob) k._blob.visible = false;
        k.group.visible = false;
        scene.add(k.group);
        return k;
      });

      this._renderer = renderer;
      this._scene = scene;
      this._camera = camera;
      this._pedestalGroup = pedestalGroup;
      this._rimRingMat = rimRingMat;
      this._keyLight = keyLight;
      this._rimLight = rimLight;
      this._karts = karts;
      this._webglAvailable = true;
      return true;
    } catch (_err) {
      this._webglAvailable = false;
      return false;
    }
  }

  /**
   * Bind pointer/touch drag on each `.sk3d-char-card` canvas so the player can
   * spin the 3D kart 360° with their finger or mouse.
   */
  bindInteractiveCards(charCards) {
    if (!Array.isArray(charCards)) return;
    for (const card of charCards) {
      if (!card || this._boundCards.has(card)) continue;
      this._boundCards.add(card);
      const canvas = card.querySelector('canvas');
      if (!canvas || typeof canvas.addEventListener !== 'function') continue;

      const onDown = (e) => {
        const x = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
        if (typeof x !== 'number') return;
        this._dragging = true;
        this._dragStartX = x;
        this._dragStartAngle = this._userAngleOffset;
      };
      const onMove = (e) => {
        if (!this._dragging) return;
        const x = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
        if (typeof x !== 'number') return;
        const dx = x - this._dragStartX;
        this._userAngleOffset = this._dragStartAngle + dx * 0.018;
      };
      const onUp = () => {
        this._dragging = false;
      };

      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
    }
  }

  /**
   * Renders one character's 3D Kart onto `targetCanvas` at `angleRad` and `timeSec`.
   */
  renderCharacterToCanvas(charIdx, targetCanvas, angleRad = 0.62, timeSec = 0) {
    if (!targetCanvas) return false;
    if (!this._initThree()) return false;
    const kart = this._karts[charIdx];
    const ch = CONFIG.kart.characters[charIdx];
    if (!kart || !ch) return false;

    for (let i = 0; i < this._karts.length; i++) {
      this._karts[i].group.visible = i === charIdx;
    }

    // Tint the glowing showroom pedestal ring to match the character's signature color
    this._rimRingMat.color.setHex(ch.color);
    this._rimRingMat.emissive.setHex(ch.color);
    this._rimLight.color.setHex(ch.accentColor || ch.color);

    // Pose the 3D kart + pedestal
    this._pedestalGroup.rotation.y = angleRad;
    kart.group.position.set(0, 0.02 + Math.sin(timeSec * 5.5) * 0.012, 0);
    kart.group.rotation.set(0, angleRad, Math.sin(timeSec * 2.8) * 0.025);

    // Spin wheels & sweep front steering for live showroom feel
    if (Array.isArray(kart.wheels)) {
      for (const w of kart.wheels) {
        if (w) w.rotation.x = timeSec * 7.5;
      }
    }
    if (Array.isArray(kart.frontWheelPivots)) {
      const steerSweep = Math.sin(timeSec * 2.1) * 0.28;
      for (const p of kart.frontWheelPivots) {
        if (p) p.rotation.y = steerSweep;
      }
    }

    this._renderer.render(this._scene, this._camera);

    const g = targetCanvas.getContext('2d');
    if (!g) return false;
    const W = targetCanvas.width || SHOWROOM_W;
    const H = targetCanvas.height || SHOWROOM_H;

    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);

    // Rich Mario Kart 3D Showroom studio backdrop
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0f172a');
    bg.addColorStop(0.62, '#1e293b');
    bg.addColorStop(1, '#0b1120');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // Character-colored radial studio spotlight behind the 3D kart
    const spot = g.createRadialGradient(W * 0.5, H * 0.54, 12, W * 0.5, H * 0.54, W * 0.46);
    spot.addColorStop(0, hexCss(ch.color) + '66');
    spot.addColorStop(0.55, hexCss(ch.accentColor || ch.color) + '24');
    spot.addColorStop(1, 'rgba(15, 23, 42, 0)');
    g.fillStyle = spot;
    g.fillRect(0, 0, W, H);

    // Composite the rendered 3D WebGL frame
    g.drawImage(this._renderer.domElement, 0, 0, W, H);

    // Top-left "3D LIVE" badge & top-right weight/style class badge
    g.fillStyle = 'rgba(15, 23, 42, 0.78)';
    g.strokeStyle = hexCss(ch.color);
    g.lineWidth = 2;
    g.beginPath();
    if (typeof g.roundRect === 'function') {
      g.roundRect(12, 12, 108, 26, 13);
    } else {
      g.rect(12, 12, 108, 26);
    }
    g.fill();
    g.stroke();

    g.fillStyle = '#f8fafc';
    g.font = '800 12px "Baloo 2", system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('✨ 3D SHOWROOM', 22, 25);

    const bodyLabel = String(ch.body || 'ALL-ROUND').toUpperCase();
    g.fillStyle = 'rgba(15, 23, 42, 0.78)';
    g.strokeStyle = 'rgba(255, 209, 102, 0.75)';
    g.beginPath();
    if (typeof g.roundRect === 'function') {
      g.roundRect(W - 108, 12, 96, 26, 13);
    } else {
      g.rect(W - 108, 12, 96, 26);
    }
    g.fill();
    g.stroke();

    g.fillStyle = '#ffd166';
    g.textAlign = 'center';
    g.fillText(bodyLabel, W - 60, 25);

    g.restore();
    return true;
  }

  /**
   * Renders all 6 character cards once in 3D (or falls back to 2D if WebGL is unavailable).
   */
  renderAllCards(charCards, fallback2D) {
    if (!Array.isArray(charCards)) return false;
    this.bindInteractiveCards(charCards);
    let anyRendered = false;
    for (const card of charCards) {
      const idx = Number(card.dataset.index);
      const canvas = card.querySelector('canvas');
      if (!canvas) continue;
      const ok = this.renderCharacterToCanvas(idx, canvas, 0.62, idx * 0.4);
      if (ok) {
        anyRendered = true;
      } else if (typeof fallback2D === 'function') {
        fallback2D(canvas, CONFIG.kart.characters[idx]);
      }
    }
    return anyRendered;
  }

  /**
   * Starts the 60 FPS live 3D turntable animation for the active selected card
   * while the Racer Selection screen is open.
   */
  startLive(charCards, getSelectedIdx) {
    this.stopLive();
    if (!this._initThree()) return;
    this.bindInteractiveCards(charCards);
    this._running = true;
    let lastNow = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const tick = (now) => {
      if (!this._running) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;
      this._clock += dt;
      if (!this._dragging) {
        this._turntableAngle += dt * 0.88;
      }
      const idx = typeof getSelectedIdx === 'function' ? getSelectedIdx() : 0;
      const card = charCards && charCards[idx];
      const canvas = card ? card.querySelector('canvas') : null;
      if (canvas) {
        this.renderCharacterToCanvas(
          idx,
          canvas,
          this._turntableAngle + this._userAngleOffset,
          this._clock
        );
      }
      this._rafId = requestAnimationFrame(tick);
    };

    this._rafId = requestAnimationFrame(tick);
  }

  /**
   * Stops the live 3D showroom loop immediately (called when leaving Racer Select or starting a race).
   */
  stopLive() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
  }
}

export const racerShowroom3D = new RacerShowroom3D();
