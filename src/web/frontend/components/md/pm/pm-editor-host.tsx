// 文档正文编辑器宿主：PM 内核试点开关的唯一决策点（#274 M1）。
//
// 决策口径：**默认仍是旧双态编辑器（MdPanes）**；URL 带 ?kernel=pm 且文档可写时
// 切到单一实时文档编辑器（PmEditor）。开关判定放在这里而不是页面里——
// 页面只管传参，M4 全量切换时改一处即可（把 pmKernelEnabled() 的返回值反过来
// 或换成 settings 项）。
//
// 两个编辑器的对外契约完全一致（title/body 双向、EditorApi 命令面同形），
// 所以切换对页面其余部分透明。
import type { RefObject } from 'react';
import { MdPanes } from '../panes/md-panes.jsx';
import type { MdPanesProps } from '../panes/md-panes-root.jsx';
import type { EditorApi } from '../panes/md-panes-helpers.js';
import PmEditor, { pmKernelEnabled } from './pm-editor.jsx';

export interface PmEditorHostProps extends MdPanesProps {
  /** 文档是否可写（只读文档一律走旧渲染视图，不进 PM 编辑器）。 */
  writable: boolean;
}

export default function PmEditorHost({ writable, ...rest }: PmEditorHostProps) {
  if (pmKernelEnabled() && writable) {
    return (
      <PmEditor
        title={rest.title || ''}
        body={rest.body || ''}
        onTitle={rest.onTitle}
        onBody={rest.onBody}
        editorApiRef={rest.editorApiRef as RefObject<EditorApi | null> | null | undefined}
        docKey={rest.docKey}
      />
    );
  }
  return <MdPanes {...rest} />;
}
