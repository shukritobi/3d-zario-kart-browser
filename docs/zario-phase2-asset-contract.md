# Zario Kart Phase 2 Asset Contract

This branch adds a **non-runtime** asset registry for six racers and their unique karts. No GLBs are enabled, no gameplay physics are changed, and no unreviewed model is deployed.

## Production state (2026-11-11)

| Racer | Kart | Actual source model | Rig / game-ready |
|---|---|---|---|
| Turbo | Flare Runner | Character GLB (raw Hunyuan, 50k triangles) | Not ready |
| Comet | Starstream GT | Reference images only | Not ready |
| Bolt | Snapback R | Reference images only | Not ready |
| Daisy | Bloom Buggy | Reference images only | Not ready |
| King | Royal Rumbler | Reference images only | Not ready |
| Pip | Pocket Rocket | Reference images only | Not ready |

Source art and local Python/PowerShell scripts are maintained in the user's separate Drive workspace, not committed into game source.

## Why this manifest isn't wired into `ModelLoader.js` yet

The current `MODEL_MANIFEST.karts` maps four chassis classes, and `tryAttachCustomKartModel` appends optional GLBs on top of the old procedural kart. Simply switching URLs would create duplicate bodywork and wheels. The per-racer manifest remains inactive until we implement a replacement mechanism that retains the existing collision and physics hierarchy.

## Blender export contract

- `public/models/zario/characters/<racer>.glb` must include verified rig, skin and named animation clips.
- `public/models/zario/karts/<kart>.glb` must include four independent wheel objects with explicit steering/spinning anchors, a seat and steering anchor.
- Uniform chassis in game units: length 1.70, width 1.05, height 0.55; wheel radius 0.34; wheel width 0.30; nominal wheelbase 1.34. Confirm coordinate axis conversion from Blender Z-up to Three.js Y-up in tests.
- An imported 50k triangle sculpt is not automatically a production rig or mobile model.
- Manual approval gates: original-reference silhouette, UV/material integrity, joint deformation, seat contact, four-wheel synchronization, LODs, mobile GPU performance, and screenshot review.

## Integration workflow

1. Generate / model actual GLB locally.
2. Use Blender 4.5 versioned cleanup / LOD / first-pass bone-heat rig scripts.
3. Fix weight painting, accessory chains, wheels and topology by hand where required.
4. Verify each GLB has correct geometry/skins/actions using a no-dependency validator.
5. Publish an approved GLB into the public asset directory, then implement a **separate opt-in preview** that *replaces* procedural visuals but retains physics.
6. Enable by default only after browser/mobile test coverage succeeds.

**No direct live deployment is part of this PR.**
