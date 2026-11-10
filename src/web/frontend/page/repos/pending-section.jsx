// 待初始化区块：组里引用了、本机却还没有登记的仓库（导入布局带进来的占位）。
//
// 按 **key** 认领（key 是仓库与仓库组链接的唯一方式）：
//   克隆到本地（占位带 remote 时）/ 用本机已有仓库接管。
// 三条出口：接到本机仓库（改关系，不动身份）/ 克隆到本地 / 直接移除。
// 「无远程地址」的占位克隆不回来，只能清 —— 所以给一条批量清理。
import { useMemo } from 'react';
import { api } from '../../api/client.js';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';

export default function PendingSection({ boards, devRepos, refRepos, reload }) {
  const guard = useGuard();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();

  // 自动匹配候选：占位往往只剩一个 key（末段就是它唯一的名字），
  // 本机同名仓库 / 同名目录都可以是它的真身——先给一个「一键绑定」，
  // 不要让人手工去翻 key。
  const pendingInit = useMemo(() => {
    const byName = new Map();
    for (const r of [...devRepos, ...refRepos]) {
      const base = String(r.path || '').split(/[\\/]/).filter(Boolean).pop() || '';
      for (const n of [r.name, base]) {
        const k = String(n || '').toLowerCase();
        if (k && !byName.has(k)) byName.set(k, r);
      }
    }
    const out = [];
    for (const b of (boards && boards.boards) || []) {
      for (const m of b.repos || []) {
        if (m.present !== false) continue;
        const tail = String(m.key || '').split('/').filter(Boolean).pop() || '';
        const match =
          byName.get(String(m.name || '').toLowerCase()) ||
          byName.get(tail.toLowerCase()) ||
          null;
        out.push({ ...m, board: b.name, boardId: b.id, match });
      }
    }
    return out;
  }, [boards, devRepos, refRepos]);

  const clonePending = (m) =>
    guard(async () => {
      await api('/api/repos/clone', {
        method: 'POST',
        body: { remote: m.remote, key: m.key, name: m.name || undefined, type: 'dev' },
      });
      toast(`已克隆并登记：${m.name || m.key}`);
      reload.repos();
      reload.boards();
    });

  // 重绑 = 改**关系**：把组里那个假 key 换成本机仓库的真 key。
  // 以前的「接管」改的是本机仓库的 key（PATCH /api/repos/:id {key}）——
  // 那样会把真实身份降级成 local/xxx，再导出就把假 key 传播出去。
  const bindPending = (m, target) =>
    guard(async () => {
      await api('/api/boards/rekey', { method: 'POST', body: { from: m.key, to: target } });
      toast(`已把「${m.name || m.key}」这个位置接到本机仓库`);
      reload.repos();
      reload.boards();
    });

  const bindPendingPick = (m) =>
    guard(async () => {
      const which = await dialog({
        title: `把「${m.name || m.key}」接到哪个本机仓库？`,
        input: true,
        placeholder: '本机仓库：id / key / 名称 / 绝对路径',
      });
      if (!which) return;
      await api('/api/boards/rekey', { method: 'POST', body: { from: m.key, to: which } });
      toast('已重绑——这个位置现在指向本机仓库');
      reload.repos();
      reload.boards();
    });

  const removePending = (m) =>
    guard(async () => {
      if (!confirm(`把「${m.name || m.key}」从组「${m.board}」里移除？\n\n只摘这个组里的位置：本机仓库与看板本身都不动。`)) return;
      await api('/api/boards/assign', {
        method: 'POST',
        body: { key: m.key, board: m.boardId, remove: true },
      });
      toast(`已从组「${m.board}」移除`);
      reload.boards();
    });

  // 批量清理：只清**没有任何线索**的占位（没有远程地址 → 克隆不回来 → 永远转不了正）。
  // 先预览再落盘，清单给到人看。
  const prunePending = () =>
    guard(async () => {
      const dry = await api('/api/boards/prune', { method: 'POST', body: { apply: false } });
      if (!dry?.total) {
        toast('没有可清理的占位（有远程地址的那些留着等 clone）');
        return;
      }
      const names = dry.items.map((i) => `· ${i.name}（组 ${i.board}）`).join('\n');
      if (!confirm(`清理 ${dry.total} 个无来源占位？\n\n${names}\n\n它们没有远程地址，克隆不回来，只能删。`)) return;
      await api('/api/boards/prune', { method: 'POST', body: { apply: true } });
      toast(`已清理 ${dry.total} 个占位`);
      reload.boards();
    });

  if (!pendingInit.length) return null;

  return (
    <section className="rp-pending" data-testid="rp-pending-init">
      <header className="rp-pending-head">
        <div className="rp-pending-head-main">
          <h3>
            待初始化<span className="rp-pending-count">{pendingInit.length}</span>
          </h3>
          <p>组里有位置、本机没有登记。接到本机仓库、克隆下来，或者直接移除。</p>
        </div>
        <Button small onClick={prunePending}>
          清理无来源占位
        </Button>
      </header>
      <div className="rp-pending-list">
        {pendingInit.map((m) => (
          <article className="rp-pending-card" key={m.key + '@' + m.boardId}>
            <div className="rp-pending-info">
              <div className="rp-pending-title">
                <strong>{m.name || m.key}</strong>
                <span className="rp-pending-board">组 · {m.board}</span>
                {m.remote ? null : <span className="rp-pending-tag">无远程地址</span>}
              </div>
              <code className="rp-pending-key">{m.key}</code>
              {m.desc ? <p className="rp-pending-desc">{m.desc}</p> : null}
            </div>
            <div className="rp-pending-acts">
              {m.match ? (
                <Button
                  small
                  title={`把组里这个位置指向本机仓库「${m.match.name}」（仓库身份不变）`}
                  onClick={() => bindPending(m, m.match.id)}
                >
                  绑定到「{m.match.name}」
                </Button>
              ) : null}
              {m.remote ? (
                <Button small onClick={() => clonePending(m)}>克隆到本地</Button>
              ) : null}
              <Button small onClick={() => bindPendingPick(m)}>选本机仓库</Button>
              <Button
                small danger
                title="只从组里摘掉这个位置，本机仓库与看板都不动"
                onClick={() => removePending(m)}
              >
                移除
              </Button>
            </div>
          </article>
        ))}
      </div>
      {dialogNode}
    </section>
  );
}
