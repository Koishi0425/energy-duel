import { actionById, gameConfig, resourceById, type ActionCategory, type ActionDefinition } from '@energy-duel/shared';

export type GuidePageId = 'start' | 'rules' | 'characters' | 'actions' | 'glossary';
export type GuideDifficulty = '入门' | '进阶' | '专家';

export interface GuideSection {
  id: string;
  title: string;
  summary: string;
  points: string[];
}

export interface GlossaryEntry {
  id: string;
  term: string;
  definition: string;
}

export interface CharacterGuideDefinition {
  characterId: string;
  role: string;
  difficulty: GuideDifficulty;
  summary: string;
  gamePlan: string[];
  keyMechanics: Array<{ title: string; description: string }>;
  featuredActionIds: string[];
  warnings?: string[];
}

export const guidePages: Array<{ id: GuidePageId; label: string; description: string }> = [
  { id: 'start', label: '快速开始', description: '第一次对局从这里开始' },
  { id: 'rules', label: '核心规则', description: '回合、伤害、地块与房间' },
  { id: 'characters', label: '角色指南', description: '定位、思路与关键机制' },
  { id: 'actions', label: '招式图鉴', description: '按角色查看完整技能树' },
  { id: 'glossary', label: '术语速查', description: '快速确认规则关键词' },
];

export const ruleSections: GuideSection[] = [
  {
    id: 'round-flow',
    title: '同时选招与回合结算',
    summary: '所有存活玩家秘密选择行动，最后一人提交后统一公开并结算。',
    points: [
      '最后一名存活玩家提交前，已经提交的玩家可以撤销并重选。',
      '需要“后发”选择的招式会先公开行动，再由使用者分配目标。',
      '速度越高越早执行；位移产生的新位置会影响后续范围、路径和传导效果。',
      '每次提交都会写入战斗日志，包括没有生效的行动。',
    ],
  },
  {
    id: 'combat',
    title: '等级比较与生命状态',
    summary: '技能等级决定对抗胜负，伤害等级决定命中后的健康结算；未特别说明时两者相等。',
    points: [
      '技能对抗差小于 0.5 时不命中；胜出后取伤害等级与技能差的较小值，再由防御抵消。',
      '同一回合受到多段或多个来源的伤害时，健康结算只取最高有效伤害等级，不累计较低伤害。',
      '若行动标记为多段攻击，并且目标的攻击技能对使用者有效，则只合并技能等级。伤害等级不得合并。若上述条件不成立，则每一个攻击段独立判定。',
      '最高有效伤害低于 3 时最多令生命左移一层；达到 3 才可跨状态击杀。治疗会令生命右移。',
      '需要选目标的招式只会对其目标或实际作用范围内的攻击者提供技能等级，不能用攻击别人的招式对抗第三人的攻击。',
      '可破碎防御承受不低于自身防御等级的单次伤害后破碎；当前伤害仍先扣除原防御等级，之后防御等级为 0。重新生成的临时防御仅在当次使用中保持破碎。',
      '初始角色没有濒死状态；变身角色拥有健康、濒死、死亡三种状态，并在首次进入濒死时获得 1 气。',
      '“脆弱”会令拳或斩在满足条件时直接致死，具体条件以招式与被动说明为准。',
    ],
  },
  {
    id: 'targeting',
    title: '预选、后发与锁定',
    summary: '多数目标在提交行动时确定，标记为“后发”的目标在所有行动公开后选择。',
    points: [
      '预选目标不会因为其后来移动而自动改成其他人。',
      '范围、路径与传导类招式在实际执行时读取最新地块位置。',
      '鬼影重重释放时与下一回合内，仅有一次机会锁定目标发动鬼影冲刺；可以跳过释放回合并保留到下一回合。',
    ],
  },
  {
    id: 'board',
    title: '圆形地块与位移',
    summary: '地图由玩家数两倍的地块构成，每名玩家开局之间恰好隔一个空位。',
    points: [
      '普通位移只能前往顺时针或逆时针方向的相邻空地块，不能与其他玩家重叠。',
      '地图编号顺时针增加；界面旋转只影响自己的视角，不改变服务器上的真实位置。',
      '处理多个同时位移或范围效果时，以服务器给出的权威结算结果为准。',
    ],
  },
  {
    id: 'resources',
    title: '资源、Buff 与角色切换',
    summary: '资源归玩家持有，Buff 默认归产生它的角色持有。',
    points: [
      '气、蓄力等资源可以出现三分之一或二分之一等分数值，界面会以分数形式显示。',
      '任意资源费用只接受整数点数组合支付；普通变量招式会选择整数强度，星尘会自动消耗当前全部辉星。',
      '气和蓄力始终显示；角色专属资源由所属角色常驻显示，其他特殊资源为 0 时自动隐藏。',
      '切换角色不会清除原角色的 Buff，有限持续时间仍会继续倒计时。',
      '只有明确标记为玩家级的 Buff 才会跨角色生效。',
    ],
  },
  {
    id: 'rooms',
    title: '房间、断线与再战',
    summary: '所有玩家准备后由房主开局；对局中的意外断线会暂时保留席位。',
    points: [
      '等待与结算阶段离线会立即离开；对局中意外断线可在 30 秒内重连。',
      '永久房主离开会销毁房间；其他玩家在对局中永久离开会结束本局。',
      '结算后所有仍在房间的玩家确认结果，房间才会返回准备阶段。',
      '用户名只是便捷标识，没有密码保护；不要把它当作安全账户。',
    ],
  },
];

