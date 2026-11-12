// 「查看详情」弹窗（项目 / 项目组统一）：**只有文章列表**，不是编辑器。
//
// #88 口径修正（2026-11-07）：编辑页就是 maincontent，不是弹窗面板。
//   ① 弹窗只干一件事：列出当前项目 / 项目组的全部文章，只显示标题（不铺 tag、不渲染正文）；
//   ② 点一行 → 在工作区**主内容区**打开该文档（component:'doc'，落点 maincontent），
//      再由 DocPanel 承担编辑 / 保存 / 更多（那一页本来就是"任务页同构"的编辑器）；
//   ③ 弹窗里的行内小动作只留管理类：改标签（＃）、摘除（×）、＋补充——都不该跳页。
//
// 为什么不在这里内嵌编辑器：maincontent 是**单面板位**（areas.js），弹窗里再套一个
// 编辑器等于两套编辑器、两套保存语义，用户点"更多 → 文字列表"还会被模态遮罩压住。
// 唯一的数据面在 DocPanel 那边，这里只负责"选哪篇"。
//
// 数据面：repo → GET /api/repos/docs（main/extras/links 三段），
// board → GET /api/boards/:id（introMain/introExtras/docLinks）。列表实时拉取，
// 加/摘/改标签后重拉即可见（不读父层快照——Introduction 旧实现的教训）。
import { useCallback, useEffect, useState } from 'react';
import type { Model } from 'flexlayout-react';
import { api } from '../../api/client.js';
import { useApp } from '../../app-context.jsx';
import { Modal, useDialog } from '../popup/index.jsx';
import { useToast } from '../toast/index.jsx';
import { useIntro, introDirFromRef } from './use-intro.js';
import type { DialogResult, IntroDocEntry, IntroKind, IntroOwner } from './use-intro.js';
import { slugName } from '../../modules/md/md-parse.js';
import { notifyDocsChanged, onDocsChanged } from '../../modules/md/doc-bus.js';
import { openPanel } from '../../workspace.js';
import './style.css';

/** 列表条目：sections = 主篇 / 补充 / reference / 组内（仅项目）。
 *  removable=摘除入口（登记的 docLinks 与主篇自定义绑定）；taggable=可改标签。 */
interface DocsItem {
  id: string;
  kind: string;
  label: string;
  sub: string;
  tag: string;
  note: string;
  docId: string;
  removable: boolean;
  taggable: boolean;
  removeTip?: string;
  removeIndex?: number;
}

/** 「在主内容区打开」只需要这三个字段（＋补充后直接开新文档）。 */
interface OpenTarget {
  docId: string;
  label?: string;
  sub?: string;
}

export interface DocsModalProps {
  /** 调用方（仓库页 DocsTarget）传的是 string；实际只会是 'repo' | 'board'。 */
  kind: string;
  /** 仓库 / 看板对象（repoData 行，含 doc / boards / key|id）。 */
  owner: IntroOwner;
  /** FlexLayout model（主内容区开文档用）；不给则取全局 model。 */
  model?: Model | null;
  /** 增删改后通知父层刷新。 */
  onChanged?: () => void;
  onClose: () => void;
}

function docIdOf(l: IntroDocEntry | null | undefined): string {
  if (!l) return '';
  if (l.rel) return 'rel:' + l.rel;
  if (l.path) return 'path:' + l.path;
  return '';
}

function baseLabel(l: IntroDocEntry): string {
  const s = l.rel || l.path || '';
  return String(s).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || s || '未命名';
}

