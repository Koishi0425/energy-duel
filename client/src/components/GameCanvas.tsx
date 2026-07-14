import { useEffect, useRef } from 'react';
import { Application, Assets, Container, FederatedPointerEvent, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { resourceById, type SyncedPlayer } from '@energy-duel/shared';
import { CircularMap } from '../game/CircularMap';
import { FALLBACK_PORTRAIT_URL, resolvePortraitUrl } from '../game/visualResolver';

interface ScreenPoint { x: number; y: number }

interface Props {
  players: SyncedPlayer[];
  targeting?: boolean;
  targetablePlayerIds?: string[];
  selectedTargetId?: string;
  resetViewKey?: number;
  onPlayerSelect?: (player: SyncedPlayer) => void;
  onPlayerInspect?: (player: SyncedPlayer) => void;
  onPlayerHover?: (player: SyncedPlayer | null, point?: ScreenPoint) => void;
}

interface TokenView {
  root: Container;
  portrait: Sprite;
  ring: Graphics;
  name: Text;
  status: Text;
  assetUrl: string;
}

export default function GameCanvas(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<CircularMap | null>(null);
  const tokenLayerRef = useRef<Container | null>(null);
  const tokenViewsRef = useRef(new Map<string, TokenView>());
  const propsRef = useRef(props);
  propsRef.current = props;

  const redraw = () => {
    const map = mapRef.current;
    const layer = tokenLayerRef.current;
    if (!map || !layer) return;
    const players = propsRef.current.players;
    const activeIds = new Set(players.map((player) => player.playerId));
    for (const [playerId, view] of tokenViewsRef.current) {
      if (!activeIds.has(playerId)) {
        view.root.destroy({ children: true });
        tokenViewsRef.current.delete(playerId);
      }
    }
    for (const player of players) {
      let view = tokenViewsRef.current.get(player.playerId);
      if (!view) {
        view = createTokenView(player);
        tokenViewsRef.current.set(player.playerId, view);
        layer.addChild(view.root);
      }
      updateTokenView(view, player, players.length, propsRef.current);
      const point = map.getGridCoordinates(player.gridIndex);
      view.root.position.set(point.x, point.y);
    }
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let initialized = false;
    const app = new Application();
    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      if (!map || host.clientWidth <= 0 || host.clientHeight <= 0) return;
      map.resize(host.clientWidth, host.clientHeight);
      if (app.stage) app.stage.hitArea = new Rectangle(0, 0, host.clientWidth, host.clientHeight);
      redraw();
    });

    void Promise.all([
      app.init({ antialias: true, backgroundAlpha: 0, resizeTo: host }),
      Assets.load<Texture>(FALLBACK_PORTRAIT_URL),
    ]).then(() => {
      initialized = true;
      if (cancelled) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);
      const map = new CircularMap(Math.max(1, propsRef.current.players.length));
      const tokenLayer = new Container();
      app.stage.addChild(map, tokenLayer);
      app.stage.eventMode = 'static';
      app.stage.hitArea = new Rectangle(0, 0, host.clientWidth, host.clientHeight);
      installRotationGestures(app, map, redraw);
      mapRef.current = map;
      tokenLayerRef.current = tokenLayer;
      map.resize(host.clientWidth, host.clientHeight);
      redraw();
      observer.observe(host);
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      mapRef.current = null;
      tokenLayerRef.current = null;
      tokenViewsRef.current.clear();
      if (initialized) app.destroy(true, { children: true });
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setPlayerCount(Math.max(1, props.players.length));
    redraw();
  }, [props.players, props.targeting, props.selectedTargetId, props.targetablePlayerIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setViewRotation(0);
    redraw();
  }, [props.resetViewKey]);

  function createTokenView(player: SyncedPlayer): TokenView {
    const root = new Container();
    const ring = new Graphics();
    const portrait = new Sprite(Texture.from(FALLBACK_PORTRAIT_URL));
    portrait.anchor.set(0.5, 1);
    const name = new Text({ style: { fill: 0xffffff, fontWeight: '700', dropShadow: true, align: 'center' } });
    name.anchor.set(0.5, 0);
    const status = new Text({ style: { fill: 0xcbd1ed, dropShadow: true, align: 'center' } });
    status.anchor.set(0.5, 0);
    root.addChild(ring, portrait, name, status);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointerover', (event: FederatedPointerEvent) => {
      const current = propsRef.current.players.find((candidate) => candidate.playerId === player.playerId);
      if (current) propsRef.current.onPlayerHover?.(current, { x: event.clientX, y: event.clientY });
    });
    root.on('pointermove', (event: FederatedPointerEvent) => {
      const current = propsRef.current.players.find((candidate) => candidate.playerId === player.playerId);
      if (current) propsRef.current.onPlayerHover?.(current, { x: event.clientX, y: event.clientY });
    });
    root.on('pointerout', () => propsRef.current.onPlayerHover?.(null));
    root.on('pointertap', () => {
      const current = propsRef.current.players.find((candidate) => candidate.playerId === player.playerId);
      if (!current) return;
      const state = propsRef.current;
      if (state.targeting && state.targetablePlayerIds?.includes(current.playerId)) state.onPlayerSelect?.(current);
      else if (!state.targeting) state.onPlayerInspect?.(current);
    });
    return { root, portrait, ring, name, status, assetUrl: FALLBACK_PORTRAIT_URL };
  }

  return <div className={`game-canvas${props.targeting ? ' is-targeting' : ''}`} ref={hostRef} aria-label="可旋转圆形战棋地图" />;
}

