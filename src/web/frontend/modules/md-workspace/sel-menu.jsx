/** 预览划选浮层：问题 / 追加 / 复制 */
export default function SelMenu({ at, onIssue, onAppend, onCopy }) {
  if (!at) return null;
  return (
    <div
      id="mdw-sel-menu"
      className="mdw-sel-menu open"
      style={{ left: at.x, top: at.y }}
      role="menu"
    >
      <div className="cap">预览选区</div>
      <button type="button" onClick={onIssue}>此区域有问题 → 新 MD</button>
      <button type="button" onClick={onAppend}>追加任务 MD</button>
      <div className="sep" />
      <button type="button" onClick={onCopy}>复制选区</button>
    </div>
  );
}
