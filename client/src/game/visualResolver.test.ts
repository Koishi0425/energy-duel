import { describe, expect, it } from 'vitest';
import { FALLBACK_PORTRAIT_URL, resolvePortraitUrl } from './visualResolver';

describe('resolvePortraitUrl', () => {
  it('resolves a form default when no action pose exists', () => {
    expect(resolvePortraitUrl('default_character', 'base', 'wave')).toBe('/assets/default-character.png');
  });

  it('falls back for unknown characters and forms', () => {
    expect(resolvePortraitUrl('missing', 'missing')).toBe(FALLBACK_PORTRAIT_URL);
  });

  it('resolves the Regent portrait asset', () => {
    expect(resolvePortraitUrl('regent', 'base')).toBe('/assets/regent.png');
  });
});
