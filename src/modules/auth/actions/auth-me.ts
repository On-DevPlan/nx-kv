// auth.me —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { requireAuth as _requireAuth } from '../../../core/config.js';
import { userInfo as _userInfo } from '../../../core/kvapi.js';
const requireAuth: any = _requireAuth;
const userInfo: any = _userInfo;

/** auth.me 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({

});

export class AuthMeAction extends ActionBase<typeof input> {
  @action({
    id: 'auth.me',
    cli: ['auth', 'me'],
    http: ['GET', '/api/auth/me'],
    summary: '向后端确认身份（验证 token 是否仍有效）',
    input,
    render: (d: any) => JSON.stringify(d, null, 2),
  })
  override async run(_ctx: ActionInput<this['_input']>) {

          await requireAuth();
          const info: any = await userInfo();
          return info ?? { ok: true };
      
  }
}
