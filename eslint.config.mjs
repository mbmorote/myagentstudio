import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// FlatCompat bridges eslint-config-next's traditional shareable-config format
// (still how Next publishes it) into ESLint 9's flat-config format, which
// `next lint` expects by default in Next 15.
const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Never lint generated/build output — mirrors .gitignore. These aren't
    // hand-edited source: lib/ai/prompts/generated/* is rewritten by
    // scripts/build-prompts.ts on every predev/prebuild, drizzle/ holds
    // generated migration SQL, and the rest are standard build directories.
    ignores: [
      'lib/ai/prompts/generated/**',
      'drizzle/**',
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
    ],
  },
];

export default eslintConfig;