function updateTokenView(view: TokenView, player: SyncedPlayer, playerCount: number, props: Props): void {
  const portraitHeight = playerCount > 12 ? 38 : playerCount > 8 ? 48 : 64;
  const portraitWidth = portraitHeight * 0.72;
  view.portrait.width = portraitWidth;
  view.portrait.height = portraitHeight;
  view.portrait.position.set(0, 8);
  const assetUrl = resolvePortraitUrl(player.characterId, player.currentFormId);
  if (assetUrl !== view.assetUrl) {
    view.assetUrl = assetUrl;
    void Assets.load<Texture>(assetUrl).then((texture) => {
      if (view.assetUrl === assetUrl) view.portrait.texture = texture;
    }).catch(() => { view.portrait.texture = Texture.from(FALLBACK_PORTRAIT_URL); });
  }

  const targetable = props.targeting && props.targetablePlayerIds?.includes(player.playerId);
  const selected = props.selectedTargetId === player.playerId;
  const dimmedForTargeting = props.targeting && !targetable;
  view.root.alpha = !player.connected ? 0.22 : !player.alive ? 0.38 : dimmedForTargeting ? 0.28 : 1;
  const ringRadius = portraitWidth * 0.62;
  view.ring.clear()
    .ellipse(0, 7, ringRadius, Math.max(7, ringRadius * 0.32))
    .fill({ color: player.color, alpha: 0.3 })
    .stroke({ color: selected ? 0xffdf68 : targetable ? 0x55f2b0 : player.color, width: selected ? 5 : targetable ? 4 : 2 });
  view.name.text = truncate(player.nickname, playerCount > 12 ? 6 : 12);
  view.name.style.fontSize = playerCount > 12 ? 8 : playerCount > 8 ? 10 : 12;
  view.name.position.set(0, 11);
  const resources = Object.values(player.resources)
    .sort((a, b) => (resourceById.get(a.resourceId)?.displayOrder ?? 999) - (resourceById.get(b.resourceId)?.displayOrder ?? 999))
    .map((resource) => `${resourceById.get(resource.resourceId)?.shortName ?? resource.resourceId} ${resource.current}`)
    .join(' · ');
  view.status.text = player.alive ? `HP ${player.currentHp}/${player.maxHp}${resources ? ` · ${resources}` : ''}` : '已淘汰';
  view.status.style.fontSize = playerCount > 12 ? 8 : 10;
  view.status.position.set(0, playerCount > 12 ? 23 : 27);
}

function installRotationGestures(app: Application, map: CircularMap, redraw: () => void): void {
  let dragging = false;
  let lastAngle = 0;
  app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
    if (event.target !== app.stage) return;
    dragging = true;
    lastAngle = Math.atan2(event.global.y - app.screen.height / 2, event.global.x - app.screen.width / 2);
  });
  app.stage.on('globalpointermove', (event: FederatedPointerEvent) => {
    if (!dragging) return;
    const nextAngle = Math.atan2(event.global.y - app.screen.height / 2, event.global.x - app.screen.width / 2);
    let delta = nextAngle - lastAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    map.setViewRotation(map.rotationRadians + delta);
    lastAngle = nextAngle;
    redraw();
  });
  const stop = () => { dragging = false; };
  app.stage.on('pointerup', stop);
  app.stage.on('pointerupoutside', stop);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
