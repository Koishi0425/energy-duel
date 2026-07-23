import type { SyncedBoardObject } from '@energy-duel/shared';

export interface BoardUnitSlot {
  x: number;
  y: number;
  scale: number;
}

export function boardUnitSlot(keys: readonly string[], key: string): BoardUnitSlot {
  const index = Math.max(0, keys.indexOf(key));
  const columns = Math.ceil(Math.sqrt(keys.length));
  const rows = Math.ceil(keys.length / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const scale = keys.length <= 1 ? 1 : Math.max(0.48, Math.min(0.82, 1.18 / Math.sqrt(keys.length)));
  return {
    x: (column - (columns - 1) / 2) * 50 * scale,
    y: (row - (rows - 1) / 2) * 44 * scale,
    scale,
  };
}

export function lotusSeatBoardStatus(object: SyncedBoardObject, compact: boolean): string {
  const cargo = Object.values(object.cargo ?? {}).reduce(
    (total, carried) => ({ energy: total.energy + carried.energy, charge: total.charge + carried.charge }),
    { energy: 0, charge: 0 },
  );
  const direction = object.movementDirection === -1 ? (compact ? '逆' : '逆时针')
    : object.movementDirection === 1 ? (compact ? '顺' : '顺时针')
      : '停';
  const speed = formatBoardValue(object.moveSpeed ?? 4);
  const energy = formatBoardValue(cargo.energy);
  const charge = formatBoardValue(cargo.charge);
  return compact
    ? `${direction} · 速${speed} · 气${energy} 蓄${charge}`
    : `${direction} · 速度 ${speed} · 气 ${energy} · 蓄力 ${charge}`;
}

function formatBoardValue(value: number): string {
  if (Math.abs(value - 1 / 3) < 0.001) return '1/3';
  if (Math.abs(value - 2 / 3) < 0.001) return '2/3';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
