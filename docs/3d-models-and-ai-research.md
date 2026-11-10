# Deep Research: 3D Models Online & AI 3D Model Generation for Zario Kart (2026)

This document answers the engineering and art pipeline question:
> *"The models should be looking better — right now it's just primitives stacking on each other. Do deep research on if you can get models online or repo for AI models to model better."*

---

## 1. Why the Original Models Looked Like "Stacked Primitives" (Root Cause Audit)

During our codebase audit of `src/entities/Kart.js`, `src/entities/PowerUp.js`, and `src/track/ThemeLandmarks.js`, we identified three specific areas where meshes read as basic geometric primitives:
1. **Course Landmarks (`src/track/ThemeLandmarks.js`)**:
   - Previously stacked a raw 8-sided `CylinderGeometry` post + `ConeGeometry` cap + `BoxGeometry` sign, and used raw 6- or 7-sided `ConeGeometry(1.8, 9.5, 7)` for roadside scenery.
   - **Fix Applied in Code**: Replaced with sculpted `LatheGeometry` stepped mesas and volcanic obsidian spires with radial crag displacement, `TubeGeometry` spline arches, a colossal sculpted **Volcano Caldera** with flowing `TubeGeometry` lava rivers, a **Gothic Haunted Manor** with mansard roofs and glowing arched windows, sculpted **Boo-style Floating Ghosts**, and gnarled `TubeGeometry` dead trees.
2. **Held & World Power-Up Items (`src/entities/Kart.js` & `src/entities/PowerUp.js`)**:
   - Previously used an untextured `SphereGeometry` + `CylinderGeometry` for the mushroom, a tilted `CylinderGeometry` for the banana, and a bare `SphereGeometry` for held shells.
   - **Fix Applied in Code**: Replaced with a polka-dotted 3D **Super Mushroom**, **Koopa Shells** with creamy white equator rim collars and dorsal spikes, a curved crescent **Banana**, an extruded 5-pointed beveled **Super Star** (`ExtrudeGeometry`), and an extruded 3D **Lightning Bolt**.
3. **Driver Silhouettes (`src/entities/Kart.js`)**:
   - Previously all 6 racers wore the exact same plain sphere helmet (`SphereGeometry(0.17)`).
   - **Fix Applied in Code**: Added `_buildCharacterHeadgear()` giving each racer a distinct sculpted 3D silhouette:
     - **Turbo**: Forward racing visor brim + twin dorsal aero strakes
     - **Daisy**: Golden royal crown with 4 peaks + faceted sapphire jewel
     - **Comet**: Swept-back cosmic valkyrie winglet fins (`ExtrudeGeometry`)
     - **King**: Curved ivory horns (`TubeGeometry`) + 3 dorsal dragon spikes
     - **Bolt**: 3 rounded dino crest fins along the helmet spine
     - **Pip**: Oversized Toad-style mushroom dome cap with polka-dot spots

---

## 2. Best Online CC0 / Royalty-Free 3D Model Repositories (GLB / glTF)

Zario Kart now includes `src/render/ModelLoader.js`, which loads `.glb` / `.gltf` files from `public/models/` with automatic bounding-box normalization and Mario Kart clearcoat PBR material adaptation.

### Top Direct-Download CC0 Asset Packs (No Attribution Required, Commercial & Open-Source Safe)

| Asset Pack / Source | URL | License | Best Used For in Zario Kart |
| :--- | :--- | :--- | :--- |
| **Kenney Racing Kit** | `https://kenney.nl/assets/racing-kit` | **CC0 1.0** | 170+ low-poly stylized GLB models: karts, formula cars, grandstands, pit buildings, curbs, tire barriers, gantry arches. |
| **Kenney Toy Car Kit** | `https://kenney.nl/assets/toy-car-kit` | **CC0 1.0** | Stylized arcade toy-proportioned vehicles that match Mario Kart's chibi/chunky proportions. |
| **Kenney Graveyard Kit** | `https://kenney.nl/assets/graveyard-kit` | **CC0 1.0** | Gothic iron fences, crypts, gravestones, dead trees, and lanterns for **Track 6 (Haunted Mansion)**. |
| **Quaternius Arcade Vehicles Pack** | `https://quaternius.com/packs/ultimateievehicles.html` | **CC0 1.0** | Clean topology GLB vehicles with separated wheel meshes ready for `Kart.js` spin/steering pivots. |
| **Poly Pizza (CC0 Bundles)** | `https://poly.pizza` | **CC0 / CC-BY** | Searchable repository of 9,000+ low-poly GLB props (volcanoes, castles, mushrooms, ghosts, trophies). |
| **KayKit — Spooky Halloween Pack** | `https://kaylousberg.itch.io/kaykit-halloween-bits` | **CC0 1.0** | High-craft stylized cartoon crypts, pumpkins, ghosts, and haunted manor pieces. |

