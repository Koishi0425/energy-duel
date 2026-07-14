export function circularDistance(a: number, b: number, gridCount: number): number {
  if (!Number.isInteger(gridCount) || gridCount <= 0) throw new RangeError('gridCount must be a positive integer.');
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= gridCount || b >= gridCount) {
    throw new RangeError(`Grid indices must be integers between 0 and ${gridCount - 1}.`);
  }
  const direct = Math.abs(a - b);
  return Math.min(direct, gridCount - direct);
}
