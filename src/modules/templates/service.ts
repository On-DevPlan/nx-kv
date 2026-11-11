// 任务模板：MD 工作台「新建页」的起始正文。
//
// 存储是 `templates` 表（T06 起进库；templates.json 已消失，legacy 由
// core/db/import-json 的 importTemplates 迁入 —— values→vars、id 原样）。
// 与本机队列一样是**本机数据**：不进云端、不随工作空间走。
//
// 内置模板（`builtin=1`，由 core/db/seed-templates 在开库时 INSERT OR IGNORE
// seed，永远在场）：**不可删，可编辑**。T06 起骨架也可改 —— 用户改了
// builtin 的 body / 槽位后重启原样保留（seed 是 OR IGNORE，绝不覆盖用户编辑）。
// 内置正文出厂态仍与前端 md-parse 的 NEW_TEMPLATE 保持同构 —— 那是 API
// 不可达时（版本偏差）前端的兜底，两边谁先改都不破坏行为。
//
// ── 与 schema 列的映射 ────────────────────────────────────────────────
//   旧 JSON 字段            → 列
//   values（槽位值对象）     → vars（JSON；**列名换了**，对外视图仍叫 values ——
//                              调用方与测试一行不改；vars_schema 声明「有哪些变量」，
//                              vars 填值，声明里不放默认值）
//   builtin                 → builtin 列
//   defaultId               → 同类目 `is_default=1` 的那行（ux_templates_default
//                              保证每类目最多一个默认；**没有**另落 settings 键 ——
//                              任务书原定 `tpl.defaultId`，实际用 is_default 列：
//                              它就是为这个语义建的列，且部分索引免费给「每类目
//                              唯一」的约束，settings 键反而多出一个无约束的真相源）
//   —                       → category 固定 'newtask'（本文件只管新建页骨架；
//                              delivery/enhance/context 三个 tab 的内置模板由
//                              seed 提供，编辑走同一张表）
//   —                       → scope（v3，#128）：可见域 JSON 数组，缺省 ["*"]；
//                              origin_topic 记创建主题。判定规则在 scope.js（纯函数）
import crypto from 'node:crypto';
import fsp from 'node:fs/promises'; // 仅用于读用户 --body-file（存储已进库）
import { readFileSync } from 'node:fs';
import { badInput, notFound } from '../../core/errors.js';
import { nowMs } from '../../core/db/time.js';
import { NEWTASK_BODY, NEWTASK_VARS } from '../../core/db/seed-templates.js';
import { normalizeScope, topicCtx, canUse, canEdit } from './scope.js';
import repoLayer from './repo/index.js';

/** 模板的对外视图（旧 store 形状：values/builtin 这些旧字段）。 */
export interface TemplateView {
  id: string;
  name: string;
  body: string;
  values: Record<string, string>;
  builtin: boolean;
  scope: string[];
  originTopic: string;
  category?: string;
  enabled?: boolean;
  perm?: { use: boolean; edit: boolean };
}

/** 列表视图（可带 scoped 与三把钥匙的回显）。 */
export interface TemplateListResult {
  defaultId: string;
  templates: TemplateView[];
  scoped?: boolean;
  topic?: string;
  group?: string;
  repo?: string;
}

export const BUILTIN_ID = 'default';
const NEWTASK_CATEGORY = 'newtask';

const repo = repoLayer;

export const BUILTIN_BODY = NEWTASK_BODY;
export const BUILTIN_VALUES = { ...NEWTASK_VARS };

// ─── 视图：行 ⇄ 旧 JSON 形状（调用方消费的是 values/builtin 这些旧字段）──

