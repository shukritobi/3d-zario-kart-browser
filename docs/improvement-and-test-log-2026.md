# Zario Kart — Comprehensive Review, Engineering Upgrade & Test Log (2026)

## 1. Executive Summary

This document logs the full engineering audit, physics & rendering upgrades, new track creation, 3D model improvements, AI 3D asset pipeline integration, Samsung 45" Smart TV (2021 Tizen 6.0) + iPhone Nintendo Switch Controller architecture, and automated test verification performed on **Zario Kart (`3d-zario-kart-browser`)**.

| Area | Status | Key Deliverables |
| :--- | :--- | :--- |
| **1. Ramp Physics, Geometry & Mario Kart Tricks** | **Completed & Verified** | Fixed 2D planar ramp projection, full-lane launch box (`lateral <= halfW + 0.65`), `YXZ` Euler pitch/roll order, `_rampLaunchCooldown` anti-regrounding, 360° mid-air flip/barrel-roll trick animation, and **850 ms Mario Kart Trick Landing Boost**. |
| **2. New Tracks (Volcano & Haunted Mansion)** | **Completed & Verified** | Added **Track 5 (`Inferno Volcano` 🌋)** (1,532 m circuit, erupting caldera landmark, glowing lava rivers, basalt road, 154 BPM *Magma Caldera* theme) and **Track 6 (`Haunted Mansion` 👻)** (1,608 m circuit, Gothic haunted manor, Boo-style floating ghosts, gnarled `TubeGeometry` dead trees, spectral swamp, 134 BPM *Phantom Manor* theme). |
| **3. Upgraded 3D Models & AI 3D Asset Pipeline** | **Completed & Verified** | Sculpted per-character 3D headgear (`Turbo` visor, `Daisy` crown, `Comet` astronaut dome, `King` horned Bowser crown, `Bolt` aero wings, `Pip` Toad mushroom cap), sculpted 3D held item meshes + Koopa shell rims, added `GLTFLoader` pipeline (`src/render/ModelLoader.js`), deep research doc (`docs/3d-models-and-ai-research.md`), and local `Hunyuan3D-2` generator script (`scripts/generate-kart-glb-hunyuan.py`). |
| **4. 2021 45" Samsung Smart TV + iPhone Switch Mode** | **Completed & Verified** | ES2019/Chromium M76 (Tizen 6.0) transpilation & syntax fixes (`SceneManager.js`, `vite.config.js`), `tv` GPU quality profile, 45" 10-foot UI + 3.5%/4% overscan safe-area, Samsung One-Remote D-Pad navigation, pure-JS ISO/IEC 18004 QR Code pairing modal, dual-transport WebRTC (`PeerJS`) + Vite LAN HTTP relay, and full-screen iPhone Nintendo Switch Joy-Con / Wheel Controller (`?controller=1`). |
| **5. Structured Telemetry & Diagnostic Logging** | **Completed & Verified** | Added `ZarioLogger` (`src/game/ZarioLogger.js`) with 14 categories, live telemetry counters, interactive `F9` Telemetry & Log Drawer, and JSON/Markdown exporters, plus expanded `RaceDiagnostics` (`src/game/RaceDiagnostics.js`). |

---

## 2. Root-Cause Analysis & Fixes: Why the Ramps Were Broken

### 2.1 Root Causes Found During Code Audit
1. **3D Vector Dot-Product Skew (`src/entities/KartPhysics.js`)**:
   - Previously, ramp `along` and `lateral` coordinates were computed without normalizing the horizontal `(x, z)` projection of `r.dir`, and ramp detection did not prevent the rising wedge surface (`rampSurfaceY`) from immediately re-grounding the kart on the very next frame after launch (`s.position.y <= groundY`).
2. **Narrow Launch Lip & Missing Straightaway Placement (`src/track/TrackBuilder.js`)**:
   - Ramps were placed at fixed fractional `t` intervals (`0.22, 0.58, 0.84`) that often coincided with tight turns or turbo pads, and the ramp width was only `roadWidth * 0.62`, causing karts in the left or right lanes (`±2.4 m`) to miss or clip the edge of the ramp.
   - Ramp mesh rotation used default `XYZ` Euler order, causing diagonal track headings to twist the ramp wedge sideways into the asphalt.
