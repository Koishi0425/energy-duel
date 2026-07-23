import { describe, expect, it } from 'vitest';
import { CircularMap } from './CircularMap';

describe('CircularMap', () => {
  it.each([1, 2, 4, 8, 20])('creates twice as many cells for %i players', (players) => {
    const map = new CircularMap(players);
    expect(map.gridCount).toBe(players * 2);
  });

  it('places index zero at the right and increases clockwise', () => {
    const map = new CircularMap(2);
    map.resize(400, 300);
    expect(map.getGridCoordinates(0)).toEqual({ x: 308, y: 150 });
    expect(map.getGridCoordinates(1).x).toBeCloseTo(200);
    expect(map.getGridCoordinates(1).y).toBeCloseTo(258);
  });

  it('keeps every cell on the same radius', () => {
    const map = new CircularMap(8);
    map.resize(800, 600);
    const distances = Array.from({ length: map.gridCount }, (_, index) => {
      const point = map.getGridCoordinates(index);
      return Math.hypot(point.x - 400, point.y - 300);
    });
    for (const distance of distances) expect(distance).toBeCloseTo(distances[0]);
  });

  it('reserves odd cells between every even player position', () => {
    const map = new CircularMap(4);
    const playerIndices = Array.from({ length: 4 }, (_, index) => index * 2);
    expect(playerIndices).toEqual([0, 2, 4, 6]);
    expect(playerIndices.every((index) => (index + 1) % map.gridCount % 2 === 1)).toBe(true);
  });

  it('updates coordinates after resize and player-count changes', () => {
    const map = new CircularMap(2);
    map.resize(400, 300);
    const before = map.getGridCoordinates(0);
    map.resize(600, 400);
    expect(map.getGridCoordinates(0)).not.toEqual(before);
    map.setPlayerCount(4);
    expect(map.gridCount).toBe(8);
    expect(map.getGridCoordinates(7)).toBeDefined();
  });

  it('rotates display coordinates without changing logical indices', () => {
    const map = new CircularMap(2);
    map.resize(400, 300);
    map.setViewRotation(Math.PI / 2);
    expect(map.rotationRadians).toBeCloseTo(Math.PI / 2);
    expect(map.getGridCoordinates(0).x).toBeCloseTo(200);
    expect(map.getGridCoordinates(0).y).toBeCloseTo(258);
    expect(map.gridCount).toBe(4);
  });

  it('normalizes full turns and keeps rotation through resize', () => {
    const map = new CircularMap(4);
    map.resize(400, 300);
    map.setViewRotation(Math.PI * 2 + Math.PI / 4);
    map.resize(600, 400);
    expect(map.rotationRadians).toBeCloseTo(Math.PI / 4);
    const point = map.getGridCoordinates(0);
    expect(point.x).toBeCloseTo(300 + 144 * Math.SQRT1_2);
    expect(point.y).toBeCloseTo(200 + 144 * Math.SQRT1_2);
  });

  it('numbers cells and only emits clicks for highlighted destinations', () => {
    const map = new CircularMap(2) as any;
    map.resize(400, 300);
    const selected: number[] = [];
    map.setGridSelection([1], undefined, (index: number) => selected.push(index));
    expect(map.cellLabels.map((label: { text: string }) => label.text)).toEqual(['0', '1', '2', '3']);
    map.cells[0].emit('pointertap');
    map.cells[1].emit('pointertap');
    expect(selected).toEqual([1]);
  });

  it('places cell numbers outside the board cells so portraits cannot cover them', () => {
    const map = new CircularMap(4) as any;
    map.resize(600, 400);
    for (let index = 0; index < map.gridCount; index += 1) {
      const cellDistance = Math.hypot(map.cells[index].x, map.cells[index].y);
      const labelDistance = Math.hypot(map.cellLabels[index].x, map.cellLabels[index].y);
      expect(labelDistance).toBeGreaterThan(cellDistance + map.cellRadius);
    }
  });

  it('rejects invalid usage', () => {
    expect(() => new CircularMap(0)).toThrow(RangeError);
    expect(() => new CircularMap(21)).toThrow(RangeError);
    const map = new CircularMap(2);
    expect(() => map.getGridCoordinates(0)).toThrow(/resize/);
    expect(() => map.resize(0, 100)).toThrow(RangeError);
    expect(() => map.setViewRotation(Number.NaN)).toThrow(RangeError);
    map.resize(100, 100);
    expect(() => map.getGridCoordinates(-1)).toThrow(RangeError);
    expect(() => map.getGridCoordinates(4)).toThrow(RangeError);
  });
});
