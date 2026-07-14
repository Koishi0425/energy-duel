import { describe, expect, it } from 'vitest';
import { FALLBACK_PORTRAIT_URL, resolvePortraitUrl } from './visualResolver';

describe('resolvePortraitUrl', () => {
  it('resolves a form default when no action pose exists', () => {
    expect(resolvePortraitUrl('default_character', 'base', 'wave')).toBe('/assets/portrait-default.svg');
  });

  it('falls back for unknown characters and forms', () => {
    expect(resolvePortraitUrl('missing', 'missing')).toBe(FALLBACK_PORTRAIT_URL);
  });
});
