// pretask 下拉菜单：按插件分组；行的 UI 可由插件自带（ui.row），否则用 label/icon。
import type { PopMenuItem } from '../../components/popup/index.js';
import { PluginComponent } from '../../plugin-host/plugin-component.jsx';
import type { PretaskEntry } from './types.js';

export function entryMenuItems(
  entries: readonly PretaskEntry[],
  onPick: (entry: PretaskEntry) => void,
): Array<PopMenuItem | string> {
  const groups = new Map<string, PretaskEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.pluginId) || [];
    list.push(entry);
    groups.set(entry.pluginId, list);
  }
  const items: Array<PopMenuItem | string> = [];
  for (const [pluginId, list] of groups) {
    if (items.length) items.push('sep');
    items.push({ kind: 'heading', label: list[0]?.pluginName || pluginId });
    for (const entry of list) {
      items.push({
        label: entry.ui?.row
          ? <PluginComponent pluginId={entry.pluginId} componentId={entry.ui.row} props={{ entry }} />
          : entry.label,
        icon: entry.icon || 'list',
        onClick: () => onPick(entry),
      });
    }
  }
  return items;
}
