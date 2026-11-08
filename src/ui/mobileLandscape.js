import './mobileLandscape.css';
export function enterLandscape() {
  // Native lock works in some Android fullscreen browsers, but not iOS.
  // Try nonblocking; the stage has a CSS rotation fallback in portrait.
  try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch {}
}
export const gameSize = container => ({
  width: Math.max(1,container?.clientWidth || innerWidth),
  height: Math.max(1,container?.clientHeight || innerHeight),
});
