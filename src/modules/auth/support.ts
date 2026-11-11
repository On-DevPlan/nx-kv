// auth 模块的辅助函数/常量（legacy 形态里与 action 表同文件，迁来时一并搬到这里）。
//
// 参数与返回值暂用宽松类型（迁移期），服务层类型化推进时逐个收紧。
import { updateConfig } from '../../core/config.js';
import { login as apiLogin } from '../../core/kvapi.js';
import { askHidden } from '../../core/prompt.js';
import { badInput } from '../../core/errors.js';

export async function doLogin(ctx: any) {
  const email: any = String(ctx.email || '').trim();
  if (!email) throw badInput('邮箱不能为空');

  // 密码来源优先级：--password（脚本用）> 交互式隐藏输入
  let password: any = ctx.password;
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