function buildSections(
  data: Record<string, any> | null | undefined,
  owner: IntroOwner | null | undefined,
  kind: string
): DocsItem[] {
  const out: DocsItem[] = [];
  const seen = new Set<string>();
  const registered = ((data && (data.links || data.docLinks)) || []) as IntroDocEntry[];
  const registeredIds = new Set(registered.map((l) => docIdOf(l)).filter(Boolean));
  const main = (data && (data.main || data.introMain)) as IntroDocEntry | null | undefined;
  if (main) {
    seen.add(docIdOf(main));
    out.push({
      id: docIdOf(main),
      kind: 'main',
      label: '主篇',
      sub: main.rel || main.path || '',
      tag: '',
      note: '',
      docId: docIdOf(main),
      removable: kind === 'repo' && !!(owner && owner.doc),
      removeTip: '摘除主篇自定义绑定（回退约定路径，文档不删）',
      taggable: false,
    });
  }
  for (const l of ((data && (data.extras || data.introExtras)) || []) as IntroDocEntry[]) {
    const id = docIdOf(l);
    // 介绍目录里的 reference 同时是「目录补充」与「登记项」——登记行带 tag/note，
    // 优先它，别让同一篇在弹窗里出现两遍（#183）
    if (!id || seen.has(id) || registeredIds.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: 'extra',
      label: baseLabel(l),
      sub: l.rel || l.path || '',
      tag: '',
      note: '',
      docId: id,
      removable: false,
      taggable: String(id).startsWith('rel:'),
    });
  }
  // 登记的 reference：repo 与 board 的响应字段名不同（links / docLinks）
  registered.forEach((l, i) => {
    const id = docIdOf(l);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      kind: 'link',
      label: baseLabel(l),
      sub: l.rel || l.path || '',
      tag: l.tag || '',
      note: l.note || '',
      docId: id,
      // repo：1=主篇绑定，≥2=docLinks[n-2]；board：docLinks 1-based
      removeIndex: kind === 'repo' ? i + 2 : i + 1,
      removable: true,
      taggable: true,
    });
  });
  // 组内描述（仅项目）：仓库 × 分组这一层，全部所属组逐条列出
  for (const b of (kind === 'repo' && owner && owner.boards) || []) {
    const abs = b.noteDocPath || '';
    const rel = b.noteDocRel || '';
    const id = abs ? 'path:' + abs : rel ? 'rel:' + rel : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: 'scoped',
      label: `${b.name} · 组内描述`,
      sub: abs || rel,
      tag: '',
      note: b.note || '',
      docId: id,
      removable: false,
      taggable: false,
    });
  }
  return out.filter((x) => x.docId);
}

const KIND_MARK: Record<string, string> = { main: '● ', scoped: '◇ ', extra: '○ ', link: '○ ' };