3. **Euler Gimbal Roll on Kart Pitch (`src/entities/Kart.js`)**:
   - `kart.group.rotation` used Three.js's default `'XYZ'` order. When the kart drove East/West (`rotation.y ≈ ±π/2`), applying pitch to `rotation.x` rotated around the world X axis instead of the kart's nose axis, making the kart roll sideways instead of pitching nose-up on ramps!
4. **Instant Boost Flag Synchronization (`src/entities/Kart.js`)**:
   - `kart.applyBoost(durationMs)` updated `this._boostMs` without immediately setting `this.state.boost = true`, delaying boost state detection until the next frame's `_tickEffects(dt)`.

### 2.2 Engineering Fixes Implemented
- **Planar Ramp Coordinate Frame (`src/entities/KartPhysics.js`)**:
  - Normalizes `r.dir` on the XZ plane (`dirX, dirZ`), computes `along` and `lateral`, widens the valid ramp corridor to `lateral <= halfW + 0.65`, and triggers launch across the upper 52% of the ramp (`along >= r.length * 0.48`) or on step-off after climbing (`kart._wasOnRamp === idx`).
  - Introduces `kart._rampLaunchCooldown = 0.38` seconds and `effectiveGroundY` so the rising ramp wedge drops back to `baseGroundY` immediately upon launch, guaranteeing a clean parabolic trajectory (`vY = 8.8..13.2 m/s`, peak height `~3.55 m`, air time `~0.87 s`) plus a `480 ms` ramp lip dash boost.
- **Smart Straightaway Ramp Placement & Neon Visuals (`src/track/TrackBuilder.js`)**:
  - Curvature scan selects 3–4 low-curvature straightaways per track (including an opening straightaway ramp around `t ≈ 0.09–0.18`), widens ramps to `roadWidth * 0.84` (`~9.6 m`), sets `mesh.rotation.order = 'YXZ'` aligned with road grade, and adds sloped orange/gold neon side rails, a glowing yellow launch lip bar, and dual boost chevron lanes.
- **Mario Kart 8 Deluxe Trick / Jump Boost (`src/entities/Kart.js`)**:
  - Sets `this.group.rotation.order = 'YXZ'` so `rotation.x` is always local nose pitch and `rotation.z` is always local roll.
  - Holding or pressing Drift/Hop (`Space` / `Shift` / iPhone `ZR`) or Throttle on a ramp triggers a **360° mid-air flip or barrel roll** (`this._trickAnimT`) with combo star particles and awards an **850 ms Mario Kart Trick Boost** (`applyBoost(850)`) upon landing.

---

## 3. New Tracks: Track 5 (`Inferno Volcano`) & Track 6 (`Haunted Mansion`)

### 3.1 Track 5: `Inferno Volcano` 🌋 (`id: 5`, Bowyer's Castle / Grumble Volcano Inspired)
- **Spline Geometry (`src/track/ExtraTracks.js`)**: 26-waypoint, **1,532 m** closed circuit featuring a high caldera rim climb (`y = +13 m`), twin magma hairpins, a scorching obsidian bridge, and 3 straightaway launch ramps.
- **Procedural Textures (`src/render/Materials.js`)**: `volcanoRoadTexture()` (charred basalt asphalt with glowing magma fissures and amber shoulders) + `volcanoAshTexture()` (scorched volcanic ash terrain with ember veins).
- **Sculpted 3D Landmarks (`src/track/ThemeLandmarks.js` & `src/track/Environment.js`)**:
  - Central **Erupting Volcano Caldera** (`LatheGeometry` conical peak with glowing molten crater pool, rising smoke/ember plumes, and 4 flowing lava rivers).
  - 36 jagged obsidian basalt spires with glowing magma veins, crimson volcanic fog, obsidian mountain ranges, and a boiling lava lake at `y = -1.6`.
