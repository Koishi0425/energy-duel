import { describe, expect, it } from 'vitest';
import { roomEmotes } from '@energy-duel/shared';
import { clampEmoteWheelCenter, emoteWheelSelection, movedBeyondEmoteThreshold } from './emoteWheel';

const ids = roomEmotes.map((emote) => emote.id);

describe('emote wheel', () => {
  it('maps clockwise pointer directions to the visual emote order', () => {
    const center = { x: 100, y: 100 };
    expect(emoteWheelSelection(center, { x: 100, y: 0 }, ids)).toBe(ids[0]);
    expect(emoteWheelSelection(center, { x: 200, y: 100 }, ids)).toBe(ids[2]);
    expect(emoteWheelSelection(center, { x: 100, y: 200 }, ids)).toBe(ids[4]);
    expect(emoteWheelSelection(center, { x: 0, y: 100 }, ids)).toBe(ids[6]);
  });

  it('requires deliberate movement before changing the remembered emote', () => {
    const origin = { x: 50, y: 50 };
    expect(movedBeyondEmoteThreshold(origin, { x: 67, y: 50 })).toBe(false);
    expect(movedBeyondEmoteThreshold(origin, { x: 68, y: 50 })).toBe(true);
    expect(emoteWheelSelection(origin, origin, ids)).toBeUndefined();
  });

  it('keeps the wheel inside the viewport', () => {
    expect(clampEmoteWheelCenter({ x: 10, y: 790 }, 1000, 800)).toEqual({ x: 126, y: 674 });
  });
});
