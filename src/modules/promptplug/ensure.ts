// ensure：首启落库与升级（唯一写点，方案 §3）。
//
// 时序：读版本键 → 已最新直接返回（重启零写、零查询）→ 落后时读出厂快照，
// 只刷 builtin 文本（用户条目 builtin:false、active、list 顺序一律不动），
// 同事务写回 lt.blockTemplates 与 lt.promptTemplatesVersion。
//
// 存量自愈（S1 补记）：active 指向空模板条目 → 修回 builtin——空模板在运行期
// 是配置错误（assertPluginList 抛），落库后由这里一次性收敛，不让升级变成事故。
import { readSettingRaw, writeSettingRaw } from '../../core/db/settings.js';
import type { DbApi } from '../../core/db/driver.js';
import { tx } from '../../core/db/tx.js';
import { BUILTIN_TEMPLATE_ID } from '../../shared/prompt-blocks.js';
import { BUNDLE_VERSION, templateBundle } from './template-bundle.js';
import { LT_PROMPT_TEMPLATES_VERSION, LT_BLOCK_TEMPLATES } from './keys.js';

/**
 * 首启 / 版本落后时把出厂快照写进 settings（全仓唯一调用点：localtask/repo/open.ts）。
 * 返回是否发生写入（测试断言「重启零写」用）。
 */
export function ensurePromptTemplates(conn: DbApi): boolean {
  const cur = Number(readSettingRaw(conn, LT_PROMPT_TEMPLATES_VERSION) ?? 0);
  if (cur >= BUNDLE_VERSION) return false;

  const bundle = templateBundle();
  let wrote = false;
  tx(() => {
    const stored = readSettingRaw(conn, LT_BLOCK_TEMPLATES) as Record<string, any> | undefined;
    const lists = { ...bundle };
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      // 升级语义只有一条：只覆盖内置文本；用户条目与 active 永不被覆盖。
      for (const id of Object.keys(bundle)) {
        const br = stored[id];
        const rec = br && typeof br === 'object' && !Array.isArray(br) ? (br as Record<string, unknown>) : null;
        const rawList = Array.isArray(rec?.list) ? (rec!.list as Record<string, unknown>[]) : null;
        if (!rawList) continue; // 缺整块 → 出厂快照原样落
        const items = rawList.map((item) => {
          if (item && typeof item === 'object' && (item.builtin === true || item.id === BUILTIN_TEMPLATE_ID)) {
            return { ...item, template: bundle[id]!.list[0]!.template };
          }
          return item;
        });
        // 存量自愈：active 指向不存在的条目或空模板 → 修回 builtin
        const wanted = String(rec?.active ?? '').trim();
        const activeItem = items.find((x) => x && (x as any).id === wanted);
        const activeBlank = activeItem && String((activeItem as any).template ?? '').trim() === '';
        const active = !activeItem || activeBlank ? BUILTIN_TEMPLATE_ID : wanted;
        lists[id] = { active, list: items as any };
      }
      wrote = true;
    } else {
      wrote = true; // 首启：整份出厂快照落库
    }
    writeSettingRaw(conn, LT_BLOCK_TEMPLATES, lists);
    writeSettingRaw(conn, LT_PROMPT_TEMPLATES_VERSION, BUNDLE_VERSION);
  }, { db: conn });
  return wrote;
}
