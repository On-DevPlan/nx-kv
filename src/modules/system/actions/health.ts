// system.health —— 健康检查：本机配置 + 远程后端可达性。
//
// 依赖经 IoC 容器取（config）；后端探测是**只读**的 /api/v1/user/info，
// 失败不算错误（health 的语义是「如实报告」，错误文案进 backendError 字段）。
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';

const VERSION: string = JSON.parse(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
).version;

export interface HealthReport {
  status: 'ok';
  version: string;
  baseUrl: string;
  configPath: string;
  loggedIn: boolean;
  backend: 'reachable' | 'unreachable' | string;
  backendError: string;
}

/** system.health 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({});

export class HealthAction extends ActionBase<typeof input> {
  @action({
    id: 'system.health',
    cli: ['health'],
    http: ['GET', '/api/health'],
    summary: '健康检查（本机配置 + 后端可达性）',
    input,
  })
  override async run(_ctx: ActionInput<this['_input']>): Promise<HealthReport> {
    const config = this.deps.get('config');
    const cfg = await config.loadConfig();
    let backend = 'unreachable';
    let backendError = '';
    try {
      const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/api/v1/user/info', {
        headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : {},
        signal: AbortSignal.timeout(6000),
      });
      backend = res.ok ? 'reachable' : `http ${res.status}`;
    } catch (e) {
      backendError = String((e as { message?: string }).message || e);
    }
    return {
      status: 'ok',
      version: VERSION,
      baseUrl: cfg.baseUrl,
      configPath: config.configPathFromEnv(),
      loggedIn: !!cfg.token,
      backend,
      backendError,
    };
  }
}
