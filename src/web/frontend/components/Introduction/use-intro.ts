// 简介数据（项目 / 项目组共用）：页面上只留一行**文字超链接**，
// 点开 DocPanel 阅读/编辑——正文渲染、标题滚动目录、双链全在文档页签里。
// kind: 'repo' | 'board' —— API 不同，UI 语义相同；文档一律用 ref:<refId> 寻址。
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
}

/**
 * 后端给的文档条目（/api/repos/docs 的 main / links，
 * board 的 introMain / introExtras）。外部数据边界：字段按后端 schema 出现。
 */
export interface IntroDocEntry {
  refId?: string;
  docId?: string;
  title?: string;
  desc?: string;
  note?: string;
  tag?: string;
  [k: string]: any;
}

/** 仓库所属组的一行（owner.boards[]：组内描述文档的定位来源）。 */
export interface IntroScopedBoard {
  name?: string;
  note?: string;
  /** 组内描述文档（ref:<refId>） */
  noteDocId?: string;
  [k: string]: any;
}

/** 简介归属对象（仓库行 / 看板行，即 repoData 快照）。 */
export interface IntroOwner {
  key?: string;
  id?: string;
  name?: string;
  /** 主篇（refId） */
  doc?: { ref?: string };
  /** 组介绍主篇（ref:<refId>） */
  docId?: string;
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

/** 仓库 / 看板 → 主篇 docId（ref:<refId>） */
export function introRefOf(owner: IntroOwner | null | undefined, _kind?: IntroKind): string {
  if (!owner) return '';
  if (owner.doc && owner.doc.ref) return 'ref:' + owner.doc.ref;
  if (owner.docId) return owner.docId;
  return '';
}

function linkDocId(l: IntroDocEntry | null | undefined): string {
  if (!l) return '';
  if (l.docId) return l.docId;
  if (l.refId) return 'ref:' + l.refId;
  return '';
}

function labelOf(l: IntroDocEntry | null | undefined, fallback: string): string {
  if (!l) return fallback;
  return String(l.title || l.desc || fallback);
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

  const [links, setLinks] = useState<IntroLink[]>([]);
  const [mainDocId, setMainDocId] = useState('');
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  // 介绍文档集：repo → /api/repos/docs；board → GET /api/boards/:id
  useEffect(() => {
    let alive = true;
    if (!ownerKey) {
      setLinks([]);
      setMainDocId('');
      return undefined;
    }
    const apply = (main: IntroDocEntry | null, extras: IntroDocEntry[]) => {
      const out: IntroLink[] = [];
      const mid = linkDocId(main);
      setMainDocId(mid || docRef);
      if (mid && main) {
        out.push({ docId: mid, label: labelOf(main, '主篇'), note: main.note || '', tag: main.tag || '', main: true });
      }
      for (const l of extras) {
        const id = linkDocId(l);
        if (id) out.push({ docId: id, label: labelOf(l, '补充'), note: l.note || '', tag: l.tag || '', main: false });
      }
      setLinks(out);
    };
    if (kind === 'repo') {
      api('/api/repos/docs?id=' + encodeURIComponent(ownerKey))
        .then((d) => {
          if (!alive) return;
          apply((d?.main || null) as IntroDocEntry | null, (d?.links || []) as IntroDocEntry[]);
        })
        .catch(() => { if (alive) { setLinks([]); setMainDocId(docRef); } });
    } else {
      api('/api/boards/' + encodeURIComponent(String(ownerKey)))
        .then((bd) => {
          if (!alive) return;
          apply((bd?.introMain || null) as IntroDocEntry | null, (bd?.introExtras || []) as IntroDocEntry[]);
        })
        .catch(() => { if (alive) { setLinks([]); setMainDocId(docRef); } });
    }
    return () => { alive = false; };
  }, [kind, ownerKey, docRef, tick]);

  const openExtra = useMemo<DocOpenExtra>(() => {
    if (kind === 'repo' && ownerKey) return { repoKey: ownerKey };
    if (kind === 'board' && ownerKey) return { boardKey: ownerKey, boardName: ownerName || '' };
    return {};
  }, [kind, ownerKey, ownerName]);

  /** 打开主篇 */
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
    canEdit: !!mainDocId || !!docRef,
  };
}
