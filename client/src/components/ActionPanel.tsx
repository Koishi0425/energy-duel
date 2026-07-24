import { useEffect, useState, type DragEvent } from 'react';
import {
  actionById,
  buffById,
  characterById,
  resourceById,
  canExecuteNapoleonStrategy,
  isCharacterAvailableInRoomMode,
  napoleonStrategyFromCommand,
  type NapoleonCommand,
  type ActionCategory,
  type ActionDefinition,
  type RoomMode,
  type SyncedPlayer,
} from '@energy-duel/shared';
import { Button, Dropdown, Input, Tabs, Tooltip } from 'antd';
import FloatingWindow from './FloatingWindow';

interface Props {
  player: SyncedPlayer;
  resourceSponsor?: SyncedPlayer;
  selectedActionId?: string;
  submittedLabel?: string;
  roomMode: RoomMode;
  onSelect: (action: ActionDefinition) => void;
  onTransform: (characterId: string) => void;
  onCancel: () => void;
}
interface LayoutCategory { id: string; label: string }
interface ActionLayout {
  categories: LayoutCategory[];
  actionCategories: Record<string, string>;
  actionOrder: Record<string, string[]>;
  hiddenActionIds: string[];
  detachedCategoryIds: string[];
}

const STORAGE_KEY = 'energy-duel-action-layout-v3';
const categoryLabels: Record<ActionCategory, string> = { base: '基础', attack: '攻击', defense: '防御', resource: '资源', special: '特殊' };
const defaultCategories = (Object.keys(categoryLabels) as ActionCategory[]).map((id) => ({ id, label: categoryLabels[id] }));

