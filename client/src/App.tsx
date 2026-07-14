import { useEffect, useMemo, useState } from 'react';
import { actionById, resourceById, type ActionDefinition, type SessionResponse, type SyncedGameState, type SyncedPlayer } from '@energy-duel/shared';
import { Button, Card, Collapse, Drawer, Modal } from 'antd';
import { Client, type Room } from '@colyseus/sdk';
import ActionPanel from './components/ActionPanel';
import GameCanvas from './components/GameCanvas';
import PlayerDetails from './components/PlayerDetails';
import { readSyncedPlayers, type RawSyncedPlayer } from './roomState';
import { clearSession, createSession, getServerUrl, loadSession } from './session';

interface PlayerCollection { values(): IterableIterator<RawSyncedPlayer> }
interface DemoRoomState {
  players?: PlayerCollection;
  phase?: SyncedGameState['phase'];
  round?: number;
  hostPlayerId?: string;
  lastResult?: string;
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fff]{3,16}$/;
const NICKNAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fff]{1,16}$/;

export default function App() {
  const [session, setSession] = useState<SessionResponse | null>(() => loadSession());
  const [username, setUsername] = useState(() => loadSession()?.username ?? '');
  const [nickname, setNickname] = useState(() => loadSession()?.username ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [roomId, setRoomId] = useState('');
  const [room, setRoom] = useState<Room<DemoRoomState> | null>(null);
  const [players, setPlayers] = useState<SyncedPlayer[]>([]);
  const [gameState, setGameState] = useState<SyncedGameState>({ phase: 'waiting', round: 0, hostPlayerId: '', lastResult: '等待玩家准备。' });
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [inspectedPlayer, setInspectedPlayer] = useState<SyncedPlayer>();
  const [hovered, setHovered] = useState<{ player: SyncedPlayer; x: number; y: number }>();
  const [resetViewKey, setResetViewKey] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(false);

  useEffect(() => () => { void room?.leave(); }, [room]);
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarsePointer(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setSelectedActionId(undefined);
    setSelectedTargetId(undefined);
    setConfirmOpen(false);
  }, [gameState.round, gameState.phase]);

  const login = async () => {
    const normalized = username.trim();
    if (!USERNAME_PATTERN.test(normalized)) return setError('用户名需为 3–16 个中文、字母、数字或下划线');
    setLoading(true);
    setError('');
    try {
      const next = await createSession(normalized);
      setSession(next);
      setNickname(next.username);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法连接服务器');
    } finally {
      setLoading(false);
    }
  };

  const enterRoom = async (mode: 'create' | 'join') => {
    if (!session) return;
    const displayName = nickname.trim();
    if (!NICKNAME_PATTERN.test(displayName)) return setError('昵称需为 1–16 个中文、字母、数字或下划线');
    const requestedRoomId = joinCode.trim();
    if (mode === 'join' && !requestedRoomId) return setError('请输入房间 ID');
    setLoading(true);
    setError('');
    try {
      const connect = async (identity: SessionResponse) => {
        const client = new Client(getServerUrl());
        client.auth.token = identity.token;
        return mode === 'create'
          ? client.create<DemoRoomState>('energy_duel_demo', { nickname: displayName })
          : client.joinById<DemoRoomState>(requestedRoomId, { nickname: displayName });
      };
      let joined: Room<DemoRoomState>;
      try {
        joined = await connect(session);
      } catch (reason) {
        if ((reason as { code?: number }).code !== 401) throw reason;
        const renewedSession = await createSession(session.username);
        setSession(renewedSession);
        joined = await connect(renewedSession);
      }
      joined.onStateChange((state) => {
        setPlayers(readSyncedPlayers(state.players?.values()));
        setGameState({
          phase: state.phase ?? 'waiting', round: state.round ?? 0,
          hostPlayerId: state.hostPlayerId ?? '', lastResult: state.lastResult ?? '',
        });
      });
      joined.onMessage('game_error', (payload: { message?: string }) => setError(payload.message || '操作失败'));
      joined.onMessage('room_closed', (payload: { message?: string }) => setError(payload.message || '房间已关闭'));
      joined.onError((code, message) => setError(`${message} (${code})`));
      joined.reconnection.minUptime = 1000;
      joined.onDrop(() => { if (joined.state.phase === 'choosing') setReconnecting(true); });
      joined.onReconnect(() => setReconnecting(false));
      joined.onLeave(() => resetRoomState());
      setRoomId(joined.roomId);
      setRoom(joined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加入房间失败');
    } finally {
      setLoading(false);
    }
  };

  const resetRoomState = () => {
    setReconnecting(false);
    setRoom(null);
    setRoomId('');
    setPlayers([]);
    setGameState({ phase: 'waiting', round: 0, hostPlayerId: '', lastResult: '' });
    setInspectedPlayer(undefined);
    setHovered(undefined);
  };

  const leaveRoom = async () => {
    await room?.leave();
    resetRoomState();
  };

  const logout = async () => {
    await leaveRoom();
    clearSession();
    setSession(null);
    setUsername('');
    setNickname('');
  };

  const me = players.find((player) => player.accountId === session?.accountId);
  const isHost = me?.playerId === gameState.hostPlayerId;
  const selectedAction = selectedActionId ? actionById.get(selectedActionId) : undefined;
  const targeting = selectedAction?.target.mode === 'single_enemy' && !me?.submitted;
  const validTargets = useMemo(
    () => players.filter((player) => player.alive && player.playerId !== me?.playerId),
    [players, me?.playerId],
  );

  const chooseAction = (action: ActionDefinition) => {
    setError('');
    setSelectedActionId(action.id);
    setSelectedTargetId(undefined);
    setConfirmOpen(action.target.mode !== 'single_enemy');
  };

  const chooseTarget = (player: SyncedPlayer) => {
    setSelectedTargetId(player.playerId);
    setConfirmOpen(true);
  };

  const confirmAction = () => {
    if (!selectedAction) return;
    room?.send('submit_action', { actionId: selectedAction.id, targetId: selectedTargetId });
    setConfirmOpen(false);
  };

  if (!session) return (
    <main className="shell auth-shell">
      <section className="panel auth-panel">
        <p className="eyebrow">ENERGY DUEL</p><h1>能量对决</h1>
        <p className="muted">输入用户名，建立你的无密码玩家身份。</p>
        <label>用户名<input value={username} maxLength={16} onChange={(event) => setUsername(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void login()} autoFocus /></label>
        {error && <p className="error">{error}</p>}
        <Button type="primary" size="large" block onClick={() => void login()} loading={loading}>进入游戏</Button>
        <p className="warning">无密码模式不提供身份保护：知道用户名的人可以进入同一账号。</p>
      </section>
    </main>
  );

  if (!room) return (
    <main className="shell lobby-shell">
      <section className="panel lobby-panel">
        <div className="identity"><div><span className="status-dot" />账号：{session.username}</div><Button onClick={() => void logout()}>退出</Button></div>
        <h1>圆形竞技场</h1><p className="muted">创建私人房间，或输入房间 ID 加入。</p>
        <label>房间昵称<input value={nickname} maxLength={16} onChange={(event) => setNickname(event.target.value)} /></label>
        <label>房间 ID<input value={joinCode} placeholder="加入已有房间时填写" onChange={(event) => setJoinCode(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void enterRoom('join')} /></label>
        {error && <p className="error">{error}</p>}
        <div className="lobby-actions"><Button type="primary" onClick={() => void enterRoom('create')} loading={loading}>创建房间</Button><Button onClick={() => void enterRoom('join')} disabled={loading || !joinCode.trim()}>加入房间</Button></div>
      </section>
    </main>
  );

  const roster = <Roster players={players} gameState={gameState} />;
  return (
    <main className="game-shell">
      <header className="game-header">
        <div><p className="eyebrow">CIRCULAR GRID</p><h1>{gameState.phase === 'waiting' ? '房间准备' : gameState.phase === 'finished' ? '游戏结束' : `第 ${gameState.round} 回合`}</h1></div>
        <div className="game-actions">
          <span className="room-id">房间 {roomId}</span>
          <Button size="small" onClick={() => void navigator.clipboard?.writeText(roomId)}>复制 ID</Button>
          <span>{players.length}/20 玩家</span><Button size="small" danger onClick={() => void leaveRoom()}>离开</Button>
        </div>
      </header>
      {reconnecting && <div className="reconnecting-banner">连接中断，正在等待自动重连…</div>}
      {error && <p className="error floating-error">{error}</p>}

      <section className="battlefield-region">
        <GameCanvas
          players={players} targeting={targeting} targetablePlayerIds={validTargets.map((player) => player.playerId)}
          selectedTargetId={selectedTargetId} resetViewKey={resetViewKey} onPlayerSelect={chooseTarget}
          onPlayerInspect={setInspectedPlayer}
          onPlayerHover={(player, point) => {
            if (coarsePointer || !player || !point) setHovered(undefined);
            else setHovered({ player, x: point.x, y: point.y });
          }}
        />
        <Button className="reset-view" size="small" onClick={() => setResetViewKey((value) => value + 1)}>重置视角</Button>
        {targeting && <div className="targeting-hint">请选择高亮的目标角色</div>}
      </section>

      <aside className="roster desktop-roster">{roster}</aside>
      <Collapse className="mobile-roster" items={[{ key: 'players', label: `玩家列表（${players.length}）`, children: roster }]} />

      <section className="game-control-panel">
        <div className="round-result">{gameState.lastResult.split('\n').map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div>
        {gameState.phase === 'waiting' && <div className="ready-controls">
          <Button type={me?.ready ? 'default' : 'primary'} onClick={() => room.send('set_ready', { ready: !me?.ready })}>{me?.ready ? '取消准备' : '准备'}</Button>
          {isHost ? <Button type="primary" onClick={() => room.send('start_game')} disabled={players.length < 2 || players.some((player) => !player.ready || !player.connected)}>开始游戏</Button> : <p className="muted compact-copy">等待房主开始</p>}
        </div>}
        {gameState.phase === 'choosing' && me?.alive && <ActionPanel player={me} selectedActionId={selectedActionId} onSelect={chooseAction} onCancel={() => { room.send('cancel_action'); setSelectedActionId(undefined); setSelectedTargetId(undefined); }} />}
        {gameState.phase === 'choosing' && me && !me.alive && <p className="eliminated-notice">你已淘汰，正在观战</p>}
        {gameState.phase === 'finished' && <p className="finished-hint">结算已完成，你可以查看战场或自行离开。</p>}
      </section>

      <Modal title="确认行动" open={confirmOpen} okText="确认提交" cancelText="继续选择" onOk={confirmAction} onCancel={() => setConfirmOpen(false)}>
        {selectedAction && <div className="confirm-action"><h3>使用「{selectedAction.name}」</h3><p>{selectedAction.description}</p><p>消耗：{formatActionCost(selectedAction)}</p>{selectedTargetId && <p>目标：{players.find((player) => player.playerId === selectedTargetId)?.nickname}</p>}</div>}
      </Modal>
      <Drawer title="角色详情" placement="bottom" height="min(72dvh, 520px)" open={Boolean(inspectedPlayer)} onClose={() => setInspectedPlayer(undefined)}>{inspectedPlayer && <PlayerDetails player={players.find((player) => player.playerId === inspectedPlayer.playerId) ?? inspectedPlayer} />}</Drawer>
      {hovered && <Card className="hover-player-card" style={{ left: Math.min(hovered.x + 14, window.innerWidth - 300), top: Math.min(hovered.y + 14, window.innerHeight - 320) }}><PlayerDetails player={hovered.player} /></Card>}
    </main>
  );
}

function Roster({ players, gameState }: { players: SyncedPlayer[]; gameState: SyncedGameState }) {
  return <div className="roster-list">{players.map((player) => {
    const resources = Object.values(player.resources).map((resource) => `${resourceById.get(resource.resourceId)?.shortName ?? resource.resourceId} ${resource.current}`).join(' · ');
    return <button className="roster-player" key={player.accountId} type="button">
      <span className="color-chip" style={{ backgroundColor: `#${player.color.toString(16).padStart(6, '0')}` }} />
      <strong>{player.nickname}{player.playerId === gameState.hostPlayerId ? ' 👑' : ''}</strong>
      <small>{gameState.phase === 'waiting' ? (player.ready ? '已准备' : '未准备') : player.alive ? `HP ${player.currentHp}/${player.maxHp} · ${resources}` : '已淘汰'}</small>
    </button>;
  })}</div>;
}

function formatActionCost(action: ActionDefinition): string {
  const entries = Object.entries(action.cost);
  return entries.length === 0 ? '无' : entries.map(([id, value]) => `${value} ${resourceById.get(id)?.shortName ?? id}`).join('、');
}
