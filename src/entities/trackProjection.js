/**
 * Road-centerline projection with continuous XZ, height and progress.
 * Replaces coarse nearest-vertex stepping, which made karts bob on hills and
 * produced discontinuous turn cues on long tracks.
 */
export function horizontalDistanceSquared(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return dx * dx + dz * dz;
}
export function projectTrackSegment(a, b, p) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const den = dx * dx + dz * dz;
  const alpha = den > 1e-12
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / den))
    : 0;
  const x = a.x + alpha * dx, z = a.z + alpha * dz;
  const ex = p.x - x, ez = p.z - z;
  return { alpha, x, z, distanceSquared: ex * ex + ez * ez };
}
/**
 * Samples have a per-vertex cumulative length and a full-loop total.
 * Look at BOTH neighboring segments, choosing the closest horizontal point.
 * Height is interpolated, never snapped to a sample.
 */
export function projectTrackLattice(samples, index, point) {
  const n = samples.N;
  if (!n) return null;
  const i = ((index % n) + n) % n;
  let winner = null;
  for (const j of [(i + n - 1) % n, i]) {
    const k = (j + 1) % n;
    const a = samples.pos[j], b = samples.pos[k];
    const q = projectTrackSegment(a, b, point);
    if (winner && q.distanceSquared >= winner.distanceSquared) continue;
    const from = samples.len[j];
    // seam length is total - last vertex distance
    const to = k === 0 ? samples.total : samples.len[k];
    const distance = from + (to - from) * q.alpha;
    let tx = b.x - a.x, tz = b.z - a.z;
    const norm = Math.hypot(tx, tz) || 1;
    tx /= norm; tz /= norm;
    winner = {
      idx: j,
      t: ((j + q.alpha) / n) % 1,
      progress01: (distance / Math.max(.001, samples.total)) % 1,
      groundY: a.y + (b.y - a.y) * q.alpha,
      lateralDist: (point.x - q.x) * tz - (point.z - q.z) * tx,
      distanceSquared: q.distanceSquared,
      tan: { x: tx, y: 0, z: tz },
    };
  }
  return winner;
}
