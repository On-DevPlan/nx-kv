// 读不到文档的兜底展示：「还在读」与「确实没有这一条」。
export function NotFoundView({ task, app, groupAnchored, groupId, isGlobal, dirKey }) {
  return (
    <div className="mdw">
      <div className="pad stack">
        <div><strong>找不到任务 #{task}</strong></div>
        <div className="hint">它可能已被删除（软删除可用 nx-kv localtask task restore 恢复），或这个深链写错了。</div>
        <div>
          <button
            className="btn ghost sm"
            onClick={() => app.onNavigate && app.onNavigate(
              groupAnchored
                ? '#/group/' + encodeURIComponent(groupId || '')
                : isGlobal ? '#/global' : '#/dir/' + encodeURIComponent(dirKey || '')
            )}
          >
            回到目录
          </button>
        </div>
      </div>
    </div>
  );
}
