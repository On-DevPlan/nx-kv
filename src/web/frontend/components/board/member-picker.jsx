// 成员选择器：项目组面板里的「添加成员」就地弹窗（组面板、仓库页共用）。
//
// 一份列表给两种条目：
//   项目行   —— 本机登记的开发仓库；按钮 = 加入 / 移出本组
//   项目组行 —— 别的项目组；按钮 = 并入（把这组的项目一并加进本组）
//
// **界面自己说明自己**：条目自带「属于哪些组 / 这组有多少成员 / 是不是本组成员」，
// 不写解释性段落（产品靠 UI 告知，不靠说明文字）。搜索框按名称 / 路径 / 描述 /
// 所属组名过滤两类条目——组名也能搜（搜「fr」能翻出 fr 组里的项目）。
//
// 归属是**复制**不是移动：一个项目可以同时在多个组里（仓库页的既有语义）。
// 所以「并入」= 把另一个组的项目加进本组，别的组不受影响。
import { useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../toast/index.jsx';
import { Modal } from '../popup/index.jsx';
import { Icon } from '../icons.jsx';

const hit = (q, ...texts) =>
  !q || texts.some((t) => String(t || '').toLowerCase().includes(q));

// 路径只留「父目录」——末段多半就是项目名，重复一遍是噪音；
// 父目录用来区分同名项目（同名时仍能一眼分清），完整路径放在 title 里。
const parentPath = (r) => {
  const p = String(r.path || '').replace(/[\\/]+$/, '');
  if (!p) return '';
  const segs = p.split(/[\\/]/);
  if (segs.length > 1 && segs[segs.length - 1].toLowerCase() === String(r.name || '').toLowerCase()) {
    segs.pop();
  }
  return segs.join('/');
};

/**
 * @param board   目标组（{id,name,desc,key,repos[]}）
 * @param boards  全部项目组
 * @param repos   全部登记仓库
 * @param onClose 关闭
 * @param onChanged 归属变更后回调（父级刷新数据）
 */
export default function MemberPicker({ board, boards = [], repos = [], onClose, onChanged }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [over, setOver] = useState({}); // key → true/false：本次会话里的归属改写（乐观更新）
  const [busy, setBusy] = useState(''); // 正在并入的组 id

  const members = useMemo(() => (board && board.repos) || [], [board]);
  const base = useMemo(() => new Set(members.map((m) => m.key)), [members]);
  const isMember = (key) => (key in over ? over[key] : base.has(key));

  // 本组之外的组 —— 可并入；本组自己不出现在列表里
  const otherBoards = useMemo(() => boards.filter((b) => b.id !== board.id), [boards, board.id]);

  // 本机登记的开发仓库（参考仓库不进组）
  const projects = useMemo(
    () => repos.filter((r) => (r.type || 'dev') !== 'ref'),
    [repos]
  );

  // 组里的占位成员（本机还没登记的）：占着位置，能一键克隆补齐
  const ghosts = useMemo(() => members.filter((m) => m.present === false), [members]);

  const query = String(q || '').trim().toLowerCase();

  const shownProjects = useMemo(
    () =>
      projects.filter((r) =>
        hit(
          query,
          r.name,
          r.path,
          r.desc,
          r.key,
          ...(r.boards || []).map((b) => b.name)
        )
      ),
    [projects, query]
  );

  const shownBoards = useMemo(
    () => otherBoards.filter((b) => hit(query, b.name, b.desc)),
    [otherBoards, query]
  );

  const shownGhosts = useMemo(
    () => ghosts.filter((m) => hit(query, m.name, m.key, m.remote)),
    [ghosts, query]
  );

  const setMember = async (key, add) => {
    setOver((o) => ({ ...o, [key]: add }));
    try {
      await api('/api/boards/assign', {
        method: 'POST',
        body: add ? { id: key, board: board.id } : { id: key, board: board.id, remove: true },
      });
      if (onChanged) onChanged();
    } catch (e) {
      setOver((o) => {
        const n = { ...o };
        delete n[key];
        return n;
      });
      toast(String((e && e.message) || e));
    }
  };

  // 并入另一个组：把这组里本机已登记的项目全加进本组（已在本组的不动）
  const mergeGroup = async (g) => {
    const keys = (g.repos || [])
      .filter((m) => m.present !== false)
      .map((m) => m.key)
      .filter((k) => !isMember(k));
    if (!keys.length) return;
    setBusy(g.id);
    try {
      for (const k of keys) {
        await api('/api/boards/assign', { method: 'POST', body: { id: k, board: board.id } });
      }
      setOver((o) => {
        const n = { ...o };
        for (const k of keys) n[k] = true;
        return n;
      });
      toast(`已并入 ${keys.length} 个成员`);
      if (onChanged) onChanged();
    } catch (e) {
      toast(String((e && e.message) || e));
    } finally {
      setBusy('');
    }
  };

  // 占位成员补齐：按 key 克隆（key 即身份，克隆完自动转正）
  const cloneGhost = async (m) => {
    setBusy(m.key);
    try {
      await api('/api/repos/clone', {
        method: 'POST',
        body: { remote: m.remote, key: m.key, type: m.type || 'dev', depth: 1 },
      });
      toast(`已克隆：${m.name || m.key}`);
      if (onChanged) onChanged();
    } catch (e) {
      toast(String((e && e.message) || e));
    } finally {
      setBusy('');
    }
  };

  const empty = !shownProjects.length && !shownBoards.length && !shownGhosts.length;

  return (
    <Modal title={`${board.name} · 成员`} onClose={onClose} size="lg" className="rp-mp-box">
      <div>
        <div className="rp-mp-search">
          <Icon name="search" size={13} />
          <input
            autoFocus
            value={q}
            placeholder="搜项目或项目组"
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="rp-mp-count">
            {shownProjects.length + shownGhosts.length} 个项目 · {shownBoards.length} 个组
          </span>
        </div>

          {empty ? <div className="rp-mp-empty">没有匹配项</div> : null}

          {/* 项目组：并入它的成员 */}
          {shownBoards.length ? (
            <div className="rp-mp-sec">
              <div className="rp-mp-sec-h">项目组 <b>{shownBoards.length}</b></div>
              {shownBoards.map((g) => {
                const total = (g.repos || []).length;
                const pending = (g.repos || []).filter((m) => m.present !== false && !isMember(m.key)).length;
                return (
                  <div className="rp-mp-row" key={g.id}>
                    <Icon name="folder" size={13} />
                    <span className="rp-mp-name">{g.name}</span>
                    <span className="rp-mp-sub">{g.desc || ''}</span>
                    <span className="rp-mp-meta">{total} 个成员</span>
                    {!total ? (
                      <span className="rp-mp-meta">空组</span>
                    ) : (
                      <button
                        className={'btn small' + (pending ? '' : ' ghost')}
                        disabled={!pending || busy === g.id}
                        title={pending ? `把「${g.name}」的 ${pending} 个项目加进本组` : '这个组的项目已在本组'}
                        onClick={() => mergeGroup(g)}
                      >
                        {pending ? `并入 ${pending}` : '已并入'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* 项目：加入 / 移出 */}
          {shownProjects.length || shownGhosts.length ? (
            <div className="rp-mp-sec">
              <div className="rp-mp-sec-h">项目 <b>{shownProjects.length + shownGhosts.length}</b></div>
              {shownGhosts.map((m) => (
                <div className="rp-mp-row rp-mp-ghost" key={'g:' + m.key}>
                  <Icon name="folder" size={13} />
                  <span className="rp-mp-name">{m.name || m.key}</span>
                  <span className="rp-mp-sub mono">{m.remote || m.key}</span>
                  <span className="rp-mp-meta">本机未登记</span>
                  {m.clonable ? (
                    <button
                      className="btn small ghost"
                      disabled={busy === m.key}
                      title="按这个 key 克隆到本地，补齐这个位置"
                      onClick={() => cloneGhost(m)}
                    >
                      克隆
                    </button>
                  ) : null}
                </div>
              ))}
              {shownProjects.map((r) => {
                const inGroup = isMember(r.key);
                const others = (r.boards || []).filter((b) => b.id !== board.id);
                return (
                  <div className={'rp-mp-row' + (inGroup ? ' on' : '')} key={r.key}>
                    <Icon name="folder" size={13} />
                    <span className="rp-mp-name">{r.name}</span>
                    <span className="rp-mp-sub mono" title={r.path}>{parentPath(r)}</span>
                    {others.length ? (
                      <span className="rp-mp-tags">
                        {others.map((b) => <span className="rp-mp-tag" key={b.id}>{b.name}</span>)}
                      </span>
                    ) : null}
                    <button
                      className={'btn small' + (inGroup ? ' ghost' : '')}
                      title={inGroup ? `从「${board.name}」移出` : `加入「${board.name}」`}
                      onClick={() => setMember(r.key, !inGroup)}
                    >
                      {inGroup ? '移出' : '加入'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
      </div>
    </Modal>
  );
}
