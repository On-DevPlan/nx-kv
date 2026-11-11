// 旁路面板头：原文查看时显示「关闭」按钮。
interface BesideHeaderProps {
  onClose: () => void;
}

export function BesideHeader({ onClose }: BesideHeaderProps) {
  return (
    <div className="mdw-beside-h">
      <span className="mdw-beside-lab">原文（旁路）</span>
      <span className="grow" />
      <button
        type="button"
        className="iconbtn"
        title="关闭原文面板"
        aria-label="关闭原文面板"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
