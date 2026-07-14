import { Container, Graphics } from 'pixi.js';

export interface GridCoordinates {
  x: number;
  y: number;
}

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 20;

export class CircularMap extends Container {
  private playerCount: number;
  private cells: Graphics[] = [];
  private coordinates: GridCoordinates[] = [];
  private viewportWidth = 0;
  private viewportHeight = 0;
  private hasLayout = false;
  private viewRotation = 0;

  constructor(playerCount: number) {
    super();
    this.playerCount = validatePlayerCount(playerCount);
    this.rebuildCells();
  }

  get gridCount(): number {
    return this.playerCount * 2;
  }

  get rotationRadians(): number {
    return this.viewRotation;
  }

  setViewRotation(radians: number): void {
    if (!Number.isFinite(radians)) throw new RangeError('CircularMap rotation must be a finite number.');
    this.viewRotation = normalizeAngle(radians);
    if (this.hasLayout) this.layoutCells();
  }

  setPlayerCount(playerCount: number): void {
    const next = validatePlayerCount(playerCount);
    if (next === this.playerCount) return;
    this.playerCount = next;
    this.rebuildCells();
    if (this.hasLayout) this.layoutCells();
  }

  resize(width: number, height: number): void {
    validateViewport(width, height);
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.hasLayout = true;
    this.layoutCells();
  }

  getGridCoordinates(index: number): GridCoordinates {
    if (!this.hasLayout) {
      throw new Error('CircularMap.resize(width, height) must be called before reading coordinates.');
    }
    if (!Number.isInteger(index) || index < 0 || index >= this.gridCount) {
      throw new RangeError(`Grid index must be an integer between 0 and ${this.gridCount - 1}.`);
    }
    return { ...this.coordinates[index] };
  }

  private rebuildCells(): void {
    for (const cell of this.cells) {
      this.removeChild(cell);
      cell.destroy();
    }
    this.cells = Array.from({ length: this.gridCount }, () => {
      const cell = new Graphics();
      this.addChild(cell);
      return cell;
    });
    this.coordinates = [];
  }

  private layoutCells(): void {
    const centerX = this.viewportWidth / 2;
    const centerY = this.viewportHeight / 2;
    const radius = Math.max(48, Math.min(this.viewportWidth, this.viewportHeight) * 0.34);
    const arcLength = (Math.PI * 2 * radius) / this.gridCount;
    const cellRadius = Math.max(11, Math.min(28, arcLength * 0.28));

    this.coordinates = this.cells.map((cell, index) => {
      const angle = (Math.PI * 2 * index) / this.gridCount + this.viewRotation;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      cell.clear()
        .circle(x, y, cellRadius)
        .fill({ color: index % 2 === 0 ? 0x252d4a : 0x182039, alpha: 0.95 })
        .stroke({ color: index % 2 === 0 ? 0x6d7cff : 0x3c496e, width: 2 });
      return { x, y };
    });
  }
}

export function normalizeAngle(radians: number): number {
  const fullTurn = Math.PI * 2;
  return ((radians % fullTurn) + fullTurn) % fullTurn;
}

export function validatePlayerCount(playerCount: number): number {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new RangeError(`playerCount must be an integer between ${MIN_PLAYERS} and ${MAX_PLAYERS}.`);
  }
  return playerCount;
}

function validateViewport(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('CircularMap viewport width and height must be positive finite numbers.');
  }
}
