// auth.login —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { authLoginInput } from '../schemas.js';
import { configPathFromEnv as _configPathFromEnv } from '../../../core/config.js';
import { doLogin } from '../support.js';
const configPathFromEnv: any = _configPathFromEnv;

export class AuthLoginAction extends ActionBase<typeof authLoginInput> {
  @action({
    id: 'auth.login',
    cli: ['auth', 'login'],
    http: ['POST', '/api/auth/login'],
    summary: '登录并保存 token 到本机配置',
    args: ['email'],
    input: authLoginInput,
    render: (d: any) => `已登录: ${d.email}（userId=${d.userId}）\n配置: ${configPathFromEnv()}`,
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return doLogin(ctx);
  }
}
