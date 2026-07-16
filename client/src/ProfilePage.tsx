import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { PROFILE_NAMEPLATES, PROFILE_TITLES, type PlayerProfile, type RankId, type SessionResponse } from '@energy-duel/shared';
import { fetchProfile, getServerUrl, updateProfile, uploadAvatar } from './session';

interface Props { session: SessionResponse; onBack: () => void; onProfileChange: (profile: PlayerProfile) => void }
type Section = 'overview' | 'career' | 'achievements' | 'history';
const rankNames: Record<RankId, string> = { unranked: '无段位', iron: '坚韧黑铁', bronze: '英勇黄铜', silver: '不屈白银', gold: '荣耀黄金', platinum: '华贵铂金', emerald: '流光翡翠', diamond: '璀璨钻石', master: '超凡大师', grandmaster: '傲世宗师', challenger: '最强王者' };

export default function ProfilePage({ session, onBack, onProfileChange }: Props) {
  const [profile, setProfile] = useState<PlayerProfile>();
  const [section, setSection] = useState<Section>('overview');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);

  useEffect(() => { let cancelled = false; void fetchProfile(session).then((value) => { if (!cancelled) { setProfile(value); setNickname(value.nickname); } }).catch((reason) => { if (!cancelled) setError(message(reason, '无法读取个人资料')); }); return () => { cancelled = true; }; }, [session]);
  const apply = (next: PlayerProfile) => { setProfile(next); setNickname(next.nickname); onProfileChange(next); };
  const saveBasics = async () => {
    if (!profile) return; setSaving(true); setError(''); setNotice('');
    try { const next = await updateProfile(session, { nickname, nameplateId: profile.nameplateId, titleId: profile.titleId }); apply(next); setNotice('个人资料已保存'); }
    catch (reason) { setError(message(reason, '保存失败')); } finally { setSaving(false); }
  };

  if (!profile) return <main className="profile-page"><header className="profile-topbar"><button className="secondary-button" onClick={onBack}>← 返回大厅</button></header><div className="profile-loading">{error || '正在读取个人资料…'}</div></main>;
  const winRate = profile.stats.totalGames ? (profile.stats.wins / profile.stats.totalGames * 100).toFixed(1) : '0.0';
  const currentLevelStart = profile.level === 1 ? 0 : levelThreshold(profile.level);
  const levelProgress = Math.max(0, Math.min(100, (profile.experience - currentLevelStart) / Math.max(1, profile.experienceForNextLevel - currentLevelStart) * 100));

  return <main className="profile-page">
    <header className="profile-topbar"><button className="secondary-button compact-button" onClick={onBack}>← 返回大厅</button><div><span className="status-dot" />{session.username}</div></header>
    <section
      className={`player-banner nameplate-${profile.nameplateId}`}
      style={{ '--nameplate-image': `url("/assets/profiles/nameplates/${profile.nameplateId}/frame.webp")` } as CSSProperties}
    >
      <button className="profile-avatar" type="button" onClick={() => setCropOpen(true)} aria-label="更换头像">{profile.avatarUrl ? <img src={`${getServerUrl()}${profile.avatarUrl}`} alt="玩家头像" /> : <span>{profile.nickname.slice(0, 1).toUpperCase()}</span>}<small>更换</small></button>
      <div className="rating-block"><small>RATING</small><strong>{profile.rating.toString().padStart(5, '0')}</strong></div>
      <div className="banner-identity"><strong>{profile.nickname}</strong><span>{rankNames[profile.rankId]}</span></div>
      <div className="banner-title-line">{PROFILE_TITLES.find((item) => item.id === profile.titleId)?.name ?? profile.titleId}</div>
      <div className="level-orb"><small>LV</small><strong>{profile.level}</strong></div>
    </section>

    <nav className="profile-tabs">{([['overview', '资料设置'], ['career', '生涯统计'], ['achievements', '成就'], ['history', '对局历史']] as Array<[Section, string]>).map(([id, label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>{label}</button>)}</nav>
    <div className="profile-content">
      {section === 'overview' && <div className="profile-grid"><section className="profile-card"><h2>基础资料</h2><label>昵称<input value={nickname} maxLength={16} onChange={(event) => setNickname(event.target.value)} /></label><label>姓名框<select value={profile.nameplateId} onChange={(event) => setProfile({ ...profile, nameplateId: event.target.value })}>{PROFILE_NAMEPLATES.map((item) => <option key={item.id} value={item.id} disabled={!profile.unlockedNameplateIds.includes(item.id)}>{item.name}{profile.unlockedNameplateIds.includes(item.id) ? '' : '（未解锁）'}</option>)}</select></label><label>称号<select value={profile.titleId} onChange={(event) => setProfile({ ...profile, titleId: event.target.value })}>{PROFILE_TITLES.map((item) => <option key={item.id} value={item.id} disabled={!profile.unlockedTitleIds.includes(item.id)}>{item.name}{profile.unlockedTitleIds.includes(item.id) ? '' : '（未解锁）'}</option>)}</select></label>{error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}<button className="primary-button" disabled={saving} onClick={() => void saveBasics()}>{saving ? '保存中…' : '保存资料'}</button></section><section className="profile-card"><h2>成长进度</h2><div className="level-summary"><strong>等级 {profile.level}</strong><span>{profile.experience} / {profile.experienceForNextLevel} EXP</span></div><div className="experience-track"><span style={{ width: `${levelProgress}%` }} /></div><p className="muted">升级需求逐级提高；练功房不累计经验或 Rating。</p><dl className="profile-facts"><div><dt>当前段位</dt><dd>{rankNames[profile.rankId]}</dd></div><div><dt>Rating</dt><dd>{profile.rating} / 16500</dd></div><div><dt>历史最佳 35 局</dt><dd>{profile.ratingBest35}</dd></div><div><dt>最近 15 局</dt><dd>{profile.ratingRecent15}</dd></div>{profile.lastGameScore !== undefined && <div><dt>最近单局表现</dt><dd>{profile.lastGameScore} / 330</dd></div>}<div><dt>注册时间</dt><dd>{new Date(profile.createdAt).toLocaleDateString()}</dd></div></dl></section></div>}
      {section === 'career' && <section className="profile-card"><div className="section-heading"><div><p className="eyebrow">CAREER</p><h2>生涯统计</h2></div><span>正式房间数据</span></div><div className="stat-grid"><Stat label="总局数" value={profile.stats.totalGames} /><Stat label="胜场" value={profile.stats.wins} /><Stat label="胜率" value={`${winRate}%`} /><Stat label="负场" value={profile.stats.losses} /><Stat label="平局" value={profile.stats.draws} /><Stat label="最高连胜" value={profile.stats.bestWinStreak} /></div><p className="empty-feature">角色使用率、角色胜率和技能统计将在对局记录接入后显示。</p></section>}
      {section === 'achievements' && <FeaturePlaceholder eyebrow="ACHIEVEMENTS" title="成就陈列室" description="成就将解锁称号和姓名框。数据结构已预留，奖励素材到位后接入。" />}
      {section === 'history' && <FeaturePlaceholder eyebrow="REPLAYS" title="对局历史与回放" description="后续保存结构化回合快照和公开视角事件，支持逐回合跳转、前进与后退；黑暗信息按观看权限和回放模式处理。" />}
    </div>
    {cropOpen && <AvatarCropper onCancel={() => setCropOpen(false)} onSave={async (dataUrl) => { setSaving(true); setError(''); try { apply(await uploadAvatar(session, dataUrl)); setCropOpen(false); setNotice('头像已更新'); } catch (reason) { setError(message(reason, '头像保存失败')); } finally { setSaving(false); } }} />}
  </main>;
}

function Stat({ label, value }: { label: string; value: string | number }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
function FeaturePlaceholder({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <section className="profile-card feature-placeholder"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p><span>功能规划中</span></section>; }
function levelThreshold(level: number): number { const n = Math.max(0, level - 1); return 100 * n * n + 300 * n; }
function message(reason: unknown, fallback: string) { return reason instanceof Error && reason.message ? reason.message : fallback; }

function AvatarCropper({ onCancel, onSave }: { onCancel: () => void; onSave: (dataUrl: string) => Promise<void> }) {
  const [source, setSource] = useState<{ url: string; width: number; height: number }>();
  const [zoom, setZoom] = useState(1); const [x, setX] = useState(0); const [y, setY] = useState(0); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) return setError('请选择不超过 8MB 的图片');
    const url = URL.createObjectURL(file); const image = new Image(); image.onload = () => { if (source) URL.revokeObjectURL(source.url); setSource({ url, width: image.naturalWidth, height: image.naturalHeight }); setZoom(1); setX(0); setY(0); setError(''); }; image.onerror = () => { URL.revokeObjectURL(url); setError('无法读取该图片'); }; image.src = url;
  };
  const crop = async () => {
    if (!source || !imageRef.current) return; setSaving(true); setError('');
    try {
      const cropSize = Math.min(source.width, source.height) / zoom;
      const rangeX = Math.max(0, source.width - cropSize); const rangeY = Math.max(0, source.height - cropSize);
      const centerX = source.width / 2 + x / 100 * rangeX / 2; const centerY = source.height / 2 + y / 100 * rangeY / 2;
      const sx = Math.max(0, Math.min(source.width - cropSize, centerX - cropSize / 2)); const sy = Math.max(0, Math.min(source.height - cropSize, centerY - cropSize / 2));
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512; const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器不支持头像裁剪');
      context.drawImage(imageRef.current, sx, sy, cropSize, cropSize, 0, 0, 512, 512); const dataUrl = canvas.toDataURL('image/webp', .88); if (!dataUrl.startsWith('data:image/webp')) throw new Error('浏览器不支持 WebP 导出'); await onSave(dataUrl);
    } catch (reason) { setError(message(reason, '头像裁剪失败')); } finally { setSaving(false); }
  };
  const minimumSide = source ? Math.min(source.width, source.height) : 1;
  const ratioX = source ? source.width / minimumSide : 1; const ratioY = source ? source.height / minimumSide : 1;
  return <div className="avatar-crop-backdrop"><section className="avatar-crop-dialog" role="dialog" aria-modal="true"><header><div><p className="eyebrow">AVATAR EDITOR</p><h2>裁剪头像</h2></div><button aria-label="关闭" onClick={onCancel}>×</button></header><label className="avatar-file">选择图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseFile} /></label>{source ? <><div className="crop-preview"><img ref={imageRef} src={source.url} alt="待裁剪图片" style={{ width: `${ratioX * zoom * 100}%`, height: `${ratioY * zoom * 100}%`, left: `${50 - x / 100 * (ratioX * zoom - 1) * 50}%`, top: `${50 - y / 100 * (ratioY * zoom - 1) * 50}%` }} /></div><div className="crop-controls"><label>缩放<input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><label>水平位置<input type="range" min="-100" max="100" value={x} onChange={(event) => setX(Number(event.target.value))} /></label><label>垂直位置<input type="range" min="-100" max="100" value={y} onChange={(event) => setY(Number(event.target.value))} /></label></div></> : <div className="crop-empty">上传图片后，在这里选择正方形裁剪范围。</div>}{error && <p className="error">{error}</p>}<footer><button className="secondary-button" onClick={onCancel}>取消</button><button className="primary-button" disabled={!source || saving} onClick={() => void crop()}>{saving ? '保存中…' : '确认保存'}</button></footer></section></div>;
}
