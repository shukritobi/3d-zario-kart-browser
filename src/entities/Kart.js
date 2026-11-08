/**
 * Super Kart 3D.js — Kart entity.
 * AAA cartoon kart: low wide PBR chassis (glossy clearcoat paint, matte
 * rubber, polished chrome, transparent glass), 4 wheels (spin + front
 * steering), molded shell with panel seams + side intakes + splitter,
 * shaped rear wing, and an expressive driver leaning forward gripping the
 * steering wheel. Owns the kart's visual state + effect timers; delegates
 * movement to KartPhysics.step(). Emits juice particles (exhaust / boost
 * flame / drift smoke / star trail / off-road dust) via ctx.particles.
 *
 * Group origin sits at ground contact (y = 0 = road), so squash & stretch
 * scales up from the wheels — the classic cartoon deformation.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import * as Materials from '../render/Materials.js';
import { getToonMaterial, getPlasticMaterial, getCartoonOutlineMaterial } from '../render/MaterialLibrary.js';
import { PowerUpType } from './PowerUp.js';
import { KartPhysics } from './KartPhysics.js';

const OUTLINE = 0x1b2a41;

/** AUDIT R18 (freeze no Start Game): visor canvases são determinísticos por
 *  (character.name + accent) — cache global evita redesenhar 6× em cada
 *  startRace()/restartRace(). */
const _visorCache = new Map();

// AUDIT r7: finished-kart celebration duration (ms) — the wheelie hop runs
// this long; the checkered flag stays up afterwards.
const KART_FINISH_MS = 1400;

/** Held-item bubble colors (PowerUpType value → orb tint). */
const HELD_ITEM_COLORS = {
  mushroom: 0xff5a5f,
  shell: 0x43d64b,
  red_shell: 0xff3b3b,
  banana: 0xffd166,
  star: 0xffd700,
  lightning: 0x2ec4ff,
  blue_shell: 0x1f3fc8,
};

// AUDIT r8: floating rank arrows (MK8D) — one pooled canvas texture per
// ordinal (1-8), built lazily on first use and shared across ALL karts.
// Deterministic: no per-frame allocation, no Math.random.
const RANK_ARROW_MAX = 8;
const RANK_ARROW_COLORS = { 1: '#ffd700', 2: '#e8e8e8', 3: '#e08a4e' }; // gold/silver/bronze
const _rankArrowTextures = new Map();

