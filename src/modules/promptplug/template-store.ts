// 段模板的用户数据（#161 / #238）：每段可有多条模板，启用哪条自己挑。
//
// 真相仍是插件类里的 `templates`（出厂内置，代码即真相）；这里只存**用户层**：
//   - items：用户添加/复制的模板条目（builtin 永远在插件类里，不落盘）
//   - activeId：该段当前启用的模板（'builtin' 或用户条目 id）
//
// 落点（#238 起）：settings 表，**一段一个键** `prompt.tpl.<segment>`，值是
// `{ activeId, items[] }` 的 JSON。为什么按段拆而不是整份 Store 一个键：
//   - 写一段只碰一个键。整份键的「读全量 → 改一段 → 写全量」在并发下是典型
//     lost update：A 改 ack、B 改 timecheck，后提交的把前一个抹掉。
//   - 读也小：装配时 `activeTemplateTextOf(id)` 每轮会被调十几次，按段取只解析
//     这一小段，不再解析全量。
//
// 为什么不再细到「一条模板一个键」：settings 的硬规则（schema G2）是「凡需要
// 出现在 WHERE 里的东西不许进 settings」，前缀列举只给整表导出/清理用。按条目
// 拆键后「列某段的条目」只能靠前缀扫，等于把 k/v 当表查；且 activeId 与条目会
// 散在多键，删除/启用要跨键维护一致。**段**正好是「按键精确取值」的粒度。
//
// 迁移（两条来源，都只跑一次，按库路径记账）：
//   1. `prompt.tplStore`（本方案第一版写的整份键）→ 拆成按段键后删掉旧键；
//   2. `~/.nx-kv/promptplug-templates.json`（#238 之前的裸文件）→ 写成按段键，
//      文件改名 `.migrated`（不删，留档）。
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR } from '../../core/paths.js';
import { dbPath, openStore } from '../../core/db/index.js';
import { deleteSettingRaw, readSettingRaw, writeSettingRaw } from '../../core/db/settings.js';
import { tx } from '../../core/db/tx.js';
import type { DbApi } from '../../core/db/driver.js';
import { allPluginIds, pluginMeta } from './registry.js';
import type { TemplateText } from './base.js';

/** 按段键的前缀（导出/清理可据此列举；读取只用精确键）。 */
export const SEGMENT_KEY_PREFIX = 'prompt.tpl.';

/** 某段在 settings 里的键。 */
export function segmentKey(segment: string): string {
  return `${SEGMENT_KEY_PREFIX}${segment}`;
}

/** 第一版方案用的「整份 Store」键；只作迁移源，不再写入。 */
export const WHOLE_STORE_KEY = 'prompt.tplStore';

/** #238 之前的老落点；只作迁移源，不再写入。 */
const LEGACY_FILE = join(APP_DIR, 'promptplug-templates.json');

export interface UserTemplate extends TemplateText {
  /** 创建时间（epoch ms；排序/展示用） */
  createdAt: number;
}

/** 某一段的用户层模板数据。 */
export interface SegmentTemplates {
  /** 当前启用的模板 id（'builtin' = 出厂第一条；缺省 = builtin） */
  activeId: string;
  /** 用户条目（出厂 builtin 不在内） */
  items: UserTemplate[];
}

const DEFAULT_SEGMENT: SegmentTemplates = { activeId: 'builtin', items: [] };

type Store = Record<string, SegmentTemplates>;

function emptySegment(): SegmentTemplates {
  return { ...DEFAULT_SEGMENT, items: [] };
}

function cloneSegment(seg: SegmentTemplates): SegmentTemplates {
  return { ...seg, items: [...seg.items] };
}

/**
 * #183 旧模板变量迁移：`40cb35d` 删掉了 context 段的 group.note / group.position /
 * peers[].note / hasNote 字段与内置模板引用，但**没升级已落库的用户模板**——
 * `6ac1074` 起每段模板只允许引用自己的 dataSchema，旧模板一被装配就在
 * `assertPluginList` 抛「context: 模板引用了本段没有的变量 group.note」，
 * 整条提示词链（预览 / 领取 / 设置页）随之不可用。
 *
 * 读时惰性升级：把废弃引用换成合法字段（组一句话描述），成员行里的裸 note
 * 引用直接去掉；返回 changed 供调用方一次性回写，之后不再重复处理。
 */
const LEGACY_VAR_FIXES: readonly [RegExp, string][] = [
  [/\bgroup\.position\b/g, 'group.introDesc'],  // = note 的旧别名
  [/\bgroup\.note\b/g, 'group.introDesc'],
  [/\{\{\s*(?:this\.)?hasNote\s*\}\}/g, ''],
  [/\{\{\s*(?:this\.)?note\s*\}\}/g, ''],
];

