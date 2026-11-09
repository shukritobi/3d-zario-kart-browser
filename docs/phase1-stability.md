# Phase 1: Stability, input, iPhone audio and real-device performance

## Implemented

- **Continuous road projection:** The 384-sample nearest-waypoint search now interpolates road height, lateral distance, progress and heading across adjacent segments in XZ. It also fixes the accidental extra-zero in the cumulative-length lookup and includes the closed-loop seam length.
- **Road-edge physics:** Collision limits now follow each segment's actual half-width, preventing a narrow-width invisible wall on wider stretches. Heading integration uses the newly steered direction. The post-movement collision reference is a continuous curve point to reduce sampling bounce.
- **Flight recorder:** In-race events record wall hits, physical contacts, Lakitu rescues, progress, position jumps, lap splits and finish. Snapshot samples are bounded (2,400 samples at 5Hz, 600 events). No telemetry is uploaded anywhere. Export a JSON file from Menu → Settings → Export Race Diagnostics.
- **iPhone graphics:** Adaptive device pixel ratio changes by at most 0.15 after sustained sub-40fps performance, and gradually recovers after sustained fast frames. Disabled for explicit quality settings, headless tests and software rasterizers.
- **Audio:** iOS page restore retries AudioContext.resume; the Settings TEST SOUND button reflects the settled result. Continuous crowd processing is disabled on iPhone. Only the player's and two nearest rivals' engine graphs run concurrently on iPhone; the selection refreshes every 2.5s.
- **Automated QA:** New unit tests for continuous road projection, frame-governor thresholds and bounded race logs. WebKit tests check race capture and accelerated race progression.

## iPhone/iPad physical QA checklist

Use two different-sized iPhones and at least one iPad, ideally Safari **and** Chrome on iOS. These use WebKit, but their browser chrome/viewport areas differ. Real gyro sensors, GPU pacing, thermal behavior and speaker output cannot be certified by emulation.

1. Enter landscape, tap Start Race, complete an entire three-lap race on each track without unexpected rescue or collision on the road.
2. Repeat with GRIP: TIGHT and CLASSIC, tilt and touch, plus a Bluetooth controller. Verify steering release immediately settles.
3. Test TEST SOUND in Settings; confirm music, engine and collision audio after first tap, after Control Center, after phone lock and unlock, after browser tab switching and after taking a phone call.
4. Measure 1% low/typical FPS via the diagnostic log and watch for progressive slowdown over 10–15 minutes.
5. Check low-battery mode and hot device. Confirm adaptive DPR behaves gradually and never increases above the initial device cap.
6. Export JSON immediately after any visible jitter. Look for \`position-jump\`, \`wall\`, \`rescue\` and \`slowFrame\` counts. Share the JSON if a crash remains.

## Diagnostic JSON format

\`window.__zarioDiagnostics.status()\` returns \`{schema,metadata,seconds,counts,samples,events}\`; \`exportJSON()\` returns the same as text. Exported files are downloaded locally using a Blob and the browser's download behavior. The game doesn't contact a server.

Example useful fields per sample: \`x,y,z\`, \`speed\`, \`lateral\`, \`steer\`, \`lap\`, \`progress\`, \`offRoad\`, \`drifting\`, \`frameMs\`, \`audio\`, \`dpr\` and WebGL draw calls.

**Status:** GitHub Actions verifies software-rendered browser behavior, not actual-device 60fps or sensor/audio permission outcomes. A successful automated run must be followed by the physical checklist.
