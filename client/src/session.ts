import type { PlayerProfile, ProfileUpdateRequest, PublicRoomListResponse, SessionResponse } from '@energy-duel/shared';

const STORAGE_KEY = 'energy-duel-session-v2';

export function loadSession(): SessionResponse | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) as SessionResponse : null;
  } catch {
    return null;
  }
}

export function saveSession(session: SessionResponse): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('energy-duel-session');
}

export function getServerUrl(): string {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  if (import.meta.env.DEV) return `http://${window.location.hostname}:2567`;
  return window.location.origin;
}

export async function authenticate(mode: 'login' | 'register', username: string, password: string): Promise<SessionResponse> {
  const response = await fetch(`${getServerUrl()}/api/auth/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json() as SessionResponse & { error?: string };
  if (!response.ok) throw new Error(body.error || (mode === 'register' ? '注册失败' : '登录失败'));
  saveSession(body);
  return body;
}

export async function fetchProfile(session: SessionResponse): Promise<PlayerProfile> {
  return profileRequest(session, '/api/profile');
}

export async function fetchPlayerProfile(session: SessionResponse, accountId: string): Promise<PlayerProfile> {
  return profileRequest(session, `/api/profiles/${encodeURIComponent(accountId)}`);
}

export async function updateProfile(session: SessionResponse, update: ProfileUpdateRequest): Promise<PlayerProfile> {
  return profileRequest(session, '/api/profile', { method: 'PATCH', body: JSON.stringify(update) });
}

export async function uploadAvatar(session: SessionResponse, avatarDataUrl: string): Promise<PlayerProfile> {
  return profileRequest(session, '/api/profile/avatar', { method: 'PUT', body: JSON.stringify({ avatarDataUrl }) });
}

async function profileRequest(session: SessionResponse, pathname: string, init: RequestInit = {}): Promise<PlayerProfile> {
  const response = await fetch(`${getServerUrl()}${pathname}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}`, ...init.headers } });
  const body = await response.json() as PlayerProfile & { error?: string };
  if (!response.ok) throw new Error(body.error || '无法读取个人资料');
  return body;
}

export async function fetchPublicRooms(signal?: AbortSignal): Promise<PublicRoomListResponse> {
  const response = await fetch(`${getServerUrl()}/api/rooms`, { signal, cache: 'no-store' });
  const body = await response.json() as PublicRoomListResponse & { error?: string };
  if (!response.ok) throw new Error(body.error || '无法读取房间列表');
  return body;
}