export const glossaryEntries: GlossaryEntry[] = [
  { id: 'level', term: '等级', definition: '招式用于攻防比较的数值。定向招式只有在来袭者属于其目标或实际作用范围时才参与比较。' },
  { id: 'speed', term: '速度', definition: '决定行动在结算时间线中的先后顺序，数值越高越早执行。' },
  { id: 'left-shift', term: '左移', definition: '生命状态向危险方向移动一层，通常由有效伤害造成。' },
  { id: 'right-shift', term: '右移', definition: '生命状态向安全方向移动一层，通常由治疗或角色效果造成。' },
  { id: 'deferred', term: '后发', definition: '所有人的行动公开后，使用者才选择目标或决定是否执行后续动作。' },
  { id: 'fragile', term: '脆弱', definition: '满足技能说明中的条件时，拳或斩可以跳过普通生命左移并直接致死。' },
  { id: 'barrier', term: '屏障', definition: '一次性的防护层。其吸收范围、失去后的效果和层数上限由产生它的技能决定。' },
  { id: 'planned', term: '预选目标', definition: '提交行动时便确定的目标；行动公开后通常不能更换。' },
  { id: 'character-buff', term: '角色级 Buff', definition: '只在所属角色激活时提供效果；切换角色后仍保存在服务器并继续计时。' },
  { id: 'player-buff', term: '玩家级 Buff', definition: '跟随玩家跨角色生效，配置说明会明确标记。' },
];

export const characterGuides: CharacterGuideDefinition[] = [
  {
    characterId: 'default_character', role: '资源准备与转型', difficulty: '入门',
    summary: '用基础行动熟悉资源、目标和等级比较，并在合适的回合切换到专精角色。',
    gamePlan: ['先观察对手的资源与站位，再决定积攒哪类资源。', '变身不会丢失基础技能；根据局势选择爆发、防守、控制或成长分支。'],
    keyMechanics: [{ title: '安全学习期', description: '没有濒死状态，受到足以左移的伤害时会直接死亡，因此不要把初始形态当作额外生命。' }],
    featuredActionIds: ['charge', 'gain_charge', 'transform'],
  },
  {
    characterId: 'jiaosila', role: '直接爆发', difficulty: '入门',
    summary: '围绕高等级的原子吐息建立资源节奏，用简单直接的威胁迫使对手防守。',
    gamePlan: ['提前准备原子吐息需要的资源，不要在资源暴露后给对手太多调整时间。', '基础拳斩可以逼出防御，为关键爆发寻找等级差。'],
    keyMechanics: [{ title: '一击制胜', description: '角色机制集中在单次高压攻击，适合先掌握基础伤害比较再学习复杂角色。' }],
    featuredActionIds: ['fist', 'slash', 'atomic_breath'],
  },
  {
    characterId: 'gonggang', role: '攻防成长', difficulty: '进阶',
    summary: '通过举斧建立角色状态，在强化防守与斩击压力之间切换。',
    gamePlan: ['先建立举斧状态，再根据对手行动选择斧挡或进攻。', '切换角色后状态会保留，但有限持续效果仍会倒计时。'],
    keyMechanics: [{ title: '条件技能', description: '斧挡会一直显示在技能树中；未满足举斧条件时保持锁定，界面会说明解锁要求。' }],
    featuredActionIds: ['raise_axe', 'axe_defend', 'slash'],
  },
  {
    characterId: 'regent', role: '长期运营与可变爆发', difficulty: '专家',
    summary: '经营星与锻造等级，在资源优势、防御和君王之剑的可变攻击之间做选择。',
    gamePlan: ['第一次变身获得的星是整局资源；使用星尘会一次消耗当前全部辉星，需要先规划储量。', '君王之剑可按资源选择整数强度；征召上前能从零锻造或重新激活被锁定的剑。'],
    keyMechanics: [
      { title: '星资源', description: '首次变身时获得，之后切换回来不会重复领取。' },
      { title: '星尘全押', description: '提交时必须投入全部辉星；每点辉星产生一个技能等级与伤害等级均为 1.5 的攻击段；全部攻击段遵循多段攻击通则。' },
      { title: '锻造状态', description: '等级、激活与锁定状态属于储君，切走后仍会保存。' },
    ],
    featuredActionIds: ['hidden_cache', 'stardust', 'sovereign_blade', 'summon_forth'],
  },
  {
    characterId: 'pikachu', role: '站位传导与机动', difficulty: '进阶',
    summary: '利用圆形地图从自身向两侧传导电击，并用迅雷调整站位与下一次十伯伏特的费用。',
    gamePlan: ['传导压力集中在自身两侧，移动到合适位置再出手。', '迅雷的免耗效果留给下一次十伯伏特，注意它不会强化十万伏特。'],
    keyMechanics: [{ title: '双向传导', description: '电击从自己两侧的相邻地块开始，沿两个方向依次结算。' }],
    featuredActionIds: ['quick_attack', 'ten_volt', 'hundred_thousand_volt'],
  },
  {
    characterId: 'li_chungang', role: '后发斩击', difficulty: '进阶',
    summary: '依靠剑道降低斩的消耗，并在行动公开后为剑气和一剑开天门选择目标。',
    gamePlan: ['后发选择能避开已经失去价值的目标，也能利用公开信息寻找等级差。', '斩仍是核心基础行动；低消耗让你能持续制造威胁。'],
    keyMechanics: [{ title: '剑道', description: '无法使用拳，斩的气与蓄力消耗都降为原来的三分之一。' }],
    featuredActionIds: ['slash', 'sword_aura', 'open_heaven_gate'],
  },
  {
    characterId: 'ao', role: '资源干扰与成长', difficulty: '专家',
    summary: '用吸针对蓄力并推动熟能生巧升级，随后以逐渐便宜、逐渐增强的凹凹神功终结节奏。',
    gamePlan: ['观察谁最可能使用蓄力；吸只有成功获取资源才会推进成长。', '削会由成功的吸带入全场技能池，用来反制其他人的吸并改变生命状态。'],
    keyMechanics: [{ title: '熟能生巧', description: '每次成功获取资源，吸与凹凹神功依序获得新效果；凹凹神功使用后重置升级。' }],
    featuredActionIds: ['absorb_charge', 'aoao_divine', 'cut'],
  },
  {
    characterId: 'nightmare', role: '控制、遮蔽与追击', difficulty: '专家',
    summary: '用梦径、恐惧和黑暗限制对手，再寻找一次决定胜负的锁定冲刺。',
    gamePlan: ['暗影之刃由梦魇专属招式缩减冷却；通用招式不推进冷却。', '无言恐惧的 2 级只用于控制判定、不造成伤害；鬼影重重的黑暗不会致盲梦魇自己。'],
    keyMechanics: [
      { title: '暗影之刃', description: '开局即可使用一次，之后按角色被动说明重新准备。' },
      { title: '鬼影冲刺', description: '目标在行动公开后锁定；击杀与未击杀会落在不同位置。' },
    ],
    featuredActionIds: ['shadow_blade', 'dream_path', 'silent_fear', 'haunting_shadows', 'nightmare_dash'],
  },
  {
    characterId: 'mudrock', role: '防护、受击成长与蓄势', difficulty: '专家',
    summary: '依靠屏障与被选中次数积累反击机会，并用沉睡换取持续时间有限的攻击强化。',
    gamePlan: ['拳会永久成长，但出拳时要特别留意等级差带来的直接死亡风险。', '沉睡期间可提前苏醒；未沉睡回合对应的资源会返还，决定何时醒来是核心取舍。'],
    keyMechanics: [
      { title: '屏障循环', description: '无屏障时按回合计数恢复一层，失去屏障会令生命右移。' },
      { title: '不可选中', description: '沉睡期间无法被选中并免疫伤害，但也不能像普通回合一样自由行动。' },
    ],
    featuredActionIds: ['fist', 'rockfall_hammer', 'filthy_bloodline', 'continue_sleep', 'slash'],
  },
  {
    characterId: 'ye_qingxian', role: '生命换取资源与收割', difficulty: '专家',
    summary: '用祭道抵免最后一点资源缺口，再以掌仙术和君临天下触发吞天回收资源。',
    gamePlan: ['资源合计达到 3 后才能用祭道补足一项恰好差 1 的费用。', '提交专属攻击时先选择吞天获得气或蓄力。'],
    keyMechanics: [{ title: '祭道', description: '自伤不触发濒死获得气；濒死时再次祭道可能直接死亡。' }],
    featuredActionIds: ['immortal_palm', 'rule_the_world'],
  },
  {
    characterId: 'napoleon', role: '公开指令与策略编排', difficulty: '专家',
    summary: '放弃基础资源与全部通用招式，以攻击、防守、战术三种指令编排策略序列，择机执行策略获取有时限的战术优势。',
    gamePlan: ['攻击负责施压，防守维持生存，执行策略获取战术优势后再用强化后的指令压制对手。', '指令缓冲最多保留最近 6 条，公开可见。'],
    keyMechanics: [{ title: '技能树替换', description: '变身后只剩三种指令，完成厄尔巴逃逸前不能再次变身。' }],
    featuredActionIds: ['attack_order', 'defense_order', 'tactical_order'],
  },
  {
    characterId: 'star_god', role: '成长减伤与超脱（练功房测试）', difficulty: '专家',
    summary: '仅在练功房开放；叠加神体与和光同尘，再通过创生星核测试超脱分支。',
    gamePlan: ['先用和光同尘积累神体。', '超脱期间根据局势选择融合或引爆。'],
    keyMechanics: [{ title: '练功房限定', description: '当前设计仍在调整，普通房间不能选择或变身为星神。' }],
    featuredActionIds: ['harmony_with_light', 'nebula_shock', 'create_star_core', 'transcend_fuse', 'transcend_detonate'],
  },
  {
    characterId: 'ku', role: '预判反制与永久成长', difficulty: '专家',
    summary: '预判对手行动分类，应对成功后积累千锤百炼并强化整套专属技能。',
    gamePlan: ['根据对手资源和局势选择杖责、看破或崩裂。', '成长后用裂空刺穿透普通防护。'],
    keyMechanics: [{ title: '应对成功', description: '成功阻止目标行动的预期效果时获得 0.5 气并提高一层成长，最多 4 层。' }],
    featuredActionIds: ['void_pierce', 'censure', 'redirect', 'see_through', 'shatter'],
  },
];