export default function ActionPanel({ player, resourceSponsor, selectedActionId, submittedLabel, roomMode, onSelect, onTransform, onCancel }: Props) {
  const [layout, setLayout] = useState<ActionLayout>(loadLayout);
  const [editing, setEditing] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState('base');
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); }, [layout]);

  if (player.submitted) return <div className="submitted-action"><p><strong>{submittedLabel ?? '行动已提交'}</strong></p><p className="muted compact-copy">等待其他玩家；结算开始前可以撤销。</p><Button danger block onClick={onCancel}>撤销并重选</Button></div>;

  const character = characterById.get(player.characterId);
  const form = character?.forms.find((candidate) => candidate.id === player.currentFormId);
  const grantedIds = player.buffs.flatMap((buff) => buffById.get(buff.buffId)?.grantedActionIds ?? []);
  const learnedIds = player.characterId === 'ye_qingxian' ? player.learnedActionIds : [];
  const unlockedIds = [...new Set([...(form?.unlockedActions.filter((id) => id !== 'transform') ?? []), ...grantedIds, ...learnedIds])];
  const unlockedActions = unlockedIds.map((id) => actionById.get(id)).filter((action): action is ActionDefinition => Boolean(action))
    .filter((action) => !action.napoleonSequence || canExecuteNapoleonStrategy(player.commandBuffer, action.napoleonSequence)
      || napoleonStrategyFromCommand(player.commandBuffer, action.napoleonSequence.at(-1) as NapoleonCommand)?.id === action.id);
  const regainSpiritLocked = player.buffs.some((buff) => buff.buffId === 'regain_spirit_lock');
  const lockedActionIds = new Set(unlockedActions.filter((action) => !meetsUnlockRequirements(player, action, resourceSponsor)
    || (regainSpiritLocked && action.category !== 'attack')).map((action) => action.id));
  const normalizedLayout = reconcileLayout(layout, unlockedActions);
  const detachedIds = new Set(normalizedLayout.detachedCategoryIds);
  const regularCategories = normalizedLayout.categories.filter((category) => !detachedIds.has(category.id));
  const transformations = (character?.transformations ?? []).filter((characterId) => isCharacterAvailableInRoomMode(characterId, roomMode));
  const transformItems = transformations.map((characterId) => {
    const target = characterById.get(characterId);
    const affordable = canAffordCost(player, target?.transformationCost ?? {});
    return { key: characterId, label: `${target?.name ?? characterId} · ${formatCostRecord(target?.transformationCost ?? {})}`, disabled: !affordable };
  });
  const canTransform = transformItems.some((item) => !item.disabled);

  const updateLayout = (updater: (current: ActionLayout) => ActionLayout) => setLayout((current) => updater(reconcileLayout(current, unlockedActions)));
  const renameCategory = (categoryId: string, label: string) => updateLayout((current) => ({ ...current, categories: current.categories.map((category) => category.id === categoryId ? { ...category, label } : category) }));
  const addCategory = () => {
    const id = `custom_${Date.now()}`;
    updateLayout((current) => ({ ...current, categories: [...current.categories, { id, label: '新分类' }], actionOrder: { ...current.actionOrder, [id]: [] } }));
    setActiveCategoryId(id);
  };
  const removeCategory = (categoryId: string) => updateLayout((current) => {
    if (current.categories.length <= 1) return current;
    const fallback = current.categories.find((category) => category.id !== categoryId)!.id;
    setActiveCategoryId(fallback);
    return {
      ...current,
      categories: current.categories.filter((category) => category.id !== categoryId),
      actionCategories: Object.fromEntries(Object.entries(current.actionCategories).map(([actionId, assigned]) => [actionId, assigned === categoryId ? fallback : assigned])),
      actionOrder: { ...current.actionOrder, [fallback]: [...(current.actionOrder[fallback] ?? []), ...(current.actionOrder[categoryId] ?? []).filter((id) => !(current.actionOrder[fallback] ?? []).includes(id))] },
      detachedCategoryIds: current.detachedCategoryIds.filter((id) => id !== categoryId),
    };
  });
  const detachCategory = (categoryId: string, detached: boolean) => updateLayout((current) => ({ ...current, detachedCategoryIds: detached ? [...new Set([...current.detachedCategoryIds, categoryId])] : current.detachedCategoryIds.filter((id) => id !== categoryId) }));
  const hideAction = (actionId: string) => updateLayout((current) => ({ ...current, hiddenActionIds: [...new Set([...current.hiddenActionIds, actionId])] }));
  const restoreAction = (actionId: string) => updateLayout((current) => ({ ...current, hiddenActionIds: current.hiddenActionIds.filter((id) => id !== actionId) }));
  const dropAction = (actionId: string, categoryId: string, beforeActionId?: string) => updateLayout((current) => {
    const actionOrder = Object.fromEntries(Object.entries(current.actionOrder).map(([id, order]) => [id, order.filter((candidate) => candidate !== actionId)]));
    const destination = [...(actionOrder[categoryId] ?? [])];
    const index = beforeActionId ? destination.indexOf(beforeActionId) : -1;
    if (index >= 0) destination.splice(index, 0, actionId); else destination.push(actionId);
    actionOrder[categoryId] = destination;
    return { ...current, actionCategories: { ...current.actionCategories, [actionId]: categoryId }, actionOrder };
  });
  const tabItems = regularCategories.map((category) => ({
    key: category.id,
    label: <CategoryTab category={category} editing={editing} canRemove={normalizedLayout.categories.length > 1} onRename={renameCategory} onRemove={removeCategory} onDetach={(id) => detachCategory(id, true)} onDropAction={dropAction} />,
    children: <ActionGrid categoryId={category.id} categories={normalizedLayout.categories} actions={actionsForCategory(category.id, unlockedActions, normalizedLayout)} player={player} resourceSponsor={resourceSponsor} selectedActionId={selectedActionId} lockedActionIds={lockedActionIds} editing={editing} onSelect={onSelect} onDropAction={dropAction} onHideAction={hideAction} />,
  }));
  const selectedTab = regularCategories.some((category) => category.id === activeCategoryId) ? activeCategoryId : regularCategories[0]?.id;

  return <>
    <div className={`action-panel-content${editing ? ' is-editing' : ''}`}>
      <div className="action-panel-tools"><span>{editing ? '编辑模式：拖动技能进行排序或跨分类移动' : player.characterId === 'napoleon' ? `指令缓冲：${player.commandBuffer || '空'}` : '选择本回合行动'}</span><div><Button size="small" type={editing ? 'primary' : 'default'} onClick={() => setEditing((value) => !value)}>{editing ? '完成' : '编辑面板'}</Button>{editing && <Button size="small" type="text" onClick={() => { setLayout(createDefaultLayout()); setActiveCategoryId('base'); }}>恢复默认</Button>}</div></div>
      {tabItems.length > 0 ? <Tabs activeKey={selectedTab} onChange={setActiveCategoryId} items={tabItems} size="small" tabBarExtraContent={editing ? <Button size="small" type="dashed" onClick={addCategory}>＋ 分类</Button> : undefined} /> : <div className="empty-action-categories"><p className="muted">所有分类均已独立显示</p>{editing && <Button size="small" onClick={addCategory}>＋ 添加分类</Button>}</div>}
      {editing && normalizedLayout.hiddenActionIds.length > 0 && <div className="hidden-action-tray"><span>已隐藏：</span>{normalizedLayout.hiddenActionIds.map((id) => actionById.get(id)).filter((action): action is ActionDefinition => action !== undefined).filter((action) => unlockedIds.includes(action.id)).map((action) => <Button key={action.id} size="small" onClick={() => restoreAction(action.id)}>＋ {action.name}</Button>)}</div>}
      {!editing && <Tooltip title={transformations.length ? (canTransform ? '选择其他角色；消耗由目标角色决定' : '当前资源不足') : '当前没有其他可用角色'} mouseEnterDelay={0.6}>
        <Dropdown menu={{ items: transformItems, onClick: ({ key }) => onTransform(key) }} disabled={transformItems.length === 0 || !canTransform} trigger={['click']}><Button className="transform-button" disabled={transformItems.length === 0 || !canTransform} block>{transformItems.length ? `变身 · ${canTransform ? '选择其他角色' : '资源不足'}` : '变身 · 没有其他角色'}</Button></Dropdown>
      </Tooltip>}
    </div>
    {normalizedLayout.categories.filter((category) => detachedIds.has(category.id)).map((category, index) => <FloatingWindow storageId={`action-category-${category.id}`} title={category.label || '未命名分类'} initialPosition={{ x: Math.max(20, window.innerWidth - 820 + index * 28), y: 110 + index * 38 }} initialSize={{ width: 340, height: 280 }} onClose={() => detachCategory(category.id, false)} key={category.id} className="detached-action-window" inlineOnMobile>
      {editing && <div className="detached-category-editor"><Input value={category.label} maxLength={12} onChange={(event) => renameCategory(category.id, event.target.value)} /><Button size="small" onClick={() => detachCategory(category.id, false)}>收回</Button><Button danger size="small" disabled={normalizedLayout.categories.length <= 1} onClick={() => removeCategory(category.id)}>删除</Button></div>}
      <ActionGrid categoryId={category.id} categories={normalizedLayout.categories} actions={actionsForCategory(category.id, unlockedActions, normalizedLayout)} player={player} resourceSponsor={resourceSponsor} selectedActionId={selectedActionId} lockedActionIds={lockedActionIds} editing={editing} onSelect={onSelect} onDropAction={dropAction} onHideAction={hideAction} />
    </FloatingWindow>)}
  </>;
}

