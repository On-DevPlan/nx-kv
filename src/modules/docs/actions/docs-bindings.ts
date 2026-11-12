// docs.bindings —— ref 视角的绑定查询（只读）。
//
// 与其他绑定接口的关系：写绑定永远走「宿主文档集」那一侧（repo.doc.add / docs.link，
// 由 syncRefIndex 推导落 ref_bindings）；本接口只负责**读**，让文档页能回答
// 「这篇文档被谁引用」，也让仓库表格一次拿全所有宿主的归属，避免逐宿主 N+1。
//
// position=0 即主篇（仓库/组介绍），见 docs/ref-sync.ts 的 desiredBindings。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { getDb } from '../../../core/db/index.js';
import { refIdOf } from '../../../core/db/import-json.js';

/** 入参 docId（rel:/path: 或无前缀 locator）→ ref id。 */
function toRefId(v: string): string {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.startsWith('ref:')) return s.slice(4);
  const locator = s.startsWith('rel:') ? s.slice(4) : s.startsWith('path:') ? s.slice(5) : s;
  return refIdOf(locator.replace(/\\/g, '/'));
}

const input = z.object({
  ref: z.string().optional().describe('文档 id / docId（rel:/path: 或裸 locator）——只看这篇文档的归属'),
  host: z.string().optional().describe('宿主 key —— 只看这个仓库/项目组的文档集'),
});

export class DocsBindingsAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.bindings',
    cli: ['docs', 'bindings'],
    http: ['GET', '/api/docs/bindings'],
    summary: '查文档归属（--ref <docId> 看这篇被谁引用；--host <key> 看这个宿主的文档集；position=0 为主篇）',
    input,
    // 备注（只有附加篇有：主篇 push 时不带 note）跟着 main 一起打，和前端 tag 上的
    // 「附加 · 备注」保持同一口径——否则 CLI 里看不出自己刚填的备注有没有落库。
    render: (d: any) => (d.bindings || [])
      .map((b: any) => {
        const role = b.main ? '主篇' : b.note ? `附加 · ${b.note}` : '附加';
        return `  ${b.repoKey}${b.groupKey ? ' @' + b.groupKey : ''}  ${role}  ${b.locator}`;
      })
      .join('\n') || '（无归属）',
  })
  override async run(ctx: ActionInput<this['_input']>) {
    const refId = ctx.ref ? toRefId(ctx.ref) : '';
    const host = String(ctx.host || '').trim();
    const db = getDb();
    const where: string[] = ['r.deleted_at IS NULL'];
    const params: Record<string, unknown> = {};
    if (refId) { where.push('b.ref_id = :ref'); params.ref = refId; }
    if (host) { where.push('b.repo_key = :host'); params.host = host; }
    const rows = db.all(
      `SELECT b.repo_key AS repoKey, b.group_key AS groupKey, b.type, b.position, b.note,
              r.id AS refId, r.locator
         FROM ref_bindings b JOIN refs r ON r.id = b.ref_id
        WHERE ${where.join(' AND ')}
        ORDER BY b.repo_key, b.position, b.rowid`,
      params
    );
    return {
      bindings: rows.map((r: any) => ({
        refId: String(r.refId),
        locator: String(r.locator),
        repoKey: String(r.repoKey),
        groupKey: r.groupKey == null ? null : String(r.groupKey),
        type: String(r.type),
        position: Number(r.position) || 0,
        main: Number(r.position) === 0,
        note: String(r.note || ''),
      })),
    };
  }
}
