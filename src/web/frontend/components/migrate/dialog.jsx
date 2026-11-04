// 迁移确认对话框（原型 §5 第 2 步）：写清映射 + 同内容消歧。
// 拖拽路径不弹此框——落点列描边即确认；菜单/批量迁移才走这里。
// 外壳走 popup/Modal（全站统一模态），本文件只管迁移语义的内容。
import { useRef, useState } from 'react';
import { Icon } from '../icons.jsx';
import { Modal } from '../popup/index.jsx';

/**
 * @param {Object} move   {from:'local'|'cloud', dirName, topic, text}
 * @param {Array}  dups   目标端同内容条目（open 桶内 text 相同的）
 * @param {Function} onConfirm ({merge:boolean}) => Promise
 * @param {Function} onClose
 */
export function MoveDialog({ move, dups = [], onConfirm, onClose }) {
  const [merge, setMerge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const firstRef = useRef(null);

  const confirm = async () => {
    setBusy(true);
    setErr('');
    try {
      await onConfirm({ merge });
      onClose();
    } catch (e) {
      setErr(String(e.message || e));
      setBusy(false);
    }
  };

  const toCloud = move.from === 'local';
  return (
    <Modal
      title="迁移确认"
      onClose={busy ? undefined : onClose}
      busy={busy}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn" onClick={confirm} disabled={busy} ref={firstRef}>
            <Icon name={toCloud ? 'cloud' : 'monitor'} size={13} />
            {busy ? '迁移中…' : '迁移'}
          </button>
        </>
      )}
    >
      <div className="mx">
        <div className="mx-box">
          <div className="k">{toCloud ? '本机队列（迁出）' : '云端待办（迁出）'}</div>
          <div className="v">{move.text}</div>
        </div>
        <span className="mx-arrow">→</span>
        <div className="mx-box">
          <div className="k">{toCloud ? '云端待办（写入）' : '本机待领取（首位插入）'}</div>
          <div className="v mono">
            {toCloud
              ? `topic=${move.topic} · bucket=open${move.fromLocal ? ' · from=local' : ''}`
              : `目录「${move.dirName}」· 带「来自云端」标记`}
          </div>
        </div>
      </div>

      {dups.length > 0 && (
        <div className="mx-dup">
          目标端已有 {dups.length} 条同内容（清单允许同内容并存）：
          <ul>
            {dups.slice(0, 4).map((d, i) => (
              <li key={i} className="mono">#{d.id} · {d.createdAt || ''}{d.from ? ' · 来自本机' : ''}</li>
            ))}
            {dups.length > 4 && <li>…共 {dups.length} 条</li>}
          </ul>
          {toCloud && (
            <label>
              <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
              合并到已有条目（不新增一条；撤销时只清迁出标记）
            </label>
          )}
          {!toCloud && <div>迁移到本机会追加一条（带「来自云端」标记），不会吞掉已有条目。</div>}
        </div>
      )}

      {err && <div className="mx-dup" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{err}</div>}
      <div className="muted" style={{ fontSize: 11.5 }}>
        原子性：先写目标端，成功才改源端；失败时源任务原地不动、不产生迁出记录。
        对应 CLI：<code>nx-kv task move</code>
      </div>
    </Modal>
  );
}
