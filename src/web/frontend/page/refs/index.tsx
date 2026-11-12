// 文档列表右侧面板（refs）——**全站唯一的"列表"入口**（#186）。
//
// 以前同一份列表有两套 UI：介绍条「查看详情」弹 DocsModal（模态），
// 「更多 → 查看列表」开这块右侧栏。用户明确要求「查看列表统一只要右侧边栏，不要 modal 弹窗」。
// 于是把弹窗里的管理动作整体搬到这里，弹窗连同 .nx-dl* 样式一起下线：
//   · 点一行 → 在工作区开该文档页签（带归属上下文，双链可跳），编辑在那一页做；
//   · 行内小动作只留管理类：改标签（＃）、摘除（×），都不跳页；
//   · 头部「＋ 补充」落一篇 reference 并登记，建完直接开它。
//
// 数据面：repo → GET /api/repos/docs；board → GET /api/boards/:id。
// 两份响应的字段名不同（links / docLinks、main / introMain、extras / introExtras），
// 这里统一收口成一行一条的 RefRow。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Model } from 'flexlayout-react';
import {
  addBoardDoc,
  addRepoDoc,
  boardDetail,
  createDocItem,
  removeBoardDoc,
  removeRepoDoc,
  repoDocs,
} from './api.js';
import { Icon } from '../../components/icons.jsx';
import { useWikiNav } from '../doc/index.jsx';
import type { DocOpenExtra } from '../doc/index.jsx';
import { closeRightPanelOf } from '../../workspace.js';
import { useApp } from '../../app-context.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { useIntro, introDirFromRef } from '../../components/Introduction/index.jsx';
import type { DialogResult, IntroKind, IntroOwner } from '../../components/Introduction/use-intro.js';
import { notifyDocsChanged, onDocsChanged } from '../../modules/md/doc-bus.js';
import { slugName } from '../../modules/md/md-parse.js';
import './style.css';

/** 文档条目（/api/repos/docs 与 /api/boards/:id 里的 main / extras / links 共用形状）。 */
interface DocLink {
  rel?: string;
  path?: string;
  note?: string;
  tag?: string;
  title?: string;
}

/** 两份出站载荷的并集（repo 侧叫 links、board 侧叫 docLinks）。 */
interface RefsData {
  main?: DocLink;
  introMain?: DocLink;
  extras?: DocLink[];
  introExtras?: DocLink[];
  links?: DocLink[];
  docLinks?: DocLink[];
  repo?: { name?: string };
  name?: string;
}

/** 列表行 = 原始条目 + 寻址串 + 分段信息 + 管理动作的可达性。 */
interface RefRow extends DocLink {
  docId: string;
  main: boolean;
  /** main=主篇 / extra=目录补充 / link=登记的 reference / scoped=组内描述 */
  kind: 'main' | 'extra' | 'link' | 'scoped';
  label?: string;
  removable?: boolean;
  taggable?: boolean;
  removeIndex?: number;
  removeTip?: string;
}

const KIND_MARK: Record<RefRow['kind'], string> = {
  main: '● ',
  scoped: '◇ ',
  extra: '○ ',
  link: '○ ',
};

function docIdOf(l: DocLink | null | undefined) {
  if (!l) return '';
  if (l.rel) return 'rel:' + l.rel;
  if (l.path) return 'path:' + l.path;
  return '';
}

function baseLabel(l: DocLink) {
  const s = l.rel || l.path || '';
  return String(s).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || s || '未命名';
}

/** 数据 → 行（主篇 / 目录补充 / 登记 reference / 组内描述，顺序稳定）
 *
 * 去重是必需的（#183「仓库/组/组内的 ref 混乱」）：介绍目录里的
 * `repo/<key>/reference/*.md` 会同时出现在 extras（目录枚举）与 links（登记）
 * 里，此前两段各推一行 → 同一篇在列表里出现两次，一次带 tag、一次不带。
 * 口径：**登记行优先**（它带 note/tag 与顺序），extras 只补登记里没有的。
 */