/** 行 → 旧 store 形状的模板对象（vars 列对外仍叫 values，契约不变）。 */
function rowToView(row: any): TemplateView {
  const vars = safeParse(row.vars, {});
  const out: TemplateView = {
    id: String(row.id),
    name: String(row.name || ''),
    body: String(row.body || ''),
    values: vars,
    builtin: !!row.builtin,
    // 可见域（v3，#128）：scope 数组 + 创建来源主题。全为 '*' / '' 时消费方
    // 可以当它不存在（与 v2 行为一致），带值的才需要展示/判定。
    scope: normalizeScope(row.scope),
    originTopic: String(row.origin_topic || ''),
  };
  if (row.category && row.category !== NEWTASK_CATEGORY) out.category = String(row.category);
  if (row.enabled === 0) out.enabled = false;
  return out;
}

function safeParse(text: unknown, fallback: any): any {
  try {
    const v = JSON.parse(String(text ?? ''));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function defaultIdOf(conn: any): string {
  const row = repo.templates.getDefaultRow(NEWTASK_CATEGORY, conn);
  return row ? String(row.id) : BUILTIN_ID;
}

/** 列表视图：templates + defaultId（面板「新建页」按 defaultId 取起始正文） */
export async function listTemplates(): Promise<{ defaultId: string; templates: TemplateView[] }> {
  return repo.txw((conn) => {
    const defaultId = defaultIdOf(conn);
    const templates = repo.templates
      .listRows(conn)
      .filter((r) => r.category === NEWTASK_CATEGORY)
      .map(rowToView);
    return { defaultId, templates };
  });
}

/**
 * 按可见上下文列可用模板（v3，#128 / #132）：
 * GET /api/templates?topic=&group=&repo=
 *
 * 三把钥匙平级（#132）：topic / repo / group 与 `*` 都是 scope 绑定条目，
 * 不是「全局 vs 定向」。组页可只传 group（项目组本身就是一个可见主体）。
 *
 * 返回 `scoped: true` 让前端识别「服务端确实按域过滤了」——旧 serve 不认识
 * 这些参数时无 scoped 字段，前端退化回全量菜单。
 */
export async function listTemplatesForTopic({
  topic: rawTopic,
  group: rawGroup,
  repo: rawRepo,
}: { topic?: unknown; group?: unknown; repo?: unknown } = {}): Promise<TemplateListResult> {
  const key = String(rawTopic || '').trim();
  const groupKey = String(rawGroup || '').trim();
  const repoKey = String(rawRepo || '').trim();
  if (!key && !groupKey && !repoKey) return { ...(await listTemplates()), scoped: false };
  return repo.txw((conn) => {
    const row = key ? repo.templates.getTopicKeys(key, conn) : null;
    const ctx = topicCtx({
      key: (row && row.key) || key,
      // 显式 query 优先：组页会带 group/repo，即使成员队列行上 group_key 为空
      repoKey: repoKey || (row && row.repo_key) || '',
      groupKey: groupKey || (row && row.group_key) || '',
    });
    const defaultId = defaultIdOf(conn);
    const templates = repo.templates
      .listRows(conn)
      .filter((r) => r.category === NEWTASK_CATEGORY)
      .map((r) => {
        const v = rowToView(r);
        v.perm = { use: canUse(v, ctx), edit: canEdit(v, ctx) };
        return v;
      })
      .filter((v) => v.perm!.use);
    return {
      defaultId,
      templates,
      scoped: true,
      topic: key || undefined,
      group: groupKey || undefined,
      repo: repoKey || undefined,
    };
  });
}

function normalizeName(raw: unknown): string {
  const name = String(raw || '').trim();
  if (!name) throw badInput('需要模板名 <name>');
  return name.slice(0, 60);
}

function normalizeBody(raw: unknown): string {
  const body = String(raw ?? '');
  return body.trim() ? body : BUILTIN_BODY; // 空正文 → 给内置骨架，别存一个空页
}

/**
 * 归一化模板的槽位值（values）：{ 槽位名: 文字 }。
 * 只留字符串值、逐条截断（单槽 ≤2000 字）、槽位名限长 40——槽位名要出现在
 * 正文里当 {{名字}}，名字太长就没法当占位符用了。
 */
export function normalizeValues(raw: unknown, base: any = {}): Record<string, string> {
  const out: Record<string, string> = { ...base };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || '').trim().slice(0, 40);
    if (!key) continue;
    let s = String(v ?? '');
    if (s.length > 2000) s = s.slice(0, 2000);
    out[key] = s;
  }
  return out;
}

