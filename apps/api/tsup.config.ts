import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'scripts/seed.ts', 'scripts/migrate.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // workspace package is TypeScript source: bundle it; real deps stay in node_modules
  noExternal: ['@bw/shared'],
});
