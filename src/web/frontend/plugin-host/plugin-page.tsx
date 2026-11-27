// 通用插件页面宿主：#/plugin/<pluginId>/<pageId>[/<sessionId>]
// 页面组件由插件 client bundle 注册；宿主只注入 PluginClientApi。
import { useMemo } from 'react';
import type { PluginClientApi } from '@nx-kv/plugin-sdk/client';
import { useApp } from '../app-context.jsx';
import { useToast } from '../components/toast/index.jsx';
import { api } from '../api/client.js';
import { docIdOf, nextDraftId, saveDoc, scopeOf } from '../modules/md/doc-store.js';
import { titleFromMd } from '../modules/md/md-parse.js';
import { setTaskIntent } from '../modules/md/task-intent.js';
import { popRoute } from '../components/layout/route-history.js';
import { pretaskDraft, pluginRpc } from '../modules/pretask/use-pretask.js';
import { PluginComponent } from './plugin-component.jsx';
import { dropPluginPageSession, getPluginPageSession } from './session.js';
import './style.css';

export interface PluginPageConfig {
  pluginId?: string;
  pageId?: string;
  sessionId?: string;
  props?: Record<string, unknown>;
}

export default function PluginPageHost({ config }: { config?: PluginPageConfig }) {
  const app = useApp();
  const toast = useToast();
  const pluginId = String(config?.pluginId || '');
  const pageId = String(config?.pageId || '');
  const session = config?.sessionId ? getPluginPageSession(config.sessionId) : undefined;
  const ctx = session?.ctx || {};
  const entry = session?.entry;

  const apiValue = useMemo<PluginClientApi>(() => {
    const closePage = () => {
      dropPluginPageSession(config?.sessionId);
      const prev = popRoute();
      app.onNavigate?.(prev || '#/');
    };
    const createDraft = (
      draft: { body: string; title?: string },
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
      dropPluginPageSession(config?.sessionId);
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
      draft: (entryId, values) => pretaskDraft(entryId, values, { topic: ctx.topicKey, group: ctx.groupKey, repo: ctx.repoKey }),
      createDraft,
      navigate: (hash) => app.onNavigate?.(hash),
      closePage,
      toast,
    };
  }, [pluginId, config?.sessionId, session, ctx, entry, app, toast]);

  if (!pluginId || !pageId) {
    return <div className="muted" style={{ padding: 20 }}>插件页面地址不完整。</div>;
  }
  return (
    <div className="plugin-page-host">
      <PluginComponent
        pluginId={pluginId}
        componentId={pageId}
        props={{ api: apiValue, ...(config?.props || {}) }}
      />
    </div>
  );
}
