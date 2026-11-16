import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.mjs/,
  outputDir: path.join(here, '../../test-results'),
  workers: 2,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: path.join(here, '../../test-results/visual.json') }]],
  use: { browserName: 'chromium', colorScheme: 'light' },
});
