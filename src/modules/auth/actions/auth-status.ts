// auth.status —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { authStatusInput } from '../schemas.js';
import { loadConfig as _loadConfig, configPathFromEnv as _configPathFromEnv } from '../../../core/config.js';
const loadConfig: any = _loadConfig;
const configPathFromEnv: any = _configPathFromEnv;

export class AuthStatusAction extends ActionBase<typeof authStatusInput> {
  @action({
    id: 'auth.status',
    cli: ['auth', 'status'],
    http: ['GET', '/api/auth'],
    summary: '查看本机登录态（不请求后端，离线可用）',
    input: authStatusInput,
    render: (d: any) =>
        d.loggedIn
          ? `已登录: ${d.email}（userId=${d.userId}）\n后端: ${d.baseUrl}\n工作空间: ${d.groupId > 0 ? d.groupId : '默认组'}`
          : `未登录（nx-kv auth login <email>）\n后端: ${d.baseUrl}`,
  })
  override async run(_ctx: ActionInput<this['_input']>) {

          const cfg: any = await loadConfig();
          return {
            loggedIn: !!cfg.token,
            email: cfg.email,
            userId: cfg.userId,
            baseUrl: cfg.baseUrl,
            groupId: cfg.groupId,
            configPath: configPathFromEnv(),
          };
      
  }
}
