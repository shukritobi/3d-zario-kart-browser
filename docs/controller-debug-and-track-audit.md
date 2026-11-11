# Zario Kart: controller diagnostics, model export and full-track QA

## Controller pairing without re-scanning
The host stores its P1 and P2 room IDs in localStorage. When you change tracks, the game still reloads to replace the 3D world, but the room codes remain unchanged. Leave the controller tab open; its WebRTC peer will reconnect after the host restarts. If the phone stays disconnected, click PAIR with the room code once, then export both logs.

## Phone gyro debug
1. Scan the P1 or P2 QR code using Safari on iPhone or Chrome on Android.
2. Press GYRO on the controller. On iPhone, allow Motion & Orientation access when asked. Tilt the phone left and right and try RECENTER.
3. Tap **DEBUG** and **DOWNLOAD JSON LOG**. Send that JSON together with the host report. The file captures permission responses, raw orientation-event counts, sensor age, motion state, screen angle, received room code, and connection attempts.
4. On the TV/PC host, open SETTINGS and select **EXPORT CONTROLLER / GYRO DEBUG**. Send that JSON as well.
5. The phone reports `GYRO NO SENSOR` when motion permission succeeds but no usable sensor event arrives, rather than silently pretending the steering is functioning. In this case use D-pad/analog, check browser settings, and retry gyro from the button.

Phone sensors cannot be simulated accurately in CI. Test on each physical phone, especially iOS Safari where Motion & Orientation access requires user permission and a gesture.

## Immersive phone controller
The phone controller has a **FULLSCREEN** button. On supported Android browsers it requests true browser fullscreen. iPhone Safari lacks arbitrary-element fullscreen support: tap Share → Add to Home Screen, then open the installed Zario Kart icon for app-style display. Browsers cannot suppress system notifications; enable Do Not Disturb or Focus on the phone for uninterrupted play.

## Six-track automated audit
Go to GitHub → Actions → **Full six-track Zario Kart audit** → **Run workflow**. It also runs each Sunday at 02:00 Malaysia time. After the workflow completes, download the `zario-all-six-tracks-logs-and-screenshots` artifact ZIP (retained 30 days). It contains:
- `SUMMARY.md` and `COPY-PASTE-SUMMARY.txt`, aggregating all track status and wall/ramp/trick counters
- `track-01` through `track-06` folders with **complete-log.json**, start/lap/finish screenshots, JS console errors, connection status and retained physics samples/events
- separate portrait and landscape mobile racer/track menu screenshots

This is a deterministic AI-driven **synthetic browser simulation** under low graphics settings. It checks track completion, geometry, event logs and screenshots but does not replace real-device gameplay and graphics validation.

For local runs:
```sh
npm install
npm install --no-save @playwright/test
npx playwright install chromium
npm run audit:tracks
```
Results are written under `artifacts/track-audit/`. Increase maximum physics steps for unusually long tracks using `ZARIO_AUDIT_MAX_FRAMES=12000`.

## Export editable racers
On the racer selection screen, choose a character and click **3D GLB**. It exports the procedural racer, chassis, driver and wheels as a glTF Binary (`.glb`) model. Open in Blender via File → Import → glTF 2.0; adjust materials, geometry, UVs or add higher-detail accessories. This exports an editable model but does **not** automatically reimport your edited GLB into the game. The next asset-pipeline milestone is to accept named optimized GLB assets with texture compression, scale calibration and level-of-detail fallback.

Keep geometry reasonably sized and polygon counts modest for 2021 Samsung Tizen and iPhone/Android GPU performance. Review detail at chase-camera distance first.
