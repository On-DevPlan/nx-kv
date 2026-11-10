// 开发仓库主表：一行一个开发仓库（RepoRow）+ 行内小组件。
//
// **文档列是这行的核心内容**：一个「查看详情」入口开 DocsModal——完整文档集
// （主篇 + 补充 + reference + 组内描述）就地看、就地编辑；行内不再铺 chip 外显。
// 所属分组 chips 点一下 = 筛到那个组（再点取消）；归属的增删走「成员管理」弹窗。
// 主表只放开发仓库（type=dev）——参考仓库有自己的大面板，两份名单不混。
// 「参考」列显示**绑定到这个开发仓库**的参考仓库（多对多：一个 dev 可挂多个 ref）。
import { useMemo } from 'react';
import { Copyable } from '../../components/ui.jsx';
import { Button } from '../../components/button/index.jsx';
import ToolActsBar from '../../components/tool-acts/bar.jsx';

// 路径照搬目录看板的「可扫标签」画法：祖先目录变暗、末段略重，点击复制全文。
// 纯灰一长串（旧画法）里，人眼要逐字符对比才能找到目录名。
function RepoPath({ path }) {
  const s = String(path || '');
  const cut = s.replace(/\\/g, '/').lastIndexOf('/');
  if (cut < 0) return <Copyable text={s}>{s}</Copyable>;
  return (
    <Copyable text={s} title="点击复制完整路径">
      <span className="anc">{s.slice(0, cut)}</span>
      {s.slice(cut)}
    </Copyable>
  );
}

// 文档列入口（查看详情）：一行主篇摘要 + 数量，点击打开 DocsModal——
// 完整文档列表（主篇 / 补充 / reference / 组内）+ 复用编辑器就地编辑。
// 文档不再以 chip/tag 形式外显在行内（任务「简介文档优化」）；未写的主篇
// 显示「＋ 写项目介绍」虚态，点开同样进弹窗创建。
// 参考仓库面板的名单元格也复用它，所以具名导出。
export function DocsEntry({ docs, onOpen }) {
  const main = docs && docs.main;
  const links = (docs && docs.links) || [];
  const total = (main ? 1 : 0) + links.length;
  return (
    <button
      type="button"
      className="rp-docs-entry"
      title="查看完整文档列表（主篇 / 补充 / reference / 组内），可就地编辑"
      onClick={onOpen}
    >
      <span className={'rp-docs-entry-main' + (main && main.exists ? '' : ' ghost')}>
        {main && main.exists ? (main.summary || main.title) : '＋ 写项目介绍'}
      </span>
      <span className="rp-docs-entry-n">{total > 0 ? `${total} 篇 · 查看详情` : '查看详情'}</span>
    </button>
  );
}

// 仓库行 = 仓库信息（名称 + 路径）+ 文档入口（核心）+ 参考仓库 + 所属分组 + 操作。
function RepoRow({ r, filterBoard, refsOfRepo, acts }) {
  const refs = refsOfRepo.get(r.key) || [];
  return (
    <tr id={'rp-row-' + r.key}>
      <td className="rp-name">
        <strong>
          {r.icon ? <span className="rp-icon" aria-hidden>{r.icon}</span> : null}
          {r.name}
          {/* #145：持续 get 已开启 → 行名绿点（一眼可见；配置在行内「更多 → 持续 get」） */}
          {r.getLoop && r.getLoop.enabled ? (
            <span
              className="rp-gl-dot"
              title={`持续 get 已开启（${Number(r.getLoop.waitMinutes) || 10} 分钟阻塞窗口）`}
              aria-label="持续 get 已开启"
            />
          ) : null}
        </strong>
        <span className="mono rp-name-path"><RepoPath path={r.path} /></span>
      </td>
      {/* 文档列 = 这个仓库全部文档的入口：查看详情 → DocsModal（含组内描述） */}
      <td className="rp-cell-docs">
        <DocsEntry docs={r.descDocs} onOpen={() => acts.docs(r)} />
      </td>
      <td className="rp-refs">
        {refs.length ? refs.map((ref) => (
          <button key={ref.key} className="rp-ref-chip" title={`直接绑定：${ref.remote || ''}${ref.note ? '\n' + ref.note : ''}\n点击改绑定描述`}
            onClick={() => acts.refNote(ref, r)}>
            {ref.note ? <span className="rp-ref-chip-dot" /> : null}
            {ref.name}
          </button>
        )) : <span className="muted rp-refs-none">—</span>}
        <Button small className="rp-ref-bind" title="管理这个仓库绑定的参考仓库" onClick={() => acts.bind(r)}>绑定</Button>
      </td>
      <td className="rp-cell-groups">
        {(r.boards || []).length ? r.boards.map((b) => (
          <button
            key={b.id}
            className={'rp-group-chip' + (filterBoard && filterBoard.id === b.id ? ' on' : '')}
            title={`只看「${b.name}」${b.note ? `\n组内描述：${b.note}` : ''}`}
            onClick={() => acts.filter(b.id)}
          >
            {b.name}
          </button>
        )) : <span className="muted rp-refs-none">—</span>}
      </td>
      <td className="rp-acts">
        {/* #148：行内动作编排化（kind=repos-row，同一套工具区组件）——默认与旧版
            同构（编辑/打开/删除上栏，更多收纳 持续 get/对齐 remote）；每个动作都
            可在「更多 → 自定义工具栏…」里调顺序 / 上栏 / 收纳。 */}
        <ToolActsBar
          kind="repos-row"
          renderers={{
            edit: () => <Button small onClick={() => acts.edit(r)}>编辑</Button>,
            open: () => <Button small title="在文件管理器中打开" onClick={() => acts.open(r)}>打开</Button>,
            del: () => <Button small danger onClick={() => acts.del(r)}>删除</Button>,
            getloop: () => (
              <Button small title="持续 get（waitgoal）配置" onClick={() => acts.getloop(r)}>
                <span className="rp-gl-menu-it">
                  {r.getLoop && r.getLoop.enabled ? <span className="rp-gl-dot" aria-hidden /> : null}
                  持续 get…
                </span>
              </Button>
            ),
            remote: () => <Button small onClick={() => acts.remote(r)}>对齐 remote</Button>,
          }}
          actions={{
            edit: () => acts.edit(r),
            open: () => acts.open(r),
            del: () => acts.del(r),
            getloop: () => acts.getloop(r),
            remote: () => acts.remote(r),
          }}
          titles={{
            getloop: '持续 get（waitgoal）配置',
            remote: 'key 与远程 git 地址对齐',
            del: '删除仓库登记（磁盘文件不受影响）',
          }}
        />
      </td>
    </tr>
  );
}

