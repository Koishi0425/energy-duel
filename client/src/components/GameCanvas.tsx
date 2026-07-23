import { useEffect, useRef } from 'react';
import { Application, Assets, Container, FederatedPointerEvent, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { assetById, boardObjectById, characterById, isResourceVisibleForCharacter, resourceById, roomEmotes, type GamePhase, type ResolutionStep, type RoomEmoteMessage, type SyncedBoardObject, type SyncedPlayer } from '@energy-duel/shared';
import { CircularMap } from '../game/CircularMap';
import { FALLBACK_PORTRAIT_URL, resolvePortraitPreviewUrl } from '../game/visualResolver';
import { HEALTH_BAR_COLORS, unitHealthBarModel } from '../game/unitHealthBar';
import { boardUnitSlot, lotusSeatBoardStatus } from '../game/lotusSeatBoard';
import { boardPortraitBaseHeight, boardPortraitSize, type BoardUnitKind } from '../game/boardVisualSizing';
import { playerRoomStatus } from '../playerRoomStatus';

interface ScreenPoint { x: number; y: number }
interface Props {
  players: SyncedPlayer[];
  phase: GamePhase;
  boardObjects: SyncedBoardObject[];
  emoteEvents?: RoomEmoteMessage[];
  targeting?: boolean;
  targetablePlayerIds?: string[];
  targetableBoardObjectIds?: string[];
  selectedTargetIds?: string[];
  gridTargeting?: boolean;
  targetableGridIndices?: number[];
  selectedGridIndex?: number;
  obscuredPlayerIds?: string[];
  resetViewKey?: number;
  resolutionStep?: ResolutionStep;
  onPlayerSelect?: (player: SyncedPlayer) => void;
  onBoardObjectSelect?: (object: SyncedBoardObject) => void;
  onPlayerInspect?: (player: SyncedPlayer) => void;
  onPlayerHover?: (player: SyncedPlayer | null, point?: ScreenPoint) => void;
  onBoardObjectInspect?: (objects: SyncedBoardObject[]) => void;
  onGridSelect?: (index: number) => void;
  onLoadProgress?: (progress: number, label: string) => void;
}
interface TokenView { root: Container; portrait: Sprite; ring: Graphics; healthBar: Graphics; armorValue: Text; commandBuffer: Text; name: Text; status: Text; assetUrl: string }
interface BoardObjectView {
  root: Container;
  overlay: Container;
  overlayHit: Graphics;
  telemetryPanel: Graphics;
  shape: Graphics;
  ring: Graphics;
  portrait: Sprite;
  label: Text;
  status: Text;
  telemetry: Text;
  assetUrl: string;
}

export default function GameCanvas(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const mapRef = useRef<CircularMap | null>(null);
  const tokenLayerRef = useRef<Container | null>(null);
  const boardObjectLayerRef = useRef<Container | null>(null);
  const boardEntityLayerRef = useRef<Container | null>(null);
  const boardObjectOverlayLayerRef = useRef<Container | null>(null);
  const effectLayerRef = useRef<Container | null>(null);
  const tokenViewsRef = useRef(new Map<string, TokenView>());
  const boardObjectViewsRef = useRef(new Map<string, BoardObjectView>());
  const animatedEmoteIdsRef = useRef(new Set<string>());
  const propsRef = useRef(props);
  propsRef.current = props;

  const positionViews = () => {
    const map = mapRef.current;
    if (!map) return;
    const unitKeysByCell = new Map<number, string[]>();
    for (const player of propsRef.current.players) {
      const keys = unitKeysByCell.get(player.gridIndex) ?? []; keys.push(`player:${player.playerId}`); unitKeysByCell.set(player.gridIndex, keys);
    }
    for (const object of propsRef.current.boardObjects) if (object.kind === 'summon' && object.currentHp > 0) {
      const keys = unitKeysByCell.get(object.gridIndex) ?? []; keys.push(`object:${object.objectId}`); unitKeysByCell.set(object.gridIndex, keys);
    }
    for (const keys of unitKeysByCell.values()) keys.sort();
    const layout = (cell: number, key: string) => boardUnitSlot(unitKeysByCell.get(cell) ?? [key], key);
    for (const player of propsRef.current.players) {
      const view = tokenViewsRef.current.get(player.playerId);
      if (!view) continue;
      const point = map.getGridCoordinates(player.gridIndex); const slot = layout(player.gridIndex, `player:${player.playerId}`);
      view.root.scale.set(slot.scale); view.root.position.set(point.x + slot.x, point.y + slot.y);
    }
    for (const object of propsRef.current.boardObjects) {
      const view = boardObjectViewsRef.current.get(object.objectId);
      if (!view) continue;
      const point = map.getGridCoordinates(object.gridIndex);
      const slot = object.kind === 'summon' ? layout(object.gridIndex, `object:${object.objectId}`) : { x: 0, y: 0, scale: 1 };
      view.root.scale.set(slot.scale); view.root.position.set(point.x + slot.x, point.y + slot.y);
      view.overlay.scale.set(object.kind === 'summon' ? Math.max(0.78, slot.scale) : 1);
      view.overlay.position.set(point.x + slot.x, point.y + slot.y);
    }
  };

  const syncViews = () => {
    const layer = tokenLayerRef.current;
    if (!layer) return;
    const players = propsRef.current.players;
    const activeIds = new Set(players.map((player) => player.playerId));
    for (const [playerId, view] of tokenViewsRef.current) if (!activeIds.has(playerId)) {
      view.root.destroy({ children: true }); tokenViewsRef.current.delete(playerId);
    }
    for (const player of players) {
      let view = tokenViewsRef.current.get(player.playerId);
      if (!view) {
        view = createTokenView(player.playerId, propsRef);
        tokenViewsRef.current.set(player.playerId, view); layer.addChild(view.root);
      }
      updateTokenView(view, player, players.length, propsRef.current);
    }
    positionViews();
  };

  const syncEmoteAnimations = () => {
    const app = appRef.current;
    if (!app) return;
    const activeIds = new Set((propsRef.current.emoteEvents ?? []).map((event) => event.eventId));
    for (const eventId of animatedEmoteIdsRef.current) if (!activeIds.has(eventId)) animatedEmoteIdsRef.current.delete(eventId);
    for (const event of propsRef.current.emoteEvents ?? []) {
      if (animatedEmoteIdsRef.current.has(event.eventId)) continue;
      const view = tokenViewsRef.current.get(event.playerId);
      const emote = roomEmotes.find((candidate) => candidate.id === event.emoteId);
      if (!view || !emote) continue;
      animatedEmoteIdsRef.current.add(event.eventId);
      animatePlayerEmote(app, view.root, emote.emoji, event.eventId);
    }
  };

  const syncBoardObjects = () => {
    const terrainLayer = boardObjectLayerRef.current;
    const entityLayer = boardEntityLayerRef.current;
    const overlayLayer = boardObjectOverlayLayerRef.current;
    if (!terrainLayer || !entityLayer || !overlayLayer) return;
    const activeIds = new Set(propsRef.current.boardObjects.map((object) => object.objectId));
    for (const [objectId, view] of boardObjectViewsRef.current) if (!activeIds.has(objectId)) {
      view.root.destroy({ children: true }); view.overlay.destroy({ children: true }); boardObjectViewsRef.current.delete(objectId);
    }
    for (const object of propsRef.current.boardObjects) {
      let view = boardObjectViewsRef.current.get(object.objectId);
      if (!view) {
        view = createBoardObjectView(object.objectId, propsRef);
        boardObjectViewsRef.current.set(object.objectId, view);
        (object.kind === 'terrain' ? terrainLayer : entityLayer).addChild(view.root);
        overlayLayer.addChild(view.overlay);
      }
      const definition = boardObjectById.get(object.definitionId); const color = Number.parseInt((definition?.color ?? '#94a3b8').slice(1), 16);
      view.root.eventMode = propsRef.current.gridTargeting ? 'none' : 'static'; view.overlay.eventMode = propsRef.current.gridTargeting ? 'none' : 'static';
      view.shape.clear(); view.ring.clear(); view.overlayHit.clear(); view.telemetryPanel.clear(); view.portrait.visible = object.kind === 'summon'; view.status.visible = object.kind === 'summon'; view.telemetry.visible = false;
      if (object.kind === 'terrain') {
        view.shape.ellipse(0, 7, 31, 14).fill({ color, alpha: 0.3 }).stroke({ color, width: 3, alpha: 0.9 });
        const occupied = propsRef.current.players.some((player) => player.alive && player.gridIndex === object.gridIndex)
          || propsRef.current.boardObjects.some((candidate) => candidate.kind === 'summon' && candidate.gridIndex === object.gridIndex && candidate.currentHp > 0);
        const terrainAtCell = propsRef.current.boardObjects.filter((candidate) => candidate.kind === 'terrain' && candidate.gridIndex === object.gridIndex).sort((left, right) => left.objectId.localeCompare(right.objectId));
        const slot = Math.max(0, terrainAtCell.findIndex((candidate) => candidate.objectId === object.objectId));
        const portraitHeight = boardPortraitBaseHeight(propsRef.current.players.length);
        const amount = definition?.displayMode === 'stacks' && object.stacks > 1 ? ` ×${object.stacks}` : '';
        view.label.anchor.set(0.5, 1); view.label.text = `${definition?.name ?? object.definitionId}${amount}`;
        const labelY = occupied ? -portraitHeight - 27 - slot * 15 : -11 - slot * 15;
        view.label.position.set(0, labelY); view.overlayHit.roundRect(-38, labelY - 16, 76, 19, 4).fill({ color: 0x000000, alpha: 0.001 });
        view.root.alpha = 1;
      } else {
        const portraitHeight = boardPortraitBaseHeight(propsRef.current.players.length);
        const owner = propsRef.current.players.find((player) => player.playerId === object.ownerPlayerId);
        applyPortraitSize(view.portrait, propsRef.current.players.length, 'summon'); view.portrait.position.set(0, 8);
        const targetable = propsRef.current.targeting && propsRef.current.targetableBoardObjectIds?.includes(object.objectId);
        view.ring.ellipse(0, 7, portraitHeight * 0.34, Math.max(7, portraitHeight * 0.11)).fill({ color: owner?.color ?? color, alpha: 0.3 }).stroke({ color: targetable ? 0x55f2b0 : color, width: targetable ? 5 : 3 });
        const asset = definition?.defaultAssetId ? assetById.get(definition.defaultAssetId) : undefined;
        const assetUrl = asset?.previewUrl ?? asset?.url ?? FALLBACK_PORTRAIT_URL;
        if (assetUrl !== view.assetUrl) {
          view.assetUrl = assetUrl;
          void loadTrimmedTexture(assetUrl).then((texture) => { if (view?.assetUrl === assetUrl) { view.portrait.texture = texture; applyPortraitSize(view.portrait, propsRef.current.players.length, 'summon'); } }).catch(() => { view!.portrait.texture = Texture.from(FALLBACK_PORTRAIT_URL); applyPortraitSize(view!.portrait, propsRef.current.players.length, 'summon'); });
        }
        view.label.anchor.set(0.5, 0); view.label.text = definition?.name ?? object.definitionId; view.label.position.set(0, 11);
        view.status.text = object.maxHp > 0 ? `HP ${formatResource(object.currentHp)}/${formatResource(object.maxHp)}${owner ? ` · ${truncate(owner.nickname, 8)}` : ''}` : owner ? `归属 ${truncate(owner.nickname, 8)}` : '召唤物';
        view.status.position.set(0, propsRef.current.players.length > 12 ? 23 : 27);
        if (object.definitionId === 'lotus_seat') {
          const occupants = propsRef.current.players.filter((player) => player.gridIndex === object.gridIndex).length
            + propsRef.current.boardObjects.filter((candidate) => candidate.kind === 'summon' && candidate.currentHp > 0 && candidate.gridIndex === object.gridIndex).length;
          const compact = propsRef.current.players.length > 8 || occupants > 1;
          view.telemetry.text = lotusSeatBoardStatus(object, compact);
          view.telemetry.style.fontSize = compact ? 8 : 9;
          view.telemetry.position.set(0, propsRef.current.players.length > 12 ? 34 : 40);
          const panelWidth = Math.max(64, view.telemetry.width + 10);
          view.telemetryPanel.roundRect(-panelWidth / 2, view.telemetry.y - 2, panelWidth, view.telemetry.height + 4, 4)
            .fill({ color: 0x07111f, alpha: 0.86 }).stroke({ color, width: 1, alpha: 0.8 });
          view.overlayHit.roundRect(-panelWidth / 2, 8, panelWidth, view.telemetry.y + view.telemetry.height - 6, 4).fill({ color: 0x000000, alpha: 0.001 });
          view.telemetry.visible = true;
        }
        view.root.alpha = object.maxHp > 0 && object.currentHp <= 0 ? 0.38 : propsRef.current.targeting && !targetable ? 0.28 : 1;
      }
    }
    positionViews();
  };

  const syncGridSelection = () => {
    mapRef.current?.setGridSelection(
      propsRef.current.gridTargeting ? propsRef.current.targetableGridIndices ?? [] : [],
      propsRef.current.selectedGridIndex,
      propsRef.current.gridTargeting ? propsRef.current.onGridSelect : undefined,
    );
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false; let initialized = false;
    const app = new Application();
    propsRef.current.onLoadProgress?.(8, '正在初始化绘图引擎');
    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      if (!map || host.clientWidth <= 0 || host.clientHeight <= 0) return;
      map.resize(host.clientWidth, host.clientHeight);
      app.stage.hitArea = new Rectangle(0, 0, host.clientWidth, host.clientHeight);
      positionViews();
    });
    const canvasResolution = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    void Promise.all([app.init({ antialias: true, autoDensity: true, backgroundAlpha: 0, resizeTo: host, resolution: canvasResolution, roundPixels: true }), Assets.load<Texture>(FALLBACK_PORTRAIT_URL)]).then(async () => {
      propsRef.current.onLoadProgress?.(55, '正在准备角色资源');
      const portraitUrls = Array.from(new Set(propsRef.current.players.map((player) => resolvePortraitPreviewUrl(player.characterId, player.currentFormId)).filter((url) => url !== FALLBACK_PORTRAIT_URL)));
      let loadedPortraits = 0;
      await loadWithConcurrency(portraitUrls, 3, async (url) => {
        await loadTrimmedTexture(url).catch(() => undefined); loadedPortraits += 1;
        propsRef.current.onLoadProgress?.(55 + Math.round((loadedPortraits / Math.max(1, portraitUrls.length)) * 38), `正在加载角色预览 ${loadedPortraits}/${portraitUrls.length}`);
      });
      initialized = true;
      if (cancelled) { app.destroy(true); return; }
      host.appendChild(app.canvas); appRef.current = app;
      const map = new CircularMap(Math.max(1, propsRef.current.players.length));
      const boardObjectLayer = new Container(); const boardEntityLayer = new Container(); const tokenLayer = new Container(); const boardObjectOverlayLayer = new Container(); const effectLayer = new Container();
      app.stage.addChild(map, boardObjectLayer, boardEntityLayer, tokenLayer, boardObjectOverlayLayer, effectLayer);
      app.stage.eventMode = 'static'; app.stage.hitArea = new Rectangle(0, 0, host.clientWidth, host.clientHeight);
      mapRef.current = map; boardObjectLayerRef.current = boardObjectLayer; boardEntityLayerRef.current = boardEntityLayer; tokenLayerRef.current = tokenLayer; boardObjectOverlayLayerRef.current = boardObjectOverlayLayer; effectLayerRef.current = effectLayer;
      installRotationGestures(app, map, positionViews);
      map.resize(host.clientWidth, host.clientHeight); syncBoardObjects(); syncViews(); syncEmoteAnimations(); syncGridSelection(); observer.observe(host);
      propsRef.current.onLoadProgress?.(100, '战场已就绪');
    });
    return () => {
      cancelled = true; observer.disconnect(); appRef.current = null; mapRef.current = null; boardObjectLayerRef.current = null; boardEntityLayerRef.current = null; tokenLayerRef.current = null; boardObjectOverlayLayerRef.current = null; effectLayerRef.current = null; tokenViewsRef.current.clear(); boardObjectViewsRef.current.clear(); animatedEmoteIdsRef.current.clear();
      if (initialized) app.destroy(true, { children: true });
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setPlayerCount(Math.max(1, props.players.length)); syncBoardObjects(); syncViews(); syncEmoteAnimations(); syncGridSelection();
  }, [props.players, props.phase, props.boardObjects, props.emoteEvents, props.targeting, props.selectedTargetIds, props.targetablePlayerIds, props.targetableBoardObjectIds, props.gridTargeting, props.targetableGridIndices, props.selectedGridIndex]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setViewRotation(0); positionViews();
  }, [props.resetViewKey]);

  useEffect(() => {
    const app = appRef.current; const layer = effectLayerRef.current;
    if (!app || !layer || !props.resolutionStep) return;
    return animateResolutionStep(app, layer, props.resolutionStep, props.players, mapRef.current, tokenViewsRef.current);
  }, [props.resolutionStep]);

  return <div className={`game-canvas${props.targeting || props.gridTargeting ? ' is-targeting' : ''}`} ref={hostRef} aria-label="可旋转圆形战棋地图，地块带有编号" />;
}

