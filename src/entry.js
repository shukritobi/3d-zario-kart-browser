/**
 * Lightweight Vite entry: wireless phone controllers do not need a WebGL
 * renderer, procedural track, kart assets, physics loop or WebAudio engine.
 * This prevents a memory/boot freeze on iPhone and budget Android handsets.
 */
const params = new URLSearchParams(window.location.search);
if (params.get('controller') === '1') {
  await import('./ui/ui.css');
  const { mountControllerApp } = await import('./ui/ControllerApp.js');
  mountControllerApp(document.getElementById('app'));
} else {
  await import('./main.js');
}
