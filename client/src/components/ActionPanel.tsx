import { actionById, gameConfig, resourceById, type ActionCategory, type ActionDefinition, type SyncedPlayer } from '@energy-duel/shared';
import { Button, Tabs, Tooltip } from 'antd';

interface Props {
  player: SyncedPlayer;
  selectedActionId?: string;
  onSelect: (action: ActionDefinition) => void;
  onCancel: () => void;
}

const categoryLabels: Record<ActionCategory, string> = { attack: '攻击', defense: '防御', special: '特殊' };

export default function ActionPanel({ player, selectedActionId, onSelect, onCancel }: Props) {
  if (player.submitted) {
    return (
      <div className="submitted-action">
        <p>行动已确认，等待其他玩家。</p>
        <Button danger block onClick={onCancel}>撤销并重选</Button>
      </div>
    );
  }

  const items = (Object.keys(categoryLabels) as ActionCategory[]).map((category) => ({
    key: category,
    label: categoryLabels[category],
    children: (
      <div className="action-grid">
        {gameConfig.actions.filter((action) => action.category === category).map((action) => {
          const affordable = canAfford(player, action);
          return (
            <Tooltip key={action.id} title={`${action.description} · 优先级 ${action.speedPriority + action.level}`}>
              <Button
                className={`action-button${selectedActionId === action.id ? ' selected' : ''}`}
                type={selectedActionId === action.id ? 'primary' : 'default'}
                disabled={!affordable}
                onClick={() => onSelect(actionById.get(action.id)!)}
              >
                <strong>{action.name}</strong>
                <small>{formatCost(action)} · {formatTarget(action)}</small>
              </Button>
            </Tooltip>
          );
        })}
      </div>
    ),
  }));

  return (
    <div className="action-panel-content">
      <Tabs defaultActiveKey="attack" items={items} size="small" />
      <Tooltip title="当前角色尚未配置可用变身">
        <Button className="transform-button" disabled block>变身 · 尚未解锁</Button>
      </Tooltip>
    </div>
  );
}

function canAfford(player: SyncedPlayer, action: ActionDefinition): boolean {
  return Object.entries(action.cost).every(([id, amount]) => (player.resources[id]?.current ?? 0) >= amount);
}

function formatCost(action: ActionDefinition): string {
  const entries = Object.entries(action.cost);
  if (entries.length === 0) return '无消耗';
  return entries.map(([id, amount]) => `${amount} ${resourceById.get(id)?.shortName ?? id}`).join('、');
}

function formatTarget(action: ActionDefinition): string {
  if (action.target.mode === 'single_enemy') return '选择敌方';
  if (action.target.mode === 'all_enemies') return '全体敌方';
  return '无需目标';
}