function createBoardObjectView(objectId: string, propsRef: React.MutableRefObject<Props>): BoardObjectView {
  const root = new Container(); const overlay = new Container(); const overlayHit = new Graphics(); const telemetryPanel = new Graphics(); const shape = new Graphics(); const ring = new Graphics();
  const portrait = new Sprite(Texture.from(FALLBACK_PORTRAIT_URL)); portrait.anchor.set(0.5, 1);
  const label = new Text({ style: { fill: 0xffffff, fontSize: 10, fontWeight: '700', dropShadow: true, align: 'center' } });
  const status = new Text({ style: { fill: 0xcbd1ed, fontSize: 9, dropShadow: true, align: 'center' } }); status.anchor.set(0.5, 0);
  const telemetry = new Text({ style: { fill: 0xf8fafc, fontSize: 9, fontWeight: '700', align: 'center' } }); telemetry.anchor.set(0.5, 0);
  root.addChild(shape, ring, portrait); overlay.addChild(overlayHit, telemetryPanel, label, status, telemetry);
  const inspect = () => {
    if (propsRef.current.gridTargeting) return;
    const object = propsRef.current.boardObjects.find((candidate) => candidate.objectId === objectId);
    if (!object) return;
    if (propsRef.current.targeting && propsRef.current.targetableBoardObjectIds?.includes(object.objectId)) propsRef.current.onBoardObjectSelect?.(object);
    else if (!propsRef.current.targeting) {
      const inspected = object.kind === 'terrain'
        ? propsRef.current.boardObjects
          .filter((candidate) => candidate.kind === 'terrain' && candidate.gridIndex === object.gridIndex)
          .sort((left, right) => left.objectId.localeCompare(right.objectId))
        : [object];
      propsRef.current.onBoardObjectInspect?.(inspected);
    }
  };
  for (const target of [root, overlay]) {
    target.eventMode = 'static'; target.cursor = 'pointer'; target.on('pointertap', inspect);
  }
  return { root, overlay, overlayHit, telemetryPanel, shape, ring, portrait, label, status, telemetry, assetUrl: FALLBACK_PORTRAIT_URL };
}

