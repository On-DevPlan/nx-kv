// 文档列表右侧面板（refs）——全站唯一的「列表」入口。
//
// 口径（v7 / 任务 #97）：ref 是 DB 实体（refs + ref_bodies + ref_bindings），
// 不是实体文件。列表只展示「desc（缺省标题）+ 归属」：
//   · 列表数据来自 GET /api/docs/bindings（host=仓库 / group=组）；
//   · 归属分色：repo（蓝）/ group（紫）/ group_repo（橙）；
//   · #114：不再有「无正文」这种兼容态——空文档要么补正文，要么被 docs gc 清掉；
//   · 点击行按 refId 打开（ref:<id>），不再用任何路径寻址；
//   · 「＋」直接建一个空正文的 ref 并按当前面板位置默认归属，建完立即编辑。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Model } from 'flexlayout-react';
import {
  createDoc,
  detach,
  descOf,
  docsBindings,
  filterByScope,
  labelOf,
  normalizeScope,
  scopeCounts,
  type BindingRow,
  type ScopeKey,
} from '../../refs/index.js';
import { Icon } from '../../components/icons.jsx';
import { useWikiNav } from '../doc/index.jsx';
import type { DocOpenExtra } from '../doc/index.jsx';
import { closeRightPanelOf } from '../../workspace.js';
import { useApp } from '../../app-context.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { onDocsChanged } from '../../modules/md/doc-bus.js';
import { resolveFollowedHost, type FollowedHost, type FollowResolution } from '../../refs/index.js';
import './style.css';

type ScopeBadge = { cls: 'repo' | 'group' | 'ref'; text: string };

function scopeBadgesOf(
  b: BindingRow,
  repoNameOf: (key: string) => string,
  groupNameOf: (key: string) => string
): ScopeBadge[] {
  // #132：参考仓库的文档在底层和开发仓库同构（只有 kind 差异），列表上标「参考」
  if (b.type === 'repo') {
    return b.hostKind === 'ref'
      ? [{ cls: 'ref', text: `参考 · ${repoNameOf(b.repoKey)}` }]
      : [{ cls: 'repo', text: `仓库 · ${repoNameOf(b.repoKey)}` }];
  }
  if (b.type === 'group') return [{ cls: 'group', text: `组 · ${groupNameOf(b.repoKey)}` }];
  // group_repo：组领域下的这个 repo —— 两个勋章拼在一起，颜色区分层级
  return [
    { cls: 'group', text: `组 · ${groupNameOf(b.groupKey || '')}` },
    { cls: 'repo', text: `仓库 · ${repoNameOf(b.repoKey)}` },
  ];
}

