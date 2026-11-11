// 本机设置仓储：settings 表的 lt.* 键（超时 / 追加模式 / 每区块模板列表）。
//
// 为什么走 k/v 而不是宽表：这些键会持续增加，加键零迁移（schema G2 的取舍）。
// value 一律 JSON 文本（'240' / '["a","b"]' / '"…"'），读写都在这里序列化。
// 凭据（token/baseUrl/email/userId/groupId）**绝不进这张表** —— 它们留在 config.json。
//
// 提示词模型（v5，见 shared/prompt-blocks.js）：
//   - `lt.blockTemplates` 是唯一权威来源：`{ [blockId]: { active, list } }`，
//     每个区块各自一份模板列表、各自指定生效项；内置条目 `builtin` 常驻不可删。
//   - 全局只有 `lt.appendMode`（xml / plain）对所有区块整体生效。
//   - 旧键 `lt.promptTemplates / lt.activePromptTemplate / lt.xmlBlocks /
//     lt.deliveryTemplate / lt.attachTemplate / lt.taskSuffix / lt.ackPrompt`
//     只作**一次性迁移来源**：读取时若还没有 `lt.blockTemplates`，把它们折算进
//     各区块的列表；之后不再读写这些旧键。
//   - 旧语法模板（`{{#repo}}…{{/repo}}` 等）迁移时会被校验拒绝（不进入新列表），
//     旧模板不保证可用——这是「不再维护新旧两套语法」的明确取舍。
import { db, txw } from './open.js';
import { nowMs } from '../../../core/db/time.js';
import { badInput } from '../../../core/errors.js';
import { validateTemplate } from '../../../core/instruction-template.js';
import {
  DEFAULT_TIMEOUT_SEC,
  MAX_TIMEOUT_SEC,
  clampTimeoutSec,
} from '../store-io.js';
import {
  clampAckPromptList,
  clampDeliveryTemplate,
  clampAttachTemplate,
  clampAppendMode,
} from '../task-templates.js';
import {
  BLOCK_DEFS,
  BUILTIN_TEMPLATE_ID,
  BUILTIN_TEMPLATE_NAME,
  DEFAULT_ACK_PROMPT,
  MAX_BLOCK_TEMPLATE_LEN,
  defaultBlockTemplateLists,
  normalizeBlockTemplateLists,
  resolveBlockTemplates,
} from '../../../shared/prompt-blocks.js';
import type { BlockTemplateList } from '../../../shared/prompt-blocks.js';
import type { DbApi } from '../../../core/db/driver.js';

/** 归一化后的「每区块模板列表」集合（normalize/defaultBlockTemplateLists 恒产出全部 BLOCK_DEFS 区块）。 */
type BlockLists = Record<string, BlockTemplateList>;

const KEYS = {
  timeoutSec: 'lt.timeoutSec',
  appendMode: 'lt.appendMode',
  blockTemplates: 'lt.blockTemplates',
  // 以下旧键只用于读取迁移，不再写回
  taskSuffix: 'lt.taskSuffix',
  ackPrompt: 'lt.ackPrompt',
  deliveryTemplate: 'lt.deliveryTemplate',
  attachTemplate: 'lt.attachTemplate',
  xmlBlocks: 'lt.xmlBlocks',
  promptTemplates: 'lt.promptTemplates',
  activePromptTemplate: 'lt.activePromptTemplate',
};

/** 旧迁移 / 命令行便捷写入使用的固定条目 id（不影响用户自己新建的模板）。 */
const LEGACY_ENTRY_ID = 'legacy';
const CLI_ENTRY_ID = 'cli';
/** 旧 rule 并入 ack 后的固定条目 id。 */
const RULE_LEGACY_ENTRY_ID = 'legacy-rule';

function readSetting(conn: DbApi, key: string): any {
  const row = conn.get('SELECT value FROM settings WHERE key = :k', { k: key });
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

function writeSetting(conn: DbApi, key: string, value: unknown): void {
  conn.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (:k, :v, :at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { k: key, v: JSON.stringify(value === undefined ? null : value), at: nowMs() }
  );
}

/** 多条旧设置按空行拼成一条模板（迁移用）。 */
function joinEntries(list?: string[]): string {
  return (list || []).join('\n\n');
}

/** 一条模板 → 旧版「多条」视图（按空行拆分；供旧 CLI/面板字段兼容）。 */
function splitEntries(template: unknown): string[] {
  const s = String(template ?? '').trim();
  return s ? s.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean) : [];
}

function clampTemplate(v: unknown): string {
  const s = String(v ?? '').trim();
  return s.length > MAX_BLOCK_TEMPLATE_LEN ? s.slice(0, MAX_BLOCK_TEMPLATE_LEN) : s;
}

