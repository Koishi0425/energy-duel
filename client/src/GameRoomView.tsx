import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  actionById,
  canExecuteNapoleonStrategy,
  characterById,
  gameConfig,
  isResourceVisibleForCharacter,
  isRoomEmoteId,
  napoleonStrategyFromCommand,
  passiveById,
  roomEmotes,
  type NapoleonCommand,
  resourceById,
  type ActionDefinition,
  type CommandResultMessage,
  type DeferredActionRequiredMessage,
  type GameRatingResultMessage,
  type LearningRequiredMessage,
  type PlayerProfile,
  type RevealedAction,
  type ResolutionStep,
  type RoomEmoteId,
  type RoomEmoteMessage,
  type RoomNoticeMessage,
  type RoundResolutionMessage,
  type SessionResponse,
  type SyncedBoardObject,
  type SyncedGameState,
  type SyncedPlayer,
  type SyncedRoundLogEntry,
} from '@energy-duel/shared';
import type { Room } from '@colyseus/sdk';
import { Button, Card, ConfigProvider, Drawer, Input, InputNumber, Modal, Popover, Select, Tag, message, theme } from 'antd';
import 'antd/dist/reset.css';
import type { DemoRoomState } from './App';
import ActionPanel from './components/ActionPanel';
import PlayerDetails from './components/PlayerDetails';
import PublicProfileDetails from './components/PublicProfileDetails';
import { PerformancePanel } from './components/PerformancePanel';
import FloatingWindow from './components/FloatingWindow';
import AnnouncementLauncher from './components/AnnouncementLauncher';
import BoardObjectDetails from './components/BoardObjectDetails';
import type { GuidePageId } from './content/gameGuide';
import { readSyncedBoardObjects, readSyncedPlayers } from './roomState';
import { fetchPlayerProfile } from './session';
import { canSponsorControlledActor, playerRoomStatus } from './playerRoomStatus';
import { clampEmoteWheelCenter, emoteWheelSelection, movedBeyondEmoteThreshold, type EmoteWheelPoint } from './emoteWheel';

interface Props { room: Room<DemoRoomState>; session: SessionResponse; onLeave: () => void }
interface EmoteWheelState {
  center: EmoteWheelPoint;
  origin: EmoteWheelPoint;
  selectedId: RoomEmoteId;
  moved: boolean;
}
const LAST_EMOTE_STORAGE_KEY = 'energy-duel-last-wheel-emote';
const EMOTE_ANIMATION_MS = 1_600;
const EMOTE_LONG_PRESS_DELAY_MS = 320;
const EMOTE_REPEAT_INTERVAL_MS = 180;
const ROOM_NOTICE_VISIBLE_MS = 2_800;
const ROOM_NOTICE_EXIT_MS = 360;
type VisibleRoomNotice = RoomNoticeMessage & { isLeaving: boolean };
const Tutorial = lazy(() => import('./components/Tutorial'));
const GameCanvas = lazy(() => import('./components/GameCanvas'));

export default function GameRoomView(props: Props) {
  return <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#7b89ff', borderRadius: 10 } }}>
    <RoomContent {...props} />
  </ConfigProvider>;
}

