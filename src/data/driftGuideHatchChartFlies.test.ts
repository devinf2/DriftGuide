import Module from 'node:module';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DRIFTGUIDE_HATCH_CHART_ENTRIES, hatchFliesByStage } from '@/src/data/driftGuideHatchChart';

// flyImages.ts uses require('@/assets/...png|jpg') (Metro asset semantics). Under the Vitest node
// environment there is no asset transform, so we teach Node's require to (1) map the '@/' alias to
// the repo root and (2) return the filename for image extensions, mirroring what Metro yields.
const repoRoot = path.resolve(__dirname, '..', '..');
const mod = Module as unknown as {
  _extensions: Record<string, (m: NodeJS.Module, filename: string) => void>;
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
};
for (const e of ['.png', '.jpg', '.jpeg', '.gif', '.webp']) {
  mod._extensions[e] = (m, filename) => {
    m.exports = filename;
  };
}
const originalResolve = mod._resolveFilename;
mod._resolveFilename = function (request: string, ...rest: unknown[]) {
  const mapped = request.startsWith('@/') ? path.join(repoRoot, request.slice(2)) : request;
  return originalResolve.call(this, mapped, ...rest);
};

// Imported after the loaders/resolver are registered so its require('*.png') calls resolve.
let getBundledFlyImageSource: (name: string | null | undefined) => unknown;
beforeAll(async () => {
  ({ getBundledFlyImageSource } = await import('@/src/constants/flyImages'));
});

/**
 * Guards the curated hatch -> fly mapping against typos: every pattern name must resolve to a
 * bundled image so the "Matching flies" strip always renders an asset (offline-only).
 */
describe('hatch chart matching flies', () => {
  const allFlies = DRIFTGUIDE_HATCH_CHART_ENTRIES.flatMap((e) =>
    e.flies.map((f) => ({ hatch: e.id, ...f })),
  );

  it('has at least one matching fly per hatch entry', () => {
    for (const entry of DRIFTGUIDE_HATCH_CHART_ENTRIES) {
      expect(entry.flies.length, `${entry.id} has no flies`).toBeGreaterThan(0);
    }
  });

  it.each(allFlies)('resolves a bundled image for $hatch -> $name', ({ name }) => {
    expect(getBundledFlyImageSource(name), `${name} has no bundled image`).not.toBeNull();
  });

  it('groups flies by stage in display order with no empty groups', () => {
    for (const entry of DRIFTGUIDE_HATCH_CHART_ENTRIES) {
      const groups = hatchFliesByStage(entry);
      const total = groups.reduce((n, g) => n + g.flies.length, 0);
      expect(total).toBe(entry.flies.length);
      for (const g of groups) {
        expect(g.flies.length).toBeGreaterThan(0);
      }
    }
  });
});
