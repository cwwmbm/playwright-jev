import 'dotenv/config';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['./reporters/jev-cost.ts']],
  use: { browserName: 'chromium', trace: 'retain-on-failure' },
  projects: [
    { name: 'local', testDir: './tests' },
    { name: 'saucedemo', testDir: './examples' },
  ],
});
