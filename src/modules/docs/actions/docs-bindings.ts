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
import { refTitleOf } from '../brief.js';
import { summaryFromMd } from '../seed.js';
import { reposBridge } from '../repos-bridge.js';

/** 入参 docId（ref:<refId> / 裸 refId）→ ref id；不做任何按路径/ locator 的猜测。 */
function toRefId(v: string): string {
  const s = String(v || '').trim();
  if (!s) return '';
  const id = s.replace(/^ref:/i, '');
  const byId = getDb().get('SELECT id FROM refs WHERE id = :id AND deleted_at IS NULL', { id });
  return byId ? String(byId.id) : '';
}

/**
 * 组域范围（#132）：成员仓库 + **组内参考仓库**。
 *
 * 组视图以前只带「成员仓库自己的 ref」，组里绑着的**参考仓库**（group_refs）
 * 自己的文档整段看不见——参考仓库在底层和开发仓库只有 kind 的差异，文档宿主
 * 也该一视同仁（它一样可以提交文档）。
 *
 * 走 repos 桥动态 import——docs 不静态依赖 repos（eslint 分层），且失败即返回空表：
 * 文档列表少几行是降级，不该让整个查询报错。
 */
async function groupScopeOf(groupKey: string): Promise<{
  memberKeys: string[];
  refKeys: string[];
  kindOf: Map<string, string>;
}> {
  const kindOf = new Map<string, string>();
  try {
    const { loadStore, boardRepoKeys, storedBoardKey, findBoard } = await reposBridge();
    const s = await loadStore();
    // 宿主 kind：开发仓库 dev / 参考仓库 ref / 组 group
    for (const r of s.repos || []) {
      const k = String(r.key || '');
      if (k) kindOf.set(k, String(r.type || 'dev') === 'ref' ? 'ref' : 'dev');
    }
    for (const b of s.boards || []) {
      const k = String(b.key || '');
      if (k) kindOf.set(k, 'group');
    }
    const b =
      findBoard(s, groupKey) ||
      (s.boards || []).find((x: any) => storedBoardKey(x) === groupKey);
    if (!b) return { memberKeys: [], refKeys: [], kindOf };
    const refKeys = ((b.refs || []) as any[]).map((l) => String(l.id || '')).filter(Boolean);
    return { memberKeys: boardRepoKeys(b, s), refKeys, kindOf };
  } catch {
    return { memberKeys: [], refKeys: [], kindOf };
  }
}

/**
 * 宿主仓库的 kind（dev / ref / group）——读 ext.ext_legacy_type。
 * 只在拿不到 store 时兜底用；正常路径走 groupScopeOf 顺带带回来的 kindOf。
 */
function kindFromExt(ext: unknown): string {
  try {
    const v = JSON.parse(String(ext || '{}'));
    return String(v && v.ext_legacy_type) === 'ref' ? 'ref' : 'dev';
  } catch {
    return 'dev';
  }
}

const input = z.object({
  ref: z.string().optional().describe('refId / docId（ref:/path: 或裸 refId）——只看这篇文档的归属'),
  host: z.string().optional().describe('宿主 repo_key —— 只看这个仓库自己的文档（组级 / 组内仓库文档归组视图，不混进来）'),
  group: z.string().optional().describe('宿主组 key —— 看这个组的文档集：组本身 → 组内各仓库的组内文档 → 组内仓库自己的文档（#105）'),
});

