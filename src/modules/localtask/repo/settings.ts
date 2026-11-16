// 本机设置仓储：settings 表的 lt.* 键（超时 / 追加模式 / 每区块模板列表）。
//
// 为什么走 k/v 而不是宽表：这些键会持续增加，加键零迁移（schema G2 的取舍）。
// value 一律 JSON 文本（'240' / '["a","b"]' / '"…"'），读写都在这里序列化。
// 凭据（token/baseUrl/email/userId/groupId）**绝不进这张表** —— 它们留在 config.json。
//
// 提示词模型（v6，唯一基准方案 docs/research/prompt-plugin-single-route.md §4）：
//   - `lt.blockTemplates` 是唯一权威来源：`{ [blockId]: { active, list } }`，
//     每个区块各自一份模板列表、各自指定生效项；内置条目 `builtin` 常驻不可改。
//     首启落库由 promptplug/ensure.ts 完成（open.ts 挂 ensure）——本文件**不做任何
//     合成与旧键折算**（§4.1 纯校验；旧 lt.* 键、rule 键、数组简写形态已全部下线）。
//   - 全局只有 `lt.appendMode`（xml / plain）对所有区块整体生效。
//   - 没有落库行 = 事故，抛错（ensure 恒先于本文件的任何读取执行）。
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
  BUILTIN_TEMPLATE_ID,
  MAX_BLOCK_TEMPLATE_LEN,
  PROMPT_BLOCK_IDS,
  normalizeBlockTemplateLists,
  resolveBlockTemplates,
} from '../../../shared/prompt-blocks.js';
import type { BlockLists, BlockTemplateList } from '../../../shared/prompt-blocks.js';
import type { DbApi } from '../../../core/db/driver.js';
import { undeclaredTemplateVars } from '../../../shared/prompt-plugin.js';
import { globalTemplateVarScope, blockLabelOf } from '../../promptplug/index.js';

const KEYS = {
  timeoutSec: 'lt.timeoutSec',
  appendMode: 'lt.appendMode',
  blockTemplates: 'lt.blockTemplates',
};

/** 命令行便捷写入使用的固定条目 id（不影响用户自己新建的模板）。 */
const CLI_ENTRY_ID = 'cli';

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

/** 多条设置按空行拼成一条模板（CLI 便捷入口用）。 */
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

/**
 * 读「每区块模板列表 + 全局追加模式」（**纯读 + 纯校验**）。
 * `lt.blockTemplates` 恒存在（open.ts 的 ensurePromptTemplates 首启落库）；
 * 没有行 / 校验不过都是事故，抛错——不合成、不补齐（方案 §4.1）。
 */
