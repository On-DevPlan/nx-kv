// 任务编排编辑器（DAG 节点视角）：闸门 + 上游依赖（我等谁）+ 下游任务（谁等我）。
// 全部走已有 API（PATCH /api/localtasks/item）：
//   - 闸门 / 上游 → 改本任务（gate、blockBy）
//   - 下游 → 按「勾选 = 对方 blockBy 加我、取消 = 移除」逐条改对方任务的 blockBy
// 环检测在客户端做（core/workflow/readiness.normalizeBlockBy 只排除自身，不查环）：
// 会成环的勾选项直接禁用，保存组合必然无环。
// 闸门开着时下游被自动覆盖（挡住队列里全部后续待领取任务），下游表禁用不落盘；
// **闸门不能声明上游**：快照里闸门的隐含边（gate→后续）与「上游→闸门」成环，
// mutator.addEdge 会拒（fail-open 后投影回写还会清掉 blockBy）——这是引擎约束，
// UI 与其对齐：开闸门即清空并禁用上游段。
import { useState } from 'react';
import { Modal } from '../../components/popup/index.jsx';
import { titleFromMd } from '../../modules/md/md-parse.js';
import { reaches as reachesVia } from '../../../../shared/graph.js';

// 环判定下沉 src/shared/graph.js（与 mutator.addEdge 同一份实现）；
// deps: Map<id, [依赖 id]>，方向 = blockBy（依赖）方向，由闭包喂给共享 reaches。
const reaches = (fromId, toId, deps) => reachesVia((id) => deps.get(id) || [], fromId, toId);

/**
 * @param {object} p
 * @param {object} p.task        被编排的任务（pending）
 * @param {object[]} p.tasks     主题里全部待领取任务（队列序，含 task 自身）
 * @param {Function} p.onClose
 * @param {Function} p.onSave    (patches: Array<{id, gate?, blockBy?}>) => Promise；失败抛错（容器已 toast）
 */