/** 迁移只接受「新语法」模板：旧语法/语法错误的旧模板不进入新列表（旧模板不保证可用）。 */
function migratableTemplate(v: unknown): string {
  const t = clampTemplate(v);
  if (!t) return '';
  return validateTemplate(t).ok ? t : '';
}

/**
 * 把旧模板写进某区块的列表（只有内容有效且不同于内置模板时才建条目）。
 * @param {object} lists 归一化后的 lists（就地修改）
 */
function applyMigration(lists: BlockLists, blockId: string, template: unknown, name: string = '迁移模板'): void {
  const def = BLOCK_DEFS.find((d) => d.id === blockId);
  const t = migratableTemplate(template);
  if (!def || !t || t === def.defaultTemplate) return;
  const builtin = lists[blockId]!.list.find((x) => x.id === BUILTIN_TEMPLATE_ID)!;
  lists[blockId] = {
    active: LEGACY_ENTRY_ID,
    list: [builtin, { id: LEGACY_ENTRY_ID, name, template: t, builtin: false }],
  };
}

/**
 * 把旧 rule 区块的模板内容并入 ack：done 指令与收尾要求只保留 ack 一个出口。
 * 合并后的条目设为生效；原 ack 生效模板作为基底一起保留——内容不静默丢。
 */
function mergeRuleIntoAck(lists: BlockLists, template: unknown, name: string = '迁移：原 rule（已并入 ack）'): void {
  const def = BLOCK_DEFS.find((d) => d.id === 'ack')!;
  const t = migratableTemplate(template);
  if (!def || !t) return;
  const ack = lists.ack!; // BlockLists 恒含全部 BLOCK_DEFS 区块（normalize 保证）
  const builtin = ack.list.find((x) => x.id === BUILTIN_TEMPLATE_ID) || {
    id: BUILTIN_TEMPLATE_ID,
    name: BUILTIN_TEMPLATE_NAME,
    template: def.defaultTemplate,
    builtin: true,
  };
  const current = ack.list.find((x) => x.id === ack.active) || builtin;
  const base = String(current.template || '').trim() || def.defaultTemplate;
  if (base.includes(t)) return; // 同一条内容已在 ack 里，不重复拼接
  const rest = ack.list.filter((x) => x.id !== BUILTIN_TEMPLATE_ID && x.id !== current.id);
  lists.ack = {
    active: RULE_LEGACY_ENTRY_ID,
    list: [
      builtin,
      { id: RULE_LEGACY_ENTRY_ID, name, template: `${base}\n\n${t}`, builtin: false },
      ...rest,
    ],
  };
}

/** 已落盘的 blockTemplates 里若还带 rule：读时并入 ack（之后保存自然不再写 rule 键）。 */
function absorbStoredRule(stored: unknown): BlockLists {
  const lists = normalizeBlockTemplateLists(stored);
  const rule = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? (stored as Record<string, any>).rule
    : null;
  if (!rule || typeof rule !== 'object') return lists;
  const texts = (Array.isArray(rule.list) ? rule.list : [])
    .filter((x: any) => x && !x.builtin && x.id !== BUILTIN_TEMPLATE_ID)
    .map((x: any) => migratableTemplate(x.template))
    .filter(Boolean);
  if (!texts.length && typeof rule.template === 'string') {
    const t = migratableTemplate(rule.template);
    if (t) texts.push(t);
  }
  const uniq = [...new Set(texts)];
  if (uniq.length) mergeRuleIntoAck(lists, uniq.join('\n\n'));
  return normalizeBlockTemplateLists(lists);
}

/**
 * 旧库迁移：没有 `lt.blockTemplates` 时，把旧键折算成每区块列表。
 * 优先级：旧「整体模板」的当前启用项 > 旧 `lt.xmlBlocks` > 旧的单项键。
 * 旧 rule 模板（整体模板 / xmlBlocks / lt.taskSuffix）统一并入 ack，不再单独成块。
 */
