import './mobileLandscape.css';
export function enterLandscape() {
  // Screen Orientation API lock may work in fullscreen Android. Standard
  // iOS Safari and Chrome do not support forcing physical orientation.
  try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch {}
}
export function setupOrientationPrompt() {
  if (document.querySelector('.zario-orientation-prompt')) return;
  const prompt = document.createElement('div');
  prompt.className='zario-orientation-prompt';
  prompt.setAttribute('aria-label','Rotate phone to landscape to play Zario Kart');
  prompt.innerHTML='<div class="zario-rotate-icon" aria-hidden="true"></div><strong>Rotate your phone</strong><small>Turn your iPhone sideways and disable Portrait Orientation Lock if needed. The game will fill the landscape screen.</small>';
  document.body.appendChild(prompt);
}
export const gameSize = container => ({
  width: Math.max(1,container?.clientWidth || innerWidth),
  height: Math.max(1,container?.clientHeight || innerHeight),
});
