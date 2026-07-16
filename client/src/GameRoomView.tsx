import { lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  actionById,
  characterById,
  gameConfig,
  resourceById,
  type ActionDefinition,
  type CommandResultMessage,
  type DeferredActionRequiredMessage,
  type ResolutionStep,
  type RoundResolutionMessage,
  type SessionResponse,
  type SyncedGameState,
  type SyncedPlayer,
  type SyncedRoundLogEntry,
} from '@energy-duel/shared';
import type { Room } from '@colyseus/sdk';
import { Button, Card, Collapse, ConfigProvider, Drawer, Input, InputNumber, Modal, Select, Tag, message, theme } from 'antd';
import 'antd/dist/reset.css';
import type { DemoRoomState } from './App';
import ActionPanel from './components/ActionPanel';
import PlayerDetails from './components/PlayerDetails';
import { PerformancePanel } from './components/PerformancePanel';
import FloatingWindow from './components/FloatingWindow';
import AnnouncementLauncher from './components/AnnouncementLauncher';
import { readSyncedPlayers } from './roomState';

interface Props { room: Room<DemoRoomState>; session: SessionResponse; onLeave: () => void }
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
  const [gameState, setGameState] = useState<SyncedGameState>({ phase: 'waiting', round: 0, gameNumber: 0, hostPlayerId: '', lastResult: '等待玩家准备。', roomMode: 'standard' });
  const [activeActorId, setActiveActorId] = useState<string>();
  const [battleLog, setBattleLog] = useState<SyncedRoundLogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [parameterAction, setParameterAction] = useState<ActionDefinition>();
  const [variablePower, setVariablePower] = useState(1);
  const [deferredRequest, setDeferredRequest] = useState<DeferredActionRequiredMessage>();
  const [submittedLabel, setSubmittedLabel] = useState<string>();
  const [inspectedPlayer, setInspectedPlayer] = useState<SyncedPlayer>();
  const [hovered, setHovered] = useState<{ player: SyncedPlayer; x: number; y: number }>();
  const [resetViewKey, setResetViewKey] = useState(0);
  const [networkState, setNetworkState] = useState<'online' | 'reconnecting' | 'offline'>('online');
  const [rtt, setRtt] = useState<number>();
  const [activeStep, setActiveStep] = useState<ResolutionStep>();
  const [battleLoad, setBattleLoad] = useState({ progress: 0, label: '正在准备战场' });
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number } | null>(() => {
    try { return JSON.parse(localStorage.getItem('energy-duel-panel-position') ?? 'null'); } catch { return null; }
  });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const handleState = (state: DemoRoomState | undefined) => {
      if (!state) return;
      setPlayers(readSyncedPlayers(state.players?.values()));
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
      void api.info({ content: `行动已公开：请为「${actionById.get(payload.actionId)?.name ?? payload.actionId}」后发分配目标`, duration: 2 });
    });
    const handleDrop = () => setNetworkState('reconnecting');
    const handleReconnect = () => { setNetworkState('online'); void api.success({ content: '已重新连接', duration: 1 }); };
    const handleLeave = () => { setNetworkState('offline'); onLeave(); };
    room.onDrop(handleDrop); room.onReconnect(handleReconnect); room.onLeave(handleLeave);
    const pingTimer = window.setInterval(() => { if (room.connection.isOpen) room.send('ping', { sentAt: performance.now() }); }, 5000);
    room.send('ping', { sentAt: performance.now() });
    return () => {
      mounted.current = false; window.clearInterval(pingTimer);
      room.onStateChange.remove(handleState); removeCommand(); removeError(); removeClosed(); removePong(); removeResolution(); removeDeferred();
      room.onDrop.remove(handleDrop); room.onReconnect.remove(handleReconnect); room.onLeave.remove(handleLeave);
    };

    async function playTimeline(payload: RoundResolutionMessage) {
      setSelectedActionId(undefined); setSelectedTargetIds([]); setDeferredRequest(undefined);
      for (const step of payload.steps) {
        if (!mounted.current) return;
        setActiveStep(step);
        await delay(step.durationMs);
      }
      if (mounted.current) setActiveStep(undefined);
    }
  }, [api, onLeave, room]);

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarsePointer(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const update = () => setCompactLayout(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setSelectedActionId(undefined); setSelectedTargetIds([]); setSubmittedLabel(undefined); setDeferredRequest(undefined); setParameterAction(undefined);
  }, [gameState.round]);
  useEffect(() => {
    if (panelPosition) localStorage.setItem('energy-duel-panel-position', JSON.stringify(panelPosition));
  }, [panelPosition]);

  const me = players.find((player) => player.accountId === session.accountId);
  const isHost = me?.playerId === gameState.hostPlayerId;
  const controlledActors = useMemo(() => gameState.roomMode === 'training' && me ? players.filter((player) => player.controllerPlayerId === me.playerId) : me ? [me] : [], [gameState.roomMode, me, players]);
  const activeActor = controlledActors.find((player) => player.playerId === activeActorId) ?? me;
  const selectedAction = selectedActionId ? actionById.get(selectedActionId) : undefined;
  const targeting = Boolean(deferredRequest || (selectedAction && ['single_enemy', 'multiple_enemies'].includes(selectedAction.target.mode) && !activeActor?.submitted));
  const validTargets = useMemo(() => players.filter((player) => player.alive && player.playerId !== activeActor?.playerId), [players, activeActor?.playerId]);
  const battleLogGroups = useMemo(() => groupBattleLog(battleLog), [battleLog]);
  const variableMax = parameterAction?.variable
    ? Math.max(parameterAction.variable.minPower, Math.min(
      parameterAction.variable.maxPower ?? Number.MAX_SAFE_INTEGER,
      Math.floor((activeActor?.resources[parameterAction.variable.resourceId]?.current ?? 0) / parameterAction.variable.costPerPower),
    ))
    : 1;

  useEffect(() => {
    if (gameState.roomMode !== 'training' || gameState.phase !== 'choosing') return;
    const current = controlledActors.find((actor) => actor.playerId === activeActorId);
    if (current?.alive && !current.submitted) return;
    const next = controlledActors.find((actor) => actor.alive && !actor.submitted);
    if (next && next.playerId !== activeActorId) { setActiveActorId(next.playerId); setSelectedActionId(undefined); setSelectedTargetIds([]); setSubmittedLabel(undefined); }
  }, [activeActorId, controlledActors, gameState.phase, gameState.roomMode]);

  const submit = (action: ActionDefinition, targetIds: string[] = [], transformCharacterId?: string, power?: number) => {
    const targetNames = targetIds.map((id) => players.find((player) => player.playerId === id)?.nickname ?? id);
    const label = transformCharacterId
      ? `已选择变身：${characterById.get(transformCharacterId)?.name ?? transformCharacterId}`
      : `已选择「${action.name}」${power === undefined ? '' : `（n=${power}）`}${targetNames.length ? ` → ${targetNames.join('、')}` : ''}`;
    setSubmittedLabel(label);
    room.send('submit_action', {
      actorPlayerId: activeActor?.playerId,
      requestId: requestId(), actionId: action.id,
      targetId: action.target.mode === 'single_enemy' ? targetIds[0] : undefined,
      targetIds: action.target.mode === 'multiple_enemies' ? targetIds : undefined,
      transformCharacterId, power,
    });
    void api.info({ content: label, duration: 1.6 });
  };

  const chooseAction = (action: ActionDefinition) => {
    setSelectedActionId(action.id); setSelectedTargetIds([]);
    if (action.variable) {
      setVariablePower(action.variable.minPower);
      setParameterAction(action);
      return;
    }
    if (action.target.mode === 'single_enemy' || action.target.mode === 'multiple_enemies') {
      void api.open({ type: 'info', content: action.target.mode === 'multiple_enemies' ? `请选择 ${action.target.maxTargets} 次目标` : '请在战场上选择目标', duration: 1.5 });
    } else submit(action);
  };

  const chooseTarget = (player: SyncedPlayer) => {
    if (deferredRequest) {
      const next = [...selectedTargetIds, player.playerId];
      setSelectedTargetIds(next);
      if (next.length >= deferredRequest.allocationCount) {
        room.send('submit_deferred_targets', { requestId: requestId(), actorPlayerId: deferredRequest.actorPlayerId, targetIds: next });
        setDeferredRequest(undefined); setSubmittedLabel(`后发目标已分配：${next.map((id) => players.find((candidate) => candidate.playerId === id)?.nickname ?? id).join('、')}`);
      } else void api.info({ content: `已分配 ${next.length}/${deferredRequest.allocationCount} 个 0.5 级攻击`, duration: 1.1 });
      return;
    }
    if (!selectedAction) return;
    const next = [...selectedTargetIds, player.playerId];
    setSelectedTargetIds(next);
    if (selectedAction.target.mode === 'single_enemy' || next.length >= (selectedAction.target.maxTargets ?? 1)) submit(selectedAction, next);
    else void api.info({ content: `已选择 ${player.nickname}，还需选择 ${(selectedAction.target.maxTargets ?? 1) - next.length} 次`, duration: 1.2 });
  };

  const confirmVariableAction = () => {
    if (!parameterAction) return;
    submit(parameterAction, [], undefined, variablePower);
    setParameterAction(undefined);
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
  const roster = <Roster players={players} gameState={gameState} />;
  const targetHint = deferredRequest
    ? `后发分配 ${selectedTargetIds.length}/${deferredRequest.allocationCount}（可重复点击同一目标）`
    : targeting ? (selectedAction?.target.mode === 'multiple_enemies' ? `选择目标 ${selectedTargetIds.length}/${selectedAction.target.maxTargets}` : '点击高亮角色选择目标') : undefined;

  return <main className="game-shell">
    {contextHolder}
    <header className="game-header">
      <div><p className="eyebrow">CIRCULAR GRID</p><h1>{phaseTitle(gameState)}</h1></div>
      <div className="game-actions"><span className="room-id">房间 {room.roomId}</span><Button size="small" onClick={() => { void navigator.clipboard?.writeText(room.roomId); void api.success('房间号已复制'); }}>复制</Button><Button size="small" onClick={() => setLogOpen(true)}>日志</Button><AnnouncementLauncher compact /><Button size="small" onClick={() => setTutorialOpen(true)}>教程</Button><Tag color={networkState === 'online' ? 'success' : networkState === 'reconnecting' ? 'warning' : 'error'}>{networkState === 'online' ? `在线${rtt === undefined ? '' : ` · ${rtt}ms`}` : networkState === 'reconnecting' ? '重连中' : '离线'}</Tag><span>{players.length}/20</span><Button size="small" danger onClick={() => void leave()}>离开</Button></div>
    </header>
    {networkState === 'reconnecting' && <div className="reconnecting-banner">连接中断，正在保留席位并自动重连…</div>}
    {submittedLabel && activeActor?.submitted && <div className="selection-toast">{activeActor.nickname}：{submittedLabel}</div>}
    {activeStep && <div className="timeline-chip">动作 {activeStep.sequence + 1} · 速度 {activeStep.speedPriority} · {activeStep.actors.map((actor) => actionById.get(actor.actionId)?.name ?? actor.actionId).join(' + ')}</div>}

    <section className="battlefield-region">
      <Suspense fallback={<div className="battle-load-overlay"><div><strong>正在加载绘图引擎</strong><div className="loading-track"><span style={{ width: '35%' }} /></div><small>战斗面板已就绪</small></div></div>}>
        <GameCanvas players={players} targeting={targeting} targetablePlayerIds={validTargets.map((player) => player.playerId)} selectedTargetIds={selectedTargetIds} resetViewKey={resetViewKey} resolutionStep={activeStep} onLoadProgress={(progress, label) => setBattleLoad({ progress, label })} onPlayerSelect={chooseTarget} onPlayerInspect={setInspectedPlayer} onPlayerHover={(player, point) => { if (coarsePointer || !player || !point) setHovered(undefined); else setHovered({ player, x: point.x, y: point.y }); }} />
      </Suspense>
      {battleLoad.progress < 100 && <div className="battle-load-overlay"><div><strong>{battleLoad.label}</strong><div className="loading-track"><span style={{ width: `${battleLoad.progress}%` }} /></div><small>{battleLoad.progress}%</small></div></div>}
      <Button className="reset-view" size="small" onClick={() => setResetViewKey((value) => value + 1)}>重置视角</Button>
      {targetHint && <div className="targeting-hint">{targetHint}</div>}
    </section>
    <aside className="roster desktop-roster">{roster}</aside>
    <Collapse className="mobile-roster" items={[{ key: 'players', label: `玩家列表（${players.length}）`, children: roster }]} />

    <section className="game-control-panel" style={panelPosition ? { left: panelPosition.x, top: panelPosition.y, right: 'auto', bottom: 'auto' } : undefined}>
      <div className="control-panel-drag-handle" onPointerDown={beginPanelDrag}><span>拖动技能面板</span>{panelPosition && <Button size="small" type="text" onClick={(event) => { event.stopPropagation(); setPanelPosition(null); localStorage.removeItem('energy-duel-panel-position'); }}>复位</Button>}</div>
      <div className="round-result">{gameState.lastResult.split('\n').map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div>
      {gameState.roomMode === 'training' && gameState.phase === 'waiting' && <TrainingSetup actors={controlledActors} room={room} />}
      {gameState.phase === 'waiting' && <div className="ready-controls">{gameState.roomMode === 'standard' && <Button type={me?.ready ? 'default' : 'primary'} onClick={sendReady}>{me?.ready ? '取消准备' : '准备'}</Button>}{isHost ? <Button type="primary" onClick={() => room.send('start_game', { requestId: requestId() })} disabled={players.length < 2 || (gameState.roomMode === 'standard' && players.some((player) => !player.ready || !player.connected))}>{gameState.roomMode === 'training' ? '开始练习' : '开始游戏'}</Button> : <p className="muted compact-copy">等待房主开始</p>}</div>}
      {gameState.roomMode === 'training' && gameState.phase === 'choosing' && <div className="actor-switcher"><span>当前操控</span>{controlledActors.map((actor) => <Button key={actor.playerId} size="small" type={actor.playerId === activeActor?.playerId ? 'primary' : 'default'} disabled={!actor.alive} onClick={() => { setActiveActorId(actor.playerId); setSelectedActionId(undefined); setSelectedTargetIds([]); setSubmittedLabel(undefined); }}>{actor.nickname}{actor.submitted ? ' ✓' : ''}</Button>)}</div>}
      {gameState.phase === 'choosing' && activeActor?.alive && <ActionPanel player={activeActor} selectedActionId={selectedActionId} submittedLabel={submittedLabel} onSelect={chooseAction} onTransform={chooseTransform} onCancel={() => { room.send('cancel_action', { requestId: requestId(), actorPlayerId: activeActor.playerId }); setSelectedActionId(undefined); setSelectedTargetIds([]); setSubmittedLabel(undefined); }} />}
      {gameState.phase === 'deferred' && deferredRequest && <div className="deferred-controls"><strong>星尘后发分配</strong><p>所有行动已经公开。点击战场角色分配 {deferredRequest.allocationCount} 个 0.5 级攻击，可重复点击同一目标。</p><div>{deferredRequest.revealedActions.map((revealed) => { const player = players.find((candidate) => candidate.playerId === revealed.playerId); return <Tag key={revealed.playerId}>{player?.nickname ?? revealed.playerId}：{actionById.get(revealed.actionId)?.name ?? revealed.actionId}{revealed.power === undefined ? '' : ` n=${revealed.power}`}</Tag>; })}</div></div>}
      {gameState.phase === 'deferred' && !deferredRequest && <p className="resolving-notice">行动已经公开，等待后发玩家选择目标…</p>}
      {gameState.phase === 'resolving' && <p className="resolving-notice">正在播放本回合结算…</p>}
      {gameState.phase === 'choosing' && me && !me.alive && <p className="eliminated-notice">你已淘汰，正在观战</p>}
      {gameState.phase === 'finished' && <p className="finished-hint">{me?.resultConfirmed ? '你已确认，等待其他玩家。' : '请确认本局结算。'}</p>}
    </section>
    <Drawer title="角色详情" placement="bottom" height="min(72dvh, 520px)" open={Boolean(inspectedPlayer)} onClose={() => setInspectedPlayer(undefined)}>{inspectedPlayer && <PlayerDetails player={players.find((player) => player.playerId === inspectedPlayer.playerId) ?? inspectedPlayer} />}</Drawer>
    {compactLayout ? <Drawer title="战斗日志" placement="right" width="min(440px, 92vw)" open={logOpen} onClose={() => setLogOpen(false)}><BattleLog groups={battleLogGroups} /></Drawer> : logOpen && <FloatingWindow storageId="battle-log" title="战斗日志" initialPosition={{ x: Math.max(20, window.innerWidth - 500), y: 92 }} initialSize={{ width: 440, height: 520 }} onClose={() => setLogOpen(false)} className="battle-log-window"><BattleLog groups={battleLogGroups} /></FloatingWindow>}
    <Modal title="本局结算" open={gameState.phase === 'finished' && Boolean(me) && !me?.resultConfirmed} closable={false} maskClosable={false} okText="确认结算" cancelButtonProps={{ style: { display: 'none' } }} onOk={() => room.send('acknowledge_result', { requestId: requestId() })}><div className="result-summary">{gameState.lastResult.split('\n').map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div><p className="muted">所有玩家确认后，房间会返回准备阶段，可以直接开始下一局。</p></Modal>
    <Modal title={parameterAction ? `${parameterAction.name} · 选择 n` : '选择技能参数'} open={Boolean(parameterAction)} okText="确认行动" cancelText="取消" onCancel={() => { setParameterAction(undefined); setSelectedActionId(undefined); }} onOk={confirmVariableAction} okButtonProps={{ disabled: !parameterAction || variableMax < (parameterAction.variable?.minPower ?? 1) }}>
      {parameterAction?.variable && <><p>{parameterAction.description}</p><InputNumber min={parameterAction.variable.minPower} max={variableMax} value={variablePower} precision={0} onChange={(value) => setVariablePower(value ?? parameterAction.variable!.minPower)} /><p className="muted">将消耗 {parameterAction.variable.costPerPower * variablePower} {resourceById.get(parameterAction.variable.resourceId)?.name ?? parameterAction.variable.resourceId}，技能等级为 {parameterAction.variable.levelPerPower * variablePower}。</p></>}
    </Modal>
    {hovered && <Card className="hover-player-card" style={{ left: Math.min(hovered.x + 14, window.innerWidth - 300), top: Math.min(hovered.y + 14, window.innerHeight - 320) }}><PlayerDetails player={hovered.player} /></Card>}
    {new URLSearchParams(window.location.search).get('perf') === '1' && <PerformancePanel rtt={rtt} />}
    {tutorialOpen && <Suspense fallback={null}><Tutorial open onClose={() => setTutorialOpen(false)} /></Suspense>}
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

function Roster({ players, gameState }: { players: SyncedPlayer[]; gameState: SyncedGameState }) {
  return <div className="roster-list">{players.map((player) => {
    const resources = Object.values(player.resources).map((resource) => `${resourceById.get(resource.resourceId)?.shortName ?? resource.resourceId} ${resource.current}`).join(' · ');
    return <button className="roster-player" key={player.accountId} type="button"><span className="color-chip" style={{ backgroundColor: `#${player.color.toString(16).padStart(6, '0')}` }} /><strong>{player.nickname}{player.playerId === gameState.hostPlayerId ? ' 👑' : ''}</strong><small>{gameState.phase === 'waiting' ? (player.ready ? '已准备' : '未准备') : player.alive ? `HP ${player.currentHp}/${player.maxHp} · ${resources}` : '已淘汰'}</small></button>;
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
  if (state.phase === 'resolving') return `第 ${state.round} 回合 · 结算`;
  return `第 ${state.round} 回合`;
}

function requestId(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }
