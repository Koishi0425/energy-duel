import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { actionById, characterById, gameConfig, passiveById, type ActionCategory, type ActionDefinition } from '@energy-duel/shared';
import {
  actionCategoryLabels,
  characterGuides,
  formatGuideActionCost,
  formatGuideActionLevel,
  formatGuideTarget,
  getCharacterActionIds,
  getCharacterGuide,
  glossaryEntries,
  guidePages,
  ruleSections,
  type GuidePageId,
} from '../content/gameGuide';

interface Props {
  open: boolean;
  onClose: () => void;
  initialPage?: GuidePageId;
  initialCharacterId?: string;
}

export default function Tutorial({ open, onClose, initialPage = 'start', initialCharacterId = 'default_character' }: Props) {
  const [page, setPage] = useState<GuidePageId>(initialPage);
  const [selectedCharacterId, setSelectedCharacterId] = useState(initialCharacterId);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setPage(initialPage);
    setSelectedCharacterId(characterById.has(initialCharacterId) ? initialCharacterId : 'default_character');
    setQuery('');
  }, [initialCharacterId, initialPage, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;
  const navigate = (nextPage: GuidePageId, characterId?: string) => {
    setPage(nextPage);
    if (characterId) setSelectedCharacterId(characterId);
    setQuery('');
  };

  return (
    <div className="tutorial-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="tutorial-dialog" role="dialog" aria-modal="true" aria-label="游戏帮助中心">
        <header className="tutorial-header">
          <div><p className="eyebrow">PLAYER GUIDE</p><h2>游戏帮助中心</h2><p>先理解一局，再按角色深入查阅。</p></div>
          <label className="tutorial-search"><span className="sr-only">搜索规则、角色或招式</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索规则、角色或招式…" /></label>
          <button type="button" aria-label="关闭教程" onClick={onClose}>×</button>
        </header>
        <div className="tutorial-layout">
          <nav className="tutorial-navigation" aria-label="教程章节">
            {guidePages.map((item) => <button key={item.id} className={page === item.id && !query.trim() ? 'active' : ''} aria-current={page === item.id && !query.trim() ? 'page' : undefined} onClick={() => navigate(item.id)}><strong>{item.label}</strong><small>{item.description}</small></button>)}
          </nav>
          <main className="tutorial-body">
            {query.trim()
              ? <SearchResults query={query} navigate={navigate} />
              : <>
                {page === 'start' && <StartGuide navigate={navigate} />}
                {page === 'rules' && <RulesGuide />}
                {page === 'characters' && <CharacterGuide characterId={selectedCharacterId} onCharacterChange={setSelectedCharacterId} onShowActions={() => setPage('actions')} />}
                {page === 'actions' && <ActionGuide characterId={selectedCharacterId} onCharacterChange={setSelectedCharacterId} />}
                {page === 'glossary' && <GlossaryGuide />}
              </>}
          </main>
        </div>
      </section>
    </div>
  );
}

function StartGuide({ navigate }: { navigate: (page: GuidePageId, characterId?: string) => void }) {
  return <div className="tutorial-page">
    <div className="tutorial-hero"><p className="eyebrow">FIRST MATCH</p><h3>三分钟理解一局</h3><p>这是一场同时选招的圆盘对战。先看懂行动如何公开和结算，再选择一个角色研究。</p></div>
    <div className="tutorial-step-grid">
      <button onClick={() => navigate('rules')}><span>01</span><strong>秘密选招</strong><p>所有人先提交，最后统一公开；提交后仍可在截止前撤销。</p></button>
      <button onClick={() => navigate('rules')}><span>02</span><strong>比较等级</strong><p>攻击等级与目标本回合招式等级比较，决定抵消、左移或死亡。</p></button>
      <button onClick={() => navigate('rules')}><span>03</span><strong>按速度执行</strong><p>快行动先改变位置和状态，后续技能读取服务器上的最新局面。</p></button>
    </div>
    <section className="tutorial-section"><div className="tutorial-section-heading"><div><p className="eyebrow">CHOOSE A PATH</p><h3>从角色定位开始</h3></div></div><CharacterPicker selectedId="" onSelect={(id) => navigate('characters', id)} compact /></section>
    <div className="tutorial-callout"><strong>第一次玩，建议先用娇斯拉</strong><p>机制直接，能专注学习资源、速度和等级差。熟悉基础规则后，再尝试后发、位移、成长或资源控制角色。</p><button onClick={() => navigate('characters', 'jiaosila')}>查看娇斯拉指南</button></div>
  </div>;
}