export default function DagEditor({ task, tasks, onClose, onSave }) {
  const idOf = (t) => Number(t.id);
  const myId = idOf(task);
  const others = tasks.filter((t) => idOf(t) !== myId);

  const [gate, setGate] = useState(!!task.blocksFollowing);
  const [ups, setUps] = useState(() => new Set((task.blockBy || []).map(Number)));
  // 下游初始 = 当前 blockBy 里含我的那些任务（显式接线，与闸门的隐式全挡相区分）
  const [downs, setDowns] = useState(
    () => new Set(others.filter((t) => (t.blockBy || []).map(Number).includes(myId)).map(idOf))
  );
  const [busy, setBusy] = useState(false);

  // 队列序在我之后的待领取 = 闸门开启时的自动下游（预览用）
  const myIdx = tasks.findIndex((t) => idOf(t) === myId);
  const autoDown = tasks.slice(myIdx + 1).map(idOf);

  // 环判定用的有效依赖图：**本任务用未保存的本地 ups**（解绑/勾选立即生效），
  // 其他任务用服务端 blockBy——否则「解绑上游再接下游」这类组合会被旧图误禁。
  const deps = new Map(
    tasks.map((t) => [idOf(t), idOf(t) === myId ? [...ups] : (t.blockBy || []).map(Number)]),
  );
  // 环判定（与 mutator.addEdge 的 wouldCreateCycle 同口径：加边 u→v 成环 ⟺ v ⇝ u）：
  //   上游候选 c（加边 c→me）：c ⇝ me ⟺ reaches(c, me, deps)（沿 c 的依赖闭包找我）
  //   下游候选 y（加边 me→y）：y ⇝ me ⟺ reaches(me, y, deps)（沿**我自己的**依赖闭包找 y——
  //   注意方向：此前写成 reaches(y, me, deps) 走的是 y 的闭包，漏判「我已依赖 y」的 2 节点环）
  const upBlocked = (c) => gate || (!ups.has(idOf(c)) && reaches(idOf(c), myId, deps));
  const downBlocked = (y) => !downs.has(idOf(y)) && reaches(myId, idOf(y), deps);

  const toggle = (setter) => (id) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 开闸门 = 本任务不再声明上游（引擎约束：闸门的隐含边与上游边成环）
  const toggleGate = () =>
    setGate((v) => {
      if (!v) setUps(new Set());
      return !v;
    });

  const save = async () => {
    setBusy(true);
    try {
      /** @type {Array<{id:number, gate?:boolean, blockBy?:number[]}>} */
      const patches = [{ id: myId, gate, blockBy: [...ups] }];
      if (!gate) {
        // 闸门关着才落下游：开着时下游是自动的，往别人 blockBy 里塞重复边只会添噪音
        for (const y of others) {
          const yid = idOf(y);
          const want = downs.has(yid);
          const curList = (y.blockBy || []).map(Number);
          const cur = curList.includes(myId);
          if (want === cur) continue;
          patches.push({
            id: yid,
            blockBy: want ? [...curList, myId] : curList.filter((x) => x !== myId),
          });
        }
      }
      await onSave(patches);
      onClose();
    } catch {
      /* 容器已 toast；编辑器保持打开让用户改 */
    } finally {
      setBusy(false);
    }
  };

  const renderItem = (t, checked, blocked, onToggle) => {
    const label = titleFromMd(t.text) || `#${idOf(t)}`;
    return (
      <label key={idOf(t)} className="mdw-dag-item" title={blocked && !busy ? '会造成循环依赖或与闸门约束冲突，已禁用' : undefined}>
        <input
          type="checkbox"
          checked={checked}
          disabled={busy || blocked}
          onChange={() => onToggle(idOf(t))}
        />
        <span className="mono faint">#{idOf(t)}</span>
        <span className="mdw-dag-name">{label}</span>
      </label>
    );
  };

  return (
    <Modal
      title={`编排 · #${myId} ${titleFromMd(task.text) || ''}`}
      onClose={onClose}
      busy={busy}
      size="md"
      footer={
        <>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>
            {busy ? '保存中…' : '保存编排'}
          </button>
        </>
      }
    >
      <div className="mdw-dag">
        <label className="mdw-dag-item mdw-dag-gate" title="闸门：本任务未完成前，队列里排在后面的全部待领取任务都不能被领取">
          <input type="checkbox" checked={gate} disabled={busy} onChange={toggleGate} />
          <b>闸门</b>
          <span className="mdw-dag-hint">挡住队列里所有排在后面的待领取任务（闸门不声明上游依赖）</span>
        </label>
        {gate ? (
          <div className="mdw-dag-note">
            开启时自动挡住 {autoDown.length} 个后续任务
            {autoDown.length ? `：${autoDown.map((id) => `#${id}`).join(', ')}` : '（后面已没有待领取任务）'}
          </div>
        ) : null}

        <div className="mdw-dag-sec">
          上游依赖（我等谁完成）
          {gate ? <span className="mdw-dag-hint">—— 闸门开启时不声明上游，保存后已清空</span> : null}
        </div>
        <div className={'mdw-dag-list' + (gate ? ' dim' : '')}>
          {others.length ? (
            others.map((t) => renderItem(t, ups.has(idOf(t)), upBlocked(t), toggle(setUps)))
          ) : (
            <div className="mdw-dag-note">队列里没有其他待领取任务</div>
          )}
        </div>

        <div className="mdw-dag-sec">
          下游任务（谁被我挡）{gate ? <span className="mdw-dag-hint">—— 闸门开启时此表不生效，自动挡住全部后续</span> : null}
        </div>
        <div className={'mdw-dag-list' + (gate ? ' dim' : '')}>
          {others.length ? (
            others.map((t) => renderItem(t, downs.has(idOf(t)), gate || downBlocked(t), toggle(setDowns)))
          ) : (
            <div className="mdw-dag-note">队列里没有其他待领取任务</div>
          )}
        </div>
        <div className="mdw-dag-note">
          保存会同时改写相关任务的依赖（逐条落盘）；勾选会成环的组合会被禁用。
        </div>
      </div>
    </Modal>
  );
}
