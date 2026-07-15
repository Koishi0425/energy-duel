import type { PublicRoomListResponse, SessionResponse } from '@energy-duel/shared';

const STORAGE_KEY = 'energy-duel-session';

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
}

export function getServerUrl(): string {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  if (import.meta.env.DEV) return `http://${window.location.hostname}:2567`;
  return window.location.origin;
}

export async function createSession(username: string): Promise<SessionResponse> {
  const response = await fetch(`${getServerUrl()}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const body = await response.json() as SessionResponse & { error?: string };
  if (!response.ok) throw new Error(body.error || '无法创建会话');
  saveSession(body);
  return body;
}

export async function fetchPublicRooms(signal?: AbortSignal): Promise<PublicRoomListResponse> {
  const response = await fetch(`${getServerUrl()}/api/rooms`, { signal, cache: 'no-store' });
  const body = await response.json() as PublicRoomListResponse & { error?: string };
  if (!response.ok) throw new Error(body.error || '无法读取房间列表');
  return body;
}
