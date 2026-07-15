import { useEffect, useState } from 'react';
import { gameConfig, resourceById, type ActionCategory } from '@energy-duel/shared';

interface Props { open: boolean; onClose: () => void }
type Page = 'flow' | 'actions' | 'characters' | 'network';
const categoryLabels: Record<ActionCategory, string> = { base: '基础', attack: '攻击', defense: '防御', resource: '资源', special: '特殊' };

export default function Tutorial({ open, onClose }: Props) {
  const [page, setPage] = useState<Page>('flow');
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);
  if (!open) return null;
  return <div className="tutorial-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="tutorial-dialog" role="dialog" aria-modal="true" aria-label="娇斯拉大战贡刚教程">
      <header><div><p className="eyebrow">HOW TO PLAY</p><h2>娇斯拉大战贡刚教程</h2></div><button type="button" aria-label="关闭教程" onClick={onClose}>×</button></header>
      <nav aria-label="教程章节">{([['flow', '回合与生命'], ['actions', '基础招式'], ['characters', '角色变身'], ['network', '房间与连接']] as Array<[Page, string]>).map(([id, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>{label}</button>)}</nav>
      <div className="tutorial-body">{page === 'flow' && <FlowGuide />}{page === 'actions' && <ActionGuide />}{page === 'characters' && <CharacterGuide />}{page === 'network' && <NetworkGuide />}</div>
    </section>
  </div>;
}

function FlowGuide() {
  return <><h3>同时选择，分组展示，统一结算</h3><ol><li>选择一个行动；需要目标时直接点击战场上的高亮角色，选择完成后立即提交。</li><li>行动内容对其他玩家保密。最后一人提交前可随时撤销重选。</li><li>速度越高越先进入动画队列；互相出招或攻击与防御会成组同时播放。</li><li>只剩一名玩家时获胜；无人存活则平局。所有玩家确认结算后返回准备阶段。</li></ol><div className="tutorial-callout"><strong>等级差与生命状态</strong><p>等级差 = 受到的攻击等级 − 自己本回合招式等级，自己的攻击、防御或其他招式都参与比较。差值小于 0.5 时抵消；0.5 至不足 1 时左移一层；达到 1 时直接死亡。等级低于 3 的伤害最多左移一层。治疗造成右移。</p></div><div className="tutorial-callout"><strong>变身与战斗日志</strong><p>变身前没有濒死状态；变身后拥有健康、濒死、死亡三档，首次进入濒死获得 1 气。房间右上角的日志会保留每局、每回合和时间标记。</p></div><div className="tutorial-callout"><strong>预选与后发</strong><p>当前技能都在提交时预选目标。未来“后发”技能会在结算阶段根据战况再次选择目标。</p></div></>;
}

function ActionGuide() {
  return <div className="tutorial-action-sections">{(Object.keys(categoryLabels) as ActionCategory[]).map((category) => <section key={category}><h3>{categoryLabels[category]}</h3><div className="tutorial-card-grid">{gameConfig.actions.filter((action) => action.category === category && !['wave', 'hangup'].includes(action.id)).map((action) => <article key={action.id}><strong>{action.name}</strong><small>{formatCost(action.cost)} · 速度 {action.speedPriority} · 等级 {action.level >= 999 ? '∞' : action.level}</small><p>{action.description}</p></article>)}</div></section>)}</div>;
}

function CharacterGuide() {
  return <><div className="tutorial-callout"><strong>可以反复切换角色</strong><p>初始角色可以使用气、蓄力、凹、紫翼双凹、剁、挡和超防。娇斯拉与贡刚当前都可免费变身；变身后仍能选择当前角色以外的角色，未来角色的消耗由其配置决定。</p></div><div className="tutorial-callout"><strong>角色分别保存 Buff</strong><p>Buff 默认跟随产生它的角色。切换后暂时隐藏，但有限持续时间仍在后台减少；例如贡刚的永久举斧在切换为娇斯拉时隐藏，切回贡刚后恢复。</p></div><div className="tutorial-card-grid">{gameConfig.characters.map((character) => <article key={character.id}><strong>{character.name}</strong><small>{character.id === 'default_character' ? '初始形态' : '当前免费变身'}</small><p>{character.id === 'jiaosila' ? '通用战斗招式 + 原子吐息（2 气 + 1 蓄力，3 级攻击）' : character.id === 'gonggang' ? '通用战斗招式 + 举斧；举斧后解锁斧挡，并使斩提高 0.5 级' : '拥有基础招式、挡和超防，可变身为娇斯拉或贡刚'}</p></article>)}</div></>;
}

function NetworkGuide() {
  return <><h3>快速进入房间</h3><ul><li>房主创建 4–10 位字母或数字房间号，朋友输入同一房间号即可加入。</li><li>所有玩家准备后，由房主开始游戏。</li><li>游戏中意外断线会保留席位 30 秒并自动重连；等待阶段断线直接离开。</li><li>结算后每名在房玩家确认结果，房间随后返回准备阶段。</li><li>右上角显示在线状态、往返延迟和战斗日志。地址后添加 <code>?perf=1</code> 可查看 FPS、慢帧、长任务和内存指标。</li></ul><p className="warning">用户名登录没有密码保护。任何知道用户名的人都可以进入同一账号。</p></>;
}

function formatCost(cost: Record<string, number>): string {
  const entries = Object.entries(cost);
  return entries.length ? entries.map(([id, value]) => `${value} ${resourceById.get(id)?.shortName ?? id}`).join(' + ') : '无消耗';
}
