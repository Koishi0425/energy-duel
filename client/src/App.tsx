import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LobbySnapshotMessage, OnlinePlayerStatus, PublicOnlinePlayerSummary, PublicRoomSummary, SessionResponse, SyncedGameState, SyncedRoundLogEntry } from '@energy-duel/shared';
import { Client, type Room } from '@colyseus/sdk';
import type { RawBoardObjectCollection, RawSyncedPlayer } from './roomState';
import { authenticate, clearPresence, clearSession, fetchOnlinePlayers, fetchProfile, fetchPublicRooms, getServerUrl, loadSession, updatePresence } from './session';
import AnnouncementLauncher from './components/AnnouncementLauncher';

interface PlayerCollection { values(): IterableIterator<RawSyncedPlayer> }
interface RoundLogCollection { values(): IterableIterator<SyncedRoundLogEntry> }
export interface DemoRoomState {
  players?: PlayerCollection;
  boardObjects?: RawBoardObjectCollection;
  phase?: SyncedGameState['phase'];
  round?: number;
  gameNumber?: number;
  hostPlayerId?: string;
  lastResult?: string;
  roomMode?: SyncedGameState['roomMode'];
  roundLog?: RoundLogCollection;
}

type Route =
  | { page: 'login' }
  | { page: 'lobby' }
  | { page: 'room'; roomId: string }
  | { page: 'profile' }
  | { page: 'publicProfile'; accountId: string };

interface StoredRoomSession {
  accountId: string;
  roomId: string;
  reconnectionToken: string;
  savedAt: number;
}

interface PresenceSnapshot {
  status: OnlinePlayerStatus;
  roomId?: string;
  roomClients?: number;
  roomMaxClients?: number;
}