function RoomContent({ room, session, onLeave }: Props) {
  const [api, contextHolder] = message.useMessage();
  const [players, setPlayers] = useState<SyncedPlayer[]>([]);
  const [boardObjects, setBoardObjects] = useState<SyncedBoardObject[]>([]);
  const [gameState, setGameState] = useState<SyncedGameState>({ phase: 'waiting', round: 0, gameNumber: 0, hostPlayerId: '', lastResult: '等待玩家准备。', roomMode: 'standard' });
  const [activeActorId, setActiveActorId] = useState<string>();
  const [battleLog, setBattleLog] = useState<SyncedRoundLogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [parameterAction, setParameterAction] = useState<ActionDefinition>();
  const [variablePower, setVariablePower] = useState(1);
  const [flexibleAction, setFlexibleAction] = useState<ActionDefinition>();
  const [resourceSpend, setResourceSpend] = useState<Record<string, number>>({});
  const [controllerGrant, setControllerGrant] = useState<Record<string, number>>({});
  const [sponsorAction, setSponsorAction] = useState<ActionDefinition>();
  const [surchargeAction, setSurchargeAction] = useState<ActionDefinition>();
  const [surchargeResourceId, setSurchargeResourceId] = useState<string>();
  const paymentPrepared = useRef<{ actionId?: string; sponsorReady: boolean; surchargeReady: boolean; grant?: Record<string, number>; surcharge?: Record<string, number> }>({ sponsorReady: false, surchargeReady: false });
  const [deferredPower, setDeferredPower] = useState(1);
  const [deferredSpend, setDeferredSpend] = useState<Record<string, number>>({});
  const [pendingSpend, setPendingSpend] = useState<Record<string, number>>();
  const [resourceChoiceAction, setResourceChoiceAction] = useState<ActionDefinition>();
  const [pendingResourceChoice, setPendingResourceChoice] = useState<'energy' | 'charge'>();
  const [pendingNapoleonStrategy, setPendingNapoleonStrategy] = useState<{ source: 'buffer' | 'command'; command?: NapoleonCommand }>();
  const [gridAction, setGridAction] = useState<{ action: ActionDefinition; targetIds: string[]; pathDirection?: -1 | 1; selectingDirection?: boolean }>();
  const [optionalGridAction, setOptionalGridAction] = useState<ActionDefinition>();
  const [deferredRequest, setDeferredRequest] = useState<DeferredActionRequiredMessage>();
  const [learningRequest, setLearningRequest] = useState<LearningRequiredMessage>();
  const [submittedLabel, setSubmittedLabel] = useState<string>();
  const [submittedPreviews, setSubmittedPreviews] = useState<Record<string, RevealedAction>>({});
  const [inspectedPlayer, setInspectedPlayer] = useState<SyncedPlayer>();
  const [inspectedBoardObjectIds, setInspectedBoardObjectIds] = useState<string[]>([]);
  const [profileViewer, setProfileViewer] = useState<SyncedPlayer>();
  const [profileCache, setProfileCache] = useState<Record<string, PlayerProfile>>({});
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [hovered, setHovered] = useState<{ player: SyncedPlayer; x: number; y: number }>();
  const hoverDismissTimer = useRef<number>();
  const [resetViewKey, setResetViewKey] = useState(0);
  const [networkState, setNetworkState] = useState<'online' | 'reconnecting' | 'offline'>('online');
  const [rtt, setRtt] = useState<number>();
  const [activeStep, setActiveStep] = useState<ResolutionStep>();
  const [battleLoad, setBattleLoad] = useState({ progress: 0, label: '正在准备战场' });
  const [ratingResult, setRatingResult] = useState<GameRatingResultMessage>();
  const [emoteEvents, setEmoteEvents] = useState<RoomEmoteMessage[]>([]);
  const [roomNotices, setRoomNotices] = useState<VisibleRoomNotice[]>([]);
  const [emotePickerOpen, setEmotePickerOpen] = useState(false);
  const [emoteWheel, setEmoteWheel] = useState<EmoteWheelState>();
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(true);
  const [mobileRosterOpen, setMobileRosterOpen] = useState(false);
  const [tutorialRequest, setTutorialRequest] = useState<{ page: GuidePageId; characterId?: string }>();
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(() => {
    try { return JSON.parse(localStorage.getItem('energy-duel-panel-position') ?? 'null'); } catch { return null; }
  });
  const mounted = useRef(true);
  const profileRequests = useRef(new Set<string>());
  const emoteTimers = useRef(new Map<string, number>());
  const emoteLongPressTimer = useRef<number>();
  const emoteRepeatTimer = useRef<number>();
  const emoteLongPressActive = useRef(false);
  const noticeTimers = useRef(new Map<string, number[]>());
  const seenEmoteIds = useRef(new Map<string, number>());
  const pointerPosition = useRef<EmoteWheelPoint>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const emoteWheelRef = useRef<EmoteWheelState>();
  const lastWheelEmoteRef = useRef<RoomEmoteId>(readLastWheelEmote());
  const localPlayerId = players.find((player) => player.accountId === session.accountId)?.playerId ?? room.sessionId;

  const enqueueEmote = useCallback((event: RoomEmoteMessage) => {
    const now = Date.now();
    for (const [eventId, seenAt] of seenEmoteIds.current) if (now - seenAt > 60_000) seenEmoteIds.current.delete(eventId);
    if (seenEmoteIds.current.has(event.eventId)) return;
    seenEmoteIds.current.set(event.eventId, now);
    setEmoteEvents((current) => current.some((candidate) => candidate.eventId === event.eventId) ? current : [...current, event]);
    const timer = window.setTimeout(() => {
      setEmoteEvents((current) => current.filter((candidate) => candidate.eventId !== event.eventId));
      emoteTimers.current.delete(event.eventId);
    }, EMOTE_ANIMATION_MS);
    emoteTimers.current.set(event.eventId, timer);
  }, []);

  const enqueueRoomNotice = useCallback((notice: RoomNoticeMessage) => {
    if (noticeTimers.current.has(notice.eventId)) return;
    setRoomNotices((current) => current.some((candidate) => candidate.eventId === notice.eventId)
      ? current
      : [...current.slice(-3), { ...notice, isLeaving: false }]);
    const exitTimer = window.setTimeout(() => {
      setRoomNotices((current) => current.map((candidate) => candidate.eventId === notice.eventId
        ? { ...candidate, isLeaving: true }
        : candidate));
      const removeTimer = window.setTimeout(() => {
        setRoomNotices((current) => current.filter((candidate) => candidate.eventId !== notice.eventId));
        noticeTimers.current.delete(notice.eventId);
      }, ROOM_NOTICE_EXIT_MS);
      noticeTimers.current.get(notice.eventId)?.push(removeTimer);
    }, ROOM_NOTICE_VISIBLE_MS);
    noticeTimers.current.set(notice.eventId, [exitTimer]);
  }, []);

  useEffect(() => () => {
    for (const timers of noticeTimers.current.values()) {
      for (const timer of timers) window.clearTimeout(timer);
    }
    noticeTimers.current.clear();
  }, []);

  const sendRoomEmote = useCallback((emoteId: RoomEmoteId, rememberWheelSelection: boolean) => {
    const eventId = requestId();
    enqueueEmote({ eventId, playerId: localPlayerId, emoteId, sentAt: Date.now() });
    room.send('send_emote', { requestId: eventId, emoteId });
    if (rememberWheelSelection) {
      lastWheelEmoteRef.current = emoteId;
      localStorage.setItem(LAST_EMOTE_STORAGE_KEY, emoteId);
    }
  }, [enqueueEmote, localPlayerId, room]);

  const stopEmoteBurst = useCallback(() => {
    if (emoteLongPressTimer.current !== undefined) window.clearTimeout(emoteLongPressTimer.current);
    if (emoteRepeatTimer.current !== undefined) window.clearInterval(emoteRepeatTimer.current);
    emoteLongPressTimer.current = undefined;
    emoteRepeatTimer.current = undefined;
  }, []);
  const startEmoteBurst = useCallback((emoteId: RoomEmoteId) => {
    stopEmoteBurst();
    emoteLongPressActive.current = false;
    emoteLongPressTimer.current = window.setTimeout(() => {
      emoteLongPressActive.current = true;
      sendRoomEmote(emoteId, false);
      emoteRepeatTimer.current = window.setInterval(() => sendRoomEmote(emoteId, false), EMOTE_REPEAT_INTERVAL_MS);
    }, EMOTE_LONG_PRESS_DELAY_MS);
  }, [sendRoomEmote, stopEmoteBurst]);
  const updateEmotePickerOpen = useCallback((open: boolean) => {
    if (!open) {
      stopEmoteBurst();
      emoteLongPressActive.current = false;
    }
    setEmotePickerOpen(open);
  }, [stopEmoteBurst]);
  useEffect(() => stopEmoteBurst, [stopEmoteBurst]);

  useEffect(() => {
    mounted.current = true;
    const handleState = (state: DemoRoomState | undefined) => {
      if (!state) return;
      setPlayers(readSyncedPlayers(state.players?.values()));
      setBoardObjects(readSyncedBoardObjects(state.boardObjects?.values()));
      setGameState({ phase: state.phase ?? 'waiting', round: state.round ?? 0, gameNumber: state.gameNumber ?? 0, hostPlayerId: state.hostPlayerId ?? '', lastResult: state.lastResult ?? '', roomMode: state.roomMode ?? 'standard' });
      setBattleLog(Array.from(state.roundLog?.values() ?? [], (entry) => ({ gameNumber: entry.gameNumber, round: entry.round, time: entry.time, text: entry.text })));
    };
    room.onStateChange(handleState);
    handleState(room.state);
    const removeCommand = room.onMessage('command_result', (payload: CommandResultMessage) => {
      if (payload.ok) void api.success({ content: payload.message, duration: 1.4 });
      else void api.error(payload.message);
    });
    const removeError = room.onMessage('game_error', (payload: { message?: string }) => { if (payload.message) void api.error(payload.message); });
    const removeClosed = room.onMessage('room_closed', (payload: { message?: string }) => void api.warning(payload.message ?? '房间已关闭'));
    const removePong = room.onMessage('pong', (payload: { sentAt?: number }) => {
      if (typeof payload.sentAt === 'number') setRtt(Math.max(0, Math.round(performance.now() - payload.sentAt)));
    });
    const removeResolution = room.onMessage('round_resolution', (payload: RoundResolutionMessage) => void playTimeline(payload));
    const removeDeferred = room.onMessage('deferred_action_required', (payload: DeferredActionRequiredMessage) => {
      setDeferredRequest(payload); setActiveActorId(payload.actorPlayerId); setSelectedActionId(payload.actionId); setSelectedTargetIds([]);
      setDeferredPower(payload.minPower ?? payload.power ?? 1); setDeferredSpend({});
      void api.info({ content: `行动已公开：请为「${actionById.get(payload.actionId)?.name ?? payload.actionId}」后发分配目标`, duration: 2 });
    });
    const removeRatingResult = room.onMessage('game_rating_result', (payload: GameRatingResultMessage) => setRatingResult(payload));
    const removeEmote = room.onMessage('room_emote', (payload: RoomEmoteMessage) => {
      if (typeof payload?.eventId !== 'string' || typeof payload.playerId !== 'string' || !isRoomEmoteId(payload.emoteId)) return;
      enqueueEmote(payload);
    });
    const removeLearning = room.onMessage('learning_required', (payload: LearningRequiredMessage) => setLearningRequest(payload));
    const removeNotice = room.onMessage('room_notice', (payload: RoomNoticeMessage) => {
      if (typeof payload?.eventId !== 'string' || typeof payload.nickname !== 'string') return;
      if (!['join', 'leave', 'disconnect', 'reconnect'].includes(payload.type)) return;
      enqueueRoomNotice(payload);
    });
    const handleDrop = () => setNetworkState('reconnecting');
    const handleReconnect = () => { setNetworkState('online'); void api.success({ content: '已重新连接', duration: 1 }); };
    const handleLeave = () => { setNetworkState('offline'); onLeave(); };
    room.onDrop(handleDrop); room.onReconnect(handleReconnect); room.onLeave(handleLeave);
    const pingTimer = window.setInterval(() => { if (room.connection.isOpen) room.send('ping', { sentAt: performance.now() }); }, 5000);
    room.send('ping', { sentAt: performance.now() });
    return () => {
      mounted.current = false; window.clearInterval(pingTimer);
      for (const timer of emoteTimers.current.values()) window.clearTimeout(timer); emoteTimers.current.clear(); seenEmoteIds.current.clear();
      room.onStateChange.remove(handleState); removeCommand(); removeError(); removeClosed(); removePong(); removeResolution(); removeDeferred(); removeLearning(); removeRatingResult(); removeEmote(); removeNotice();
      room.onDrop.remove(handleDrop); room.onReconnect.remove(handleReconnect); room.onLeave.remove(handleLeave);
    };

    async function playTimeline(payload: RoundResolutionMessage) {
      setSelectedActionId(undefined); setSelectedTargetIds([]); setDeferredRequest(undefined); setSubmittedPreviews({});
      for (const step of payload.steps) {
        if (!mounted.current) return;
        setActiveStep(step);
        await delay(step.durationMs);
      }
      if (mounted.current) setActiveStep(undefined);
    }
  }, [api, enqueueEmote, enqueueRoomNotice, onLeave, room]);

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarsePointer(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const emoteIds = roomEmotes.map((emote) => emote.id);
    const updateWheel = (next: EmoteWheelState | undefined) => {
      emoteWheelRef.current = next;
      setEmoteWheel(next);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const pointer = { x: event.clientX, y: event.clientY };
      pointerPosition.current = pointer;
      const current = emoteWheelRef.current;
      if (!current || (!current.moved && !movedBeyondEmoteThreshold(current.origin, pointer))) return;
      updateWheel({
        ...current,
        selectedId: emoteWheelSelection(current.center, pointer, emoteIds) ?? current.selectedId,
        moved: true,
      });
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyV' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target) || emoteWheelRef.current) return;
      event.preventDefault();
      const origin = pointerPosition.current;
      updateWheel({
        center: clampEmoteWheelCenter(origin, window.innerWidth, window.innerHeight),
        origin,
        selectedId: lastWheelEmoteRef.current,
        moved: false,
      });
      setEmotePickerOpen(false);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const current = emoteWheelRef.current;
      if (event.code !== 'KeyV' || !current) return;
      event.preventDefault();
      const selectedId = current.moved ? current.selectedId : lastWheelEmoteRef.current;
      updateWheel(undefined);
      sendRoomEmote(selectedId, current.moved);
    };
    const cancelWheel = () => updateWheel(undefined);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', cancelWheel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', cancelWheel);
      emoteWheelRef.current = undefined;
    };
  }, [sendRoomEmote]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const update = () => setCompactLayout(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    updateEmotePickerOpen(false);
  }, [compactLayout, updateEmotePickerOpen]);
  useEffect(() => {
    if (gameState.phase !== 'deferred') {
      setSelectedActionId(undefined); setSelectedTargetIds([]); setDeferredRequest(undefined);
    }
    setSubmittedLabel(undefined); setParameterAction(undefined); setFlexibleAction(undefined); setPendingSpend(undefined); setGridAction(undefined); setOptionalGridAction(undefined);
    if (gameState.phase === 'choosing' || !['choosing', 'deferred'].includes(gameState.phase)) setSubmittedPreviews({});
    if (gameState.phase === 'choosing' && gameState.round === 1) setRatingResult(undefined);
  }, [gameState.phase, gameState.round]);
  useEffect(() => {
    if (panelPosition) localStorage.setItem('energy-duel-panel-position', JSON.stringify(panelPosition));
  }, [panelPosition]);

  const me = players.find((player) => player.accountId === session.accountId);
  const isHost = me?.playerId === gameState.hostPlayerId;
  const controlledActors = useMemo(() => me ? players.filter((player) => player.controllerPlayerId === me.playerId) : [], [me, players]);
  const activeActor = controlledActors.find((player) => player.playerId === activeActorId) ?? controlledActors[0] ?? me;
  const canSponsorActiveActor = canSponsorControlledActor(me, activeActor);
  const selectedAction = selectedActionId ? actionById.get(selectedActionId) : undefined;
  const targeting = Boolean(deferredRequest || (selectedAction && ['single_enemy', 'multiple_enemies'].includes(selectedAction.target.mode) && !activeActor?.submitted));
  const validTargets = useMemo(() => players.filter((player) => player.alive && player.playerId !== activeActor?.playerId && !player.buffs.some((buff) => buff.buffId === 'sleeping')), [players, activeActor?.playerId]);
  const targetableBoardObjectIds = useMemo(() => !deferredRequest && selectedAction?.category === 'attack' && selectedAction.target.mode === 'single_enemy'
    ? boardObjects.filter((object) => object.definitionId === 'lotus_seat' && object.currentHp > 0).map((object) => object.objectId) : [], [boardObjects, deferredRequest, selectedAction]);
  const darknessActive = activeActor?.buffs.some((buff) => buff.buffId === 'darkness') === true;

  useEffect(() => {
    if (compactLayout && (targeting || gridAction || deferredRequest)) setMobilePanelOpen(false);
  }, [compactLayout, deferredRequest, gridAction, targeting]);
  const battleLogGroups = useMemo(() => groupBattleLog(battleLog), [battleLog]);
  const variableMax = parameterAction?.variable
    ? Math.max(parameterAction.variable.minPower, Math.min(
      parameterAction.variable.maxPower ?? Number.MAX_SAFE_INTEGER,
      Math.floor(((activeActor?.resources[parameterAction.variable.resourceId]?.current ?? 0) + 1e-6) / parameterAction.variable.costPerPower),
    ))
    : 1;

  const submit = (action: ActionDefinition, targetIds: string[] = [], transformCharacterId?: string, power?: number, targetGridIndex?: number, spend?: Record<string, number>, resourceChoiceOverride?: 'energy' | 'charge' | null, napoleonStrategyOverride?: { source: 'buffer' | 'command'; command?: NapoleonCommand } | null, targetBoardObjectId?: string, pathDirection?: -1 | 1) => {
    const resourceChoice = resourceChoiceOverride === undefined ? pendingResourceChoice : resourceChoiceOverride ?? undefined;
    const napoleonStrategy = napoleonStrategyOverride === undefined ? pendingNapoleonStrategy : napoleonStrategyOverride ?? undefined;
    const targetNames = targetIds.map((id) => players.find((player) => player.playerId === id)?.nickname ?? id);
    const label = transformCharacterId
      ? `已选择变身：${characterById.get(transformCharacterId)?.name ?? transformCharacterId}`
      : `已选择「${action.name}」${power === undefined ? '' : `（n=${power}）`}${targetNames.length ? ` → ${targetNames.join('、')}` : targetBoardObjectId ? ' → 托生莲座' : ''}`;
    setSubmittedLabel(label);
    if (activeActor) {
      setSubmittedPreviews((current) => ({
        ...current,
        [activeActor.playerId]: {
          playerId: activeActor.playerId,
          actionId: action.id,
          power,
          targetIds,
          targetGridIndex,
          pathDirection,
          targetBoardObjectId,
          transformCharacterId,
        },
      }));
    }
    room.send('submit_action', {
      actorPlayerId: activeActor?.playerId,
      requestId: requestId(), actionId: action.id,
      targetId: action.target.mode === 'single_enemy' ? targetIds[0] : undefined,
      targetIds: action.target.mode === 'multiple_enemies' && targetIds.length > 0 ? targetIds : undefined,
      transformCharacterId, power, targetGridIndex, pathDirection, targetBoardObjectId, resourceSpend: spend, resourceChoice,
      extraResourceSpend: paymentPrepared.current.surcharge,
      controllerResourceGrant: paymentPrepared.current.grant,
      napoleonStrategySource: napoleonStrategy?.source, napoleonCommand: napoleonStrategy?.command,
    });
    setPendingResourceChoice(undefined);
    setPendingNapoleonStrategy(undefined);
    setGridAction(undefined);
    setPendingSpend(undefined);
    paymentPrepared.current = { sponsorReady: false, surchargeReady: false };
    void api.info({ content: label, duration: 1.6 });
  };

  const chooseAction = (action: ActionDefinition) => {
    setGridAction(undefined); setPendingSpend(undefined);
    if (paymentPrepared.current.actionId !== action.id) paymentPrepared.current = { actionId: action.id, sponsorReady: false, surchargeReady: false };
    if (canSponsorActiveActor && !paymentPrepared.current.sponsorReady) { setControllerGrant({}); setSponsorAction(action); return; }
    if (activeActor?.buffs.some((buff) => buff.buffId === 'hellwalker') && action.category === 'attack' && !paymentPrepared.current.surchargeReady) { setSurchargeResourceId(undefined); setSurchargeAction(action); return; }
    const hasDevourHeaven = activeActor?.characterId === 'ye_qingxian'
      && (characterById.get(activeActor.characterId)?.passiveIds?.includes('devour_heaven')
        || activeActor.learnedPassiveIds.includes('devour_heaven'));
    if (hasDevourHeaven && action.id !== 'transform') {
      setSelectedActionId(action.id); setSelectedTargetIds([]); setResourceChoiceAction(action); return;
    }
    if (action.napoleonSequence) {
      if (canExecuteNapoleonStrategy(activeActor?.commandBuffer ?? '', action.napoleonSequence)) {
        continueChooseAction(action, undefined, { source: 'buffer' });
        return;
      }
      const command = action.napoleonSequence.at(-1) as NapoleonCommand;
      if (napoleonStrategyFromCommand(activeActor?.commandBuffer ?? '', command)?.id === action.id) {
        continueChooseAction(action, undefined, { source: 'command', command });
      }
      return;
    }
    setPendingResourceChoice(undefined); setPendingNapoleonStrategy(undefined); continueChooseAction(action, null, null);
  };

  const continueChooseAction = (action: ActionDefinition, resourceChoice?: 'energy' | 'charge' | null, napoleonStrategy?: { source: 'buffer' | 'command'; command?: NapoleonCommand } | null) => {
    setSelectedActionId(action.id); setSelectedTargetIds([]);
    setPendingNapoleonStrategy(napoleonStrategy ?? undefined);
    const deferred = action.target.selectionTiming === 'deferred'
      || (['steal', 'absorb_charge'].includes(action.id) && activeActor?.characterId === 'ao' && (activeActor.buffs.find((buff) => buff.buffId === 'ao_mastery')?.stacks ?? 0) >= 2);
    if (action.anyResourceCost) { setResourceSpend({}); setFlexibleAction(action); return; }
    if (action.variable) {
      if (action.usesAllVariableResource) {
        const current = activeActor?.resources[action.variable.resourceId]?.current ?? 0;
        submit(action, [], undefined, Math.floor((current + 1e-6) / action.variable.costPerPower), undefined, undefined, resourceChoice, napoleonStrategy);
        return;
      }
      setVariablePower(action.variable.minPower);
      setParameterAction(action);
      return;
    }
    if (deferred) { submit(action, [], undefined, undefined, undefined, undefined, resourceChoice, napoleonStrategy); return; }
    if (action.optionalGridTarget && boardObjects.some((object) => object.definitionId === 'nilu_fire')) { setOptionalGridAction(action); return; }
    if (action.targetsGridCell) { setGridAction({ action, targetIds: [] }); return; }
    if (action.target.mode === 'single_enemy' || action.target.mode === 'multiple_enemies') {
      void api.open({ type: 'info', content: action.target.mode === 'multiple_enemies' ? `请选择 ${action.target.maxTargets} 次目标` : '请在战场上选择目标', duration: 1.5 });
    } else submit(action, [], undefined, undefined, undefined, undefined, resourceChoice, napoleonStrategy);
  };

  const chooseTarget = (player: SyncedPlayer) => {
    if (deferredRequest) {
      if (selectedTargetIds.length >= deferredRequest.allocationCount) { void api.info({ content: '分配次数已满，请确认提交或撤销后重选', duration: 1.2 }); return; }
      const next = [...selectedTargetIds, player.playerId];
      setSelectedTargetIds(next);
      void api.info({ content: `已分配 ${next.length}/${deferredRequest.allocationCount}${next.length === deferredRequest.allocationCount ? '，请确认提交' : ''}`, duration: 1.1 });
      return;
    }
    if (!selectedAction) return;
    const next = [...selectedTargetIds, player.playerId];
    setSelectedTargetIds(next);
    if (selectedAction.id === 'dream_path') { setGridAction({ action: selectedAction, targetIds: next, selectingDirection: true }); return; }
    if (selectedAction.target.mode === 'single_enemy' || next.length >= (selectedAction.target.maxTargets ?? 1)) { submit(selectedAction, next, undefined, undefined, undefined, pendingSpend); setPendingSpend(undefined); }
    else void api.info({ content: `已选择 ${player.nickname}，还需选择 ${(selectedAction.target.maxTargets ?? 1) - next.length} 次`, duration: 1.2 });
  };

  const chooseBoardObjectTarget = (object: SyncedBoardObject) => {
    if (!selectedAction || !targetableBoardObjectIds.includes(object.objectId)) return;
    submit(selectedAction, [], undefined, undefined, undefined, pendingSpend, undefined, undefined, object.objectId);
    setPendingSpend(undefined);
  };

  const confirmVariableAction = () => {
    if (!parameterAction) return;
    submit(parameterAction, [], undefined, variablePower);
    setParameterAction(undefined);
  };

  const confirmDeferredTargets = () => {
    if (!deferredRequest || selectedTargetIds.length !== deferredRequest.allocationCount) return;
    const spend = deferredRequest.flexibleResourceIds ? Object.fromEntries(Object.entries(deferredSpend).filter(([, amount]) => amount > 0)) : undefined;
    room.send('submit_deferred_targets', { requestId: requestId(), actorPlayerId: deferredRequest.actorPlayerId, targetIds: selectedTargetIds, power: deferredRequest.flexibleResourceIds ? deferredPower : undefined, resourceSpend: spend });
    setSubmittedLabel(`后发目标已分配：${formatTargetAllocation(selectedTargetIds, players)}`);
    setSubmittedPreviews((current) => ({
      ...current,
      [deferredRequest.actorPlayerId]: {
        playerId: deferredRequest.actorPlayerId,
        actionId: deferredRequest.actionId,
        power: deferredRequest.flexibleResourceIds ? deferredPower : deferredRequest.power,
        targetIds: selectedTargetIds,
      },
    }));
    setDeferredRequest(undefined); setSelectedTargetIds([]);
  };

  const flexibleRequired = flexibleAction?.anyResourceCost
    ? Math.max(1, flexibleAction.anyResourceCost - (activeActor?.buffs.find((buff) => buff.buffId === 'ao_mastery')?.stacks ?? 0)) : 0;
  const flexibleSelected = Object.values(resourceSpend).reduce((sum, amount) => sum + amount, 0);
  const controllerGrantSelected = Object.values(controllerGrant).reduce((sum, amount) => sum + amount, 0);
  const deferredSelected = Object.values(deferredSpend).reduce((sum, amount) => sum + amount, 0);
  const confirmFlexibleAction = () => {
    if (!flexibleAction) return;
    const spend = Object.fromEntries(Object.entries(resourceSpend).filter(([, amount]) => amount > 0));
    setFlexibleAction(undefined);
    if (flexibleAction.target.mode === 'single_enemy') { setPendingSpend(spend); void api.info({ content: '请选择凹凹神功的目标', duration: 1.3 }); }
    else submit(flexibleAction, [], undefined, undefined, undefined, spend);
  };

  const adjacentDestinations = activeActor ? [
    (activeActor.gridIndex - 1 + players.length * 2) % (players.length * 2),
    (activeActor.gridIndex + 1) % (players.length * 2),
  ] : [];
  const dreamPathTarget = gridAction?.action.id === 'dream_path' ? players.find((player) => player.playerId === gridAction.targetIds[0]) : undefined;
  const gridDestinations = gridAction?.action.id === 'dream_path'
    ? gridAction.selectingDirection
      ? adjacentDestinations
      : activeActor && dreamPathTarget && gridAction.pathDirection
        ? circularPathCells(activeActor.gridIndex, dreamPathTarget.gridIndex, players.length * 2, gridAction.pathDirection)
        : []
    : gridAction?.action.id === 'heal'
    ? boardObjects.filter((object) => object.definitionId === 'nilu_fire').map((object) => object.gridIndex)
    : gridAction?.action.id === 'breathing_method'
      ? Array.from({ length: players.length * 2 }, (_, cell) => cell).filter((cell) =>
        !players.some((player) => player.alive && player.gridIndex === cell)
        && !boardObjects.some((object) => object.kind === 'summon' && object.currentHp > 0 && object.gridIndex === cell))
    : gridAction?.action.id === 'three_bodies'
      ? activeActor ? [(activeActor.gridIndex - 1 + players.length * 2) % (players.length * 2), (activeActor.gridIndex + 1) % (players.length * 2)] : []
    : gridAction?.action.id === 'rule_the_world'
    ? Array.from({ length: players.length * 2 }, (_, cell) => cell)
    : gridAction?.action.id === 'quick_attack' && players.length >= 3
      ? Array.from({ length: players.length * 2 }, (_, cell) => cell)
        .filter((cell) => cell !== activeActor?.gridIndex)
    : adjacentDestinations;
  const chooseGridDestination = (cell: number | undefined) => {
    if (!gridAction) return;
    if (gridAction.action.id === 'dream_path' && gridAction.selectingDirection && activeActor && cell !== undefined) {
      const direction: -1 | 1 = cell === (activeActor.gridIndex + 1) % (players.length * 2) ? 1 : -1;
      setGridAction({ ...gridAction, pathDirection: direction, selectingDirection: false });
      return;
    }
    submit(gridAction.action, gridAction.targetIds, undefined, undefined, cell, pendingSpend, undefined, undefined, undefined, gridAction.pathDirection);
    setGridAction(undefined); setPendingSpend(undefined);
  };

  const chooseTransform = (characterId: string) => {
    const action = actionById.get('transform');
    if (action) { setSelectedActionId(action.id); submit(action, [], characterId); }
  };

  const sendReady = () => {
    void api.info({ content: me?.ready ? '正在取消准备…' : '正在准备…', duration: 0.8 });
    room.send('set_ready', { requestId: requestId(), ready: !me?.ready });
  };
  const leave = async () => { await room.leave(); onLeave(); };
  const requestPlayerProfile = (player: SyncedPlayer) => {
    if (player.isTrainingDummy || profileCache[player.accountId] || profileRequests.current.has(player.accountId)) return;
    profileRequests.current.add(player.accountId);
    setProfileErrors((current) => ({ ...current, [player.accountId]: '' }));
    void fetchPlayerProfile(session, player.accountId).then((profile) => {
      if (mounted.current) setProfileCache((current) => ({ ...current, [player.accountId]: profile }));
    }).catch((reason) => {
      if (mounted.current) setProfileErrors((current) => ({ ...current, [player.accountId]: reason instanceof Error ? reason.message : '无法读取玩家资料' }));
    }).finally(() => profileRequests.current.delete(player.accountId));
  };
  const inspectPlayer = (player: SyncedPlayer) => { setInspectedPlayer(player); requestPlayerProfile(player); };
  const viewPlayerProfile = (player: SyncedPlayer) => { if (player.isTrainingDummy) return inspectPlayer(player); setProfileViewer(player); requestPlayerProfile(player); };
  const beginPanelDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(max-width: 900px)').matches) return;
    const panel = event.currentTarget.parentElement;
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    const offsetX = event.clientX - bounds.left; const offsetY = event.clientY - bounds.top;
    const move = (pointer: PointerEvent) => setPanelPosition({ x: Math.max(8, Math.min(window.innerWidth - bounds.width - 8, pointer.clientX - offsetX)), y: Math.max(76, Math.min(window.innerHeight - bounds.height - 8, pointer.clientY - offsetY)) });
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); event.preventDefault();
  };
  const roster = <Roster players={players} gameState={gameState} viewer={activeActor} onInspect={viewPlayerProfile} />;
  const targetHint = deferredRequest
    ? selectedTargetIds.length === deferredRequest.allocationCount
      ? `后发分配完成 ${selectedTargetIds.length}/${deferredRequest.allocationCount}，请在面板确认提交`
      : `后发分配 ${selectedTargetIds.length}/${deferredRequest.allocationCount}（可重复点击同一目标）`
    : gridAction?.action.id === 'dream_path' && gridAction.selectingDirection ? '点击相邻地块选择梦径方向'
      : gridAction?.action.id === 'dream_path' ? '点击梦径上的任意地块选择落点'
      : gridAction ? '点击地图上绿色高亮的编号地块'
      : targeting ? (selectedAction?.target.mode === 'multiple_enemies' ? `选择目标 ${selectedTargetIds.length}/${selectedAction.target.maxTargets}` : targetableBoardObjectIds.length ? '点击高亮角色或托生莲座选择目标' : '点击高亮角色选择目标') : undefined;
  const actionPreviews: RevealedAction[] = deferredRequest
    ? deferredRequest.revealedActions.map((preview) => preview.playerId === deferredRequest.actorPlayerId
      ? { ...preview, targetIds: selectedTargetIds }
      : preview)
    : Array.from(new Map<string, RevealedAction>([
      ...Object.values(submittedPreviews),
      ...(selectedAction && selectedTargetIds.length > 0 && !activeActor?.submitted
        ? [{ playerId: activeActor?.playerId ?? '', actionId: selectedAction.id, targetIds: selectedTargetIds }]
        : []),
      ...(gridAction && activeActor
        ? [{
          playerId: activeActor.playerId,
          actionId: gridAction.action.id,
          targetIds: gridAction.targetIds,
          pathDirection: gridAction.pathDirection,
        }]
        : []),
    ].filter((preview) => preview.playerId).map((preview) => [preview.playerId, preview])).values());

  return <main className="game-shell">
    {contextHolder}
    {emoteWheel && <EmoteWheel state={emoteWheel} />}
    <header className="game-header">
      <div><p className="eyebrow">CIRCULAR GRID</p><h1>{phaseTitle(gameState)}</h1></div>
      <div className="game-actions desktop-game-actions"><span className="room-id">房间 {room.roomId}</span><Button size="small" onClick={() => { void navigator.clipboard?.writeText(room.roomId); void api.success('房间号已复制'); }}>复制</Button><Button size="small" onClick={() => setResetViewKey((value) => value + 1)}>重置视角</Button><Button size="small" onClick={() => setLogOpen(true)}>日志</Button><AnnouncementLauncher compact /><Button size="small" onClick={() => setTutorialRequest({ page: 'start' })}>教程</Button><Tag color={networkState === 'online' ? 'success' : networkState === 'reconnecting' ? 'warning' : 'error'}>{networkState === 'online' ? `在线${rtt === undefined ? '' : ` · ${rtt}ms`}` : networkState === 'reconnecting' ? '重连中' : '离线'}</Tag><span>{players.length}/20</span><Button size="small" danger onClick={() => void leave()}>离开</Button></div>
      <div className="mobile-game-header-actions"><button className="mobile-room-code" type="button" onClick={() => { void navigator.clipboard?.writeText(room.roomId); void api.success('房间号已复制'); }}>#{room.roomId}</button><span className={`mobile-network-state ${networkState}`}>{networkState === 'online' ? '在线' : networkState === 'reconnecting' ? '重连' : '离线'}</span><Button size="small" danger onClick={() => void leave()}>离开</Button></div>
    </header>
    {roomNotices.length > 0 && <div className="room-notice-stack">{roomNotices.map((notice) => <div key={notice.eventId} className={`room-notice ${notice.type}${notice.isLeaving ? ' is-leaving' : ''}`}>{roomNoticeText(notice)}</div>)}</div>}
    {networkState === 'reconnecting' && <div className="reconnecting-banner">连接中断，正在保留席位并自动重连…</div>}
    {submittedLabel && activeActor?.submitted && <div className="selection-toast">{activeActor.nickname}：{submittedLabel}</div>}
    {activeStep && <div className="timeline-chip">动作 {activeStep.sequence + 1} · 速度 {activeStep.speedPriority} · {activeStep.actors.map((actor) => actionById.get(actor.actionId)?.name ?? actor.actionId).join(' + ')}</div>}

    <section className="battlefield-region">
      <Suspense fallback={<div className="battle-load-overlay"><div><strong>正在加载绘图引擎</strong><div className="loading-track"><span style={{ width: '35%' }} /></div><small>战斗面板已就绪</small></div></div>}>
        <GameCanvas players={players} phase={gameState.phase} boardObjects={boardObjects} emoteEvents={emoteEvents} targeting={targeting} targetablePlayerIds={validTargets.map((player) => player.playerId)} targetableBoardObjectIds={targetableBoardObjectIds} selectedTargetIds={selectedTargetIds} gridTargeting={Boolean(gridAction)} targetableGridIndices={gridDestinations} actionPreviews={actionPreviews} onGridSelect={chooseGridDestination} obscuredPlayerIds={darknessActive ? players.filter((player) => player.gridIndex !== activeActor?.gridIndex).map((player) => player.playerId) : []} resetViewKey={resetViewKey} resolutionStep={activeStep} onLoadProgress={(progress, label) => setBattleLoad({ progress, label })} onPlayerSelect={chooseTarget} onBoardObjectSelect={chooseBoardObjectTarget} onPlayerInspect={(player) => { if (!darknessActive || player.gridIndex === activeActor?.gridIndex) inspectPlayer(player); }} onPlayerHover={(player, point) => { window.clearTimeout(hoverDismissTimer.current); if (coarsePointer || !player || !point || (darknessActive && player.gridIndex !== activeActor?.gridIndex)) hoverDismissTimer.current = window.setTimeout(() => setHovered(undefined), 120); else setHovered({ player, x: point.x, y: point.y }); }} onBoardObjectInspect={(objects) => { setHovered(undefined); setInspectedBoardObjectIds(objects.map((object) => object.objectId)); }} />
      </Suspense>
      {battleLoad.progress < 100 && <div className="battle-load-overlay"><div><strong>{battleLoad.label}</strong><div className="loading-track"><span style={{ width: `${battleLoad.progress}%` }} /></div><small>{battleLoad.progress}%</small></div></div>}
      {targetHint && <div className="targeting-hint">{targetHint}</div>}
    </section>
    <aside className="roster desktop-roster">{roster}</aside>
    <section className={`game-control-panel${mobilePanelOpen ? ' mobile-open' : ' mobile-closed'}`} style={panelPosition ? { left: panelPosition.x, top: panelPosition.y, right: 'auto', bottom: 'auto' } : undefined}>
      <button className="mobile-control-sheet-handle" type="button" aria-expanded={mobilePanelOpen} onClick={() => setMobilePanelOpen((open) => !open)}><span aria-hidden="true" /><strong>{mobilePanelOpen ? '收起操作面板' : selectedAction ? `已选：${selectedAction.name}` : phaseTitle(gameState)}</strong><small>{mobilePanelOpen ? '向下收起' : '展开'}</small></button>
      <div className="control-panel-drag-handle" onPointerDown={beginPanelDrag}><span>拖动操作面板</span><div className="control-panel-header-actions" onPointerDown={(event) => event.stopPropagation()}>{!compactLayout && <Popover open={emotePickerOpen} onOpenChange={updateEmotePickerOpen} trigger="click" placement="topRight" content={<EmotePicker onSelect={(emoteId) => { sendRoomEmote(emoteId, false); updateEmotePickerOpen(false); }} />}><Button size="small" className="emote-trigger" aria-label="发表情" title="发表情">☺</Button></Popover>}{panelPosition && <Button size="small" type="text" onClick={() => { setPanelPosition(null); localStorage.removeItem('energy-duel-panel-position'); }}>复位</Button>}</div></div>
      <div className="round-result">{darknessActive ? <p>黑暗笼罩战场，无法获知其他地块的状态变化。</p> : gameState.lastResult.split('\n').map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div>
      {gameState.roomMode === 'training' && gameState.phase === 'waiting' && <TrainingSetup actors={controlledActors} room={room} />}
      {gameState.phase === 'waiting' && <div className="ready-controls">{gameState.roomMode === 'standard' && <Button type={me?.ready ? 'default' : 'primary'} onClick={sendReady}>{me?.ready ? '取消准备' : '准备'}</Button>}{isHost ? <Button type="primary" onClick={() => room.send('start_game', { requestId: requestId() })} disabled={players.length < 2 || (gameState.roomMode === 'standard' && players.some((player) => !player.ready || !player.connected))}>{gameState.roomMode === 'training' ? '开始练习' : '开始游戏'}</Button> : <p className="muted compact-copy">等待房主开始</p>}</div>}
      {gameState.phase === 'choosing' && controlledActors.length > 1 && <div className="actor-switcher"><span>当前操控</span>{controlledActors.map((actor) => <Button key={actor.playerId} size="small" type={actor.playerId === activeActor?.playerId ? 'primary' : 'default'} disabled={!actor.alive} onClick={() => { setActiveActorId(actor.playerId); setSelectedActionId(undefined); setSelectedTargetIds([]); setGridAction(undefined); setPendingSpend(undefined); setSubmittedLabel(undefined); }}>{actor.nickname}{actor.submitted ? ' ✓' : ''}</Button>)}</div>}
      {gameState.phase === 'choosing' && activeActor?.alive && <ActionPanel player={activeActor} resourceSponsor={canSponsorActiveActor ? me : undefined} selectedActionId={selectedActionId} submittedLabel={submittedLabel} roomMode={gameState.roomMode} onSelect={chooseAction} onTransform={chooseTransform} onCancel={() => { room.send('cancel_action', { requestId: requestId(), actorPlayerId: activeActor.playerId }); setSelectedActionId(undefined); setSelectedTargetIds([]); setGridAction(undefined); setPendingSpend(undefined); setSubmittedLabel(undefined); setSubmittedPreviews((current) => { const next = { ...current }; delete next[activeActor.playerId]; return next; }); }} />}
      {gameState.phase === 'deferred' && deferredRequest && <div className="deferred-controls"><strong>{actionById.get(deferredRequest.actionId)?.name ?? deferredRequest.actionId} · 后发选择</strong><p>所有行动已经公开。点击战场角色选择 {deferredRequest.allocationCount} 次目标{deferredRequest.allocationCount > 1 ? '，可重复点击同一目标' : ''}，完成后确认提交。</p><div className="revealed-action-list">{deferredRequest.revealedActions.map((revealed) => { const player = players.find((candidate) => candidate.playerId === revealed.playerId); return <Tag key={revealed.playerId}>{player?.nickname ?? revealed.playerId}：{actionById.get(revealed.actionId)?.name ?? revealed.actionId}{revealed.power === undefined ? '' : ` n=${revealed.power}`}{describeRevealedSelection(revealed, players, boardObjects)}</Tag>; })}</div>{deferredRequest.flexibleResourceIds && <div className="deferred-payment"><p>度神决 X：<InputNumber min={deferredRequest.minPower ?? 1} max={deferredRequest.maxPower ?? 1} precision={0} value={deferredPower} onChange={(value) => setDeferredPower(Math.trunc(value ?? 1))} />（已支付 {deferredSelected}/{deferredPower}）</p>{deferredRequest.flexibleResourceIds.map((resourceId) => { const current = activeActor?.resources[resourceId]?.current ?? 0; return <div className="resource-payment-row" key={resourceId}><span>{resourceById.get(resourceId)?.name ?? resourceId}（持有 {formatNumber(current)}）</span><InputNumber min={0} max={Math.floor(current)} precision={0} value={deferredSpend[resourceId] ?? 0} onChange={(value) => setDeferredSpend((existing) => ({ ...existing, [resourceId]: Math.max(0, Math.trunc(value ?? 0)) }))} /></div>; })}</div>}<p className="deferred-allocation-summary">当前分配：{selectedTargetIds.length ? formatTargetAllocation(selectedTargetIds, players) : '尚未选择'}（{selectedTargetIds.length}/{deferredRequest.allocationCount}）</p><div className="deferred-selection-actions"><Button disabled={selectedTargetIds.length === 0} onClick={() => setSelectedTargetIds((current) => current.slice(0, -1))}>撤销上一次</Button><Button disabled={selectedTargetIds.length === 0} onClick={() => setSelectedTargetIds([])}>清空重选</Button><Button type="primary" disabled={selectedTargetIds.length !== deferredRequest.allocationCount || Boolean(deferredRequest.flexibleResourceIds && deferredSelected !== deferredPower)} onClick={confirmDeferredTargets}>确认提交</Button>{deferredRequest.allowSkip && <Button disabled={selectedTargetIds.length > 0} onClick={() => { room.send('submit_deferred_targets', { requestId: requestId(), actorPlayerId: deferredRequest.actorPlayerId, targetIds: [] }); setDeferredRequest(undefined); setSubmittedLabel('已保留鬼影冲刺至下一回合'); }}>本回合不冲刺</Button>}</div></div>}
      {gameState.phase === 'deferred' && !deferredRequest && <p className="resolving-notice">行动已经公开，等待后发玩家选择目标…</p>}
      {gameState.phase === 'learning' && <p className="resolving-notice">等待叶倾仙选择吞天学习，或放弃本次学习…</p>}
      {gameState.phase === 'resolving' && <p className="resolving-notice">正在播放本回合结算…</p>}
      {gameState.phase === 'choosing' && me && !me.alive && <p className="eliminated-notice">你已淘汰，正在观战</p>}
      {gameState.phase === 'finished' && <p className="finished-hint">{me?.resultConfirmed ? '你已确认，等待其他玩家。' : '请确认本局结算。'}</p>}
    </section>
    <nav className="mobile-battle-dock" aria-label="战斗快捷操作">
      <button type="button" onClick={() => setMobileRosterOpen(true)}><span aria-hidden="true">●</span><small>玩家</small><b>{players.length}</b></button>
      <button type="button" onClick={() => setResetViewKey((value) => value + 1)}><span aria-hidden="true">↻</span><small>视角</small></button>
      <button className={mobilePanelOpen ? 'active' : ''} type="button" aria-expanded={mobilePanelOpen} onClick={() => setMobilePanelOpen((open) => !open)}><span aria-hidden="true">◆</span><small>行动</small>{selectedAction && !activeActor?.submitted && <b>1</b>}</button>
      <button type="button" onClick={() => setLogOpen(true)}><span aria-hidden="true">≡</span><small>日志</small></button>
      {compactLayout && <Popover open={emotePickerOpen} onOpenChange={updateEmotePickerOpen} trigger="click" placement="topRight" content={<EmotePicker onSelect={(emoteId) => { if (emoteLongPressActive.current) { updateEmotePickerOpen(false); return; } sendRoomEmote(emoteId, false); updateEmotePickerOpen(false); }} onPressStart={startEmoteBurst} onPressEnd={stopEmoteBurst} />}><button type="button"><span aria-hidden="true">☺</span><small>表情</small></button></Popover>}
    </nav>
    <Drawer className="mobile-roster-drawer" title={`玩家（${players.length}）`} placement="left" width="min(360px, 88vw)" open={mobileRosterOpen} onClose={() => setMobileRosterOpen(false)}>{roster}</Drawer>
    <Drawer title="角色详情" placement="bottom" height="min(82dvh, 720px)" open={Boolean(inspectedPlayer)} onClose={() => setInspectedPlayer(undefined)}>{inspectedPlayer && <><PlayerDetails player={players.find((player) => player.playerId === inspectedPlayer.playerId) ?? inspectedPlayer} profile={profileCache[inspectedPlayer.accountId]} showPortrait onOpenGuide={(characterId) => { setInspectedPlayer(undefined); setTutorialRequest({ page: 'characters', characterId }); }} />{!inspectedPlayer.isTrainingDummy && !profileCache[inspectedPlayer.accountId] && <p className={profileErrors[inspectedPlayer.accountId] ? 'error' : 'muted'}>{profileErrors[inspectedPlayer.accountId] || '正在读取基础个人资料…'}</p>}</>}</Drawer>
    <Modal title={inspectedBoardObjectIds.length > 1 ? '地块上的全部效果' : '棋盘对象详情'} footer={null} open={inspectedBoardObjectIds.length > 0} onCancel={() => setInspectedBoardObjectIds([])} destroyOnHidden><div className="board-object-details-list">{inspectedBoardObjectIds.map((objectId) => boardObjects.find((object) => object.objectId === objectId)).filter((object): object is SyncedBoardObject => Boolean(object)).map((object) => <BoardObjectDetails key={object.objectId} object={object} owner={players.find((player) => player.playerId === object.ownerPlayerId)} />)}</div></Modal>
    <Modal title="选择治疗方式" open={Boolean(optionalGridAction)} onCancel={() => setOptionalGridAction(undefined)} footer={[<Button key="self" onClick={() => { const action = optionalGridAction; setOptionalGridAction(undefined); if (action) submit(action); }}>治疗自己</Button>, <Button key="fire" type="primary" onClick={() => { const action = optionalGridAction; setOptionalGridAction(undefined); if (action) setGridAction({ action, targetIds: [] }); }}>熄灭尼卢火</Button>]}><p>你可以正常恢复一个健康状态，或选择场上的一团尼卢火将其熄灭。</p></Modal>
    <Modal className="public-profile-modal" title="玩家详细资料" width="min(960px, calc(100vw - 24px))" footer={null} open={Boolean(profileViewer)} onCancel={() => setProfileViewer(undefined)} destroyOnHidden>{profileViewer && (profileCache[profileViewer.accountId] ? <PublicProfileDetails profile={profileCache[profileViewer.accountId]} /> : <div className={profileErrors[profileViewer.accountId] ? 'profile-load-error error' : 'profile-loading'}>{profileErrors[profileViewer.accountId] || '正在读取玩家资料…'}</div>)}</Modal>
    {compactLayout ? <Drawer title="战斗日志" placement="right" width="min(440px, 92vw)" open={logOpen} onClose={() => setLogOpen(false)}><BattleLog groups={battleLogGroups} /></Drawer> : logOpen && <FloatingWindow storageId="battle-log" title="战斗日志" initialPosition={{ x: Math.max(20, window.innerWidth - 500), y: 92 }} initialSize={{ width: 440, height: 520 }} onClose={() => setLogOpen(false)} className="battle-log-window"><BattleLog groups={battleLogGroups} /></FloatingWindow>}
    <Modal title="本局结算" open={gameState.phase === 'finished' && Boolean(me) && !me?.resultConfirmed} closable={false} maskClosable={false} okText="确认结算" cancelButtonProps={{ style: { display: 'none' } }} onOk={() => room.send('acknowledge_result', { requestId: requestId() })}><div className="result-summary">{gameState.lastResult.split('\n').map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div>{ratingResult && <div className="rating-result"><header><span>本局表现分</span><strong>{ratingResult.breakdown.totalScore}</strong></header><div><span>结果 {ratingResult.breakdown.resultScore}</span><span>生存 {ratingResult.breakdown.survivalScore}</span><span>进攻 {ratingResult.breakdown.offenseScore}</span><span>防守恢复 {ratingResult.breakdown.defenseScore}</span><span>参与 {ratingResult.breakdown.participationScore}</span></div><footer><span>Rating</span><strong>{ratingResult.previousRating} → {ratingResult.rating}</strong><small>BEST 35：{ratingResult.best35Contribution} · RECENT 15：{ratingResult.recent15Contribution}</small></footer></div>}<p className="muted">所有玩家确认后，房间会返回准备阶段，可以直接开始下一局。</p></Modal>
    <Modal title={parameterAction ? `${parameterAction.name} · 选择 n` : '选择技能参数'} open={Boolean(parameterAction)} okText="确认行动" cancelText="取消" onCancel={() => { setParameterAction(undefined); setSelectedActionId(undefined); }} onOk={confirmVariableAction} okButtonProps={{ disabled: !parameterAction || variableMax < (parameterAction.variable?.minPower ?? 1) }}>
      {parameterAction?.variable && <><p>{parameterAction.description}</p><InputNumber min={parameterAction.variable.minPower} max={variableMax} value={variablePower} precision={0} onChange={(value) => setVariablePower(Math.trunc(value ?? parameterAction.variable!.minPower))} /><p className="muted">将消耗 {formatNumber(parameterAction.variable.costPerPower * variablePower)} {resourceById.get(parameterAction.variable.resourceId)?.name ?? parameterAction.variable.resourceId}，效果等级为 {formatNumber((parameterAction.variable.effectLevelPerPower ?? parameterAction.variable.levelPerPower) * variablePower)}{parameterAction.damageLevel !== undefined ? `，伤害等级为 ${formatNumber(parameterAction.damageLevel)}` : ''}。</p></>}
    </Modal>
    <Modal title={flexibleAction ? `${flexibleAction.name} · 任意资源支付` : '任意资源支付'} open={Boolean(flexibleAction)} okText="确认支付" cancelText="取消" onCancel={() => { setFlexibleAction(undefined); setSelectedActionId(undefined); }} onOk={confirmFlexibleAction} okButtonProps={{ disabled: flexibleSelected !== flexibleRequired }}>
      <p>请选择合计 {flexibleRequired} 点资源（已选 {flexibleSelected}）。任意资源支付只接受整数点数。</p>
      {activeActor && Object.values(activeActor.resources).filter((resource) => isResourceVisibleForCharacter(resource.resourceId, activeActor.characterId, resource.current)).map((resource) => <div className="resource-payment-row" key={resource.resourceId}><span>{resourceById.get(resource.resourceId)?.name ?? resource.resourceId}（持有 {formatNumber(resource.current)}）</span><InputNumber min={0} max={Math.max(0, Math.floor(resource.current + 1e-6))} step={1} precision={0} value={resourceSpend[resource.resourceId] ?? 0} onChange={(value) => setResourceSpend((current) => ({ ...current, [resource.resourceId]: Math.max(0, Math.trunc(value ?? 0)) }))} /></div>)}
    </Modal>
    <Modal title="以魂补充受控角色资源" open={Boolean(sponsorAction)} okText="继续选择行动" cancelText="取消" onCancel={() => { setSponsorAction(undefined); paymentPrepared.current = { sponsorReady: false, surchargeReady: false }; }} onOk={() => { const action = sponsorAction; const grant = Object.fromEntries(Object.entries(controllerGrant).filter(([, amount]) => amount > 0)); paymentPrepared.current.sponsorReady = true; paymentPrepared.current.grant = Object.keys(grant).length ? grant : undefined; setSponsorAction(undefined); if (action) chooseAction(action); }} okButtonProps={{ disabled: controllerGrantSelected > (me?.resources.soul?.current ?? 0) }}>
      <p>可消耗魑魅的魂，为 {activeActor?.nickname} 补充本次行动所需资源。补充本身不计入度化的累计行动消耗。</p>
      <p>已选 {controllerGrantSelected} / 可用 {formatNumber(me?.resources.soul?.current ?? 0)} 魂</p>
      {gameConfig.resources.map((resource) => <div className="resource-payment-row" key={resource.id}><span>{resource.name}</span><InputNumber min={0} max={Math.floor(me?.resources.soul?.current ?? 0)} precision={0} value={controllerGrant[resource.id] ?? 0} onChange={(value) => setControllerGrant((current) => ({ ...current, [resource.id]: Math.max(0, Math.trunc(value ?? 0)) }))} /></div>)}
    </Modal>
    <Modal title="地狱行者 · 额外支付" open={Boolean(surchargeAction)} okText="确认支付" cancelText="取消" onCancel={() => { setSurchargeAction(undefined); paymentPrepared.current = { sponsorReady: false, surchargeReady: false }; }} onOk={() => { const action = surchargeAction; if (!surchargeResourceId) return; paymentPrepared.current.surchargeReady = true; paymentPrepared.current.surcharge = { [surchargeResourceId]: 1 }; setSurchargeAction(undefined); if (action) chooseAction(action); }} okButtonProps={{ disabled: !surchargeResourceId }}>
      <p>该玩家受到地狱行者影响，攻击行动必须额外支付 1 点任意资源。</p>
      <Select style={{ width: '100%' }} value={surchargeResourceId} placeholder="选择支付资源" options={gameConfig.resources.filter((resource) => (activeActor?.resources[resource.id]?.current ?? 0) + (paymentPrepared.current.grant?.[resource.id] ?? 0) >= 1).map((resource) => ({ value: resource.id, label: `${resource.name}（可用 ${formatNumber((activeActor?.resources[resource.id]?.current ?? 0) + (paymentPrepared.current.grant?.[resource.id] ?? 0))}）` }))} onChange={setSurchargeResourceId} />
    </Modal>
    <Modal title="吞天收益选择" open={Boolean(resourceChoiceAction)} footer={null} onCancel={() => { setResourceChoiceAction(undefined); setSelectedActionId(undefined); }}>
      <p>若本次招式令其他玩家健康状态左移，将获得你选择的基础资源。</p>
      <div className="deferred-selection-actions"><Button type="primary" onClick={() => { const action = resourceChoiceAction; setPendingResourceChoice('energy'); setResourceChoiceAction(undefined); if (action) continueChooseAction(action, 'energy', null); }}>获得气</Button><Button onClick={() => { const action = resourceChoiceAction; setPendingResourceChoice('charge'); setResourceChoiceAction(undefined); if (action) continueChooseAction(action, 'charge', null); }}>获得蓄力</Button></div>
    </Modal>
    <Modal title="吞天 · 击杀学习" open={Boolean(learningRequest)} closable={false} maskClosable={false} footer={null}>
      <p>你击杀了 {learningRequest?.targetNickname ?? '目标'}。可以学习其当前角色的一个专属技能或被动，也可以放弃。</p>
      <div className="deferred-selection-actions">
        {learningRequest?.actionIds.map((actionId) => <Button key={actionId} type="primary" onClick={() => { room.send('submit_learning', { requestId: requestId(), learnerPlayerId: learningRequest.learnerPlayerId, targetPlayerId: learningRequest.targetPlayerId, actionId }); setLearningRequest(undefined); }}>技能 · {actionById.get(actionId)?.name ?? actionId}</Button>)}
        {learningRequest?.passiveIds.map((passiveId) => <Button key={passiveId} onClick={() => { room.send('submit_learning', { requestId: requestId(), learnerPlayerId: learningRequest.learnerPlayerId, targetPlayerId: learningRequest.targetPlayerId, passiveId }); setLearningRequest(undefined); }}>被动 · {passiveById.get(passiveId)?.name ?? passiveId}</Button>)}
        <Button danger onClick={() => { if (!learningRequest) return; room.send('submit_learning', { requestId: requestId(), learnerPlayerId: learningRequest.learnerPlayerId, targetPlayerId: learningRequest.targetPlayerId, skip: true }); setLearningRequest(undefined); }}>放弃学习</Button>
      </div>
    </Modal>
    {hovered && <Card className="hover-player-card" style={hoverCardStyle(hovered.x, hovered.y)} onMouseEnter={() => window.clearTimeout(hoverDismissTimer.current)} onMouseLeave={() => setHovered(undefined)}><PlayerDetails player={players.find((player) => player.playerId === hovered.player.playerId) ?? hovered.player} /></Card>}
    {new URLSearchParams(window.location.search).get('perf') === '1' && <PerformancePanel rtt={rtt} />}
    {tutorialRequest && <Suspense fallback={null}><Tutorial open initialPage={tutorialRequest.page} initialCharacterId={tutorialRequest.characterId} onClose={() => setTutorialRequest(undefined)} /></Suspense>}
  </main>;
}

function TrainingSetup({ actors, room }: { actors: SyncedPlayer[]; room: Room<DemoRoomState> }) {
  const sendConfig = (actorPlayerId: string, patch: { nickname?: string; characterId?: string; resources?: Record<string, number> }) => room.send('configure_training_actor', { requestId: requestId(), actorPlayerId, ...patch });
  return <div className="training-setup">
    <header><div><strong>练习角色配置</strong><small>可直接选择初始角色和资源；开局后你将依次操控所有角色。</small></div><Button size="small" onClick={() => room.send('add_training_dummy', { requestId: requestId() })} disabled={actors.length >= 20}>添加假人</Button></header>
    <div className="training-actor-list">{actors.map((actor) => <article key={actor.playerId}>
      <div className="training-actor-heading"><Input defaultValue={actor.nickname} maxLength={16} aria-label="练习角色昵称" onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== actor.nickname) sendConfig(actor.playerId, { nickname: value }); }} /><Select value={actor.characterId} options={gameConfig.characters.map((character) => ({ value: character.id, label: character.name }))} onChange={(characterId) => sendConfig(actor.playerId, { characterId })} /></div>
      <div className="training-resources">{gameConfig.resources.map((resource) => <label key={resource.id}><span>{resource.shortName}</span><InputNumber min={0} max={65_535} precision={0} value={actor.resources[resource.id]?.current ?? 0} onChange={(value) => sendConfig(actor.playerId, { resources: { [resource.id]: value ?? 0 } })} /></label>)}</div>
      {actor.isTrainingDummy && <Button size="small" danger disabled={actors.length <= 2} onClick={() => room.send('remove_training_dummy', { requestId: requestId(), actorPlayerId: actor.playerId })}>移除</Button>}
    </article>)}</div>
  </div>;
}

