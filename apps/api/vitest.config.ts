import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    // One database, many files: run files one at a time so a race test never
    // shares the pool with an unrelated test. Tests inside a file still race.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
