import { test, expect } from '@playwright/test';

test('mobile scene boots and exposes performance diagnostics', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', err => jsErrors.push(err.message));
  await page.goto('/?quality=low', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__zarioControlStatus && !!window.__zarioPerformance, null, { timeout: 60000 });
  await expect(page.locator('.zario-controls')).toBeHidden();
  await page.locator('.zario-settings-toggle').click();
  await expect(page.locator('.zario-controls button').first()).toBeVisible();
  const app = await page.evaluate(() => ({
    canvas: !!document.querySelector('#app canvas'),
    input: window.__zarioControlStatus(),
    graphics: window.__zarioPerformance(),
  }));
  expect(app.canvas).toBeTruthy();
  expect(app.graphics.profile).toBeTruthy();
  expect(app.input.control).toBeTruthy();
  expect(jsErrors).toEqual([]);
  await page.screenshot({ path: 'test-results/zario-mobile-start.png' });
});

test('tilt control requests consent from a tap and can calibrate', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'DeviceOrientationEvent', {
      configurable: true,
      value: class DeviceOrientationEvent { static async requestPermission() { return 'granted'; } },
    });
  });
  await page.goto('/?quality=low', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__zarioControlStatus, null, { timeout: 60000 });
  await page.locator('.zario-settings-toggle').click();
  await page.locator('.zario-controls button').first().click();
  await expect(page.locator('.zario-controls button').first()).toContainText('GYRO ON');
  const status = await page.evaluate(() => {
    const emit = gamma => {
      const e = new Event('deviceorientation');
      Object.defineProperties(e, { gamma: { value: gamma }, beta: { value: gamma } });
      window.dispatchEvent(e);
    };
    emit(0); emit(18); emit(22); emit(24);
    return window.__zarioControlStatus();
  });
  expect(status.tiltEnabled).toBe(true);
  expect(status.sensorAgeMs).toBeLessThan(1000);
  await page.locator('.zario-controls button').first().click();
  expect((await page.evaluate(() => window.__zarioControlStatus())).tiltEnabled).toBe(false);
});


test('iPhone-identified mobile browser uses reduced DSP and unlock attempt on Start Race',async({page},info)=>{
  test.skip(info.project.name==='ipad-landscape-webkit','iPhone UA only');
  test.setTimeout(100000);
  await page.setViewportSize({width:844,height:390});
  await page.goto('/?quality=low',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.__zarioAudioStatus&&!!window.__sk3d,null,{timeout:90000});
  const first=await page.evaluate(()=>window.__zarioAudioStatus());
  expect(first.lowPowerMobile).toBe(true);
  await page.locator('.sk3d-start-btn').click();
  const after=await page.evaluate(()=>window.__zarioAudioStatus());
  expect(after.lowPowerMobile).toBe(true);
  expect(['running','suspended','interrupted']).toContain(after.state);
  expect(after.masterVolume).toBeGreaterThan(0);
  await page.waitForFunction(()=>!!window.__sk3d?.playerKart()?.state,null,{timeout:90000});
  await expect(page.locator('.sk3d-hud')).toBeVisible();
});