function createTokenView(playerId: string, propsRef: React.MutableRefObject<Props>): TokenView {
  const root = new Container(); const ring = new Graphics(); const healthBar = new Graphics();
  const portrait = new Sprite(Texture.from(FALLBACK_PORTRAIT_URL)); portrait.anchor.set(0.5, 1);
  const armorValue = new Text({ style: { fill: 0xf8fafc, fontWeight: '800', align: 'center' } }); armorValue.anchor.set(0.5);
  const commandBuffer = new Text({ style: { fill: 0xffdf68, fontWeight: '700', dropShadow: true, align: 'center' } }); commandBuffer.anchor.set(0.5, 1);
  const name = new Text({ style: { fill: 0xffffff, fontWeight: '700', dropShadow: true, align: 'center' } }); name.anchor.set(0.5, 0);
  const status = new Text({ style: { fill: 0xcbd1ed, dropShadow: true, align: 'center' } }); status.anchor.set(0.5, 0);
  root.addChild(ring, portrait, healthBar, armorValue, commandBuffer, name, status); root.eventMode = 'static'; root.cursor = 'pointer';
  const currentPlayer = () => propsRef.current.players.find((candidate) => candidate.playerId === playerId);
  root.on('pointerover', (event: FederatedPointerEvent) => { const player = currentPlayer(); if (player) propsRef.current.onPlayerHover?.(player, { x: event.clientX, y: event.clientY }); });
  root.on('pointermove', (event: FederatedPointerEvent) => { const player = currentPlayer(); if (player) propsRef.current.onPlayerHover?.(player, { x: event.clientX, y: event.clientY }); });
  root.on('pointerout', () => propsRef.current.onPlayerHover?.(null));
  root.on('pointertap', () => {
    if (propsRef.current.gridTargeting) return;
    const player = currentPlayer(); if (!player) return;
    if (propsRef.current.targeting && propsRef.current.targetablePlayerIds?.includes(player.playerId)) propsRef.current.onPlayerSelect?.(player);
    else if (!propsRef.current.targeting) propsRef.current.onPlayerInspect?.(player);
  });
  return { root, portrait, ring, healthBar, armorValue, commandBuffer, name, status, assetUrl: FALLBACK_PORTRAIT_URL };
}

