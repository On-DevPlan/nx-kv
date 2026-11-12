// system.health —— 健康检查（纯本机）。
//
// 云端后端已随云端任务模块移除；这里只报告本机服务活着与版本号。
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
}

/** system.health 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({});

export class HealthAction extends ActionBase<typeof input> {
  @action({
    id: 'system.health',
    cli: ['health'],
    http: ['GET', '/api/health'],
    summary: '健康检查（纯本机）',
    input,
  })
  override async run(_ctx: ActionInput<this['_input']>): Promise<HealthReport> {
    return { status: 'ok', version: VERSION };
  }
}