function RulesGuide() {
  return <div className="tutorial-page"><PageIntro eyebrow="RULES" title="核心规则" description="每节先给一句结论，需要时再展开细节。" />
    <div className="tutorial-rule-list">{ruleSections.map((section, index) => <details key={section.id} open={index === 0}><summary><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{section.title}</strong><small>{section.summary}</small></div></summary><ul>{section.points.map((point) => <li key={point}>{point}</li>)}</ul></details>)}</div>
  </div>;
}

function CharacterGuide({ characterId, onCharacterChange, onShowActions }: { characterId: string; onCharacterChange: (id: string) => void; onShowActions: () => void }) {
  const character = characterById.get(characterId) ?? gameConfig.characters[0];
  const guide = getCharacterGuide(character.id) ?? characterGuides[0];
  const passives = character.passiveIds?.map((id) => passiveById.get(id)).filter(Boolean) ?? [];
  return <div className="tutorial-page"><PageIntro eyebrow="CHARACTERS" title="角色指南" description="先看定位与回合思路，再查关键招式。" />
    <CharacterPicker selectedId={character.id} onSelect={onCharacterChange} />
    <article className="character-guide-hero"><div><span className={`difficulty difficulty-${guide.difficulty}`}>{guide.difficulty}</span><span>{guide.role}</span></div><h3>{character.name}</h3><p>{guide.summary}</p></article>
    {passives.length > 0 && <section className="tutorial-section"><h4>被动能力</h4><div className="tutorial-card-grid">{passives.map((passive) => passive && <article key={passive.id}><strong>{passive.name}</strong><p>{passive.description}</p></article>)}</div></section>}
    <div className="tutorial-two-column"><section className="tutorial-section"><h4>对局思路</h4><ol>{guide.gamePlan.map((point) => <li key={point}>{point}</li>)}</ol></section><section className="tutorial-section"><h4>关键机制</h4>{guide.keyMechanics.map((mechanic) => <div className="guide-mechanic" key={mechanic.title}><strong>{mechanic.title}</strong><p>{mechanic.description}</p></div>)}</section></div>
    {guide.warnings?.length && <div className="tutorial-warning">{guide.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    <section className="tutorial-section"><div className="tutorial-section-heading"><div><h4>关键招式</h4><p>数值和效果直接来自当前游戏配置。</p></div><button onClick={onShowActions}>查看完整技能树</button></div><div className="tutorial-card-grid">{guide.featuredActionIds.map((id) => actionById.get(id)).filter(Boolean).map((action) => action && <ActionCard key={action.id} action={action} />)}</div></section>
  </div>;
}

function ActionGuide({ characterId, onCharacterChange }: { characterId: string; onCharacterChange: (id: string) => void }) {
  const character = characterById.get(characterId) ?? gameConfig.characters[0];
  const actions = getCharacterActionIds(character.id).map((id) => actionById.get(id)).filter((action): action is ActionDefinition => Boolean(action));
  const grouped = (Object.keys(actionCategoryLabels) as ActionCategory[]).map((category) => ({ category, actions: actions.filter((action) => action.category === category) })).filter((group) => group.actions.length);
  return <div className="tutorial-page"><PageIntro eyebrow="ACTIONS" title="招式图鉴" description="按角色筛选技能，条件技能也会保留在完整列表中。" />
    <CharacterPicker selectedId={character.id} onSelect={onCharacterChange} />
    <div className="tutorial-action-sections">{grouped.map(({ category, actions: categoryActions }) => <section key={category}><h4>{actionCategoryLabels[category]} <small>{categoryActions.length}</small></h4><div className="tutorial-card-grid">{categoryActions.map((action) => <ActionCard key={action.id} action={action} />)}</div></section>)}</div>
  </div>;
}

function GlossaryGuide() {
  return <div className="tutorial-page"><PageIntro eyebrow="GLOSSARY" title="术语速查" description="遇到陌生关键词时，可使用顶部搜索直接定位。" /><dl className="tutorial-glossary">{glossaryEntries.map((entry) => <div key={entry.id}><dt>{entry.term}</dt><dd>{entry.definition}</dd></div>)}</dl></div>;
}

function SearchResults({ query, navigate }: { query: string; navigate: (page: GuidePageId, characterId?: string) => void }) {
  const normalized = query.trim().toLocaleLowerCase();
  const results = useMemo(() => {
    const contains = (...values: Array<string | undefined>) => values.some((value) => value?.toLocaleLowerCase().includes(normalized));
    return {
      rules: ruleSections.filter((section) => contains(section.title, section.summary, ...section.points)),
      glossary: glossaryEntries.filter((entry) => contains(entry.term, entry.definition)),
      characters: characterGuides.filter((guide) => { const character = characterById.get(guide.characterId); return contains(character?.name, guide.role, guide.summary, ...guide.gamePlan, ...guide.keyMechanics.flatMap((item) => [item.title, item.description])); }),
      actions: gameConfig.actions.filter((action) => !['wave', 'hangup'].includes(action.id) && contains(action.name, action.description)),
    };
  }, [normalized]);
  const count = results.rules.length + results.glossary.length + results.characters.length + results.actions.length;
  return <div className="tutorial-page"><PageIntro eyebrow="SEARCH" title={`“${query.trim()}”的搜索结果`} description={count ? `找到 ${count} 条相关内容。` : '没有找到相关内容，可以尝试招式名、角色名或规则术语。'} />
    {results.characters.length > 0 && <SearchSection title="角色">{results.characters.map((guide) => <button className="tutorial-search-result" key={guide.characterId} onClick={() => navigate('characters', guide.characterId)}><strong>{characterById.get(guide.characterId)?.name}</strong><span>{guide.role} · {guide.summary}</span></button>)}</SearchSection>}
    {results.rules.length > 0 && <SearchSection title="规则">{results.rules.map((section) => <button className="tutorial-search-result" key={section.id} onClick={() => navigate('rules')}><strong>{section.title}</strong><span>{section.summary}</span></button>)}</SearchSection>}
    {results.actions.length > 0 && <SearchSection title="招式"><div className="tutorial-card-grid">{results.actions.map((action) => <ActionCard key={action.id} action={action} />)}</div></SearchSection>}
    {results.glossary.length > 0 && <SearchSection title="术语"><dl className="tutorial-glossary">{results.glossary.map((entry) => <div key={entry.id}><dt>{entry.term}</dt><dd>{entry.definition}</dd></div>)}</dl></SearchSection>}
  </div>;
}

function SearchSection({ title, children }: { title: string; children: ReactNode }) { return <section className="tutorial-section"><h4>{title}</h4>{children}</section>; }

function CharacterPicker({ selectedId, onSelect, compact = false }: { selectedId: string; onSelect: (id: string) => void; compact?: boolean }) {
  return <div className={`character-picker${compact ? ' compact' : ''}`} role="list" aria-label="选择角色">{characterGuides.map((guide) => { const character = characterById.get(guide.characterId); return <button role="listitem" key={guide.characterId} className={selectedId === guide.characterId ? 'active' : ''} onClick={() => onSelect(guide.characterId)}><strong>{character?.name ?? guide.characterId}</strong><small>{guide.role}</small></button>; })}</div>;
}

function ActionCard({ action }: { action: ActionDefinition }) {
  return <article className="guide-action-card"><div className="guide-action-title"><strong>{action.name}</strong><span>{actionCategoryLabels[action.category]}</span></div><div className="guide-action-meta"><span>消耗 {formatGuideActionCost(action)}</span><span>等级 {formatGuideActionLevel(action)}</span><span>速度 {action.speedPriority}</span><span>{formatGuideTarget(action)}</span></div>{action.unlockRequirements && <p className="guide-action-lock">解锁：{action.unlockRequirements.description}</p>}<p>{action.description}</p></article>;
}

function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <header className="tutorial-page-intro"><p className="eyebrow">{eyebrow}</p><h3>{title}</h3><p>{description}</p></header>; }
