import { useEffect, useState } from 'react';
import type { PlayerProfile, SessionResponse } from '@energy-duel/shared';
import { fetchPlayerProfile } from './session';
import PublicProfileDetails from './components/PublicProfileDetails';

interface Props {
  session: SessionResponse;
  accountId: string;
  onBack: () => void;
}

export default function PublicProfilePage({ session, accountId, onBack }: Props) {
  const [profile, setProfile] = useState<PlayerProfile>();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setProfile(undefined);
    setError('');
    void fetchPlayerProfile(session, accountId)
      .then((value) => { if (!cancelled) setProfile(value); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error && reason.message ? reason.message : '无法读取玩家资料'); });
    return () => { cancelled = true; };
  }, [accountId, session]);

  return <main className="profile-page">
    <header className="profile-topbar"><button className="secondary-button compact-button" onClick={onBack}>返回大厅</button></header>
    {profile ? <PublicProfileDetails profile={profile} /> : <div className={error ? 'profile-loading error' : 'profile-loading'}>{error || '正在读取玩家资料...'}</div>}
  </main>;
}
