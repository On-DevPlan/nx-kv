// auth.login —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { configPathFromEnv as _configPathFromEnv } from '../../../core/config.js';
import { doLogin } from '../support.js';
const configPathFromEnv: any = _configPathFromEnv;

/** auth.login 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  email: z.string(),
  password: z.string().optional().describe("密码（省略则交互式隐藏输入）"),
  baseUrl: z.string().optional().describe("后端地址，覆盖默认"),
});

export class AuthLoginAction extends ActionBase<typeof input> {
  @action({
    id: 'auth.login',
    cli: ['auth', 'login'],
    http: ['POST', '/api/auth/login'],
    summary: '登录并保存 token 到本机配置',
    args: ['email'],
    input,
    render: (d: any) => `已登录: ${d.email}（userId=${d.userId}）\n配置: ${configPathFromEnv()}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return doLogin(ctx);
  }
}
