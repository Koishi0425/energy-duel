import { assetById, characterById } from '@energy-duel/shared';

export const FALLBACK_PORTRAIT_URL = '/assets/portrait-default.svg';

export function resolvePortraitUrl(characterId: string, formId: string, poseId = 'idle'): string {
  return resolvePortraitAsset(characterId, formId, poseId, false);
}

export function resolvePortraitPreviewUrl(characterId: string, formId: string, poseId = 'idle'): string {
  return resolvePortraitAsset(characterId, formId, poseId, true);
}

function resolvePortraitAsset(characterId: string, formId: string, poseId: string, preview: boolean): string {
  const character = characterById.get(characterId);
  const form = character?.forms.find((candidate) => candidate.id === formId);
  const assetId = form?.poses[poseId] ?? form?.defaultAssetId ?? character?.defaultAssetId;
  const asset = assetId ? assetById.get(assetId) : undefined;
  return (preview ? asset?.previewUrl ?? asset?.url : asset?.url) ?? FALLBACK_PORTRAIT_URL;
}
