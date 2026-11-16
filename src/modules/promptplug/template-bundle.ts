// template-bundle：出厂模板快照（Template/blockTemplates.json）的读取与形状校验
// （唯一基准方案 §2 / §3）。
//
// 三条约定（§2）：
//   - 一个文件装 8 段（active + list 是「每区块一条记录」的整体，不拆文件）；
//   - template 存单个字符串（与 DB 行逐字同形，落库 = JSON.stringify(整个文件) 的 value）；
//   - 文件里没有版本号——版本存 settings['lt.promptTemplatesVersion']，
//     否则「文件 ≡ DB 行」这条性质当场破掉。
//
// 读不到 JSON 即报错（§3）：打包少文件是发布事故，静默降级会让所有段空掉却零告警。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BLOCK_DEFS,
  BUILTIN_TEMPLATE_ID,
  BUILTIN_TEMPLATE_NAME,
} from '../../shared/prompt-blocks.js';

/** 8 段模板列表集合（与 localtask/settings 的 BlockLists 同形，这里本地声明避免跨模块 import）。 */
type BlockLists = Record<string, { active: string; list: { id: string; name: string; template: string; builtin: boolean }[] }>;

const BUNDLE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'Template', 'blockTemplates.json');

/** 出厂快照版本（改 blockTemplates.json 的任何一段正文 → 这里 +1）。 */
export const BUNDLE_VERSION = 1;

let cache: BlockLists | null = null;

/** 读出厂快照（模块内缓存——文件在打包里不会变）。形状不对直接抛。 */
export function templateBundle(): BlockLists {
  if (cache) return cache;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`出厂模板快照读取失败（${BUNDLE_PATH}）：${(e as Error).message}`);
  }
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (!src) throw new Error(`出厂模板快照形状错误（非对象）：${BUNDLE_PATH}`);
  const lists = {} as BlockLists;
  for (const def of BLOCK_DEFS) {
    const br = src[def.id];
    const rec = (br && typeof br === 'object' && !Array.isArray(br) ? br : null) as Record<string, unknown> | null;
    const list = (rec?.list ?? null) as unknown;
    if (!Array.isArray(list)) throw new Error(`出厂模板快照缺区块 ${def.id} 的 list`);
    const items = list as Record<string, unknown>[];
    const builtin = items.find((x) => x && x.id === BUILTIN_TEMPLATE_ID && x.builtin === true);
    if (!builtin || typeof builtin.template !== 'string' || !builtin.template.trim()) {
      throw new Error(`出厂模板快照区块 ${def.id} 缺内置条目或内置模板为空`);
    }
    lists[def.id] = {
      active: BUILTIN_TEMPLATE_ID,
      list: [{ id: BUILTIN_TEMPLATE_ID, name: BUILTIN_TEMPLATE_NAME, template: builtin.template, builtin: true }],
    };
  }
  cache = lists;
  return lists;
}
