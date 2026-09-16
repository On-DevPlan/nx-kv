// 认证模块：登录 / 登出 / 查看登录态。
//
// 登录成功后**只把 token 写进本机配置**，密码不落盘、不进日志。
// 所有需要 token 的模块都通过 core/config.js 的 requireAuth() 取，不各自读配置。
import { loadConfig, updateConfig, saveConfig, requireAuth, configPathFromEnv } from '../../core/config.js';
import { login as apiLogin, userInfo } from '../../core/kvapi.js';
import { askHidden } from '../../core/prompt.js';
import { badInput } from '../../core/errors.js';

async function doLogin(ctx) {
  const email = String(ctx.email || '').trim();
  if (!email) throw badInput('邮箱不能为空');

  // 密码来源优先级：--password（脚本用）> 交互式隐藏输入
  let password = ctx.password;
  if (!password) {
    password = await askHidden(`请输入 ${email} 的密码: `);
  }
  if (!password) throw badInput('密码不能为空');

  const { token, userId } = await apiLogin(email, password, { baseUrl: ctx.baseUrl });
  await updateConfig({
    token,
    userId,
    email,
    ...(ctx.baseUrl ? { baseUrl: ctx.baseUrl } : {}),
  });
  return { email, userId, tokenSaved: true };
}

export default {
  id: 'auth',
  title: '认证（登录态）',
  order: 10,
  view: () => import('./view.jsx'),

  actions: [
    {
      id: 'auth.login',
      cli: ['auth', 'login'],
      http: ['POST', '/api/auth/login'],
      summary: '登录并保存 token 到本机配置',
      args: ['email'],
      flags: {
        password: { type: 'string', hint: '密码（省略则交互式隐藏输入）' },
        baseUrl: { type: 'string', hint: '后端地址，覆盖默认' },
      },
      run: doLogin,
      render: (d) => `已登录: ${d.email}（userId=${d.userId}）\n配置: ${configPathFromEnv()}`,
    },
    {
      id: 'auth.logout',
      cli: ['auth', 'logout'],
      http: ['POST', '/api/auth/logout'],
      summary: '清除本机保存的 token',
      run: async () => {
        const before = await loadConfig();
        // 只清登录态，保留 baseUrl 与当前工作空间选择
        await saveConfig({ ...before, token: '', email: '', userId: 0 });
        return { loggedOut: true, was: before.email || '' };
      },
      render: (d) => (d.was ? `已登出（原账号 ${d.was}）` : '本就未登录'),
    },
    {
      id: 'auth.status',
      cli: ['auth', 'status'],
      http: ['GET', '/api/auth'],
      summary: '查看本机登录态（不请求后端，离线可用）',
      run: async () => {
        const cfg = await loadConfig();
        return {
          loggedIn: !!cfg.token,
          email: cfg.email,
          userId: cfg.userId,
          baseUrl: cfg.baseUrl,
          groupId: cfg.groupId,
          configPath: configPathFromEnv(),
        };
      },
      render: (d) =>
        d.loggedIn
          ? `已登录: ${d.email}（userId=${d.userId}）\n后端: ${d.baseUrl}\n工作空间: ${d.groupId > 0 ? d.groupId : '默认组'}`
          : `未登录（nx-kv auth login <email>）\n后端: ${d.baseUrl}`,
    },
    {
      id: 'auth.me',
      cli: ['auth', 'me'],
      http: ['GET', '/api/auth/me'],
      summary: '向后端确认身份（验证 token 是否仍有效）',
      run: async () => {
        await requireAuth();
        const info = await userInfo();
        return info ?? { ok: true };
      },
      render: (d) => JSON.stringify(d, null, 2),
    },
  ],
};
