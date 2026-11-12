// 开发仓库主表：一行一个开发仓库（RepoRow）+ 行内小组件。
//
// **文档列是这行的核心内容**：一个「查看详情」入口在右侧栏开文档列表——完整文档集
// （主篇 + 补充 + reference + 组内描述）就地看、就地编辑；行内不再铺 chip 外显。
// 所属分组 chips 点一下 = 筛到那个组（再点取消）；归属的增删走「成员管理」弹窗。
// 主表只放开发仓库（type=dev）——参考仓库有自己的大面板，两份名单不混。
// 「参考仓库」列只在全局（本地命名空间）视图出现，且**只显示这一行仓库自己直接
// 绑定的参考仓库**（仓库级 ext_linked）；组共享的参考仓库不算这一行的东西。
// 组筛选视图里这一列整列隐藏——组内参考仓库共享，统一在上方「组参考」区块看。
import { useState } from 'react';
import { Copyable } from '../../components/ui.jsx';
import { Button } from '../../components/button/index.jsx';
import { BindTags, ClampRow, type BindTagItem } from '../../components/bindings/bind-tags.js';
import ToolActsBar from '../../components/tool-acts/bar.jsx';
import type { RepoRow, BoardRow } from '../../types.js';

// ─── repos 域的共享形状 ───────────────────────────────────────────────
//
// 放在本文件（而不是 index）是因为它是**最底层**的一块：index 与 ref-panel 都
// import 它，它自己不 import 任何兄弟文件——类型从叶子往上传，就不会出现环。
// 这些字段是 /api/repos、/api/boards 的真实负载（外部数据边界），只在调用处
// 显式声明一次；多声明一个字段不等于抄 schema，只声明本域真正读的那几个。

/** 一篇文档的摘要（主篇 / 补充篇 / 组内描述）；exists=false 表示约定路径上还没落盘。 */
export interface DocBrief {
  rel?: string;
  path?: string;
  title?: string;
  summary?: string;
  note?: string;
  tag?: string;
  docId?: string;
  exists?: boolean;
}

/** 仓库的描述文档集（descDocs）：主篇 + 补充篇。 */
export interface RepoDocs {
  main?: DocBrief;
  links?: DocBrief[];
}

/** 仓库行上的分组引用（chip）：id = 看板 id；noteDocRel 是组内描述的文档路径。 */
export interface RepoBoardRef {
  id: string;
  key?: string;
  name: string;
  note?: string;
  noteDocRel?: string;
}

/** 仓库的绑定关系（linked）：kind='ref' 时 id = 参考仓库 key。 */
export interface RepoLink {
  id: string;
  kind?: string;
  note?: string;
}

/** 持续 get（waitgoal）配置：行名绿点与菜单态都读它。 */
export interface RepoGetLoop {
  enabled?: boolean;
  waitMinutes?: number;
}

/** /api/repos 的一行：共享 RepoRow（key/name 是身份），其余字段按需读。 */
export interface RepoRecord extends RepoRow {
  id: string;
  path?: string;
  desc?: string;
  notes?: string;
  remote?: string;
  icon?: string;
  keyCustom?: boolean;
  descDocs?: RepoDocs;
  boards?: RepoBoardRef[];
  linked?: RepoLink[];
  getLoop?: RepoGetLoop;
}

/** 看板成员（board.repos[]）：key = 仓库 key；present=false 是待初始化占位。 */
export interface BoardMember {
  key: string;
  id?: string;
  name?: string;
  path?: string;
  note?: string;
  remote?: string;
  desc?: string;
  noteDocPath?: string;
  noteDocRel?: string;
  present?: boolean;
}

/** 看板上的参考绑定（board.refs[]）：id = 参考仓库 key。 */
export interface BoardRefLink {
  id: string;
  note?: string;
}

/** /api/boards 的一行（看板 / 项目组）。 */
export interface BoardRecord extends BoardRow {
  desc?: string;
  docRel?: string;
  docPath?: string;
  doc?: { rel?: string };
  docLinks?: DocBrief[];
  repos?: BoardMember[];
  refs?: BoardRefLink[];
}

/** /api/boards 的出站形状。 */
export interface BoardsPayload {
  boards?: BoardRecord[];
  unassigned?: BoardMember[];
}

/** /api/repos/ref/check 的一行（状态徽标的数据面）。 */
export interface RefCheckRow {
  id: string;
  ok?: boolean;
  issues?: string[];
}

/** /api/repos/ref/check → refId 的索引。 */
export type RefCheckMap = Map<string, RefCheckRow>;

