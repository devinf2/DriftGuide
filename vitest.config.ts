import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Rewrite bundled-asset `require('....png')` calls (e.g. flyImages.ts) into plain string
 * literals during transform, so node-environment tests can import modules that reference
 * Metro-bundled images without a Metro bundler or the assets existing on disk.
 */
function stubAssetRequires(): Plugin {
  const ASSET_REQUIRE = /require\(\s*(['"])([^'"]+\.(?:png|jpe?g|gif|webp|svg))\1\s*\)/g;
  return {
    name: 'stub-asset-requires',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.[cm]?[jt]sx?$/.test(id) || !ASSET_REQUIRE.test(code)) return null;
      ASSET_REQUIRE.lastIndex = 0;
      const out = code.replace(ASSET_REQUIRE, (_m, _q, asset) => JSON.stringify(asset));
      return { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [stubAssetRequires()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
