# Zario Kart 2026 course and camera design brief

## Research direction

- [Nintendo's Mario Kart World Direct](https://www.nintendo.com/au/news-and-articles/mario-kart-world-direct-revs-up-new-details-on-the-biggest-mario-kart-ever/) (2025) describes interconnected regions, distinct biomes, new routes, mobility and discoveries. We borrow *variety and readable landmarks*, not copyrighted assets.
- [Nintendo Life track and cup guide](https://www.nintendolife.com/guides/mario-kart-world-tracks-list-of-every-grand-prix-knockout-tour-and-snes-course) (2026) covers interconnected vs dedicated course sections and route progression. Zario Kart uses a simpler 3-lap structure for replayable iPhone sessions.
- [Ars Technica review](https://arstechnica.com/gaming/2025/06/mario-kart-world-review-getting-there-is-half-the-game/) (2025) discusses how straight connection segments can become repetitive, even as scenery and jumps add variety. Avoid 1km flat straightaways.
- [Mario Kart 8 Deluxe](https://mariokart8.nintendo.com/) combines readable third-person camera, predictable road visibility, rhythmic track events and repeated laps. Zario Kart aims for similar handling clarity with original courses and assets.

These sources describe genre patterns, **not** an official numeric ideal length. Our design target is ~35–65 seconds/lap and 2–3 minutes/race for average users. Actual lap time is user-skill- and device-dependent; real-device runs still needed.

## Courses (original layouts)

| Route | Design | Gameplay contrast |
| --- | --- | --- |
| Meadow Circuit | Former compact oval expanded 2.85x horizontally | forgiving high-speed sweepers, hillside jumps and overtaking lanes |
| Neon City | Former dense city circuit expanded 2.18x | illuminated tight switchbacks, straights for shell races, multiple speed gates |
| Sunset Canyon | New radial S-bend closed loop | sunset atmosphere, three broad lobes, golden arch zone gates, elevation changes |
| Cloudtop Garden | New 4/7-frequency radial loop | pastel sky, multiple sweeping transitions, colorful arch gates, rolling elevation |

Four boost-strip clusters per lap, dynamically placed ramps only when curve is gentle, and 12–24 pickup boxes based on track length. Tracks are loaded one at a time to control WebGL geometry. Initial testing uses AI competitors and browser-emulated iPhone/iPad. Further level design iterations may need human driving and telemetry to validate whether each corner is genuinely fun.

## Controls, camera and items

- Main menu is one-screen and non-scrollable. Settings overlay scrolls independently. Racer/track selectors swipe horizontally.
- Mobile portrait screen uses a *virtual* CSS rotation; iOS browsers cannot physically rotate a device or lock the orientation for a normal page. On Android an orientation lock is attempted where supported.
- Third-person camera: 66-degree base FoV, approximately 4.7m chase distance and 2.1m vertical offset, look-ahead ~5.8m. Smaller swing while drifting, subdued FOV kick and faster recentering make the road easier to read.
- Shells/bananas now initialize a track position near the actual location, use swept hit detection to avoid skipping targets at racing speed, and respect the road's height. Red shells use race progress to pick a rival ahead rather than merely screen-space heading; aim turn rate tuned upward.
- The item button fires on release; a short tap is forward and a deliberate 750ms hold is backward. This is to prevent accidental backward throws.

## Performance and validation

CI includes unit tests for four track lengths, smooth tangents and nearest-waypoint recovery; Playwright mobile Chromium, mobile WebKit and iPad landscape for menu layout, controls and item activation. These are automated regression checks, not physical iPhone GPU or battery measurements.
