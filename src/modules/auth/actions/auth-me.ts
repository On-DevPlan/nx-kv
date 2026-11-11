// auth.me —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { authMeInput } from '../schemas.js';
import { requireAuth as _requireAuth } from '../../../core/config.js';
import { userInfo as _userInfo } from '../../../core/kvapi.js';
const requireAuth: any = _requireAuth;
const userInfo: any = _userInfo;

export class AuthMeAction extends ActionBase {
  @action({
    id: 'auth.me',
    cli: ['auth', 'me'],
    http: ['GET', '/api/auth/me'],
    summary: '向后端确认身份（验证 token 是否仍有效）',
    input: authMeInput,
    render: (d: any) => JSON.stringify(d, null, 2),
  })
  async me(_ctx: any) {

          await requireAuth();
          const info: any = await userInfo();
          return info ?? { ok: true };
      
  }
}