export default function DocsModal({ kind, owner, model, onClose, onChanged }: DocsModalProps) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  // model 兜底取全局：仓库页/项目组页调用时并没有把 FlexLayout model 往下传，
  // 少这一层兜底 → 点行只会提示「工作区不可用」，文档页永远开不起来（探针实证）。
  const app = useApp();
  const wsModel = model || app.model;
  // kind 在调用方是 string（DocsTarget 的历史形状），实际只会是 repo / board
  const intro = useIntro({ kind: kind as IntroKind, owner, model: wsModel });
  const ownerKey = intro.ownerKey;
  const ownerName = owner && owner.name;

  const [items, setItems] = useState<DocsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  // ─── 列表：实时拉取（repo / board 两个端点，结构化三段）─────────────────
  const reload = useCallback(async () => {
    if (!ownerKey) { setItems([]); setLoading(false); return; }
    setLoading(true);
    try {
      const d = kind === 'repo'
        ? await api('/api/repos/docs?id=' + encodeURIComponent(ownerKey))
        : await api('/api/boards/' + encodeURIComponent(String(ownerKey)));
      setItems(buildSections(d, owner, kind));
      setErr('');
    } catch (e) {
      setItems([]);
      setErr(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, [kind, ownerKey, owner]);

  useEffect(() => { reload(); }, [reload]);
  // 文档页保存 / 补充 / 摘除后同步刷新（#183）
  useEffect(() => onDocsChanged(reload), [reload]);

  // ─── 点一行 → 主内容区开文档页（编辑 / 保存 / 更多都在那一页）────────────
  const openInMain = (it: OpenTarget | null | undefined) => {
    if (!it) return;
    const m = wsModel;
    if (!m) { toast('工作区不可用，无法打开文档'); return; }
    openPanel(m, {
      component: 'doc',
      name: it.label || it.sub || it.docId,
      config: {
        docId: it.docId,
        ...(kind === 'repo'
          ? { repoKey: ownerKey }
          : { boardKey: ownerKey, boardName: ownerName || '' }),
      },
      location: 'center',
    });
    // 文档页已经落到 maincontent，弹窗（模态）留着只会挡住它
    onClose();
  };

  // ─── 管理：摘除 / 标签 / ＋补充（行内小动作，都不跳页）────────────────────
  const guard = (fn: () => Promise<unknown>) => fn().catch((e: Error) => toast(String(e.message || e)));

  const removeItem = (it: DocsItem) => guard(async () => {
    const ok = await dialog({
      message: `摘除「${it.label}」？${it.kind === 'main' ? '（只拆绑定，文档不删）' : '（文档不删，仅移出列表）'}`,
      danger: true,
    });
    if (!ok) return;
    if (kind === 'repo') {
      await api('/api/repos/docs', { method: 'DELETE', body: { id: ownerKey, index: it.removeIndex } });
    } else {
      await api('/api/docs/link', { method: 'POST', body: { board: ownerKey, remove: it.removeIndex } });
    }
    toast('已摘除');
    notifyDocsChanged();
    reload();
    if (onChanged) onChanged();
  });

  const editTag = (it: DocsItem) => guard(async () => {
    // dialog() 的 resolve 是 unknown（popup 原语不建模返回值形状）：这是外部原语边界
    const res = (await dialog({
      title: `标签 · ${it.label}`,
      input: true,
      placeholder: '标签（如 qa；留空 = 清掉）',
      value: it.tag || '',
      okText: '保存标签',
    })) as DialogResult;
    if (res === null) return;
    const tag = typeof res === 'string' ? res : (res && res.tag) || '';
    await intro.setLinkTag(it.docId, tag, it);
    toast(tag ? `标签已设为 [${tag}]` : '标签已清除');
    reload();
    if (onChanged) onChanged();
  });

  // ＋补充：落一篇 reference 并登记——就地刷新列表（不跳文档页，免得弹窗被卸载）
  const addDoc = () => guard(async () => {
    if (!ownerKey || !String(intro.docRef || '').startsWith('rel:')) {
      toast('当前简介无法补充（需要自有树路径）');
      return;
    }
    // dialog() 的 resolve 是 unknown：外部原语边界，按「单输入 / 双输入」两种口径收口
    const res = (await dialog({
      title: '补充介绍文档',
      input: true,
      tagInput: true,
      placeholder: '文档名（如 architecture / api-notes）',
      tagPlaceholder: '标签（可选，如 qa）',
    })) as DialogResult;
    if (res === null) return;
    const name = typeof res === 'string' ? res : (res && res.value) || '';
    const tag = typeof res === 'object' && res ? (res.tag || '') : '';
    const slug = slugName(String(name).trim() || 'note').replace(/\.md$/i, '');
    const dir = introDirFromRef(intro.docRef) || (kind === 'repo' ? `repo/${ownerKey}` : `board/${ownerName || ownerKey}`);
    const rel = `${dir}/reference/${slug}.md`;
    await api('/api/docs/item', { method: 'POST', body: { rel, body: `# ${String(name).trim() || slug}\n\n（待补）\n` } });
    try {
      if (kind === 'repo') {
        await api('/api/repos/docs', { method: 'POST', body: { id: ownerKey, rel, tag: tag || undefined } });
      } else {
        await api('/api/docs/link', { method: 'POST', body: { board: ownerKey, doc: rel, tag: tag || undefined } });
      }
    } catch {
      /* 集里已有 / 旧数据：文件已创建即可——同 doc 重复添加 = 更新（tag 以本次为准） */
    }
    toast(`已补充：${rel}${tag ? ` [${tag}]` : ''}`);
    notifyDocsChanged();
    await reload();
    if (onChanged) onChanged();
    // 新建完直接在主内容区打开它（用户已确认这个口径：少一次点击）
    openInMain({
      docId: 'rel:' + rel,
      label: String(name).trim() || slug,
      sub: rel,
    });
  });

  const canAdd = !!String(intro.docRef || '').startsWith('rel:') && ownerKey;
  const total = items.length;
  const title = `文档列表 · ${ownerName || ''}${kind === 'board' ? '（项目组）' : ''}`;

  return (
    <Modal size="md" title={title} onClose={onClose}>
      <div className="nx-dl">
        <div className="nx-dl-head">
          <span className="nx-dl-count">{total ? `${total} 篇` : '还没有文档'}</span>
          <span className="nx-dl-hint">点标题在主内容区打开</span>
          <span className="grow" />
          {canAdd && (
            <button type="button" className="btn ghost sm nx-dl-add" title="补充一篇介绍文档（reference）" onClick={addDoc}>
              ＋ 补充
            </button>
          )}
        </div>
        {err ? <div className="rpd-err">{err}</div> : null}
        {!err && loading && total === 0 ? <div className="rpd-empty">载入中…</div> : null}
        {!err && !loading && total === 0 ? (
          <div className="rpd-none">还没有文档 —— 点「＋ 补充」写第一篇</div>
        ) : null}
        <div className="nx-dl-list">
          {items.map((it) => (
            <div key={it.id} className="nx-dl-row-wrap">
              <button
                type="button"
                className="nx-dl-row"
                title={`${it.sub || it.label}\n点击在主内容区打开（可编辑）`}
                onClick={() => openInMain(it)}
              >
                <span className="nx-dl-row-title">
                  {KIND_MARK[it.kind] || '○ '}
                  {it.label}
                </span>
                {it.tag ? <span className="rpd-badge">{it.tag}</span> : null}
              </button>
              <span className="nx-docs-modal-item-acts">
                {it.taggable && (
                  <button type="button" className="nx-docs-modal-mini" title={it.tag ? `改标签（当前：${it.tag}）` : '加标签'} onClick={() => editTag(it)}>＃</button>
                )}
                {it.removable && (
                  <button type="button" className="nx-docs-modal-mini danger" title={it.removeTip || `摘除「${it.label}」（文档不删）`} onClick={() => removeItem(it)}>×</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
      {dialogNode}
    </Modal>
  );
}
