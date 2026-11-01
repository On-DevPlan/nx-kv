// 任务模板（面板侧）：拉取 /api/templates + 增删/设默认，供 MD 工作台「新建页」用。
//
// 模板数据在本机服务（~/.nx-kv/templates.json），与队列同源同构——不落浏览器存储，
// 换浏览器/刷新都一致。拉取失败不阻塞工作台：templates 置 null，新建页退回
// md-parse 的 NEW_TEMPLATE（与后端内置模板同构），行为与旧版一致。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { NEW_TEMPLATE } from './md-parse.js';

export function useTemplates() {
  // unsupported = 正在跑的 serve 进程比面板资产旧（路由在进程启动时加载、资产从磁盘现读）：
  // /api/templates 返回「接口不存在」。此时模板功能整体不可用，UI 要引导重启，而不是
  // 显示一条假装是瞬时故障的「加载失败」。
  const [state, setState] = useState({ defaultId: '', templates: null, unsupported: false });

  const refetch = useCallback(async () => {
    try {
      const d = await api('/api/templates');
      setState({ defaultId: d.defaultId, templates: d.templates, unsupported: false });
    } catch (e) {
      setState((s) => ({
        ...s,
        templates: null,
        unsupported: String(e.message || e).includes('接口不存在'),
      }));
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  /** 默认模板正文（未加载/拉取失败 → NEW_TEMPLATE 兜底，见文件头） */
  const defaultBody = useCallback(() => {
    const t = (state.templates || []).find((x) => x.id === state.defaultId);
    return (t && t.body) || NEW_TEMPLATE;
  }, [state]);

  const add = useCallback(async (name, body, setDefault) => {
    const d = await api('/api/templates', { method: 'POST', body: { name, body, setDefault } });
    await refetch();
    return d;
  }, [refetch]);

  const remove = useCallback(async (id) => {
    const d = await api(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} });
    await refetch();
    return d;
  }, [refetch]);

  const update = useCallback(async (id, patch) => {
    const d = await api(`/api/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
    await refetch();
    return d;
  }, [refetch]);

  const setDefault = useCallback(async (id) => {
    const d = await api('/api/templates/default', { method: 'PATCH', body: { id } });
    await refetch();
    return d;
  }, [refetch]);

  return {
    defaultId: state.defaultId,
    templates: state.templates,
    unsupported: state.unsupported,
    defaultBody,
    refetch,
    add,
    remove,
    update,
    setDefault,
  };
}
