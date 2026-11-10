import * as THREE from 'three';
import { toonMaterial, cartoonOutline } from '../render/Materials.js';
import { zarioLogger, LogCategory } from '../game/ZarioLogger.js';

/**
 * Zario Kart — Sculpted Course Landmarks & Hero Architecture (`ThemeLandmarks.js`).
 *
 * Replaces stacked primitive cones/cylinders with organic sculpted 3D meshes
 * built from LatheGeometry, ExtrudeGeometry, TubeGeometry, and contoured profiles:
 * - Theme 3: Sunset Canyon (Stepped Mesa Buttes, Sandstone Arches, Saguaro Cacti)
 * - Theme 4: Cloudtop Garden (Sculpted Cumulus Islands, Rainbow Ribbon Gates, Sky Temples)
 * - Theme 5: Inferno Volcano (Colossal Erupting Caldera Peak, Lava Rivers, Obsidian Dragon Gates)
 * - Theme 6: Haunted Mansion (Gothic Victorian Manor, Wrought-Iron Crypt Gates, Floating Ghosts & Gnarled Trees)
 */

function computeTrackCenter(path) {
  const center = new THREE.Vector3();
  const sample = new THREE.Vector3();
  const N = 32;
  for (let i = 0; i < N; i++) {
    path.getPointAt(i / N, sample);
    center.add(sample);
  }
  center.divideScalar(N);
  return center;
}

/**
 * Sculpted stepped desert mesa geometry (Lathe with organic crag modulation)
 * instead of a bare 7-sided ConeGeometry.
 */