/** 组级参考 chip（组共享，group 记第一个来源组）。 */
export interface GroupRefChip {
  key: string;
  id: string;
  name: string;
  remote: string;
  note: string;
  group: { id: string; key: string; name: string };
  alsoIn?: string[];
}

/** 主表「参考仓库」列的一枚 chip：本仓库直接绑定的参考仓库。 */
export interface RepoChip {
  key: string;
  name: string;
  note: string;
}

/** 仓库级反查：参考仓库 key → 直接绑在它身上的开发仓库。 */
export interface RefBackLink {
  repo: RepoRecord;
  note: string;
}

/** 各区块共享的刷新入口（index 组装，子组件按动作语义各取所需）。 */
export interface ReposReload {
  repos: () => void | Promise<void>;
  boards: () => void | Promise<void>;
  refCheck: () => void | Promise<void>;
  all: () => Promise<void>;
}

/** 主表行的动作集（index 组装）。 */
export interface RepoActs {
  open: (r: RepoRecord) => void;
  edit: (r: RepoRecord) => void;
  del: (r: RepoRecord) => void;
  remote: (r: RepoRecord) => void;
  getloop: (r: RepoRecord) => void;
  docs: (r: RepoRecord) => void;
  filter: (id: string) => void;
  gotoRefRepo: (key: string) => void;
  bind: (r: RepoRecord) => void;
}

/** 待初始化占位：组成员 + 所属组 + 自动匹配到的本机仓库。 */
export interface PendingItem extends BoardMember {
  board: string;
  boardId: string;
  match: RepoRecord | null;
}

// 路径照搬目录看板的「可扫标签」画法：祖先目录变暗、末段略重，点击复制全文。
// 纯灰一长串（旧画法）里，人眼要逐字符对比才能找到目录名。
function RepoPath({ path }: { path?: string }) {
  const s = String(path || '');
  const cut = s.replace(/\\/g, '/').lastIndexOf('/');
  if (cut < 0) return <Copyable text={s} title={undefined}>{s}</Copyable>;
  return (
    <Copyable text={s} title="点击复制完整路径">
      <span className="anc">{s.slice(0, cut)}</span>
      {s.slice(cut)}
    </Copyable>
  );
}

// 文档列入口（查看详情）：**归属 tag 单行**（主篇 + 补充篇）+ 篇数，点击在右侧栏
// 打开完整文档列表（主篇 / 补充 / reference / 组内）+ 管理动作（标签 / 摘除 / 补充）。
// #165：名字用**文档标题**（正文首个 # 行），摘要（desc）只在没有标题时兜底、
// 悬浮提示里看全文——此前 summary 优先，用户改了标题这行字永远不变（它显示的
// 是回写 desc 的摘要），被当成「标题无法修改、标题区变成了 desc」。
// #184 单行钳制：tag 多了不再换行把行撑高——放不下的收进「+N」，点 +N 同进详情；
// 名字超宽省略号，悬停看全名。未写的主篇显示「＋ 写项目介绍」虚态，点开同样进弹窗创建。
// 参考仓库面板的名单元格也复用它，所以具名导出。
export function DocsEntry({ docs, onOpen }: { docs?: RepoDocs | null; onOpen: () => void }) {
  const main = docs && docs.main;
  const links = (docs && docs.links) || [];
  const total = (main ? 1 : 0) + links.length;
  const tip = main && main.exists
    ? [main.title, main.summary && `摘要：${main.summary}`].filter(Boolean).join('\n')
    : '查看完整文档列表（主篇 / 补充 / reference / 组内），可就地编辑';
  const labelOf = (d: DocBrief, i: number) => d.title || d.rel || d.path || `第 ${i + 1} 篇`;
  const items: BindTagItem[] = [];
  if (main && main.exists) {
    items.push({ id: 'main', label: labelOf(main, 0), kind: 'repo', main: true, title: main.title || main.summary || '' });
  }
  links.forEach((l, i) => {
    items.push({
      id: (l.docId || l.rel || l.path || 'link') + ':' + i,
      label: labelOf(l, i),
      kind: 'repo',
      note: l.note || '',
      title: [l.title || l.rel || l.path, l.note && `备注：${l.note}`].filter(Boolean).join('\n'),
    });
  });
  return (
    <div
      className="rp-docs-entry"
      role="button"
      tabIndex={0}
      title={tip}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(); }}
    >
      {items.length ? (
        <BindTags items={items} onMore={onOpen} />
      ) : (
        <span className="rp-docs-entry-main ghost">＋ 写项目介绍</span>
      )}
      <span className="rp-docs-entry-n">{total > 0 ? `${total} 篇 · 查看详情` : '查看详情'}</span>
    </div>
  );
}

