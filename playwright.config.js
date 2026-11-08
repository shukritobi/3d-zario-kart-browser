import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  timeout: 90000,
  expect: { timeout: 30000 },
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:3457', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'ipad-landscape-webkit', use: {
      ...devices['iPad Pro 11'], browserName: 'webkit',
      viewport: { width: 1194, height: 834 }, isMobile: true, hasTouch: true,
    } },
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1', port: 3457, reuseExistingServer: !process.env.CI, timeout: 120000 },
  reporter: [['list']],
});
