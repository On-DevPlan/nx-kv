// 绑定关系弹窗：dev 侧绑定（一个开发仓库所属组挂哪些参考）+ 组级绑定描述编辑。
// v4 语义：参考仓库绑定在「组」上，组内所有仓库共享；仓库不属于任何组时无处可挂。
import { useState } from 'react';
import { api } from '../../api/client.js';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { Modal } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';

// dev 侧绑定弹窗：某个开发仓库 → 勾选绑到它所属组的参考（组内共享）
export default function BindRepoModal({ repo, refRepos, boardList, currentRefs, onClose, onSaved }) {
  const guard = useGuard();
  const toast = useToast();
  const groups = boardList.filter((b) => (b.repos || []).some((x) => x.key === repo.key));
  const [sel, setSel] = useState(() => {
    const init = {};
    for (const x of currentRefs || []) init[x.key] = true;
    return init;
  });

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
      for (const g of groups) await api('/api/repos/bind', { method: 'POST', body: { id: rid, board: [g.id] } });
    }
    for (const rid of current) {
      if (want.has(rid)) continue;
      for (const g of groups) await api('/api/repos/bind', { method: 'POST', body: { id: rid, board: [g.id], remove: true } });
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
              {refRepos.map((r) => (
                <label className="rp-pick-item" key={r.key}>
                  <input type="checkbox" checked={!!sel[r.key]}
                    onChange={(e) => setSel((m) => ({ ...m, [r.key]: e.target.checked }))} />
                  <span title={r.remote || ''}>{r.name}</span>
                  {r.desc ? <span className="muted rp-pick-desc">{r.desc}</span> : null}
                </label>
              ))}
              {!refRepos.length ? <span className="muted">（还没有参考仓库 —— 先在参考面板里克隆）</span> : null}
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

// 组级绑定描述弹窗：组 ↔ 参考仓库这条关系上「参考什么」（摘绑即清）。
// 从 dev 行的参考 chip、看板参考区块或参考面板的绑定 chip 进入。
export function LinkNoteModal({ linkNoteFor, onClose, onSaved }) {
  const guard = useGuard();
  const toast = useToast();
  const { ref, groupId, groupName, note } = linkNoteFor;
  const [text, setText] = useState(() => note || '');

  const save = () => guard(async () => {
    await api('/api/repos/ref/note', {
      method: 'POST',
      body: { id: ref.key, board: groupId, note: text },
    });
    onClose();
    await onSaved();
    toast('已保存组级绑定描述');
  });

  return (
    <Modal
      title={`组级绑定描述 · ${ref.name} @ 「${groupName}」`}
      onClose={onClose}
    >
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="link-note">
            「{ref.name}」在这个组里参考什么
          </label>
          <div className="form-hint">
            写这条参考在此处的角色与用法（可多行、可含关键路径/搜索词）。留空保存 = 清除。
          </div>
          <textarea id="link-note" rows={5} spellCheck="false"
            placeholder={'如：project-graph 画布交互的实现参考；\n看 src/extensions/ 的注册方式，搜 registerExtension。'}
            value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="form-acts">
          <Button  onClick={onClose}>取消</Button>
          <Button  onClick={save}>保存</Button>
        </div>
      </div>
    </Modal>
  );
}
