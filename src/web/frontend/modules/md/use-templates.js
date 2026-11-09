// 任务模板（面板侧）：拉取 /api/templates + 增删/设默认，供 MD 工作台「新建页」用。
//
// 模板数据在本机服务（~/.nx-kv/templates.json），与队列同源同构——不落浏览器存储，
// 换浏览器/刷新都一致。拉取失败不阻塞工作台：templates 置 null，新建页退回
// md-parse 的 NEW_TEMPLATE（与后端内置模板同构），行为与旧版一致。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useApp } from '../../app-context.jsx';
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

  const add = useCallback(async (name, body, setDefault, opts = {}) => {
    // opts.topic（#128）：从主题页新建时带上——服务端默认把可见域设为该主题；
    // opts.scope（#131）：显式可见域（不传且无 topic = 未配置，不再默认全局）。
    const d = await api('/api/templates', {
      method: 'POST',
      body: {
        name,
        body,
        setDefault,
        ...(opts.topic ? { topic: opts.topic } : {}),
        ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
      },
    });
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

/**
 * 按可见上下文列可用模板（#128/#132）：GET /api/templates?topic=&group=&repo=
 *
 * 入参兼容旧写法（字符串 = topic key），也接受 { topic, group, repo }。
 * 三把钥匙与 `*` 平级；组页可只传 group。
 *
 * 三档退化，菜单永远有东西可显示：
 *   · 三钥皆空 → templates=null，调用方回落全量；
 *   · 旧 serve 不认识参数 → 无 scoped 字段 → 原样全量；
 *   · 请求失败 → templates=null，调用方回落全量。
 */
export function useTemplatesFor(topicOrOpts) {
  const opts =
    topicOrOpts && typeof topicOrOpts === 'object'
      ? topicOrOpts
      : { topic: topicOrOpts || '' };
  const topic = String(opts.topic || '').trim();
  const group = String(opts.group || '').trim();
  const repo = String(opts.repo || '').trim();
  const [state, setState] = useState({ templates: null, scoped: false });
  // 全量模板增删改后同步刷 scoped（#135：新建走全屏编辑，不再就地 refetch）
  const app = useApp() || {};
  const globalList = (app.tpl && app.tpl.templates) || null;
  const globalSig = Array.isArray(globalList)
    ? globalList.map((t) => `${t.id}:${(t.scope || []).join(',')}`).join('|')
    : '';

  const refetch = useCallback(async () => {
    if (!topic && !group && !repo) {
      setState({ templates: null, scoped: false });
      return;
    }
    try {
      const q = new URLSearchParams();
      if (topic) q.set('topic', topic);
      if (group) q.set('group', group);
      if (repo) q.set('repo', repo);
      const d = await api(`/api/templates?${q}`);
      setState({ templates: d.templates || [], scoped: !!d.scoped });
    } catch {
      setState({ templates: null, scoped: false });
    }
  }, [topic, group, repo]);

  useEffect(() => {
    refetch();
  }, [refetch, globalSig]);

  return { templates: state.templates, scoped: state.scoped, refetch };
}
