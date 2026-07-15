import { lazy, Suspense, useEffect, useState } from 'react';
import type { SessionResponse, SyncedGameState, SyncedRoundLogEntry } from '@energy-duel/shared';
import { Client, type Room } from '@colyseus/sdk';
import type { RawSyncedPlayer } from './roomState';
import { clearSession, createSession, getServerUrl, loadSession } from './session';
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
  const [roomCode, setRoomCode] = useState(() => randomRoomCode());
  const [room, setRoom] = useState<Room<DemoRoomState> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  useEffect(() => () => { void room?.leave(); }, [room]);

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

  const enterRoom = async (mode: 'create' | 'join') => {
    if (!session) return;
    const displayName = nickname.trim();
    const code = roomCode.trim().toUpperCase();
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
      setRoomCode(joined.roomId);
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
    <main className="shell lobby-shell"><section className="panel lobby-panel">
      <div className="identity"><div><span className="status-dot" />账号：{session.username}</div><button className="danger-button compact-button" onClick={() => void logout()}>退出</button></div>
      <h1>圆形竞技场</h1><p className="muted">创建一个好记的房间号，让朋友直接输入加入。</p>
      <label>房间昵称<input value={nickname} maxLength={16} onChange={(event) => setNickname(event.target.value)} /></label>
      <label>房间号<input value={roomCode} maxLength={10} placeholder="例如 DUEL88" onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} onKeyDown={(event) => event.key === 'Enter' && void enterRoom('join')} /></label>
      <button className="text-button" type="button" onClick={() => setRoomCode(randomRoomCode())}>换一个随机房间号</button>
      {error && <p className="error">{error}</p>}
      <div className="lobby-actions"><button className="primary-button" onClick={() => void enterRoom('create')} disabled={loading}>{loading ? '处理中…' : '创建房间'}</button><button className="secondary-button" onClick={() => void enterRoom('join')} disabled={loading}>快速加入</button></div>
      <div className="shell-links"><AnnouncementLauncher /><button className="text-button" type="button" onClick={() => setTutorialOpen(true)}>打开规则与角色教程</button></div>
    </section></main>{tutorial}</>;

  return <Suspense fallback={<main className="shell"><div className="route-loader">正在加载战场资源…</div></main>}>
    <GameRoomView room={room} session={session} onLeave={() => { setRoom(null); setRoomCode(randomRoomCode()); }} />
  </Suspense>;
}

function randomRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