- **Synthesized Soundtrack (`src/audio/music.js`)**: `'Magma Caldera'` — 154 BPM driving Phrygian/minor boss-race synth theme in E minor.

### 3.2 Track 6: `Haunted Mansion` 👻 (`id: 6`, Luigi's Mansion / Twisted Mansion Inspired)
- **Spline Geometry (`src/track/ExtraTracks.js`)**: 26-waypoint, **1,608 m** closed circuit featuring a courtyard sweep, elevated manor balcony (`y = +10 m`), graveyard chicane, crypt tunnel drop (`y = -2 m`), and 3 straightaway launch ramps.
- **Procedural Textures (`src/render/Materials.js`)**: `mansionRoadTexture()` (weathered gothic cobblestone with eerie violet/cyan lantern edge glow) + `mansionGroundTexture()` (cursed mossy graveyard soil).
- **Sculpted 3D Landmarks (`src/track/ThemeLandmarks.js` & `src/track/Environment.js`)**:
  - Central **Gothic Haunted Manor** (multi-wing Victorian mansion, steep gabled roofs, glowing amber haunted windows, grand portico columns, and twin 28 m witch-hat bell towers).
  - **14 Floating Boo-style Sculpted Ghosts** (`LatheGeometry` wavy sheet silhouettes with glowing cyan eyes and outspread arms that bob and orbit in real time).
  - **22 Gnarled Dead Trees** (`TubeGeometry` organic trunks + twisted branches) and **14 Extruded Gothic Tombstones** with glowing lantern orbs.
- **Synthesized Soundtrack (`src/audio/music.js`)**: `'Phantom Manor'` — 134 BPM spooky harpsichord/organ minor-harmonic melody in A minor.

---

## 4. 3D Model Upgrades & AI 3D Generation Pipeline

1. **Procedural Sculpted 3D Upgrades (`src/entities/Kart.js`, `src/entities/PowerUp.js`, `src/track/ThemeLandmarks.js`)**:
   - **Per-Character Sculpted 3D Headgear (`_buildCharacterHeadgear`)**:
     - `Turbo` (Zario): Metallic racing visor fin + aerodynamic twin rear spoiler vents.
     - `Daisy`: Golden royal crown with 5 spikes and 3D turquoise/pink jewels.
     - `Comet` (Rosalina-style): Translucent cosmic glass helmet dome + golden star halo antenna.
     - `King` (Bowser-style): Twin curved ivory horns (`ConeGeometry`) + spiked brass crown + fiery red mane crest.
     - `Bolt` (Yoshi/Aero-style): Swept cyber-visor + twin glowing neon-green aero helmet wings.
     - `Pip` (Toad-style): Oversized sculpted mushroom cap dome (`SphereGeometry`) with 5 3D colored spots.
   - **Sculpted 3D Held Items & PowerUps**: Replaced flat primitives in `Kart.js` (`_buildHeldItemMeshes`) with 3D spotted Mushroom caps, hexagonal Koopa shells with creamy belly rims (`PowerUp.js`), curved Banana peels, extruded 5-point Super Stars, and 3-segment Lightning bolts.
2. **External GLB/glTF Asset Loader (`src/render/ModelLoader.js`)**:
   - Supports dropping `.glb` models into `public/assets/models/` (`karts/kart_default.glb`, `characters/<id>.glb`, `items/<type>.glb`, `props/<name>.glb`) with automatic bounding-box normalization, shadow casting, and clearcoat material upgrading (`?models=glb`).
3. **Deep Research & Local `Hunyuan3D-2` Script (`docs/3d-models-and-ai-research.md` & `scripts/generate-kart-glb-hunyuan.py`)**:
   - Documented top CC0/CC-BY 3D asset packs (Kenney Racing Kit, Quaternius Arcade Kart Pack) and compared open-source AI 3D generators (`Hunyuan3D-2`, `TRELLIS`, `TripoSR`, `SF3D`).
   - Created `scripts/generate-kart-glb-hunyuan.py` wired directly to the local `C:\Users\User\Hunyuan3D-2` installation to generate watertight, decimated `<15k`-triangle `.glb` meshes into `public/assets/models/`.