/**
 * 解析模板正文来源：--body 给字面量；--body-file 给文件路径；`-` 表示读标准输入。
 * 优先级：body > bodyFile（body 给了就不读文件）。
 *
 * 为什么需要文件/管道：模板正文是多行 Markdown——在 cmd.exe 里往参数里塞换行极难，
 * 「编辑器里写好 → `template add 名称 --body-file 模板.md`」才是能用的姿势。
 * 只给 CLI 用（HTTP 不暴露读文件，见 action 的 transport 分流）。
 */
async function resolveBody({ body, bodyFile }: { body?: unknown; bodyFile?: unknown } = {}): Promise<string | undefined> {
  const lit = body == null ? '' : String(body);
  const p = bodyFile == null ? '' : String(bodyFile).trim();
  // `-` 是「读标准输入」的哨兵（--body - 与 --body-file - 都认）
  if (lit === '-' || (!lit && p === '-')) {
    try {
      return readFileSync(0, 'utf8');
    } catch (e) {
      throw badInput('读标准输入失败: ' + String((e as Error).message || e));
    }
  }
  if (lit !== '') return lit;
  if (!p) return undefined;
  try {
    return await fsp.readFile(p, 'utf8');
  } catch (e) {
    throw badInput(`读模板文件失败: ${p}（${(e as NodeJS.ErrnoException).code || (e as Error).message}）`);
  }
}

/**
 * 新增模板（--set-default 同时设为默认）。幂等性不做：同名允许存在，靠 id 区分。
 *
 * 可见域（v3，#128 / #131）：显式 scope 优先；否则带创建主题 topic 时默认只在
 * 该主题可见（scope=[topic:<key>]，origin_topic 记锚）；都没有 = 空数组（未配置），
 * **不再默认全局**——全局必须显式 `--scope *` / UI 勾选。内置模板仍是 `["*"]`。
 */
export async function addTemplate({
  name: rawName,
  body: rawBody,
  bodyFile,
  values,
  setDefault = false,
  scope: rawScope,
  topic: rawTopic,
}: {
  name?: unknown;
  body?: unknown;
  bodyFile?: unknown;
  values?: unknown;
  setDefault?: boolean;
  scope?: unknown;
  topic?: unknown;
} = {}): Promise<{ status: string; template: TemplateView; defaultId: string }> {
  const name = normalizeName(rawName);
  const body = normalizeBody(await resolveBody({ body: rawBody, bodyFile }));
  const topicKey = String(rawTopic || '').trim();
  const scope: string[] = rawScope !== undefined
    ? normalizeScope(rawScope, { strict: true })
    : topicKey
      ? [`topic:${topicKey}`]
      : [];
  const at = nowMs();
  return repo.txw((conn) => {
    const t = {
      id: 't_' + crypto.randomBytes(5).toString('hex'),
      name,
      body,
      // 槽位值：正文里 {{名字}} 处填的文字；未给的槽位按正文里的原样渲染
      values: normalizeValues(values),
    };
    repo.templates.insertIfAbsent(conn, {
      id: t.id,
      category: NEWTASK_CATEGORY,
      name: t.name,
      body: t.body,
      varsSchema: [],
      vars: t.values,
      isDefault: 0,
      sortOrder: repo.templates.nextSortOrder(conn, NEWTASK_CATEGORY),
      builtin: 0,
      scope,
      // 创建来源是事实，不随 scope 策略走：显式给了 topic 才记
      originTopic: topicKey,
      createdAtMs: at,
      updatedAtMs: at,
    });
    const defaultId = setDefault
      ? t.id
      : String((repo.templates.getDefaultRow(NEWTASK_CATEGORY, conn) || {}).id || BUILTIN_ID);
    if (setDefault) repo.templates.setDefault(conn, NEWTASK_CATEGORY, t.id, at);
    return {
      status: 'ok',
      template: rowToView(repo.templates.getRow(t.id, conn)),
      defaultId,
    };
  });
}

