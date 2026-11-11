// 简介数据（项目 / 项目组共用）：页面上只留一行**文字超链接**，
// 点开 DocPanel 阅读/编辑——正文渲染、标题滚动目录、双链全在文档页签里。
// kind: 'repo' | 'board' —— API 与落盘路径不同，UI 语义相同。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Model } from 'flexlayout-react';
import { api } from '../../api/client.js';
import { slugName } from '../../modules/md/md-parse.js';
import { useWikiNav } from '../../page/doc/index.jsx';
import type { DocOpenExtra } from '../../page/doc/index.jsx';

/** 简介归属：仓库（repo）或看板 / 项目组（board）。 */
export type IntroKind = 'repo' | 'board';

/** 介绍文档集的一行（右侧轨、弹窗列表共用）。 */
export interface IntroLink {
  docId: string;
  label: string;
  note?: string;
  tag?: string;
  main?: boolean;
  ref?: string;
}

/**
 * 后端给的文档条目（/api/repos/docs 的 main / extras / links，
 * board 的 introMain / introExtras / docLinks）。外部数据边界：字段按后端 schema 出现。
 */
export interface IntroDocEntry {
  rel?: string;
  path?: string;
  name?: string;
  note?: string;
  tag?: string;
  ref?: string;
  [k: string]: any;
}

/** 仓库所属组的一行（owner.boards[]：组内描述文档的定位来源）。 */
export interface IntroScopedBoard {
  name?: string;
  note?: string;
  noteDocPath?: string;
  noteDocRel?: string;
  [k: string]: any;
}

/**
 * 简介归属对象（仓库行 / 看板行，即 repoData 快照）。
 * 字段按后端 schema 选择性出现，因此全部可选 + 索引签名（外部数据边界）。
 */
export interface IntroOwner {
  key?: string;
  id?: string;
  name?: string;
  doc?: { path?: string; rel?: string };
  docPath?: string;
  docRel?: string;
  docLinks?: IntroDocEntry[];
  boards?: IntroScopedBoard[];
  [k: string]: any;
}

/** dialog() 的返回值：单输入回 string、双输入回 { value, tag }、取消回 null（外部原语）。 */
export type DialogResult = string | { value?: string; tag?: string } | null | undefined;
/** 输入型 dialog()（按调用点实际传的字段声明；返回值是外部原语，由调用处收口）。 */
export type DialogFn = (opts: Record<string, unknown>) => Promise<DialogResult>;
/** 轻提示出口。 */
export type ToastFn = (msg: string) => void;

/** useIntro 的入参。 */
export interface UseIntroArgs {
  kind: IntroKind;
  owner: IntroOwner | null | undefined;
  model?: Model | null;
}

/** useIntro 的返回面（页面头、右侧轨、详情弹窗共用）。 */
export interface IntroApi {
  kind: IntroKind;
  label: string;
  ownerKey: string;
  docRef: string;
  mainDocId: string;
  links: IntroLink[];
  openMain: () => void;
  openDoc: (id: string) => void;
  addRef: (dialog: DialogFn, toast?: ToastFn) => Promise<string | null>;
  setLinkTag: (docId: string, tag: string, cur?: { note?: string } | null) => Promise<void>;
  reload: () => void;
  canEdit: boolean;
}

/** 主篇 docRef → 介绍目录（去掉 .md /index.md） */
export function introDirFromRef(docRef: string | null | undefined): string {
  const rel = String(docRef || '').startsWith('rel:') ? String(docRef).slice(4) : '';
  if (!rel) return '';
  if (/\/index\.md$/i.test(rel)) return rel.replace(/\/index\.md$/i, '');
  if (/\.md$/i.test(rel)) return rel.replace(/\.md$/i, '');
  return rel.replace(/\/+$/, '');
}

/** 仓库 / 看板 → 主篇 docId */
export function introRefOf(owner: IntroOwner | null | undefined, kind: IntroKind): string {
  if (!owner) return '';
  if (owner.doc && owner.doc.path) return 'path:' + owner.doc.path;
  if (owner.doc && owner.doc.rel) return 'rel:' + owner.doc.rel;
  if (owner.docPath) return 'path:' + owner.docPath;
  if (owner.docRel) return 'rel:' + owner.docRel;
  if (kind === 'repo' && owner.key) return 'rel:repo/' + owner.key + '.md';
  return '';
}

function linkDocId(l: IntroDocEntry | null | undefined): string {
  if (!l) return '';
  if (l.rel) return 'rel:' + l.rel;
  if (l.path) return 'path:' + l.path;
  return '';
}