function updateTokenView(view: TokenView, player: SyncedPlayer, playerCount: number, props: Props): void {
  const portraitHeight = boardPortraitBaseHeight(playerCount);
  applyPortraitSize(view.portrait, playerCount, 'player'); view.portrait.position.set(0, 8);
  view.root.eventMode = props.gridTargeting ? 'none' : 'static'; view.root.cursor = props.gridTargeting ? 'default' : 'pointer';
  const assetUrl = resolvePortraitPreviewUrl(player.characterId, player.currentFormId);
  if (assetUrl !== view.assetUrl) {
    view.assetUrl = assetUrl;
    void loadTrimmedTexture(assetUrl).then((texture) => { if (view.assetUrl === assetUrl) { view.portrait.texture = texture; applyPortraitSize(view.portrait, playerCount, 'player'); } }).catch(() => { view.portrait.texture = Texture.from(FALLBACK_PORTRAIT_URL); applyPortraitSize(view.portrait, playerCount, 'player'); });
  }
  const targetable = props.targeting && props.targetablePlayerIds?.includes(player.playerId);
  const selected = props.selectedTargetIds?.includes(player.playerId);
  const obscured = props.obscuredPlayerIds?.includes(player.playerId);
  view.root.alpha = !player.connected ? 0.22 : !player.alive ? 0.38 : props.targeting && !targetable ? 0.28 : 1;
  const ringRadius = portraitHeight * 0.34;
  view.ring.clear().ellipse(0, 7, ringRadius, Math.max(7, ringRadius * 0.32)).fill({ color: player.color, alpha: 0.3 }).stroke({ color: selected ? 0xffdf68 : targetable ? 0x55f2b0 : player.color, width: selected ? 5 : targetable ? 4 : 2 });
  const armor = player.buffs.find((buff) => buff.buffId === 'armor')?.stacks ?? 0;
  const healthBar = unitHealthBarModel(player.currentHp, player.maxHp, playerCount, armor);
  const barY = 3 - portraitHeight - healthBar.height;
  const segmentWidth = (healthBar.width - healthBar.gap * (healthBar.segmentColors.length - 1)) / healthBar.segmentColors.length;
  view.healthBar.clear(); view.healthBar.visible = !obscured;
  view.healthBar.roundRect(-healthBar.width / 2 - 1, barY - 1, healthBar.width + 2, healthBar.height + 2, 2).fill({ color: HEALTH_BAR_COLORS.border, alpha: 0.92 });
  healthBar.segmentColors.forEach((color, index) => {
    view.healthBar.rect(-healthBar.width / 2 + index * (segmentWidth + healthBar.gap), barY, segmentWidth, healthBar.height).fill({ color, alpha: color === HEALTH_BAR_COLORS.empty ? 0.9 : 1 });
  });
  if (healthBar.armor > 0) {
    const armorRadius = Math.max(6, healthBar.height);
    const armorX = healthBar.width / 2 + armorRadius + 5;
    view.healthBar.roundRect(-healthBar.width / 2 - 3, barY - 3, healthBar.width + 6, healthBar.height + 6, 3).stroke({ color: HEALTH_BAR_COLORS.armor, width: 2 });
    view.healthBar.circle(armorX, barY + healthBar.height / 2, armorRadius).fill({ color: 0x111827, alpha: 0.96 }).stroke({ color: HEALTH_BAR_COLORS.armor, width: 2 });
    view.armorValue.text = formatResource(healthBar.armor); view.armorValue.style.fontSize = playerCount > 12 ? 6 : playerCount > 8 ? 7 : 8; view.armorValue.position.set(armorX, barY + healthBar.height / 2); view.armorValue.visible = !obscured;
  } else view.armorValue.visible = false;
  view.commandBuffer.visible = !obscured && player.characterId === 'napoleon' && player.commandBuffer.length > 0;
  view.commandBuffer.text = `指令 ${player.commandBuffer}`; view.commandBuffer.style.fontSize = playerCount > 12 ? 7 : playerCount > 8 ? 9 : 11; view.commandBuffer.position.set(0, barY - 3);
  view.name.text = obscured ? '黑暗中的目标' : truncate(player.nickname, playerCount > 12 ? 6 : 12); view.name.style.fontSize = playerCount > 12 ? 8 : playerCount > 8 ? 10 : 12; view.name.position.set(0, 11);
  const resources = Object.values(player.resources).filter((resource) => isResourceVisibleForCharacter(resource.resourceId, player.characterId, resource.current)).sort((a, b) => (resourceById.get(a.resourceId)?.displayOrder ?? 999) - (resourceById.get(b.resourceId)?.displayOrder ?? 999)).map((resource) => `${resourceById.get(resource.resourceId)?.shortName ?? resource.resourceId} ${formatResource(resource.current)}`).join(' · ');
  const roomStatus = playerRoomStatus(player, props.phase).label;
  view.status.text = obscured ? '状态未知' : player.alive ? `${roomStatus}${resources ? ` · ${resources}` : ''}` : roomStatus; view.status.style.fontSize = playerCount > 12 ? 7 : playerCount > 8 ? 8 : 10; view.status.position.set(0, playerCount > 12 ? 23 : 27);
}

