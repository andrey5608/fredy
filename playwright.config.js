// Basic Playwright configuration for Fredy UI
// To run: npx playwright test
import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:9998';

export default defineConfig({
  testDir: './test/playwright',
  timeout: 120 * 1000,
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list']],
});