function hoverCardStyle(x: number, y: number) {
  const viewportInset = 12;
  const top = Math.max(viewportInset, Math.min(y + 14, window.innerHeight - viewportInset - 320));
  return {
    left: Math.max(viewportInset, Math.min(x + 14, window.innerWidth - viewportInset - 286)),
    top,
    maxHeight: Math.max(0, window.innerHeight - top - viewportInset),
  };
}

function EmotePicker({ onSelect, onPressStart, onPressEnd }: { onSelect: (emoteId: RoomEmoteId) => void; onPressStart?: (emoteId: RoomEmoteId) => void; onPressEnd?: () => void }) {
  return <div className="emote-picker" role="menu" aria-label="房间表情">
    {roomEmotes.map((emote) => <button key={emote.id} type="button" role="menuitem" title={emote.label} aria-label={emote.label} onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); onPressStart?.(emote.id); }} onPointerUp={onPressEnd} onPointerCancel={onPressEnd} onClick={() => onSelect(emote.id)}>{emote.emoji}</button>)}
  </div>;
}

function EmoteWheel({ state }: { state: EmoteWheelState }) {
  const selected = roomEmotes.find((emote) => emote.id === state.selectedId) ?? roomEmotes[0];
  return <div className="emote-wheel" style={{ left: state.center.x, top: state.center.y }} aria-hidden="true">
    {roomEmotes.map((emote, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / roomEmotes.length;
      return <span
        className={`emote-wheel-option${emote.id === state.selectedId ? ' selected' : ''}`}
        style={{ left: `calc(50% + ${Math.cos(angle) * 82}px)`, top: `calc(50% + ${Math.sin(angle) * 82}px)` }}
        key={emote.id}
      >{emote.emoji}</span>;
    })}
    <span className="emote-wheel-center"><kbd>V</kbd><small>{selected.label}</small></span>
  </div>;
}