function installRotationGestures(app: Application, map: CircularMap, reposition: () => void): void {
  let dragging = false; let lastAngle = 0; let velocity = 0; let moved = 0; let inertiaFrame = 0;
  app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
    if (event.target !== app.stage) return;
    cancelAnimationFrame(inertiaFrame); dragging = true; moved = 0; velocity = 0;
    lastAngle = Math.atan2(event.global.y - app.screen.height / 2, event.global.x - app.screen.width / 2);
  });
  app.stage.on('globalpointermove', (event: FederatedPointerEvent) => {
    if (!dragging) return;
    const nextAngle = Math.atan2(event.global.y - app.screen.height / 2, event.global.x - app.screen.width / 2);
    let delta = nextAngle - lastAngle; if (delta > Math.PI) delta -= Math.PI * 2; if (delta < -Math.PI) delta += Math.PI * 2;
    map.setViewRotation(map.rotationRadians + delta); velocity = velocity * 0.6 + delta * 0.4; moved += Math.abs(delta); lastAngle = nextAngle; reposition();
  });
  const stop = () => {
    dragging = false;
    if (moved < 0.015 || Math.abs(velocity) < 0.001) return;
    const tick = () => { velocity *= 0.92; if (Math.abs(velocity) < 0.0002) return; map.setViewRotation(map.rotationRadians + velocity); reposition(); inertiaFrame = requestAnimationFrame(tick); };
    inertiaFrame = requestAnimationFrame(tick);
  };
  app.stage.on('pointerup', stop); app.stage.on('pointerupoutside', stop);
}

