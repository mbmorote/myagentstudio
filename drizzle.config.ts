/**
 * drizzle.config.ts
 *
 * Drizzle-kit config pointing at lib/db/migrations.
 * Used by `npx drizzle-kit generate` and `npx drizzle-kit migrate`.
 */

import type { Config } from 'drizzle-kit';

export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './myagent.db',
  },
} satisfies Config;
