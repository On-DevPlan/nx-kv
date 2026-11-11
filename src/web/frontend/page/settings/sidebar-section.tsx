// 设置面板「侧栏显示」一栏：编排侧边栏**显示哪些**项目组 / 项目（任务 #61 反馈③）。
//
// 模块化的口径：**仓库是独立的模块**，项目组 / 项目只是指向仓库的指针。
// 所以侧栏里两件事分开管：
//   - 项目组行 = 指针（聚合入口），**不铺成员**——组行下面不列它指向的仓库；
//   - 仓库行 = 模块（每个仓库一行，**永远不因为被组链接就消失**）。
//
// 这一栏就是「菜单的显示设置」：勾掉哪个，侧栏就不显示哪个（不删登记、不改数据）。
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { loadReposAndBoards } from './api.js';
import { useToast } from '../../components/toast/index.jsx';
import { useApp } from '../../app-context.jsx';
import type { BoardRow, RepoRow } from '../../types.js';

export default function SidebarSection() {
  const toast = useToast();
  // 用 app 的 patchPrefs：**它会更新 React state**（侧栏拿的就是 state 里的
  // prefs），直接写 localStorage 的话侧栏不会重读——勾了也像没反应（#61 反馈）。
  const app = useApp();
  const patchPrefs = app.patchPrefs;
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);

  const load = useCallback(() => {
    loadReposAndBoards()
      .then(([r, b]) => {
        // 两个端点都可能回数组或包一层对象（外部数据边界）：按实际形状取，元素形状由调用处收口
        setRepos(Array.isArray(r) ? r : r?.repos || []);
        setBoards(Array.isArray(b) ? b : b?.boards || []);
        setHidden(app.prefs?.hidden || []);
      })
      .catch((e) => toast('读取失败：' + ((e as Error).message || e)));
  }, [toast, app.prefs]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (key: string) => {
    const cur = app.prefs?.hidden || [];
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    if (patchPrefs) patchPrefs({ hidden: next });
    setHidden(next);
  };

  const line = (kind: string, key: string, name: string, extra?: string): ReactElement => (
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
