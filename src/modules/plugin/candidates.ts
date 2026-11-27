// 插件候选条目（标准数据接口）：面板列表 + 未来正文内搜索/引用共用。
//
// 插件只实现 `candidates(ctx)` 返回纯数据；宿主负责：
//   ① 只聚合已启用且激活成功的插件；
//   ② 校验 id / label、去重、关键字过滤、排序与上限；
//   ③ 通过 `plugin candidates` / `GET /api/plugins/candidates` 对外。
//
// 宿主不认识具体业务（skill / 模板 / 片段），只透传 path / text / meta。
import type { PluginCandidate, PretaskContext } from '@nx-kv/plugin-sdk';
import { enabledPlugins } from './host.js';

export interface CandidateQuery extends PretaskContext {
  /** 只看某个插件（缺省 = 全部已启用插件） */
  pluginId?: string;
  /** 关键字（大小写不敏感；匹配 label / description / path / text / kind） */
  q?: string;
  /** 返回上限（默认 200，最大 1000） */
  limit?: number;
}

export interface HostCandidate extends PluginCandidate {
  pluginId: string;
  pluginName: string;
}

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;

function msgOf(e: unknown): string {
  return String((e as Error)?.message || e);
}

/** 聚合候选条目（按插件 order + label 排序）。 */
export async function listCandidates(
  query: CandidateQuery = {},
): Promise<{ candidates: HostCandidate[]; warnings: string[] }> {
  const { pluginId = '', q = '', limit, ...ctx } = query;
  const wanted = String(pluginId || '').trim();
  const needle = String(q || '').trim().toLowerCase();
  const cap = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit))))
    : DEFAULT_LIMIT;
  const { handles, warnings } = await enabledPlugins(ctx);
  const rows: (HostCandidate & { pluginOrder: number })[] = [];
  let truncated = false;

  for (const { plugin, ctx: pluginCtx } of handles) {
    if (wanted && plugin.id !== wanted) continue;
    if (typeof plugin.candidates !== 'function') continue;
    let list: PluginCandidate[] = [];
    try {
      list = await plugin.candidates(pluginCtx);
    } catch (e) {
      warnings.push(`${plugin.id}: candidates 读取失败——${msgOf(e)}`);
      continue;
    }
    const seen = new Set<string>();
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== 'object') continue;
      const id = String(raw.id || '').trim();
      const label = String(raw.label || '').trim();
      if (!id || !label) {
        warnings.push(`${plugin.id}: 候选条目缺少 id 或 label，已忽略`);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      const searchable = [label, raw.description, raw.path, raw.text, raw.kind]
        .filter((x) => typeof x === 'string' && x)
        .join(' ')
        .toLowerCase();
      if (needle && !searchable.includes(needle)) continue;
      rows.push({
        ...raw,
        id,
        label,
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginOrder: Number(plugin.order) || 100,
      });
      if (rows.length >= cap) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }

  rows.sort(
    (a, b) =>
      a.pluginOrder - b.pluginOrder ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id),
  );
  if (truncated) warnings.push(`候选条目超过 ${cap} 条，已截断`);
  const candidates = rows.map(({ pluginOrder: _p, ...rest }) => rest);
  return { candidates, warnings };
}
