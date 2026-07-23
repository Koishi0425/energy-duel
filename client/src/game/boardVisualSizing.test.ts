import { describe, expect, it } from 'vitest';
import { boardPortraitBaseHeight, boardPortraitSize } from './boardVisualSizing';

describe('board visual sizing', () => {
  it('keeps a landscape summon landscape without exceeding its box', () => {
    const size = boardPortraitSize(1200, 500, 4, 'summon');
    expect(size.width).toBeGreaterThan(size.height);
    expect(size.width).toBeLessThanOrEqual(size.baseHeight * 1.3);
    expect(size.height).toBeLessThanOrEqual(size.baseHeight);
  });

  it('keeps a portrait character portrait without exceeding its box', () => {
    const size = boardPortraitSize(600, 1000, 4, 'player');
    expect(size.height).toBeGreaterThan(size.width);
    expect(size.width).toBeLessThanOrEqual(size.baseHeight * 0.9);
    expect(size.height).toBeLessThanOrEqual(size.baseHeight);
  });

  it('uses larger units when fewer players share the board', () => {
    expect(boardPortraitBaseHeight(8)).toBeGreaterThan(boardPortraitBaseHeight(9));
    expect(boardPortraitBaseHeight(9)).toBeGreaterThan(boardPortraitBaseHeight(13));
  });
});
