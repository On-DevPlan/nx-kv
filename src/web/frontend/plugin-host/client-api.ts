// PluginClientApi 的统一构造：插件整页（plugin-page）与任务页 dock 共用。
//
// 宿主只注入能力，不注入内部对象——插件拿到的是 ctx / rpc / host.get /
// createDraft / navigate / toast 这组稳定接口。
import { createElement } from 'react';
import type { EntryView, PluginClientApi, PretaskContext, PretaskDraft } from '@nx-kv/plugin-sdk/client';
import { Icon } from '../components/icons.jsx';
import { api } from '../api/client.js';
import { docIdOf, nextDraftId, saveDoc, scopeOf } from '../modules/md/doc-store.js';
import { titleFromMd } from '../modules/md/md-parse.js';
import { setTaskIntent } from '../modules/md/task-intent.js';
import { pluginRpc, pretaskDraft } from '../modules/pretask/use-pretask.js';

/** 插件页面 / dock 需要的宿主导航能力（AppValue 的结构子集）。 */
export interface PluginAppLike {
  openPage?: (spec: any) => void;
  onNavigate?: (hash: string) => void;
}

export interface PluginApiOptions {
  pluginId: string;
  ctx: PretaskContext;
  /** 入口页面才有（gettask dock 没有 pretask 入口）。 */
  entry?: EntryView;
  app: PluginAppLike;
  toast: (msg: string) => void;
  /** 关闭当前插件页（dock 场景传空实现：没有可关的页）。 */
  closePage: () => void;
  /** createDraft 成功后回调（插件页用来释放 session；dock 不需要）。 */
  onDraftCreated?: () => void;
}

/** 构造一份插件可用的 PluginClientApi。 */
export function buildPluginClientApi({
  pluginId,
  ctx,
  entry,
  app,
  toast,
  closePage,
  onDraftCreated,
}: PluginApiOptions): PluginClientApi {
  const createDraft = (
    draft: PretaskDraft,
    opts?: { submit?: boolean; project?: string; board?: string },
  ) => {
    const body = String(draft?.body || '');
    if (!body.trim()) {
      toast('草稿为空');
      return;
    }
    const groupId = String(ctx.groupId || '');
    const dirKey = String(ctx.dirKey || ctx.topicKey || '');
    const id = nextDraftId();
    const docId = docIdOf(scopeOf(groupId || dirKey), id);
    saveDoc(docId, {
      // 标题优先用插件返回值；没给就从正文首行反推（与旧模板参数页同口径）
      title: String(draft?.title || '') || titleFromMd(body, ''),
      body,
      ...(groupId
        ? {
            boardKey: String(opts?.board || ctx.board || groupId),
            projectKey: String(opts?.project || ctx.project || ''),
          }
        : {}),
    });
    if (opts?.submit) setTaskIntent(docId, { submit: true });
    onDraftCreated?.();
    if (groupId) app.openPage?.({ groupId, task: id, name: '新任务' });
    else app.openPage?.({ dirKey, task: id, name: '新任务' });
  };

  return {
    pluginId,
    ctx,
    entry,
    rpc: (method, params) => pluginRpc(pluginId, method, params, ctx),
    host: {
      get: async (path, params) => {
        if (!path.startsWith('/api/')) throw new Error('host.get 只允许 /api/ 路径');
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(params || {})) {
          if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
        }
        return api(`${path}${q.size ? `${path.includes('?') ? '&' : '?'}${q.toString()}` : ''}`);
      },
    },
    draft: (entryId, values) =>
      pretaskDraft(entryId, values, { topic: ctx.topicKey, group: ctx.groupKey, repo: ctx.repoKey }),
    createDraft,
    navigate: (hash) => app.onNavigate?.(hash),
    closePage,
    toast,
    // 插件页面标题等处复用宿主图标集：与侧栏 / dock / 状态栏同一套图形。
    renderIcon: (name, size = 14) => createElement(Icon, { name, size, title: undefined }),
  };
}
