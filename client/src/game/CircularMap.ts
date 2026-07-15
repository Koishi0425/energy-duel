import { Container, Graphics } from 'pixi.js';

export interface GridCoordinates { x: number; y: number }

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 20;

export class CircularMap extends Container {
  private playerCount: number;
  private readonly boardLayer = new Container();
  private cells: Graphics[] = [];
  private viewportWidth = 0;
  private viewportHeight = 0;
  private radius = 0;
  private hasLayout = false;
  private viewRotation = 0;

  constructor(playerCount: number) {
    super();
    this.playerCount = validatePlayerCount(playerCount);
    this.addChild(this.boardLayer);
    this.rebuildCells();
  }

  get gridCount(): number { return this.playerCount * 2; }
  get rotationRadians(): number { return this.viewRotation; }

  setViewRotation(radians: number): void {
    if (!Number.isFinite(radians)) throw new RangeError('CircularMap rotation must be a finite number.');
    this.viewRotation = normalizeAngle(radians);
    this.boardLayer.rotation = this.viewRotation;
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
    this.radius = Math.max(48, Math.min(width, height) * 0.34);
    this.hasLayout = true;
    this.boardLayer.position.set(width / 2, height / 2);
    this.layoutCells();
  }

  getGridCoordinates(index: number): GridCoordinates {
    if (!this.hasLayout) throw new Error('CircularMap.resize(width, height) must be called before reading coordinates.');
    if (!Number.isInteger(index) || index < 0 || index >= this.gridCount) {
      throw new RangeError(`Grid index must be an integer between 0 and ${this.gridCount - 1}.`);
    }
    const angle = (Math.PI * 2 * index) / this.gridCount + this.viewRotation;
    return {
      x: this.viewportWidth / 2 + this.radius * Math.cos(angle),
      y: this.viewportHeight / 2 + this.radius * Math.sin(angle),
    };
  }

  private rebuildCells(): void {
    for (const cell of this.cells) cell.destroy();
    this.boardLayer.removeChildren();
    this.cells = Array.from({ length: this.gridCount }, (_, index) => {
      const cell = new Graphics();
      cell.label = `grid-${index}`;
      this.boardLayer.addChild(cell);
      return cell;
    });
  }

  private layoutCells(): void {
    const arcLength = (Math.PI * 2 * this.radius) / this.gridCount;
    const cellRadius = Math.max(11, Math.min(28, arcLength * 0.28));
    this.cells.forEach((cell, index) => {
      const angle = (Math.PI * 2 * index) / this.gridCount;
      cell.position.set(this.radius * Math.cos(angle), this.radius * Math.sin(angle));
      cell.clear().circle(0, 0, cellRadius)
        .fill({ color: index % 2 === 0 ? 0x252d4a : 0x182039, alpha: 0.95 })
        .stroke({ color: index % 2 === 0 ? 0x6d7cff : 0x3c496e, width: 2 });
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