const trimmedTextureCache = new Map<string, Promise<Texture>>();
function applyPortraitSize(sprite: Sprite, playerCount: number, kind: BoardUnitKind): void {
  const size = boardPortraitSize(sprite.texture.width, sprite.texture.height, playerCount, kind);
  sprite.width = size.width; sprite.height = size.height;
}

function loadTrimmedTexture(url: string): Promise<Texture> {
  const cached = trimmedTextureCache.get(url); if (cached) return cached;
  const promise = new Promise<Texture>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const source = document.createElement('canvas'); source.width = image.naturalWidth; source.height = image.naturalHeight;
      const context = source.getContext('2d', { willReadFrequently: true }); if (!context) return resolve(Texture.from(image));
      context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, source.width, source.height).data;
      let left = source.width; let right = 0; let top = source.height; let bottom = 0;
      for (let y = 0; y < source.height; y += 2) for (let x = 0; x < source.width; x += 2) if (pixels[(y * source.width + x) * 4 + 3] >= 8) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
      if (right <= left || bottom <= top) return resolve(Texture.from(image));
      const padding = Math.max(4, Math.round(Math.max(right - left, bottom - top) * 0.05)); left = Math.max(0, left - padding); top = Math.max(0, top - padding); right = Math.min(source.width - 1, right + padding); bottom = Math.min(source.height - 1, bottom + padding);
      const scale = Math.min(1, 512 / Math.max(right - left + 1, bottom - top + 1)); const output = document.createElement('canvas'); output.width = Math.max(1, Math.round((right - left + 1) * scale)); output.height = Math.max(1, Math.round((bottom - top + 1) * scale));
      output.getContext('2d')?.drawImage(source, left, top, right - left + 1, bottom - top + 1, 0, 0, output.width, output.height); resolve(Texture.from(output));
    };
    image.onerror = reject; image.src = url;
  });
  trimmedTextureCache.set(url, promise); return promise;
}

