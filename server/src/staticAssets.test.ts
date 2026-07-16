import { describe, expect, it } from 'vitest';
import { staticCacheControlForPath } from './staticAssets.js';

describe('static asset cache policy', () => {
  it('keeps entry points and manifests revalidatable', () => {
    expect(staticCacheControlForPath('C:\\app\\client\\dist\\index.html')).toBe('no-cache');
    expect(staticCacheControlForPath('/app/client/dist/assets/manifests/assets.json')).toBe('no-cache');
  });

  it('caches content-hashed art and Vite bundles immutably', () => {
    expect(staticCacheControlForPath('/app/client/dist/assets/characters/ao/base/preview.e609494562fa.webp')).toContain('immutable');
    expect(staticCacheControlForPath('/app/client/dist/assets/index-CzuAsGWF.js')).toContain('immutable');
  });

  it('uses a short cache for stable unversioned assets', () => {
    expect(staticCacheControlForPath('/app/client/dist/assets/portrait-default.svg')).toBe('public, max-age=3600');
  });
});