export const characterGuideById = new Map(characterGuides.map((guide) => [guide.characterId, guide]));

export const actionCategoryLabels: Record<ActionCategory, string> = {
  base: '基础', attack: '攻击', defense: '防御', resource: '资源', special: '特殊',
};

export function getCharacterGuide(characterId: string): CharacterGuideDefinition | undefined {
  return characterGuideById.get(characterId);
}

export function getCharacterActionIds(characterId: string): string[] {
  const character = gameConfig.characters.find((candidate) => candidate.id === characterId);
  const guide = getCharacterGuide(characterId);
  return [...new Set([
    ...(character?.forms.flatMap((form) => form.unlockedActions) ?? []),
    ...(guide?.featuredActionIds ?? []),
  ])].filter((id) => actionById.has(id) && !['wave', 'hangup'].includes(id));
}

export function formatGuideActionCost(action: ActionDefinition): string {
  const fixed = Object.entries(action.cost).map(([id, value]) => `${formatNumber(value)} ${resourceById.get(id)?.shortName ?? id}`);
  const variable = action.variable
    ? [action.usesAllVariableResource ? `当前全部 ${resourceById.get(action.variable.resourceId)?.shortName ?? action.variable.resourceId}` : `${formatNumber(action.variable.costPerPower)}n ${resourceById.get(action.variable.resourceId)?.shortName ?? action.variable.resourceId}`]
    : [];
  const flexible = action.anyResourceCost ? [`${formatNumber(action.anyResourceCost)}−n 任意资源`] : [];
  return [...fixed, ...variable, ...flexible].join(' + ') || '无消耗';
}

