// pretask 入口的统一动作：draft 入口生成草稿 / 带 form 入口进插件页面 / panel 入口进插件页面。
import type { PretaskContext } from '@nx-kv/plugin-sdk';
import type { Model } from 'flexlayout-react';
import { api } from '../../api/client.js';
import { createTaskAndOpen } from '../task/create.js';
import { openPanel } from '../../workspace.js';
import { putPluginPageSession } from '../../plugin-host/session.js';
import { pretaskDraft } from './use-pretask.js';
import type { PretaskEntriesResult, PretaskEntry } from './types.js';

export function pluginPageHash(pluginId: string, pageId: string, sessionId?: string): string {
  const base = `#/plugin/${encodeURIComponent(pluginId)}/${encodeURIComponent(pageId)}`;
  return sessionId ? `${base}/${encodeURIComponent(sessionId)}` : base;
}

/** panel 入口：进插件页面，并把完整上下文装进 session（插件页可自行请求更多）。 */
export function openPanelEntry(
  entry: PretaskEntry,
  ctx: PretaskContext,
  navigate: (hash: string) => void,
): boolean {
  const pageId = String(entry.ui?.panel || entry.ui?.form || '');
  if (!pageId) return false;
  const sessionId = putPluginPageSession({
    pluginId: entry.pluginId,
    pageId,
    entryId: entry.id,
    ctx,
    entry,
  });
  navigate(pluginPageHash(entry.pluginId, pageId, sessionId));
  return true;
}

/** draft 入口：有 form 时进插件页面填槽位，否则直接生成草稿正文。 */
export function openDraftEntry(
  entry: PretaskEntry,
  ctx: PretaskContext,
  navigate: (hash: string) => void,
): boolean {
  const formId = String(entry.ui?.form || '');
  if (!formId) return false;
  const sessionId = putPluginPageSession({
    pluginId: entry.pluginId,
    pageId: formId,
    entryId: entry.id,
    ctx,
    entry,
  });
  navigate(pluginPageHash(entry.pluginId, formId, sessionId));
  return true;
}

/**
 * 无页面上下文的「＋ 新建页」（如侧栏仓库行）：按该 topic 的默认入口启动。
 * 面板入口直接进插件页；草稿入口生成正文并落草稿页。
 * #286 改口径：未显式配置默认入口时返回 false，调用方落空白任务页直接进编辑。
 */
export async function startDefaultEntry(input: {
  topicKey: string;
  repoKey?: string;
  cwd?: string;
  name?: string;
  navigate: (hash: string) => void;
  refreshLocal?: () => Promise<void>;
}): Promise<boolean> {
  const q = new URLSearchParams({ topic: input.topicKey });
  if (input.repoKey) q.set('repo', input.repoKey);
  const data = await api<PretaskEntriesResult>(`/api/pretask/entries?${q.toString()}`);
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  // #286 改口径：只有显式配置的默认入口才启动（面板入口进插件页 / 草稿入口生成正文）；
  // 未配置返回 false → 调用方落空白任务页直接进编辑，不再回落模板。
  const entry = data.defaultExplicit
    ? entries.find((e) => e.id === data.defaultEntryId)
    : undefined;
  if (!entry) return false;
  const ctx: PretaskContext = {
    topicKey: input.topicKey,
    repoKey: input.repoKey || '',
    cwd: input.cwd || '',
    dirKey: input.topicKey,
    // 侧栏仓库行 = 仓库语境；显式声明 repo，避免带组关联的 topic 被当成组页
    topic: {
      key: input.topicKey,
      name: input.name || '',
      kind: 'repo',
      cwd: input.cwd || '',
      repoKey: input.repoKey || '',
      groupKey: '',
      repoName: input.name || '',
      groupName: '',
      repoRoot: input.cwd || '',
    },
    location: { dirKey: input.topicKey },
  };
  if (entry.kind === 'panel') return openPanelEntry(entry, ctx, input.navigate);
  if (openDraftEntry(entry, ctx, input.navigate)) return true;
  const draft = await pretaskDraft(entry.id, entry.values || {}, {
    topic: input.topicKey,
    repo: input.repoKey || '',
  });
  const body = String(draft?.body || '');
  await createTaskAndOpen(
    { onNavigate: input.navigate, refreshLocal: input.refreshLocal },
    {
      text: body,
      title: String(draft?.title || ''),
      status: 'plan',
      dirKey: input.topicKey,
      cwd: input.cwd || '',
    },
  );
  return true;
}

/** 直接生成草稿正文（无 form 的 draft 入口）。 */
export async function draftBodyOf(entry: PretaskEntry, ctx: PretaskContext): Promise<string> {
  const d = await pretaskDraft(entry.id, entry.values || {}, {
    topic: ctx.topicKey,
    group: ctx.groupKey,
    repo: ctx.repoKey,
  });
  return String(d?.body || '');
}

/** 宿主级「配置新建页行为…」：打开默认入口 + 下拉范围面板。 */
export function openVisibilityPanel(
  model: Model | null | undefined,
  input: { scopeKey: string; label?: string; topic?: string; group?: string; repo?: string },
): void {
  if (!model) return;
  openPanel(model, {
    component: 'plugin-visibility',
    name: '新建页行为',
    config: {
      scopeKey: input.scopeKey,
      label: input.label || '',
      topic: input.topic || '',
      group: input.group || '',
      repo: input.repo || '',
    },
    location: 'center',
  });
}