function Roster({ players, gameState, viewer, onInspect }: { players: SyncedPlayer[]; gameState: SyncedGameState; viewer?: SyncedPlayer; onInspect: (player: SyncedPlayer) => void }) {
  return <div className="roster-list">{players.map((player) => {
    const obscured = viewer?.buffs.some((buff) => buff.buffId === 'darkness') && player.gridIndex !== viewer.gridIndex;
    const resources = Object.values(player.resources).filter((resource) => isResourceVisibleForCharacter(resource.resourceId, player.characterId, resource.current)).map((resource) => `${resourceById.get(resource.resourceId)?.shortName ?? resource.resourceId} ${formatNumber(resource.current)}`).join(' · ');
    const healthLabel = player.characterId === 'inner_guard' ? '装置' : 'HP';
    const status = playerRoomStatus(player, gameState.phase);
    return <button className="roster-player" key={player.accountId} type="button" disabled={Boolean(obscured)} title={obscured ? '黑暗中无法查看资料' : player.isTrainingDummy ? '查看角色详情' : '查看玩家详细资料'} onClick={() => onInspect(player)}><span className="color-chip" style={{ backgroundColor: `#${player.color.toString(16).padStart(6, '0')}` }} /><span className="roster-name-row"><strong>{obscured ? '黑暗中的目标' : player.nickname}{player.playerId === gameState.hostPlayerId && !obscured ? ' 👑' : ''}</strong>{!obscured && <span className={`player-room-status ${status.tone}`}>{status.label}</span>}</span><small>{obscured ? '状态未知' : player.alive ? `${healthLabel} ${player.currentHp}/${player.maxHp}${resources ? ` · ${resources}` : ''}` : '本局已淘汰'}</small></button>;
  })}</div>;
}

