// 下拉行（插件自带 UI）：模板名 + 说明 + 内置徽标。
//
// 「默认」不在下拉里标：默认入口是**主题级**配置（新建页行为页），
// 插件声明的 default 只是「未配置主题时的回落」，标在每一行会与主题配置矛盾。
import type { EntryView } from '@nx-kv/plugin-sdk';

export default function EntryRow({ entry }: { entry: EntryView }) {
  return (
    <span className="tpl-row">
      <span className="tpl-row-name">{entry.label}</span>
      {entry.builtin ? <span className="tpl-badge soft">内置</span> : null}
      {entry.description ? <span className="tpl-row-desc">{entry.description}</span> : null}
    </span>
  );
}
