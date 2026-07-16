import { buffById, characterById, passiveById, resourceById, type SyncedPlayer } from '@energy-duel/shared';
import { Button, Progress, Tag } from 'antd';

export default function PlayerDetails({ player, onOpenGuide }: { player: SyncedPlayer; onOpenGuide?: (characterId: string) => void }) {
  const character = characterById.get(player.characterId);
  const form = character?.forms.find((candidate) => candidate.id === player.currentFormId);
  return (
    <div className="player-details">
      <div className="player-details-heading">
        <span className="details-color" style={{ background: `#${player.color.toString(16).padStart(6, '0')}` }} />
        <div><strong>{player.nickname}</strong></div>
        <Tag color={player.alive ? 'success' : 'error'}>{player.alive ? '存活' : '已淘汰'}</Tag>
      </div>
      <p className="form-line">{character?.name ?? player.characterId} · {form?.name ?? player.currentFormId}</p>
      {character?.description && <p className="muted">{character.description}</p>}
      {onOpenGuide && <Button size="small" onClick={() => onOpenGuide(player.characterId)}>查看{character?.name ?? '角色'}教程</Button>}
      {Boolean(character?.passiveIds?.length) && <div className="buff-list"><strong>被动技能</strong>{character?.passiveIds?.map((id) => { const passive = passiveById.get(id); return <div className="buff-detail" key={id}><Tag color="purple">{passive?.name ?? id}</Tag><small>{passive?.description}</small></div>; })}</div>}
      <div className="detail-section">
        <span>生命 {player.currentHp}/{player.maxHp}</span>
        <Progress percent={player.maxHp > 0 ? Math.round(player.currentHp / player.maxHp * 100) : 0} showInfo={false} status={player.alive ? 'active' : 'exception'} />
      </div>
      <div className="resource-list">
        {Object.values(player.resources).map((resource) => {
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
            const duration = buff.remainingTurns > 0 ? `剩余 ${buff.remainingTurns} 回合` : '持续状态';
            return <div className="buff-detail" key={buff.instanceId}><Tag color={definition?.color}>{definition?.name ?? buff.buffId} ×{buff.stacks} · {duration}</Tag><small>{definition?.description ?? '暂无详细说明'}</small></div>;
          })}
      </div>
    </div>
  );
}

function formatResource(value: number): string { if (Math.abs(value - 1 / 3) < 0.001) return '1/3'; if (Math.abs(value - 2 / 3) < 0.001) return '2/3'; return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
