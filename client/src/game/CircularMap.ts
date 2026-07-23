import { Container, Graphics, Text } from 'pixi.js';

export interface GridCoordinates { x: number; y: number }

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 20;

export class CircularMap extends Container {
  private playerCount: number;
  private readonly boardLayer = new Container();
  private cells: Graphics[] = [];
  private cellLabels: Text[] = [];
  private targetableCells = new Set<number>();
  private selectedCell?: number;
  private onCellSelect?: (index: number) => void;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private radius = 0;
  private hasLayout = false;
  private viewRotation = 0;
  private cellRadius = 11;

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
    for (const label of this.cellLabels) label.rotation = -this.viewRotation;
  }

  setGridSelection(targetableIndices: readonly number[], selectedIndex?: number, onSelect?: (index: number) => void): void {
    this.targetableCells = new Set(targetableIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < this.gridCount));
    this.selectedCell = selectedIndex;
    this.onCellSelect = onSelect;
    if (this.hasLayout) this.renderCells();
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
    this.radius = Math.max(48, Math.min(width, height) * 0.36);
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
    this.boardLayer.removeChildren().forEach((child) => child.destroy());
    this.cellLabels = [];
    this.cells = Array.from({ length: this.gridCount }, (_, index) => {
      const cell = new Graphics();
      cell.label = `grid-${index}`;
      cell.on('pointertap', () => { if (this.targetableCells.has(index)) this.onCellSelect?.(index); });
      const label = new Text({ text: String(index), style: { fill: 0xdbe5ff, fontSize: 11, fontWeight: '800', dropShadow: true } });
      label.anchor.set(0.5); label.eventMode = 'none'; label.rotation = -this.viewRotation;
      this.cellLabels.push(label);
      this.boardLayer.addChild(cell, label);
      return cell;
    });
  }

  private layoutCells(): void {
    const arcLength = (Math.PI * 2 * this.radius) / this.gridCount;
    this.cellRadius = Math.max(11, Math.min(32, arcLength * 0.32));
    this.cells.forEach((cell, index) => {
      const angle = (Math.PI * 2 * index) / this.gridCount;
      cell.position.set(this.radius * Math.cos(angle), this.radius * Math.sin(angle));
      const labelRadius = this.radius + this.cellRadius + 10;
      this.cellLabels[index].position.set(labelRadius * Math.cos(angle), labelRadius * Math.sin(angle));
      this.cellLabels[index].rotation = -this.viewRotation;
    });
    this.renderCells();
  }

  private renderCells(): void {
    this.cells.forEach((cell, index) => {
      const targetable = this.targetableCells.has(index); const selected = this.selectedCell === index;
      cell.eventMode = targetable ? 'static' : 'none'; cell.cursor = targetable ? 'pointer' : 'default';
      cell.clear().circle(0, 0, this.cellRadius)
        .fill({ color: selected ? 0x8a6d16 : targetable ? 0x164f42 : index % 2 === 0 ? 0x252d4a : 0x182039, alpha: 0.96 })
        .stroke({ color: selected ? 0xffdf68 : targetable ? 0x55f2b0 : index % 2 === 0 ? 0x6d7cff : 0x3c496e, width: selected ? 5 : targetable ? 4 : 2 });
      const label = this.cellLabels[index]; label.style.fill = selected ? 0xfff2a8 : targetable ? 0xb8ffe3 : 0xdbe5ff; label.style.fontSize = Math.max(9, Math.min(13, this.cellRadius * 0.55));
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
