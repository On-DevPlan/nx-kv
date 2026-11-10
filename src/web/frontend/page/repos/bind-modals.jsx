// 绑定关系弹窗：dev 侧绑定（一个开发仓库挂哪些参考）+ 绑定描述编辑。
// 绑定是多对多、双向记录的：dev 侧自带 {kind:'ref'} 反向引用，直接读它即可；
// 老数据（只有 ref 侧）回退扫 ref 全表（全部按 key）。
import { useState } from 'react';
import { api } from '../../api/client.js';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { Modal } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';

// dev 侧绑定弹窗：某个开发仓库 → 勾选绑到它身上的参考
export default function BindRepoModal({ repo, refRepos, onClose, onSaved }) {
  const guard = useGuard();
  const [sel, setSel] = useState(() => {
    const init = {};
    // 优先读 dev 侧的反向引用（绑定双向记录）；老数据回退扫 ref 侧（全部按 key）
    for (const l of repo.linked || []) {
      if (l.kind !== 'ref') continue;
      init[l.id] = true;
    }
    for (const x of refRepos) {
      if (init[x.key]) continue;
      if ((x.linked || []).some((l) => l.kind === 'repo' && l.id === repo.key)) init[x.key] = true;
    }
    return init;
  });

  // 保存 = 对比该仓库当前挂的参考，加/摘各一批
  const save = () => guard(async () => {
    const current = new Set();
    for (const l of repo.linked || []) {
      if (l.kind === 'ref') current.add(l.id);
    }
    for (const x of refRepos) {
      if ((x.linked || []).some((l) => l.kind === 'repo' && l.id === repo.key)) current.add(x.key);
    }
    const want = new Set(Object.keys(sel).filter((k) => sel[k]));
    for (const rid of want) {
      if (current.has(rid)) continue;
      await api('/api/repos/bind', { method: 'POST', body: { id: rid, repo: [repo.key] } });
    }
    for (const rid of current) {
      if (want.has(rid)) continue;
      await api('/api/repos/bind', { method: 'POST', body: { id: rid, repo: [repo.key], remove: true } });
    }
    onClose();
    await onSaved();
  });

  return (
    <Modal title={`「${repo.name}」的参考仓库`} onClose={onClose}>
      <div className="form-grid">
        <div className="form-field">
          <div className="form-hint">
            勾选 = 绑到「{repo.name}」，取消 = 摘除。组级参考（绑在看板上）自动对该组所有成员生效，不在这里重复勾。
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
        </div>
        <div className="form-acts">
          <Button  onClick={onClose}>取消</Button>
          <Button  onClick={save}>保存绑定</Button>
        </div>
      </div>
    </Modal>
  );
}

// 绑定描述弹窗：这条绑定关系上「参考什么」（挂在关系上，摘绑即清）。
// 从 dev 行的参考 chip、看板参考区块或绑定管理弹窗进入。
export function LinkNoteModal({ linkNoteFor, onClose, onSaved }) {
  const guard = useGuard();
  const toast = useToast();
  const { ref, kind, targetId, targetName } = linkNoteFor;
  const [text, setText] = useState(() => {
    const link = (ref.linked || []).find((l) => l.kind === kind && l.id === targetId);
    return link?.note || '';
  });

  const save = () => guard(async () => {
    await api('/api/repos/ref/note', {
      method: 'POST',
      body: { id: ref.key, [kind]: targetId, note: text },
    });
    onClose();
    await onSaved();
    toast('已保存绑定描述');
  });

  return (
    <Modal
      title={`绑定描述 · ${ref.name} @ ${kind === 'board' ? '「' + targetName + '」' : targetName}`}
      onClose={onClose}
    >
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="link-note">
            「{ref.name}」{kind === 'board' ? '在这个组里' : '在这个仓库里'}参考什么
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
