// 工作空间页：列出我的空间并切换。切换只改本机配置，不动服务端任何数据。
// 切换后清单页会立即显示该空间的数据——后端按 groupId 隔离。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useStore } from '../../web/frontend/store.jsx';
import { useToast, useGuard, Copyable } from '../../web/frontend/components/ui.jsx';
import { CliHints } from '../../web/frontend/components/CliHints.jsx';

export default function GroupView() {
  const { boot, refreshBoot } = useStore();
  const toast = useToast();
  const guard = useGuard();
  const [groups, setGroups] = useState([]);
  const [err, setErr] = useState('');

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
      <div className="card">
        <div className="colhead">
          <h3>我的工作空间</h3>
          <span className="muted">切换后清单页立即跟着变</span>
          <button className="btn small ghost" style={{ marginLeft: 'auto' }} onClick={load}>刷新</button>
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
              <span className="acts">
                {g.id === boot.groupId
                  ? <span className="tag strong">当前</span>
                  : <button className="btn small" onClick={() => use(String(g.id))}>切到这里</button>}
              </span>
            </div>
          ))}
          {!err && !groups.length ? <div className="row muted">（没有其他工作空间）</div> : null}
        </div>
      </div>

      <CliHints module="group" />
    </>
  );
}