function migrateLegacy(conn: DbApi): { lists: BlockLists; appendMode: string } {
  const lists = defaultBlockTemplateLists();
  let legacyRule = '';

  // 1) 旧「整体模板集合 + activePromptTemplate」：只迁移当前启用模板（其它整组模板丢弃）
  const templates = readSetting(conn, KEYS.promptTemplates);
  let appendMode = clampAppendMode(readSetting(conn, KEYS.appendMode));
  if (Array.isArray(templates) && templates.length) {
    const wanted = String(readSetting(conn, KEYS.activePromptTemplate) || '').trim();
    const active = templates.find((t: any) => t && t.id === wanted) || templates[0];
    if (active && typeof active === 'object') {
      const blocks = active.blocks && typeof active.blocks === 'object' ? active.blocks : {};
      for (const def of BLOCK_DEFS) {
        const b = blocks[def.id];
        if (b && typeof b === 'object' && typeof b.template === 'string') {
          applyMigration(lists, def.id, b.template);
        }
      }
      const b = blocks.rule;
      if (b && typeof b === 'object' && typeof b.template === 'string') legacyRule = b.template;
      if (active.appendMode === 'plain' || active.appendMode === 'xml') appendMode = active.appendMode;
    }
  }

  // 2) 旧 xmlBlocks（v3 的 { [id]: { enabled, template } }）：逐块迁移有效模板
  const xmlBlocks = readSetting(conn, KEYS.xmlBlocks);
  if (xmlBlocks && typeof xmlBlocks === 'object' && !Array.isArray(xmlBlocks)) {
    for (const def of BLOCK_DEFS) {
      const b = xmlBlocks[def.id];
      // 已由整体模板迁移过的不再覆盖（优先级更高）
      if (lists[def.id]!.active !== BUILTIN_TEMPLATE_ID) continue;
      if (b && typeof b === 'object' && typeof b.template === 'string') {
        applyMigration(lists, def.id, b.template);
      }
    }
    const b = xmlBlocks.rule;
    if (!legacyRule && b && typeof b === 'object' && typeof b.template === 'string') {
      legacyRule = b.template;
    }
  }

  // 3) 旧的单项键（对应区块仍只有内置时生效）
  if (lists.context!.active === BUILTIN_TEMPLATE_ID) {
    applyMigration(lists, 'context', clampDeliveryTemplate(readSetting(conn, KEYS.deliveryTemplate)));
  }
  if (lists.attachment!.active === BUILTIN_TEMPLATE_ID) {
    applyMigration(lists, 'attachment', clampAttachTemplate(readSetting(conn, KEYS.attachTemplate)));
  }
  if (lists.ack!.active === BUILTIN_TEMPLATE_ID) {
    applyMigration(lists, 'ack', joinEntries(clampAckPromptList(readSetting(conn, KEYS.ackPrompt))));
  }
  if (!legacyRule) {
    const raw = readSetting(conn, KEYS.taskSuffix);
    const list: unknown[] = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    legacyRule = joinEntries(list.map((x) => String(x ?? '').trim()).filter(Boolean) as string[]);
  }
  mergeRuleIntoAck(lists, legacyRule);

  return { lists: normalizeBlockTemplateLists(lists), appendMode };
}

/**
 * 读「每区块模板列表 + 全局追加模式」。
 * 有 `lt.blockTemplates` 就以它为准；否则从旧键一次性折算（不落盘，写入口见 setLtSettings）。
 */
function readBlockState(conn: DbApi): { lists: BlockLists; appendMode: string } {
  const stored = readSetting(conn, KEYS.blockTemplates);
  if (stored !== undefined) {
    return {
      lists: absorbStoredRule(stored),
      appendMode: clampAppendMode(readSetting(conn, KEYS.appendMode)),
    };
  }
  return migrateLegacy(conn);
}

/** 当前生效模板 → 旧版派生字段（仅用于 CLI/旧面板视图兼容，不是读写模型）。 */
function derivedOf(lists: BlockLists): { ackPrompt: string[]; deliveryTemplate: string; attachTemplate: string } {
  const active = resolveBlockTemplates(lists);
  return {
    // 旧视图的「多条」字段按当前生效模板拆分（内置模板也如实反映）
    ackPrompt: splitEntries(active.ack!.template),
    deliveryTemplate: active.context!.builtin ? '' : active.context!.template,
    attachTemplate: active.attachment!.builtin ? '' : active.attachment!.template,
  };
}

/** 读全部 lt.* 设置（缺省回落内置默认）。 */
export function getLtSettings(): Record<string, any> {
  const conn = db();
  const { lists, appendMode } = readBlockState(conn);
  return {
    timeoutSec: clampTimeoutSec(readSetting(conn, KEYS.timeoutSec)),
    appendMode,
    blockTemplates: lists,
    ...derivedOf(lists),
  };
}

/**
 * 保存前的模板语法校验：
 * 语法错误 / 旧语法**拒绝保存**并指出模板 / 区块 / 出错位置。理由：渲染期回落到
 * 内置模板是兜底（老数据 / 手改库），不该成为正常入口的静默出口。旧语法同样拒绝，
 * 避免「保存成功、领取时被悄悄换回内置」的半兼容状态。
 */
function assertBlockTemplatesValid(lists: BlockLists): void {
  for (const def of BLOCK_DEFS) {
    for (const item of lists[def.id]!.list) {
      if (!item.template) continue; // 空模板合法（rule / 用户主动清空）
      const r = validateTemplate(item.template);
      if (!r.ok) {
        throw badInput(
          `提示词模板「${item.name}」的「${def.label}」区块语法错误：${r.error}`
        );
      }
    }
  }
}

