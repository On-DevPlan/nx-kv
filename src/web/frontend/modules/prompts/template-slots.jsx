// 模板槽位编辑器（共享件）——模板正文里的 {{槽位名}} 处填文字。
//
// 为什么单独一件：模板的**骨架**（章节结构）对内置模板是锁死的，用户要改的
// 永远只是「背景/验收里写什么」。设置面板的「提示词 / 模板」一栏与模板页
// 都要编辑同一批槽位——两处各写一份必然漂移，所以抽到这里。
//
// 槽位从正文里扫出来（不另存一份清单）：用户改完正文，槽位自动跟着变。
import { useMemo, useState } from 'react';
import { slotsOf } from './placeholders.js';
import './style.css';

/**
 * 槽位编辑组（草稿 + 显式保存——每次按键都存会把接口刷爆）。
 * @param {object} p
 * @param {string} p.body 模板正文（槽位从它扫出来）
 * @param {object} p.values 当前槽位值
 * @param {Function} p.onSave (nextValues) => void
 * @param {boolean} [p.disabled]
 */
export function TemplateSlotsEditor({ body, values, onSave, disabled = false }) {
  const slots = useMemo(() => slotsOf(body), [body]);
  const [draft, setDraft] = useState(() => ({ ...(values || {}) }));
  const [dirty, setDirty] = useState(false);
  // 外部值变化（保存后 / 切模板）时同步本地草稿
  const key = slots.join('|') + '::' + JSON.stringify(values || {});
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setDraft({ ...(values || {}) });
    setDirty(false);
  }

  if (!slots.length) {
    return (
      <div className="pp-slots-empty">
        这个模板正文里没有 <span className="mono">{'{{槽位}}'}</span> —— 直接编辑正文即可。
      </div>
    );
  }

  const set = (name, v) => {
    setDraft((d) => ({ ...d, [name]: v }));
    setDirty(true);
  };

  return (
    <div className="pp-slots">
      {slots.map((name) => (
        <label key={name} className="pp-slots-row">
          <span className="pp-slots-name mono">{`{{${name}}}`}</span>
          <input
            className="pp-slots-input"
            value={draft[name] ?? ''}
            disabled={disabled}
            placeholder="这一处填什么（留空 = 留白）"
            onChange={(e) => set(name, e.target.value)}
          />
        </label>
      ))}
      <div className="pp-slots-acts">
        <button
          type="button"
          className="btn sm"
          disabled={disabled || !dirty}
          onClick={() => {
            onSave?.(draft);
            setDirty(false);
          }}
        >
          保存槽位
        </button>
        <button
          type="button"
          className="btn ghost sm"
          disabled={disabled || !dirty}
          onClick={() => {
            setDraft({ ...(values || {}) });
            setDirty(false);
          }}
        >
          撤销改动
        </button>
      </div>
    </div>
  );
}