function CategoryTab({ category, editing, canRemove, onRename, onRemove, onDetach, onDropAction }: { category: LayoutCategory; editing: boolean; canRemove: boolean; onRename: (id: string, label: string) => void; onRemove: (id: string) => void; onDetach: (id: string) => void; onDropAction: (actionId: string, categoryId: string) => void }) {
  if (!editing) return <span>{category.label || '未命名'}</span>;
  return <span className="editable-category-tab" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const actionId = event.dataTransfer.getData('text/action-id'); if (actionId) onDropAction(actionId, category.id); }}><Input size="small" value={category.label} maxLength={12} aria-label="分类名称" onChange={(event) => onRename(category.id, event.target.value)} /><Button type="text" size="small" title="独立窗口" onClick={() => onDetach(category.id)}>↗</Button><Button type="text" danger size="small" title="删除分类" disabled={!canRemove} onClick={() => onRemove(category.id)}>×</Button></span>;
}

function ActionGrid({ categoryId, categories, actions, player, resourceSponsor, selectedActionId, lockedActionIds, editing, onSelect, onDropAction, onHideAction }: { categoryId: string; categories: LayoutCategory[]; actions: ActionDefinition[]; player: SyncedPlayer; resourceSponsor?: SyncedPlayer; selectedActionId?: string; lockedActionIds: ReadonlySet<string>; editing: boolean; onSelect: (action: ActionDefinition) => void; onDropAction: (actionId: string, categoryId: string, beforeActionId?: string) => void; onHideAction: (actionId: string) => void }) {
  const acceptDrop = (event: DragEvent, beforeActionId?: string) => { event.preventDefault(); const actionId = event.dataTransfer.getData('text/action-id'); if (actionId) onDropAction(actionId, categoryId, beforeActionId); };
  if (actions.length === 0) return <div className={`empty-action-grid${editing ? ' editing-drop-zone' : ''}`} onDragOver={(event) => editing && event.preventDefault()} onDrop={(event) => editing && acceptDrop(event)}><p className="muted compact-copy">{editing ? '拖动技能到这里' : '此分类暂无技能'}</p></div>;
  return <div className="action-grid" onDragOver={(event) => editing && event.preventDefault()} onDrop={(event) => editing && acceptDrop(event)}>{actions.map((action, actionIndex) => { const locked = lockedActionIds.has(action.id); return <div className={`action-tile${editing ? ' is-draggable' : ''}${locked ? ' is-locked' : ''}`} key={action.id} draggable={editing} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/action-id', action.id); }} onDragOver={(event) => editing && event.preventDefault()} onDrop={(event) => { if (!editing) return; event.stopPropagation(); acceptDrop(event, action.id); }}>
    <Tooltip title={editing ? '拖动以排序或移动分类' : locked ? action.unlockRequirements?.description ?? '尚未满足解锁条件' : `${action.description} · 速度 ${formatActionSpeed(action, player)} · 等级 ${formatActionLevel(action, player)}`} mouseEnterDelay={0.65} mouseLeaveDelay={0.08}><Button className={`action-button${selectedActionId === action.id ? ' selected' : ''}`} type={selectedActionId === action.id ? 'primary' : 'default'} disabled={!editing && (locked || !canAfford(player, action, resourceSponsor))} onClick={() => { if (!editing && !locked) onSelect(action); }}><strong>{locked ? '🔒 ' : ''}{action.name}</strong><small>{locked ? action.unlockRequirements?.description ?? '尚未解锁' : `${formatCost(action, player)} · ${formatTarget(action)}`}</small></Button></Tooltip>
    {editing && <Button className="remove-action-tile" type="primary" danger size="small" shape="circle" title="从面板隐藏" onClick={() => onHideAction(action.id)}>×</Button>}
    {editing && <div className="mobile-action-edit-controls"><Button size="small" disabled={actionIndex === 0} onClick={() => onDropAction(action.id, categoryId, actions[actionIndex - 1]?.id)}>↑</Button><Button size="small" disabled={actionIndex === actions.length - 1} onClick={() => onDropAction(action.id, categoryId, actions[actionIndex + 2]?.id)}>↓</Button><select aria-label={`移动${action.name}到分类`} value={categoryId} onChange={(event) => onDropAction(action.id, event.target.value)}>{categories.map((category) => <option value={category.id} key={category.id}>{category.label || '未命名'}</option>)}</select></div>}
  </div>; })}</div>;
}

