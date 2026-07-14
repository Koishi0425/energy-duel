import { assetById, characterById } from '@energy-duel/shared';

export const FALLBACK_PORTRAIT_URL = '/assets/portrait-default.svg';

export function resolvePortraitUrl(characterId: string, formId: string, poseId = 'idle'): string {
  const character = characterById.get(characterId);
  const form = character?.forms.find((candidate) => candidate.id === formId);
  const assetId = form?.poses[poseId] ?? form?.defaultAssetId ?? character?.defaultAssetId;
  return (assetId ? assetById.get(assetId)?.url : undefined) ?? FALLBACK_PORTRAIT_URL;
}
