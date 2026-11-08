import { copyFileSync, existsSync } from 'node:fs';
if (!existsSync('index.source.html')) throw new Error('Missing index.source.html source template');
copyFileSync('index.source.html', 'index.html');
console.log('[zario] Restored Vite source HTML before build/dev');