export function migrateLegacyTemplateVars(text: string): { text: string; changed: boolean } {
  const src = String(text ?? '');
  let out = src;
  for (const [re, to] of LEGACY_VAR_FIXES) out = out.replace(re, to);
  // 去掉只剩空白 / 分隔符的残行（成员行去掉 note 后常见的「 - 」「 | 」）
  out = out.replace(/^\s*[-|·,、]\s*$/gm, '');
  return { text: out, changed: out !== src };
}

/** 外部数据边界：单段逐项校验 + 旧变量迁移（脏条目丢掉，缺 activeId 按 builtin）。 */
function normalizeSegment(raw: unknown): { seg: SegmentTemplates; changed: boolean } {
  const seg = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const items = Array.isArray(seg.items)
    ? (seg.items
        .filter((t: any) => t && typeof t.text === 'string' && typeof t.id === 'string' && t.id !== 'builtin')
        .map((t: any) => {
          const m = migrateLegacyTemplateVars(t.text);
          return m.changed ? { ...t, text: m.text } : t;
        }) as UserTemplate[])
    : [];
  const changed = Array.isArray(seg.items) && items.some((t, i) => t.text !== seg.items[i]?.text);
  return {
    seg: { activeId: typeof seg.activeId === 'string' ? seg.activeId : 'builtin', items },
    changed,
  };
}

/** 整份 Store（迁移源用）：逐段走同一套校验。 */
function normalizeStore(raw: unknown): Store {
  if (!raw || typeof raw !== 'object') return {};
  const out: Store = {};
  for (const [id, seg] of Object.entries(raw as Record<string, any>)) {
    if (!seg || typeof seg !== 'object') continue;
    out[id] = normalizeSegment(seg).seg;
  }
  return out;
}

/** 写一段（单事务、IMMEDIATE —— 与 core/config.ts 的偏好写入同款）。 */
function writeSegment(segment: string, seg: SegmentTemplates, conn?: DbApi): void {
  const write = (c: DbApi) => writeSettingRaw(c, segmentKey(segment), seg);
  if (conn) {
    write(conn);
    return;
  }
  tx((c) => write(c), { db: openStore(), mode: 'IMMEDIATE' });
}

// 迁移做过一次的库路径（env 换库时要重跑；迁移本身幂等）。
let migratedFor: string | null = null;

/** 把一个整份 Store 摊成按段键（同事务删旧键）。返回是否真处理过。 */
function splitWholeStoreKey(db: DbApi): boolean {
  const old = readSettingRaw(db, WHOLE_STORE_KEY);
  if (old === undefined) return false;
  const store = normalizeStore(old);
  const entries = Object.entries(store);
  tx(
    (conn) => {
      for (const [seg, data] of entries) writeSegment(seg, data, conn);
      deleteSettingRaw(conn, WHOLE_STORE_KEY);
    },
    { db, mode: 'IMMEDIATE' },
  );
  return true;
}

/** legacy JSON → 按段键，成功后改名 `.migrated`。 */
function importLegacyFile(db: DbApi): void {
  if (!existsSync(LEGACY_FILE)) return;
  let store: Store;
  try {
    store = normalizeStore(JSON.parse(readFileSync(LEGACY_FILE, 'utf8')));
  } catch {
    return; // 老文件坏了：不迁移，等人工处理
  }
  const entries = Object.entries(store);
  tx(
    (conn) => {
      for (const [seg, data] of entries) writeSegment(seg, data, conn);
    },
    { db, mode: 'IMMEDIATE' },
  );
  try {
    renameSync(LEGACY_FILE, `${LEGACY_FILE}.migrated`);
  } catch {
    // 改名失败不影响正确性：数据已在库，下次读到非空键就不会再导
  }
}

/** 首次读写某段之前跑一次迁移（按库路径记账，失败不记账）。 */
function ensureMigrated(db: DbApi): void {
  const path = dbPath();
  if (migratedFor === path) return;
  // 整份键比裸文件新：先摊它；摊到了就不再碰裸文件（避免用旧数据盖掉新数据）。
  if (!splitWholeStoreKey(db)) importLegacyFile(db);
  migratedFor = path;
}

/** 读一段的原始数据（undefined = 这个段从来没被写过）。 */
function readSegmentRaw(segment: string): SegmentTemplates | undefined {
  const db = openStore();
  ensureMigrated(db);
  const raw = readSettingRaw(db, segmentKey(segment));
  if (raw === undefined) return undefined;
  const { seg, changed } = normalizeSegment(raw);
  if (changed) {
    // 惰性迁移：旧数据升级只写一次，之后每次读到的都是合法模板
    try { writeSegment(segment, seg); } catch { /* 写失败不阻断读取，内存里已是升级后的版本 */ }
  }
  return seg;
}

