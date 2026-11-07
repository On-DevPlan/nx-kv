// 已删除任务面板（软删回收站）：列出本目录带 deletedAt 的任务，
// 每行可「恢复」（POST /api/localtasks/tasks/restore）或「彻底删除」
// （DELETE /api/localtasks/item + purge，不可恢复）。
// 数据来自 topic.tasks——软删的行仍在队列里，只是被看板/列表过滤掉了，
// 所以这里不需要单独的数据接口，容器把过滤出来的子集传进来即可。
import { Modal } from '../../components/popup/index.jsx';
import { titleFromMd } from '../../modules/md/md-parse.js';

function shortTime(v) {
  const s = String(v || '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${m[1].slice(5)} ${m[2]}` : s.slice(0, 16);
}

/**
 * @param {object} p
 * @param {object[]} p.tasks    本目录已软删的任务（删除时间倒序，由容器排好）
 * @param {Function} p.onClose
 * @param {Function} p.onRestore (t) => void 恢复一条（容器负责请求与刷新）
 * @param {Function} p.onPurge   (t) => void 彻底删除一条（容器负责确认、请求与刷新）
 */
export default function DeletedPanel({ tasks = [], onClose, onRestore, onPurge }) {
  return (
    <Modal title={`已删除任务（${tasks.length}）`} onClose={onClose}>
      {tasks.length === 0 ? (
        <div className="mdw-del-empty">这个目录没有已删除的任务。</div>
      ) : (
        <table className="mdw-del-list">
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className="mdw-del-id mono">#{t.id}</td>
                <td className="mdw-del-title" title={titleFromMd(t.text)}>
                  {titleFromMd(t.text) || '—'}
                </td>
                <td className="mdw-del-time mono">{shortTime(t.deletedAt)}</td>
                <td className="mdw-del-ops">
                  <button
                    type="button"
                    className="btn sm ghost"
                    title="恢复到队列原位置"
                    onClick={() => onRestore?.(t)}
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    className="btn sm danger"
                    title="彻底删除（不可恢复）"
                    onClick={() => onPurge?.(t)}
                  >
                    彻底删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