function readBlockState(conn: DbApi): { lists: BlockLists; appendMode: string } {
  const stored = readSetting(conn, KEYS.blockTemplates);
  return {
    lists: normalizeBlockTemplateLists(stored),
    appendMode: clampAppendMode(readSetting(conn, KEYS.appendMode)),
  };
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

/** 读全部 lt.* 设置（校验不过即抛——落库行被人为写坏是事故）。 */
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
 * 保存前的模板校验（方案 §4.2，三道）：
 *   1. 语法错误**拒绝保存**并指出模板 / 区块 / 出错位置（渲染期不再回落）；
 *   2. 当前生效（active）模板为空 → 拒绝——空模板在运行期是配置错误（S1 起
 *      compose 的 assertPluginList 直接抛），不许「保存成功、领取时整次失败」；
 *   3. 变量白名单：全局段集 + 点路径全路径命中 fields 并集（落地裁决见方案 §4.2 补记；
 *      `params` 动态键放行，`{{#each}}` 块内放行但 each 目标必须已声明）。
 */
function assertBlockTemplatesValid(lists: BlockLists): void {
  const scope = globalTemplateVarScope();
  for (const blockId of PROMPT_BLOCK_IDS) {
    const b = lists[blockId]!;
    const label = blockLabelOf(blockId);
    for (const item of b.list) {
      if (!item.template) continue; // 非 active 的空条目合法（不渲染，仅存档）
      const r = validateTemplate(item.template);
      if (!r.ok) {
        throw badInput(
          `提示词模板「${item.name}」的「${label}」区块语法错误：${r.error}`
        );
      }
    }
    // 生效模板的空 / 变量白名单
    const active = b.list.find((x) => x.id === b.active);
    if (active && !active.template.trim()) {
      throw badInput(`「${label}」区块当前生效的模板「${active.name}」是空的：换回内置或改成有内容的模板后再保存`);
    }
    if (active && active.template) {
      const undeclared = undeclaredTemplateVars(active.template, scope.allowedSegments, scope.fieldKeys);
      if (undeclared.length) {
        throw badInput(
          `「${label}」区块的生效模板「${active.name}」引用了未声明的变量：${undeclared.join('、')}。可用变量见设置页「插入变量」目录`
        );
      }
    }
  }
}

/**
 * 命令行便捷入口：把一条模板写入某区块的固定条目（`cli`）并设为生效；
 * 空模板 = 恢复内置（保留用户其它条目，只把 active 指回 builtin）。
 * 内置条目恒在（normalize 校验保证），直接从现值取——不再按代码重建。
 */
function setCustomActive(lists: BlockLists, blockId: string, template: unknown, { name = '命令行' }: { name?: string } = {}): void {
  const b = lists[blockId]; // normalize 保证全部区块存在
  if (!b) throw badInput(`未知提示词区块：${blockId}`);
  const builtin = b.list.find((x) => x.id === BUILTIN_TEMPLATE_ID);
  if (!builtin) throw badInput(`「${blockLabelOf(blockId)}」区块缺内置条目（落库行被写坏）`);
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

    // 新模型：按区块合并（只传某个区块时不动其它区块的列表），整体过纯校验。
    // 历史 rule 键已下线：patch 里带 rule 直接忽略（§11 不做旧配置兼容）。
    if (patch.blockTemplates !== undefined) {
      const raw = patch.blockTemplates as Record<string, any> | undefined;
      const merged = { ...lists };
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const blockId of PROMPT_BLOCK_IDS) {
          if (raw[blockId] !== undefined) merged[blockId] = raw[blockId];
        }
        // 内置不可改（§4.2 第 1 道）：被 patch 的区块里，builtin 条目一律替换回
        // 库内现值（含 name / template / 位置）——落库后 builtin 是真数据，
        // 客户端传什么都不生效；patch 缺 builtin 条目时补回。
        for (const blockId of PROMPT_BLOCK_IDS) {
          const next = merged[blockId];
          const cur = lists[blockId];
          if (raw[blockId] === undefined || !next || !cur) continue;
          const curBuiltin = cur.list.find((x) => x.id === BUILTIN_TEMPLATE_ID)!;
          const rest = (Array.isArray(next.list) ? next.list : []).filter(
            (x: any) => x && x.id !== BUILTIN_TEMPLATE_ID && x.builtin !== true,
          );
          merged[blockId] = { ...next, list: [curBuiltin, ...rest] };
        }
      }
      lists = normalizeBlockTemplateLists(merged);
    }

    // CLI 便捷入口：写入对应区块的 `cli` 条目并启用（空 = 恢复内置）。
    if (patch.ackPrompt !== undefined) {
      setCustomActive(lists, 'ack', joinEntries(clampAckPromptList(patch.ackPrompt)));
    }
    if (patch.deliveryTemplate !== undefined) {
      setCustomActive(lists, 'context', clampDeliveryTemplate(patch.deliveryTemplate));
    }
    if (patch.attachTemplate !== undefined) {
      setCustomActive(lists, 'attachment', clampAttachTemplate(patch.attachTemplate));
    }

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

export { DEFAULT_TIMEOUT_SEC, MAX_TIMEOUT_SEC } from '../store-io.js';
export { DEFAULT_ACK_PROMPT } from '../task-templates.js';
export type { BlockTemplateList };