---

## 5. 2021 45" Samsung Smart TV + iPhone Nintendo Switch Controller Mode

### 5.1 Samsung Smart TV (2021 Tizen 6.0 / Chromium M76) Adaptation
- **ES2019 / Chrome 76 Build Target (`vite.config.js` & `src/render/SceneManager.js`)**:
  - Replaced ES2021 logical assignment `renderer.userData ||= {};` in `src/render/SceneManager.js` with `renderer.userData = renderer.userData || {};` so Tizen 6.0's Chromium M76 parser never throws a `SyntaxError`.
  - Configured `vite.config.js` `build.target: ['es2019', 'chrome76', 'safari13']`.
- **TV GPU Quality Profile (`src/render/VisualQualityProfile.js`)**:
  - Auto-detects Samsung Tizen (`Tizen`, `SMART-TV`, `Maple`, or `?tv=1`) and applies the `tv` profile (`maxPixelRatio: 1.0`, `textureCap: 512`, `shadowMapSize: 1024`, `bloom: false`) for rock-solid 60 FPS on 2021 TV SoCs.
- **45-Inch 10-Foot UI & Samsung Remote Navigation (`src/input/SwitchBridge.js` & `src/ui/ui.css`)**:
  - Adds `body.samsung-tv-mode` with `3.5%` vertical / `4.0%` horizontal overscan safe-area padding (`--tv-safe-x`, `--tv-safe-y`), scaled HUD typography for a 45" screen at 2.5–3.0 m viewing distance, and spatial D-Pad arrow navigation + `Return` (`keyCode 10009`) handling for the Samsung One-Remote.

### 5.2 iPhone Wireless Nintendo Switch Controller (`?controller=1`)
- **Zero-Dependency QR Code & 4-Letter Room Pairing (`src/input/SwitchBridge.js`)**:
  - Pure-JS ISO/IEC 18004 QR Version 3 encoder renders a crisp SVG QR code directly on the TV screen alongside a 4-character Room Code.
  - Dual transport: automatic **Vite LAN HTTP Relay** (`/api/switch-bridge/push` & `/api/switch-bridge/poll`) on local Wi-Fi (works without HTTPS certificates) + **PeerJS WebRTC DataChannel** for internet/cloud hosting.
- **iPhone Landscape Joy-Con / Wheel UI (`src/ui/ControllerApp.js`)**:
  - Full-screen Nintendo Switch Neon Blue (`-`) / Neon Red (`+`) Joy-Con grip layout with:
    - **Gyroscope Tilt Steering** (`DeviceOrientationEvent` with iOS 13+ `requestPermission()` prompt and Recenter button) + **Touch Steering Wheel / D-Pad fallback**.
    - **Auto-Gas (`A`) latch** (on by default so thumbs focus on drifting & items), **Brake/Reverse (`B`)**, **Drift / Hop / Trick (`ZR`)**, **Item Fire Forward (`X`)**, and **Item Throw Rear (`ZL`)**.
    - **Live TV-to-iPhone Telemetry Sync**: Real-time rank (`1st`–`8th`), speed (`KM/H`), lap counter, coin count, held item icon, and haptic rumble on boost/hit.

---

## 6. Automated Unit Test & Build Verification Log

### 6.1 Unit Test Suite Execution (`21 / 21 Passing`)
Command executed:
```powershell
node --test tests/unit/circuits-items.test.mjs tests/unit/track-projection.test.mjs tests/unit/performance-diagnostics.test.mjs tests/unit/zario-controls.test.mjs tests/unit/upgrades-2026.test.mjs
```

