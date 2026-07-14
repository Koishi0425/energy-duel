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
    expect(map.getGridCoordinates(0)).toEqual({ x: 302, y: 150 });
    expect(map.getGridCoordinates(1).x).toBeCloseTo(200);
    expect(map.getGridCoordinates(1).y).toBeCloseTo(252);
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
    expect(map.getGridCoordinates(0).y).toBeCloseTo(252);
    expect(map.gridCount).toBe(4);
  });

  it('normalizes full turns and keeps rotation through resize', () => {
    const map = new CircularMap(4);
    map.resize(400, 300);
    map.setViewRotation(Math.PI * 2 + Math.PI / 4);
    map.resize(600, 400);
    expect(map.rotationRadians).toBeCloseTo(Math.PI / 4);
    const point = map.getGridCoordinates(0);
    expect(point.x).toBeCloseTo(300 + 136 * Math.SQRT1_2);
    expect(point.y).toBeCloseTo(200 + 136 * Math.SQRT1_2);
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
