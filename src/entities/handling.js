/** Simple, testable player handling: keep the AI and Classic handling unchanged. */
export function playerDriftSteerRate(rate, isPlayer, mode = 'tight') {
  return isPlayer && mode !== 'classic' ? rate * 0.76 : rate;
}
export function lateralVelocityStep({
  lateral = 0, dt = 0, steering = 0, drifting = false,
  isPlayer = false, gripMode = 'tight', normalGrip = 8.5,
}) {
  const tight = isPlayer && gripMode !== 'classic';
  // Old drift: 1.5 grip and 5.2 side acceleration took ~0.7s to settle.
  // Tight drift retains a visible slide and boost skill without ice physics.
  const grip = drifting ? (tight ? 3.15 : 1.5) : (tight ? Math.max(normalGrip, 13) : normalGrip);
  const sideAcceleration = tight ? 3.8 : 5.2;
  let next = lateral * Math.exp(-grip * Math.max(0, dt));
  if (drifting && Math.abs(steering) > 0.001) next += steering * sideAcceleration * dt;
  return next;
}
