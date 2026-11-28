// nx-kv 插件 SDK：client 半侧契约（只给插件 UI 包用，宿主只提供实现）。
import type { ComponentType, ReactNode } from 'react';
import type { EntryView, PretaskContext, PretaskDraft } from './index.js';

export type {
  EntryView,
  PluginContextView,
  PluginFileView,
  PluginRepoView,
  PluginTreeEntry,
  PluginTreeView,
  PluginTopicInfo,
  PretaskContext,
  PretaskDraft,
} from './index.js';

export interface PluginClientApi {
  pluginId: string;
  ctx: PretaskContext;
  /** entry-form 页面才有。 */
  entry?: EntryView;
  rpc<T = any>(method: string, params?: unknown): Promise<T>;
  /** 请求宿主 HTTP（只允许 /api/ 路径）；缺上下文时用它自行构造内容。 */
  host: {
    get<T = any>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<T>;
  };
  draft(entryId: string, values: Record<string, string>): Promise<PretaskDraft>;
  /**
   * 创建真实任务并打开编辑页（不再有内存草稿）。
   * status 默认 'pending'（中间页/面板完成即进队列）；传 'plan' 保留草稿态。
   * opts.project / opts.board：组场景下插件自选仓库时覆盖落点归属（缺省用 ctx）。
   */
  createDraft(
    draft: PretaskDraft,
    opts?: { submit?: boolean; project?: string; board?: string; status?: 'pending' | 'plan' },
  ): Promise<{ id: number; key?: string } | null>;
  navigate(hash: string): void;
  closePage(): void;
  toast(msg: string): void;
  /** 用宿主图标集渲染图标（插件页面标题等处复用，保持与侧栏 / dock 同一套图形）。 */
  renderIcon?: (name: string, size?: number) => ReactNode;
}

export interface PluginSidebarEntry {
  id: string;
  label: string;
  /** 覆盖插件级 icon；缺省用 PluginUiDefinition.icon。 */
  icon?: string;
  order?: number;
  /** 指向 pages 的 key。 */
  page: string;
}

export interface PluginUiDefinition {
  api: '^1' | string;
  /** 插件图标资产名（宿主 svghub）；侧栏条目缺省继承它。 */
  icon?: string;
  components: Record<string, ComponentType<any>>;
  pages?: Record<string, { title: string }>;
  sidebar?: PluginSidebarEntry[];
}

export interface PluginHostGlobal {
  api: string;
  registerPlugin(id: string, def: PluginUiDefinition): void;
}

declare global {
  interface Window {
    NxkvPluginHost?: PluginHostGlobal;
    NxkvReact?: unknown;
    NxkvReactDOM?: unknown;
    NxkvJsxRuntime?: unknown;
  }
}
