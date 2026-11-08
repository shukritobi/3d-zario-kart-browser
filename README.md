# Zario Kart 🏁

Mobile-first 3D kart racing in the browser. Play at https://shukritobi.github.io/3d-zario-kart-browser/ (once GitHub Pages is enabled).

## Controls

- iPhone/Android: hold left/right to steer, DRIFT to charge a boost, ITEM to use an item. Turn on GYRO with a user gesture for motion steering, then tap RECENTER while holding the phone comfortably in landscape.
- Bluetooth gamepad: left stick to steer, right trigger to accelerate, left trigger to brake, A / cross for drift, B / circle for item, Start to pause.
- Keyboard: arrows / WASD to steer and drive, Shift to drift, Space to use an item, Esc to pause.

## Build

```bash
npm install
npm run dev
npm run build
```

## Credits / licensing

This independent browser game is adapted from [Super Kart 3D.js](https://github.com/fecolinhares/super-kart-3djs) by Feco Linhares, used under its MIT license. The original copyright notice is retained in [LICENSE](LICENSE). Original engine, racing assets and code remain credited to the original author. Zario Kart is not affiliated with Nintendo.

Further engineering notes: [research and performance plan](docs/research.md).

## Blank-screen fix and publishing

GitHub Pages was initially publishing raw Vite source through Jekyll. The build workflow now supports branch-based Pages by committing the compiled site files to main, followed by an explicit Pages rebuild request. If Pages is switched to GitHub Actions, the same workflow directly deploys the dist folder instead.

Edit index.source.html (not the compiled index.html). The predev and prebuild scripts restore the original HTML before starting Vite. The boot guard displays readable errors and a safe-graphics option rather than a blank page.