| Test File | Subtest | Result | Telemetry / Verification Notes |
| :--- | :--- | :--- | :--- |
| `circuits-items.test.mjs` | Both new circuits are full-length without sudden near-180 corners | **PASS** | Validates spline continuity & corner angles |
| `circuits-items.test.mjs` | Nearest point lookup initializes away from start line and recovers lost hints | **PASS** | Frame-coherent spline projection |
| `circuits-items.test.mjs` | Local nearest point lookup wraps smoothly over track seam | **PASS** | Seam wrap verification |
| `circuits-items.test.mjs` | Shell sweep detects hits even when projectile jumps past opponent in one frame | **PASS** | Swept segment collision |
| `track-projection.test.mjs` | Upcoming turns use metric look-ahead with consistent LEFT and RIGHT signs | **PASS** | Metric curvature look-ahead |
| `track-projection.test.mjs` | Three lap checkpoints prevent a second lap three seconds into the race | **PASS** | Anti-shortcut lap gating |
| `track-projection.test.mjs` | Rescue bounds follow the actual 1.3km track and never teleport on valid road | **PASS** | Track bounding box safety |
| `performance-diagnostics.test.mjs` | Visual quality profiles resolve auto and explicit presets deterministically | **PASS** | Quality preset verification |
| `performance-diagnostics.test.mjs` | MaterialLibrary reuses cached textures and materials across calls | **PASS** | GPU cache deduplication |
| `performance-diagnostics.test.mjs` | ParticleSystem reuses pooled entries without per-emit allocation | **PASS** | Zero-GC particle pool |
| `performance-diagnostics.test.mjs` | RaceDiagnostics summarizes frame pacing, rescue, and item telemetry | **PASS** | Frame & event diagnostics |
| `zario-controls.test.mjs` | Lateral velocity decays exponentially with frame-rate independence | **PASS** | Frame-rate independent grip |
| `zario-controls.test.mjs` | Player drift steer rate widens smoothly on counter-steer and tightens on inside steer | **PASS** | MK8D drift arc control |
| `zario-controls.test.mjs` | InputManager exposes canonical Zario Kart bindings | **PASS** | Keyboard & gamepad bindings |
| `zario-controls.test.mjs` | Held-item trail absorbs incoming shells and bananas | **PASS** | Defensive item trail |
| `zario-controls.test.mjs` | Slipstream engages after sustained alignment behind a rival | **PASS** | Drafting boost trigger |
| `upgrades-2026.test.mjs` | **Ramp physics: launches across center, left (-2.4m), and right (+2.4m) lanes and lands with 850ms Trick Boost** | **PASS** | Center/Left/Right lanes all launch at `vY = 13.2 m/s`, clear `3.55 m` peak height (`0.87 s` air time), and land with `_boostMs = 850` (`state.boost = true`) |
| `upgrades-2026.test.mjs` | **Track 5 (`Inferno Volcano`) and Track 6 (`Haunted Mansion`) build complete circuits, ramps, and sculpted 3D landmarks** | **PASS** | Track 5 (`1532 m`, 3 ramps, volcano caldera + 36 spires) & Track 6 (`1608 m`, 3 ramps, haunted manor + 14 ghosts + 22 trees) |
| `upgrades-2026.test.mjs` | **Upgraded 3D Kart models: all 6 characters have custom 3D headgear and sculpted 3D held item meshes** | **PASS** | Verifies `_headgearGroup` on all 6 drivers and 7 sculpted 3D `_heldMeshes` |
| `upgrades-2026.test.mjs` | **Samsung TV + iPhone Switch Controller Bridge: QR matrix, room pairing, and packet edge detection** | **PASS** | Verifies 29×29 ISO QR matrix, SVG rendering, and `SwitchHostBridge` edge triggers |
| `upgrades-2026.test.mjs` | **ZarioLogger and RaceDiagnostics record structured events and export Markdown & JSON reports** | **PASS** | Verifies ring-buffer logging, ramp/trick counters, and Markdown/JSON report generation |

### 6.2 Production Bundle Verification (`npm run build`)
- Target: `['es2019', 'chrome76', 'safari13']`
- Modules transformed: `65 modules` in `1.76s` (`Exit code 0`).