function buildRows(d: RefsData | null, owner: IntroOwner | null, kind: IntroKind): RefRow[] {
  const rows: RefRow[] = [];
  const seen = new Set<string>();
  const links = (d && (d.links || d.docLinks)) || [];
  const registeredIds = new Set(links.map((l) => docIdOf(l)).filter(Boolean));

  const main = d && (d.main || d.introMain);
  const mainId = docIdOf(main);
  if (main && mainId) {
    seen.add(mainId);
    rows.push({
      ...(main as DocLink),
      docId: mainId,
      main: true,
      kind: 'main',
      label: d?.repo ? d.repo.name : '主篇',
      // 只有「仓库自定的主篇绑定」可摘（摘掉回退约定路径，文档不删）
      removable: kind === 'repo' && !!(owner && owner.doc),
      removeTip: '摘除主篇自定义绑定（回退约定路径，文档不删）',
    });
  }
  for (const l of (d && (d.extras || d.introExtras)) || []) {
    const id = docIdOf(l);
    if (!id || seen.has(id) || registeredIds.has(id)) continue;
    seen.add(id);
    rows.push({ ...l, docId: id, main: false, kind: 'extra', label: baseLabel(l), taggable: id.startsWith('rel:') });
  }
  links.forEach((l, i) => {
    const id = docIdOf(l);
    if (!id || seen.has(id)) return;
    seen.add(id);
    rows.push({
      ...l,
      docId: id,
      main: false,
      kind: 'link',
      label: baseLabel(l),
      removable: true,
      taggable: true,
      // repo：1=主篇绑定，≥2=docLinks[n-2]；board：docLinks 1-based
      removeIndex: kind === 'repo' ? i + 2 : i + 1,
    });
  });
  // 组内描述（仅仓库）：仓库 × 分组这一层，所属组逐条列出
  for (const b of (kind === 'repo' && owner && owner.boards) || []) {
    const abs = b.noteDocPath || '';
    const rel = b.noteDocRel || '';
    const id = abs ? 'path:' + abs : rel ? 'rel:' + rel : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      docId: id,
      rel,
      path: abs,
      note: b.note || '',
      main: false,
      kind: 'scoped',
      label: `${b.name} · 组内描述`,
    });
  }
  return rows.filter((r) => r.docId);
}

