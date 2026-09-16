// 工作空间页：列出、切换、新建、改名、解散。
// 切换只改本机配置，不动服务端任何数据；解散有前置条件（后端要求组内已无 KV）。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useStore } from '../../web/frontend/store.jsx';
import { useToast, useGuard, useDialog, Copyable, Modal } from '../../web/frontend/components/ui.jsx';
import { CliHints } from '../../web/frontend/components/CliHints.jsx';

export default function GroupView() {
  const { boot, refreshBoot } = useStore();
  const toast = useToast();
  const guard = useGuard();
  const { dialog, node: dialogNode } = useDialog();
  const [groups, setGroups] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: '', description: '' });
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    if (!boot?.loggedIn) return;
    try {
      const d = await api('/api/groups');
      setGroups(d.groups || []);
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  }, [boot?.loggedIn]);

  useEffect(() => { load(); }, [load]);

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

  const members = (g) => guard(async () => {
    const d = await api(`/api/groups/${g.id}/members`);
    setModal({
      title: `成员 · ${g.name}`,
      node: (
        <div className="list">
          {d.members.length
            ? d.members.map((m) => (
                <div className="row" key={m.userId}>
                  <Copyable className="name" text={m.email} title="点击复制邮箱">{m.email}</Copyable>
                  <span className="tag">{m.role || 'member'}</span>
                  <span className="muted">{m.nickname}</span>
                </div>
              ))
            : <div className="row muted">（没有成员）</div>}
        </div>
      ),
    });
  });

  if (!boot?.loggedIn) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="colhead"><h3>请先登录</h3></div>
        <div className="muted">工作空间需要登录后才能列出。</div>
      </div>
    );
  }

  return (
    <>
      <div className="toolbar">
        <input placeholder="新工作空间名称" size="16" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
        <input placeholder="描述（可选）" size="20" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button className="btn" onClick={create}>新建</button>
        <span className="sep"></span>
        <button className="btn ghost" onClick={() => guard(load)}>刷新</button>
      </div>

      <div className="card">
        <div className="colhead">
          <h3>我的工作空间</h3>
          <span className="muted">切换后清单页立即跟着变</span>
        </div>
        <div className="list">
          {err ? <div className="row muted">{err}</div> : null}

          <div className="row">
            <span className="name">默认组</span>
            <span className="desc">不传 groupId，由后端回落</span>
            <span className="acts">
              {boot.groupId === 0
                ? <span className="tag strong">当前</span>
                : <button className="btn small" onClick={() => use('default')}>切到这里</button>}
            </span>
          </div>

          {groups.map((g) => (
            <div className="row" key={g.id}>
              <Copyable className="name" text={g.name} title="点击复制名称">{g.name}</Copyable>
              <span className="tag">{g.myRole || 'member'}</span>
              <span className="desc">{g.description || ''}</span>
              <span className="muted mono">id={g.id}</span>
              <span className="muted">{g.memberCount} 人</span>
              <span className="acts">
                {g.id === boot.groupId
                  ? <span className="tag strong">当前</span>
                  : <button className="btn small" onClick={() => use(String(g.id))}>切到这里</button>}
                <button className="btn small ghost" onClick={() => members(g)}>成员</button>
                <button className="btn small ghost" onClick={() => rename(g)}>改名</button>
                <button className="btn small ghost danger" onClick={() => remove(g)}>解散</button>
              </span>
            </div>
          ))}
          {!err && !groups.length ? <div className="row muted">（没有其他工作空间）</div> : null}
        </div>
      </div>

      <CliHints module="group" />
      {modal ? <Modal title={modal.title} onClose={() => setModal(null)}>{modal.node}</Modal> : null}
      {dialogNode}
    </>
  );
}
