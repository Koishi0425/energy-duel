import { describe, expect, it } from 'vitest';
import { actionById, gameConfig } from '@energy-duel/shared';
import { characterGuides, formatGuideTarget, getCharacterActionIds, glossaryEntries, guidePages, ruleSections } from './gameGuide';

describe('game guide content', () => {
  it('covers every configured character exactly once', () => {
    const configuredIds = gameConfig.characters.map((character) => character.id).sort();
    const guideIds = characterGuides.map((guide) => guide.characterId).sort();
    expect(guideIds).toEqual(configuredIds);
    expect(new Set(guideIds).size).toBe(guideIds.length);
  });

  it('only references configured actions and exposes each character skill tree', () => {
    for (const guide of characterGuides) {
      expect(guide.featuredActionIds.length).toBeGreaterThan(0);
      expect(new Set(guide.featuredActionIds).size).toBe(guide.featuredActionIds.length);
      for (const actionId of guide.featuredActionIds) expect(actionById.has(actionId)).toBe(true);

      const visibleActionIds = new Set(getCharacterActionIds(guide.characterId));
      const character = gameConfig.characters.find((candidate) => candidate.id === guide.characterId);
      for (const actionId of character?.forms.flatMap((form) => form.unlockedActions) ?? []) {
        if (!['wave', 'hangup'].includes(actionId)) expect(visibleActionIds.has(actionId)).toBe(true);
      }
    }
  });

  it('keeps navigation and reference ids stable and unique', () => {
    for (const collection of [guidePages, ruleSections, glossaryEntries]) {
      const ids = collection.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every(Boolean)).toBe(true);
    }
  });

  it('renders current target descriptions without ambiguous enemy wording', () => {
    expect(formatGuideTarget(actionById.get('slash')!)).toBe('1 名其他存活玩家 · 预选');
    expect(formatGuideTarget(actionById.get('sword_aura')!)).toBe('1 名其他存活玩家 · 后发');
    expect(formatGuideTarget(actionById.get('quick_attack')!)).toBe('1 个地块 · 预选');
    expect(gameConfig.actions.map(formatGuideTarget).join('')).not.toContain('敌人');
  });
});