/**
 * 命令行便捷入口：把一条模板写入某区块的固定条目（`cli`）并设为生效；
 * 空模板 = 恢复内置（保留用户其它条目，只把 active 指回 builtin）。
 */
function setCustomActive(lists: BlockLists, blockId: string, template: unknown, { name = '命令行' }: { name?: string } = {}): void {
  const b = lists[blockId]!; // BLOCK_DEFS 区块恒存在（normalize/defaultBlockTemplateLists 保证）
  const builtin = b.list.find((x) => x.id === BUILTIN_TEMPLATE_ID) || {
    id: BUILTIN_TEMPLATE_ID,
    name: BUILTIN_TEMPLATE_NAME,
    template: BLOCK_DEFS.find((d) => d.id === blockId)!.defaultTemplate,
    builtin: true,
  };
  const t = clampTemplate(template);
  if (!t) {
    lists[blockId] = { active: BUILTIN_TEMPLATE_ID, list: b.list };
    return;
  }
  const rest = b.list.filter((x) => x.id !== BUILTIN_TEMPLATE_ID && x.id !== CLI_ENTRY_ID);
  lists[blockId] = {
    active: CLI_ENTRY_ID,
    list: [builtin, { id: CLI_ENTRY_ID, name, template: t, builtin: false }, ...rest],
  };
}

/** setLtSettings 的 patch 形状（全部可选）。 */
export interface LtSettingsPatch {
  timeoutSec?: unknown;
  appendMode?: unknown;
  blockTemplates?: unknown;
  ackPrompt?: unknown;
  deliveryTemplate?: unknown;
  attachTemplate?: unknown;
}

/** 写部分设置（只改传入项；校验沿用 store-io / task-templates 的 clamp）。 */
export function setLtSettings(patch: LtSettingsPatch = {}): Record<string, any> {
  return txw((conn) => {
    if (patch.timeoutSec !== undefined) {
      writeSetting(conn, KEYS.timeoutSec, clampTimeoutSec(patch.timeoutSec));
    }

    const touches =
      patch.blockTemplates !== undefined ||
      patch.appendMode !== undefined ||
      patch.ackPrompt !== undefined ||
      patch.deliveryTemplate !== undefined ||
      patch.attachTemplate !== undefined;
    if (!touches) return getLtSettings();

    const current = readBlockState(conn);
    let lists = current.lists;

    // 新模型：按区块合并（只传某个区块时不动其它区块的列表）。
    if (patch.blockTemplates !== undefined) {
      const raw = patch.blockTemplates as Record<string, any> | undefined;
      const merged = { ...lists };
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const def of BLOCK_DEFS) {
          if (raw[def.id] !== undefined) merged[def.id] = raw[def.id];
        }
      }
      // 旧客户端仍带 rule：并入 ack（内容不静默丢），写盘后不再保留 rule 键。
      lists =
        raw && typeof raw === 'object' && !Array.isArray(raw) && raw.rule !== undefined
          ? absorbStoredRule({ ...merged, rule: raw.rule })
          : normalizeBlockTemplateLists(merged);
    }

    // 旧 CLI 便捷入口：写入对应区块的 `cli` 条目并启用（空 = 恢复内置）。
    if (patch.ackPrompt !== undefined) {
      setCustomActive(lists, 'ack', joinEntries(clampAckPromptList(patch.ackPrompt)));
    }
    if (patch.deliveryTemplate !== undefined) {
      setCustomActive(lists, 'context', clampDeliveryTemplate(patch.deliveryTemplate));
    }
    if (patch.attachTemplate !== undefined) {
      setCustomActive(lists, 'attachment', clampAttachTemplate(patch.attachTemplate));
    }

    lists = normalizeBlockTemplateLists(lists);
    assertBlockTemplatesValid(lists);

    const appendMode =
      patch.appendMode !== undefined ? clampAppendMode(patch.appendMode) : current.appendMode;
    writeSetting(conn, KEYS.blockTemplates, lists);
    writeSetting(conn, KEYS.appendMode, appendMode);
    return getLtSettings();
  });
}

/** 面板/CLI 的设置视图（派生兼容字段在这里补齐；权威字段是 blockTemplates）。 */
export function settingsView(): Record<string, any> {
  const s = getLtSettings();
  return {
    timeoutSec: s.timeoutSec,
    recommendedSec: DEFAULT_TIMEOUT_SEC,
    maxSec: MAX_TIMEOUT_SEC,
    ackPromptList: s.ackPrompt,
    deliveryTemplate: s.deliveryTemplate,
    attachTemplate: s.attachTemplate,
    appendMode: s.appendMode,
    blockTemplates: s.blockTemplates,
  };
}

export { DEFAULT_TIMEOUT_SEC, MAX_TIMEOUT_SEC, DEFAULT_ACK_PROMPT };