// 仓库自己直接绑定的参考仓库：超过 4 个折叠成 +N，避免一行铺十几个 chip 把表格撑爆。
// 点击 = 跳到这个参考仓库（打开参考面板并定位到那一行）。
function RefRepoChips({ chips, acts }: { chips: RepoChip[]; acts: RepoActs }) {
  const LIMIT = 4;
  const [open, setOpen] = useState(false);
  const shown = open ? chips : chips.slice(0, LIMIT);
  return (
    <>
      {shown.map((c) => (
        <span key={c.key} className="rp-link-chip rp-link-chip-repo">
          <button
            className="rp-link-chip-main"
            title={['本仓库直接绑定的参考仓库', c.note, '点击跳到这个参考仓库'].filter(Boolean).join('\n')}
            onClick={() => acts.gotoRefRepo(c.key)}
          >
            <b>自</b>
            <span className="rp-link-chip-name">{c.name}</span>
          </button>
        </span>
      ))}
      {chips.length > LIMIT ? (
        <button className="rp-bind-more" title="展开本行全部参考仓库" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : `+${chips.length - LIMIT}`}
        </button>
      ) : null}
    </>
  );
}

// 仓库行 = 仓库信息（名称 + 路径）+ 文档入口（核心）+ 参考仓库（仅全局视图）+ 所属分组 + 操作。
function RepoRow({ r, showRef, filterBoard, refRepoChipsByRepo, acts }: {
  r: RepoRecord;
  showRef: boolean;
  filterBoard: BoardRecord | null;
  refRepoChipsByRepo: Map<string, RepoChip[]>;
  acts: RepoActs;
}) {
  const chips = refRepoChipsByRepo.get(r.key) || [];
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
      {/* 文档列 = 这个仓库全部文档的入口：查看详情 → 右侧栏文档列表（含组内描述） */}
      <td className="rp-cell-docs">
        <DocsEntry docs={r.descDocs} onOpen={() => acts.docs(r)} />
      </td>
      {/* 参考仓库列只在全局视图出现：只放本仓库自己直接绑定的参考仓库 */}
      {showRef ? (
        <td className="rp-refs">
          {chips.length
            ? <RefRepoChips chips={chips} acts={acts} />
            : <span className="muted rp-refs-none">—</span>}
          <Button small className="rp-ref-bind" title="管理这个仓库所属组的参考仓库" onClick={() => acts.bind(r)}>绑定</Button>
        </td>
      ) : null}
      <td className="rp-cell-groups">
        {(r.boards || []).length ? (
          <ClampRow moreTitle="展开本行全部所属分组">
            {(r.boards || []).map((b) => (
              <button
                key={b.id}
                className={'rp-group-chip' + (filterBoard?.id === b.id ? ' on' : '')}
                title={`只看「${b.name}」${b.note ? `\n组内描述：${b.note}` : ''}`}
                onClick={() => acts.filter(b.id)}
              >
                {b.name}
              </button>
            ))}
          </ClampRow>
        ) : <span className="muted rp-refs-none">—</span>}
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

export default function RepoTable({ shown, devRepos, filterBoard, refRepoChipsByRepo, acts, onAddMember }: {
  shown: RepoRecord[];
  devRepos: RepoRecord[];
  filterBoard: BoardRecord | null;
  refRepoChipsByRepo: Map<string, RepoChip[]>;
  acts: RepoActs;
  onAddMember: (boardId: string) => void;
}) {
  // 组筛选视图不显示参考仓库列：组内参考仓库共享，统一在上方「组参考」区块看。
  const showRef = !filterBoard;
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
              <span className="rp-th-hint">主篇标题 · 查看详情打开完整文档列表</span>
            </th>
            {showRef ? <th scope="col" style={{ width: '18%' }}>参考仓库</th> : null}
            <th scope="col" style={{ width: '14%' }}>分组</th>
            <th scope="col" style={{ width: '250px' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <RepoRow key={r.id} r={r} showRef={showRef} filterBoard={filterBoard}
              refRepoChipsByRepo={refRepoChipsByRepo} acts={acts} />
          ))}
          {!shown.length ? (
            <tr>
              <td colSpan={showRef ? 5 : 4} className="muted rp-empty">
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
