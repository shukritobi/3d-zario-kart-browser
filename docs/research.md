# Zario Kart: research and validation notes

## Source selection

- [Super Kart 3D.js](https://github.com/fecolinhares/super-kart-3djs) (MIT): selected baseline because it already offers accessible touch controls, a procedural 3D art pipeline, arcade physics, opponents, two themed circuits, effects, and Web Audio. Its render-profile module exposes DPR, draw call and triangle diagnostics. Preserve upstream LICENSE.
- [Turbo Kart Rush](https://github.com/bridge-mind/turbo-kart-rush) (MIT): reference for TypeScript fixed-step simulation, AI, postFX and procedural models. Desktop-focused defaults, so not used as the mobile baseline.
- [Turbo Kart Rally](https://github.com/bridge-mind/turbo-kart-rally) (MIT): reference for 3-stage drift and item/race systems.
- [SF Kart](https://github.com/freecode-sh/sf-kart): reference for determinism, recorded inputs and testable physics, not a suitable lightweight mobile art source.

## Relevant published research

1. Gilbertson et al. (2008), [Using tilt as an interface to control no-button 3-D mobile games](https://doi.org/10.1145/1394021.1394031): tilt can improve perceived fun, but it requires careful UX.
2. Rocha et al. (2019), [Mapping controls on a 2D user-drawn racetracks driving game](https://doi.org/10.1145/3341215.3356302): study of 24 children found joystick preferred by inexperienced players. Therefore touch must remain available.
3. Mi & Gao (2022), [Adaptive rubber-banding system of dynamic difficulty adjustment in racing games](https://doi.org/10.3233/ICG-220207): adapt AI difficulty via position/distance without unfair teleportation.
4. Reynolds (1999), [Steering Behaviors For Autonomous Characters](https://www.red3d.com/cwr/papers/1999/gdc99steer.html): path following, obstacle avoidance and pursuit for racing opponents.

## Models and licensing

| Source | Formats | Status |
|---|---|---|
| Procedural meshes from selected engine | Generated Three.js geometry, no downloaded model files | In use. MIT engine license and credits retained |
| [Kenney Car Kit](https://kenney.nl/assets/car-kit) | glTF/GLB variants and other formats | Candidate. Verify exact asset pack license CC0 and polycounts before import |
| [Kenney Racing Kit](https://kenney.nl/assets/racing-kit) | Low-poly cars and track props | Candidate. Check each pack's license and usable scale/materials |
| [Quaternius](https://quaternius.com/) | glTF/FBX/OBJ depending on pack | Candidate for trees and props. Verify per-pack CC0 and mobile complexity |
| [Poly Pizza](https://poly.pizza/) | GLB/glTF | Candidate, but licenses differ by model (CC0 and CC-BY); verify each asset |
| Nintendo/Mario Kart art, music and character assets | Proprietary | Not imported. Create original artwork with similar bright toy-racing visual language |

### GLB intake checks (before committing)

- Verify author/source/license and whether attribution is required.
- Avoid external texture URLs. Prefer one packed GLB with embedded textures or known local paths.
- One kart should aim for < 15,000 triangles and < 1 MB compressed *as a project goal*, not an audited asset result.
- Test UVs, normals, material compatibility, scale, wheel pivot and axle geometry in Three.js.
- Target reusable atlas textures at 256–512 px for mobile and instance repeated props.

## iPhone Safari requirements

- **Tilt** requires HTTPS and a permission request on a user click (DeviceOrientationEvent.requestPermission on applicable Safari versions). Provide an easy touch fallback, calibration, dead zone, invert and smoothing.
- **Controller** uses standard Gamepad API; per-frame polling, dead zone and edge detection for items/pause.
- **Graphics**: start with DPR <= 1.4 on iOS; drop shadows/bloom and reduce particles/foliage before removing art, with ?quality=high for intentional comparisons.
- **Landscape** recommended; CSS safe-area insets for notches/gesture area. Touch buttons remain default.
- **Testing**: GitHub Actions npm/Vite production build is a syntax/packaging check only. Real iPhone Safari WebGL, tilt, audio, controller latency, thermal and frame-time tests are still required.

### Test plan

1. Verify launch without permissions (touch racing).
2. Toggle GYRO, accept prompt, rotate to landscape and RECENTER; check steering direction and invert.
3. Deny permission; verify arrows still work and game continues.
4. Pair Bluetooth controller: check analog stick, triggers, drift, item and pause.
5. Run two full races on iPhone Safari; measure average FPS / frame time, context loss, and battery heating, compare low and high profiles.
6. Verify GitHub Pages deployment and no missing JS/CSS requests from the project subpath.

## Build/Pages status

GitHub Actions completed npm install and Vite build on initial import. First deployment could not configure Pages because Pages was not enabled in repository settings. To publish: GitHub repository > Settings > Pages > Build and deployment > Source = GitHub Actions, then re-run the deployment workflow.

## Additional browser references (non-imported)

- [GR Kart · Sakura Circuit](https://github.com/Guilh/gr-kart-game): TypeScript fixed-step racing sim with tilt steering, mobile profiles, real-time replays and headless physics regression. No LICENSE was found in its current repository tree, so do **not** copy implementation without author permission.
- [GizzRacer](https://github.com/mjoslyn/GizzRacer): touch / tilt / controller support, gliding and four-tier drift, directly relevant steering UX. No LICENSE found in tree, use as conceptual inspiration rather than copied code.
- [Bot Kart](https://github.com/fubak/bot-kart): original browser kart racer supporting GitHub Pages, gamepad, remapping and three circuits. Verify license before adapting its code.

The original engine was selected in part because its source license was explicitly inspected and is MIT, whereas not all otherwise useful demos include a code-reuse license.
