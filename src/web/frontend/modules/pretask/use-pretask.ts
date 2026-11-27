// pretask 入口数据面：下拉 / 草稿 / 插件 RPC 共用。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import type { PretaskContext } from '@nx-kv/plugin-sdk';
import { usePluginUiVersion } from '../../plugin-host/registry.js';
import type { PretaskEntriesResult, PretaskEntry, PretaskScope } from './types.js';

function queryOf(scope: PretaskScope | null | undefined, all?: boolean): string {
  const q = new URLSearchParams();
  if (scope?.topic) q.set('topic', scope.topic);
  if (scope?.group) q.set('group', scope.group);
  if (scope?.repo) q.set('repo', scope.repo);
  if (all) q.set('all', 'true');
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function usePretaskEntries(
  scope: PretaskScope | null | undefined,
  opts: { all?: boolean } = {},
): {
  entries: PretaskEntry[];
  defaultEntryId: string;
  warnings: string[];
  loading: boolean;
  error: string;
  unsupported: boolean;
  refetch: () => Promise<void>;
} {
  const key = useMemo(
    () => JSON.stringify({ t: scope?.topic || '', g: scope?.group || '', r: scope?.repo || '', a: !!opts.all }),
    [scope?.topic, scope?.group, scope?.repo, opts.all],
  );
  // 全局插件开关会改 enabled 集合；这里跟一次版本，让下拉/可见性页在开关后立刻重拉。
  const pluginUiVersion = usePluginUiVersion();
  const [state, setState] = useState<{
    entries: PretaskEntry[];
    defaultEntryId: string;
    warnings: string[];
    loading: boolean;
    error: string;
    unsupported: boolean;
  }>({ entries: [], defaultEntryId: '', warnings: [], loading: true, error: '', unsupported: false });

  const refetch = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const d = await api<PretaskEntriesResult>(`/api/pretask/entries${queryOf(scope, opts.all)}`);
      setState({
        entries: Array.isArray(d?.entries) ? d.entries : [],
        defaultEntryId: String(d?.defaultEntryId || ''),
        warnings: Array.isArray(d?.warnings) ? d.warnings : [],
        loading: false,
        error: '',
        unsupported: false,
      });
    } catch (e) {
      const message = String((e as Error).message || e);
      setState({
        entries: [],
        defaultEntryId: '',
        warnings: [],
        loading: false,
        error: message,
        unsupported: message.includes('接口不存在'),
      });
    }
    // eslint 无 exhaustive-deps：依赖用序列化 key，避免 scope 对象每次渲染换引用
  }, [key, pluginUiVersion]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { ...state, refetch };
}

/** 调 pretask.draft：只生成正文，不落队列。 */
export async function pretaskDraft(
  entryId: string,
  values: Record<string, string>,
  scope: PretaskScope | null | undefined,
): Promise<{ body: string; title?: string }> {
  return api('/api/pretask/draft', {
    method: 'POST',
    body: {
      entryId,
      values,
      ...(scope?.topic ? { topic: scope.topic } : {}),
      ...(scope?.group ? { group: scope.group } : {}),
      ...(scope?.repo ? { repo: scope.repo } : {}),
    },
  });
}

/** 插件自有 RPC（插件管理页 / 目录批注页用）；ctx 由宿主页面透传给插件 server。 */
export async function pluginRpc<T = any>(
  pluginId: string,
  method: string,
  params?: unknown,
  ctx?: PretaskContext,
): Promise<T> {
  return api<T>('/api/plugins/rpc', {
    method: 'POST',
    body: { pluginId, method, params, ctx },
  });
}

export function ctxOfScope(scope: PretaskContext | null | undefined): PretaskContext {
  return { ...(scope || {}) };
}
