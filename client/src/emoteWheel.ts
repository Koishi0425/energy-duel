import type { RoomEmoteId } from '@energy-duel/shared';

export interface EmoteWheelPoint { x: number; y: number }

export const EMOTE_WHEEL_MOVE_THRESHOLD = 18;

export function emoteWheelSelection(
  center: EmoteWheelPoint,
  pointer: EmoteWheelPoint,
  emoteIds: readonly RoomEmoteId[],
): RoomEmoteId | undefined {
  if (emoteIds.length === 0) return undefined;
  const deltaX = pointer.x - center.x;
  const deltaY = pointer.y - center.y;
  if (Math.hypot(deltaX, deltaY) < EMOTE_WHEEL_MOVE_THRESHOLD) return undefined;
  const angleFromTop = Math.atan2(deltaY, deltaX) + Math.PI / 2;
  const normalized = ((angleFromTop % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return emoteIds[Math.round(normalized / (Math.PI * 2 / emoteIds.length)) % emoteIds.length];
}

export function movedBeyondEmoteThreshold(origin: EmoteWheelPoint, pointer: EmoteWheelPoint): boolean {
  return Math.hypot(pointer.x - origin.x, pointer.y - origin.y) >= EMOTE_WHEEL_MOVE_THRESHOLD;
}

export function clampEmoteWheelCenter(point: EmoteWheelPoint, viewportWidth: number, viewportHeight: number): EmoteWheelPoint {
  const edge = 126;
  return {
    x: Math.max(edge, Math.min(viewportWidth - edge, point.x)),
    y: Math.max(edge, Math.min(viewportHeight - edge, point.y)),
  };
}
