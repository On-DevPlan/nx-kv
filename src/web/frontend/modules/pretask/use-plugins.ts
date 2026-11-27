// 设置页插件分区 / 可见性页共用的宿主插件清单。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { refreshPluginUi, type HostPluginSummary } from '../../plugin-host/loader.js';

export function usePlugins(): {
  plugins: HostPluginSummary[];
  loading: boolean;
  error: string;
  refetch: () => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
} {
  const [plugins, setPlugins] = useState<HostPluginSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api<HostPluginSummary[]>('/api/plugins');
      setPlugins(Array.isArray(rows) ? rows : []);
      setError('');
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    await api('/api/plugins/state', { method: 'PATCH', body: { id, enabled } });
    await refetch();
    try {
      await refreshPluginUi();
    } catch {
      /* 设置页开关已成功；UI 加载失败由插件页面提示 */
    }
  }, [refetch]);

  return { plugins, loading, error, refetch, setEnabled };
}