export default function RefsPanel({ repoKey, boardKey, boardName, model }: {
  repoKey?: string;
  boardKey?: string;
  boardName?: string;
  model?: Model | null;
}) {
  const app = useApp();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const { openByDocId } = useWikiNav(model);
  const kind: IntroKind = repoKey ? 'repo' : 'board';
  const key = repoKey || String(boardKey || '');

  // 面板配置里只有 key（可 JSON 序列化），但「＋补充 / 摘除 / 组内描述」要读 owner 的
  // doc / boards 字段 —— 从 app.repoData 里按 key 捡回来，拿不到就退化成只读列表。
  const owner = useMemo<IntroOwner | null>(() => {
    if (!key) return null;
    const rd = app.repoData || { repos: [], boards: [] };
    const list = kind === 'repo' ? rd.repos || [] : rd.boards || [];
    return (list.find((x) => String(kind === 'repo' ? x.key : x.id) === key) as unknown as IntroOwner) || null;
  }, [app.repoData, kind, key]);

  const intro = useIntro({ kind, owner, model });

  const [data, setData] = useState<RefsData | null>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setErr('');
    (async () => {
      try {
        const d = repoKey ? await repoDocs(repoKey) : await boardDetail(String(boardKey));
        if (alive) setData(d);
      } catch (e) {
        if (alive) { setData(null); setErr(String((e as Error).message || e)); }
      }
    })();
    return () => { alive = false; };
  }, [repoKey, boardKey, tick]);

  // 文档页保存 / 补充 / 删除后自动刷新（#183：编辑器与 ref 列表不同步）
  useEffect(() => onDocsChanged(reload), [reload]);

  const rows = buildRows(data, owner, kind);
  const title = data
    ? (data.repo ? data.repo.name : (data.name || boardName || '项目组'))
    : (boardName || '文档列表');
  // 打开文档页签带上归属上下文（DocPanel 顶部的归属与 IntroRail 数据面）
  const openExtra: DocOpenExtra = repoKey ? { repoKey } : { boardKey, boardName };

  const openDoc = (docId: string) => openByDocId(docId, null, openExtra);

  // ─── 管理动作（原在 DocsModal 里）：摘除 / 改标签 / ＋补充 ──────────────
  const guard = (fn: () => Promise<unknown>) => fn().catch((e) => toast(String((e as Error).message || e)));

  const removeRow = (r: RefRow) => guard(async () => {
    if (r.removeIndex == null) return;
    const ok = await dialog({
      message: `摘除「${r.label}」？${r.kind === 'main' ? '（只拆绑定，文档不删）' : '（文档不删，仅移出列表）'}`,
      danger: true,
    });
    if (!ok) return;
    if (kind === 'repo') {
      await removeRepoDoc(key, r.removeIndex);
    } else {
      await removeBoardDoc(key, r.removeIndex);
    }
    toast('已摘除');
    notifyDocsChanged();
    reload();
  });

  const editTag = (r: RefRow) => guard(async () => {
    // dialog() 的 resolve 是 unknown（popup 原语不建模返回值形状）：外部原语边界
    const res = (await dialog({
      title: `标签 · ${r.label}`,
      input: true,
      placeholder: '标签（如 qa；留空 = 清掉）',
      value: r.tag || '',
      okText: '保存标签',
    })) as DialogResult;
    if (res === null || res === undefined) return;
    const tag = typeof res === 'string' ? res : (res && res.tag) || '';
    await intro.setLinkTag(r.docId, tag, r);
    toast(tag ? `标签已设为 [${tag}]` : '标签已清除');
    notifyDocsChanged();
    reload();
  });

  const addDoc = () => guard(async () => {
    if (!key || !String(intro.docRef || '').startsWith('rel:')) {
      toast('当前简介无法补充（需要自有树路径）');
      return;
    }
    const res = (await dialog({
      title: '补充介绍文档',
      input: true,
      tagInput: true,
      placeholder: '文档名（如 architecture / api-notes）',
      tagPlaceholder: '标签（可选，如 qa）',
    })) as DialogResult;
    if (res === null || res === undefined) return;
    const name = typeof res === 'string' ? res : (res && res.value) || '';
    const tag = typeof res === 'object' && res ? res.tag || '' : '';
    const slug = slugName(String(name).trim() || 'note').replace(/\.md$/i, '');
    const dir = introDirFromRef(intro.docRef) || (kind === 'repo' ? `repo/${key}` : `board/${owner?.name || key}`);
    const rel = `${dir}/reference/${slug}.md`;
    await createDocItem(rel, `# ${String(name).trim() || slug}\n\n（待补）\n`);
    try {
      if (kind === 'repo') {
        await addRepoDoc(key, rel, tag || undefined);
      } else {
        await addBoardDoc(key, rel, tag || undefined);
      }
    } catch {
      /* 集里已有 / 旧数据：文件已创建即可——同 doc 重复添加 = 更新（tag 以本次为准） */
    }
    toast(`已补充：${rel}${tag ? ` [${tag}]` : ''}`);
    notifyDocsChanged();
    reload();
    // 新建完直接开它（用户已确认这个口径：少一次点击）
    openDoc('rel:' + rel);
  });

  const canAdd = !!String(intro.docRef || '').startsWith('rel:') && !!key;

  return (
    <div className="nx-refs">
      <div className="nx-refs-h">
        <span className="t" title={title}>{title} · 文档列表</span>
        <span className="nx-refs-count">{rows.length ? `${rows.length} 篇` : ''}</span>
        {canAdd && (
          <button type="button" className="iconbtn" title="补充一篇介绍文档（reference）" aria-label="补充文档" onClick={addDoc}>
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
      <div className="nx-refs-list">
        {err ? <div className="nx-refs-empty">{err}</div> : null}
        {!err && !data ? <div className="nx-refs-empty">读取中…</div> : null}
        {!err && data && !rows.length ? (
          <div className="nx-refs-empty">
            还没有文档<br />
            {canAdd ? '点右上角「＋」补一篇 reference 开始写' : '这个宿主还没有可补的文档目录'}
          </div>
        ) : null}
        {rows.map((r) => (
          <div key={r.docId} className={'nx-refs-row-wrap' + (r.main ? ' main' : '')}>
            <button
              type="button"
              className="nx-refs-row"
              title={`${r.rel || r.path || ''}${r.note ? `\n${r.note}` : ''}\n点击在工作区打开（可编辑）`}
              onClick={() => openDoc(r.docId)}
            >
              <span className="nx-refs-row-label">{KIND_MARK[r.kind]}{r.label}</span>
              {r.tag ? <span className="nx-refs-row-tag">{r.tag}</span> : null}
              <span className="nx-refs-row-sub mono">{r.rel || r.path || ''}</span>
            </button>
            <span className="nx-refs-row-acts">
              {r.taggable && (
                <button type="button" className="nx-refs-mini" title={r.tag ? `改标签（当前：${r.tag}）` : '加标签'} onClick={() => editTag(r)}>＃</button>
              )}
              {r.removable && (
                <button type="button" className="nx-refs-mini danger" title={r.removeTip || `摘除「${r.label}」（文档不删）`} onClick={() => removeRow(r)}>×</button>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="nx-refs-note">点一行在工作区打开文档页签（编辑 / 保存在那里）；＃ 改标签，× 摘除（不删文档）。</div>
      {dialogNode}
    </div>
  );
}
