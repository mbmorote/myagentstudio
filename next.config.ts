import type { NextConfig } from 'next';
import packageJson from './package.json';

/**
 * next.config.ts
 *
 * webpack extensionAlias: TypeScript ESM convention uses `.js` extensions in import
 * specifiers (e.g. `import ... from './client.js'`), but webpack resolves imports
 * literally unless told to check `.ts`/`.tsx` first. This alias makes webpack resolve
 * `.js` imports to their `.ts`/`.tsx` counterparts, matching tsconfig moduleResolution.
 */
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack: (config: any) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
