import type { PlayerProfile } from '@energy-duel/shared';
import PlayerProfileBanner, { rankNames } from './PlayerProfileBanner';

export default function PublicProfileDetails({ profile }: { profile: PlayerProfile }) {
  const winRate = profile.stats.totalGames ? `${(profile.stats.wins / profile.stats.totalGames * 100).toFixed(1)}%` : '0.0%';
  return <div className="public-profile-details">
    <PlayerProfileBanner profile={profile} />
    <section className="public-profile-section">
      <header><div><p className="eyebrow">CAREER</p><h3>生涯统计</h3></div><span>@{profile.username}</span></header>
      <div className="stat-grid"><Stat label="总局数" value={profile.stats.totalGames} /><Stat label="胜场" value={profile.stats.wins} /><Stat label="胜率" value={winRate} /><Stat label="最高连胜" value={profile.stats.bestWinStreak} /></div>
      <dl className="profile-facts"><div><dt>段位</dt><dd>{rankNames[profile.rankId]}</dd></div><div><dt>Rating</dt><dd>{profile.rating} / 16500</dd></div><div><dt>历史最佳 35 局</dt><dd>{profile.ratingBest35}</dd></div><div><dt>最近 15 局</dt><dd>{profile.ratingRecent15}</dd></div><div><dt>等级经验</dt><dd>Lv.{profile.level} · {profile.experience} EXP</dd></div></dl>
    </section>
  </div>;
}

function Stat({ label, value }: { label: string; value: string | number }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