function createSculptedMesaGeometry(baseRadius, height) {
  const profile = [
    new THREE.Vector2(baseRadius * 1.05, 0),
    new THREE.Vector2(baseRadius * 0.92, height * 0.22),
    new THREE.Vector2(baseRadius * 0.78, height * 0.26),
    new THREE.Vector2(baseRadius * 0.72, height * 0.56),
    new THREE.Vector2(baseRadius * 0.56, height * 0.62),
    new THREE.Vector2(baseRadius * 0.50, height * 0.92),
    new THREE.Vector2(baseRadius * 0.42, height),
    new THREE.Vector2(0, height),
  ];
  const geo = new THREE.LatheGeometry(profile, 14);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const angle = Math.atan2(z, x);
    const crag = 1 + 0.14 * Math.sin(angle * 5 + y * 0.6) + 0.08 * Math.cos(angle * 3 - y * 0.4);
    pos.setX(i, x * crag);
    pos.setZ(i, z * crag);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sculpted jagged volcanic obsidian spire (Lathe + twist & crag).
 */
function createObsidianSpireGeometry(baseRadius, height) {
  const profile = [
    new THREE.Vector2(baseRadius * 1.1, 0),
    new THREE.Vector2(baseRadius * 0.85, height * 0.28),
    new THREE.Vector2(baseRadius * 0.62, height * 0.58),
    new THREE.Vector2(baseRadius * 0.34, height * 0.84),
    new THREE.Vector2(baseRadius * 0.06, height),
    new THREE.Vector2(0, height),
  ];
  const geo = new THREE.LatheGeometry(profile, 12);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const angle = Math.atan2(z, x);
    const ridge = 1 + 0.22 * Math.sin(angle * 6 + y * 0.35);
    const lean = (y / height) * 0.45;
    pos.setX(i, x * ridge + lean);
    pos.setZ(i, z * ridge);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sculpted gothic tombstone (ExtrudeGeometry with rounded arch top).
 */
function createTombstoneGeometry() {
  const shape = new THREE.Shape();
  const w = 0.85;
  const h = 1.65;
  shape.moveTo(-w, 0);
  shape.lineTo(w, 0);
  shape.lineTo(w, h);
  shape.absarc(0, h, w, 0, Math.PI, false);
  shape.lineTo(-w, 0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.36,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: 3,
  });
  geo.translate(0, 0, -0.18);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds the Hero Volcano Caldera in the center/vista of Track 5 (Inferno Volcano).
 */
function buildVolcanoCaldera(center) {
  const group = new THREE.Group();
  group.name = 'volcano-hero-caldera';
  group.position.set(center.x, -1.5, center.z);

  // Sculpted volcano cone with crater rim and deep magma basin
  const profile = [
    new THREE.Vector2(76, 0),
    new THREE.Vector2(62, 12),
    new THREE.Vector2(46, 26),
    new THREE.Vector2(31, 42),
    new THREE.Vector2(21, 54), // outer crater rim
    new THREE.Vector2(16, 55), // top lip
    new THREE.Vector2(12, 46), // inner crater wall
    new THREE.Vector2(0, 46),  // crater floor
  ];
  const mountainGeo = new THREE.LatheGeometry(profile, 28);
  const pos = mountainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 13) {
      const a = Math.atan2(z, x);
      const ridge = 1 + 0.11 * Math.sin(a * 7 + y * 0.09) + 0.07 * Math.cos(a * 11 - y * 0.12);
      pos.setX(i, x * ridge);
      pos.setZ(i, z * ridge);
    }
  }
  mountainGeo.computeVertexNormals();

  const rockMat = toonMaterial(0x2b1e21, { roughness: 0.9, emissive: 0x3b1206, emissiveIntensity: 0.18 });
  const mountain = new THREE.Mesh(mountainGeo, rockMat);
  group.add(mountain);

  // Glowing molten crater lake at the top
  const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff6d14 });
  lavaMat.toneMapped = false;
  const craterLake = new THREE.Mesh(new THREE.CircleGeometry(14.5, 24), lavaMat);
  craterLake.rotation.x = -Math.PI / 2;
  craterLake.position.y = 48.5;
  group.add(craterLake);

  // 4 sculpted lava rivers flowing down the volcano flanks
  const lavaStreamMat = new THREE.MeshBasicMaterial({ color: 0xff8c1a });
  lavaStreamMat.toneMapped = false;
  for (let s = 0; s < 4; s++) {
    const a = (s / 4) * Math.PI * 2 + 0.35;
    const curvePts = [];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      const rad = 17 + u * 54;
      const h = 53 * (1 - u) + 1.2;
      const wiggle = Math.sin(u * Math.PI * 3 + s) * 0.12;
      curvePts.push(new THREE.Vector3(Math.cos(a + wiggle) * rad, h, Math.sin(a + wiggle) * rad));
    }
    const streamCurve = new THREE.CatmullRomCurve3(curvePts);
    const streamGeo = new THREE.TubeGeometry(streamCurve, 20, 1.65, 6, false);
    const streamMesh = new THREE.Mesh(streamGeo, lavaStreamMat);
    group.add(streamMesh);
  }

  // Sculpted volcanic ash & ember cloud rings floating above the crater
  const ashMat = toonMaterial(0x3a2d32, { emissive: 0xff4800, emissiveIntensity: 0.22 });
  for (let c = 0; c < 6; c++) {
    const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(6.5 + (c % 3) * 2.5, 1), ashMat);
    const ang = (c / 6) * Math.PI * 2;
    puff.position.set(Math.cos(ang) * (8 + c * 2.2), 62 + c * 4.5, Math.sin(ang) * (8 + c * 2.2));
    puff.scale.set(1.3, 0.72, 1.2);
    group.add(puff);
  }

  return group;
}

/**
 * Builds the Hero Gothic Haunted Manor in the center/courtyard of Track 6 (Haunted Mansion).
 */
