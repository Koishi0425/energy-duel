import { buffById, characterById, isResourceVisibleForCharacter, passiveById, resourceById, type PlayerProfile, type SyncedPlayer } from '@energy-duel/shared';
import { Button, Progress, Tag } from 'antd';
import { resolvePortraitUrl } from '../game/visualResolver';
import PlayerProfileBanner from './PlayerProfileBanner';

export default function PlayerDetails({ player, profile, onOpenGuide, showPortrait = false }: { player: SyncedPlayer; profile?: PlayerProfile; onOpenGuide?: (characterId: string) => void; showPortrait?: boolean }) {
  const character = characterById.get(player.characterId);
  const form = character?.forms.find((candidate) => candidate.id === player.currentFormId);
  return (
    <div className="player-details">
      {profile && <PlayerProfileBanner profile={profile} />}
      {!profile && <div className="player-details-heading">
        <span className="details-color" style={{ background: `#${player.color.toString(16).padStart(6, '0')}` }} />
        <div><strong>{player.nickname}</strong></div>
        <Tag color={player.alive ? 'success' : 'error'}>{player.alive ? '存活' : '已淘汰'}</Tag>
      </div>}
      {profile && <div className="player-details-heading character-status-heading"><span className="details-color" style={{ background: `#${player.color.toString(16).padStart(6, '0')}` }} /><div><strong>本局角色状态</strong><small>{player.alive ? '存活' : '已淘汰'} · 本局昵称 {player.nickname}</small></div></div>}
      {showPortrait && <img className="player-detail-portrait" src={resolvePortraitUrl(player.characterId, player.currentFormId)} alt={`${character?.name ?? player.characterId}立绘`} loading="lazy" decoding="async" />}
      <p className="form-line">{character?.name ?? player.characterId} · {form?.name ?? player.currentFormId}</p>
      {character?.description && <p className="muted">{character.description}</p>}
      {onOpenGuide && <Button size="small" onClick={() => onOpenGuide(player.characterId)}>查看{character?.name ?? '角色'}教程</Button>}
      {Boolean(character?.passiveIds?.length) && <div className="buff-list"><strong>被动技能</strong>{character?.passiveIds?.map((id) => { const passive = passiveById.get(id); return <div className="buff-detail" key={id}><Tag color="purple">{passive?.name ?? id}</Tag><small>{passive?.description}</small></div>; })}</div>}
      <div className="detail-section">
        <span>{player.characterId === 'inner_guard' ? '装置' : '生命'} {player.currentHp}/{player.maxHp}</span>
        <Progress percent={player.maxHp > 0 ? Math.round(player.currentHp / player.maxHp * 100) : 0} showInfo={false} status={player.alive ? 'active' : 'exception'} />
      </div>
      <div className="resource-list">
        {Object.values(player.resources).filter((resource) => isResourceVisibleForCharacter(resource.resourceId, player.characterId, resource.current)).map((resource) => {
          const definition = resourceById.get(resource.resourceId);
          return <Tag key={resource.resourceId} color={definition?.color}>{definition?.name ?? resource.resourceId}：{formatResource(resource.current)}{resource.max > 0 ? `/${formatResource(resource.max)}` : ''}</Tag>;
        })}
      </div>
      <div className="buff-list">
        <strong>状态效果</strong>
        {player.buffs.length === 0
          ? <span className="muted">暂无状态效果</span>
          : player.buffs.map((buff) => {
            const definition = buffById.get(buff.buffId);
            const duration = buff.permanent ? '持续状态' : `剩余 ${buff.remainingTurns} 回合`;
            return <div className="buff-detail" key={buff.instanceId}><Tag color={definition?.color}>{definition?.name ?? buff.buffId} ×{buff.stacks} · {duration}</Tag><small>{definition?.description ?? '暂无详细说明'}</small></div>;
          })}
      </div>
    </div>
  );
}

function formatResource(value: number): string { if (Math.abs(value - 1 / 3) < 0.001) return '1/3'; if (Math.abs(value - 2 / 3) < 0.001) return '2/3'; return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
