// 提示词编辑器（共享件）——回调提示词 / ack 提示词 / 持续 get 模板等
// 「多条文本」的设置项走这里，交互一致：多行文本框 + 序号 + 删除。
//
// UI 边界：设置页只做「写模板」本身。占位符 / 语法 / 变量字典的说明放在
// skill 与 docs，不在面板里堆菜单与示例。
import { useState } from 'react';
import './style.css';

/**
 * 条目的**可读标题**：把原始模板标记洗掉再截断。
 * 收起行直接甩「{{#goal}}〔…〕{{/goal}}规划计划…」给用户看，又长又像日志。
 */
export function promptTitle(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return '';
  const cleaned = raw
    .replace(/\{\{#[^}]*\}\}/g, '')      // 段落开标记
    .replace(/\{\{\/[^}]*\}\}/g, '')    // 段落闭标记
    .replace(/\{\{[^}]*\}\}/g, '')        // 取值标记
    .replace(/「\s*」/g, '')               // 剥完占位符留下的空引号对
    .replace(/〔\s*〕/g, '')               // 同上（方括号形态）
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || raw.replace(/\s+/g, ' ').trim();
}

/**
 * 单条提示词文本框。
 * @param {object} p
 * @param {string} p.value
 * @param {Function} p.onChange
 * @param {string} [p.placeholder]
 * @param {number} [p.rows]
 * @param {string} [p.hint] 文本框下方的说明行
 */
export function PromptField({ value, onChange, placeholder, rows = 3, hint = '' }) {
  return (
    <div className="pp-field">
      <textarea
        className="pp-field-ta mono"
        rows={rows}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <div className="pp-field-hint">{hint}</div> : null}
    </div>
  );
}

/**
 * 多条提示词（每条一个 PromptField + 序号 + 删除）。
 * 「添加一条…」与保存按钮由调用方排布——不同设置项的保存语义不一样。
 *
 * accordion 模式：条目默认收起成一行标题（首行截断 + 字数），点击才展开编辑
 * （单开——点另一条收起上一条）；openIndex/onOpenChange 可选受控。
 */
export function PromptItemsEditor({
  items,
  onChange,
  disabled = false,
  placeholder,
  rows = 3,
  accordion = false,
  openIndex: openIndexProp,
  onOpenChange,
}) {
  const [openIdxState, setOpenIdxState] = useState(-1);
  const openIdx = openIndexProp !== undefined ? openIndexProp : openIdxState;
  const setOpenIdx = (v) => {
    setOpenIdxState(v);
    onOpenChange && onOpenChange(v);
  };
  const editItem = (i, v) => onChange(items.map((x, j) => (j === i ? v : x)));
  const removeItem = (i) => {
    onChange(items.filter((_, j) => j !== i));
    setOpenIdx((cur) => (cur === i ? -1 : cur > i ? cur - 1 : cur));
  };
  if (!accordion) {
    return (
      <>
        {items.map((t, i) => (
          <div className="pp-items-item" key={i}>
            <span className="pp-items-no">{i + 1}</span>
            <div className="pp-items-body">
              <PromptField
                value={t}
                onChange={(v) => editItem(i, v)}
                placeholder={placeholder}
                rows={rows}
              />
            </div>
            <button
              type="button"
              className="btn ghost sm"
              disabled={disabled}
              onClick={() => removeItem(i)}
              title={`删除第 ${i + 1} 条`}
            >
              删除
            </button>
          </div>
        ))}
      </>
    );
  }
  return (
    <div className="pp-items">
      {items.map((t, i) => {
        const open = openIdx === i;
        const firstLine = promptTitle(t.split('\n')[0]);
        return (
          <div className="pp-items-item" key={i}>
            {open ? (
              <>
                <span className="pp-items-no">{i + 1}</span>
                <div className="pp-items-body">
                  <PromptField
                    value={t}
                    onChange={(v) => editItem(i, v)}
                    placeholder={placeholder}
                    rows={rows}
                  />
                </div>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={disabled}
                  onClick={() => removeItem(i)}
                  title={`删除第 ${i + 1} 条`}
                >
                  删除
                </button>
              </>
            ) : (
              <button
                type="button"
                className="pp-items-row"
                disabled={disabled}
                title="点击展开编辑"
                onClick={() => setOpenIdx(i)}
              >
                <span className="pp-items-no">{i + 1}</span>
                <span className="pp-items-title">{firstLine || '（空）'}</span>
                <span className="pp-items-len">{String(t).length} 字</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