export function formatGuideActionLevel(action: ActionDefinition): string {
  if (action.variable) {
    const skill = action.variable.skillLevelPerPower ?? action.variable.levelPerPower;
    const damage = action.damageLevel ?? action.variable.damageLevelPerPower ?? action.variable.levelPerPower;
    const damageLabel = action.damageLevel !== undefined ? formatNumber(damage) : `${formatNumber(damage)}n`;
    return action.category === 'attack' && (action.damageLevel !== undefined || damage !== skill)
      ? `技能 ${formatNumber(skill)}n / 伤害 ${damageLabel}`
      : `${formatNumber(skill)}n`;
  }
  if (action.id === 'sovereign_blade') return '锻造等级';
  const skill = action.skillLevel ?? action.level;
  const damage = action.damageLevel ?? skill;
  const skillLabel = skill >= 999 ? '∞' : formatNumber(skill);
  return action.category === 'attack' && damage !== skill ? `技能 ${skillLabel} / 伤害 ${formatNumber(damage)}` : skillLabel;
}

export function formatGuideTarget(action: ActionDefinition): string {
  if (action.targetsGridCell) return '1 个地块 · 预选';
  const mode = action.target.mode;
  if (mode === 'none') return '自身或自动判定';
  const label = mode === 'single_enemy' ? '1 名其他存活玩家' : mode === 'multiple_enemies' ? '其他存活玩家（多次选择）' : '符合效果条件的所有玩家';
  return `${label} · ${action.target.selectionTiming === 'deferred' ? '后发' : mode === 'all_enemies' ? '自动' : '预选'}`;
}

function formatNumber(value: number): string {
  if (Math.abs(value - 1 / 3) < 0.001) return '1/3';
  if (Math.abs(value - 2 / 3) < 0.001) return '2/3';
  return Number.isInteger(value) ? String(value) : String(value);
}