export class DocsBindingsAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.bindings',
    cli: ['docs', 'bindings'],
    http: ['GET', '/api/docs/bindings'],
    summary: '查文档归属（--ref <refId> 看这篇被谁引用；--host <repo> 只看仓库自己的文档；--group <组> 看组域文档集：组 → 组内仓库 → 成员仓库自己 → 组内参考仓库自己；hostKind 标宿主是开发仓库/参考仓库/组；position=0 为主篇）',
    input,
    // 备注（只有附加篇有：主篇 push 时不带 note）跟着 main 一起打，和前端 tag 上的
    // 「附加 · 备注」保持同一口径——否则 CLI 里看不出自己刚填的备注有没有落库。
    render: (d: any) => (d.bindings || [])
      .map((b: any) => {
        const role = b.main ? '主篇' : b.note ? `附加 · ${b.note}` : '附加';
        const label = b.desc || b.title || b.refId;
        return `  ${b.type}  ${b.repoKey}${b.groupKey ? ' @' + b.groupKey : ''}  ${role}  ${label}  [${b.refId}]`;
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
    // #116：**repo 级视图只给这个仓库自己的文档**（type=repo）。
    // 组级文档与「组内仓库文档」(group_repo) 属于组域，只在看组的时候才有意义——
    // 以前 host 只按 repo_key 过滤，组内文档会混进仓库的列表里（截图里那条「组 · nx」）。
    if (host) { where.push("b.repo_key = :host AND b.type = 'repo'"); params.host = host; }
    // 组级绑定：repo_key = 组 key、group_key = NULL（type=group）；
    // 组内仓库绑定：group_key = 组 key（type=group_repo）。两种都要算进组文档集。
    //
    // #105：组视图还要带上**组内各仓库自己的 ref**（type=repo）——组员的知识都在这个
    // 组域里，切到组却只看见组级两篇是反直觉的。成员 key 从看板关系取（boardRepoKeys
    // 兼容 repoKeys / 老 repoIds 两种存量结构）。
    let kindOf = new Map<string, string>();
    let refKeys: string[] = [];
    if (group) {
      const scope = await groupScopeOf(group);
      kindOf = scope.kindOf;
      refKeys = scope.refKeys;
      const members = scope.memberKeys;
      const memberMarks = members.map((_, i) => `:m${i}`);
      members.forEach((k, i) => { params[`m${i}`] = k; });
      const refMarks = refKeys.map((_, i) => `:rf${i}`);
      refKeys.forEach((k, i) => { params[`rf${i}`] = k; });
      where.push(
        `(b.group_key = :group OR (b.type = 'group' AND b.repo_key = :group)` +
          (memberMarks.length ? ` OR (b.type = 'repo' AND b.repo_key IN (${memberMarks.join(',')}))` : '') +
          // #132：组内**参考仓库**自己的文档也要进组视图（参考仓库一样能提交文档）
          (refMarks.length ? ` OR (b.type = 'repo' AND b.repo_key IN (${refMarks.join(',')}))` : '') +
          ')'
      );
      params.group = group;
    }
    // 排序（#105）：组视图按「组本身 → 组内仓库 → 仓库自己」的重要度排；
    // 单仓库视图维持原口径（repo → group → group_repo）不动。
    // 组视图排序：组本身 → 组内仓库 → 成员仓库自己 → **组内参考仓库自己**（#132）
    const refInList = refKeys.length
      ? `WHEN b.type = 'repo' AND b.repo_key IN (${refKeys.map((_, i) => `:rf${i}`).join(',')}) THEN 3 `
      : '';
    const orderBy = group
      ? `ORDER BY CASE ${refInList}WHEN b.type = 'group' THEN 0 WHEN b.type = 'group_repo' THEN 1 ELSE 2 END, b.position, b.rowid`
      : "ORDER BY CASE b.type WHEN 'repo' THEN 0 WHEN 'group' THEN 1 ELSE 2 END, b.position, b.rowid";
    // 单仓库视图（--host）也要标宿主 kind：这里没有组上下文，直接读行。
    if (host && !kindOf.size) {
      const row = db.get('SELECT type, ext FROM repos WHERE key = :k', { k: host });
      if (row) {
        kindOf.set(host, String(row.type) === 'group' ? 'group' : kindFromExt(row.ext));
      }
    }

    const rows = db.all(
      `SELECT b.repo_key AS repoKey, b.group_key AS groupKey, b.type, b.position, b.note, b.tag,
              r.id AS refId, r."desc", r.origin, r.locator,
              CASE WHEN rb.ref_id IS NULL THEN 0 ELSE 1 END AS has_body,
              rb.body
         FROM ref_bindings b JOIN refs r ON r.id = b.ref_id
         LEFT JOIN ref_bodies rb ON rb.ref_id = r.id
        WHERE ${where.join(' AND ')}
        ${orderBy}`,
      params
    );
    return {
      bindings: rows.map((r: any) => {
        const refId = String(r.refId);
        const type = String(r.type);
        const position = Number(r.position) || 0;
        const hasBody = Number(r.has_body) === 1;
        const body = hasBody ? String(r.body ?? '') : '';
        const desc = String(r.desc || '');
        return {
          refId,
          desc,
          // 显示名：正文标题 → desc → 正文首行摘要 → 外部文件名 → refId。
          // v8 没有路径名了，没有这条链旧文档会全叫「未命名文档」。
          title: refTitleOf({ body, desc, locator: String(r.locator || ''), origin: String(r.origin || '') }, refId),
          summary: body ? summaryFromMd(body) : '',
          hasBody,
          repoKey: String(r.repoKey),
          groupKey: r.groupKey == null ? null : String(r.groupKey),
          type,
          position,
          main: position === 0,
          note: String(r.note || ''),
          tag: String(r.tag || ''),
          // 宿主 kind（#132）：dev 开发仓库 / ref 参考仓库 / group 组。
          // 参考仓库与开发仓库在底层只有这一个差异，列表上标出来才不会看不懂。
          hostKind: kindOf.get(String(r.repoKey)) || 'dev',
          removeIndex: null,
        };
      }),
    };
  }
}
