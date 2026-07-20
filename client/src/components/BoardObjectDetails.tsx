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
      <div><dt>持续</dt><dd>{duration}</dd></div>
    </dl>
  </section>;
}