/**
 * @param p.kind   'repo' | 'board'
 * @param p.owner  repo 或 board 对象
 * @param p.model  FlexLayout model（开文档页签）
 */
export function useIntro({ kind, owner, model }: UseIntroArgs): IntroApi {
  const { openByDocId } = useWikiNav(model);
  const label = kind === 'board' ? '组介绍' : '项目介绍';
  // 归属键：board 用 id（回落 key），repo 只用 key——两者都是 falsy 即「无归属」
  const ownerKey = (kind === 'board' ? owner?.id || owner?.key : owner?.key) || '';
  const ownerName = owner?.name;

  const docRef = useMemo(() => introRefOf(owner, kind), [owner, kind]);

  const [links, setLinks] = useState<IntroLink[]>([]); // [{ docId, label, note, main }]
  // 主篇 docId：以后端返回的「介绍文档集」为准（目录 index.md 优先，
  // 旧单文件回落）；拿不到才用 prop 推的 docRef。
  const [mainDocId, setMainDocId] = useState("");
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  // 介绍文档集：repo → /api/repos/docs；board → owner.docLinks（主篇另算）
  useEffect(() => {
    let alive = true;
    if (!ownerKey) {
      setLinks([]);
      return undefined;
    }
    if (kind === 'repo') {
      api('/api/repos/docs?id=' + encodeURIComponent(ownerKey))
        .then((d) => {
          if (!alive) return;
          const out: IntroLink[] = [];
          // 主篇：文档集的主篇（目录 index.md 优先 → 旧单文件回落）
          // 响应是外部数据（/api/repos/docs）：按后端字段读，逐段收口
          const main = (d?.main || null) as IntroDocEntry | null;
          const mid = linkDocId(main);
          setMainDocId(mid || docRef);
          if (mid && main) {
            out.push({ docId: mid, label: main.rel || main.path || '主篇', note: main.note || '', tag: main.tag || '', main: true, ref: main.ref || '' });
          }
          // 其余：介绍目录里的补充说明（同一目录下的其他 md）
          for (const l of (d?.extras || []) as IntroDocEntry[]) {
            const id = linkDocId(l);
            if (id) out.push({ docId: id, label: l.name || l.rel || l.path || '补充', note: l.note || '', tag: l.tag || '', main: false, ref: l.ref || '' });
          }
          // 登记在册的补充文档（外部 / ref 仓库里的文件）
          for (const l of (d?.links || []) as IntroDocEntry[]) {
            const id = linkDocId(l);
            // ref 随条目留着：ref 形态的链接（参考仓库内文件）不能按 rel 回写，标签编辑要对它关掉
            if (id) out.push({ docId: id, label: l.rel || l.path || '补充', note: l.note || '', tag: l.tag || '', main: false, ref: l.ref || '' });
          }
          setLinks(out);
        })
        .catch(() => { if (alive) { setLinks([]); setMainDocId(docRef); } });
    } else {
      // board 分支拉实时数据（GET /api/boards/:id）而不是读 owner prop——
      // owner 是父层的 repoData 快照，addRef / 改 tag 后不会自动刷新：
      // 旧实现读 prop 导致「＋ ref 之后补充行不出现，要刷新页面才见」（既有缺陷）。
      const fromOwner = () => {
        const out: IntroLink[] = [];
        if (docRef) out.push({ docId: docRef, label: '主篇', note: '', tag: '', main: true, ref: '' });
        for (const l of owner?.docLinks || []) {
          const id = linkDocId(l);
          if (id) out.push({ docId: id, label: l.rel || l.path || '补充', note: l.note || '', tag: l.tag || '', main: false, ref: l.ref || '' });
        }
        return out;
      };
      api('/api/boards/' + encodeURIComponent(String(ownerKey)))
        .then((bd) => {
          if (!alive) return;
          const links = Array.isArray(bd && bd.docLinks) ? (bd.docLinks as IntroDocEntry[]) : null;
          if (!links) {
            setLinks(fromOwner());
            setMainDocId(docRef);
            return;
          }
          const out: IntroLink[] = [];
          // 主篇：文档集的主篇（目录 index.md 优先 → 旧单文件回落）
          const mid = linkDocId(bd?.introMain) || docRef;
          setMainDocId(mid);
          if (mid) out.push({ docId: mid, label: '主篇', note: '', tag: '', main: true, ref: '' });
          // 其余：介绍目录里的补充说明
          for (const l of (bd?.introExtras || []) as IntroDocEntry[]) {
            const id = linkDocId(l);
            if (id) out.push({ docId: id, label: l.name || l.rel || l.path || '补充', note: l.note || '', tag: l.tag || '', main: false, ref: l.ref || '' });
          }
          // ref 随条目留着：ref 形态的链接（参考仓库内文件）不能按 rel 回写，标签编辑要对它关掉
          for (const l of links) {
            const id = linkDocId(l);
            if (id) out.push({ docId: id, label: l.rel || l.path || '补充', note: l.note || '', tag: l.tag || '', main: false, ref: l.ref || '' });
          }
          setLinks(out);
        })
        .catch(() => { if (alive) { setLinks(fromOwner()); setMainDocId(docRef); } });
    }
    return () => { alive = false; };
  }, [kind, ownerKey, owner, docRef, tick]);

  const openExtra = useMemo<DocOpenExtra>(() => {
    if (kind === 'repo' && ownerKey) return { repoKey: ownerKey };
    if (kind === 'board' && ownerKey) return { boardKey: ownerKey, boardName: ownerName || '' };
    return {};
  }, [kind, ownerKey, ownerName]);

  /** 打开主篇（缺文档时 DocPanel 给「创建骨架」） */
  const openMain = useCallback(() => {
    const target = mainDocId || docRef;
    if (!target) return;
    openByDocId(target, null, openExtra);
  }, [mainDocId, docRef, openByDocId, openExtra]);

  const openDoc = useCallback(
    (id: string) => openByDocId(id, null, openExtra),
    [openByDocId, openExtra]
  );

  /** 追加一篇 reference（落盘 + 挂进介绍集；tag 可选，简介行渲染成小 chip） */
  const addRef = useCallback(async (dialog: DialogFn, toast?: ToastFn) => {
    if (!ownerKey || !docRef.startsWith('rel:')) {
      if (toast) toast('当前简介无法补充（需要自有树路径）');
      return null;
    }
    const res = await dialog({
      title: '补充介绍文档',
      input: true,
      tagInput: true,
      placeholder: '文档名（如 architecture / api-notes）',
      tagPlaceholder: '标签（可选，如 qa）',
    });
    if (res === null) return null;
    const name = typeof res === 'string' ? res : (res && res.value) || '';
    const tag = typeof res === 'object' && res ? (res.tag || '') : '';
    const slug = slugName(String(name).trim() || 'note').replace(/\.md$/i, '');
    const dir = introDirFromRef(docRef) || (kind === 'repo' ? `repo/${ownerKey}` : `board/${ownerName || ownerKey}`);
    const rel = `${dir}/reference/${slug}.md`;
    await api('/api/docs/item', {
      method: 'POST',
      body: { rel, body: `# ${String(name).trim() || slug}\n\n（待补）\n` },
    });
    try {
      if (kind === 'repo') {
        await api('/api/repos/docs', { method: 'POST', body: { id: ownerKey, rel, tag: tag || undefined } });
      } else {
        await api('/api/docs/link', { method: 'POST', body: { board: ownerKey, doc: rel, tag: tag || undefined } });
      }
    } catch {
      /* 集里已有 / 旧数据：文件已创建即可——同 doc 重复添加 = 更新（tag 以本次为准） */
    }
    if (toast) toast(`已补充：${rel}${tag ? ` [${tag}]` : ''}`);
    reload();
    openByDocId('rel:' + rel, null, openExtra);
    return rel;
  }, [ownerKey, docRef, kind, ownerName, openByDocId, openExtra, reload]);

  /** 改 / 清一篇补充文档的标签（同 doc 重复添加 = 更新该条，note 原样保留） */
  const setLinkTag = useCallback(async (docId: string, tag: string, cur?: { note?: string } | null) => {
    if (!ownerKey) throw new Error('缺少归属');
    const raw: { path?: string; rel?: string } = String(docId || '').startsWith('path:')
      ? { path: String(docId).slice(5) }
      : { rel: String(docId || '').startsWith('rel:') ? String(docId).slice(4) : String(docId || '') };
    const note = (cur && cur.note) || '';
    if (kind === 'repo') {
      await api('/api/repos/docs', {
        method: 'POST',
        body: { id: ownerKey, ...raw, note: note || undefined, tag: tag || undefined },
      });
    } else {
      await api('/api/docs/link', {
        method: 'POST',
        body: { board: ownerKey, doc: raw.path || raw.rel, note: note || undefined, tag: tag || undefined },
      });
    }
    reload();
  }, [ownerKey, kind, reload]);

  return {
    kind,
    label,
    ownerKey,
    docRef,
    mainDocId,
    links,
    openMain,
    openDoc,
    addRef,
    setLinkTag,
    reload,
    canEdit: !!docRef,
  };
}
