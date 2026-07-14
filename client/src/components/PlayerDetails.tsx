import { characterById, resourceById, type SyncedPlayer } from '@energy-duel/shared';
import { Progress, Tag } from 'antd';

export default function PlayerDetails({ player }: { player: SyncedPlayer }) {
  const character = characterById.get(player.characterId);
  const form = character?.forms.find((candidate) => candidate.id === player.currentFormId);
  return (
    <div className="player-details">
      <div className="player-details-heading">
        <span className="details-color" style={{ background: `#${player.color.toString(16).padStart(6, '0')}` }} />
        <div><strong>{player.nickname}</strong><small>@{player.username}</small></div>
        <Tag color={player.alive ? 'success' : 'error'}>{player.alive ? '存活' : '已淘汰'}</Tag>
      </div>
      <p className="form-line">{character?.name ?? player.characterId} · {form?.name ?? player.currentFormId}</p>
      <div className="detail-section">
        <span>生命 {player.currentHp}/{player.maxHp}</span>
        <Progress percent={player.maxHp > 0 ? Math.round(player.currentHp / player.maxHp * 100) : 0} showInfo={false} status={player.alive ? 'active' : 'exception'} />
      </div>
      <div className="resource-list">
        {Object.values(player.resources).map((resource) => {
          const definition = resourceById.get(resource.resourceId);
          return <Tag key={resource.resourceId} color={definition?.color}>{definition?.name ?? resource.resourceId}：{resource.current}{resource.max > 0 ? `/${resource.max}` : ''}</Tag>;
        })}
      </div>
      <div className="buff-list">
        <strong>状态效果</strong>
        {player.buffs.length === 0
          ? <span className="muted">暂无 Buff</span>
          : player.buffs.map((buff) => <Tag key={buff.instanceId}>{buff.buffId} ×{buff.stacks} · {buff.remainingTurns} 回合</Tag>)}
      </div>
    </div>
  );
}
