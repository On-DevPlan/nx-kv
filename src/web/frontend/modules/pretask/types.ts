// pretask 入口的宿主侧类型（/api/pretask/entries 响应；与 SDK EntryView 对齐）。
import type { PretaskContext } from '@nx-kv/plugin-sdk';

export interface PretaskSlot {
  key: string;
  label: string;
  type: 'text';
  required?: boolean;
  hint?: string;
  default?: string;
}

export interface PretaskEntry {
  id: string;
  pluginId: string;
  pluginName?: string;
  label: string;
  description?: string;
  icon?: string;
  kind: 'draft' | 'panel';
  order: number;
  default?: boolean;
  builtin?: boolean;
  slots?: PretaskSlot[];
  previewBody?: string;
  values?: Record<string, string>;
  ui?: { row?: string; form?: string; panel?: string };
  panel?: { title?: string };
  visible?: boolean;
  sortOrder?: number;
}

export interface PretaskEntriesResult {
  entries: PretaskEntry[];
  defaultEntryId: string;
  warnings: string[];
}

export interface PretaskScope {
  topic?: string;
  group?: string;
  repo?: string;
}

export type { PretaskContext };
