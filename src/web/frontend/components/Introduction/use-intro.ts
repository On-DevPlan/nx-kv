// 简介数据（项目 / 项目组共用）：页面上只留一行**文字超链接**，
// 点开 DocPanel 阅读/编辑——正文渲染、标题滚动目录、双链全在文档页签里。
// kind: 'repo' | 'board' —— API 与落盘路径不同，UI 语义相同。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Model } from 'flexlayout-react';
import { api } from '../../api/client.js';
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
  reload: () => void;
  canEdit: boolean;
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

  return {
    kind,
    label,
    ownerKey,
    docRef,
    mainDocId,
    links,
    openMain,
    openDoc,
    reload,
    canEdit: !!docRef,
  };
}
