/**
 * Super Kart 3D.js — item boxes.
 * Glossy toon '?' boxes placed in pairs along the track. They bob + spin,
 * grant a kart a random power-up on contact (via RaceManager.pickupItem),
 * then respawn after the configured delay.
 *
 * Tries to adopt the track agent's toonMaterial() factory from
 * src/render/Materials.js when it is available; otherwise falls back to a
 * plain THREE.MeshToonMaterial. Never imports it statically so this module
 * stays independent of the track agent's file.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const BOX_COUNT = 10;

// --- optional adoption of the shared toon material factory -----------------
let _toonFactory = null;
let _toonResolved = false;
const _liveBoxes = new Set();

try {
  import('../render/MaterialLibrary.js')
    .then((m) => {
      _toonFactory = typeof m.getToonMaterial === 'function' ? m.getToonMaterial : null;
      _toonResolved = true;
      for (const box of _liveBoxes) box._rebuildMaterial();
    })
    .catch(() => {
      _toonResolved = true; // track agent file not present yet — keep fallback
    });
} catch {
  _toonResolved = true; // environments without dynamic import
}

// --- shared '?' canvas texture -------------------------------------------------
let _questionTex = null;

function questionTexture() {
  // Canvas textures need the DOM — headless environments (tests, SSR) get a
  // plain toon material instead; the '?' still reads via emissive tint.
  if (typeof document === 'undefined') return null;
  if (_questionTex) return _questionTex;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');

  // AUDIT (Feco visual QA + item-box audit, 2026-08-11): 'a cor dos cubos
  // de power up não está legal' — the cream bottom (#fbf3de) tinted the box
  // beige under ACES and the 16px white halo blurred the glyph. MK8D boxes
  // are PURE WHITE panels with a bold red '?': crisp white-to-cool-white
  // gradient, saturated #ef233c glyph with a tight dark outline, no halo.
  // AUDIT (visual auditor 2026-08-12): MK8D item boxes are TRANSLUCENT
  // cyan/magenta shells — the old opaque white texture hid the shell tint.
  // AUDIT R17 (FECO real-GPU 2026-08-14: 'boxes bem escuros'): fundo do
  // canvas era alpha 0 — map × color cyan = PRETO no corpo e '?' vermelho ×
  // cyan = roxo. Agora o canvas pinta o próprio fundo cyan translúcido e o
  // material usa color 0xffffff (o map carrega todas as cores exatas).
  const shellGrad = g.createLinearGradient(0, 0, size, size);
  shellGrad.addColorStop(0, 'rgba(70, 200, 255, 0.92)');
  shellGrad.addColorStop(1, 'rgba(24, 148, 224, 0.86)');
  g.fillStyle = shellGrad;
  g.fillRect(0, 0, size, size);
  // Rounded inner border — gold MK8-style trim reads as a pickup panel.
  g.strokeStyle = '#ffd166';
  g.lineWidth = 14;
  g.strokeRect(16, 16, size - 32, size - 32);
  g.strokeStyle = '#c9a227';
  g.lineWidth = 4;
  g.strokeRect(26, 26, size - 52, size - 52);
  // Big red '?' with a tight dark outline (no white halo — it blurred the
  // glyph at 128px).
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 188px "Baloo 2", "Nunito", Arial, sans-serif';
  g.lineWidth = 14;
  g.strokeStyle = '#7f1d1d';
  g.strokeText('?', size / 2, size / 2 + 8);
  g.fillStyle = '#ef233c';
  g.fillText('?', size / 2, size / 2 + 8);
  // AUDIT R71 (Feco real-GPU 2026-08-14: 'item box com PONTO BRANCO no meio
  // do ?'): o highlight dot (círculo branco 14px em 0.44,0.34) era um gloss
  // intencional mas lê como defeito — o usuário viu um ponto branco no meio
  // da interrogação. Removido (o '?' bold já tem contraste suficiente).

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _questionTex = tex;
  return tex;
}

// --- helpers ------------------------------------------------------------------
function kartPos(kart) {
  const g = kart.group;
  if (g && g.position) return g.position;
  const st = kart.state || {};
  return st.position || { x: 0, y: 0, z: 0 };
}

export class ItemBox {
  constructor(track, t, side) {
    this.track = track;
    this.t = t;
    this.side = side; // +1 = right of road, -1 = left
    this.active = true;
    this.respawnTimer = 0;
    this.bobPhase = Math.random() * Math.PI * 2;
    this.wobble = Math.random() * Math.PI * 2;
    this.size = CONFIG.items.boxRadius * 2; // cube edge length

    this.base = this._computeBase();
    this.mesh = this._buildMesh();
    _liveBoxes.add(this);
  }

  /** Center point + yaw on the road, offset laterally from the centerline. */
  _computeBase() {
    const path = this.track.path;
    const point = path.getPointAt(this.t);
    const tangent = path.getTangentAt(this.t);
    // perpendicular in the XZ plane
    const px = -tangent.z;
    const pz = tangent.x;
    const pl = Math.hypot(px, pz) || 1;
    const lateral = CONFIG.track.roadWidth * 0.32 * this.side;
    // AUDIT R6 (Feco real-GPU 2026-08-13: 'item boxes afundando na pista'):
    // a superfície VISUAL da pista é a ribbon em y+0.18 — a base em +0.05
    // afundava 13cm no asfalto. Base agora na ribbon (0.18).
    // AUDIT R7 (Feco: 'deveria flutuar, não colar no chão'): base 0.35m ACIMA
    // da ribbon — o bob (±0.18) anima em cima disso e a base NUNCA encosta
    // (0.35-0.18 = 0.17 > 0). Pickup é por distância XZ, então flutuar não
    // impede pegar.
    return {
      x: point.x + (px / pl) * lateral,
      y: point.y + 0.18 + 0.35 + this.size * 0.5,
      z: point.z + (pz / pl) * lateral,
      yaw: Math.atan2(tangent.x, tangent.z),
    };
  }

  _buildMesh() {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(this.size, this.size, this.size),
      this._makeMaterial()
    );
    mesh.position.set(this.base.x, this.base.y, this.base.z);
    mesh.rotation.y = this.base.yaw;
    mesh.castShadow = true;
    // Dark cartoon outline (inverted hull) so the box pops from the road.
    const outline = new THREE.Mesh(
      new THREE.BoxGeometry(this.size * 1.06, this.size * 1.06, this.size * 1.06),
      new THREE.MeshBasicMaterial({ color: 0x1b2a41, side: THREE.BackSide })
    );
    mesh.add(outline);
    // AUDIT FIX R15b (Feco real-GPU: 'o beam pode existir mas tinha que ser
    // MENOR que a item box'): recriado MENOR — raio máximo 0.55× o box
    // (antes 1.05× = maior que o box) + opacity 0.35 + SEM toneMapped:false
    // (a lição R14: additive+toneMapped:false+bloom estoura em branco no GPU
    // real; com toneMapped default o ACES mantém o dourado suave). O beam é
    // um brilho de chão contido, NÃO uma coluna maior que o box.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(this.size * 0.45, this.size * 0.55, this.size * 1.6, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffc94d,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    beam.position.set(this.base.x, Math.max(this.base.y - this.size * 0.8, 0.18), this.base.z);
    this.beam = beam;
    // AUDIT FIX R13f (Feco real-GPU: 'item boxes dentro de circulo branco' —
    // PERSISTE após R12f): o RING era um TorusGeometry(size*1.15) dourado com
    // AdditiveBlending + toneMapped:false + opacity 0.95. No GPU real com
    // bloom, um torus dourado aditivo com toneMapped:false ESTOURA EM BRANCO
    // PURO — um círculo branco ~15% MAIOR que o box (exatamente o que o Feco
    // descreve: 'item box dentro de círculo branco'). O flare R12f só expandia
    // esse ring; o anel BASE é a causa. O MK8 NÃO tem torus no item box (só o
    // glow suave do beam). REMOVIDO por completo — box + outline + beam lêem.
    // this.ring = new THREE.Group();
    // this.ring.position.set(this.base.x, this.base.y, this.base.z);
    // const ringGeo = new THREE.TorusGeometry(this.size * 1.15, 0.16, 10, 36);
    // const ringMat = new THREE.MeshBasicMaterial({
    //   color: 0xffd166, transparent: true, opacity: 0.95,
    //   depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    // });
    // const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    // ringMesh.rotation.x = Math.PI / 2;
    // ringMesh.position.y = -this.size * 0.55;
    // this.ring.add(ringMesh);
    // this.ringMesh = ringMesh;
    return mesh;
  }

  _makeMaterial() {
    const tex = questionTexture();
    if (tex) {
      // Unlit pickup panel: the toon gradient + warm scene light was tinting
      // the white-cream texture mustard (seen repeatedly in QA). A magic
      // pickup box reads as self-lit, so MeshBasicMaterial shows the exact
      // MK8-style colors: white panel, bold red '?'.
      // AUDIT (2026-08-11): single flat material read as a PLACARD from the
      // chase camera — per-face shading (material array) gives each side a
      // different value so the cube reads 3D while staying self-lit.
      // AUDIT (visual auditor 2026-08-12): MK8D item boxes are translucent
      // cyan/magenta shells with a bold '?', not white panels. Keep the '?'
      // texture but tint the shell cyan-blue at ~85% opacity.
      const mk = (color, opacity = 1) => {
        const m = new THREE.MeshBasicMaterial({ map: tex, color, transparent: opacity < 1, opacity });
        return m;
      };
      // AUDIT PERF-R27 (2026-08-14, auditoria performance): eram 6 materiais
      // (3× 0.97 + 3× 0.98) → 6 draw calls por box (60 calls/10 boxes).
      // O per-face shading (sides 0.97 / front 0.98) é o que faz o cubo ler
      // 3D (flat single = placard) — então 2 materiais COMPARTILHADOS
      // (mesma geometria, 2 grupos de faces) mantêm o look com 2 calls/box.
      // AUDIT R71b (Feco real-GPU: 'boxes ESCUROS'): transparent:true com
      // opacity 0.97/0.98 mandava o box pro pass transparente → escurecia.
      // Agora opacos (opacity 1) com cores de face levemente diferentes —
      // o shading 3D vem do MAT, não da transparência.
      const sideMat = mk(0x9adfff, 1);
      const frontMat = mk(0xc9f0ff, 1);
      // BoxGeometry material order: +x, -x, +y, -y, +z, -z
      return [sideMat, sideMat, frontMat, sideMat, frontMat, sideMat];
    }
    const opts = {
      color: 0xffb703,
      emissive: 0xff8f00,
      emissiveIntensity: 0.3,
    };
    if (_toonFactory && _toonResolved) {
      const mat = _toonFactory(0xffb703, opts);
      if (mat && typeof mat.dispose === 'function') return mat;
    }
    return new THREE.MeshToonMaterial(opts);
  }

  /** Swap to the shared toon factory once it loads (keeps the '?' texture). */
  _rebuildMaterial() {
    if (!_toonResolved || !_toonFactory) return;
    const old = this.mesh.material;
    this.mesh.material = this._makeMaterial();
    if (old) {
      const mats = Array.isArray(old) ? old : [old];
      for (const m of mats) { m.map = null; m.dispose?.(); } // '?' shared — never dispose it
    }
  }

  reset() {
    this.active = true;
    this.mesh.visible = true;
    this.mesh.scale.setScalar(1);
    this._shrinkT = undefined;
    this._spawnT = undefined;
    if (this.beam) this.beam.visible = true;
    if (this.ring) this.ring.visible = true;
    this.respawnTimer = 0;
  }

  /**
   * update(dt, karts, raceManager)
   * Bob + wobble animation, pickup detection (distance < pickupRadius and an
   * empty held-item slot), respawn countdown while consumed.
   */
  update(dt, karts, raceManager) {
    this.bobPhase += dt * CONFIG.items.boxBobSpeed;
    this.wobble += dt * 2.4;

    if (!this.active) {
      this.respawnTimer -= dt * 1000;
      // AUDIT FIX R12f (Feco real-GPU: 'item box com circulo branco estranho
      // no lugar'): o FLARE do anel (R11) expandia o ring dourado a 3.2x com
      // additive + toneMapped:false — no GPU real com bloom, o torus dourado
      // estourava em BRANCO puro. Removido o flare: o ring simplesmente
      // ESCONDE no instante em que o box é consumido (sem expandir).
      if (this.ring) this.ring.visible = false;
      this._flareT = 1; // desliga qualquer flare residual
      // AUDIT: shrink no pickup (0.18s) e pop-in no respawn (0.15s).
      if (this._shrinkT !== undefined) {
        this._shrinkT = Math.min(1, this._shrinkT + dt * 5.5);
        this.mesh.scale.setScalar(Math.max(0.08, (1 - this._shrinkT) ** 2));
        if (this._shrinkT >= 1) { this.mesh.visible = false; this._shrinkT = undefined; }
      } else if (this._spawnT !== undefined && this._spawnT < 1) {
        this._spawnT = Math.min(1, this._spawnT + dt * 6.5);
        const e = 1 - (1 - this._spawnT) ** 2;
        this.mesh.scale.setScalar(Math.max(0.001, e));
        if (this.beam) this.beam.visible = true;
        if (this.ring) this.ring.visible = true;
      }
      if (this.respawnTimer <= 0) {
        this.active = true;
        this.mesh.visible = true;
        this.mesh.scale.setScalar(0.001);
        this._spawnT = 0;
        this._flareT = undefined; // AUDIT R11: reset do flare no respawn
        this.respawnTimer = 0;
      }
      return;
    }

    // AUDIT FIX 2026-08-16 (Feco real-GPU: 'às vezes nem aparece o item
    // box'): o pop-in do spawn rodava no branch INATIVO, mas o respawn seta
    // active=true no mesmo frame → o pop-in NUNCA executava e o box ficava
    // com scale 0.001 (invisível) para sempre. Movido para o branch ATIVO.
    if (this._spawnT !== undefined && this._spawnT < 1) {
      this._spawnT = Math.min(1, this._spawnT + dt * 6.5);
      const e = 1 - (1 - this._spawnT) ** 2;
      this.mesh.scale.setScalar(Math.max(0.001, e));
      if (this.beam) this.beam.visible = true;
      if (this.ring) this.ring.visible = true;
    }

    const bob = Math.sin(this.bobPhase) * 0.18;
    this.mesh.position.y = this.base.y + bob;
    // Continuous slow spin (MK8 pickup box) + a little wobble.
    this.mesh.rotation.y = this.base.yaw + Math.sin(this.wobble) * 0.1 + this.bobPhase * 0.55;
    // AUDIT FIX R15b: beam recriado (menor, 0.55x) — animação de bob/pulse.
    if (this.beam) {
      this.beam.position.y = Math.max(this.base.y - this.size * 0.8, 0.18) + bob * 0.5;
      this.beam.material.opacity = 0.3 + Math.sin(this.bobPhase * 1.3) * 0.08; // 0.22–0.38 (sutil)
    }
    // AUDIT FIX R13f: ring removido (círculo branco) — sem update de anel.
    // if (this.ring) { ... } — código morto, removido por clareza.
    // Golden sparkles rising from the box (pickup aura — the missing "alive"
    // cue the vision critic kept flagging). Cheap: ~5 sparks every 0.18s.
    this._sparkAcc = (this._sparkAcc || 0) + dt;
    if (this._sparkAcc >= 0.18) {
      this._sparkAcc = 0;
      raceManager?.particles?.emit?.('sparkle', {
        x: this.mesh.position.x + (Math.random() - 0.5) * this.size * 0.8,
        y: this.mesh.position.y - this.size * 0.4,
        z: this.mesh.position.z + (Math.random() - 0.5) * this.size * 0.8,
      }, { count: 5, speed: 2.2, size: 0.2, color: 0xffd166, gravity: -1.5 });
    }

    const list = karts || [];
    const r = CONFIG.items.pickupRadius;
    const rr = r * r;
    for (const kart of list) {
      if (kart.finished || kart.heldItem) continue;
      const p = kartPos(kart);
      const dx = p.x - this.mesh.position.x;
      const dz = p.z - this.mesh.position.z;
      if (dx * dx + dz * dz < rr) {
        raceManager?.pickupItem?.(kart);
        this._consume();
        break;
      }
    }
  }

  _consume() {
    this.active = false;
    // AUDIT: pickup pop — o box encolhe em ~0.18s (MK8D comprime no grab)
    // em vez de sumir instantaneamente; beam/ring morrem junto.
    this._shrinkT = 0;
    this.mesh.scale.setScalar(1);
    if (this.beam) this.beam.visible = false;
    if (this.ring) this.ring.visible = false;
    this.respawnTimer = CONFIG.game.itemBoxRespawnMs ?? CONFIG.items.itemBoxRespawnMs ?? 6000;
  }
}

/**
 * Place item boxes along the track: a side-by-side PAIR just before the
 * first corner (the genre's classic), then singles alternating sides.
 * Deterministic jitter keeps spacing organic without RNG.
 */
export function createItemBoxes(track, count = 12) {
  const boxes = [];
  // Start pair: two boxes across the road on the START STRAIGHT (the old
  // 0.085 sat on the new city's top-left corner apex — AUDIT 2026-08-11).
  boxes.push(new ItemBox(track, 0.045, 1));
  boxes.push(new ItemBox(track, 0.07, -1));
  const jitter = [0.0, 0.016, -0.024, 0.031, -0.018, 0.022, -0.027, 0.014, -0.02, 0.026];
  const rest = Math.max(0, count - 2);
  for (let i = 0; i < rest; i++) {
    // 0.16 start: clears the top-left corner (0.14 was on its apex).
    const t = 0.16 + (i / rest) * 0.78 + jitter[i % jitter.length];
    const side = i % 2 === 0 ? 1 : -1;
    boxes.push(new ItemBox(track, Math.min(Math.max(t, 0.001), 0.999), side));
  }
  return boxes;
}
