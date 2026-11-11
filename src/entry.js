/**
 * Minimal controller-mode entry. Phones load the wireless pad without first
 * allocating the WebGL track, scene, shaders and music engine.
 */
async function boot() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('controller') === '1') {
    await import('./ui/ui.css');
    const { mountControllerApp } = await import('./ui/ControllerApp.js');
    mountControllerApp(document.getElementById('app'));
  } else {
    await import('./main.js');
  }
}
void boot();
