// 工作空间弹窗：清单页的「工作空间」入口点开后弹出的那一层。
//
// 工作空间本质是**清单的设置**（它决定清单按哪一组隔离读写），所以它不再是
// 一个独立的 tab / 独立的模块，而是清单页工具栏里的一颗药丸，点开就是这个弹窗。
// 弹窗里能：切换当前工作空间 / 看成员 / 改名 / 解散 / 新建。
//
// 所有操作都走清单模块已经声明好的 /api/groups* 与 /api/group 路由，
// 与 CLI 的 `nx-kv group ...` 完全同源（面板上每个按钮都有一条等价 CLI 命令）。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useStore } from '../../web/frontend/store.jsx';
import { useToast, useGuard, useDialog, Copyable, Modal } from '../../web/frontend/components/ui.jsx';

export default function GroupPopup({ onClose }) {
  const { boot, refreshBoot } = useStore();
  const toast = useToast();
  const guard = useGuard();
  const { dialog, node: dialogNode } = useDialog();
  const [groups, setGroups] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: '', description: '' });
  const [members, setMembers] = useState(null); // { group, list }

  const load = useCallback(async () => {
    try {
      const d = await api('/api/groups');
      setGroups(d.groups || []);
      setErr('');
    } catch (e) {
      setErr(e.message || String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = boot?.groupId ?? 0;

  const use = (locator) => guard(async () => {
    const g = await api('/api/group', { method: 'POST', body: { locator } });
    toast(g.id === 0 ? '已切回默认组' : `已切换到 ${g.name}`);
    await refreshBoot();
    await load();
  });

  const create = () => guard(async () => {
    const name = form.name.trim();
    if (!name) { toast('请填名称'); return; }
    const g = await api('/api/groups', {
      method: 'POST',
      body: { name, description: form.description.trim() },
    });
    setForm({ name: '', description: '' });
    toast(`已新建工作空间 ${g.name}（id=${g.id}）`);
    await refreshBoot();
    await load();
  });

  const rename = (g) => guard(async () => {
    const name = await dialog({ title: `重命名「${g.name}」`, input: true, value: g.name });
    if (name === null || !name.trim()) return;
    await api(`/api/groups/${g.id}`, { method: 'PATCH', body: { name: name.trim() } });
    toast('已更新名称');
    await refreshBoot();
    await load();
  });

  const remove = (g) => guard(async () => {
    const ok = await dialog({
      message: `解散工作空间「${g.name}」（id=${g.id}）？\n\n后端要求组内已无 KV 数据，否则会拒绝。此操作不可撤销。`,
      danger: true,
    });
    if (!ok) return;
    await api(`/api/groups/${g.id}`, { method: 'DELETE' });
    toast(`已解散 ${g.name}`);
    await refreshBoot();
    await load();
  });

  const showMembers = (g) => guard(async () => {
    const d = await api(`/api/groups/${g.id}/members`);
    setMembers({ group: d.group, list: d.members || [] });
  });

  if (!boot?.loggedIn) {
    return (
      <Modal title="工作空间" onClose={onClose}>
        <div className="muted">工作空间需要登录后才能列出。</div>
      </Modal>
    );
  }

  return (
    <>
      <Modal title="工作空间" onClose={onClose}>
        <div className="muted" style={{ marginBottom: 8 }}>
          清单按工作空间隔离读写。切换只改本机配置，不动服务端数据。
        </div>

        {err ? <div className="row muted">{err}</div> : null}

        <div className="list">
          <div className="row">
            <span className="name">默认组</span>
            <span className="desc">不传 groupId，由后端回落</span>
            <span className="acts">
              {current === 0
                ? <span className="tag strong">当前</span>
                : <button className="btn small" onClick={() => use('default')}>切到这里</button>}
            </span>
          </div>

          {groups.map((g) => (
            <div className="row" key={g.id}>
              <Copyable className="name" text={g.name} title="点击复制名称">{g.name}</Copyable>
              <span className="tag">{g.myRole || 'member'}</span>
              {g.description ? <span className="desc">{g.description}</span> : null}
              <span className="muted mono">id={g.id}</span>
              <span className="muted">{g.memberCount} 人</span>
              <span className="acts">
                {g.id === current
                  ? <span className="tag strong">当前</span>
                  : <button className="btn small" onClick={() => use(String(g.id))}>切到这里</button>}
                <button className="btn small ghost" onClick={() => showMembers(g)}>成员</button>
                <button className="btn small ghost" onClick={() => rename(g)}>改名</button>
                <button className="btn small ghost danger" onClick={() => remove(g)}>解散</button>
              </span>
            </div>
          ))}
          {!err && !groups.length ? <div className="row muted">（没有其他工作空间）</div> : null}
        </div>

        <div className="toolbar" style={{ marginTop: 10 }}>
          <input
            placeholder="新工作空间名称"
            size="16"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          />
          <input
            placeholder="描述（可选）"
            size="20"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <button className="btn" onClick={create}>新建</button>
          <button className="btn ghost" onClick={() => guard(load)}>刷新</button>
        </div>
      </Modal>

      {/* 成员（再一层） */}
      {members ? (
        <Modal title={`成员 · ${members.group.name}`} onClose={() => setMembers(null)}>
          <div className="list">
            {members.list.length
              ? members.list.map((m) => (
                  <div className="row" key={m.userId}>
                    <Copyable className="name" text={m.email} title="点击复制邮箱">{m.email}</Copyable>
                    <span className="tag">{m.role || 'member'}</span>
                    <span className="muted">{m.nickname}</span>
                  </div>
                ))
              : <div className="row muted">（没有成员）</div>}
          </div>
        </Modal>
      ) : null}

      {dialogNode}
    </>
  );
}
