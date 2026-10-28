// MD 工作台工具区：左模式/编辑工具，右动作按钮贴齐最右
import { Icon } from '../../web/frontend/components/icons.jsx';
import { ModeSeg } from './md-panes.jsx';

export default function ToolBar({
  mode,
  onMode,
  showMark,
  submitLabel,
  onImg,
  onAtt,
  onImport,
  onNew,
  onMark,
  onDraft,
  onSubmit,
  onProg,
  onOverview,
}) {
  const edit = mode !== 'preview';
  return (
    <div className="mdw-toolbar">
      <div className="mdw-toolbar-left">
        <ModeSeg mode={mode} onChange={onMode} />
        {edit && (
          <div className="mdw-tools" role="group" aria-label="编辑工具">
            <button type="button" className="iconbtn" title="插入图片" onClick={onImg}>
              <Icon name="pin" size={14} />
            </button>
            <button type="button" className="iconbtn" title="添加附件" onClick={onAtt}>
              <Icon name="list" size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="mdw-actions" role="group" aria-label="任务操作">
        <button type="button" className="btn ghost sm" onClick={onImport} title="导入 Markdown">
          导入
        </button>
        <button type="button" className="btn ghost sm" onClick={onNew} title="新建草稿">
          新任务
        </button>
        {showMark && (
          <button type="button" className="btn ghost sm" onClick={onMark}>标注</button>
        )}
        <button type="button" className="btn ghost sm" onClick={onDraft}>存草稿</button>
        <button type="button" className="btn sm primary" onClick={onSubmit}>{submitLabel}</button>
        <span className="sep" aria-hidden />
        <button type="button" className="btn ghost sm" onClick={onProg}>进程</button>
        <button type="button" className="btn ghost sm" onClick={onOverview}>总览</button>
      </div>
    </div>
  );
}
