// auth.logout —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { loadConfig as _loadConfig, saveConfig as _saveConfig } from '../../../core/config.js';
const loadConfig: any = _loadConfig;
const saveConfig: any = _saveConfig;

/** auth.logout 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class AuthLogoutAction extends ActionBase<typeof input> {
  @action({
    id: 'auth.logout',
    cli: ['auth', 'logout'],
    http: ['POST', '/api/auth/logout'],
    summary: '清除本机保存的 token',
    input,
    render: (d: any) => (d.was ? `已登出（原账号 ${d.was}）` : '本就未登录'),
  })
  override async run(_ctx: ActionInput<this['_input']>) {

          const before: any = await loadConfig();
          // 只清登录态，保留 baseUrl 与当前工作空间选择
          await saveConfig({ ...before, token: '', email: '', userId: 0 });
          return { loggedOut: true, was: before.email || '' };
      
  }
}
