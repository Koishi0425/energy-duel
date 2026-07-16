import { PROFILE_NAMEPLATES, PROFILE_TITLES, PROFILE_TITLE_RARITIES, profileLevelTier, type PlayerProfile, type RankId } from '@energy-duel/shared';
import type { CSSProperties } from 'react';
import { getServerUrl } from '../session';

export const rankNames: Record<RankId, string> = {
  unranked: '无段位', iron: '坚韧黑铁', bronze: '英勇黄铜', silver: '不屈白银', gold: '荣耀黄金', platinum: '华贵铂金',
  emerald: '流光翡翠', diamond: '璀璨钻石', master: '超凡大师', grandmaster: '傲世宗师', challenger: '最强王者',
};

export default function PlayerProfileBanner({ profile, onAvatarClick }: { profile: PlayerProfile; onAvatarClick?: () => void }) {
  const avatar = profile.avatarUrl ? <img src={`${getServerUrl()}${profile.avatarUrl}`} alt="玩家头像" /> : <span>{profile.nickname.slice(0, 1).toUpperCase()}</span>;
  const nameplateUrl = PROFILE_NAMEPLATES.find((item) => item.id === profile.nameplateId)?.assetUrl;
  const title = PROFILE_TITLES.find((item) => item.id === profile.titleId);
  const titleRarity = PROFILE_TITLE_RARITIES[title?.rarity ?? 'normal'];
  const levelTier = profileLevelTier(profile.level);
  return <section
    className={`player-banner nameplate-${profile.nameplateId}`}
    style={{ '--nameplate-image': nameplateUrl ? `url("${nameplateUrl}")` : 'linear-gradient(90deg, transparent, transparent)' } as CSSProperties}
  >
    {onAvatarClick
      ? <button className="profile-avatar" type="button" onClick={onAvatarClick} aria-label="更换头像">{avatar}<small>更换</small></button>
      : <div className="profile-avatar profile-avatar-static">{avatar}</div>}
    <div className="rating-block"><small>RATING</small><strong>{profile.rating.toString().padStart(5, '0')}</strong></div>
    <div className="banner-identity"><strong>{profile.nickname}</strong><span>{rankNames[profile.rankId]}</span></div>
    <div className={`banner-title-line title-rarity-${titleRarity.id}`} style={{ '--title-strip-image': `url("${titleRarity.assetUrl}")` } as CSSProperties}><span>{title?.name ?? profile.titleId}</span></div>
    <div className={`level-orb level-tier-${levelTier}`}><small>LV</small><strong>{profile.level}</strong></div>
  </section>;
}
