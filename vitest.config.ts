import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'lib/**/__tests__/**/*.test.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // server-only throws when imported outside a Next.js server context.
      // In the Vitest/Node environment, alias it to a no-op so server-only
      // DB/env modules can be imported in tests without blowing up.
      'server-only': fileURLToPath(new URL('./lib/__mocks__/server-only.ts', import.meta.url)),
    },
  },
});