function animatePlayerEmote(app: Application, root: Container, emoji: string, eventId: string): void {
  const lane = Array.from(eventId).reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16_777_619), 2_166_136_261) % 3 - 1;
  const startX = 36 + lane * 13;
  const display = new Text({ text: emoji, style: { fontSize: 27, dropShadow: true, align: 'center' } });
  display.anchor.set(0.5); display.position.set(startX, -24); display.scale.set(0.82); display.eventMode = 'none';
  root.addChild(display);
  const startedAt = performance.now();
  const update = () => {
    if (display.destroyed) { app.ticker.remove(update); return; }
    const progress = Math.min(1, (performance.now() - startedAt) / 1_500);
    display.position.set(startX + lane * progress * 5, -24 - progress * 74);
    display.scale.set(0.82 + Math.min(1, progress / 0.18) * 0.18);
    display.alpha = progress < 0.12 ? progress / 0.12 : progress > 0.58 ? (1 - progress) / 0.42 : 1;
    if (progress >= 1) { app.ticker.remove(update); display.destroy(); }
  };
  app.ticker.add(update);
}

function animateResolutionStep(app: Application, layer: Container, step: ResolutionStep, players: SyncedPlayer[], map: CircularMap | null, views: Map<string, TokenView>): () => void {
  layer.removeChildren().forEach((child) => child.destroy());
  const animations: Array<{ display: Text; from: ScreenPoint; to: ScreenPoint; lift: number; stationary: boolean }> = [];
  const impacts: Text[] = [];
  const defendingPlayerIds = new Set(step.actors.filter((actor) => isDefenseAction(actor.actionId)).map((actor) => actor.playerId));
  for (const actor of step.actors) {
    const sourcePlayer = players.find((player) => player.playerId === actor.playerId); if (!sourcePlayer || !map) continue;
    const source = map.getGridCoordinates(sourcePlayer.gridIndex); const targetPlayer = players.find((player) => player.playerId === actor.targetIds[0]); const target = targetPlayer ? map.getGridCoordinates(targetPlayer.gridIndex) : { x: source.x, y: source.y - 52 };
    const stationary = isDefenseAction(actor.actionId);
    const from = { x: source.x, y: source.y - 28 };
    const to = stationary ? from : { x: target.x, y: target.y - 28 };
    const display = new Text({ text: effectEmoji(actor.actionId), style: { fontSize: stationary ? 42 : 30, dropShadow: true } });
    display.anchor.set(0.5); display.position.set(from.x, from.y); layer.addChild(display);
    animations.push({ display, from, to, lift: targetPlayer ? 0 : 12, stationary });
    if (targetPlayer && defendingPlayerIds.has(targetPlayer.playerId) && isAttackAction(actor.actionId)) {
      const impact = new Text({ text: '💥', style: { fontSize: 26, dropShadow: true } });
      impact.anchor.set(0.5); impact.position.set(target.x, target.y - 28); impact.alpha = 0; impact.scale.set(0.2); layer.addChild(impact); impacts.push(impact);
    }
    if (actor.transformCharacterId) {
      const view = views.get(actor.playerId); const character = characterById.get(actor.transformCharacterId); const assetId = character?.forms[0]?.defaultAssetId; const asset = assetId ? assetById.get(assetId) : undefined; const url = asset?.previewUrl ?? asset?.url;
      if (view && url) void loadTrimmedTexture(url).then((texture) => { view.portrait.texture = texture; view.assetUrl = url; applyPortraitSize(view.portrait, players.length, 'player'); });
    }
  }
  const start = performance.now();
  const update = () => {
    const progress = Math.min(1, (performance.now() - start) / step.durationMs); const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2;
    for (const animation of animations) {
      animation.display.position.set(animation.from.x + (animation.to.x - animation.from.x) * eased, animation.from.y + (animation.to.y - animation.from.y) * eased - Math.sin(Math.PI * eased) * animation.lift);
      animation.display.alpha = progress > 0.86 ? (1 - progress) / 0.14 : 1;
      animation.display.scale.set(animation.stationary ? 1 + Math.sin(Math.PI * progress) * 0.12 : 1 + Math.sin(Math.PI * progress) * 0.2);
    }
    const impactProgress = Math.max(0, Math.min(1, (progress - 0.68) / 0.2));
    for (const impact of impacts) { impact.alpha = impactProgress < 0.75 ? impactProgress / 0.75 : (1 - impactProgress) / 0.25; impact.scale.set(0.2 + impactProgress * 1.15); }
  };
  app.ticker.add(update);
  return () => { app.ticker.remove(update); layer.removeChildren().forEach((child) => child.destroy()); };
}

function isDefenseAction(actionId: string): boolean { return ['defend', 'axe_defend', 'super_defend'].includes(actionId); }
function isAttackAction(actionId: string): boolean { return ['fist', 'slash', 'wave', 'atomic_breath', 'chop', 'hangup'].includes(actionId); }

function effectEmoji(actionId: string): string {
  if (actionId === 'fist') return '👊'; if (actionId === 'slash' || actionId === 'chop') return '⚔️'; if (['defend', 'axe_defend', 'super_defend'].includes(actionId)) return '🛡️'; if (actionId === 'transform') return '✨'; if (actionId === 'atomic_breath') return '☄️'; if (actionId === 'heal') return '💚'; if (actionId === 'charge' || actionId === 'gain_charge') return '⚡'; return '💥';
}
function truncate(value: string, maxLength: number): string { return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value; }
async function loadWithConcurrency<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next; next += 1; await task(items[index]); }
  }));
}
function formatResource(value: number): string { if (Math.abs(value - 1 / 3) < 0.001) return '1/3'; if (Math.abs(value - 2 / 3) < 0.001) return '2/3'; return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
