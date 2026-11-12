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
import { docTitleFromMd } from '../../../shared/doc-title.js';

/** 入参 docId（ref:/rel:/path: 或无前缀 locator）→ ref id。 */
function toRefId(v: string): string {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^ref_[0-9a-f]{16}$/i.test(s)) return s;
  if (s.startsWith('ref:')) return s.slice(4);
  const locator = s.startsWith('rel:') ? s.slice(4) : s.startsWith('path:') ? s.slice(5) : s;
  if (/^ref_[0-9a-f]{16}$/i.test(locator)) return locator;
  return refIdOf(locator.replace(/\\/g, '/'));
}

const input = z.object({
  ref: z.string().optional().describe('refId / docId（ref:/rel:/path: 或裸 locator）——只看这篇文档的归属'),
  host: z.string().optional().describe('宿主 repo_key —— 只看这个仓库的文档集（含它的组内文档）'),
  group: z.string().optional().describe('宿主组 key —— 只看这个组的文档集（含组内各仓库）'),
});

export class DocsBindingsAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.bindings',
    cli: ['docs', 'bindings'],
    http: ['GET', '/api/docs/bindings'],
    summary: '查文档归属（--ref <refId> 看这篇被谁引用；--host <repo> / --group <组> 看宿主文档集；position=0 为主篇）',
    input,
    // 备注（只有附加篇有：主篇 push 时不带 note）跟着 main 一起打，和前端 tag 上的
    // 「附加 · 备注」保持同一口径——否则 CLI 里看不出自己刚填的备注有没有落库。
    render: (d: any) => (d.bindings || [])
      .map((b: any) => {
        const role = b.main ? '主篇' : b.note ? `附加 · ${b.note}` : '附加';
        const label = b.desc || b.title || b.refId;
        return `  ${b.type}  ${b.repoKey}${b.groupKey ? ' @' + b.groupKey : ''}  ${role}  ${label}  [${b.refId}]${b.hasBody ? '' : '（无正文）'}`;
      })
      .join('\n') || '（无归属）',
  })
  override async run(ctx: ActionInput<this['_input']>) {
    const refId = ctx.ref ? toRefId(ctx.ref) : '';
    const host = String(ctx.host || '').trim();
    const group = String(ctx.group || '').trim();
    const db = getDb();
    const where: string[] = ['r.deleted_at IS NULL'];
    const params: Record<string, unknown> = {};
    if (refId) { where.push('b.ref_id = :ref'); params.ref = refId; }
    if (host) { where.push('b.repo_key = :host'); params.host = host; }
    // 组级绑定：repo_key = 组 key、group_key = NULL（type=group）；
    // 组内仓库绑定：group_key = 组 key（type=group_repo）。两种都要算进组文档集。
    if (group) {
      where.push("(b.group_key = :group OR (b.type = 'group' AND b.repo_key = :group))");
      params.group = group;
    }
    const rows = db.all(
      `SELECT b.repo_key AS repoKey, b.group_key AS groupKey, b.type, b.position, b.note,
              r.id AS refId, r.rel, r."desc", r.origin, r.locator,
              CASE WHEN rb.ref_id IS NULL THEN 0 ELSE 1 END AS has_body,
              rb.body
         FROM ref_bindings b JOIN refs r ON r.id = b.ref_id
         LEFT JOIN ref_bodies rb ON rb.ref_id = r.id
        WHERE ${where.join(' AND ')}
        ORDER BY CASE b.type WHEN 'repo' THEN 0 WHEN 'group' THEN 1 ELSE 2 END,
                 b.position, b.rowid`,
      params
    );
    return {
      bindings: rows.map((r: any) => {
        const refId = String(r.refId);
        const type = String(r.type);
        const position = Number(r.position) || 0;
        const direct = String(r.rel) === refId;
        // 摘除序号只对派生行有意义（直接行走 unbind）；主篇的摘除语义见宿主侧。
        const removeIndex = direct || position === 0
          ? null
          : type === 'repo'
            ? position + 1
            : type === 'group'
              ? position
              : null;
        const body = Number(r.has_body) === 1 ? String(r.body ?? '') : '';
        return {
          refId,
          desc: String(r.desc || ''),
          title: body ? docTitleFromMd(body) : '',
          hasBody: Number(r.has_body) === 1,
          repoKey: String(r.repoKey),
          groupKey: r.groupKey == null ? null : String(r.groupKey),
          type,
          position,
          main: position === 0,
          note: String(r.note || ''),
          direct,
          removeIndex,
        };
      }),
    };
  }
}
