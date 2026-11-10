// 源码编辑器底栏：光标位置 / 统计 / 行号·参考线·查找·换行开关。
export function StatusBar({
  caret, stats, showLines, showRuler, findOpen, wrap,
  onToggleLines, onToggleRuler, onToggleFind, onToggleWrap,
}) {
  return (
    <div className="mdw-editor-status" role="status">
      <span>Ln {caret.line}, Col {caret.col}</span>
      <span>{stats.lines} 行</span>
      <span>{stats.words} 词</span>
      <span>{stats.chars} 字</span>
      <button
        type="button"
        className={`mdw-wrap-toggle${showLines ? ' on' : ''}`}
        title="显示/隐藏行号"
        onClick={onToggleLines}
      >
        行号
      </button>
      <button
        type="button"
        className={`mdw-wrap-toggle${showRuler ? ' on' : ''}`}
        title="80 字符参考线"
        onClick={onToggleRuler}
      >
        参考线
      </button>
      <button
        type="button"
        className={`mdw-wrap-toggle${findOpen ? ' on' : ''}`}
        title="查找 Ctrl/⌘F"
        onClick={onToggleFind}
      >
        查找
      </button>
      <button
        type="button"
        className={`mdw-wrap-toggle${wrap ? ' on' : ''}`}
        title={wrap ? '自动换行开（点击关闭）' : '自动换行关（点击开启）'}
        onClick={onToggleWrap}
      >
        {wrap ? '换行' : '不换行'}
      </button>
    </div>
  );
}
