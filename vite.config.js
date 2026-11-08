import { defineConfig } from 'vite';

export default defineConfig({
  // base relativa: funciona em qualquer subpath (GitHub Pages project site
  // fica em /super-kart-3djs/, não na raiz). './' = assets relativos ao index.html.
  base: './',
  server: {
    host: '0.0.0.0',
    port: 3457,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // outDir padrão 'dist' — universal. Pode ser sobrescrito por env var
    // (ex: SK3D_OUT_DIR=/some/out/dir npm run build) para filesystems que
    // bloqueiam copyfile (copyfile-restricted filesystems/9p).
    outDir: process.env.SK3D_OUT_DIR || 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/examples/')) return 'three-examples';
          if (id.includes('/node_modules/three/src/renderers/')) return 'three-renderer';
          if (id.includes('/node_modules/three/')) return 'three-core';
          return undefined;
        },
      },
    },
  },
});
