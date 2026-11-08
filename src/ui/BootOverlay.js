/**
 * First-paint boot surface. It gives slow WebGL builds a deliberate state and
 * leaves a readable failure surface if module initialization throws.
 */
export function createBootOverlay() {
  let root = document.getElementById('sk3d-boot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'sk3d-boot';
    root.innerHTML = '<div class="sk3d-boot-card"><h1 class="sk3d-logo"><span class="sk3d-logo-line">ZARIO KART</span><span class="sk3d-logo-sub">3D.js</span></h1><div class="sk3d-logo-strip" aria-hidden="true"></div><div class="sk3d-boot-bar"><i></i></div><div class="sk3d-boot-step" aria-live="polite">starting renderer</div></div>';
    const style = document.createElement('style');
    style.textContent = `
      #sk3d-boot{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:radial-gradient(120% 90% at 50% 8%,#4cc9f0 0%,#a8e6ff 46%,#4cc9f0 100%);color:#1b2a41;transition:opacity .45s ease;font-family:system-ui,-apple-system,sans-serif;pointer-events:auto}
      #sk3d-boot.done{opacity:0;pointer-events:none}
      .sk3d-boot-card{display:flex;flex-direction:column;align-items:center;gap:12px;width:min(82vw,420px)}
      .sk3d-logo{font-family:'Baloo 2',system-ui,-apple-system,sans-serif;font-weight:800;line-height:.92;margin:0;text-align:center}
      .sk3d-logo-line{display:block;font-size:clamp(2.6rem,8vw,4.1rem);letter-spacing:.02em;color:#fff;text-shadow:2px 0 0 #1b2a41,-2px 0 0 #1b2a41,0 2px 0 #1b2a41,0 -2px 0 #1b2a41,3px 3px 0 #1b2a41,-3px 3px 0 #1b2a41,3px -3px 0 #1b2a41,-3px -3px 0 #1b2a41,0 6px 0 rgba(27,42,65,.9),0 12px 20px rgba(0,0,0,.35)}
      .sk3d-logo-sub{display:inline-block;font-size:clamp(2.2rem,7vw,3.4rem);color:#ffd166;transform:rotate(-3deg);text-shadow:2px 0 0 #1b2a41,-2px 0 0 #1b2a41,0 2px 0 #1b2a41,0 -2px 0 #1b2a41,3px 3px 0 #1b2a41,0 6px 0 #ff5a5f,0 10px 16px rgba(0,0,0,.3)}
      .sk3d-logo-strip{width:210px;height:15px;margin-top:-6px;border:3px solid #1b2a41;border-radius:9px;background:repeating-conic-gradient(#fff 0% 25%,#1b2a41 0% 50%) 0 0/16px 16px}
      .sk3d-boot-bar{height:5px;width:100%;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.3)}
      .sk3d-boot-bar i{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#4cc9f0,#ffd166);box-shadow:0 0 14px #4cc9f0aa;transition:width .25s ease}
      .sk3d-boot-step{min-height:1.2em;color:rgba(27,42,65,.67);font-size:12px;letter-spacing:.22em;text-transform:uppercase;text-align:center}
      @media(prefers-reduced-motion:reduce){#sk3d-boot,.sk3d-boot-bar i{transition:none}}
    `;
    document.head.appendChild(style);
    document.body.appendChild(root);
  }
  const bar = root.querySelector('.sk3d-boot-bar i');
  const step = root.querySelector('.sk3d-boot-step');
  window.addEventListener('error', (event) => {
    if (!root.classList.contains('done')) {
      if (step) step.textContent = 'boot error — reload to retry';
      console.error('[boot]', event.error || event.message);
    }
  }, { once: false });
  return {
    setStage(label, progress) {
      if (step) step.textContent = label;
      if (bar) bar.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    },
    complete() {
      if (window.__boothold) return; // visual QA: freeze overlay, caller releases
      if (bar) bar.style.width = '100%';
      if (step) step.textContent = 'ready';
      // Double rAF garante que o estado inicial (overlay visível) foi pintado
      // antes de iniciar a transição de opacity — evita fade instantâneo.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          root.classList.add('done');
          setTimeout(() => root.remove(), 500);
        });
      });
    },
    release() { window.__boothold = null; root.remove(); },
    fail(message) {
      if (step) step.textContent = message || 'graphics unavailable — reload to retry';
      root.classList.remove('done');
    },
  };
}
