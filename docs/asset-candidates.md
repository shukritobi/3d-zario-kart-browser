# Kart model and performance shortlist

**Research date: 8 November 2026.** This is a metadata/license and technical-format validation, not a runtime or polygon-inspection certification for downloaded models. Do not call an untested asset "in-game verified."

| Source | Asset | License verified | Format from publisher | Suitability | Status |
| --- | --- | --- | --- | --- | --- |
| Existing procedural engine (Super Kart 3D.js) | Procedural kart, racer and all 3D terrain | MIT for source code | Three.js procedural Mesh geometry | Zero extra network requests, existing cohesive look | **Integrated; mobile browser smoke-tested** |
| https://kenney.nl/assets/racing-kit | 110 racing models: track sections and props | CC0 (official) | 3D files (verify conversion after download) | Easy modular circuits; stylistic tuning needed | **Catalog license verified, not integrated** |
| https://kenney-assets.itch.io/car-kit | More than 40 vehicle models | CC0 (official) | OBJ/FBX/glTF | Generic car shells, not immediately convincing karts | **Catalog license and formats verified, not integrated** |
| https://quaternius.com/packs/universalbasecharacters.html | 6 rigged characters / 20 hairstyles | CC0 (official) | glTF/FBX/OBJ/Blend | Average ~13k triangles **per character**, likely too expensive to use at native LOD for six or more racers on older phones. Retopologize / create lower LODs | **Catalog metadata verified, not integrated** |

## Decision

Keep procedural models for the initial mobile racer. Replace with a bespoke **original** chibi-like racer and rounded kart models when they can pass device budget tests, starting with just one kart. Kenney is best for track props, but its relatively angular geometry needs rounded edges, high-quality material accents, and color/lighting changes to achieve the expected vivid arcade aesthetic.

## Model integration checklist

1. Download from canonical publisher; retain asset name, URL, downloaded date and license file.
2. Check model normals, scale, UVs, baked animation, mesh names and wheel steering pivots in a GLB viewer.
3. Inspect actual triangle count and draw calls via Three.js stats. Recommended design budgets are targets only: ≤ 8k triangles for each kart including driver, ≤ 512 px textures per shared atlas, and low draw call count through InstancedMesh.
4. Convert glTF assets to GLB; optionally use KTX2 / Basis textures and meshopt mesh compression once validated on Safari.
5. Integrate a *single* new model; run mobile-emulated WebKit/Chromium tests, then benchmark it against the procedural baseline on physical Safari.
6. Create 3 LODs for near/medium/far rivals (high/medium/billboard). Replace dense roadside tree groups with instanced low-detail equivalents.

## Original Mario-Kart-like aesthetics (without importing Nintendo's designs)

- Camera: third-person behind the vehicle with readable front horizon, kart filling lower center.
- Palette: bright azure sky, saturated greens, pink coral decorations, sunny lighting, checkered borders.
- Kart: chunky toy proportions, large tires, highly rounded curves, stylized glossy plastic finish.
- Character: oversized head and face/helmet, readable gestures and silhouettes.
- World: iconic fantasy scenery, colorful track themes and landmark props, no photorealistic detail.
- Feedback: 3-tier colored drift sparks, speed lines, boost flare, item roulette, dramatic ranking pop and distinct sound cues.
- iPhone: smaller geometry and render scale, no mandatory post-FX, no infinite texture allocation; keep material color, shape design and silhouettes.

## In-browser validation

GitHub Actions mobile Chromium and WebKit smoke tests passed on commit `057f0598` on 8 Nov 2026. This does **not** establish real hardware FPS, iPhone sensor fidelity or sustained battery performance. Use `window.__zarioFrameStats()`, `window.__zarioPerformance()`, `window.__zarioControlStatus()` in Safari Web Inspector to inspect real device performance and controls.

References: https://github.com/fecolinhares/super-kart-3djs ; https://kenney.nl/assets/racing-kit ; https://kenney-assets.itch.io/car-kit ; https://quaternius.com/packs/universalbasecharacters.html