function _rankArrowTexture(n) {
  let tex = _rankArrowTextures.get(n);
  if (tex) return tex;
  try {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    const color = RANK_ARROW_COLORS[n] || '#ffffff';
    // Upward arrow head + shaft (MK8D-style pointer above the kart).
    g.strokeStyle = color;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 15;
    g.beginPath();
    g.moveTo(64, 12);   // head tip
    g.lineTo(27, 46);   // left wing
    g.moveTo(64, 12);
    g.lineTo(101, 46);  // right wing
    g.moveTo(64, 34);
    g.lineTo(64, 58);   // shaft down into the badge
    g.stroke();
    // Dark translucent badge holding the ordinal.
    g.fillStyle = 'rgba(12, 16, 26, 0.74)';
    g.beginPath();
    g.arc(64, 84, 40, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = color;
    g.stroke();
    g.fillStyle = color;
    g.font = '800 46px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 64, 86);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    _rankArrowTextures.set(n, tex);
  } catch {
    tex = null; // no DOM (node smoke tests) — arrow stays hidden
  }
  return tex;
}

export class Kart {
  /**
   * @param {object} opts
   * @param {number} opts.color         — kart body color (hex); wins over character.color when given
   * @param {object} opts.character     — identity from CONFIG.kart.characters
   *   {name, color, suitColor, helmetColor, accentColor, stats}
   * @param {boolean} opts.isPlayer     — player kart?
   * @param {THREE.Vector3} opts.startPosition
   * @param {number} opts.startHeading  — radians
   */
  constructor({ color, isPlayer = false, number = 1, startPosition, startHeading = 0, character = null }) {
    this.isPlayer = isPlayer;
    this.number = number;
    this.character = character;
    this.characterName = character ? character.name : null;
    // Save the grid position/heading — Kart.restart() relies on them to
    // actually reset the race (was missing → restart "continued where it left").
    this.startPosition = startPosition ? startPosition.clone() : new THREE.Vector3();
    this.startHeading = startHeading;
    this.group = new THREE.Group();
    this.group.name = isPlayer ? 'kart-player' : 'kart-ai';

    this.rideHeight = CONFIG.kart.wheelRadius + 0.04;
    this.state = {
      speed: 0,
      position: (startPosition ? startPosition.clone() : new THREE.Vector3()),
      heading: startHeading,
      drifting: false,
      driftCharge: 0,
      boost: false,
      turboBoostMs: 0, // turbo pad boost timer (ms); KartPhysics sets, _tickEffects drains
      offRoad: false,
      spinOut: false,
      lap: 0,
      progress01: 0,
      finished: false,
      vY: 0,

      wrongWayTimer: 0,

      wrongWayCooldown: 0,
            wrongWayTimer: 0,
            wrongWayCooldown: 0,
    };

    // RaceManager-owned (contract)
    this.finished = false;
    this.position = 0; // race rank
    this.totalTime = 0;
    this.heldItem = null;
    // AUDIT r4: rear-throw arm flag — main.js sets it before a release that
    // crossed the hold threshold; PowerUp.useItem reads + consumes it.
    this._rearThrow = false;
    // AUDIT r3: second held-item slot (MK8 dual-slot) + triple-item stacks.
    this.heldItem2 = null; // reserve slot (swap key / click swaps with heldItem)
    this._heldItemCount = 1; // stack size for heldItem (1 = single, 3 = triple)
    this._heldItem2Count = 1; // stack size for heldItem2
    this._coins = 0; // coin pickups: +1% maxSpeed each (cap CONFIG.items.coinSpeedCap)

    // effect flags / timers (ms)
    this.invincible = false;
    this.starred = false;
    // AUDIT r7: finished-kart celebration (wheelie hop + checkered flag).
    this._finishActive = false;
    this._finishMs = 0;
    // AI rubber-band override base (must not leak across restarts — audit F9).
    // The public `cruiseSpeed` getter/setter below folds the coin bonus into
    // whatever KartPhysics targets every frame (see get/set cruiseSpeed).
    this._baseCruise = undefined;
    this._boostMs = 0;
    this._starMs = 0;
    this._invMs = 0;
    this._invCount = 0;
    this._spinMs = 0;
    this._spinDir = 1;

    // physics private state (mutated by KartPhysics)
    this._scaleTarget = 1;
    this._scaleMs = 0;
    this._slowFactor = 1; // lightning-only slow (AUDIT: squash visual must not tax speed)
    this._slowMs = 0;
    this._latVel = 0;
    this._airTime = 0;
    this._nudgeVel = new THREE.Vector3();
    this._lastProgress = 0;
    this._sampleIndex = 0;
    this._samples = null;
    this._prevY = 0;
    this._bounce = 0;
    this._bounceTimer = 0;
    this._startDir = new THREE.Vector3(0, 0, 1);
    this._trickArmed = false;

    // Held-item bubble (audit v5 #1: a recolored orb isn't the item — MK8
    // shows the actual item). Mini toon meshes per type + orb fallback.
    this.heldItemGroup = new THREE.Group();
    this.heldItemGroup.position.set(0, 0.72, -0.72);
    this._itemRear = false; // AUDIT r4: rear-aim armed (bubble flipped across the kart)
    this._heldMeshes = {};
    // mushroom: red cap + white stem
    const mush = new THREE.Group();
    mush.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), this._mat(0xff5a5f)));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.1, 8), this._mat(0xf4f6f8));
    stem.position.y = -0.1;
    mush.add(stem);
    mush.scale.setScalar(0.95);
    this._heldMeshes.mushroom = mush;
    // shell family: squashed sphere, tinted per type
    const mkShell = (c) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), this._mat(c));
      s.scale.set(0.75, 1, 1.15);
      return s;
    };
    this._heldMeshes.shell = mkShell(0x43d64b);
    this._heldMeshes.red_shell = mkShell(0xff3b3b);
    this._heldMeshes.blue_shell = mkShell(0x1f3fc8);
    // banana: tilted yellow cylinder
    const ban = new THREE.Group();
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.24, 10), this._mat(0xffd166));
    b1.rotation.z = 0.45;
    ban.add(b1);
    this._heldMeshes.banana = ban;
    // star: flattened gold octahedron
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), this._mat(0xffd700));
    star.scale.set(1, 0.7, 1);
    this._heldMeshes.star = star;
    // lightning / anything else: colored orb fallback
    this._heldOrb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this._heldOrbMat = this._heldOrb.material;
    this.heldItemGroup.add(this._heldOrb);
    // AUDIT FIX 2026-08-16 (Feco real-GPU: 'bolinha azul com um anel branco
    // do nada na traseira'): o TORUS branco ao redor do orbe lia como anel
    // flutuante quando o item era lightning (orbe azul). Removido — o orbe
    // colorido sozinho já comunica o item.
    for (const key of Object.keys(this._heldMeshes)) this.heldItemGroup.add(this._heldMeshes[key]);
    this.heldItemGroup.visible = false;
    this.group.add(this.heldItemGroup);

    // Second held-item bubble (audit r3 dual-slot): smaller orb behind the
    // main one, tinted per type; scales up while a triple stack is queued.
    this.heldItem2Group = new THREE.Group();
    this.heldItem2Group.position.set(-0.3, 0.52, -0.88);
    this._held2Orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this._held2OrbMat = this._held2Orb.material;
    this.heldItem2Group.add(this._held2Orb);
    // AUDIT FIX 2026-08-16 (Feco real-GPU: 'bolinha com anel aparecendo
    // atrás do carro após pegar item'): o torus branco do slot RESERVA
    // (dual slot) também lia como anel flutuante. Removido — orbe colorido
    // sozinho, igual ao slot principal.
    this.heldItem2Group.visible = false;
    this.group.add(this.heldItem2Group);

    this._controls = { steer: 0, throttle: false, brake: false, drift: false, useItem: false, swapItem: false };
    this._swapWasDown = false;
    this._steerTarget = 0;

    // particle emitters (local-space offsets, manual world transform — no matrix dependency)
    this._pipeOffset = new THREE.Vector3(0, this.rideHeight + 0.16, -0.94);
    this._exhaustAcc = 0;
    this._driftAcc = 0;
    this._dustAcc = 0;
    this._starAcc = 0;
    this._sideFlip = 1;
    this._t = 0;
    this._boostVisPrev = false; // AUDIT: rising-edge boost sparkle
    this._driftTier = 0;        // AUDIT: drift tier spark crossing
    this._lineAcc = 0;          // AUDIT: high-speed wind streaks

    // scratch (no per-frame allocation)
    this._v = new THREE.Vector3();
    this._pv = new THREE.Vector3();
    this._back = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._starColor = new THREE.Color();

    // Body color: explicit `color` opt wins (menu picker); otherwise the
    // character's identity color, falling back to the classic default.
    const bodyColor = color !== undefined ? color : (character ? character.color : 0xff5a5f);
    this._buildMesh(bodyColor, character);

    // AUDIT r7: finished-kart celebration — a mini checkered flag on a thin
    // pole above the tail. Hidden until the kart crosses the finish line;
    // the wheelie hop is animated in update().
    this._finishFlag = new THREE.Group();
    this._finishFlag.visible = false;
    const flagPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.024, 0.7, 8),
      this._mat(0x2b3340)
    );
    flagPole.position.set(0, 1.1, -0.5);
    this._finishFlag.add(flagPole);
    // Small checkered cloth — local 4x3 canvas (Materials.checkerTexture is
    // a road-stripe 2x8, wrong aspect for a flag).
    const flagCanvas = document.createElement('canvas');
    flagCanvas.width = 64;
    flagCanvas.height = 48;
    const fg = flagCanvas.getContext('2d');
    const cw = 64 / 4;
    const ch = 48 / 3;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        fg.fillStyle = (i + j) % 2 === 0 ? '#ffffff' : '#10141c';
        fg.fillRect(i * cw, j * ch, cw + 1, ch + 1); // +1 hides AA seams
      }
    }
    const flagTex = new THREE.CanvasTexture(flagCanvas);
    flagTex.colorSpace = THREE.SRGBColorSpace;
    flagTex.anisotropy = 4;
    this._flagCloth = new THREE.Mesh(
      new THREE.PlaneGeometry(0.46, 0.3),
      new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide })
    );
    this._flagCloth.position.set(-0.24, 1.36, -0.5);
    this._finishFlag.add(this._flagCloth);
    this.group.add(this._finishFlag);

    // AUDIT r8: floating rank arrow (MK8D) — canvas arrow + ordinal above the
    // kart, parented to this.group so it follows every move/tumble.
    // Hidden until RaceManager reveals it mid-race via setRankVisible().
    // AUDIT r9 (vision critic): the arrows dominated the frame and hid the
    // karts — scale 1.0 → 0.62, raised 2.2 → 2.6 so they read without
    // covering the vehicles.
    this._rankVisible = false;
    this._rankPos = 0;
    this._rankArrow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: null,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }));
    // AUDIT r9/r10 (vision critic): arrows still read as large badges —
    // 0.5 → 0.4 keeps the cue barely-there at race speed.
    this._rankArrow.scale.set(0.4, 0.4, 1);
    this._rankArrow.position.set(0, 2.8, 0);
    this._rankArrow.renderOrder = 10; // draws above scenery (MK8D arrows stay readable)
    this._rankArrow.visible = false;
    this.group.add(this._rankArrow);

    this.group.position.copy(this.state.position);
    this.group.rotation.y = startHeading;
  }

  // ---- construction -------------------------------------------------------

  _mat(color, opts = {}) {
    if (typeof getToonMaterial === 'function') return getToonMaterial(color, opts);
    return new THREE.MeshToonMaterial({ color, gradientMap: this._gradientTexture(), ...opts });
  }

  _gradientTexture() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 1;
      const g = canvas.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 4, 0);
      grad.addColorStop(0, '#4a4a4a');
      grad.addColorStop(0.5, '#9a9a9a');
      grad.addColorStop(1, '#ffffff');
      g.fillStyle = grad;
      g.fillRect(0, 0, 4, 1);
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      return tex;
    } catch {
      return null; // no DOM (node smoke tests) — MeshToonMaterial default gradient
    }
  }

  _outline(mesh, thickness = 0.03) {
    if (typeof Materials.cartoonOutline === 'function') {
      Materials.cartoonOutline(mesh, OUTLINE, thickness);
      return;
    }
    // fallback: inverted hull
    const hull = new THREE.Mesh(
      mesh.geometry.clone(),
      new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide })
    );
    hull.scale.setScalar(1 + thickness);
    hull.castShadow = false;
    mesh.add(hull);
  }

  _mesh(geo, mat, x, y, z, { cast = true, rx = 0, ry = 0, rz = 0, parent } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = cast;
    (parent || this.group).add(m);
    return m;
  }

  /** Expressive driver face drawn on the helmet visor (canvas texture).
   *  The face is painted at the sphere's front band (u ≈ 0.25, the +Z face
   *  of SphereGeometry) with eyes (accent irises) + mouth + brows. The
   *  expression variant is DETERMINISTIC — hashed from the character name
   *  (no Math.random). @returns {THREE.CanvasTexture} */
  _visorTexture(character, accent) {
    // AUDIT R18 (Feco real-GPU: 'freeze ao clicar Start Game'): canvas era
    // recriado em CADA startRace (6 karts × visor desenhado síncrono). O
    // visor é determinístico por (character.name + accent) — cache global.
    const key = `${(character && character.name) || '?'}_${(accent != null ? accent.toString(16) : 'none')}`;
    if (_visorCache.has(key)) return _visorCache.get(key);
    const w = 256, h = 128;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    // Dark reflective visor glass (vertical gradient).
    const vg = g.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, '#0a1420');
    vg.addColorStop(0.45, '#14293e');
    vg.addColorStop(0.6, '#0e1e30');
    vg.addColorStop(1, '#0a1420');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
    // Sheen streak (glass reflection).
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.ellipse(w * 0.6, h * 0.3, w * 0.16, h * 0.06, -0.1, 0, Math.PI * 2);
    g.fill();
    // Deterministic expression variant from the character name.
    const name = (character && character.name) || '';
    let seed = 7;
    for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) | 0;
    const variant = Math.abs(seed) % 3; // 0 confident smile · 1 open grin · 2 focused
    const accentCss = '#' + new THREE.Color(accent).getHexString();
    const fx = w * 0.25; // sphere front (+Z) band center
    const eyeY = h * 0.44;
    const eyeDX = 8; // eyes 16px apart (≈22° around the visor front)
    const ink = '#b9c9da'; // light stroke reads on the dark glass
    // Eyebrows (above the eyes, angled per variant).
    g.strokeStyle = ink;
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    for (const s of [-1, 1]) {
      const bx = fx + s * eyeDX;
      const tilt = variant === 2 ? 0.15 : variant === 1 ? -0.3 : 0.22;
      const browY = eyeY - 8 - (variant === 1 ? 3 : 0);
      g.beginPath();
      g.moveTo(bx - 5, browY);
      g.lineTo(bx + 5, browY + tilt * 6);
      g.stroke();
    }
    // Eyes — white sclera + accent iris + dark pupil + glint.
    for (const s of [-1, 1]) {
      const ex = fx + s * eyeDX;
      g.fillStyle = '#f4f8ff';
      g.beginPath();
      g.ellipse(ex, eyeY, 4.5, 5.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = accentCss;
      g.beginPath();
      g.arc(ex, eyeY + 0.5, 2.6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#10151c';
      g.beginPath();
      g.arc(ex, eyeY + 0.5, 1.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.arc(ex - 1.2, eyeY - 1.2, 1.1, 0, Math.PI * 2);
      g.fill();
    }
    // Mouth — variant styling.
    const mx = fx, my = h * 0.55;
    g.strokeStyle = ink;
    g.lineWidth = 2.6;
    g.lineCap = 'round';
    if (variant === 0) {
      g.beginPath();
      g.arc(mx, my - 1, 4.5, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    } else if (variant === 1) {
      g.fillStyle = '#060a10';
      g.beginPath();
      g.ellipse(mx, my, 4.6, 3.6, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 1.6;
      g.stroke();
      g.fillStyle = '#e2695e';
      g.beginPath();
      g.ellipse(mx, my + 1.4, 3.2, 1.8, 0, 0, Math.PI * 2);
      g.fill();
    } else {
      g.beginPath();
      g.arc(mx, my, 2.6, 0, Math.PI * 2);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    _visorCache.set(key, tex);
    return tex;
  }

  _buildMesh(color, character) {
    const KC = CONFIG.kart;
    const accent = character ? character.accentColor : 0xffd166;
    // Premium pass — expose identity colors to the driver/rim visuals
    // (gloves, hub caps, visor irises). bodyColor = kart paint, accent =
    // character accent; both stay live for setBodyColor consumers.
    this.bodyColor = color;
    this.accent = accent;

    // ---- PBR materials (distinct surface responses, MK8 pipeline) -----------
    // Glossy painted plastic for the body shell — the MK8 painted-toy cue:
    // clearcoat + bumped IBL so the paint visibly reflects.
    const carPaint = Materials.plasticMaterial(color, { envMapIntensity: 3.2, roughness: 0.2 }); // AUDIT R11: 2.8→3.2
    // AUDIT (visual auditor 2026-08-12): Neon night IBL is weak — clearcoat
    // paint read as dark wine. A subtle self-emissive (15% of body color)
    // lifts the shell off the asphalt without looking lit-from-within.
    carPaint.emissive = new THREE.Color(color).multiplyScalar(0.45); // AUDIT R16d: 0.32→0.45 — hero POP (crítico: 'kart se funde com a pista'; sem PointLight que suje o asfalto, o corpo precisa de mais self-emissive p/ separar do fundo)
    carPaint.emissiveIntensity = 1.0; // AUDIT R5+ (R11: 0.7→1.0): lift p/ leitura no headless sem envmap
    const body = this._mat(color);
    const bodyDark = this._mat(new THREE.Color(color).multiplyScalar(0.82).getHex());
    // keep refs so the player can repaint (setBodyColor)
    this._bodyMat = body;
    this._bodyDarkMat = bodyDark;
    this._carPaintMat = carPaint;
    // Matte trim plastic (splitter, intakes, arches, cockpit rim).
    const dark = this._mat(0x232833);
    // Dead-flat rubber (tires) — deliberately NOT glossy: roughness 0.95
    // against the clearcoat paint = the MK8 material separation.
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x252b34, roughness: 0.9, metalness: 0.05, emissive: 0x0e1218, emissiveIntensity: 0.35 }); // AUDIT R11: pneu MUITO escuro (MK8) — contraste pneu/aro
    const tireDark = new THREE.MeshStandardMaterial({ color: 0x0a0d11, roughness: 0.98, metalness: 0 });
    // Polished chrome (rims, hubs, exhaust) — mirror metal vs painted plastic.
    // AUDIT r9: envMapIntensity 2.4 made rims read as broken white flashes on
    // software GL (no real envmap) — 1.4 keeps them silver, not artifact.
    const chrome = new THREE.MeshPhysicalMaterial({
      color: 0xdde4ec, metalness: 0.85, roughness: 0.18, envMapIntensity: 1.4,
    });
    // AUDIT r11 (FECO real-GPU): the mirror-chrome rim spokes reflected the
    // environment differently per spoke → 'aro bagunçado, elementos em
    // direção diferente'. MK8 rims are SATIN silver, not mirrors. The rim
    // parts get a flatter metal; chrome stays for the exhaust.
    const rimChrome = new THREE.MeshPhysicalMaterial({
      color: 0xaeb6c0, metalness: 0.5, roughness: 0.4, envMapIntensity: 0.9, // AUDIT R75+R11: 0.7→0.9 — aro satin mais vivo contra pneu escuro
      emissive: 0x2a333f, emissiveIntensity: 0.35, // AUDIT R6c: subtle self-glow so rim spokes never vanish on dark asphalt
    });
    // Curved transparent PBR glass (windshield).
    const glassPBR = new THREE.MeshPhysicalMaterial({
      color: 0xa8d8ff, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.5,
      envMapIntensity: 2.0, depthWrite: false, clearcoat: 1.0, clearcoatRoughness: 0.1,
    });
    const white = this._mat(0xf4f6f8);
    const skin = this._mat(0xffd9b3);
    // Subtle emissive headlight lens.
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff6e0, emissive: 0xfff2d0, emissiveIntensity: 1.0, roughness: 0.25,
    });
    const tip = this._mat(0xff9f45);
    // Premium pass materials — accent gloves + hub caps, red brake calipers,
    // and the dark fake-AO chassis (barely visible under the molded hull).
    const gloveMat = this._mat(accent);
    const hubCapMat = this._mat(accent);
    const caliperMat = new THREE.MeshStandardMaterial({ color: 0xc22a24, roughness: 0.45, metalness: 0.25 });
    const chassisMat = new THREE.MeshStandardMaterial({ color: 0x0b0e13, roughness: 0.55, metalness: 0.35 }); // AUDIT R8: polido (MK8) — antes fosco demais 0.9/0.1

    // Soft blob shadow under the kart (cartoon contact shadow). Radial
    // gradient texture (soft edge — a hard circle read as a decal per the
    // vision critic). depthWrite off + polygonOffset so it never z-fights.
    const blobTex = (() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 6, 32, 32, 32);
      // AUDIT FIX R12k (Feco real-GPU: 'anéis pretos nas rodas'/'círculos
      // pretos no asfalto'): o blob R11 tinha núcleo 0.92 + raio 1.0 — no GPU
      // real lia como CÍRCULO PRETO PINTADO no chão (não sombra), e da chase
      // cam parecia um anel na base das rodas. Sombra de contato real é
      // SUTIL: núcleo ~0.45, queda suave até 1.35m (transição imperceptível).
      // AUDIT FIX R13e (playtest-sim: 'círculos pretos duros sob os karts
      // AI no grid'): o kart já tem castShadow=true (sombra projetada REAL) —
      // o blob é redundante. Núcleo 0.45 → 0.16, raio 1.35 → 1.8: ancoragem
      // preservada (cai p/ 0 em 1.8m) mas sem círculo visível no chão.
    grad.addColorStop(0, 'rgba(0,0,0,0.12)'); // AAA pass: grounding sutil do kart sem voltar à mancha preta
    grad.addColorStop(0.4, 'rgba(0,0,0,0.04)');
    grad.addColorStop(0.75, 'rgba(0,0,0,0.015)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; // AUDIT PERF-R36: gradiente plano — mipmaps desnecessários
      return t;
    })();
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(1.2, 24), // SK3D FIX (2026-08-20, Feco real-GPU): 1.8→1.2 — blob grande lia como "mancha escura que segue o kart"
      new THREE.MeshBasicMaterial({
        map: blobTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
    );
    blob.scale.set(1, 1, 0.7); // narrower across the kart, longer along it
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    blob.renderOrder = 1;
    this.group.add(blob);
    this._blob = blob; // AUDIT r7: counter-tilt keeps the shadow flat during the wheelie

    // ---- molded shell (48-segment lathe lozenge) -----------------------------
    // Continuous molded body: a high-segment lathe hull (nose→body→tail) in
    // glossy clearcoat paint. No fat inverted-hull outlines on the big painted
    // parts: PBR needs bare surface, and panel seams carry the detail read.
    const hullProfile = [
      new THREE.Vector2(0.02, 0.34),
      new THREE.Vector2(0.26, 0.40),
      new THREE.Vector2(0.44, 0.50),
      new THREE.Vector2(0.52, 0.60),
      new THREE.Vector2(0.56, 0.70), // widest hips of the shell
      new THREE.Vector2(0.53, 0.79),
      new THREE.Vector2(0.42, 0.87),
      new THREE.Vector2(0.26, 0.925),
      new THREE.Vector2(0.0, 0.96),
    ];
    const hull = new THREE.Mesh(new THREE.LatheGeometry(hullProfile, 48), carPaint);
    hull.name = 'hull'; // AAA-2: nomeado p/ _applyBodyClass (variantes de silhueta)
    hull.scale.set(1, 0.72, 1.5); // AUDIT: lower body (MK8: wheels dominate the silhouette; old top y0.96 → ~0.79)
    hull.castShadow = true;
    this.group.add(hull);
    // Player-only silhouette cue: a restrained toon contour keeps the hero
    // readable against Neon bloom and Meadow asphalt without a bright halo.
    if (this.isPlayer) this._outline(hull, 0.018);
    // Recessed cockpit tub — a dark dish sunk into the shell top; the driver
    // sits in it (the MK8 cockpit-opening read instead of a flat deck).
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 18), dark);
    // AUDIT: cockpit opening — the dark dish floated 0.13m ABOVE the closed
    // dome (hull top y≈0.69) like a saucer. Sunk into the shell, the driver
    // emerges from the tub (MK8 'sunk-in' silhouette) instead of sitting on it.
    cockpit.position.set(0, 0.66, -0.14);
    cockpit.scale.set(0.95, 0.42, 0.8); // top at ~0.80 — torso (0.675) pokes in
    cockpit.castShadow = false;
    this.group.add(cockpit);
    // Molded nose cowl (rounded prow) + tail cap.
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 24), carPaint);
    nose.position.set(0, 0.6, 0.62);
    nose.scale.set(0.85, 0.5, 0.55);
    nose.castShadow = true;
    this.group.add(nose);
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), carPaint);
    tail.position.set(0, 0.62, -0.6);
    tail.scale.set(0.85, 0.5, 0.45);
    tail.castShadow = true;
    this.group.add(tail);
    // Rear side pods — fill the chase-cam silhouette between wing and body.
    for (const s of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), carPaint);
      pod.position.set(s * 0.5, 0.6, -0.55);
      pod.scale.set(0.9, 0.8, 1.6);
      pod.castShadow = true;
      this.group.add(pod);
    }
    // R12 engine-cover fin (MK8 Standard kart): barbatana dorsal atrás do
    // cockpit — degrau de silhueta entre o piloto e a asa.
    const finCover = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.3), bodyDark);
    finCover.position.set(0, 0.83, -0.55);
    finCover.rotation.x = 0.12;
    finCover.castShadow = false;
    this.group.add(finCover);

    // Fake AO under the shell — a dark chassis tub + side skirts, barely
    // visible in the shadow gap below the molded hull. Reads as a grounded
    // dark underside (cheap ambient occlusion) instead of floating paint.
    const aoChassis = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.16, 1.4), chassisMat);
    aoChassis.position.set(0, 0.25, -0.02);
    aoChassis.castShadow = false;
    this.group.add(aoChassis);
    for (const s of [-1, 1]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.17, 1.15), chassisMat);
      skirt.position.set(s * 0.44, 0.27, -0.05);
      skirt.castShadow = false;
      this.group.add(skirt);
    }

    // Fender flares — molded PAINTED arches over every wheel (same clearcoat
    // as the shell = merged bodywork, not stuck-on black) + a dark inner lip
    // AUDIT FIX 2026-08-16 (Feco real-GPU: 'anéis nas rodas'): o flare
    // semicircular (TorusGeometry 0.24, y 0.52) cruzava o pneu (topo 0.68)
    // e sobressaía 8cm — lia como ANEL sobre a roda, principalmente quando
    // a cor do kart contrastava com o pneu. O para-lama é redundante: o
    // pneu + aro + cubo já leem. Removido por completo (lip já havia saído).
    // const flareGeo = new THREE.TorusGeometry(0.24, 0.05, 12, 28, Math.PI);
    // flareGeo.rotateY(Math.PI / 2);
    // const archLipGeo = new THREE.TorusGeometry(0.22, 0.02, 10, 26, Math.PI);
    // archLipGeo.rotateY(Math.PI / 2);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // flare removido — o pneu lê sozinho (MK8 karts não têm para-lama
        // de arco na carenagem; o corpo cobre o topo da roda).
      }
    }

    // Side intakes — stepped dark scoops on the flanks (molded vent panels).
    // R12: grade texturizada sobre a boca do vent (entrada de duto visível).
    const grilleMat = new THREE.MeshBasicMaterial({
      map: Materials.grilleTexture(),
      transparent: true,
      depthWrite: false,
    });
    for (const s of [-1, 1]) {
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.34), dark);
      scoop.position.set(s * 0.57, 0.56, 0.08);
      scoop.rotation.z = s * -0.14;
      scoop.castShadow = false;
      this.group.add(scoop);
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.2), tireDark);
      vent.position.set(s * 0.6, 0.56, 0.08);
      vent.rotation.z = s * -0.14;
      vent.castShadow = false;
      this.group.add(vent);
      const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.075), grilleMat);
      grille.position.set(s * 0.628, 0.56, 0.08); // face externa do vent
      grille.rotation.z = s * -0.1;
      grille.castShadow = false;
      this.group.add(grille);
    }

    // AUDIT R4 (visual critic: 'kart needs rim light / accent against dark
    // asphalt'): neon accent stripe along each flank — a painted livery band
    // that reads as the kart's edge highlight in the Neon city (MK8 karts
    // carry a bright side stripe that separates body from road).
    for (const s of [-1, 1]) {
      const stripeMat = new THREE.MeshBasicMaterial({ color: accent });
      stripeMat.toneMapped = false;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 1.05), stripeMat);
      stripe.position.set(s * 0.585, 0.52, -0.05);
      stripe.castShadow = false;
      stripe.renderOrder = 1;
      this.group.add(stripe);
    }
    // Panel-line seams — thin darker strips (molded bodywork parting lines).
    for (const s of [-1, 1]) {
      this._mesh(new THREE.BoxGeometry(0.03, 0.022, 0.7), dark, s * 0.55, 0.66, -0.12, { cast: false });
    }
    this._mesh(new THREE.BoxGeometry(0.36, 0.02, 0.03), dark, 0, 0.93, 0.42, { cast: false });
    // More subtle panel lines (premium pass): cockpit rim ring + nose cowl
    // seam + tailcap seam — molded-plastic parting lines read as assembled
    // bodywork instead of one blob.
    const cockpitRim = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.012, 8, 32), dark);
    cockpitRim.rotation.x = Math.PI / 2; // belt around Y
    // AUDIT: rim acompanha o cockpit afundado — borda da abertura no topo da
    // carenagem (era y 0.955, flutuando sobre o domo fechado).
    cockpitRim.position.set(0, 0.76, -0.14);
    cockpitRim.scale.set(1, 1, 0.8);
    cockpitRim.castShadow = false;
    this.group.add(cockpitRim);
    this._mesh(new THREE.BoxGeometry(0.026, 0.12, 0.05), dark, 0, 0.56, 0.86, { cast: false, rx: 0.2 });
    this._mesh(new THREE.BoxGeometry(0.62, 0.02, 0.035), dark, 0, 0.5, -0.585, { cast: false });
    // ---- racing graphics (audit r3): accent stripes + side numbers + nose band ----
    // The shell was a monochrome lozenge — these give it the painted-kart read:
    // accent bands hug the lathe flanks, a number decal rides each side, and an
    // accent visor band curves across the nose cowl. All parented to this.group
    // so they follow the kart; setBodyColor retints only the base paint, so the
    // accent graphics keep the character's accent color.
    const accentMat = this._mat(accent);
    // Hull radius at a given height — linear sample of the lathe profile (the
    // shell is a surface of revolution, so radius at height y = profile.x).
    const hullR = (y) => {
      for (let i = 0; i < hullProfile.length - 1; i++) {
        const a = hullProfile[i];
        const b = hullProfile[i + 1];
        if (y >= a.y && y <= b.y) {
          const t = (y - a.y) / (b.y - a.y);
          return a.x + (b.x - a.x) * t;
        }
      }
      return hullProfile[hullProfile.length - 1].x;
    };
    // 1) Flank accent stripes — three thin elliptical arc bands wrapping the
    //    shell's curved flanks. Each is a torus arc in the XZ plane scaled by
    //    the hull's 1.5x Z elongation, so it hugs the shell profile exactly.
    const flankArc = (100 * Math.PI) / 180;
    for (const y of [0.56, 0.64, 0.72]) {
      const r = hullR(y) + 0.006; // just proud of the paint
      const flankStripeGeo = new THREE.TorusGeometry(r, 0.02, 10, 24, flankArc);
      flankStripeGeo.rotateX(Math.PI / 2); // ring in the XZ plane (belt around Y)
      for (const s of [-1, 1]) {
        const flankStripe = new THREE.Mesh(flankStripeGeo, accentMat);
        flankStripe.scale.set(1, 1, 1.5); // match the shell's elongation
        flankStripe.rotation.y = s > 0 ? 0 : Math.PI; // arc centered on this flank
        flankStripe.position.set(0, y, 0);
        flankStripe.castShadow = false;
        this.group.add(flankStripe);
      }
    }
    // 2) Side number decal — canvas badge (white disc + accent ring + number)
    //    on a small plane over each flank, tilted to follow the shell surface.
    const sideNumCanvas = document.createElement('canvas');
    sideNumCanvas.width = 128;
    sideNumCanvas.height = 128;
    const sctx = sideNumCanvas.getContext('2d');
    sctx.clearRect(0, 0, 128, 128);
    sctx.fillStyle = '#ffffff';
    sctx.beginPath();
    sctx.arc(64, 64, 56, 0, Math.PI * 2);
    sctx.fill();
    sctx.strokeStyle = '#' + new THREE.Color(accent).getHexString();
    sctx.lineWidth = 7;
    sctx.beginPath();
    sctx.arc(64, 64, 49, 0, Math.PI * 2);
    sctx.stroke();
    sctx.fillStyle = '#1b2a41';
    sctx.font = '900 74px "Baloo 2", "Nunito", Arial, sans-serif';
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText(String(this.number), 64, 68);
    const sideNumTex = new THREE.CanvasTexture(sideNumCanvas);
    sideNumTex.colorSpace = THREE.SRGBColorSpace;
    const sideDecalMat = this._mat(0xffffff, { map: sideNumTex, transparent: true });
    sideDecalMat.depthWrite = false; // no quad-corner slivers over the shell
    for (const s of [-1, 1]) {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), sideDecalMat);
      decal.position.set(s * 0.558, 0.7, 0.15);
      decal.rotation.y = s * (Math.PI / 2 - 0.12); // tilt to hug the curved flank
      decal.castShadow = false;
      this.group.add(decal);
    }
    // 3) Nose accent — curved visor band across the nose cowl front, following
    //    the cowl's squashed cross-section (arc centered on +Z).
    const noseAccentGeo = new THREE.TorusGeometry(0.34, 0.02, 10, 24, (70 * Math.PI) / 180);
    noseAccentGeo.rotateX(Math.PI / 2); // ring in the XZ plane
    noseAccentGeo.rotateY((-55 * Math.PI) / 180); // shift arc to center on +Z (55..125 deg)
    const noseAccent = new THREE.Mesh(noseAccentGeo, accentMat);
    noseAccent.scale.set(1, 1, 0.55 / 0.85); // match cowl's Z vs X squash
    noseAccent.position.set(0, 0.6, 0.62); // nose cowl center
    noseAccent.castShadow = false;
    this.group.add(noseAccent);

    // Front splitter — dark aero blade under the nose + small end fences.
    this._mesh(new THREE.BoxGeometry(0.92, 0.05, 0.26), dark, 0, 0.3, 0.97, { cast: false });
    for (const s of [-1, 1]) {
      this._mesh(new THREE.BoxGeometry(0.03, 0.1, 0.2), dark, s * 0.44, 0.29, 0.97, { cast: false });
    }
    // Dark lower-nose chin panel (contrast under the painted prow).
    const chinPanel = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), dark);
    chinPanel.position.set(0, 0.44, 0.62);
    chinPanel.scale.set(0.9, 0.42, 0.5);
    chinPanel.castShadow = false;
    this.group.add(chinPanel);

    // Front canards — small angled strakes on the nose flanks (aero detail,
    // accent edge for the premium read).
    for (const s of [-1, 1]) {
      const canard = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.026, 0.1), dark);
      canard.position.set(s * 0.37, 0.5, 0.72);
      canard.rotation.z = s * -0.3;
      canard.rotation.x = s * 0.28;
      canard.castShadow = false;
      this.group.add(canard);
      const canardEdge = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.006, 0.1), accentMat);
      canardEdge.position.set(s * 0.37, 0.515, 0.72);
      canardEdge.rotation.z = s * -0.3;
      canardEdge.rotation.x = s * 0.28;
      canardEdge.castShadow = false;
      this.group.add(canardEdge);
    }

    // Headlights — subtle emissive lenses in chrome bezels.
    for (const s of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.072, 18, 14), headlightMat);
      lens.position.set(s * 0.26, 0.56, 0.84);
      lens.scale.set(0.75, 0.9, 0.5);
      lens.castShadow = false;
      this.group.add(lens);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.014, 8, 22), chrome);
      bezel.rotation.z = Math.PI / 2; // ring in YZ plane (hole along X) — faces fwd
      bezel.position.set(s * 0.26, 0.56, 0.85);
      bezel.castShadow = false;
      this.group.add(bezel);
    }
    // Headlight glow — soft additive halos just ahead of the lenses (the
    // emissive lens alone read flat; a halo sells the "lights on" state).
    const glowTex = (() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,240,200,0.85)');
      grad.addColorStop(0.5, 'rgba(255,225,160,0.28)');
      grad.addColorStop(1, 'rgba(255,220,150,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const s of [-1, 1]) {
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), glowMat);
      glow.position.set(s * 0.26, 0.56, 0.93);
      glow.renderOrder = 2;
      glow.castShadow = false;
      this.group.add(glow);
    }

    // Curved glossy windshield — half-cylinder dome over the cockpit.
    const wind = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.6, 20, 1, true, 0, Math.PI),
      glassPBR
    );
    wind.position.set(0, 1.04, 0.26);
    wind.rotation.x = -0.3;
    wind.rotation.z = Math.PI / 2;
    wind.castShadow = false;
    this.group.add(wind);

    // Seat: bucket seat + bolsters + headrest (dark leather trim behind driver).
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.48, 0.1, 1, 4, 1), bodyDark);
    seat.position.set(0, 0.92, -0.36);
    seat.rotation.x = 0.14;
    seat.castShadow = true;
    this.group.add(seat);
    for (const s of [-1, 1]) {
      const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.13, 1, 3, 1), bodyDark);
      bolster.position.set(s * 0.19, 0.9, -0.37);
      bolster.rotation.x = 0.14;
      bolster.rotation.z = s * 0.16;
      bolster.castShadow = false;
      this.group.add(bolster);
    }
    const headrest = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), bodyDark);
    headrest.position.set(0, 1.10, -0.42); // AUDIT FIX 2026-08-16: 1.16→1.10 (acompanha piloto encolhido)
    headrest.scale.set(1, 0.9, 0.75);
    headrest.castShadow = true;
    this.group.add(headrest);

    // ---- rear wing: curved blade + dark lower element + endplates + pylon ----
    // Half-pipe painted blade (convex face toward the chase camera) + a dark
    // lower blade (split-wing read) — a shaped aero wing, not a plank.
    // AUDIT R7 (blind critic followCam: 'spoiler hides the driver in chase
    // view — the main camera'). MK8 karts ride LOW with the wing below helmet
    // height so the pilot reads above the aero. Wing 1.24→1.02, blade 0.22→0.17.
    // AUDIT kart/piloto R11 (2026-08-16): wing ainda ocultava os ombros do
    // piloto (capa plana y 1.02-1.19 vs ombros ~1.05) — desce para 0.84 e o
    // blade 0.17→0.15: a linha de visão da chase cam passa ACIMA da asa.
    const wingGroup = new THREE.Group();
    wingGroup.name = 'wing'; // AAA-2: nomeado p/ _applyBodyClass
    wingGroup.position.set(0, 0.84, -0.92);
    wingGroup.rotation.z = -Math.PI / 2; // blade spans X; convex face faces -Z
    const blade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 1.40, 32, 1, false, Math.PI, Math.PI),
      carPaint
    );
    blade.rotation.x = 0.12; // slight negative angle (downforce)
    blade.castShadow = true;
    wingGroup.add(blade);
    this._outline(blade, 0.03); // AUDIT R11: borda escura define a silhueta da asa na chase cam
    const lowerBlade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 1.30, 24, 1, false, Math.PI, Math.PI),
      dark
    );
    lowerBlade.rotation.x = 0.12;
    lowerBlade.position.y = -0.17;
    lowerBlade.castShadow = false;
    wingGroup.add(lowerBlade);
    this.group.add(wingGroup);
    // R12 wing struts — ligações visíveis entre os dois blades (o inferior
    // flutuava): 2 struts escuros = estrutura de asa real.
    for (const s of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.03), dark);
      strut.position.set(s * 0.38, -0.11, 0);
      strut.castShadow = false;
      wingGroup.add(strut);
    }
    // Wingtip endplates (painted) with dark edge trim.
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.42, 0.62), carPaint);
      plate.position.set(s * 0.72, 0.92, -0.90);
      plate.castShadow = true;
      this.group.add(plate);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.64), dark);
      trim.position.set(s * 0.72, 0.96, -0.90);
      trim.castShadow = false;
      this.group.add(trim);
      // Premium: accent edge stripe on the outer endplate face.
      const accentEdge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.38, 0.04), accentMat);
      accentEdge.position.set(s * 0.7525, 1.14, -0.90); // AUDIT R11: acompanha a asa baixa (1.24→1.14)
      accentEdge.castShadow = false;
      this.group.add(accentEdge);
    }
    // R12 livery: checker nas endplates (reusa bannerCheckerTexture) +
    // listras duplas accent sobre o topo do blade — identidade de kart de
    // corrida na traseira (critic R11: 'silhueta genérica').
    const checkerMat = new THREE.MeshBasicMaterial({
      map: Materials.bannerCheckerTexture(),
      transparent: true,
      depthWrite: false,
    });
    for (const s of [-1, 1]) {
      const chk = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.26), checkerMat);
      chk.position.set(s * 0.746, 0.94, -0.90); // face externa da endplate
      chk.rotation.y = s * (Math.PI / 2);
      chk.castShadow = false;
      this.group.add(chk);
    }
    for (const s of [-1, 1]) {
      const wstripe = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.014, 0.035), accentMat);
      wstripe.position.set(0, 0.965, -0.92 + s * 0.09); // sobre o arco do blade
      wstripe.rotation.x = 0.12; // acompanha o ângulo do blade
      wstripe.castShadow = false;
      this.group.add(wstripe);
    }
    // Center pylon (tapered) + side mount pods (molded, not sticks).
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.075, 0.40, 14), bodyDark);
    pylon.position.set(0, 1.06, -0.88); // AUDIT R11: 1.14→1.06 (wing 0.84)
    pylon.castShadow = true;
    this.group.add(pylon);
    for (const s of [-1, 1]) {
      const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.30, 12), dark);
      mount.position.set(s * 0.42, 1.06, -0.88); // AUDIT R11: 1.14→1.06
      mount.rotation.x = 0.25;
      mount.castShadow = false;
      this.group.add(mount);
      const pod = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), dark);
      pod.position.set(s * 0.42, 0.86, -0.86); // AUDIT R11: 0.94→0.86
      pod.castShadow = false;
      this.group.add(pod);
    }

    // Brake lights (emissive red tail lamps that flare on brake — update())
    // in chrome bezels + a subtle always-on rear glow bar under the wing.
    this._brakeLampMat = new THREE.MeshStandardMaterial({
      color: 0x7a0000,
      emissive: 0xff2222,
      emissiveIntensity: 0.0,
      roughness: 0.4,
    });
    for (const s of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 14), this._brakeLampMat);
      lamp.position.set(s * 0.36, 0.74, -0.9);
      lamp.scale.set(1.3, 1.05, 0.75); // AUDIT R11: lampas maiores (freio comunica estado)
      lamp.castShadow = false;
      this.group.add(lamp);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 20), chrome);
      bezel.rotation.z = Math.PI / 2;
      bezel.position.set(s * 0.36, 0.74, -0.915);
      bezel.castShadow = false;
      this.group.add(bezel);
    }
    const rearGlow = new THREE.MeshStandardMaterial({
      color: 0x5a0000, emissive: 0xff3322, emissiveIntensity: 0.5, roughness: 0.5, // AUDIT R11: 0.35→0.5 — freio vira evento
    });
    const glowBar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 0.025), rearGlow);
    glowBar.position.set(0, 0.90, -0.86); // AUDIT R11: estava oculto ATRÁS da capa da asa — agora visível abaixo dela
    this.group.add(glowBar);

    // Race number badge on the nose tip (kart identity, faces forward).
    const numCanvas = document.createElement('canvas');
    numCanvas.width = 128;
    numCanvas.height = 128;
    const nctx = numCanvas.getContext('2d');
    nctx.fillStyle = '#ffffff';
    nctx.fillRect(0, 0, 128, 128);
    nctx.fillStyle = '#1b2a41';
    nctx.font = 'bold 104px sans-serif';
    nctx.textAlign = 'center';
    nctx.textBaseline = 'middle';
    nctx.fillText(String(this.number), 64, 70);
    const numTex = new THREE.CanvasTexture(numCanvas);
    numTex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.28, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    plate.material.map = numTex;
    plate.position.set(0, 0.66, 0.86);
    this.group.add(plate);

    // Rear number plate + dark frame (visible from the chase camera).
    // AUDIT R11: 0.36×0.40→0.44×0.50 e y 0.60→0.66 — número legível da chase cam
    const plateBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.50, 0.07),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    plateBack.material.map = numTex;
    plateBack.position.set(0, 0.66, -0.78);
    plateBack.rotation.x = 0.12;
    this.group.add(plateBack);
    const plateFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.54, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x1b2a41 })
    );
    plateFrame.position.set(0, 0.66, -0.815);
    plateFrame.rotation.x = 0.12;
    this.group.add(plateFrame);

    // Exhaust pipes — polished chrome barrels + hot tips (particles spawn here).
    for (const s of [-1, 1]) {
      // AUDIT (vision: 'two bright white rings floating on the rear panel'): the
      // chrome exhaust barrels read as glowing white circles. Dark carbon
      // barrels + dark tips integrate with the body instead of popping.
      this._mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.26, 16),
        dark, s * 0.28, 0.5, -0.94,
        { rx: Math.PI / 2, cast: false }
      );
      this._mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.05, 16),
        dark, s * 0.28, 0.5, -1.06,
        { rx: Math.PI / 2, cast: false }
      );
    }

    // R12 rear mechanicals: bloco com aletas + difusor sob a cauda — a chase
    // cam lê maquinário, não sombra vazia. Metal usinado escuro (evita o
    // chrome-branco do histórico R75 'anéis brancos').
    const engineMat = new THREE.MeshStandardMaterial({
      color: 0x59626e, metalness: 0.7, roughness: 0.38,
      emissive: 0x10141c, emissiveIntensity: 0.5,
    });
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.16), engineMat);
    engine.position.set(0, 0.36, -0.78);
    engine.castShadow = false;
    this.group.add(engine);
    for (const fz of [-0.86, -0.78, -0.70]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.012), engineMat);
      fin.position.set(0, 0.425, fz);
      fin.castShadow = false;
      this.group.add(fin);
    }
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.3), chassisMat);
    diffuser.position.set(0, 0.28, -0.72);
    diffuser.rotation.x = 0.18; // borda traseira erguida (diffuser real)
    diffuser.castShadow = false;
    this.group.add(diffuser);

    // AUDIT: solid boost flame cones — particles alone read as sparks; MK8
    // boost needs a visible flame column at the twin exhausts.
    const flameTex = (() => {
      const c = document.createElement('canvas'); c.width = 32; c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.35, 'rgba(255,178,94,0.75)');
      grad.addColorStop(1, 'rgba(255,90,30,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 32, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this._flameMat = new THREE.MeshBasicMaterial({
      map: flameTex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      side: THREE.DoubleSide,
    });
    this._flameCyan = new THREE.Color(0x7fd8ff);
    this._flameOrange = new THREE.Color(0xffb25e);
    this._flames = [];
    for (const s of [-1, 1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.5, 12, 1, true), this._flameMat);
      cone.position.set(s * 0.28, 0.5, -1.0);
      cone.rotation.x = -Math.PI / 2; // cone apex (+Y) → points -Z (backward)
      cone.renderOrder = 3;
      cone.castShadow = false;
      this.group.add(cone);
      this._flames.push(cone);
    }


    // ---- wheels: tire + rounded shoulder + sport rim + brake disc ----------
    const wR = KC.wheelRadius;
    const wW = KC.wheelWidth;
    const wy = wR;
    const wz = KC.chassisLength / 2 - 0.18;
    const wx = KC.chassisWidth / 2 + 0.24; // AUDIT R11: 0.18→0.24 — bitola larga (postura MK8 wide stance)
    const faceX = wW / 2;

    // PREMIUM PASS (2026-08-21): pneu MK8 real tem OMBRO ARREDONDADO — o
    // cilindro puro lê como cano. Torus de shoulder arredonda as duas bordas
    // da banda de rodagem sem anéis concêntricos na parede lateral (lição
    // R80: nada de torus decorativos no sidewall — este é GEOMETRIA do ombro,
    // mesmo material do pneu, raio = espessura do pneu).
    const tireGeo = new THREE.CylinderGeometry(wR, wR, wW, 28);
    const shoulderGeo = new THREE.TorusGeometry(wR - 0.02, 0.022, 10, 40);
    // Sport rim MK8: 6 raios duplos em Y prateados + disco ventilado atrás.
    const rimDiscGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.022, 24);
    const rimLipGeo = new THREE.TorusGeometry(0.19, 0.014, 8, 32);
    const spokeGeo = new THREE.BoxGeometry(0.022, 0.10, 0.05);
    // PREMIUM PASS: disco de freio ventilado (aço escovado) + material.
    const brakeDiscGeo = new THREE.CylinderGeometry(0.145, 0.145, 0.02, 24);
    const brakeDiscMat = new THREE.MeshStandardMaterial({ color: 0x6b7482, metalness: 0.75, roughness: 0.42 });
    const hubGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.034, 18);
    const hubCapGeo = new THREE.SphereGeometry(0.034, 12, 10); // AUDIT R11: 0.026→0.034 (accent central maior — giro lê)
    const lugGeo = new THREE.SphereGeometry(0.013, 8, 6);
    const stripeMat = character ? this._mat(accent) : white;
    // AUDIT R20c: stripe SEMPRE cinza-claro (parede lateral de pneu) —
    // nunca a cor accent (amarelo criava anel visível).
    if (stripeMat) stripeMat.color.set(0xc9d4de);
    // AUDIT R20b: toneMapped false deixava a stripe BRILHANTE demais (anel
    // separado) — agora ACES aplica e ela integra ao pneu.
    // if (stripeMat && stripeMat.toneMapped !== undefined) stripeMat.toneMapped = false; // AUDIT R4: sidewall stripe stays hot (wheel legibility)

    this._wheels = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const root = new THREE.Group();
        root.position.set(sx * wx, wy, sz * wz);
        this.group.add(root);
        const spin = new THREE.Group(); // rolls around kart X axis
        root.add(spin);
        // CylinderGeometry's axis is Y; tilt the wheel so its axle runs
        // along X (lateral).
        const tilt = new THREE.Group();
        tilt.rotation.z = Math.PI / 2;
        spin.add(tilt);
        const tire = new THREE.Mesh(tireGeo, tireMat);
        tire.castShadow = true;
        tilt.add(tire);
        // PREMIUM PASS: ombros arredondados nas duas bordas da banda de
        // rodagem — mesmo material do pneu (GEOMETRIA do ombro, não decal).
        for (const ox of [-wW / 2 + 0.004, wW / 2 - 0.004]) {
          const shoulder = new THREE.Mesh(shoulderGeo, tireMat);
          shoulder.rotation.x = Math.PI / 2;
          shoulder.position.x = ox;
          shoulder.castShadow = false;
          tilt.add(shoulder);
        }
        // AUDIT FIX R13g (Feco real-GPU: 'ainda vejo anel preto nos pneus' —
        // PERSISTE após R12j/R13d): os tread ribs (3 torus tireDark) + groove
        // (1 torus tireDark) criavam 4 ANÉIS CONCÊNTRICOS escuros na lateral
        // do pneu — com iluminação GPU real liam como 'anel preto no pneu'.
        // MK8 real: borracha ÚNICA e uniforme (sem anéis concêntricos na
        // parede lateral). REMOVIDOS por completo — pneu liso + aro cromado
        // no centro (o único anel aceitável é o aro, que é o design do kart).
        // for (const tx of [-0.08, 0, 0.08]) {
        //   const rib = new THREE.Mesh(treadGeo, tireDark);
        //   rib.position.x = tx;
        //   rib.rotation.x = Math.PI / 2;
        //   tilt.add(rib);
        // }
        // const groove = new THREE.Mesh(grooveGeo, tireDark);
        // groove.rotation.x = Math.PI / 2;
        // tilt.add(groove);
        // AUDIT R80 (Feco real-GPU 2026-08-15, 4ª reclamação de 'anel nas
        // rodas'): a sidewall stripe cinza-claro (R20c 0xc9d4de) + wallBand
        // escuro criavam 2 anéis concêntricos visíveis no pneu — o usuário
        // viu 'anel claro fino e deformado' na roda. MK8 real: pneu ÚNICO
        // escuro (sem anéis) + aro cromado pequeno. Removidos stripe e
        // wallBand — a roda lê como borracha sólida com aro no centro.
        // (tread ribs + groove mantidos — são o 'piso' do pneu, não anéis.)
        // AUDIT R80: stripe/wallBand removidos (anéis concêntricos no pneu).
        // Chrome rim — DIRECT child of spin (axis X) so it rolls with the
        // wheel (the historic "disc child of tilt spun like a coin" bug).
        const rimX = faceX + 0.014;
        const disc = new THREE.Mesh(rimDiscGeo, rimChrome);
        disc.rotation.z = Math.PI / 2;
        disc.position.x = rimX;
        disc.castShadow = false;
        spin.add(disc);
        const lip = new THREE.Mesh(rimLipGeo, rimChrome);
        // AUDIT (user: 'one ring still out of place' — the chrome rim lip was
        // rotating in its own plane (rotation.z), leaving the ring EDGE-ON to
        // the wheel. This mesh lives in `spin` (no tilt), so rotation.y=PI/2
        // puts the torus plane on YZ — the wheel face.)
        lip.rotation.y = Math.PI / 2;
        lip.position.x = rimX + 0.01;
        lip.castShadow = false;
        spin.add(lip);
        // PREMIUM PASS: 6 raios duplos em Y (roda de liga esportiva MK8) —
        // par de boxes finos com leve ângulo em V; mais presença que o raio
        // único fino, sem virar disco cheio.
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          for (const vOff of [-0.035, 0.035]) {
            const spoke = new THREE.Mesh(spokeGeo, rimChrome);
            spoke.rotation.x = a + vOff * 0.5;
            spoke.position.set(rimX + 0.008, Math.cos(a) * 0.115, Math.sin(a) * 0.115);
            spoke.castShadow = false;
            spin.add(spoke);
          }
        }
        const hub = new THREE.Mesh(hubGeo, rimChrome);
        hub.rotation.z = Math.PI / 2;
        hub.position.x = rimX + 0.016;
        hub.castShadow = false;
        spin.add(hub);
        const hubCap = new THREE.Mesh(hubCapGeo, hubCapMat);
        hubCap.position.x = rimX + 0.032;
        hubCap.scale.set(1.6, 1.6, 1.6); // accent cap, proud of the chrome hub (R11: 1.2→1.6)
        hubCap.castShadow = false;
        spin.add(hubCap);
        // Disco de freio ventilado atrás dos raios (leitura mecânica premium).
        const brakeDisc = new THREE.Mesh(brakeDiscGeo, brakeDiscMat);
        brakeDisc.rotation.z = Math.PI / 2;
        brakeDisc.position.x = -faceX - 0.008; // lado interno da roda
        brakeDisc.castShadow = false;
        tilt.add(brakeDisc);
        // 5 lug nuts matching the spokes.
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const lug = new THREE.Mesh(lugGeo, chrome);
          lug.position.set(rimX + 0.045, Math.cos(a) * 0.088, Math.sin(a) * 0.088);
          lug.castShadow = false;
          spin.add(lug);
        }
        // Brake caliper — red bracket straddling the disc edge on REAR
        // wheels (visible from the chase cam; the premium mechanical read).
        if (sz < 0) {
          const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.085, 0.07), caliperMat);
          caliper.position.set(rimX + 0.024, 0.16, 0);
          caliper.rotation.z = 0.12;
          caliper.castShadow = false;
          spin.add(caliper);
          const calBracket = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.03), caliperMat);
          calBracket.position.set(rimX + 0.028, 0.115, 0);
          calBracket.castShadow = false;
          spin.add(calBracket);
        }
        // AUDIT FIX R12j (Feco real-GPU: 'anéis nas rodas' — PERSISTE): o
        // wishbone + damper (R12) eram arcos escuros/metálicos cruzando ATRÁS
        // do pneu — da chase cam liam exatamente como "anel preto sobre a
        // roda". O detalhe mecânico custou o bug visual mais reclamado do
        // jogo. REMOVIDOS: roda = pneu + aro + disco + caliper (já lê).
        this._wheels.push({ root, spin, isFront: sz > 0 });
      }
    }
    this._frontWheels = this._wheels.filter((w) => w.isFront);
    // AAA-2: roda nomeada p/ variantes de silhueta (_applyBodyClass).
    for (const w of this._wheels) w.spin.name = 'wheel-spin';

    // ---- driver: torso + shoulders + arms gripping the wheel -----------------
    const drv = new THREE.Group();
    drv.name = 'driver'; // AAA-2: nomeado p/ _applyBodyClass

    // AUDIT R16 (FECO real-GPU 2026-08-14: 'corredores parecem em PÉ'):
    // R12-R15 exageraram (scale 1.3 + y 0.18) — o torso subiu demais acima
    // da asa e lê como piloto de pé. Postura MK8 real: piloto ENCOLHIDO no
    // cockpit, só capacete+ombros acima da asa. scale 1.05, y 0.03.
    drv.position.set(0, 0.02, 0); // AUDIT FIX 2026-08-16 (Feco real-GPU: 'piloto flutuando pra cima do carro'): R11 subiu 0.03→0.08 e o piloto saiu do cockpit. MK8 = ENCOLHIDO no cockpit, só capacete+ombros acima da asa. Volta ao encolhido (R16).
    drv.scale.set(1.05, 1.05, 1.05);
    this.group.add(drv);

    const suit = character
      ? getPlasticMaterial(character.suitColor, { roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.4, envMapIntensity: 0.9 })
      : white;
    const up = new THREE.Vector3(0, 1, 0);

    // Torso — rounded capsule leaned forward into the drive pose.
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.26, 8, 16), suit);
    torso.position.set(0, 0.94, -0.06); // AUDIT FIX 2026-08-16: 1.00→0.94 (piloto encolhido)
    torso.rotation.x = 0.32;
    torso.castShadow = true;
    drv.add(torso);
    // Racing stripe down the chest (accent color).
    const chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.3, 0.02), this._mat(accent));
    chestStripe.position.set(0, 1.00, 0.088); // AUDIT R11: 0.94→1.00
    chestStripe.rotation.x = 0.32;
    chestStripe.castShadow = false;
    drv.add(chestStripe);
    // Shoulders (suit pads) — AUDIT R13: raio 0.085→0.11 + x ±0.135→±0.16
    // (ombros largos, silhueta humana legível acima da asa).
    // AUDIT R11: y 0.94→1.02 e raio 0.11→0.125 — ombros ACIMA da asa 0.99
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 12), suit);
      sh.position.set(s * 0.16, 1.02, -0.09);
      sh.scale.set(1, 0.88, 1.1);
      sh.castShadow = false;
      drv.add(sh);
    }

    // Steering wheel — 3-spoke, dark leather rim + chrome spokes/hub.
    const steerGroup = new THREE.Group();
    steerGroup.position.set(0, 0.97, 0.24); // AUDIT R11: 0.92→0.97
    drv.add(steerGroup);
    const sRim = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.024, 12, 28), dark);
    sRim.rotation.x = Math.PI / 2; // ring in XY plane — faces the driver
    sRim.castShadow = false;
    steerGroup.add(sRim);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.022), chrome);
      sp.position.set(Math.cos(a) * 0.052, Math.sin(a) * 0.052, 0);
      sp.rotation.z = a;
      sp.castShadow = false;
      steerGroup.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), chrome);
    hub.castShadow = false;
    steerGroup.add(hub);
    // R12 cockpit detail: painel com display + botões accent no volante.
    const dashCanvas = document.createElement('canvas');
    dashCanvas.width = 64;
    dashCanvas.height = 32;
    const dctx = dashCanvas.getContext('2d');
    dctx.fillStyle = '#0a0f16';
    dctx.fillRect(0, 0, 64, 32);
    dctx.fillStyle = '#ffd166';
    dctx.font = '900 20px monospace';
    dctx.textAlign = 'center';
    dctx.textBaseline = 'middle';
    dctx.fillText(String(this.number).padStart(2, '0'), 32, 15);
    dctx.fillStyle = '#2ec4ff';
    dctx.fillRect(10, 24, 44, 3); // barra de throttle
    const dashTex = new THREE.CanvasTexture(dashCanvas);
    dashTex.colorSpace = THREE.SRGBColorSpace;
    const dashMat = new THREE.MeshBasicMaterial({ map: dashTex });
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.075, 0.03), dashMat);
    dash.position.set(0, 1.06, 0.40); // dentro do domo de vidro, à frente do volante
    dash.rotation.x = -0.55;
    dash.castShadow = false;
    this.group.add(dash);
    for (const b of [-1, 1]) {
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), accentMat);
      btn.position.set(b * 0.028, 0, 0.028);
      btn.castShadow = false;
      steerGroup.add(btn);
    }

    // Arms — upper arm + forearm (bent elbows), gloved hands gripping the rim.
    for (const s of [-1, 1]) {
      const shX = s * 0.135, shY = 0.98, shZ = -0.09; // AUDIT FIX 2026-08-16: 1.06→0.98 (ombros encolhidos)
      const elX = s * 0.16, elY = 0.97, elZ = 0.05;  // AUDIT FIX 2026-08-16: 1.04→0.97
      const hX = s * 0.105, hY = 0.90, hZ = 0.24;    // AUDIT FIX 2026-08-16: 0.97→0.90
      const ua = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.13, 6, 10), suit);
      ua.position.set((shX + elX) / 2, (shY + elY) / 2, (shZ + elZ) / 2);
      ua.quaternion.setFromUnitVectors(up, new THREE.Vector3(elX - shX, elY - shY, elZ - shZ).normalize());
      ua.castShadow = false;
      drv.add(ua);
      const fa = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.15, 6, 10), suit);
      fa.position.set((elX + hX) / 2, (elY + hY) / 2, (elZ + hZ) / 2);
      fa.quaternion.setFromUnitVectors(up, new THREE.Vector3(hX - elX, hY - elY, hZ - elZ).normalize());
      fa.castShadow = false;
      drv.add(fa);
      // Gloved hands — accent racing gloves with a dark wrist cuff, wrapped
      // over the wheel rim (premium pass: no more anonymous dark blobs).
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.046, 14, 12), gloveMat);
      hand.position.set(hX, hY, hZ);
      hand.scale.set(1, 1, 1.15);
      hand.castShadow = false;
      drv.add(hand);
      const cuff = new THREE.Mesh(new THREE.SphereGeometry(0.047, 12, 10), dark);
      cuff.position.set(hX * 0.75 + shX * 0.25, hY * 0.75 + shY * 0.25, hZ * 0.75 + shZ * 0.25);
      cuff.scale.set(1, 1.25, 1.25);
      cuff.castShadow = false;
      drv.add(cuff);
    }

    // Neck + helmet (character colored, glossy visor, fine outline).
    this._mesh(new THREE.SphereGeometry(0.055, 14, 10), skin, 0, 1.14, 0.1, { parent: drv, cast: false }); // AUDIT FIX 2026-08-16: 1.19→1.14
    // AUDIT: glossy clearcoat helmet (was matte toon 0.82) — MK8 helmets are
    // polished plastic; the specular highlight separates head from dark body.
    const helmetMat = character
      ? Materials.plasticMaterial(character.helmetColor, { roughness: 0.22, clearcoat: 1.0, envMapIntensity: 1.6 })
      : body;
    helmetMat.emissive = new THREE.Color(character ? character.helmetColor : 0xffffff).multiplyScalar(0.28); // AUDIT R16d: 0.18→0.28 — capacete/a pilot pop (crítico: hero se funde)
    helmetMat.emissiveIntensity = 0.5; // AUDIT R16d: 0.4→0.5
    this._helmetMat = helmetMat;
    // AUDIT FIX 2026-08-16: capacete declarado abaixo (junto ao rim/visor) com
    // postura encolhida — o antigo (y 1.38, topo ~1.54) lia como piloto em pé.
    // AUDIT R6 (visual critic): helmet needs a halo/rim to separate from the
    // dark body — a soft additive glow disc just behind the head.
    const helHaloTex = (() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const gc = c.getContext('2d');
      const grad = gc.createRadialGradient(32, 32, 4, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,0.5)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.16)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      gc.fillStyle = grad;
      gc.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const helHaloMat = new THREE.MeshBasicMaterial({
      map: helHaloTex, transparent: true, opacity: 0.5, // AUDIT FIX R12j: 0.85→0.5 — o halo aditivo 0.40 lia como 'esfera translúcida' na chase cam
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const helHalo = new THREE.Mesh(new THREE.CircleGeometry(0.30, 24), helHaloMat); // AUDIT FIX R12j: 0.40→0.30
    helHalo.position.set(0, 1.24, -0.10); // AUDIT FIX 2026-08-16: 1.29→1.24
    helHalo.rotation.x = -0.35;
    helHalo.castShadow = false;
    drv.add(helHalo);
    // AUDIT R7: explicit rim ring around the helmet (critic: halo weak) —
    // an additive torus at the helmet rim reads as a light edge.
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 26, 18), helmetMat); // AUDIT FIX 2026-08-16: 0.185→0.17 (proporcional ao piloto encolhido)
    helmet.name = 'helmet'; // AAA-2: nomeado p/ _applyBodyClass
    helmet.position.set(0, 1.30, 0.06); // AUDIT FIX 2026-08-16: 1.38→1.30
    helmet.castShadow = false;
    drv.add(helmet);
    const helRim = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.012, 8, 24), rimMat); // AUDIT FIX 2026-08-16: 0.175→0.165
    helRim.position.set(0, 1.30, 0.06); // AUDIT FIX 2026-08-16: 1.38→1.30
    helRim.rotation.x = Math.PI / 2;
    helRim.scale.set(1, 1, 0.85);
    helRim.castShadow = false;
    drv.add(helRim);
    // Glossy visor band with an EXPRESSIVE CANVAS FACE (eyes + mouth drawn
    // at the sphere's +Z front band, u≈0.25 on SphereGeometry) so the driver
    // reads as a character, not a blank helmet. Material color is white so
    // the canvas carries the dark glass; clearcoat keeps the glassy sheen.
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 22, 14), // AUDIT FIX 2026-08-16: 0.155→0.14
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, roughness: 0.05, metalness: 0.5,
        clearcoat: 1.0, clearcoatRoughness: 0.05,
        map: this._visorTexture(character, accent),
      })
    );
    visor.position.set(0, 1.30, 0.13); // AUDIT FIX 2026-08-16: 1.38→1.30
    visor.scale.set(1.05, 0.28, 0.68);
    visor.castShadow = false;
    drv.add(visor);
    // Chin guard below the visor.
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), dark);
    chin.position.set(0, 1.14, 0.18); // AUDIT FIX 2026-08-16: 1.17→1.14
    chin.scale.set(1, 0.55, 0.75);
    chin.castShadow = false;
    drv.add(chin);
    // Helmet accent stripe — the character's color mark (equator ring).
    if (character) {
      this._mesh(
        new THREE.TorusGeometry(0.185, 0.016, 8, 32), // AUDIT R11: 0.163→0.185 (acompanha capacete maior)
        this._mat(character.accentColor),
        0, 1.29, 0.06, // AUDIT R11: 1.24→1.29
        { parent: drv, cast: false }
      );
    }
    // AUDIT R6 (blind critic: 'emissive only proxies a rim light — want a
    // REAL light separating the kart from dark asphalt'): a cool rim light
    // parented to the kart group, behind-left. It follows every move and
    // throws a colored edge highlight on body + helmet in the Neon night.
    // AUDIT FIX R15a (Feco real-GPU mobile: 'junto com o kart o asfalto
    // muda de cor, ficando mais azulado' — PERSISTE após R14b alcance 2.2m):
    // QUALQUER PointLight parented no kart ilumina o chão ao redor dele
    // (PointLight não tem como excluir o chão). O vision no screenshot mobile
    // confirmou: 'faixa mais clara e azulada, formato alongado, sob e à
    // esquerda do kart' = o rimLight azul (0x66e0ff) derramando no asfalto.
    // REMOVIDAS as 3 PointLights por completo — o rim light do piloto agora
    // é emissive no capacete/body (separação visual sem luz física que
    // ilumine o chão).
    // this.rimLight = new THREE.PointLight(0x66e0ff, 2.2, 2.2, 1.4);
    // this.rimLight.position.set(-1.4, 1.0, -1.3);
    // this.group.add(this.rimLight);
    // this.rimLightWarm = new THREE.PointLight(0xffb066, 1.4, 2.0, 1.4);
    // this.rimLightWarm.position.set(1.3, 0.5, 1.0);
    // this.group.add(this.rimLightWarm);
    // this.pilotFill = new THREE.PointLight(0xffe8c4, 1.6, 1.8, 1.4);
    // this.pilotFill.position.set(0, 1.9, 1.2);
    // this.group.add(this.pilotFill);

    this._applyBodyClass(character);
  }

  /**
   * AAA-2 (2026-08-22) — FAMÍLIAS DE SILHUETA por personagem (gate R1).
   *
   * O crítico visual marcou "obstáculos/karts IA" como a categoria mais fraca
   * do scorecard: 6 karts = o MESMO modelo recolorido (score 1). MK8 resolve
   * isso com body classes — karts leves/médios/pesados têm proporções e peças
   * diferentes. Aqui cada personagem recebe uma família que VARIA FORMA:
   *
   *   standard (Turbo, Daisy) — kart base, sem mutação.
   *   speed   (Comet)         — casco alongado+baixo, asa mais larga, rodas
   *                             traseiras gordas (dragster read).
   *   heavy   (King)          — casco alto/largo, sidepods inflados, lâmina
   *                             dupla na asa, piloto maior.
   *   compact (Bolt, Pip)     — casco curto/empinado, asa estreita alta,
   *                             spoiler-lip no nariz, rodas menores.
   *
   * Tudo é TRANSFORMAÇÃO de meshes existentes + poucos adds baratos (sem
   * reescrever a fábrica; física/IA intocadas). Chamado do _buildMesh —
   * restart recria o Kart inteiro, então nunca acumula mutações.
   */
  _applyBodyClass(character) {
    const name = (character && character.name) || '';
    let cls = 'standard';
    if (name === 'Comet') cls = 'speed';
    else if (name === 'King') cls = 'heavy';
    else if (name === 'Bolt' || name === 'Pip') cls = 'compact';
    if (cls === 'standard') return;
    this.bodyClass = cls;

    const hull = this.group.getObjectByName('hull');
    const wing = this.group.getObjectByName('wing');
    const driver = this.group.getObjectByName('driver');
    const helmet = driver ? driver.getObjectByName('helmet') : null;
    const paint = this._carPaintMat || this._bodyMat;

    if (cls === 'speed') {
      // Casco alongado + baixo (silhueta seta). Meio-comprimento do casco =
      // raio máx do perfil (0.56) × scaleZ → 1.62 dá ponta em ~0.91 (nariz
      // esférico termina em ~0.84 — alonga sem engolir placa/splitter).
      if (hull) hull.scale.set(0.94, 0.66, 1.62);
      // Asa mais larga e rasa (planador de alta velocidade).
      if (wing) {
        wing.scale.set(1.18, 1.0, 0.82);
        wing.position.y = 0.80;
      }
      // Rodas traseiras GORDAS (read de dragster) — escala NÃO-uniforme do
      // root inteiro no eixo LATERAL do kart (X): pneu, ombros, aro e disco
      // engordam JUNTOS (mesmo frame — impossível desalinh peças). Raio
      // intacto (y/z) = contato com o solo preservado.
      for (const w of this._wheels) {
        if (!w.isFront) w.root.scale.x = 2.0;
      }
    } else if (cls === 'heavy') {
      // Casco alto e largo (tanque).
      if (hull) hull.scale.set(1.12, 0.86, 1.42);
      // Lâmina dupla na asa: segundo blade pintado sobre o principal.
      if (wing) {
        wing.scale.set(1.05, 1.18, 1.0);
        const upperBlade = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.09, 1.5, 24, 1, false, Math.PI, Math.PI),
          paint
        );
        upperBlade.rotation.x = -0.16; // ângulo invertido do blade principal
        upperBlade.position.y = 0.13;
        upperBlade.castShadow = false;
        wing.add(upperBlade);
      }
      // Sidepods inflados (massa lateral extra atrás do cockpit).
      for (const s of [-1, 1]) {
        const pod = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), paint);
        pod.name = 'heavy-pod';
        pod.position.set(s * 0.56, 0.52, -0.28);
        pod.scale.set(0.75, 0.7, 1.7);
        pod.castShadow = true;
        this.group.add(pod);
      }
      // Piloto maior (o King é grande).
      if (driver) driver.scale.multiplyScalar(1.12);
      if (helmet) helmet.scale.setScalar(1.1);
    } else if (cls === 'compact') {
      // Casco curto e empinado (bolha).
      if (hull) hull.scale.set(1.02, 0.84, 1.28);
      // Asa estreita e ALTA (acima do piloto — silhueta quiosque).
      if (wing) {
        wing.scale.set(0.78, 1.0, 0.95);
        wing.position.y = 1.04;
      }
      // Pylon da asa cresce p/ alcançar a nova altura (era dimensionado p/ y 0.84).
      // O pylon é filho DIRETO de this.group (CylinderGeometry, z < -0.8,
      // y > 1.0 — os mounts laterais estão em y 1.06 mas são CylinderGeometry
      // TAMBÉM; distinguir por x≈0).
      const pylon = this.group.children.find((c) => c.isMesh &&
        c.geometry && c.geometry.type === 'CylinderGeometry' &&
        Math.abs(c.position.x) < 0.01 && c.position.z < -0.8 && c.position.y > 1.0);
      if (pylon) {
        pylon.scale.y = (1.04 - 0.84 + 0.4) / 0.4; // altura nova / altura antiga
        pylon.position.y += (1.04 - 0.84) / 2;
      }
      // Spoiler-lip no nariz (duckbill) — assinatura dos compactos.
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.16), this._bodyDarkMat || this._mat(0x232833));
      lip.name = 'compact-lip';
      lip.position.set(0, 0.72, 0.92);
      lip.rotation.x = -0.22;
      lip.castShadow = false;
      this.group.add(lip);
      // Rodas um pouco menores (kart leve).
      for (const w of this._wheels) w.root.scale.setScalar(0.9);
    }
  }

  // ---- public API -----------------------------------------------------------

  setControls({ steer, throttle, brake, drift, useItem, swapItem } = {}) {
    if (steer !== undefined) this._steerTarget = THREE.MathUtils.clamp(steer, -1, 1);
    // Throttle stays a FLOAT (AI corner-lift 0.3/0.8, rubber-band easing
    // 0.88×) — coercing to boolean killed the AI's designed corner behavior
    // and the "ease off when ahead" half of rubber-banding (audit F3).
    if (throttle !== undefined) this._controls.throttle = THREE.MathUtils.clamp(throttle, 0, 1);
    if (brake !== undefined) this._controls.brake = !!brake;
    if (drift !== undefined) this._controls.drift = !!drift;
    if (useItem !== undefined) this._controls.useItem = !!useItem;
    if (swapItem !== undefined) this._controls.swapItem = !!swapItem;
  }

  /** Coin-scaled top speed. KartPhysics targets `kart.cruiseSpeed || P.maxSpeed`
   *  every frame — the getter returns the base (AI rubber-band override or the
   *  physics maxSpeed) multiplied by 1 + coins*coinSpeedBonus (capped). Coins
   *  are stored raw on kart._coins; this keeps the bonus live without touching
   *  KartPhysics or the AI's cruise override writes. */
  get cruiseSpeed() {
    const base = this._baseCruise !== undefined ? this._baseCruise : CONFIG.physics.maxSpeed;
    const coins = this._coins || 0;
    const bonus = Math.min(CONFIG.items.coinSpeedCap, coins * CONFIG.items.coinSpeedBonus);
    // AUDIT MED: rubber-band (≤+12%) and coins (≤+10%) stacked multiplicatively
    // → a caught-up 10-coin AI ran ~+23% over maxSpeed. Cap the TOTAL.
    const raw = base * (1 + bonus);
    // AUDIT MED: the rubber-band cap must NOT erase the difficulty-150 speed
    // curve — the AI statScale (1.22 @150cc) lives inside _baseCruise (base).
    // Cap RELATIVE to base (which carries difficulty + rubber-band), so the
    // coins bonus (+10%) can't stack above the ceiling but difficulty can.
    return Math.min(raw, base * (1 + CONFIG.physics.rubberBandCap));
  }

  set cruiseSpeed(v) {
    this._baseCruise = v;
  }

  /** Exchange the primary and reserve slots (MK8 hold/swap strategy). */
  swapHeldItems() {
    if (!this.heldItem && !this.heldItem2) return;
    const t = this.heldItem;
    this.heldItem = this.heldItem2;
    this.heldItem2 = t;
    const c = this._heldItemCount;
    this._heldItemCount = this._heldItem2Count;
    this._heldItem2Count = c;
    this._onSwap?.();
  }

  /** Add coins (max +10% top speed). Returns true when collected. */
  addCoin() {
    const maxCoins = Math.max(1, Math.round(CONFIG.items.coinSpeedCap / CONFIG.items.coinSpeedBonus));
    if ((this._coins || 0) >= maxCoins) return false;
    this._coins = (this._coins || 0) + 1;
    return true;
  }

  /**
   * Repaint the player kart body (menu color picker).
   * @param {number} color — 0xRRGGBB
   */
  setBodyColor(color) {
    if (!this._bodyMat) return;
    this._bodyMat.color.setHex(color);
    this._bodyDarkMat.color.setHex(new THREE.Color(color).multiplyScalar(0.82).getHex());
    if (this._carPaintMat) this._carPaintMat.color.setHex(color);
    // helmet matches body color too (chibi driver)
    if (this._helmetMat) this._helmetMat.color.setHex(color);
  }

  /** Convenience read of the latest input (used by power-ups / AI tooling). */
  get input() {
    return this._controls;
  }

  /**
   * Arm/disarm the held item for a REAR throw (audit r4 — MK8D hold-to-throw-
   * back). The item bubble flips across the kart (position.z sign) and rides a
   * touch higher as the visible aim cue while armed; PowerUp.useItem spawns
   * rear projectiles at the kart tail.
   * @param {boolean} armed
   */
  setItemRear(armed) {
    this._itemRear = !!armed;
    if (this.heldItemGroup) {
      this.heldItemGroup.position.z = this._itemRear ? 0.72 : -0.72;
      this.heldItemGroup.position.y = this._itemRear ? 0.95 : 0.72;
    }
  }

  /** AUDIT r8: MK8D coin loss on a hit — drop up to 3 coins (recollectable).
   *  Decrements _coins and reports via the _onCoinDrop hook; RaceManager
   *  respawns the coins near the kart with a sparkle. No-op with no coins. */
  _dropCoinsOnHit() {
    const n = this._coins || 0;
    if (n <= 0) return;
    const dropped = Math.min(3, n);
    this._coins = n - dropped;
    this._onCoinDrop?.(dropped, this);
  }

  /** AUDIT r8: show/hide the floating rank arrow. RaceManager drives this
   *  from its phase — arrows only appear during a live race (hidden in
   *  menu / countdown / finish, MK8D-style). */
  setRankVisible(v) {
    this._rankVisible = !!v;
    if (!v) {
      this._rankPos = 0;
      if (this._rankArrow) this._rankArrow.visible = false;
    }
  }

  /** AUDIT r8: point the rank arrow at the kart's current race position
   *  (kart.position is written by RaceManager.getStandings each frame).
   *  Swaps the pooled canvas texture only when the ordinal changed — no
   *  per-frame allocation. */
  _syncRankArrow() {
    const arrow = this._rankArrow;
    if (!arrow) return;
    const pos = this._rankVisible ? (this.position || 0) : 0;
    if (pos < 1 || pos > RANK_ARROW_MAX) {
      if (arrow.visible) arrow.visible = false;
      this._rankPos = 0;
      return;
    }
    arrow.visible = true;
    if (pos !== this._rankPos) {
      this._rankPos = pos;
      const mat = arrow.material;
      const tex = _rankArrowTexture(pos);
      if (tex && mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    }
  }

  /** Full reset for race restart — position, heading, timers, progress. */
  restart() {
    const s = this.state;
    if (this.startPosition) s.position.copy(this.startPosition);
    if (typeof this.startHeading === 'number') s.heading = this.startHeading;
    s.speed = 0;
    s.lap = 0;
    s.progress01 = 0;
    s.drifting = false;
    s.driftCharge = 0;
    s.boost = false;
    this.cruiseSpeed = undefined; // audit F9: rubber-band override must not leak
    s.turboBoostMs = 0;
    s.offRoad = false;
    s.spinOut = false;
    s.finished = false;
    s.vY = 0;
    this.finished = false;
    this.totalTime = null;
    this.position = 0;
    this.heldItem = null;
    this.heldItem2 = null; // dual-slot + triple stacks reset with the race
    this._heldItemCount = 1;
    this._heldItem2Count = 1;
    this._rearThrow = false; // AUDIT r4: no stale rear-aim into the new race
    this.setItemRear(false); // item bubble back to its default spot
    this._coins = 0; // coin bonus is per-race (MK8D)
    this.invincible = false;
    this.starred = false;
    this._boostMs = 0;
    this._starMs = 0;
    this._invMs = 0;
    this._invFxPrev = false;
    this._pendingShieldFx = false;
    this._spinMs = 0;
    this._scaleMs = 0;
    this._scaleTarget = 1;
    this._latVel = 0;
    // AUDIT r7: no stale finish celebration into the fresh race.
    this._finishActive = false;
    this._finishMs = 0;
    if (this._finishFlag) this._finishFlag.visible = false;
    if (this._blob) this._blob.rotation.x = -Math.PI / 2;
    // AUDIT r8: no stale rank arrow into the fresh race (RaceManager re-shows it).
    this._rankVisible = false;
    this._rankPos = 0;
    if (this._rankArrow) this._rankArrow.visible = false;
    // AUDIT r2: stale trick/slipstream state leaked into the fresh race —
    // an armed trick or drafting slingshot fired right after GO.
    this._wasDrafting = false;
    this._airTime = 0;
    this._trickArmed = false;
    this._prevY = 0;
    this._offRoadT = 0; // AUDIT r3: no grass-exit kick from the previous race
    this._nudgeVel.set(0, 0, 0);
    this._boostVisPrev = false; // AUDIT: no stale boost sparkle on restart
    this._driftTier = 0;
    this._lineAcc = 0;
    this._lastProgress = 0; // avoids a phantom lap on restart
    this._controls = { steer: 0, throttle: false, brake: false, drift: false, useItem: false, swapItem: false };
    this._swapWasDown = false;
    this._steerTarget = 0;
    this.group.position.copy(s.position);
    this.group.rotation.set(0, s.heading, 0);
    this.group.scale.set(1, 1, 1);
  }

  get progress01() {
    return this.state.progress01;
  }

  get lap() {
    return this.state.lap;
  }

  /** Drift mini-boost, mushroom, star, etc. */
  applyBoost(durationMs) {
    this._boostMs = Math.max(this._boostMs, durationMs);
    this._scaleTarget = 1.06; // stretch
    this._scaleMs = Math.max(this._scaleMs, 420);
  }

  /** AUDIT r7: finished-kart celebration — one wheelie hop + checkered flag
   *  (latched so it fires exactly once; restart()/reset() clear it). */
  _beginFinishCelebration() {
    this._finishActive = true;
    this._finishMs = KART_FINISH_MS;
    if (this._finishFlag) this._finishFlag.visible = true;
  }

  /** Star: invincible + long boost + rainbow trail. */
  setStarred(b) {
    this.starred = !!b;
    if (b) {
      this.setInvincible(true, CONFIG.items.starDurationMs);
      this._starMs = Math.max(this._starMs, CONFIG.items.starDurationMs);
      this.applyBoost(CONFIG.items.starDurationMs);
    }
  }

  /** Lightning shrink / growth juice. */
  applyScale(scale, durationMs) {
    // AUDIT HIGH-1: _scaleTarget is the shared VISUAL squash field (landing,
    // wall scrape, banana, shell all write 0.9-0.94) — using it for the speed
    // tax made every jump silently cut top speed. Lightning slow now lives in
    // its own _slowFactor/_slowMs; the visual squash stays visual.
    if (scale < 1) {
      this._slowFactor = scale;
      this._slowMs = Math.max(this._slowMs, durationMs);
    }
    this._scaleTarget = scale;
    this._scaleMs = Math.max(this._scaleMs, durationMs);
    // AUDIT (power-up audit, 2026-08-11) CRITICAL: lightning used to be a
    // Y-ONLY squash (KartPhysics force-resets x/z to 1 every frame) — victims
    // pancaked flat instead of shrinking like MK8D. Real shrink lives in its
    // own field so the Y squash (landing/wall/banana juice) can keep working.
    if (scale < 0.9) {
      this._shrinkScale = scale;
      this._shrinkMs = Math.max(this._shrinkMs || 0, durationMs);
    }
  }

  /** Banana: spin-out. No-op while invincible. */
  hitBanana() {
    if (this.invincible) return;
    if (this._blockWithHeldItem()) return; // hold a shell/banana → absorb
    this._spinMs = 1500;
    this._spinDir = Math.random() < 0.5 ? -1 : 1;
    this.state.speed *= 0.3;
    this._scaleTarget = 0.92;
    this._scaleMs = Math.max(this._scaleMs, 300);
    // AUDIT r4: post-hit i-frames — a shell train/lightning combo used to pin
    // a kart for 4-5s of helplessness (no invincibility after any hit).
    this.setInvincible(true, 2000);
    this._onHit?.('banana'); // player hit feedback hook (screen flash + label)
    this._dropCoinsOnHit(); // AUDIT r8: MK8D scatters up to 3 coins on a hit
  }

  /** Shell: heavier crash — spin-out + hop + lateral shove.
   *  opts: { blue } — blue shells BYPASS held-item blocking (MK8 spiny:
   *  only star/invincibility protects; a held shell can't shield it). */
  hitShell(opts = {}) {
    if (this.invincible) return;
    if (!opts.blue && this._blockWithHeldItem()) return; // MK8 item-hold pillar
    this._spinMs = 2100;
    this._spinDir = Math.random() < 0.5 ? -1 : 1;
    this.state.speed *= 0.12;
    this.state.vY = 3.2; // pop up, gravity brings it down
    this._nudgeVel.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(5);
    this._scaleTarget = 0.9;
    this._scaleMs = Math.max(this._scaleMs, 380);
    // AUDIT r4: post-hit i-frames (see hitBanana) — no chain-stun pinning.
    this.setInvincible(true, 2000);
    this._onHit?.(opts.blue ? 'blue' : 'shell'); // player hit feedback hook
    this._dropCoinsOnHit(); // AUDIT r8: MK8D scatters up to 3 coins on a hit
  }

  /** Holding a shell/banana behind blocks an incoming hit (MK8 pillar).
   *  Checks the primary slot first, then the reserve (dual-slot, audit r3).
   *  Consumes the whole slot's stack. Returns true when the hit was absorbed. */
  _blockWithHeldItem() {
    const slot = this.heldItem
      ? { key: 'heldItem', countKey: '_heldItemCount' }
      : this.heldItem2 ? { key: 'heldItem2', countKey: '_heldItem2Count' } : null;
    if (!slot) return false;
    const type = this[slot.key];
    if (type !== PowerUpType.SHELL && type !== PowerUpType.BANANA && type !== PowerUpType.RED_SHELL) return false;
    this[slot.key] = null;
    this[slot.countKey] = 1;
    return true;
  }

  /** Invincibility (ref-counted so star + item invincibility can overlap). */
  setInvincible(b, durationMs = 2500) {
    if (b) {
      this._invCount += 1;
      this._invMs = Math.max(this._invMs, durationMs);
      // AAA VFX: shield-ripple on entering invincibility (star / hit i-frames).
      // Emit only on the rising edge so overlapping sources don't spam.
      if (this._invCount === 1 && this._invFxPrev === false) {
        this._pendingShieldFx = true;
      }
      this.invincible = true;
    } else {
      this._invCount = Math.max(0, this._invCount - 1);
      if (this._invCount === 0) {
        this.invincible = false;
        this._invMs = 0;
      }
    }
  }

  /** Directional impulse (shell knock, explosion push). dir: world Vector3. */
  nudge(dir) {
    if (!dir) return;
    this._nudgeVel.copy(dir).setY(0);
    if (this._nudgeVel.lengthSq() > 0.001) this._nudgeVel.normalize().multiplyScalar(5.5);
    this.state.speed *= 0.9;
  }

  /** Reset for race restarts (RaceManager may also rebuild karts directly). */
  reset(position, heading = 0) {
    this.state.speed = 0;
    this.state.vY = 0;
    this.state.drifting = false;
    this.state.driftCharge = 0;
    this.state.boost = false;
    this.state.turboBoostMs = 0;
    this.state.offRoad = false;
    this.state.spinOut = false;
    this.state.lap = 0;
    this.state.progress01 = 0;
    this.state.finished = false;
    this.finished = false;
    this.position = 0;
    this.totalTime = 0;
    this.heldItem = null;
    this.heldItem2 = null;
    this._heldItemCount = 1;
    this._heldItem2Count = 1;
    this._coins = 0;
    this._boostMs = 0;
    this._starMs = 0;
    this._spinMs = 0;
    this._scaleTarget = 1;
    this._scaleMs = 0;
    this._latVel = 0;
    this._airTime = 0;
    this._nudgeVel.set(0, 0, 0);
    this._lastProgress = 0;
    this._bounce = 0;
    this._finishActive = false; // AUDIT r7: no stale finish celebration
    this._boostVisPrev = false; // AUDIT: no stale boost sparkle on reset
    this._driftTier = 0;
    this._lineAcc = 0;
    this._finishMs = 0;
    if (this._finishFlag) this._finishFlag.visible = false;
    if (this._blob) this._blob.rotation.x = -Math.PI / 2;
    this._rankVisible = false; // AUDIT r8: no stale rank arrow
    this._rankPos = 0;
    if (this._rankArrow) this._rankArrow.visible = false;
    if (position) this.state.position.copy(position);
    this.state.heading = heading;
    this.group.position.copy(this.state.position);
    this.group.rotation.y = heading;
    this.group.scale.set(1, 1, 1);
  }

  // ---- per-frame update ------------------------------------------------------

  update(dt, ctx = {}) {
    this._t += dt;
    const s = this.state;
    this._syncRankArrow(); // AUDIT r8: float the MK8D rank arrow above the kart
    // Brake lights flare (audit v5 #2).
    if (this._brakeLampMat) {
      const braking = this._controls.brake || s.spinOut;
      const target = braking ? 1.8 : 0; // AUDIT R11: 1.4→1.8 — freio vira evento visível
      this._brakeLampMat.emissiveIntensity += (target - this._brakeLampMat.emissiveIntensity) * Math.min(1, 10 * dt);
    }
    this._tickEffects(dt);
    // Swap input (rising edge): Tab / HUD mini-slot click exchange the two
    // held slots. Consumed here so setControls stays level-triggered.
    if (this._controls.swapItem && !this._swapWasDown) this.swapHeldItems();
    this._swapWasDown = !!this._controls.swapItem;
    // Held-item bubble sync (audit v5): show the per-type mesh (orb fallback).
    if (this.heldItemGroup) {
      const has = !!this.heldItem;
      this.heldItemGroup.visible = has;
      if (has) {
        for (const key of Object.keys(this._heldMeshes)) {
          this._heldMeshes[key].visible = key === this.heldItem;
        }
        const hasMesh = !!this._heldMeshes[this.heldItem];
        if (this._heldOrb) this._heldOrb.visible = !hasMesh;
        if (!hasMesh) {
          const c = HELD_ITEM_COLORS[this.heldItem] || 0xffffff;
          if (this._heldOrbMat.color.getHex() !== c) this._heldOrbMat.color.setHex(c);
        }
        this.heldItemGroup.rotation.y += dt * 2.4; // gentle spin
        // Rear-armed pulse: the bubble throbs while aimed backward (audit r4).
        this.heldItemGroup.scale.setScalar(this._itemRear ? 1 + Math.sin(this._t * 12) * 0.1 : 1);
      }
    }
    // Second bubble sync (audit r3): tint by reserve type, scale for triples.
    if (this.heldItem2Group) {
      const has2 = !!this.heldItem2;
      this.heldItem2Group.visible = has2;
      if (has2) {
        const c2 = HELD_ITEM_COLORS[this.heldItem2] || 0xffffff;
        if (this._held2OrbMat.color.getHex() !== c2) this._held2OrbMat.color.setHex(c2);
        const stackScale = (this._heldItem2Count || 1) > 1 ? 1.4 : 1;
        this.heldItem2Group.scale.setScalar(stackScale);
        this.heldItem2Group.rotation.y += dt * 2.4; // gentle spin
      }
    }
    // Trick (MK8 pillar): pressing throttle mid-air arms a trick; landing
    // with it armed grants a mini-boost (the air system is now reachable
    // via the trick ramps).
    if (this._airTime > 0.25 && this._controls.throttle) this._trickArmed = true; // audit v4: 0.35 was above the ramp's airtime
    if (this._trickArmed && this._airTime <= 0.02 && !this.state.spinOut) {
      this._trickArmed = false;
      this.applyBoost(320);
      this._onTrick?.();
    }

    if (ctx.track) {
      if (ctx.track.startLine && ctx.track.startLine.direction) {
        this._startDir.set(ctx.track.startLine.direction.x, 0, ctx.track.startLine.direction.z).normalize();
      }
      // Smooth steering (avoids jerky snap on input / AI corrections).
      this._controls.steer = THREE.MathUtils.lerp(
        this._controls.steer,
        this._steerTarget,
        Math.min(1, 9 * dt)
      );
      KartPhysics.step(this, this._controls, dt, ctx.track, ctx.raceManager);
    }
    // AUDIT: event juice — landing puff (MK8 dust at contact), boost release
    // sparkle (rising edge), high-speed wind streaks.
    if (ctx.particles) {
      if (this._airTime > 0.18 && this._airTime <= 0.22) {
        this._localToWorld(this._pv, 0, 0.06, -0.4);
        ctx.particles.emit('dust', this._pv, { count: 8, speed: 2.2, size: 0.3, color: 0xb8b2a4, duration: 0.6 });
      }
      if (this._boostMs > 0 && !this._boostVisPrev) {
        this._localToWorld(this._pv, 0, 0.6, -0.9);
        ctx.particles.emit('sparkle', this._pv, { count: 10, speed: 5, size: 0.14 });
      }
      this._boostVisPrev = this._boostMs > 0;
      // Shield / invincibility ripple — rising edge only.
      if (this._pendingShieldFx) {
        this._pendingShieldFx = false;
        this._invFxPrev = true;
        this._localToWorld(this._pv, 0, 0.6, 0);
        ctx.particles.emit('shield', this._pv, { count: 14, speed: 4.5, size: 0.3 });
      }
      if (!this.invincible) this._invFxPrev = false;
      // Drift combo pop — reward sustained drift tiers (rising edge per tier).
      if (s.drifting && s.driftCharge >= 0.45 && s.driftTier > (this._comboTierPrev || 0)) {
        this._comboTierPrev = s.driftTier;
        this._localToWorld(this._pv, this._sideFlip * 0.85, 0.7, -0.1);
        ctx.particles.emit('combo', this._pv, { count: 10, speed: 4, size: 0.2 });
      }
      if (!s.drifting) this._comboTierPrev = 0;
      const speedAbs2 = Math.abs(s.speed);
      // R24 haze: 3D wind streaks fired from 78% on EVERY kart (player + AI),
      // reading as a white-streak wash over road and rivals at cruise speed.
      // Contained: later onset, slower rate, smaller + softer sprites; the
      // boost-hot variant is kept as the real velocity cue.
      if (speedAbs2 > CONFIG.physics.maxSpeed * 0.86 && !s.spinOut) {
        this._lineAcc = (this._lineAcc || 0) + dt;
        // PREMIUM PASS: rajada dupla de speedlines nas DUAS laterais (antes:
        // só um lado por _sideFlip — a cortina de velocidade lia assimétrica).
        // Durante boost: mais densas e com tom quente (leitura de turbo).
        if (this._lineAcc >= 0.12) {
          this._lineAcc = 0;
          const hot = s.turboBoostMs > 0 || this._boostMs > 0;
          for (const side of [-1, 1]) {
            this._localToWorld(this._pv, side * 0.85, 0.7, -0.1);
            this._v.copy(this._back).multiplyScalar(14);
            ctx.particles.emit('speedline', this._pv, {
              velocity: this._v, spread: 0.3, size: hot ? 0.09 : 0.07,
              alpha: hot ? 0.8 : 0.55,
              color: hot ? 0xfff0c0 : 0xe8f4ff,
            });
          }
        }
      }
    }
    s.finished = this.finished;
    // AUDIT r7: finished-kart celebration — rising edge of this.finished
    // triggers one wheelie hop + the checkered flag (guarded so it fires
    // exactly once per race; restart()/reset() clear the latch).
    if (this.finished && !this._finishActive) this._beginFinishCelebration();

    // sync transform
    this.group.position.copy(s.position);
    this.group.rotation.y = s.heading;

    // lean into turns, nose-up on accel
    const speed01 = Math.min(1, Math.abs(s.speed) / CONFIG.physics.maxSpeed);
    const steerVis = this._controls.steer * speed01;
    // AUDIT: MK8D banking — 0.09 rad (~5°) read as 'no suspension movement';
    // raise to ~8° lean + stronger drift tilt so cornering reads on the body.
    const rollTarget = -steerVis * 0.14 - (s.drifting ? this._controls.steer * 0.06 : 0);
    this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, rollTarget, Math.min(1, 6 * dt));
    let pitchTarget = s.spinOut ? 0 : (this._controls.throttle ? 0.05 : (this._controls.brake ? -0.04 : 0));
    // AUDIT r7: finished-kart celebration — a quick wheelie hop (nose up,
    // negative rotation.x per the three.js XYZ Euler convention) while
    // _finishMs runs, then the checkered flag keeps waving up top.
    if (this._finishMs > 0) {
      const ft = 1 - this._finishMs / KART_FINISH_MS; // 0 → 1 over the celebration
      const rise = Math.min(1, ft * 6); // fast nose-up over the first ~0.17s
      const settle = 1 - Math.max(0, (ft - 0.55) / 0.45); // ease back after 55%
      pitchTarget -= 0.26 * rise * settle + Math.sin(this._t * 9) * 0.02 * settle; // nose up + tiny wobble
      this.group.position.y += Math.sin(rise * Math.PI) * 0.14; // visual hop (physics re-syncs next frame)
    }
    // AUDIT: contact shadow stays ON THE ROAD — it used to ride inside the
    // kart group (jump = kart carried its shadow = 'floating' read). Local Y
    // cancels the kart's world height; opacity + size fade with altitude.
    if (this._blob) {
      const h = Math.max(0, this.group.position.y);
      this._blob.position.y = 0.02 - h;
      this._blob.rotation.x = -Math.PI / 2 - this.group.rotation.x;
      this._blob.rotation.z = -this.group.rotation.z; // counter the turn lean
      const k = 1 - Math.min(0.35, h * 0.12);
      this._blob.scale.set(k, k, 0.78 * k);
      this._blob.material.opacity = Math.max(0.18, 1 - h * 0.5); // AUDIT R11: 0.12/0.55→0.18/0.5 — sombra mais presente
    }
    if (this._finishActive) {
      if (this._finishFlag) {
        this._finishFlag.visible = true;
        this._finishFlag.rotation.y += dt * 5; // spin the flag around its pole
        if (this._flagCloth) this._flagCloth.rotation.z = Math.sin(this._t * 7) * 0.22; // cloth wave
      }
    }
    this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, pitchTarget, Math.min(1, 5 * dt));

    this._animateWheels(dt);
    if (ctx.particles) this._emitParticles(ctx.particles, dt);
  }

  _tickEffects(dt) {
    const s = this.state;
    const ms = dt * 1000;

    if (this._boostMs > 0) {
      this._boostMs = Math.max(0, this._boostMs - ms);
      // keep a gentle stretch while boosting
      if (this._scaleMs < 250) {
        this._scaleTarget = 1.05;
        this._scaleMs = 250;
      }
    }
    s.boost = this._boostMs > 0;

    // Turbo pad boost (set by KartPhysics when crossing a pad).
    if (s.turboBoostMs > 0) {
      s.turboBoostMs = Math.max(0, s.turboBoostMs - ms);
    }

    if (this._starMs > 0) {
      this._starMs = Math.max(0, this._starMs - ms);
      if (this._starMs <= 0) this.starred = false;
    }
    // AUDIT (power-up audit, 2026-08-11): MK8D star karts FLASH rainbow —
    // the star was only a particle trail, the kart paint stayed static.
    // Hue-cycle the body material (saturate + rotate hue) while starred and
    // restore the exact base hex when it ends.
    if (this.starred) {
      if (!this._bodyBaseHex && this._bodyMat) this._bodyBaseHex = this._bodyMat.color.getHex();
      this._starT = (this._starT || 0) + dt;
      if (this._bodyMat && this._bodyMat.color && this._bodyBaseHex) {
        const base = new THREE.Color(this._bodyBaseHex);
        const hsl = { h: 0, s: 0, l: 0 };
        base.getHSL(hsl);
        this._bodyMat.color.setHSL((hsl.h + this._starT * 0.8) % 1, Math.max(0.85, hsl.s), hsl.l);
      }
    } else if (this._bodyMat && this._bodyBaseHex && this._starT) {
      this._bodyMat.color.setHex(this._bodyBaseHex);
      this._starT = 0;
    }
    if (this._invMs > 0) {
      this._invMs = Math.max(0, this._invMs - ms);
      if (this._invMs <= 0) {
        this._invMs = 0;
        this._invCount = 0;
        this.invincible = false;
      }
    }
    if (this._spinMs > 0) {
      this._spinMs = Math.max(0, this._spinMs - ms);
      s.spinOut = this._spinMs > 0;
    } else {
      s.spinOut = false;
    }
    if (this._scaleMs > 0) {
      this._scaleMs = Math.max(0, this._scaleMs - ms);
      if (this._scaleMs <= 0) this._scaleTarget = 1;
    }
    // AUDIT r7: finish celebration timer — ends the wheelie (flag persists).
    if (this._finishMs > 0) {
      this._finishMs = Math.max(0, this._finishMs - ms);
    }

    // AUDIT: flame cone follows boost/turbo state (turbo pads were invisible)
    const boosting = s.boost || s.turboBoostMs > 0;
    if (this._flameMat) {
      this._flameMat.opacity = THREE.MathUtils.clamp(
        this._flameMat.opacity + (boosting ? 0.85 - this._flameMat.opacity : -this._flameMat.opacity) * Math.min(1, 14 * dt),
        0, 0.9);
      const targetCol = this._boostMs > CONFIG.items.mushroomBoostMs ? this._flameCyan : this._flameOrange;
      this._flameMat.color.lerp(targetCol, Math.min(1, 8 * dt));
      const flicker = 1 + Math.sin(this._t * 42) * 0.12;
      for (const f of this._flames) f.scale.set(1, flicker, 1);
    }
  }

  _animateWheels(dt) {
    const spin = (this.state.speed / CONFIG.kart.wheelRadius) * dt;
    for (const w of this._wheels) w.spin.rotation.x += spin;
    const steerAngle = this._controls.steer * (this.state.drifting ? 0.5 : 0.38);
    for (const fw of this._frontWheels) {
      fw.root.rotation.y = THREE.MathUtils.lerp(fw.root.rotation.y, steerAngle, Math.min(1, 8 * dt));
    }
  }

  // ---- particles -------------------------------------------------------------

  /** Manual local→world transform (group rotation is only heading + small lean). */
  _localToWorld(out, lx, ly, lz) {
    const p = this.group.position;
    const h = this.state.heading;
    const c = Math.cos(h);
    const s = Math.sin(h);
    out.set(p.x + lx * c + lz * s, p.y + ly, p.z - lx * s + lz * c);
  }

  _emitParticles(particles, dt) {
    const s = this.state;
    const speedAbs = Math.abs(s.speed);
    const h = s.heading;
    this._back.set(-Math.sin(h), 0, -Math.cos(h)); // kart's backward direction

    // exhaust puffs
    this._exhaustAcc += dt;
    const exhaustEvery = s.boost ? 0.02 : 0.05;
    if (this._exhaustAcc >= exhaustEvery && speedAbs > 0.4 && !s.spinOut) {
      this._exhaustAcc = 0;
      this._localToWorld(this._pv, 0, this._pipeOffset.y, this._pipeOffset.z);
      const puff = 1.5 + Math.min(3.5, speedAbs * 0.09);
      this._v.copy(this._back).multiplyScalar(puff);
      particles.emit('exhaust', this._pv, {
        velocity: this._v,
        spread: 0.45,
        size: 0.16 + Math.min(0.12, speedAbs * 0.004),
        color: s.offRoad ? 0xb89a72 : 0xd7dde4,
      });
    }

    // slipstream wake (audit v3 F1 asked for wake particles): faint streaks
    // trailing the kart while drafting — the visual "you're in the slipstream".
    if (s.draft && speedAbs > 6 && !s.spinOut) {
      this._draftAcc = (this._draftAcc || 0) + dt;
      if (this._draftAcc >= 0.05) {
        this._draftAcc = 0;
        this._localToWorld(this._pv, 0, 0.3, -0.7);
        this._v.copy(this._back).multiplyScalar(2.2);
        particles.emit('dust', this._pv, { velocity: this._v, spread: 0.3, size: 0.12, color: 0xbfd8ff });
      }
    }

    // boost flame
    if ((s.boost || s.turboBoostMs > 0) && !s.spinOut) {
      this._localToWorld(this._pv, 0, this._pipeOffset.y, this._pipeOffset.z);
      this._v.copy(this._back).multiplyScalar(9.5); // AUDIT R16c: 8.5→9.5 — boost flame mais presente
      particles.emit('boost', this._pv, {
        velocity: this._v,
        spread: 1.0,
        size: 0.42, // AUDIT R16c: 0.34→0.42 — chama de boost mais visível (MK8)
        color: this._boostMs > CONFIG.items.mushroomBoostMs ? 0x7fd8ff : 0xffb25e,
      });
    }

    // drift smoke (rear wheels) — color tracks charge: white → yellow → orange
    if (s.drifting && speedAbs >= CONFIG.physics.driftMinSpeed) {
      this._driftAcc += dt;
      if (this._driftAcc >= 0.05) {
        this._driftAcc = 0;
        this._localToWorld(this._pv, this._sideFlip * 0.7, this.rideHeight + 0.1, -0.72);
        this._v.copy(this._back).multiplyScalar(0.8);
        this._side.set(Math.cos(h), 0, -Math.sin(h)).multiplyScalar(this._controls.steer * 2.2);
        this._v.add(this._side);
        const charge = s.driftCharge;
        const driftColor = charge < 0.33 ? 0xffffff : charge < 0.66 ? 0xffd166 : 0xff9f45;
        // AUDIT R16c: size 0.3→0.38 + 2 puffs por frame — drift smoke mais denso
        particles.emit('drift', this._pv, { velocity: this._v, spread: 0.7, size: 0.38, color: driftColor });
        if (charge >= 0.33) {
          particles.emit('drift', this._pv, { velocity: this._v, spread: 0.9, size: 0.3, color: driftColor });
        }
        // AUDIT: tier crossing sparks — MK8 pops bright sparks when the drift
        // charge reaches each tier (white→yellow→orange), not just a color swap.
        const tier = charge >= 0.66 ? 2 : charge >= 0.33 ? 1 : 0;
        if (tier > this._driftTier) {
          this._driftTier = tier;
          this._localToWorld(this._pv, this._sideFlip * 0.7, this.rideHeight + 0.1, -0.72);
          particles.emit('sparkle', this._pv, { count: 6, speed: 3.5, size: 0.12, color: tier === 2 ? 0xff9f45 : 0xffd166 });
        } else if (tier < this._driftTier) {
          this._driftTier = tier;
        }
      }
    }
    this._sideFlip = -this._sideFlip;

    // off-road dust
    if (s.offRoad && speedAbs > 5 && !s.spinOut) {
      this._dustAcc += dt;
      if (this._dustAcc >= 0.08) {
        this._dustAcc = 0;
        this._localToWorld(this._pv, this._sideFlip * 0.7, this.rideHeight + 0.08, -0.72);
        this._v.copy(this._back).multiplyScalar(1.2).addScaledVector(this._side, 0);
        particles.emit('drift', this._pv, { velocity: this._v, spread: 0.9, size: 0.26, color: 0x9a7f57, duration: 0.7 });
      }
    }

    // speed dust (motion cue — vision critic: no visible movement effects;
    // MK8 kicks a little tire dust when accelerating hard)
    if (speedAbs > 30 && !s.spinOut && !s.offRoad && (s.throttle > 0.5 || s.boost)) {
      this._speedDustAcc = (this._speedDustAcc || 0) + dt;
      if (this._speedDustAcc >= 0.1) {
        this._speedDustAcc = 0;
        this._localToWorld(this._pv, this._sideFlip * 0.55, 0.06, -0.6);
        this._v.copy(this._back).multiplyScalar(1.0);
        particles.emit('dust', this._pv, { velocity: this._v, spread: 0.5, size: 0.14, color: 0xd8d4c8, duration: 0.5 });
      }
    }

    // exhaust puffs (subtle, MK8-style — gives the kart a living feel)
    if (speedAbs > 5 && s.throttle > 0.1 && !s.spinOut) {
      this._exhAcc = (this._exhAcc || 0) + dt;
      if (this._exhAcc >= 0.22) {
        this._exhAcc = 0;
        this._localToWorld(this._pv, 0, this._pipeOffset.y - 0.12, this._pipeOffset.z - 0.1);
        this._v.copy(this._back).multiplyScalar(1.4);
        particles.emit('dust', this._pv, { velocity: this._v, spread: 0.18, size: 0.1, color: 0xe8e4da, duration: 0.35 });
      }
    }

    // star rainbow trail
    if (this.starred) {
      this._starAcc += dt;
      if (this._starAcc >= 0.03) {
        this._starAcc = 0;
        this._localToWorld(this._pv, 0, this.rideHeight + 0.5, -0.75);
        this._v.copy(this._back).multiplyScalar(1.0);
        this._starColor.setHSL((this._t * 0.8) % 1, 1.0, 0.62);
        particles.emit('starTrail', this._pv, {
          velocity: this._v,
          color: this._starColor.getHex(),
          size: 0.3,
        });
      }
    }
  }
}