interface BattleLogGroup { gameNumber: number; round: number; time: string; entries: string[] }

function groupBattleLog(entries: SyncedRoundLogEntry[]): BattleLogGroup[] {
  const groups: BattleLogGroup[] = [];
  for (const entry of entries) {
    const previous = groups.at(-1);
    if (previous && previous.gameNumber === entry.gameNumber && previous.round === entry.round) previous.entries.push(entry.text);
    else groups.push({ gameNumber: entry.gameNumber, round: entry.round, time: entry.time, entries: [entry.text] });
  }
  return groups.reverse();
}

function BattleLog({ groups }: { groups: BattleLogGroup[] }) {
  return <div className="battle-log">{groups.length === 0 ? <p className="muted">暂无战斗记录</p> : groups.map((group) => <article key={`${group.gameNumber}-${group.round}`}><header><strong>第 {group.gameNumber} 局 · 第 {group.round} 回合</strong><time>{group.time}</time></header><div>{group.entries.map((entry, index) => <p key={`${index}-${entry}`}>{entry}</p>)}</div></article>)}</div>;
}

function phaseTitle(state: SyncedGameState): string {
  if (state.phase === 'waiting') return '房间准备';
  if (state.phase === 'finished') return '游戏结束';
  if (state.phase === 'deferred') return `第 ${state.round} 回合 · 后发选择`;
  if (state.phase === 'learning') return `第 ${state.round} 回合 · 吞天学习`;
  if (state.phase === 'resolving') return `第 ${state.round} 回合 · 结算`;
  return `第 ${state.round} 回合`;
}