const GameRoomView = lazy(() => import('./GameRoomView'));
const Tutorial = lazy(() => import('./components/Tutorial'));
const ProfilePage = lazy(() => import('./ProfilePage'));
const PublicProfilePage = lazy(() => import('./PublicProfilePage'));
const USERNAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fff]{3,16}$/;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,10}$/;
const ACTIVE_ROOM_STORAGE_KEY = 'energy-duel-active-room-v1';
const ROOM_RECONNECT_MAX_AGE_MS = 60 * 60 * 1000;

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [session, setSession] = useState<SessionResponse | null>(() => loadSession());
  const [username, setUsername] = useState(() => loadSession()?.username ?? '');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [nickname, setNickname] = useState(() => loadSession()?.username ?? '');
  const [createRoomCode, setCreateRoomCode] = useState(() => randomRoomCode());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [room, setRoom] = useState<Room<DemoRoomState> | null>(null);
  const [error, setError] = useState('');
  const [roomRecoveryError, setRoomRecoveryError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]);
  const [roomListLoading, setRoomListLoading] = useState(false);
  const [roomListError, setRoomListError] = useState('');
  const [roomListUpdatedAt, setRoomListUpdatedAt] = useState<Date>();
  const [onlinePlayers, setOnlinePlayers] = useState<PublicOnlinePlayerSummary[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  const [roomPresence, setRoomPresence] = useState<PresenceSnapshot>();
  const [lobbyFeedAttempt, setLobbyFeedAttempt] = useState(0);
  const [lobbyFeedConnected, setLobbyFeedConnected] = useState(false);
  const restoringRoomRef = useRef('');
  const lobbyVersionRef = useRef(0);
  const lobbyFeedConnectedRef = useRef(false);
  const lobbyInitialLoadRef = useRef(false);

  const navigate = useCallback((path: string, replace = false) => {
    if (window.location.pathname === path) {
      setRoute(parseRoute(path));
      return;
    }
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setRoute(parseRoute(path));
  }, []);

  useEffect(() => {
    const handlePop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  useEffect(() => {
    if (!session || route.page !== 'login') return;
    navigate('/', true);
  }, [navigate, route.page, session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void fetchProfile(session).then((profile) => { if (!cancelled) setNickname(profile.nickname); }).catch((reason) => {
      if (!cancelled && /会话无效|过期/.test(errorMessage(reason, ''))) {
        clearSession();
        setSession(null);
        setError('登录已过期，请重新登录');
        navigate('/login', true);
      }
    });
    return () => { cancelled = true; };
  }, [navigate, session]);

  useEffect(() => {
    if (!room) {
      setRoomPresence(undefined);
      return;
    }
    const update = (state: DemoRoomState | undefined) => {
      const roomMode = state?.roomMode ?? 'standard';
      const roomClients = Array.from(state?.players?.values() ?? []).length || undefined;
      setRoomPresence({
        status: roomMode === 'training' ? 'training_room' : 'public_room',
        roomId: roomMode === 'training' ? undefined : room.roomId,
        roomClients,
        roomMaxClients: 20,
      });
    };
    room.onStateChange(update);
    update(room.state);
    return () => room.onStateChange.remove(update);
  }, [room]);

  const refreshRoomList = useCallback(async (signal?: AbortSignal, showLoading = true) => {
    if (showLoading) setRoomListLoading(true);
    setRoomListError('');
    try {
      const response = await fetchPublicRooms(signal);
      setPublicRooms(response.rooms);
      setRoomListUpdatedAt(new Date(response.generatedAt));
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'AbortError') setRoomListError(errorMessage(reason, '无法读取房间列表'));
    } finally {
      if (showLoading && !signal?.aborted) setRoomListLoading(false);
    }
  }, []);

  const refreshOnlinePlayers = useCallback(async (signal?: AbortSignal, showLoading = true) => {
    if (!session) return;
    if (showLoading) setOnlineLoading(true);
    setOnlineError('');
    try {
      const response = await fetchOnlinePlayers(session, signal);
      setOnlinePlayers(response.players);
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'AbortError') setOnlineError(errorMessage(reason, '无法读取在线玩家'));
    } finally {
      if (showLoading && !signal?.aborted) setOnlineLoading(false);
    }
  }, [session]);

  useEffect(() => {
    lobbyFeedConnectedRef.current = lobbyFeedConnected;
  }, [lobbyFeedConnected]);

  useEffect(() => {
    if (!session || route.page !== 'lobby' || room) lobbyInitialLoadRef.current = false;
  }, [room, route.page, session]);

  useEffect(() => {
    if (!session || route.page !== 'lobby' || room) return;
    const controller = new AbortController();
    let disposed = false;
    let removeSnapshot: (() => void) | undefined;
    let subscription: Room<unknown> | undefined;
    let retryTimer: number | undefined;
    let fallbackTicks = 0;
    const showInitialLoading = !lobbyInitialLoadRef.current;
    lobbyInitialLoadRef.current = true;
    lobbyVersionRef.current = 0;
    setLobbyFeedConnected(false);
    void refreshRoomList(controller.signal, showInitialLoading);
    void refreshOnlinePlayers(controller.signal, showInitialLoading);
    const timer = window.setInterval(() => {
      fallbackTicks += 1;
      if (!lobbyFeedConnectedRef.current || fallbackTicks >= 6) {
        fallbackTicks = 0;
        void refreshRoomList(controller.signal, false);
        void refreshOnlinePlayers(controller.signal, false);
      }
    }, 10_000);
    const retry = () => {
      if (disposed || retryTimer !== undefined) return;
      setLobbyFeedConnected(false);
      retryTimer = window.setTimeout(() => setLobbyFeedAttempt((attempt) => attempt + 1), 1_500);
    };
    const client = new Client(getServerUrl());
    client.auth.token = session.token;
    void client.joinOrCreate('lobby_feed').then((joined) => {
      if (disposed) {
        void joined.leave();
        return;
      }
      subscription = joined;
      joined.reconnection.minUptime = 1_000;
      removeSnapshot = joined.onMessage('lobby_snapshot', (payload: LobbySnapshotMessage) => {
        if (!isLobbySnapshot(payload) || payload.version <= lobbyVersionRef.current) return;
        lobbyVersionRef.current = payload.version;
        setPublicRooms(payload.rooms);
        setOnlinePlayers(payload.players);
        setRoomListUpdatedAt(new Date(payload.generatedAt));
        setRoomListError(''); setOnlineError('');
        setRoomListLoading(false); setOnlineLoading(false);
      });
      joined.onReconnect(() => joined.send('request_snapshot'));
      joined.onLeave(retry);
      setLobbyFeedConnected(true);
      joined.send('request_snapshot');
    }).catch(retry);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      removeSnapshot?.();
      if (subscription) void subscription.leave();
    };
  }, [lobbyFeedAttempt, refreshOnlinePlayers, refreshRoomList, room, route.page, session]);

  const presencePayload = useMemo<PresenceSnapshot>(() => roomPresence ?? { status: 'idle' }, [roomPresence]);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const send = () => void updatePresence(session, presencePayload, controller.signal).catch(() => undefined);
    send();
    const timer = window.setInterval(send, 15_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [presencePayload, session]);

  useEffect(() => {
    if (!session || !room) return;
    const save = () => saveActiveRoom(session, room);
    save();
    const timer = window.setInterval(save, 5000);
    return () => window.clearInterval(timer);
  }, [room, session]);

  const attachRoom = useCallback((joined: Room<DemoRoomState>, identity: SessionResponse, replaceRoute = false) => {
    joined.reconnection.minUptime = 1000;
    setRoom(joined);
    setError('');
    setRoomRecoveryError('');
    saveActiveRoom(identity, joined);
    navigate(`/rooms/${joined.roomId}`, replaceRoute);
  }, [navigate]);

  const enterRoom = useCallback(async (mode: 'create' | 'join' | 'training', requestedCode?: string) => {
    if (!session) return;
    if (mode === 'join' && !requestedCode) return setError('请从房间列表选择房间，或打开带房间号的链接进入。');
    const code = (requestedCode ?? (mode === 'training' ? `DOJO${randomRoomCode().slice(0, 5)}` : createRoomCode)).trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(code)) return setError('房间号需要 4-10 位字母或数字');
    setLoading(true); setError('');
    try {
      const profile = await fetchProfile(session);
      const client = new Client(getServerUrl());
      client.auth.token = session.token;
      const joined = mode !== 'join'
        ? await client.create<DemoRoomState>('energy_duel_demo', { nickname: profile.nickname, roomCode: code, roomMode: mode === 'training' ? 'training' : 'standard' })
        : await client.joinById<DemoRoomState>(code, { nickname: profile.nickname });
      attachRoom(joined, session);
      setCreateDialogOpen(false);
    } catch (reason) {
      if ((reason as { code?: number }).code === 401) {
        clearSession();
        setSession(null);
        navigate('/login', true);
        setError('登录已过期，请重新登录');
      } else {
        setError(errorMessage(reason, mode === 'join' ? '加入房间失败' : '创建房间失败，房间号可能已被使用'));
      }
    } finally {
      setLoading(false);
    }
  }, [attachRoom, createRoomCode, navigate, session]);

  useEffect(() => {
    if (!session || room || route.page !== 'room') return;
    const roomId = normalizeRoomInput(route.roomId);
    if (!ROOM_CODE_PATTERN.test(roomId) || restoringRoomRef.current === roomId) return;
    restoringRoomRef.current = roomId;
    setLoading(true); setRoomRecoveryError('');
    void (async () => {
      try {
        const client = new Client(getServerUrl());
        client.auth.token = session.token;
        const stored = loadActiveRoom(session.accountId, roomId);
        let joined: Room<DemoRoomState> | undefined;
        if (stored) {
          try { joined = await client.reconnect<DemoRoomState>(stored.reconnectionToken); }
          catch { forgetActiveRoom(roomId); }
        }
        if (!joined) {
          const profile = await fetchProfile(session);
          joined = await client.joinById<DemoRoomState>(roomId, { nickname: profile.nickname });
        }
        attachRoom(joined, session, true);
      } catch (reason) {
        setRoomRecoveryError(errorMessage(reason, '无法恢复房间。可能房间已关闭，或你的重连席位已经过期。'));
      } finally {
        setLoading(false);
        restoringRoomRef.current = '';
      }
    })();
  }, [attachRoom, room, route, session]);

  const login = async () => {
    const normalized = username.trim();
    if (!USERNAME_PATTERN.test(normalized)) return setError('用户名需要 3-16 个中文、字母、数字或下划线');
    if (password.length < 7) return setError('密码至少需要 7 个字符');
    setLoading(true); setError('');
    try {
      const next = await authenticate(authMode, normalized, password);
      setSession(next);
      setNickname(next.username);
      if (route.page === 'login') navigate('/', true);
    } catch (reason) { setError(errorMessage(reason, '无法连接服务器')); }
    finally { setLoading(false); }
  };

  const leaveCurrentRoom = useCallback((options: { clearStoredRoom?: boolean; navigateHome?: boolean } = {}) => {
    if (room && options.clearStoredRoom !== false) forgetActiveRoom(room.roomId);
    setRoom(null);
    setCreateRoomCode(randomRoomCode());
    if (options.navigateHome !== false) navigate('/', true);
  }, [navigate, room]);

  const logout = async () => {
    if (room) {
      forgetActiveRoom(room.roomId);
      await room.leave();
    }
    if (session) await clearPresence(session);
    clearSession();
    setRoom(null); setSession(null); setUsername(''); setPassword(''); setNickname('');
    navigate('/login', true);
  };

  const tutorial = tutorialOpen ? <Suspense fallback={null}><Tutorial open onClose={() => setTutorialOpen(false)} /></Suspense> : null;

  if (!session) return <>
    <main className="shell auth-shell"><section className="panel auth-panel">
      <p className="eyebrow">JIAOSILA VS GONGGANG</p><h1>娇斯拉大战贡刚</h1>
      <p className="muted">{route.page === 'room' ? `登录后会继续进入房间 ${route.roomId}。` : authMode === 'login' ? '使用用户名和密码进入游戏。' : '注册一个新的玩家账号。'}</p>
      <div className="auth-mode-switch"><button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setError(''); }}>登录</button><button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setError(''); }}>注册</button></div>
      <label>用户名<input value={username} maxLength={16} autoComplete="username" onChange={(event) => setUsername(event.target.value)} autoFocus /></label>
      <label>密码<input type="password" value={password} maxLength={128} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void login()} /></label>
      {error && <p className="error">{error}</p>}
      <button className="primary-button" onClick={() => void login()} disabled={loading}>{loading ? '正在处理...' : authMode === 'register' ? '注册并进入' : '登录'}</button>
      <div className="shell-links"><AnnouncementLauncher /><button className="text-button" type="button" onClick={() => setTutorialOpen(true)}>先看看怎么玩</button></div>
      {authMode === 'register' && <p className="warning">用户名注册后不可重复使用；密码至少需要 7 个字符。</p>}
    </section></main>{tutorial}</>;

  if (route.page === 'profile') return <Suspense fallback={<main className="shell"><div className="route-loader">正在加载个人资料...</div></main>}><ProfilePage session={session} onBack={() => navigate('/')} onProfileChange={(profile) => setNickname(profile.nickname)} /></Suspense>;

  if (route.page === 'publicProfile') return <Suspense fallback={<main className="shell"><div className="route-loader">正在加载玩家资料...</div></main>}><PublicProfilePage session={session} accountId={route.accountId} onBack={() => navigate('/')} /></Suspense>;

  if (room) return <Suspense fallback={<BattlefieldLoader />}><GameRoomView room={room} session={session} onLeave={() => leaveCurrentRoom({ clearStoredRoom: true, navigateHome: true })} /></Suspense>;

  if (route.page === 'room') return <main className="shell"><section className="panel room-recover-panel">
    <p className="eyebrow">ROOM LINK</p><h1>房间 {route.roomId}</h1>
    <p className="muted">{loading ? '正在尝试恢复你的房间席位...' : '无法直接进入这个房间。你可以重试，或返回大厅选择其他房间。'}</p>
    {roomRecoveryError && <p className="error">{roomRecoveryError}</p>}
    <div className="lobby-actions"><button className="primary-button" disabled={loading} onClick={() => { restoringRoomRef.current = ''; setRoomRecoveryError(''); setRoute({ page: 'room', roomId: route.roomId }); }}>{loading ? '连接中...' : '重试进入'}</button><button className="secondary-button" onClick={() => { setRoomRecoveryError(''); navigate('/'); }}>返回大厅</button></div>
  </section></main>;

  return <>
    <main className="shell lobby-shell"><section className="panel lobby-panel lobby-hub">
      <header className="lobby-header">
        <div className="identity"><div><span className="status-dot" />账号：{session.username}<span className="identity-nickname">昵称：{nickname}</span></div><div className="identity-actions"><button className="secondary-button compact-button" onClick={() => navigate('/profile')}>个人资料</button><button className="danger-button compact-button" onClick={() => void logout()}>退出</button></div></div>
        <div className="lobby-title-row"><div><p className="eyebrow">MATCH LOBBY</p><h1>进入圆形竞技场</h1><p className="muted">从公开房间加入，或创建新的对局房间。</p></div><div className="lobby-support"><AnnouncementLauncher /><button className="text-button" type="button" onClick={() => setTutorialOpen(true)}>规则与教程</button></div></div>
      </header>
      {error && <p className="error lobby-error">{error}</p>}

      <div className="lobby-main-grid lobby-main-grid-modern">
        <section className="lobby-card room-directory">
          <header className="directory-toolbar"><div><p className="eyebrow">OPEN ROOMS</p><h2>可加入房间</h2></div><div className="directory-actions"><button className="secondary-button compact-button" type="button" disabled={roomListLoading} onClick={() => void refreshRoomList()}>{roomListLoading ? '刷新中...' : '刷新'}</button><button className="primary-button compact-button" type="button" onClick={() => setCreateDialogOpen(true)}>创建</button></div></header>
          {roomListError ? <div className="room-list-state"><p className="error">{roomListError}</p><button className="secondary-button compact-button" onClick={() => void refreshRoomList()}>重试</button></div>
            : publicRooms.length === 0 ? <div className="room-list-state"><strong>{roomListLoading ? '正在寻找房间...' : '暂时没有可加入的房间'}</strong><small>可以刷新列表，或点击上方创建新房间。</small></div>
              : <div className="room-list">{publicRooms.map((entry) => <article key={entry.roomId} className="room-list-item"><div><strong>{entry.roomId}</strong><span>房主 {entry.hostNickname}</span><small>{formatCreatedAt(entry.createdAt)}</small></div><span className="room-population">{entry.clients}/{entry.maxClients}</span><button className="secondary-button compact-button" disabled={loading} onClick={() => void enterRoom('join', entry.roomId)}>加入</button></article>)}</div>}
          <small className="room-list-updated">{roomListUpdatedAt ? `更新于 ${roomListUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '每 10 秒自动刷新'}</small>
        </section>

        <section className="lobby-card online-directory">
          <header><div><p className="eyebrow">ONLINE</p><h2>在线玩家</h2></div><button className="text-button" type="button" disabled={onlineLoading} onClick={() => void refreshOnlinePlayers()}>{onlineLoading ? '刷新中...' : '刷新'}</button></header>
          {onlineError ? <div className="room-list-state"><p className="error">{onlineError}</p></div>
            : onlinePlayers.length === 0 ? <div className="room-list-state"><strong>{onlineLoading ? '正在读取在线玩家...' : '当前没有其他在线玩家'}</strong><small>登录中的玩家会显示在这里。</small></div>
              : <div className="online-list">{onlinePlayers.map((player) => <OnlinePlayerCard key={player.accountId} player={player} onOpenProfile={() => navigate(`/profiles/${player.accountId}`)} onJoinRoom={player.status === 'public_room' && player.roomId ? () => void enterRoom('join', player.roomId) : undefined} />)}</div>}
        </section>
      </div>

      <section className="training-room-card">
        <div><p className="eyebrow">TRAINING ROOM</p><h2>练功房</h2><p className="muted">创建不公开的私人房间，自定义练习角色，并由你操控所有角色完成回合。</p></div>
        <button className="secondary-button" type="button" disabled={loading} onClick={() => void enterRoom('training')}>{loading ? '正在创建...' : '进入练功房'}</button>
      </section>
    </section></main>
    {createDialogOpen && <CreateRoomDialog roomCode={createRoomCode} loading={loading} onChange={(value) => { setCreateRoomCode(normalizeRoomInput(value)); setError(''); }} onRandom={() => setCreateRoomCode(randomRoomCode())} onCancel={() => setCreateDialogOpen(false)} onCreate={() => void enterRoom('create')} />}
    {tutorial}
  </>;
}

function OnlinePlayerCard({ player, onOpenProfile, onJoinRoom }: { player: PublicOnlinePlayerSummary; onOpenProfile: () => void; onJoinRoom?: () => void }) {
  return <article className="online-player-card">
    <button type="button" className="online-player-main" onClick={onOpenProfile}>
      <span className="online-avatar">{player.avatarUrl ? <img src={profileAssetUrl(player.avatarUrl)} alt="" /> : player.nickname.slice(0, 1).toUpperCase()}</span>
      <span><strong>{player.nickname}</strong><small>@{player.username} · Lv.{player.level} · Rating {player.rating}</small><em>{onlineStatusText(player)}</em></span>
    </button>
    {onJoinRoom && <button className="secondary-button compact-button" type="button" onClick={onJoinRoom}>加入</button>}
  </article>;
}

function CreateRoomDialog({ roomCode, loading, onChange, onRandom, onCancel, onCreate }: { roomCode: string; loading: boolean; onChange: (value: string) => void; onRandom: () => void; onCancel: () => void; onCreate: () => void }) {
  return <div className="modal-backdrop"><section className="create-room-dialog" role="dialog" aria-modal="true">
    <header><div><p className="eyebrow">CREATE ROOM</p><h2>创建新房间</h2></div><button type="button" aria-label="关闭" onClick={onCancel}>×</button></header>
    <label>房间号<input value={roomCode} maxLength={10} onChange={(event) => onChange(event.target.value)} autoFocus /></label>
    <p className="muted">确认后会直接进入房间。房间号会出现在地址里，可以发给其他玩家加入。</p>
    <footer><button className="text-button" type="button" onClick={onRandom}>换一个随机房间号</button><div><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="button" disabled={loading || !roomCode} onClick={onCreate}>{loading ? '正在创建...' : '确认创建'}</button></div></footer>
  </section></div>;
}

function BattlefieldLoader() {
  return <main className="shell battlefield-loader"><div className="loader-card"><p className="eyebrow">PREPARING ARENA</p><h2>正在加载战场</h2><div className="loading-track"><span /></div><p className="muted">正在加载战斗界面与绘图引擎...</p></div></main>;
}

function parseRoute(pathname: string): Route {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/login') return { page: 'login' };
  if (normalized === '/profile') return { page: 'profile' };
  const roomMatch = /^\/rooms\/([A-Z0-9]{4,10})$/i.exec(normalized);
  if (roomMatch) return { page: 'room', roomId: roomMatch[1].toUpperCase() };
  const profileMatch = /^\/profiles\/([0-9a-f-]{36})$/i.exec(normalized);
  if (profileMatch) return { page: 'publicProfile', accountId: profileMatch[1] };
  return { page: 'lobby' };
}

function isLobbySnapshot(value: unknown): value is LobbySnapshotMessage {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<LobbySnapshotMessage>;
  return typeof snapshot.version === 'number'
    && Number.isInteger(snapshot.version)
    && Array.isArray(snapshot.rooms)
    && Array.isArray(snapshot.players)
    && typeof snapshot.generatedAt === 'string';
}

function saveActiveRoom(session: SessionResponse, room: Room<DemoRoomState>): void {
  if (!room.reconnectionToken) return;
  const value: StoredRoomSession = { accountId: session.accountId, roomId: room.roomId, reconnectionToken: room.reconnectionToken, savedAt: Date.now() };
  localStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, JSON.stringify(value));
}

function loadActiveRoom(accountId: string, roomId: string): StoredRoomSession | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_ROOM_STORAGE_KEY) ?? 'null') as Partial<StoredRoomSession> | null;
    if (!parsed || parsed.accountId !== accountId || parsed.roomId !== roomId || typeof parsed.reconnectionToken !== 'string') return undefined;
    if (Date.now() - Number(parsed.savedAt ?? 0) > ROOM_RECONNECT_MAX_AGE_MS) return undefined;
    return parsed as StoredRoomSession;
  } catch {
    return undefined;
  }
}

function forgetActiveRoom(roomId?: string): void {
  if (!roomId) return localStorage.removeItem(ACTIVE_ROOM_STORAGE_KEY);
  const stored = loadStoredRoom();
  if (!stored || stored.roomId === roomId) localStorage.removeItem(ACTIVE_ROOM_STORAGE_KEY);
}

function loadStoredRoom(): StoredRoomSession | undefined {
  try { return JSON.parse(localStorage.getItem(ACTIVE_ROOM_STORAGE_KEY) ?? 'null') as StoredRoomSession | undefined; }
  catch { return undefined; }
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

function onlineStatusText(player: PublicOnlinePlayerSummary): string {
  if (player.status === 'training_room') return '练功房中';
  if (player.status === 'public_room' && player.roomId) return `房间 ${player.roomId}${player.roomClients !== undefined && player.roomMaxClients !== undefined ? ` · ${player.roomClients}/${player.roomMaxClients}` : ''}`;
  return '空闲中';
}

function profileAssetUrl(pathname: string): string {
  return pathname.startsWith('http') ? pathname : `${getServerUrl()}${pathname}`;
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
