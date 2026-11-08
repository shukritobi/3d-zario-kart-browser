# Zario Kart: mobile racing HUD and game-feel audit, 8 November 2026

## User bug report and root causes

1. **Landscape menu compressed.** Multiple older mobile CSS blocks and an oversized title/buttons fought for vertical space and clipped the selected driver row. Main menu now uses controlled sizes and gaps, two explicit equal-width action columns, and separately scrollable Settings.
2. **iPhone gameplay rotated wrong.** A fallback physically rotated the entire HTML \`body\` while WebGL camera/resizing still used portrait viewport dimensions. This produced a sky-only viewport and sideways controls. iOS standard browser tabs cannot force the device physically into landscape. We now use native orientation where supported and a portrait-only, gameplay-only rotation guide on iOS.
3. **Mountains in the road.** Scenery used fixed 146–318m mountain rings, while the old ~390–600m race tracks were stretched to 1.1–1.3km. Mountains were inside the new playable footprint. We derive the track envelope and place ranges beyond the road, rejecting rock bases that intersect the racing corridor.
4. **Invisible wall bounce.** Collision triggered at \`roadWidth/2 +0.45-1.08\`, i.e. ~0.63m **inside** the painted asphalt, with strong forced steering and a severe speed reduction. We have brought the collision threshold to approximately the visible rail and softened bounce response. No decorative mountain is a physical collider; the sensation was largely the hidden guardrail limit and road geometry.
5. **Phantom laps.** Nearest-track progress could wrap across 1→0 within the first few seconds, yielding Lap 2/3. Ordered 25/50/75% checkpoints must now be visited before start-line crossing counts.
6. **Minimap cropped and off centre.** 2.1× zoom applied a mathematically incorrect clamp and cut the route. Now the full track fits the viewBox using 120 spaced samples, with player, AI and hazard markers. On mobile the map is compact and pinned to top right.
7. **Turn arrows wrong.** The old system looked ahead by 3.5% of an entire long lap, which could be 40–50 metres and even a completely different bend. New turn hints compute signed road-tangent angles over physical 5, 28 and 48m offsets, show only meaningful bends, and are suppressed if moving slowly or pointed away from the route.
8. **Sound silent or stalled on iPhone.** iOS WebAudio can start suspended or become interrupted. The old init on first gesture built a complex master DSP chain and a generated 2.2s stereo convolution impulse response before playing audio. We call resume immediately during the trusted user gesture, retry both interrupted and suspended, and replace iPhone master graph with one low-cost limiter plus the player motor only. No guarantee of audibility without physical device testing.
9. **HUD occlusion.** Giant speedometer, two stacked item boxes, 2x zoomed minimap, lap/time, coins, pause, big center-of-screen turn notifications, touchscreen gyro/grip bar. All are now edge-aligned: time/lap top left, minimap/coins top right, rank and inventory left, reduced speedometer right, touch controls lower corners. Gyro/grip/inversion moved into Settings.
10. **Item boxes static on pickup.** Shatter effect is now 12 instanced 3D colored fragments, short glow particle burst and a flying icon travelling from world-space box toward on-screen ITEM button. Unused second powerup slot can collect another box.

## Design and empirical research

- **Bellino and Vilches (2025), "Immersion Versus Interaction Cost: The Player Experience With Game HUD Information on a Smartphone Screen," IEEE Access 13, DOI 10.1109/ACCESS.2025.3619849.** Racing-game prototype found moving information entirely to another screen did not improve immersion and reduced cognitive involvement (p=.03). Conclusion: keep frequent essentials legible on the *same* display while reducing obstructive decoration. https://www.ing.uc.cl/publicaciones/immersion-versus-interaction-cost-the-player-experience-with-game-hud-information-on-a-smartphone-screen/
- **"Effects of Head-Up Display Information Layout Design on Driver Performance: Driving Simulator Studies" (2024).** Consistent grouping and task-aware information layout reduce the distraction of cluttered driving displays. https://www.tandfonline.com/doi/abs/10.1080/10447318.2024.2414487
- **WebKit bug 273511, AudioContext stuck in \`interrupted\`** (2024 onward) and **WebKit bug 276016, audio after losing tab focus**. Check both suspended and interrupted states and invoke resume from a real tap; do not assume automatic recovery when returning to Safari. https://bugs.webkit.org/show_bug.cgi?id=273511 and https://bugs.webkit.org/show_bug.cgi?id=276016
- **WebAudio specification issue 2585:** interrupted is not universally defined in WebAudio; robust client behavior needs WebKit-specific fallback. https://github.com/WebAudio/web-audio-api/issues/2585
- **moq-dev/moq issue 2357 (2026):** real-browser Safari trace shows AudioContext only recovered when \`resume()\` was invoked synchronously inside an actual pointerdown after user activation, not just on page load. https://github.com/moq-dev/moq/issues/2357
- **fecolinhares/super-kart-3djs** (MIT, baseline original engine) and **bridge-mind/turbo-kart-rally** (kart HUD/minimap control systems) were inspected as gameplay references; no Nintendo proprietary assets have been imported. https://github.com/fecolinhares/super-kart-3djs and https://github.com/bridge-mind/turbo-kart-rally

## Validation checklist

- Menu fixed inside iPhone landscape 844×390 and tablet landscape 1194×834, with separated Racer/Track/Settings buttons.
- Settings opens and closes, touch gyro is configured from Settings only.
- Landscape gameplay uses real width/height and WebGL aspect, portrait game shows a readable orientation guide rather than fake rotation.
- Top HUD elements remain separate, minimap smaller than 90 CSS pixels, speedometer smaller than 110 on phone.
- Four courses build, no scenery ranges crossing the racing route; ordered checkpoints prevent fast laps.
- Boxes can fill reserve slot, shatter fragments appear, ammo icon flies on pickup.
- AudioContext is retried on trusted touch and its diagnostics are inspectable from \`window.__zarioAudioStatus()\`.
- GitHub Actions runs WebKit/Chromium emulated devices and unit tests. This cannot validate a physical iPhone's speakers, thermal limits, gyro signals or real GPU frame rate.

## Performance design limits

No new textures or large 3D files. Mountain geometry moved, not duplicated. Pickup burst is 12 instances in one mesh, disposed after 560ms. Sound master chain on iPhone removes convolution reverb and heavy filters. Touch targets remain >=55px while GPU overlays, minimap and dials are kept out of the road-centre visual target zone.
