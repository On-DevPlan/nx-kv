import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as service from '../service.js';

function valuesOf(raw: unknown): Record<string, string> {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[String(k)] = String(v ?? '');
  return out;
}

const input = z.object({
  entryId: z.string().describe('入口 id（plugin entries 可查）'),
  topic: z.string().optional().describe('主题 key'),
  group: z.string().optional().describe('组 key'),
  repo: z.string().optional().describe('仓库 key'),
  values: z.unknown().optional().describe('槽位值对象（CLI 可传 JSON 字符串）'),
});

export class PretaskDraftAction extends ActionBase<typeof input> {
  @action({
    id: 'pretask.draft',
    cli: ['pretask', 'draft'],
    http: ['POST', '/api/pretask/draft'],
    summary: '按 pretask 入口生成 task 编辑页草稿（只生成正文，不落队列）',
    input,
    render: (d: any) => String(d?.body || ''),
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return service.buildDraft({
      entryId: ctx.entryId,
      topicKey: ctx.topic,
      groupKey: ctx.group,
      repoKey: ctx.repo,
      values: valuesOf(ctx.values),
    });
  }
}
