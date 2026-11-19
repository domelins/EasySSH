import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Store/router unit tests only — no SvelteKit plugin, no Tauri runtime. The
// $lib alias mirrors svelte.config.js so tests resolve it the same way.

// Node >= 25 exposes a native `localStorage` that shadows jsdom's (and is a
// pathless stub without --localstorage-file), breaking every jsdom test. Turn
// the web storage off in the workers where the flag exists.
const workerArgv = process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')
  ? ['--no-experimental-webstorage']
  : [];

export default defineConfig({
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    poolOptions: {
      forks: { execArgv: workerArgv },
      threads: { execArgv: workerArgv }
    }
  }
});
