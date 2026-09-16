// 登录页：填邮箱密码登录，显示当前登录态与后端地址。
// 密码只在提交时用一次，不进 localStorage、不写日志。
import { useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useStore } from '../../web/frontend/store.jsx';
import { useToast, useGuard, Copyable } from '../../web/frontend/components/ui.jsx';
import { CliHints } from '../../web/frontend/components/CliHints.jsx';

export default function AuthView() {
  const { boot, refreshBoot } = useStore();
  const toast = useToast();
  const guard = useGuard();
  const [email, setEmail] = useState(boot?.email || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const login = () => guard(async () => {
    if (!email.trim()) { toast('请填邮箱'); return; }
    if (!password) { toast('请填密码'); return; }
    setBusy(true);
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { email: email.trim(), password } });
      setPassword(''); // 用完即清，不留在组件状态里
      toast(`已登录: ${r.email}`);
      await refreshBoot();
    } finally {
      setBusy(false);
    }
  });

  const logout = () => guard(async () => {
    await api('/api/auth/logout', { method: 'POST' });
    toast('已登出');
    await refreshBoot();
  });

  return (
    <>
      <div className="card">
        <div className="colhead">
          <h3>登录态</h3>
          <span className={boot?.loggedIn ? 'tag strong' : 'tag bad'}>
            {boot?.loggedIn ? '已登录' : '未登录'}
          </span>
        </div>
        <div className="settings">
          <dt>账号</dt>
          <dd>{boot?.email || <span className="muted">（未登录）</span>}</dd>
          <dt>userId</dt>
          <dd>{boot?.userId || '-'}</dd>
          <dt>后端</dt>
          <dd className="mono"><Copyable text={boot?.baseUrl}>{boot?.baseUrl}</Copyable></dd>
          <dt>本机配置</dt>
          <dd className="mono"><Copyable text={boot?.configPath}>{boot?.configPath}</Copyable></dd>
        </div>
      </div>

      <div className="card">
        <div className="colhead"><h3>{boot?.loggedIn ? '切换账号' : '登录'}</h3></div>
        <div className="row-inline" style={{ padding: 12 }}>
          <input placeholder="邮箱" size="24" spellCheck="false" value={email}
            onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="密码" type="password" size="18" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') login(); }} />
          <button className="btn" onClick={login} disabled={busy}>{busy ? '登录中…' : '登录'}</button>
          {boot?.loggedIn ? <button className="btn ghost danger" onClick={logout}>登出</button> : null}
        </div>
        <div className="muted" style={{ padding: '0 12px 12px', fontSize: 12 }}>
          密码只用于本次请求，不写入本机配置；配置里只保存 token。
          也可以用 CLI：<code>nx-kv auth login &lt;email&gt;</code>（会交互式隐藏输入密码）。
        </div>
      </div>

      <CliHints module="auth" />
    </>
  );
}
