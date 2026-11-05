// 设置面板「侧栏显示」一栏：编排侧边栏**显示哪些**项目组 / 项目（任务 #61 反馈③）。
//
// 模块化的口径：**仓库是独立的模块**，项目组 / 项目只是指向仓库的指针。
// 所以侧栏里两件事分开管：
//   - 项目组行 = 指针（聚合入口），**不铺成员**——组行下面不列它指向的仓库；
//   - 仓库行 = 模块（每个仓库一行，**永远不因为被组链接就消失**）。
//
// 这一栏就是「菜单的显示设置」：勾掉哪个，侧栏就不显示哪个（不删登记、不改数据）。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { loadPrefs, updatePrefs } from '../../prefs.js';

export default function SidebarSection() {
  const toast = useToast();
  const [repos, setRepos] = useState([]);
  const [boards, setBoards] = useState([]);
  const [hidden, setHidden] = useState([]);

  const load = useCallback(() => {
    Promise.all([api('/api/repos'), api('/api/boards')])
      .then(([r, b]) => {
        setRepos(Array.isArray(r) ? r : r?.repos || []);
        setBoards(Array.isArray(b) ? b : b?.boards || []);
        setHidden(loadPrefs().hidden || []);
      })
      .catch((e) => toast('读取失败：' + (e.message || e)));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (key) => {
    const cur = loadPrefs().hidden || [];
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    updatePrefs({ hidden: next });
    setHidden(next);
  };

  const line = (kind, key, name, extra) => (
    <div className="setp-row" key={kind + ':' + key}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={!hidden.includes(key)} onChange={() => toggle(key)} />
        <span>{name}</span>
        {extra ? <span className="mono faint">{extra}</span> : null}
      </label>
    </div>
  );

  return (
    <div className="setp-side">
      <div className="setp-note">
        勾掉的项目组 / 项目不在侧边栏显示（登记与数据都留着，随时勾回来）。
      </div>
      <div className="setp-row">
        <span>项目组（指针）</span>
      </div>
      {boards.map((b) => line('board', b.key || b.id, b.name, `${(b.repos || []).length} 个模块`))}
      {!boards.length && <div className="setp-note">还没有项目组。</div>}
      <div className="setp-row">
        <span>项目 / 仓库（模块）</span>
      </div>
      {repos.map((r) => line('repo', r.key || r.id, r.name, r.path))}
      {!repos.length && <div className="setp-note">还没有登记仓库。</div>}
    </div>
  );
}
