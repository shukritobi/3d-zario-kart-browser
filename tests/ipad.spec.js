import { test, expect } from '@playwright/test';

test('iPad landscape renders gyro and grip controls with usable thumb targets', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad-landscape-webkit', 'Only run iPad layout assertions in iPad project');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?quality=low', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => !!window.__zarioControlStatus && !!window.__zarioPerformance, null, {timeout:70000});
  const metrics = await page.evaluate(() => ({
    width:innerWidth,
    height:innerHeight,
    touchWidth:parseFloat(getComputedStyle(document.querySelector('.sk3d-touch-left')).width),
    grip:window.__zarioControlStatus().handling,
    graphics:window.__zarioPerformance(),
    media:matchMedia('(pointer: coarse)').matches
  }));
  expect(metrics.width).toBeGreaterThan(metrics.height);
  expect(metrics.media).toBe(true);
  expect(metrics.touchWidth).toBeGreaterThanOrEqual(80);
  expect(metrics.grip).toBe('tight');
  expect(metrics.graphics.profile).toBeTruthy();
  await expect(page.getByRole('button',{name:'Switch between tight arcade handling and classic loose drift'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reverse steering for touch, gyro and gamepad'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('iPad steering flip and grip setting persist across reloads', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad-landscape-webkit', 'iPad settings');
  await page.goto('/?quality=low');
  await page.waitForFunction(() => !!window.__zarioControlStatus, null, {timeout:70000});
  const flip = page.getByRole('button',{name:'Reverse steering for touch, gyro and gamepad'});
  const grip = page.getByRole('button',{name:'Switch between tight arcade handling and classic loose drift'});
  await flip.click();
  await grip.click();
  expect((await page.evaluate(() => window.__zarioControlStatus())).inverted).toBe(true);
  expect((await page.evaluate(() => window.__zarioControlStatus())).handling).toBe('classic');
  await page.reload();
  await page.waitForFunction(() => !!window.__zarioControlStatus, null, {timeout:70000});
  const prefs = await page.evaluate(() => window.__zarioControlStatus());
  expect(prefs.inverted).toBe(true);
  expect(prefs.handling).toBe('classic');
  // Reset settings so later tests using the same context aren't contaminated.
  await flip.click();
  await grip.click();
});

test('iPad gyro permission and axis fallback are interactive', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad-landscape-webkit', 'iPad gyro');
  await page.addInitScript(() => Object.defineProperty(window, 'DeviceOrientationEvent', {
    configurable: true,
    value: class DeviceOrientationEvent { static async requestPermission() { return 'granted'; } }
  }));
  await page.goto('/?quality=low');
  await page.waitForFunction(() => !!window.__zarioControlStatus, null, {timeout:70000});
  await page.getByRole('button',{name:'Enable tilt steering (requires motion permission)'}).click();
  let status=await page.evaluate(() => window.__zarioControlStatus());
  expect(status.tiltEnabled).toBe(true);
  await page.getByRole('button',{name:'Choose motion sensor axis for unusual tablet orientations'}).click();
  status=await page.evaluate(() => window.__zarioControlStatus());
  expect(status.axis).toBe('beta');
  await page.evaluate(() => {
    for(const beta of [0,17,22]) {
      const ev=new Event('deviceorientation');
      Object.defineProperties(ev,{beta:{value:beta},gamma:{value:0}});
      window.dispatchEvent(ev);
    }
  });
  status=await page.evaluate(() => window.__zarioControlStatus());
  expect(status.sensorAgeMs).toBeLessThan(1000);
  expect(Math.abs(status.tiltSteer)).toBeGreaterThan(0.05);
  await page.getByRole('button',{name:'Calibrate your comfortable steering position'}).click();
  status=await page.evaluate(() => window.__zarioControlStatus());
  expect(status.tiltSteer).toBe(0);
});