/** 删除模板。内置模板不可删（它是「删光后」的兜底）；删默认则默认回落到内置。 */
export async function removeTemplate({ id }: { id?: unknown } = {}): Promise<{
  status: string;
  removed: TemplateView;
  wasDefault: boolean;
  defaultId: string;
}> {
  const want = String(id || '').trim();
  if (!want) throw badInput('需要模板 id');
  if (want === BUILTIN_ID) throw badInput('内置默认模板不可删除（可新增自己的模板并设为默认）');
  return repo.txw((conn) => {
    const row = repo.templates.getRow(want, conn);
    if (!row) throw notFound(`没有 id 为 ${want} 的模板（template list 可查）`);
    const removed = rowToView(row);
    const wasDefault = Number(row.is_default) === 1;
    repo.templates.deleteRow(conn, want);
    // 删掉的是默认 → 默认回落到内置（把 is_default 也点亮回去，保持
    // 「每类目恰一个默认」的不变量；与 JSON 时代同一行为）
    if (wasDefault) repo.templates.setDefault(conn, NEWTASK_CATEGORY, BUILTIN_ID, nowMs());
    const defaultId = wasDefault
      ? BUILTIN_ID
      : String((repo.templates.getDefaultRow(NEWTASK_CATEGORY, conn) || {}).id || BUILTIN_ID);
    return { status: 'ok', removed, wasDefault, defaultId };
  });
}

/** 编辑模板（改名 / 改正文 / 改槽位 / 改可见域；只改传入的字段）。 */
export async function updateTemplate({ id, name: rawName, body: rawBody, bodyFile, values, scope: rawScope }: {
  id?: unknown;
  name?: unknown;
  body?: unknown;
  bodyFile?: unknown;
  values?: unknown;
  scope?: unknown;
} = {}): Promise<{ status: string; template: TemplateView }> {
  const want = String(id || '').trim();
  if (!want) throw badInput('需要模板 id');
  const bodyIn = rawBody !== undefined || bodyFile ? await resolveBody({ body: rawBody, bodyFile }) : undefined;
  return repo.txw((conn) => {
    const row = repo.templates.getRow(want, conn);
    if (!row) throw notFound(`没有 id 为 ${want} 的模板（template list 可查）`);
    const patch: any = {};
    if (rawName !== undefined) patch.name = normalizeName(rawName);
    if (bodyIn !== undefined) patch.body = normalizeBody(bodyIn);
    if (rawScope !== undefined) patch.scope = normalizeScope(rawScope, { strict: true });
    if (values !== undefined) {
      // 内置模板：槽位未给的项回落出厂默认（渲染时的兜底语义与 JSON 时代一致）
      patch.vars = normalizeValues(values, row.builtin ? BUILTIN_VALUES : rowToView(row).values);
    }
    repo.templates.updateRow(conn, want, patch, nowMs());
    return { status: 'ok', template: rowToView(repo.templates.getRow(want, conn)) };
  });
}

/** 设默认模板：新建页的起始正文换成它。 */
export async function setDefaultTemplate({ id }: { id?: unknown } = {}): Promise<{
  status: string;
  defaultId: string;
  template: TemplateView;
}> {
  const want = String(id || '').trim();
  if (!want) throw badInput('需要模板 id');
  return repo.txw((conn) => {
    const row = repo.templates.getRow(want, conn);
    if (!row) throw notFound(`没有 id 为 ${want} 的模板（template list 可查）`);
    repo.templates.setDefault(conn, NEWTASK_CATEGORY, want, nowMs());
    return { status: 'ok', defaultId: want, template: rowToView(repo.templates.getRow(want, conn)) };
  });
}