export default function RepoTable({ shown, devRepos, refRepos, filterBoard, acts, onAddMember }) {
  // 直接绑定到各开发仓库的参考（dev 行内「参考」列的数据面）。
  // 绑定是双向记录的：dev 侧自带 {kind:'ref'} 反向引用，直接读它即可；
  // 老数据（只有 ref 侧）再回退扫一遍 ref 全表。
  const refsOfRepo = useMemo(() => {
    const m = new Map();
    // 索引按 **key**（关系的身份）：dev 仓库的 key → 挂在它身上的参考仓库列表
    const add = (devKey, r, note) => {
      if (!m.has(devKey)) m.set(devKey, []);
      m.get(devKey).push({ key: r.key, id: r.id, name: r.name, remote: r.remote || '', note: note || '' });
    };
    const byKey = new Map(refRepos.map((r) => [r.key, r]));
    const seen = new Set();
    for (const d of devRepos) {
      for (const l of d.linked || []) {
        if (l.kind !== 'ref') continue;
        const r = byKey.get(l.id);
        if (!r) continue;
        seen.add(d.key + ':' + r.key);
        add(d.key, r, l.note);
      }
    }
    for (const r of refRepos) {
      for (const l of r.linked || []) {
        if (l.kind !== 'repo') continue;
        if (seen.has(l.id + ':' + r.key)) continue;
        add(l.id, r, l.note);
      }
    }
    return m;
  }, [devRepos, refRepos]);

  return (
    <div className="rp-table-wrap" id="rp-repos">
      <table className="rp-table">
        <thead>
          <tr>
            {/* #152/#154：列宽重排——操作列钉在 250px（其余列百分比合计 ≈ 100%-250px，
                让余量进文档列而不是把操作列撑宽）。 */}
            <th scope="col" style={{ width: '16%' }}>仓库</th>
            <th scope="col" style={{ width: '36%' }}>
              文档
              <span className="rp-th-hint">主篇摘要 · 查看详情打开完整文档列表</span>
            </th>
            <th scope="col" style={{ width: '18%' }}>参考仓库</th>
            <th scope="col" style={{ width: '14%' }}>分组</th>
            <th scope="col" style={{ width: '250px' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <RepoRow key={r.id} r={r} filterBoard={filterBoard} refsOfRepo={refsOfRepo} acts={acts} />
          ))}
          {!shown.length ? (
            <tr>
              <td colSpan="5" className="muted rp-empty">
                {devRepos.length ? (
                  <>
                    这个分组还没有成员{' '}
                    {filterBoard ? (
                      <Button small onClick={() => onAddMember(filterBoard.id)}>添加成员</Button>
                    ) : null}
                  </>
                ) : (
                  '还没有登记开发仓库 —— 点右上「登记仓库」加一条。'
                )}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
