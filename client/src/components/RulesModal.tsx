import { ALL_MOVES } from '../moves';

interface Props {
  show: boolean;
  onClose: () => void;
}

// Simplified: level, name, cost, ATK, DEF only
const movesSummary = ALL_MOVES.map(m => ({
  level: m.level,
  name: m.name,
  cost: m.cost === 1/3 ? '⅓' : m.cost === 0.5 ? '½' : String(m.cost),
  atk: m.atk || '—',
  def: m.def || '—',
}));

export default function RulesModal({ show, onClose }: Props) {
  if (!show) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>游戏规则</h2>

        <h3>回合流程</h3>
        <p>每回合所有人同步选招 → 同时揭示 → 结算伤害 → 下一回合</p>

        <h3>死亡判定</h3>
        <ul>
          <li>攻 &gt; 防 → 防守方死亡</li>
          <li>对攻差 ≥ 9 → 低攻方死；差 &lt; 9 → 平手</li>
        </ul>

        <h3>气</h3>
        <ul>
          <li>用「运」攒 1 气，出招扣对应气数</li>
          <li>气数公开可见，有人出局后，幸存者气数归零</li>
        </ul>

        <h3>升级</h3>
        <ul>
          <li>赢一局升 1 级，解锁新招式</li>
          <li>每局 ⌊人数÷2⌋ 以下的人升级，从高排名分配</li>
          <li>场上最高最低级差 &gt; 5 → 弱者等级补足</li>
        </ul>

        <h3>全局招式</h3>
        <ul>
          <li>龙盾（Lv.4）、跺（Lv.7）、毒盾（Lv.12）</li>
          <li>任何人达到等级 → <strong>全员解锁</strong></li>
        </ul>

        <h3>招式总览</h3>
        <div className="moves-table-wrap">
          <table className="moves-table">
            <thead>
              <tr>
                <th>Lv</th>
                <th>招式</th>
                <th>气</th>
                <th>攻</th>
                <th>防</th>
              </tr>
            </thead>
            <tbody>
              {movesSummary.map((m, i) => (
                <tr key={i}>
                  <td>{m.level}</td>
                  <td>{m.name}</td>
                  <td>{m.cost}</td>
                  <td>{m.atk}</td>
                  <td>{m.def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button className="btn btn-primary" onClick={onClose}>阅</button>
      </div>
    </div>
  );
}
