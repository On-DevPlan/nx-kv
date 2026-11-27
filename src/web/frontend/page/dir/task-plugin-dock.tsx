// 任务编辑页底部抽屉的插件区块（gettask 第二生命周期点）。
//
// 插件在 server 侧 `gettask()` 声明区块（标签 / tag / 出厂模板 / 字段 / UI 挂载点）；
// 宿主把声明聚合成 dock tab，tab 内容 = 插件 client bundle 注册的组件。
// 插件组件通过 PluginClientApi.rpc 读写自己的表，数据按 task.id 绑定。
//
// 边界：本文件只认 HTTP /api/plugins/gettask 与 PluginComponent，不认识具体插件。
import { useEffect, useMemo, useState } from 'react';
import type { PluginClientApi, PretaskContext } from '@nx-kv/plugin-sdk/client';
import { getTaskPlugins } from './api.js';
import { PluginComponent } from '../../plugin-host/plugin-component.jsx';
import { buildPluginClientApi } from '../../plugin-host/client-api.js';
import { useToast } from '../../components/toast/index.jsx';
import type { AppSlice } from './task-utils.js';
import type { LocalTask, LocalTopic } from '../../types.js';

/** GET /api/plugins/gettask 的条目（与宿主 HostGetTaskEntry 同形，只取 dock 需要的字段）。 */
export interface GetTaskPluginEntry {
  id: string;
  segment: string;
  pluginId: string;
  pluginName: string;
  localId: string;
  label: string;
  description?: string;
  tag: string;
  order: number;
  ui?: { panel: string; title?: string } | null;
}

interface Query {
  enabled: boolean;
  taskId: string;
  topicKey: string;
}

/** 拉当前任务的 gettask 声明；只有带 ui.panel 的条目才会变成 dock tab。 */
export function useGetTaskPlugins({ enabled, taskId, topicKey }: Query): {
  entries: GetTaskPluginEntry[];
  error: string;
  loading: boolean;
} {
  const [entries, setEntries] = useState<GetTaskPluginEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      setError('');
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    getTaskPlugins({ topic: topicKey, taskId })
      .then((r) => {
        if (!alive) return;
        const list = ((Array.isArray(r?.entries) ? r.entries : []) as GetTaskPluginEntry[]).filter(
          (e) => !!e?.ui?.panel,
        );
        setEntries(list);
        setError('');
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setEntries([]);
        setError(String((e as Error).message || e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [enabled, taskId, topicKey]);
  return { entries, error, loading };
}

function ctxOf(taskId: string, topicKey: string, topic: LocalTopic | null, taskRow: LocalTask | null): PretaskContext {
  const board = String(taskRow?.boardKey || taskRow?.boardMark || '');
  const project = String(taskRow?.repoKey || '');
  return {
    ...(topicKey ? { topicKey, dirKey: topicKey } : {}),
    ...(topic?.cwd ? { cwd: String(topic.cwd) } : {}),
    // 组任务：任务行自带 repoKey——插件据此解析「在哪个仓库执行」。
    ...(project ? { repoKey: project } : {}),
    ...(topic?.groupKey ? { groupKey: String(topic.groupKey) } : {}),
    location: {
      ...(topicKey ? { dirKey: topicKey } : {}),
      ...(board ? { board } : {}),
      ...(project ? { project } : {}),
      ...(taskId ? { taskId } : {}),
    },
  };
}

/** 一个插件 tab 的内容：构造 PluginClientApi 后挂载插件组件。 */
export function TaskPluginDockView({
  entry,
  taskId,
  topicKey,
  topic,
  taskRow,
  app,
}: {
  entry: GetTaskPluginEntry;
  taskId: string;
  topicKey: string;
  topic: LocalTopic | null;
  taskRow: LocalTask | null;
  app: AppSlice;
}) {
  const toast = useToast();
  const ctx = useMemo(() => ctxOf(taskId, topicKey, topic, taskRow), [taskId, topicKey, topic, taskRow]);
  const apiValue = useMemo<PluginClientApi>(
    () =>
      buildPluginClientApi({
        pluginId: entry.pluginId,
        ctx,
        app,
        toast,
        closePage: () => {
          /* dock 没有独立页面可关 */
        },
      }),
    [entry.pluginId, ctx, app, toast],
  );
  return (
    <div className="mdw-plugin-dock">
      <PluginComponent
        pluginId={entry.pluginId}
        componentId={entry.ui?.panel}
        props={{ api: apiValue }}
      />
    </div>
  );
}
