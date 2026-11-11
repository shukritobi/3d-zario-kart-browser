# Phase 2: verified production status (2026-11-11)

**Draft only. No game runtime modifications and no live game-ready assets.**

The approved project has six original character design sets and six kart design sets. A check of all twelve Google Drive `01_Source_GLB` directories found **one** original 3D source, Turbo's Hunyuan3D character GLB; all other original-source directories were empty.

- Turbo original: 43,820,988 bytes; SHA-256 `300f2a04bedc15bcb6f8dd6c6f0fc8136b3b766a41c28aed8649ad3835cd486c`; ~50,000 triangles; no skin or animations.
- Turbo optimized **unrigged preview**: 4,977,252 bytes with 1024px embedded textures; structure/UV preserved; fails release checks for rig, animations and mobile budget.
- Flare Runner **mechanical blockout**: 9,616 triangles, four individually grouped wheels, front steering pivots, seat and steering-wheel anchors. Wheel centers match `src/entities/Kart.js`: X ±0.765, Z ±0.67, local Y=0. Needs visual/UV/material checks and art refinement.
- Safer Windows production toolkit version 2: separate backups/versioned WIP outputs, 12-asset menu, explicit manual rig/retopo review. Offline Python test suite: five passing. Blender 4.5.2 on user's Windows PC and real mobile browsers **not tested**.
- The model manifest uses paths relative to `asset-manifest.json`; consumers must use `new URL(relativePath, manifestUrl)` for compatibility with Vite subpath deployments.

Download the WIP toolkit ZIP from Google Drive: https://drive.google.com/file/d/1DvAta9AARb46qCFMKF0p6pkQX_5C4EVg/view?usp=drivesdk

Do **not** merge as a playable feature until Turbo has approved retopology, skinning, seated/steering animations, and Flare Runner plus opt-in replacement loader pass browser/mobile QA. Existing `ModelLoader.js` overlays optional GLBs over procedural visuals.
