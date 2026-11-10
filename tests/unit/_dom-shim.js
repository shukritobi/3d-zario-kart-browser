/**
 * Minimal Node.js DOM + 2D Canvas shim for running full Three.js track,
 * environment, and kart mesh unit tests in headless Node (`node --test`).
 */
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    location: { search: '', origin: 'http://localhost:3457', pathname: '/' },
    devicePixelRatio: 1,
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
}

// Prevent Node.js worker_threads BroadcastChannel or undici fetch from holding
// open event-loop handles during fast headless unit tests.
globalThis.BroadcastChannel = class MockBroadcastChannel {
  constructor(name) { this.name = name; this.onmessage = null; }
  postMessage() {}
  close() {}
  unref() {}
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

if (typeof globalThis.document === 'undefined') {
  const make2dContext = () => {
    const grad = { addColorStop() {} };
    return {
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      globalAlpha: 1,
      font: '12px sans-serif',
      textAlign: 'center',
      textBaseline: 'middle',
      lineCap: 'round',
      lineJoin: 'round',
      fillRect() {},
      clearRect() {},
      strokeRect() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      arcTo() {},
      ellipse() {},
      quadraticCurveTo() {},
      bezierCurveTo() {},
      fill() {},
      stroke() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      setTransform() {},
      setLineDash() {},
      fillText() {},
      strokeText() {},
      drawImage() {},
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      getImageData: (_, __, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
    };
  };

  globalThis.document = {
    body: {
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      appendChild() {},
    },
    head: { appendChild() {} },
    createElement(tag) {
      if (tag === 'canvas') {
        return {
          width: 64,
          height: 64,
          style: {},
          getContext: () => make2dContext(),
        };
      }
      return {
        style: {},
        classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
        appendChild() {},
        setAttribute() {},
        addEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => [],
      };
    },
  };
}
