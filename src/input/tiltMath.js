/**
 * Screen-relative tilt steering. Browser event beta/gamma are in the device's
 * canonical coordinate frame, not the rotated CSS viewport.
 *
 * On most iOS devices: 0: gamma, 90: beta, 180: -gamma, 270: -beta.
 * Do not multiply by another sign in the caller; the FLIP toggle is applied
 * once to the FINAL chosen input (touch/gyro/gamepad).
 */
export const normalizeAngle = degrees => ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
export function screenTilt(event, degrees, axis = 'auto') {
  const beta = Number(event?.beta);
  const gamma = Number(event?.gamma);
  const b = event?.beta == null || !Number.isFinite(beta) ? null : beta;
  const g = event?.gamma == null || !Number.isFinite(gamma) ? null : gamma;
  if (axis === 'beta') return b;
  if (axis === 'gamma') return g;
  switch (normalizeAngle(degrees)) {
    case 90: return b;
    case 180: return g == null ? null : -g;
    case 270: return b == null ? null : -b;
    default: return g;
  }
}
export function tiltToSteer(raw, neutral, {deadZone = 2.5, fullSteer = 29} = {}) {
  if (raw == null || neutral == null) return 0;
  const degrees = ((raw - neutral + 540) % 360) - 180;
  const strength = Math.max(0, Math.abs(degrees) - deadZone) / fullSteer;
  return Math.max(-1, Math.min(1, Math.sign(degrees) * strength));
}