function buildHauntedManor(center) {
  const group = new THREE.Group();
  group.name = 'mansion-hero-manor';
  group.position.set(center.x, 0, center.z);

  const wallMat = toonMaterial(0x2f2842, { roughness: 0.85 });
  const roofMat = toonMaterial(0x191528, { roughness: 0.75 });
  const trimMat = toonMaterial(0x4b4266, { roughness: 0.8 });
  const winGlowWarm = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  winGlowWarm.toneMapped = false;
  const winGlowGhost = new THREE.MeshBasicMaterial({ color: 0x52ffbc });
  winGlowGhost.toneMapped = false;

  // Main manor hall
  const mainHall = new THREE.Mesh(new THREE.BoxGeometry(34, 18, 22), wallMat);
  mainHall.position.y = 9;
  cartoonOutline(mainHall, 0x0d0a14, 0.03);
  group.add(mainHall);

  // Steep sculpted Mansard roof (4-sided pyramid frustum via CylinderGeometry)
  const mainRoof = new THREE.Mesh(new THREE.CylinderGeometry(14, 26, 11, 4), roofMat);
  mainRoof.rotation.y = Math.PI / 4;
  mainRoof.position.y = 23.5;
  group.add(mainRoof);

  // Flanking gothic belfry towers with tall witch-hat spires
  for (const side of [-1, 1]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.8, 28, 8), wallMat);
    tower.position.set(side * 20, 14, 4);
    group.add(tower);

    const spire = new THREE.Mesh(new THREE.ConeGeometry(6.8, 15, 8), roofMat);
    spire.position.set(side * 20, 35.5, 4);
    group.add(spire);

    // Arched glowing tower windows
    for (const wy of [10, 18, 24]) {
      const win = new THREE.Mesh(
        new THREE.PlaneGeometry(2.1, 3.4),
        wy === 24 ? winGlowGhost : winGlowWarm
      );
      win.position.set(side * 20, wy, 9.6);
      group.add(win);
    }
  }

  // Central gothic portico & grand entrance arch
  const portico = new THREE.Mesh(new THREE.BoxGeometry(12, 14, 6), trimMat);
  portico.position.set(0, 7, 13);
  group.add(portico);
  const pediment = new THREE.Mesh(new THREE.ConeGeometry(9.2, 6.5, 4), roofMat);
  pediment.rotation.y = Math.PI / 4;
  pediment.position.set(0, 17.2, 13);
  group.add(pediment);

  // Glowing arched windows across the front & back facades
  for (const fz of [-11.2, 11.2]) {
    const rotY = fz < 0 ? Math.PI : 0;
    for (const wx of [-11, -5.5, 5.5, 11]) {
      for (const wy of [6.5, 13.5]) {
        const wMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(2.4, 3.8),
          (wx + wy) % 2 === 0 ? winGlowWarm : winGlowGhost
        );
        wMesh.position.set(wx, wy, fz);
        wMesh.rotation.y = rotY;
        group.add(wMesh);
      }
    }
  }

  // Giant eerie full moon hovering high above the manor spire
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xe6f9ff });
  moonMat.toneMapped = false;
  const moon = new THREE.Mesh(new THREE.SphereGeometry(14, 20, 16), moonMat);
  moon.position.set(-18, 68, -28);
  group.add(moon);

  return group;
}

/**
 * Builds a sculpted floating ghost (Boo-inspired cute spectral figure) for Track 6.
 */
function buildSculptedGhost(colorHex = 0xe8f7ff) {
  const g = new THREE.Group();
  const profile = [
    new THREE.Vector2(0.05, 0.0),
    new THREE.Vector2(0.45, 0.25),
    new THREE.Vector2(0.95, 0.75),
    new THREE.Vector2(1.22, 1.35),
    new THREE.Vector2(1.18, 2.05),
    new THREE.Vector2(0.85, 2.55),
    new THREE.Vector2(0.0, 2.85),
  ];
  const bodyGeo = new THREE.LatheGeometry(profile, 16);
  const bodyMat = toonMaterial(colorHex, {
    emissive: 0x4fd1a5,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.92,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  g.add(body);

  // Cute stubby arms
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), bodyMat);
    arm.scale.set(1.4, 0.8, 0.8);
    arm.position.set(sx * 1.25, 1.55, 0.2);
    arm.rotation.z = sx * 0.4;
    g.add(arm);
  }

  // Glowing spectral eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x140d26 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), eyeMat);
    eye.position.set(sx * 0.42, 1.85, 1.08);
    g.add(eye);
  }
  return g;
}

/**
 * Builds a gnarled haunted tree using curved TubeGeometry branches.
 */
function buildGnarledTree(trunkMat) {
  const tree = new THREE.Group();
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.4, 2.2, -0.2),
    new THREE.Vector3(-0.3, 4.5, 0.3),
    new THREE.Vector3(0.2, 6.8, 0),
  ]);
  const trunk = new THREE.Mesh(new THREE.TubeGeometry(trunkCurve, 10, 0.55, 7, false), trunkMat);
  tree.add(trunk);

  for (let b = 0; b < 3; b++) {
    const ang = (b / 3) * Math.PI * 2 + 0.4;
    const branchCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 4.2 + b * 0.6, 0),
      new THREE.Vector3(Math.cos(ang) * 1.8, 5.6 + b * 0.5, Math.sin(ang) * 1.8),
      new THREE.Vector3(Math.cos(ang) * 3.1, 6.4 + b * 0.3, Math.sin(ang) * 3.1),
    ]);
    const branch = new THREE.Mesh(new THREE.TubeGeometry(branchCurve, 7, 0.22, 6, false), trunkMat);
    tree.add(branch);
  }
  return tree;
}

