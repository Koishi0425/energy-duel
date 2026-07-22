import { boardObjectById, characterById, type SyncedBoardObject, type SyncedPlayer } from '@energy-duel/shared';
import { Tag } from 'antd';

interface Props {
  object: SyncedBoardObject;
  owner?: SyncedPlayer;
}

export default function BoardObjectDetails({ object, owner }: Props) {
  const definition = boardObjectById.get(object.definitionId);
  const sourceCharacter = characterById.get(object.sourceCharacterId);
  const duration = object.permanent ? '永久' : object.remainingTurns > 0 ? `剩余 ${object.remainingTurns} 回合` : '本回合结束';
  const source = [owner?.nickname, sourceCharacter?.name, definition?.sourceLabel].filter(Boolean).join(' · ');
  const cargo = Object.values(object.cargo ?? {}).reduce((total, carried) => ({ energy: total.energy + carried.energy, charge: total.charge + carried.charge }), { energy: 0, charge: 0 });

  return <section className="board-object-details">
    <header>
      <span className="board-object-swatch" style={{ background: definition?.color ?? '#94a3b8' }} />
      <div><strong>{definition?.name ?? object.definitionId}</strong><small>{object.kind === 'terrain' ? '场地对象' : '召唤物'}</small></div>
      <Tag color={object.permanent ? 'purple' : 'blue'}>{duration}</Tag>
    </header>
    <p>{definition?.description ?? '暂无详细说明'}</p>
    <dl>
      <div><dt>位置</dt><dd>地块 {object.gridIndex}</dd></div>
      <div><dt>来源</dt><dd>{source || '无归属环境效果'}</dd></div>
      {definition?.displayMode === 'health' && <div><dt>生命</dt><dd>{object.currentHp}/{object.maxHp}</dd></div>}
      {definition?.displayMode === 'stacks' && <div><dt>强度</dt><dd>{object.stacks}</dd></div>}
      {object.definitionId === 'lotus_seat' && <><div><dt>方向</dt><dd>{object.movementDirection === -1 ? '逆时针' : '顺时针'}</dd></div><div><dt>移动速度</dt><dd>{object.moveSpeed ?? 4}</dd></div><div><dt>携带资源</dt><dd>{cargo.energy} 气 · {cargo.charge} 蓄力</dd></div></>}
      <div><dt>持续</dt><dd>{duration}</dd></div>
    </dl>
  </section>;
}
