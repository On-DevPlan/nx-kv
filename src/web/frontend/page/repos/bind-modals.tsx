// 绑定关系弹窗：dev 侧绑定（一个开发仓库所属组挂哪些参考）。
// v4 语义：参考仓库绑定在「组」上，组内所有仓库共享；仓库不属于任何组时无处可挂。
//
// #134：**组级绑定描述的弹窗整块删掉**——描述不再是关系边上的一个字符串，
// 而是归档成这个参考仓库的一篇文档（见仓库管理页的「文档列表」入口）。
// 这里只保留「绑定」这件事本身。
import { useState } from 'react';
import { bindRef } from './api.js';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { Modal } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';
import { ListSearch } from '../../components/list-search.jsx';
import { filterByKeyword } from '../../modules/list-filter.js';
import type { BoardRecord, RepoRecord } from './repo-table.js';

// dev 侧绑定弹窗：某个开发仓库 → 勾选绑到它所属组的参考（组内共享）
export default function BindRepoModal({ repo, refRepos, boardList, currentRefs, onClose, onSaved }: {
  repo: RepoRecord;
  refRepos: RepoRecord[];
  boardList: BoardRecord[];
  currentRefs: { key: string }[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const guard = useGuard();
  const toast = useToast();
  const groups = boardList.filter((b) => (b.repos || []).some((x) => x.key === repo.key));
  const [sel, setSel] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const x of currentRefs || []) init[x.key] = true;
    return init;
  });
  // #149：参考仓库勾选列表的关键词过滤
  const [q, setQ] = useState('');
  const shownRefRepos = filterByKeyword(refRepos, q, (r) => [r.name, r.key, r.desc]);

  // 保存 = 对比该仓库所属组当前挂的参考，加/摘各一批（逐组打）
  const save = () => guard(async () => {
    if (!groups.length) {
      toast('这个仓库不属于任何组 —— 参考绑定挂在组上；先把它加入组');
      return;
    }
    const current = new Set((currentRefs || []).map((x) => x.key));
    const want = new Set(Object.keys(sel).filter((k) => sel[k]));
    for (const rid of want) {
      if (current.has(rid)) continue;
      for (const g of groups) await bindRef({ id: rid, board: [g.id] });
    }
    for (const rid of current) {
      if (want.has(rid)) continue;
      for (const g of groups) await bindRef({ id: rid, board: [g.id], remove: true });
    }
    onClose();
    await onSaved();
  });

  return (
    <Modal title={`「${repo.name}」的参考仓库`} onClose={onClose}>
      <div className="form-grid">
        <div className="form-field">
          <div className="form-hint">
            参考仓库绑定在组上，勾选 = 绑到「{repo.name}」所属的组，组内所有仓库共享。仓库不属于任何组时请先把它加入组。
          </div>
          <div className="rp-pick-list">
            <div className="rp-pick-group">
              <span className="rp-pick-group-label">参考仓库</span>
              {refRepos.length > 1 ? (
                <ListSearch
                  value={q}
                  onChange={setQ}
                  placeholder="搜索参考仓库…"
                  title="过滤参考仓库"
                  count={shownRefRepos.length}
                  className="wide"
                />
              ) : null}
              {shownRefRepos.map((r) => (
                <label className="rp-pick-item" key={r.key}>
                  <input type="checkbox" checked={!!sel[r.key]}
                    onChange={(e) => setSel((m) => ({ ...m, [r.key]: e.target.checked }))} />
                  <span title={r.remote || ''}>{r.name}</span>
                  {r.desc ? <span className="muted rp-pick-desc">{r.desc}</span> : null}
                </label>
              ))}
              {!refRepos.length ? <span className="muted">（还没有参考仓库 —— 先在参考面板里克隆）</span>
                : !shownRefRepos.length ? <span className="muted">（没有匹配的参考仓库）</span> : null}
            </div>
          </div>
          {!groups.length ? (
            <div className="form-hint rp-ref-warn">这个仓库不属于任何组，保存会被拒绝 —— 先把它加入组。</div>
          ) : (
            <div className="form-hint">将写入：{groups.map((g) => g.name).join('、')}</div>
          )}
        </div>
        <div className="form-acts">
          <Button  onClick={onClose}>取消</Button>
          <Button  onClick={save}>保存绑定</Button>
        </div>
      </div>
    </Modal>
  );
}
