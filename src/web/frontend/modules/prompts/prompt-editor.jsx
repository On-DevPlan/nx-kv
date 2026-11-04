// 提示词编辑器（共享件）——回调提示词 / ack 提示词 / 持续 get 模板 / 任何
// 「多条文本 + 占位符」的设置项都走这里，交互一致。
//
// 为什么抽出来：这三处原先各抄一份「多行文本框 + 序号 + 删除」，占位符怎么
// 插、怎么提示又各写各的——用户在设置面板里遇到三套长得不一样的编辑器。
// 现在只有一份实现：文本框 + 「插入占位符」菜单 + 可选的说明行。
import { useRef, useState } from 'react';
import { PLACEHOLDER_GROUPS, SECTION_TOKENS, insertToken, usedPlaceholders } from './placeholders.js';
import './style.css';

/**
 * 单条提示词文本框 + 占位符菜单。
 * @param {object} p
 * @param {string} p.value
 * @param {Function} p.onChange
 * @param {string} [p.placeholder]
 * @param {number} [p.rows]
 * @param {boolean} [p.sections] 是否也提供段落标记（{{#goal}}…）
 * @param {string} [p.hint] 文本框下方的说明行
 */
export function PromptField({ value, onChange, placeholder, rows = 3, sections = false, hint = '' }) {
  const [open, setOpen] = useState(false);
  const taRef = useRef(null);
  const wrapRef = useRef(null);

  const insert = (token) => {
    const ta = taRef.current;
    const caret = ta ? ta.selectionStart : null;
    const next = insertToken(value, token, caret);
    onChange(next.text);
    setOpen(false);
    // 插完把光标停在标记后面（等 React 重渲染后再设）
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      try { el.setSelectionRange(next.caret, next.caret); } catch { /* ignore */ }
    });
  };

  const used = usedPlaceholders(value);

  return (
    <div className="pp-field" ref={wrapRef}>
      <textarea
        ref={taRef}
        className="pp-field-ta mono"
        rows={rows}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          // 点菜单项时 textarea 会失焦——延迟关菜单，别把刚点的插入吃掉
          requestAnimationFrame(() => {
            if (wrapRef.current && wrapRef.current.contains(document.activeElement)) return;
            setOpen(false);
          });
        }}
      />
      <div className="pp-field-bar">
        <button
          type="button"
          className={'pp-field-ph-btn' + (open ? ' on' : '')}
          title="插入占位符"
          onClick={() => setOpen((v) => !v)}
        >
          {'{'}占位符{'}'}
        </button>
        {used.length > 0 && (
          <span className="pp-field-used" title="本条用到的占位符">
            {used.map((u) => (
              <span key={u} className="pp-field-used-chip mono">{`{{${u}}}`}</span>
            ))}
          </span>
        )}
        {open && (
          <div className="pp-field-menu" role="menu">
            {PLACEHOLDER_GROUPS.map((g) => (
              <div key={g.label} className="pp-field-menu-sec">
                <div className="pp-field-menu-lab">{g.label}</div>
                {g.items.map((it) => (
                  <button
                    key={it.token}
                    type="button"
                    className="pp-field-menu-item"
                    title={it.desc}
                    onMouseDown={(e) => {
                      e.preventDefault(); // 别让 textarea 失焦丢光标
                      insert(`{{${it.token}}}`);
                    }}
                  >
                    <span className="mono">{`{{${it.token}}}`}</span>
                    <span className="pp-field-menu-desc">{it.desc}</span>
                  </button>
                ))}
              </div>
            ))}
            {sections && (
              <div className="pp-field-menu-sec">
                <div className="pp-field-menu-lab">段落</div>
                {SECTION_TOKENS.map((it) => (
                  <button
                    key={it.token}
                    type="button"
                    className="pp-field-menu-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insert(it.token);
                    }}
                  >
                    <span className="mono">{it.token}</span>
                    <span className="pp-field-menu-desc">{it.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {hint ? <div className="pp-field-hint">{hint}</div> : null}
    </div>
  );
}

/**
 * 多条提示词（每条一个 PromptField + 序号 + 删除）。
 * 「添加一条…」与保存按钮由调用方排布——不同设置项的保存语义不一样。
 *
 * accordion 模式（#41）：条目默认**收起成一行标题**（首行截断 + 字数），
 * 点击才展开编辑（单开——点另一条收起上一条）；「点击具体 item 才显示详细内容」。
 * openIndex/onOpenChange 可选受控——调用方「添加一条」后能直接展开新条目。
 */
export function PromptItemsEditor({
  items,
  onChange,
  disabled = false,
  placeholder,
  rows = 3,
  sections = false,
  hint = '',
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
                sections={sections}
                hint={hint}
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
        const firstLine = String(t).split('\n')[0].trim();
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
                    sections={sections}
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