function createDefaultLayout(): ActionLayout { return { categories: defaultCategories, actionCategories: {}, actionOrder: Object.fromEntries(defaultCategories.map((category) => [category.id, []])), hiddenActionIds: [], detachedCategoryIds: [] }; }
function loadLayout(): ActionLayout { try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('energy-duel-action-layout-v2') ?? '') as ActionLayout; return parsed?.categories?.length ? parsed : createDefaultLayout(); } catch { return createDefaultLayout(); } }
function reconcileLayout(layout: ActionLayout, actions: ActionDefinition[]): ActionLayout {
  const categories = layout.categories.length ? layout.categories : defaultCategories; const validCategories = new Set(categories.map((category) => category.id)); const fallback = categories[0].id;
  const actionCategories = { ...layout.actionCategories }; const actionOrder = { ...layout.actionOrder };
  for (const category of categories) actionOrder[category.id] = [...(actionOrder[category.id] ?? [])];
  for (const action of actions) {
    const categoryId = validCategories.has(actionCategories[action.id] ?? action.category) ? actionCategories[action.id] ?? action.category : fallback;
    actionCategories[action.id] = categoryId;
    for (const id of validCategories) if (id !== categoryId) actionOrder[id] = actionOrder[id].filter((candidate) => candidate !== action.id);
    if (!actionOrder[categoryId].includes(action.id)) actionOrder[categoryId].push(action.id);
  }
  return { categories, actionCategories, actionOrder, hiddenActionIds: layout.hiddenActionIds ?? [], detachedCategoryIds: (layout.detachedCategoryIds ?? []).filter((id) => validCategories.has(id)) };
}
function actionsForCategory(categoryId: string, actions: ActionDefinition[], layout: ActionLayout): ActionDefinition[] { const byId = new Map(actions.map((action) => [action.id, action])); return (layout.actionOrder[categoryId] ?? []).filter((id) => !layout.hiddenActionIds.includes(id)).map((id) => byId.get(id)).filter((action): action is ActionDefinition => Boolean(action)); }
function canAfford(player: SyncedPlayer, action: ActionDefinition, sponsor?: SyncedPlayer): boolean {
  const cost = action.id === 'slash' && player.characterId === 'li_chungang' ? { ...action.cost, energy: 1 / 3 }
    : action.id === 'ten_volt' && player.buffs.some((buff) => buff.buffId === 'quick_attack_ready') ? { ...action.cost, charge: 0 } : action.cost;
  const deficit = Object.entries(cost).reduce((sum, [id, amount]) => sum + Math.max(0, amount - (player.resources[id]?.current ?? 0)), 0);
  if (deficit > (sponsor?.resources.soul?.current ?? 0) + 1e-6) return false;
  if (action.anyResourceCost) {
    const mastery = player.buffs.find((buff) => buff.buffId === 'ao_mastery')?.stacks ?? 0;
    const required = Math.max(1, action.anyResourceCost - mastery);
    if (Object.values(player.resources).reduce((sum, resource) => sum + resource.current, 0) + (sponsor?.resources.soul?.current ?? 0) + 1e-6 < required) return false;
  }
  return !action.variable || (player.resources[action.variable.resourceId]?.current ?? 0) + (sponsor?.resources.soul?.current ?? 0) >= action.variable.costPerPower * action.variable.minPower;
}
function canAffordCost(player: SyncedPlayer, cost: Record<string, number>): boolean { return Object.entries(cost).every(([id, amount]) => (player.resources[id]?.current ?? 0) >= amount); }
function meetsUnlockRequirements(player: SyncedPlayer, action: ActionDefinition, sponsor?: SyncedPlayer): boolean {
  const buffs = new Map(player.buffs.map((buff) => [buff.buffId, buff.stacks]));
  const requirements = action.unlockRequirements;
  return (requirements?.allBuffs ?? []).every((buffId) => buffs.has(buffId))
    && (requirements?.noneBuffs ?? []).every((buffId) => !buffs.has(buffId))
    && Object.entries(requirements?.minBuffStacks ?? {}).every(([buffId, stacks]) => (buffs.get(buffId) ?? 0) >= stacks)
    && Object.entries(requirements?.minResources ?? {}).reduce((sum, [resourceId, amount]) => sum + Math.max(0, amount - (player.resources[resourceId]?.current ?? 0)), 0) <= (sponsor?.resources.soul?.current ?? 0) + 1e-6;
}
function formatCost(action: ActionDefinition, player: SyncedPlayer): string {
  const cost = action.id === 'slash' && player.characterId === 'li_chungang' ? { ...action.cost, energy: 1 / 3 }
    : action.id === 'ten_volt' && player.buffs.some((buff) => buff.buffId === 'quick_attack_ready') ? { ...action.cost, charge: 0 } : action.cost;
  const entries = Object.entries(cost).filter(([, amount]) => amount > 0).map(([id, amount]) => `${formatAmount(amount)} ${resourceById.get(id)?.shortName ?? id}`);
  if (action.variable) entries.push(action.usesAllVariableResource
    ? `全部 ${resourceById.get(action.variable.resourceId)?.shortName ?? action.variable.resourceId}`
    : `${action.variable.costPerPower}n ${resourceById.get(action.variable.resourceId)?.shortName ?? action.variable.resourceId}`);
  if (action.anyResourceCost) entries.push(`${action.anyResourceCost}-n 任意资源`);
  return entries.length === 0 ? '无消耗' : entries.join('、');
}
function formatAmount(value: number): string { return Math.abs(value - 1 / 3) < 0.001 ? '1/3' : String(value); }
function formatActionLevel(action: ActionDefinition, player: SyncedPlayer): string {
  const buffStacks = (buffId: string) => player.buffs.find((buff) => buff.buffId === buffId)?.stacks ?? 0;
  if (action.id === 'intimidate') return formatAmount(player.resources.soul?.current ?? 0);
  if (action.id === 'deify') return 'X - 1';
  if (action.defenseBreak?.mode === 'persistent' && player.buffs.some((buff) => buff.buffId === action.defenseBreak?.brokenBuffId)) return '0（已破碎）';
  if (player.characterId === 'warrior' && action.category === 'attack') {
    const strengthBonus = buffStacks('strength') * 0.5;
    if (action.id === 'bully') return `效果 ${formatAmount(0.5 + strengthBonus)} + 0.5×易伤 / 伤害 0.5 + 0.5×易伤`;
    const effect = (action.id === 'body_slam' ? buffStacks('armor') : action.effectLevel ?? action.level) + strengthBonus;
    const damage = action.id === 'shred' ? effect : action.id === 'body_slam' ? buffStacks('armor') : action.damageLevel ?? action.level;
    return damage !== effect ? `效果 ${formatAmount(effect)} / 伤害 ${formatAmount(damage)}` : formatAmount(effect);
  }
  if (action.id === 'regain_spirit') return '0';
  if (action.variable) {
    const effect = action.variable.effectLevelPerPower ?? action.variable.levelPerPower;
    const damage = action.damageLevel ?? action.variable.damageLevelPerPower ?? action.variable.levelPerPower;
    const damageLabel = action.damageLevel !== undefined ? String(damage) : `${damage}n`;
    return action.category === 'attack' && (action.damageLevel !== undefined || damage !== effect) ? `效果 ${effect}n / 伤害 ${damageLabel}` : `${effect}n`;
  }
  if (player.characterId === 'napoleon' && (action.napoleonSequence || ['attack_order', 'defense_order'].includes(action.id))) {
    const stacks = (buffId: string) => player.buffs.find((buff) => buff.buffId === buffId)?.stacks ?? 0;
    const tactical = stacks('tactical_advantage');
    const bonus = tactical * 0.5;
    const attackLevel = action.level + bonus + (['TTA', 'TTAA'].includes(action.napoleonSequence ?? '') ? tactical * 0.5 : 0);
    const defenseLevel = action.defenseLevel === undefined ? undefined : action.defenseLevel + bonus;
    if (defenseLevel !== undefined && action.category === 'attack') return `攻 ${formatAmount(attackLevel)} / 防 ${formatAmount(defenseLevel)}`;
    if (defenseLevel !== undefined) return formatAmount(defenseLevel);
    if (action.category === 'special') return '—';
    return formatAmount(attackLevel);
  }
  const effect = action.effectLevel ?? action.level;
  const damage = action.damageLevel ?? effect;
  const effectLabel = effect >= 999 ? '∞' : formatAmount(effect);
  return action.category === 'attack' && damage !== effect ? `效果 ${effectLabel} / 伤害 ${formatAmount(damage)}` : effectLabel;
}
function formatCostRecord(cost: Record<string, number>): string { const entries = Object.entries(cost); return entries.length === 0 ? '无消耗' : entries.map(([id, amount]) => `${amount} ${resourceById.get(id)?.shortName ?? id}`).join('、'); }
function formatTarget(action: ActionDefinition): string { if (action.target.mode === 'single_enemy') return '选择 1 人'; if (action.target.maxTargetsByPower) return '后发分配 n 次'; if (action.target.mode === 'multiple_enemies') return `选择 ${action.target.maxTargets} 次`; if (action.target.mode === 'all_enemies') return '全体敌方'; return '无需目标'; }
function formatActionSpeed(action: ActionDefinition, player: SyncedPlayer): string {
  if (action.id === 'deify') return String(Math.max(0, Math.min(4, player.resources.soul?.current ?? 0)));
  if (player.buffs.some((buff) => buff.buffId === 'soul_reap_debuff')) return String(Math.max(0, action.speedPriority - 1));
  if (player.characterId !== 'napoleon') return String(action.speedPriority);
  const stacks = (buffId: string) => player.buffs.find((buff) => buff.buffId === buffId)?.stacks ?? 0;
  return formatAmount(action.speedPriority + stacks('napoleon_speed') + stacks('napoleon_divine') * 0.5);
}