function roomNoticeText(notice: RoomNoticeMessage): string {
  if (notice.type === 'leave') return `${notice.nickname} 离开房间`;
  if (notice.type === 'disconnect') return `${notice.nickname} 连接中断`;
  if (notice.type === 'reconnect') return `${notice.nickname} 重新连接`;
  return `${notice.nickname} 进入房间`;
}

function requestId(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }
function readLastWheelEmote(): RoomEmoteId {
  const stored = localStorage.getItem(LAST_EMOTE_STORAGE_KEY);
  return isRoomEmoteId(stored) ? stored : roomEmotes[0].id;
}
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}
function formatNumber(value: number): string { if (Math.abs(value - 1 / 3) < 0.001) return '1/3'; if (Math.abs(value - 2 / 3) < 0.001) return '2/3'; return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
function circularPathCells(from: number, to: number, count: number, direction: -1 | 1): number[] {
  const cells = [from];
  if (from === to) return cells;
  for (let cell = (from + direction + count) % count; cells.length < count; cell = (cell + direction + count) % count) {
    cells.push(cell);
    if (cell === to) break;
  }
  return cells;
}
function formatTargetAllocation(targetIds: string[], players: SyncedPlayer[]): string {
  const counts = new Map<string, number>();
  for (const targetId of targetIds) counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  return Array.from(counts, ([targetId, count]) => `${players.find((player) => player.playerId === targetId)?.nickname ?? targetId}${count > 1 ? ` ×${count}` : ''}`).join('、');
}

function describeRevealedSelection(action: RevealedAction, players: SyncedPlayer[], boardObjects: SyncedBoardObject[]): string {
  if (action.transformCharacterId) return ` → ${characterById.get(action.transformCharacterId)?.name ?? action.transformCharacterId}`;
  if (action.targetIds.length > 0) {
    const targets = formatTargetAllocation(action.targetIds, players);
    const direction = action.pathDirection === 1 ? ' · 顺时针' : action.pathDirection === -1 ? ' · 逆时针' : '';
    const landing = action.targetGridIndex === undefined ? '' : ` · 落点 ${action.targetGridIndex} 号`;
    return ` → ${targets}${direction}${landing}`;
  }
  if (action.targetBoardObjectId) {
    const object = boardObjects.find((candidate) => candidate.objectId === action.targetBoardObjectId);
    return ` → ${object?.definitionId === 'lotus_seat' ? '托生莲座' : object?.definitionId ?? '棋盘对象'}`;
  }
  if (action.targetGridIndex !== undefined) return ` → ${action.targetGridIndex} 号地块`;
  if (actionById.get(action.actionId)?.target.selectionTiming === 'deferred') return ' → 后发待选';
  return '';
}
