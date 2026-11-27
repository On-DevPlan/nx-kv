// nx-kv 插件 SDK：client 半侧契约（只给插件 UI 包用，宿主只提供实现）。
import type { ComponentType } from 'react';
import type { EntryView, PretaskContext, PretaskDraft } from './index.js';

export type {
  PluginContextView,
  PluginFileView,
  PluginRepoView,
  PluginTreeEntry,
  PluginTreeView,
  PluginTopicInfo,
} from './index.js';

export interface PluginClientApi {
  pluginId: string;
  ctx: PretaskContext;
  /** entry-form 页面才有。 */
  entry?: EntryView;
  rpc(method: string, params?: unknown): Promise<any>;
  /** 请求宿主 HTTP（只允许 /api/ 路径）；缺上下文时用它自行构造内容。 */
  host: {
    get<T = any>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<T>;
  };
  draft(entryId: string, values: Record<string, string>): Promise<PretaskDraft>;
  /**
   * 宿主写草稿并打开 task 编辑页。
   * opts.project / opts.board：组场景下插件自选仓库时覆盖落点归属（缺省用 ctx）。
   */
  createDraft(draft: PretaskDraft, opts?: { submit?: boolean; project?: string; board?: string }): void;
  navigate(hash: string): void;
  closePage(): void;
  toast(msg: string): void;
}

export interface PluginSidebarEntry {
  id: string;
  label: string;
  icon?: string;
  order?: number;
  /** 指向 pages 的 key。 */
  page: string;
}

export interface PluginUiDefinition {
  api: '^1' | string;
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