export function buildThemeLandmarks(path, themeId) {
  const group = new THREE.Group();
  group.name = 'zario-track-landmarks';

  const isVolcano = themeId === 5;
  const isMansion = themeId === 6;
  const isCanyon = themeId === 3;
  const center = computeTrackCenter(path);

  // 1. Central Hero Architecture for Volcano (5) and Mansion (6)
  if (isVolcano) {
    group.add(buildVolcanoCaldera(center));
  } else if (isMansion) {
    group.add(buildHauntedManor(center));
  }

  // 2. Sculpted Overhead Course Gates at 4 checkpoints along the loop
  const gateColors = isVolcano
    ? [0x2b1d20, 0xff5412, 0xffb703]
    : isMansion
      ? [0x2a233d, 0x52ffbc, 0x9d4edd]
      : isCanyon
        ? [0xd96b43, 0xffd166, 0x8d4024]
        : [0x78bffb, 0xff8fc7, 0xffe169];

  const primaryMat = toonMaterial(gateColors[0], { roughness: 0.78 });
  const accentMat = new THREE.MeshBasicMaterial({ color: gateColors[1] });
  accentMat.toneMapped = false;
  const trimMat = toonMaterial(gateColors[2], { emissive: gateColors[2], emissiveIntensity: 0.25 });

  // Sculpted arch tube instead of primitive torus + cylinder + cone stack
  const archSpan = 6.2;
  const archHeight = 6.8;
  const archCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-archSpan, 0, 0),
    new THREE.Vector3(-archSpan * 0.92, archHeight * 0.55, 0),
    new THREE.Vector3(-archSpan * 0.48, archHeight * 0.95, 0),
    new THREE.Vector3(0, archHeight * 1.08, 0),
    new THREE.Vector3(archSpan * 0.48, archHeight * 0.95, 0),
    new THREE.Vector3(archSpan * 0.92, archHeight * 0.55, 0),
    new THREE.Vector3(archSpan, 0, 0),
  ]);
  const archGeo = new THREE.TubeGeometry(archCurve, 24, 0.44, 10, false);

  // Sculpted pedestal bases (Lathe)
  const baseProfile = [
    new THREE.Vector2(0.95, 0),
    new THREE.Vector2(0.82, 0.45),
    new THREE.Vector2(0.64, 1.2),
    new THREE.Vector2(0.52, 2.2),
  ];
  const pedestalGeo = new THREE.LatheGeometry(baseProfile, 12);

  // Crown crest (Extruded star/horn crest at the apex of the arch)
  const crestGeo = new THREE.OctahedronGeometry(0.95, 1);

  for (const [index, t] of [0.09, 0.31, 0.57, 0.82].entries()) {
    const p = path.getPointAt(t);
    const dir = path.getTangentAt(t);
    const yaw = Math.atan2(dir.x, dir.z);
    const pivot = new THREE.Group();
    pivot.position.set(p.x, p.y + 0.18, p.z);
    pivot.rotation.y = yaw;

    const archMesh = new THREE.Mesh(archGeo, index % 2 === 0 ? primaryMat : trimMat);
    pivot.add(archMesh);

    for (const sign of [-1, 1]) {
      const ped = new THREE.Mesh(pedestalGeo, trimMat);
      ped.position.set(sign * archSpan, 0, 0);
      pivot.add(ped);

      // Glowing lantern / magma orb / crystal on each pillar
      const orb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.58, 1), accentMat);
      orb.position.set(sign * (archSpan - 0.35), 3.4, 0);
      pivot.add(orb);
    }

    const crest = new THREE.Mesh(crestGeo, accentMat);
    crest.position.set(0, archHeight * 1.12, 0);
    crest.scale.set(1.6, 1.1, 0.6);
    pivot.add(crest);

    group.add(pivot);
  }

  // 3. Roadside Sculpted Landmarks (Instanced + Hero clusters)
  const scenicCount = 36;
  const mainGeo = isVolcano
    ? createObsidianSpireGeometry(2.4, 11.5)
    : isMansion
      ? createTombstoneGeometry()
      : isCanyon
        ? createSculptedMesaGeometry(2.6, 10.2)
        : new THREE.DodecahedronGeometry(2.9, 2);

  const secondaryGeo = isVolcano
    ? createObsidianSpireGeometry(1.4, 5.2)
    : isMansion
      ? new THREE.OctahedronGeometry(0.95, 1)
      : isCanyon
        ? createSculptedMesaGeometry(1.5, 4.6)
        : new THREE.DodecahedronGeometry(1.8, 2);

  const mainScenicMat = new THREE.MeshLambertMaterial({
    color: isVolcano ? 0x2b1d20 : isMansion ? 0x564d6e : isCanyon ? 0xc46f55 : 0xedf7ff,
    flatShading: isVolcano || isCanyon,
  });
  const secScenicMat = new THREE.MeshLambertMaterial({
    color: isVolcano ? 0xff5412 : isMansion ? 0x52ffbc : isCanyon ? 0xf1ae79 : 0xffbee2,
    emissive: isVolcano ? 0xd93800 : isMansion ? 0x2ec4a6 : 0x000000,
    emissiveIntensity: isVolcano || isMansion ? 0.55 : 0,
    flatShading: true,
  });

  const largeInst = new THREE.InstancedMesh(mainGeo, mainScenicMat, scenicCount);
  const smallInst = new THREE.InstancedMesh(secondaryGeo, secScenicMat, scenicCount);
  largeInst.castShadow = false;
  smallInst.castShadow = false;

  const dummy = new THREE.Object3D();
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const trunkMat = toonMaterial(0x23192d, { roughness: 0.92 });
  const lavaPoolMat = new THREE.MeshBasicMaterial({ color: 0xff6214 });
  lavaPoolMat.toneMapped = false;

  for (let i = 0; i < scenicCount; i++) {
    const t = (i + 0.45) / scenicCount;
    path.getPointAt(t, point);
    path.getTangentAt(t, tangent);
    const side = i % 2 === 0 ? 1 : -1;
    const lateral = 15 + (i % 4) * 5.2;
    const nx = -tangent.z * side;
    const nz = tangent.x * side;
    const baseY = point.y - 0.2;

    dummy.position.set(point.x + nx * lateral, baseY, point.z + nz * lateral);
    dummy.rotation.set(0, i * 0.9, 0);
    const s = isMansion ? 1.8 + (i % 3) * 0.4 : 0.85 + (i % 3) * 0.24;
    dummy.scale.set(s, s * (1 + (i % 2) * 0.25), s);
    dummy.updateMatrix();
    largeInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(
      point.x + nx * (lateral + 4.2),
      isMansion ? point.y + 2.4 + (i % 3) * 0.8 : baseY + 0.2,
      point.z + nz * (lateral + 4.2)
    );
    dummy.scale.setScalar(0.85 + (i % 4) * 0.18);
    dummy.updateMatrix();
    smallInst.setMatrixAt(i, dummy.matrix);

    // Extra sculpted set-pieces on Volcano (lava pools) and Mansion (floating ghosts & gnarled trees)
    if (isVolcano && i % 3 === 0) {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(4.2 + (i % 3) * 1.6, 14), lavaPoolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(point.x + nx * (lateral + 2.5), point.y + 0.05, point.z + nz * (lateral + 2.5));
      group.add(pool);
    } else if (isMansion && i % 3 === 0) {
      const ghost = buildSculptedGhost(i % 2 === 0 ? 0xe8f7ff : 0xd8b4fe);
      ghost.position.set(point.x + nx * (lateral - 2.0), point.y + 2.2 + (i % 3) * 1.1, point.z + nz * (lateral - 2.0));
      ghost.lookAt(point.x, point.y + 1.5, point.z);
      group.add(ghost);

      const tree = buildGnarledTree(trunkMat);
      tree.position.set(point.x + nx * (lateral + 3.5), baseY, point.z + nz * (lateral + 3.5));
      tree.rotation.y = i * 1.3;
      group.add(tree);
    }
  }

  largeInst.instanceMatrix.needsUpdate = true;
  smallInst.instanceMatrix.needsUpdate = true;
  group.add(largeInst, smallInst);

  zarioLogger.info(LogCategory.MODEL, 'Built sculpted ThemeLandmarks for themeId=' + themeId, {
    themeId,
    isVolcano,
    isMansion,
    scenicCount,
  });

  return group;
}
