import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { PublicRoomSummary, SessionResponse, SyncedGameState, SyncedRoundLogEntry } from '@energy-duel/shared';
import { Client, type Room } from '@colyseus/sdk';
import type { RawSyncedPlayer } from './roomState';
import { clearSession, createSession, fetchPublicRooms, getServerUrl, loadSession } from './session';
import AnnouncementLauncher from './components/AnnouncementLauncher';

interface PlayerCollection { values(): IterableIterator<RawSyncedPlayer> }
interface RoundLogCollection { values(): IterableIterator<SyncedRoundLogEntry> }
export interface DemoRoomState {
  players?: PlayerCollection;
  phase?: SyncedGameState['phase'];
  round?: number;
  gameNumber?: number;
  hostPlayerId?: string;
  lastResult?: string;
  roundLog?: RoundLogCollection;
}

const GameRoomView = lazy(() => import('./GameRoomView'));
const Tutorial = lazy(() => import('./components/Tutorial'));
const USERNAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fff]{3,16}$/;
const NICKNAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fff]{1,16}$/;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,10}$/;

export default function App() {
  const [session, setSession] = useState<SessionResponse | null>(() => loadSession());
  const [username, setUsername] = useState(() => loadSession()?.username ?? '');
  const [nickname, setNickname] = useState(() => loadSession()?.username ?? '');
  const [joinRoomCode, setJoinRoomCode] = useState('');
  const [createRoomCode, setCreateRoomCode] = useState(() => randomRoomCode());
  const [room, setRoom] = useState<Room<DemoRoomState> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]);
  const [roomListLoading, setRoomListLoading] = useState(false);
  const [roomListError, setRoomListError] = useState('');
  const [roomListUpdatedAt, setRoomListUpdatedAt] = useState<Date>();

  useEffect(() => () => { void room?.leave(); }, [room]);

  const refreshRoomList = useCallback(async (signal?: AbortSignal) => {
    setRoomListLoading(true); setRoomListError('');
    try {
      const response = await fetchPublicRooms(signal);
      setPublicRooms(response.rooms);
      setRoomListUpdatedAt(new Date(response.generatedAt));
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'AbortError') setRoomListError(errorMessage(reason, '无法读取房间列表'));
    } finally {
      if (!signal?.aborted) setRoomListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session || room) return;
    const controller = new AbortController();
    void refreshRoomList(controller.signal);
    const timer = window.setInterval(() => void refreshRoomList(controller.signal), 10_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [refreshRoomList, room, session]);

  const login = async () => {
    const normalized = username.trim();
    if (!USERNAME_PATTERN.test(normalized)) return setError('用户名需为 3-16 个中文、字母、数字或下划线');
    setLoading(true); setError('');
    try {
      const next = await createSession(normalized);
      setSession(next); setNickname(next.username);
    } catch (reason) { setError(errorMessage(reason, '无法连接服务器')); }
    finally { setLoading(false); }
  };

  const enterRoom = async (mode: 'create' | 'join', requestedCode?: string) => {
    if (!session) return;
    const displayName = nickname.trim();
    const code = (requestedCode ?? (mode === 'join' ? joinRoomCode : createRoomCode)).trim().toUpperCase();
    if (!NICKNAME_PATTERN.test(displayName)) return setError('昵称需为 1-16 个中文、字母、数字或下划线');
    if (!ROOM_CODE_PATTERN.test(code)) return setError('房间号需为 4-10 位字母或数字');
    setLoading(true); setError('');
    try {
      const connect = async (identity: SessionResponse) => {
        const client = new Client(getServerUrl());
        client.auth.token = identity.token;
        return mode === 'create'
          ? client.create<DemoRoomState>('energy_duel_demo', { nickname: displayName, roomCode: code })
          : client.joinById<DemoRoomState>(code, { nickname: displayName });
      };
      let joined: Room<DemoRoomState>;
      try { joined = await connect(session); }
      catch (reason) {
        if ((reason as { code?: number }).code !== 401) throw reason;
        const renewed = await createSession(session.username);
        setSession(renewed);
        joined = await connect(renewed);
      }
      joined.reconnection.minUptime = 1000;
      setRoom(joined);
      setJoinRoomCode(joined.roomId);
    } catch (reason) { setError(errorMessage(reason, mode === 'create' ? '创建房间失败，房间号可能已被使用' : '加入房间失败')); }
    finally { setLoading(false); }
  };

  const logout = async () => {
    await room?.leave(); clearSession(); setRoom(null); setSession(null); setUsername(''); setNickname('');
  };

  const tutorial = tutorialOpen ? <Suspense fallback={null}><Tutorial open onClose={() => setTutorialOpen(false)} /></Suspense> : null;

  if (!session) return <>
    <main className="shell auth-shell"><section className="panel auth-panel">
      <p className="eyebrow">JIAOSILA VS GONGGANG</p><h1>娇斯拉大战贡刚</h1>
      <p className="muted">输入用户名，建立你的无密码玩家身份。</p>
      <label>用户名<input value={username} maxLength={16} onChange={(event) => setUsername(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void login()} autoFocus /></label>
      {error && <p className="error">{error}</p>}
      <button className="primary-button" onClick={() => void login()} disabled={loading}>{loading ? '正在进入…' : '进入游戏'}</button>
      <div className="shell-links"><AnnouncementLauncher /><button className="text-button" type="button" onClick={() => setTutorialOpen(true)}>先看看怎么玩</button></div>
      <p className="warning">无密码模式不提供身份保护：知道用户名的人可以进入同一账号。</p>
    </section></main>{tutorial}</>;

  if (!room) return <>
    <main className="shell lobby-shell"><section className="panel lobby-panel lobby-hub">
      <header className="lobby-header">
        <div className="identity"><div><span className="status-dot" />账号：{session.username}</div><button className="danger-button compact-button" onClick={() => void logout()}>退出</button></div>
        <div className="lobby-title-row"><div><p className="eyebrow">MATCH LOBBY</p><h1>进入圆形竞技场</h1><p className="muted">输入房间号或从列表选择。默认操作始终是加入房间。</p></div><div className="lobby-support"><AnnouncementLauncher /><button className="text-button" type="button" onClick={() => setTutorialOpen(true)}>规则与教程</button></div></div>
        <label className="nickname-field">本局昵称<input value={nickname} maxLength={16} onChange={(event) => { setNickname(event.target.value); setError(''); }} /></label>
      </header>
      {error && <p className="error lobby-error">{error}</p>}

      <div className="lobby-main-grid">
        <section className="lobby-card quick-join-card">
          <div><p className="eyebrow">QUICK JOIN</p><h2>加入房间</h2><p className="muted">按下回车会加入，不会创建新房间。</p></div>
          <form onSubmit={(event) => { event.preventDefault(); void enterRoom('join'); }}>
            <label>房间号<input value={joinRoomCode} maxLength={10} placeholder="例如 DUEL88" autoFocus onChange={(event) => { setJoinRoomCode(normalizeRoomInput(event.target.value)); setError(''); }} /></label>
            <button className="primary-button" type="submit" disabled={loading || !joinRoomCode}>{loading ? '正在连接…' : '加入房间'}</button>
          </form>
        </section>

        <section className="lobby-card room-directory">
          <header><div><p className="eyebrow">OPEN ROOMS</p><h2>可加入房间</h2></div><button className="text-button" type="button" disabled={roomListLoading} onClick={() => void refreshRoomList()}>{roomListLoading ? '刷新中…' : '刷新'}</button></header>
          {roomListError ? <div className="room-list-state"><p className="error">{roomListError}</p><button className="secondary-button compact-button" onClick={() => void refreshRoomList()}>重试</button></div>
            : publicRooms.length === 0 ? <div className="room-list-state"><strong>{roomListLoading ? '正在寻找房间…' : '暂时没有可加入的房间'}</strong><small>你可以刷新列表，或在下方创建新房间。</small></div>
              : <div className="room-list">{publicRooms.map((entry) => <article key={entry.roomId} className="room-list-item"><div><strong>{entry.roomId}</strong><span>房主 {entry.hostNickname}</span><small>{formatCreatedAt(entry.createdAt)}</small></div><span className="room-population">{entry.clients}/{entry.maxClients}</span><button className="secondary-button compact-button" disabled={loading} onClick={() => void enterRoom('join', entry.roomId)}>加入</button></article>)}</div>}
          <small className="room-list-updated">{roomListUpdatedAt ? `更新于 ${roomListUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '每 10 秒自动刷新'}</small>
        </section>
      </div>

      <details className="create-room-section">
        <summary><span><strong>创建新房间</strong><small>只有确定要成为房主时才使用这里</small></span><span aria-hidden="true">＋</span></summary>
        <form onSubmit={(event) => { event.preventDefault(); void enterRoom('create'); }}>
          <label>新房间号<input value={createRoomCode} maxLength={10} onChange={(event) => { setCreateRoomCode(normalizeRoomInput(event.target.value)); setError(''); }} /></label>
          <button className="text-button" type="button" onClick={() => setCreateRoomCode(randomRoomCode())}>换一个随机房间号</button>
          <button className="secondary-button" type="submit" disabled={loading || !createRoomCode}>{loading ? '正在创建…' : '确认创建新房间'}</button>
        </form>
      </details>
    </section></main>{tutorial}</>;

  return <Suspense fallback={<main className="shell"><div className="route-loader">正在加载战场资源…</div></main>}>
    <GameRoomView room={room} session={session} onLeave={() => { setRoom(null); setJoinRoomCode(''); setCreateRoomCode(randomRoomCode()); }} />
  </Suspense>;
}

function randomRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function normalizeRoomInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatCreatedAt(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? `创建于 ${new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '等待玩家加入';
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