/**
 * 读一段。**每次现读，不缓存**（设置页改完，下一次装配立即生效）。
 * 读失败（库打不开 / 值损坏）回落默认段 —— 装配永远拿得到可用数据。
 */
function readSegment(segment: string): SegmentTemplates {
  try {
    const seg = readSegmentRaw(segment);
    return seg ? cloneSegment(seg) : emptySegment();
  } catch {
    return emptySegment();
  }
}

/** 某段的用户层模板数据（无记录 → 默认：启用 builtin、无条目）。 */
export function segmentTemplatesOf(id: string): SegmentTemplates {
  return readSegment(id);
}

/** 全部段的用户层模板数据（设置页一次拉全；只列注册表里的段，不扫前缀）。 */
export function allSegmentTemplates(): Record<string, SegmentTemplates> {
  const out: Record<string, SegmentTemplates> = {};
  try {
    for (const id of allPluginIds()) {
      const seg = readSegmentRaw(id);
      if (seg) out[id] = seg;
    }
  } catch {
    return out;
  }
  return out;
}

export interface UpsertTemplateInput {
  /** 段（插件 id） */
  segment: string;
  /** 条目 id；缺 = 新建 */
  id?: string;
  name?: string;
  text: string;
}

/** 添加 / 更新一条用户模板；返回该段最新数据。 */
export function upsertTemplate({ segment, id, name, text }: UpsertTemplateInput): SegmentTemplates {
  const seg = readSegment(segment);
  const body = String(text ?? '');
  const title = String(name ?? '').trim() || '未命名模板';
  const now = Date.now();
  const key = id && !String(id).startsWith('u_') && id !== 'builtin' ? `u_${id}` : String(id ?? '');
  const hit = key ? seg.items.find((t) => t.id === key) : undefined;
  if (hit) {
    hit.name = title;
    hit.text = body;
    if (seg.activeId === hit.id) seg.activeId = hit.id; // 编辑启用中的模板即时生效
  } else {
    const nid = `u_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    seg.items.push({ id: nid, name: title, text: body, createdAt: now });
    seg.activeId = nid; // 新建即启用（复制后修改的直感）
  }
  writeSegment(segment, seg);
  return cloneSegment(seg);
}

/** 删除一条用户模板；删的是启用条目时回落 builtin。 */
export function deleteTemplate(segment: string, id: string): SegmentTemplates {
  const seg = readSegmentRaw(segment);
  if (!seg) return emptySegment(); // 从没写过这个段：不为了「删空」去建键
  seg.items = seg.items.filter((t) => t.id !== id);
  if (seg.activeId === id) seg.activeId = 'builtin';
  writeSegment(segment, seg);
  return cloneSegment(seg);
}

/** 切换某段启用的模板（'builtin' 或用户条目 id；非法 id 静默回落 builtin）。 */
export function activateTemplate(segment: string, id: string): SegmentTemplates {
  const seg = readSegment(segment);
  const key = String(id ?? '') || 'builtin';
  seg.activeId = key === 'builtin' || seg.items.some((t) => t.id === key) ? key : 'builtin';
  writeSegment(segment, seg);
  return cloneSegment(seg);
}

/** 内置（出厂）模板正文：代码即真相，随发布实时更新。 */
export function builtinTemplateTextOf(id: string): string {
  const p = pluginMeta(id);
  const first = p?.templates?.[0];
  return first ? String(first.text ?? '') : '';
}

/** 两份模板是否「实质相同」（忽略空白差异）。 */
function sameTemplate(a: string, b: string): boolean {
  const norm = (x: string): string => String(x || '').replace(/\s+/g, ' ').trim();
  return !!norm(a) && norm(a) === norm(b);
}

/**
 * 某段当前**启用模板的正文**（装配时传给插件构造；builtin → '' 用类内默认）。
 *
 * #185：**内置模板随代码发布更新**——用户若只是把内置「复制为新模板」却没改过，
 * 副本文本与新版内置实质相同 → 这里返回 '' 直接跟随内置，不会卡在旧版本上。
 * 只有真正自定义过的副本才用 `hit.text`。
 */
export function activeTemplateTextOf(id: string): string {
  const seg = readSegment(id);
  if (seg.activeId === 'builtin') return '';
  const hit = seg.items.find((t) => t.id === seg.activeId);
  if (!hit) return '';
  const text = String(hit.text ?? '');
  if (sameTemplate(text, builtinTemplateTextOf(id))) return '';
  return text;
}
