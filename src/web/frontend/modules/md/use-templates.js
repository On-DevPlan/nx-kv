// 任务模板（面板侧）：拉取 /api/templates + 增删/设默认，供 MD 工作台「新建页」用。
//
// 模板数据在本机服务（~/.nx-kv/templates.json），与队列同源同构——不落浏览器存储，
// 换浏览器/刷新都一致。拉取失败不阻塞工作台：templates 置 null，新建页退回
// md-parse 的 NEW_TEMPLATE（与后端内置模板同构），行为与旧版一致。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { NEW_TEMPLATE, NEW_TEMPLATE_VALUES } from './md-parse.js';
import { renderTemplateBody } from '../prompts/placeholders.js';

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

  /** 默认模板正文（未加载/拉取失败 → 内置骨架 + 默认槽位值兜底）。
   *  永远返回**已渲染**正文——任务里不能出现裸 `{{槽位}}`。 */
  const defaultBody = useCallback(() => {
    const t = (state.templates || []).find((x) => x.id === state.defaultId);
    if (!t) return renderTemplateBody(NEW_TEMPLATE, NEW_TEMPLATE_VALUES);
    // 缺的键用内置默认值补；用户显式留空（''）仍是空——不把标记露回正文。
    return renderTemplateBody(t.body, { ...NEW_TEMPLATE_VALUES, ...(t.values || {}) });
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
    // body 里带上 id：id 恰是 'default' 时请求会命中「设默认」那条字面量路由
    // （字面量优先于 :id），那里 ctx.id 只能从 body 取——不带就 400（任务 #87）。
    const d = await api(`/api/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: { id, ...patch } });
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
