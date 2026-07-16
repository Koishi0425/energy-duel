import { describe, expect, it } from 'vitest';
import { FALLBACK_PORTRAIT_URL, resolvePortraitPreviewUrl, resolvePortraitUrl } from './visualResolver';

describe('resolvePortraitUrl', () => {
  it('resolves a form default when no action pose exists', () => {
    expect(resolvePortraitUrl('default_character', 'base', 'wave')).toMatch(/\/assets\/characters\/default_character\/base\/portrait\.[a-f0-9]{12}\.webp$/);
  });

  it('falls back for unknown characters and forms', () => {
    expect(resolvePortraitUrl('missing', 'missing')).toBe(FALLBACK_PORTRAIT_URL);
  });

  it('resolves the Regent portrait asset', () => {
    expect(resolvePortraitUrl('regent', 'base')).toMatch(/\/assets\/characters\/regent\/base\/portrait\.[a-f0-9]{12}\.webp$/);
    expect(resolvePortraitPreviewUrl('regent', 'base')).toMatch(/\/assets\/characters\/regent\/base\/preview\.[a-f0-9]{12}\.webp$/);
  });
});