---

## 3. Open-Source AI 3D Model Generation Repositories (Image-to-3D & Text-to-3D)

To generate custom, bespoke Mario Kart-style 3D models (`.glb` with PBR textures) using AI on your own GPU or cloud, these are the leading open-source repositories as of 2026:

### Tier 1: Best Open-Source AI 3D Generators

| Repository | GitHub URL | Architecture | VRAM Needed | Output Quality & Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Tencent Hunyuan3D-2 / 2.1** | `https://github.com/Tencent-Hunyuan/Hunyuan3D-2` | Flow-matching DiT (`Hunyuan3D-DiT-v2-0`) + Multi-view Delighting Paint (`Hunyuan3D-Paint-v2-0`) | 6 GB (shape) / 12–16 GB (shape + texture) | **Already installed on your PC at `C:\Users\User\Hunyuan3D-2`!** Produces clean watertight meshes and UV-unwrapped PBR textures in `.glb` format. |
| **Microsoft TRELLIS** | `https://github.com/microsoft/TRELLIS` | Structured 3D Latents (`SLAT`) -> Mesh + 3DGS + Radiance Fields | 16 GB | Exceptional at complex stylized geometry (e.g., Haunted Mansion architecture, Bowser-style spiky karts) with sharp edges and clean GLB export. |
| **VAST-AI TripoSG / TripoSR** | `https://github.com/VAST-AI-Research/TripoSG` / `https://github.com/VAST-AI-Research/TripoSR` | Feed-forward Transformer / Rectified Flow | 4–8 GB | Sub-second to 5-second single-image-to-GLB generation; ideal for rapid batch generation of trackside props (mushrooms, shells, rocks, trees). |
| **MeshAnything V2** | `https://github.com/buaacyw/MeshAnythingV2` | Autoregressive Artist-Topology Remesher | 8 GB | Converts dense AI SDF/marching-cubes meshes into clean, low-poly game-ready quad/triangle topology (<1,500 tris) for WebGL/Three.js. |

---

## 4. Using Your Local `C:\Users\User\Hunyuan3D-2` Installation to Generate Zario Kart `.glb` Models

During our environment inspection, we detected that you already have **`C:\Users\User\Hunyuan3D-2`** installed locally on your machine!

We created a turnkey automation script at [`scripts/generate-kart-glb-hunyuan.py`](../scripts/generate-kart-glb-hunyuan.py) that connects directly to `C:\Users\User\Hunyuan3D-2`:
1. Takes a reference concept image (or auto-renders a clean stylized prompt/reference silhouette) for karts (`kart-standard.glb`, `kart-speed.glb`, `kart-heavy.glb`, `kart-compact.glb`), items (`mushroom.glb`, `shell.glb`), or landmarks (`volcano-caldera.glb`, `haunted-manor.glb`).
2. Runs `Hunyuan3DDiTPipeline` (`Tencent/Hunyuan3D-2mini` or `Tencent/Hunyuan3D-2`) + `FaceReducer` + `FloaterRemover` + `DegenerateFaceRemover` to decimate the mesh to WebGL-friendly triangle counts (`~2,500 faces`).
3. Optionally runs `Hunyuan3DPaintPipeline` to bake stylized UV textures.
4. Exports the optimized `.glb` directly into `public/models/karts/` or `public/models/landmarks/`.
5. Run Zario Kart with `?models=glb` (e.g., `http://localhost:5173/?models=glb`) to load the `.glb` models via [`src/render/ModelLoader.js`](../src/render/ModelLoader.js)!
