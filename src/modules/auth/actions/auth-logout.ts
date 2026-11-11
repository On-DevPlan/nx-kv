// auth.logout —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { authLogoutInput } from '../schemas.js';
import { loadConfig as _loadConfig, saveConfig as _saveConfig } from '../../../core/config.js';
const loadConfig: any = _loadConfig;
const saveConfig: any = _saveConfig;

export class AuthLogoutAction extends ActionBase {
  @action({
    id: 'auth.logout',
    cli: ['auth', 'logout'],
    http: ['POST', '/api/auth/logout'],
    summary: '清除本机保存的 token',
    input: authLogoutInput,
    render: (d: any) => (d.was ? `已登出（原账号 ${d.was}）` : '本就未登录'),
  })
  async logout(_ctx: any) {

          const before: any = await loadConfig();
          // 只清登录态，保留 baseUrl 与当前工作空间选择
          await saveConfig({ ...before, token: '', email: '', userId: 0 });
          return { loggedOut: true, was: before.email || '' };
      
  }
}