export default function RefsPanel({ repoKey, repoName, boardKey, boardName, scope, model }: {
  repoKey?: string;
  /** #132：打开方给的名字（参考仓库不在侧栏数据里，名字得由打开方带过来） */
  repoName?: string;
  boardKey?: string;
  boardName?: string;
  /** 打开时指定的归属筛选（#117）：repo / group / group_repo；缺省 all */
  scope?: string;
  model?: Model | null;
}) {
  const app = useApp();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const { openByDocId } = useWikiNav(model);

  // #105 跟随左侧打开的目录 / #109 只在「换目录」时更新。
  //   host  → 换到路由指向的仓库 / 组，并记住（点开列表里的某一行后仍停在这里）；
  //   none  → 当前目录没登记仓库：显示未登记提示，不能拿旧宿主冒充；
  //   idle  → 打开文档页 / 总览 / 仓库页等：**完全不动**，不刷新列表也不改标题。
  // 解析规则见 follow.ts（三态是 #109 的修复点：此前 doc 视图回落 config，
  // 于是点一行就把列表刷回最初打开时的项目）。
  const followedRes = useMemo<FollowResolution>(() => resolveFollowedHost(
    app.route,
    app.rows,
    (app.repoData?.repos || []) as any[],
    (app.repoData?.boards || []) as any[]
  ), [app.route, app.rows, app.repoData]);

  // 记住最后一次「跟随到的」宿主：只被 dir/group/doc 的有效路由改写，idle 时保持不动。
  const [latched, setLatched] = useState<FollowedHost | null>(() => {
    if (repoKey) return { repoKey };
    if (boardKey) return { groupKey: boardKey, name: boardName };
    return null;
  });
  useEffect(() => {
    if (followedRes.kind === 'host') {
      setLatched({ repoKey: followedRes.repoKey, groupKey: followedRes.groupKey, name: followedRes.name });
    } else if (followedRes.kind === 'none') {
      setLatched(null);
    }
    // idle：保持上一次的宿主，避免「看一眼文档就换列表」
  }, [followedRes]);

  // #117：路由和文档宿主无关（仓库管理 / 总览等）时，**config 是显式意图**——
  // 仓库管理页点「查看详情」必须切到那一行，不能被上一次的宿主钉住（此前就是这样点了没反应）。
  useEffect(() => {
    if (followedRes.kind !== 'idle') return;
    if (repoKey) setLatched({ repoKey });
    else if (boardKey) setLatched({ groupKey: boardKey, name: boardName });
  }, [repoKey, boardKey, boardName, followedRes.kind]);

  // 生效宿主 = 路由三态的即时结果（none 立刻清空），idle 才用记住的那一份；
  // 走到这里 config 只作为**初始值**，不再作为回退——回退正是 #109 的 bug。
  const effHost: FollowedHost | null =
    followedRes.kind === 'host'
      ? followedRes
      : followedRes.kind === 'none'
        ? null
        : latched;
  const effRepoKey = effHost?.repoKey;
  const effBoardKey = effHost?.groupKey;

  // boardKey 可能传的是 id（组页面）——统一收成组 key（group/xxx）再去查归属
  const groupKey = useMemo(() => {
    const raw = String(effBoardKey || '');
    const b = (app.repoData?.boards || []).find(
      (x: any) => x.id === raw || x.key === raw || String(x.name || '').toLowerCase() === raw.toLowerCase()
    ) as any;
    return b?.key || raw;
  }, [app.repoData, effBoardKey]);

  const ownerName = useMemo(() => {
    if (effRepoKey) {
      const r = (app.repoData?.repos || []).find((x: any) => x.key === effRepoKey) as any;
      // 侧栏数据里只有开发仓库（参考仓库不在其中）→ 打开方给的名字优先；
      // 都没有就用 key 的末段（github.com/owner/powertoys → powertoys），别甩一整串 key。
      return r?.name || repoName || String(effRepoKey).split('/').pop() || effRepoKey;
    }
    if (effHost?.groupKey && effHost.name) return effHost.name;
    return boardName || groupKey.replace(/^group\//, '') || '项目组';
  }, [app.repoData, effRepoKey, repoName, boardName, groupKey, effHost]);

  const repoNameOf = useCallback((key: string) => {
    const r = (app.repoData?.repos || []).find((x: any) => x.key === key) as any;
    return r?.name || String(key || '').split('/').pop() || key || '未知仓库';
  }, [app.repoData]);

  const groupNameOf = useCallback((key: string) => {
    const raw = String(key || '');
    const seg = raw.replace(/^(board|group)\//, '');
    const b = (app.repoData?.boards || []).find((x: any) => {
      const k = String(x.key || '');
      return k === raw || k.replace(/^(board|group)\//, '') === seg || String(x.name || '') === seg;
    }) as any;
    return b?.name || seg || '未知组';
  }, [app.repoData]);

  const [rows, setRows] = useState<BindingRow[] | null>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  // #117：归属（scope）是**筛选器**，不是装饰。仓库管理页点「查看详情」= 只看这一行的
  // 精确归属（repo）；组视图里可以切 全部 / 组 / 组内 / 仓库。
  const [scopeFilter, setScopeFilter] = useState<ScopeKey>(() => normalizeScope(scope));
  useEffect(() => { setScopeFilter(normalizeScope(scope)); }, [scope]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setErr('');
    (async () => {
      try {
        const d = effRepoKey ? await docsBindings({ host: effRepoKey }) : await docsBindings({ group: groupKey });
        if (alive) setRows(d.bindings || []);
      } catch (e) {
        if (alive) { setRows([]); setErr(String((e as Error).message || e)); }
      }
    })();
    return () => { alive = false; };
  }, [effRepoKey, groupKey, tick]);

  // 文档页保存 / 新建 / 删除后自动刷新
  useEffect(() => onDocsChanged(reload), [reload]);

  const openExtra: DocOpenExtra = effRepoKey
    ? { repoKey: effRepoKey }
    : { boardKey: groupKey, boardName: ownerName };
  const openDoc = (refId: string) => openByDocId('ref:' + refId, null, openExtra);

  const guard = (fn: () => Promise<unknown>) => fn().catch((e) => toast(String((e as Error).message || e)));

  // ＋：直接建 ref（desc 空 + 当前宿主归属），建完立即打开编辑；不再弹窗、不拼任何文件名。
  const addDoc = () => guard(async () => {
    if (!effRepoKey && !groupKey) return;
    const owner = effRepoKey && groupKey ? 'group_repo' : effRepoKey ? 'repo' : 'group';
    const refId = await createDoc({ owner, repo: effRepoKey, group: owner === 'repo' ? undefined : groupKey, desc: '' });
    toast('已新建文档');
    reload();
    openDoc(refId);
  });

  // ×：解绑归属（文档不删）
  const removeRow = (b: BindingRow) => guard(async () => {
    const label = labelOf(b);
    const ok = await dialog({ message: `从「${label}」摘除？只解除归属，文档不删。`, danger: true });
    if (!ok) return;
    await detach(b);
    toast('已摘除归属');
    reload();
  });

  const canAdd = !!(effRepoKey || groupKey);
  const counts = useMemo(() => scopeCounts(rows), [rows]);
  const shownRows = useMemo(() => filterByScope(rows, scopeFilter), [rows, scopeFilter]);
  const count = shownRows.length;

  return (
    <div className="nx-refs">
      <div className="nx-refs-h">
        <span className="t" title={ownerName}>{ownerName} · 文档列表</span>
        <span className="nx-refs-count">{count ? `${count} 篇` : ''}</span>
        {canAdd && (
          <button type="button" className="iconbtn" title="新建文档（直接编辑）" aria-label="新建文档" onClick={addDoc}>
            ＋
          </button>
        )}
        <button type="button" className="iconbtn" title="刷新" aria-label="刷新文档列表" onClick={reload}>
          <Icon name="refresh" size={13} title={undefined} />
        </button>
        {model && (
          <button
            type="button"
            className="iconbtn"
            title="关闭文档列表面板"
            aria-label="关闭文档列表面板"
            onClick={() => closeRightPanelOf(model, 'refs')}
          >
            <Icon name="x" size={14} title={undefined} />
          </button>
        )}
      </div>
      {/* #117：归属筛选器——仓库管理页「查看详情」直接落在 repo 这一档；
          组视图里能切 全部 / 组 / 组内 / 仓库，scope 不再是只能看的勋章。 */}
      {rows && (counts.repo + counts.group + counts.group_repo > 1 || scopeFilter !== 'all') ? (
        <div className="nx-refs-scopes" role="tablist" aria-label="按归属筛选文档">
          {([
            ['all', '全部', counts.all],
            ['repo', '仓库', counts.repo],
            ['group', '组', counts.group],
            ['group_repo', '组内', counts.group_repo],
          ] as Array<[string, string, number]>).map(([k, label, n]) =>
            n > 0 || k === 'all' ? (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={scopeFilter === k}
                className={'nx-refs-scope-filter' + (scopeFilter === k ? ' on' : '')}
                onClick={() => setScopeFilter(k as ScopeKey)}
              >
                {label} <b>{n}</b>
              </button>
            ) : null
          )}
        </div>
      ) : null}
      <div className="nx-refs-list">
        {err ? <div className="nx-refs-empty">{err}</div> : null}
        {!err && !rows ? <div className="nx-refs-empty">读取中…</div> : null}
        {!err && rows && !shownRows.length ? (
          <div className="nx-refs-empty">
            还没有文档<br />
            {canAdd
              ? '点右上角「＋」新建，建完直接编辑'
              : followedRes.kind === 'none'
                ? '当前打开的目录还没登记为本机仓库：nx-kv repo add "<目录>" --key <key> 之后才有文档列表'
                : '这个宿主还没有可挂的文档'}
          </div>
        ) : null}
        {shownRows.map((b) => {
          const title = labelOf(b);
          const desc = descOf(b);
          const badges = scopeBadgesOf(b, repoNameOf, groupNameOf);
          return (
            <div
              key={`${b.type}:${b.repoKey}:${b.groupKey || ''}:${b.refId}`}
              className={'nx-refs-row-wrap' + (b.main ? ' main' : '')}
            >
              <button
                type="button"
                className="nx-refs-row"
                title={`${[title, desc, b.note].filter(Boolean).join('\n')}\n点击打开（可编辑）`}
                onClick={() => openDoc(b.refId)}
              >
                <span className="nx-refs-row-label">
                  <span className="nx-refs-row-badges">
                    {badges.map((x, i) => (
                      <span key={`${x.cls}:${i}`} className={`nx-refs-scope ${x.cls}`}>{x.text}</span>
                    ))}
                  </span>
                  <span className="nx-refs-row-text">{title}</span>
                </span>
                {desc && <span className="nx-refs-row-desc">{desc}</span>}
                {b.note && <span className="nx-refs-row-sub">备注：{b.note}</span>}
              </button>
              <span className="nx-refs-row-acts">
                <button
                  type="button"
                  className="nx-refs-mini danger"
                  title="解绑归属（文档不删）"
                  onClick={() => removeRow(b)}
                >
                  ×
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <div className="nx-refs-note">点一行打开文档（编辑 / 保存在那一页）；× 摘除归属，不删文档。</div>
      {dialogNode}
    </div>
  );
}
