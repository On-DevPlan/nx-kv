// 简介（项目 / 项目组）共用数据与动作：
//   显示主篇、编辑/创建、列出补充文档、追加 reference。
// kind: 'repo' | 'board' —— API 与落盘路径不同，UI 语义相同。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { slugName } from '../../modules/md/md-parse.js';
import { useWikiNav } from '../../page/doc/index.jsx';

/** 主篇 docRef → 介绍目录（去掉 .md /index.md） */
export function introDirFromRef(docRef) {
  const rel = String(docRef || '').startsWith('rel:') ? String(docRef).slice(4) : '';
  if (!rel) return '';
  if (/\/index\.md$/i.test(rel)) return rel.replace(/\/index\.md$/i, '');
  if (/\.md$/i.test(rel)) return rel.replace(/\.md$/i, '');
  return rel.replace(/\/+$/, '');
}

/** 仓库 / 看板 → 主篇 docId */
export function introRefOf(owner, kind) {
  if (!owner) return '';
  if (owner.doc && owner.doc.path) return 'path:' + owner.doc.path;
  if (owner.doc && owner.doc.rel) return 'rel:' + owner.doc.rel;
  if (owner.docPath) return 'path:' + owner.docPath;
  if (owner.docRel) return 'rel:' + owner.docRel;
  if (kind === 'repo' && owner.key) return 'rel:repo/' + owner.key + '.md';
  return '';
}

function linkDocId(l) {
  if (!l) return '';
  if (l.rel) return 'rel:' + l.rel;
  if (l.path) return 'path:' + l.path;
  return '';
}

/**
 * @param {object} p
 * @param {'repo'|'board'} p.kind
 * @param {object|null} p.owner  repo 或 board 对象
 * @param {object} [p.model]    FlexLayout model（开文档页签）
 */
export function useIntro({ kind, owner, model }) {
  const { onClick: onNavClick, openByDocId } = useWikiNav(model);
  const label = kind === 'board' ? '组介绍' : '项目介绍';
  const ownerKey = kind === 'board' ? (owner && (owner.id || owner.key)) : (owner && owner.key);
  const ownerName = owner && owner.name;

  const docRef = useMemo(() => introRefOf(owner, kind), [owner, kind]);

  const [intro, setIntro] = useState(null);
  const [known, setKnown] = useState(null);
  const [links, setLinks] = useState([]); // [{ docId, label, note, main }]
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    api('/api/docs/index')
      .then((d) => {
        const set = new Set();
        for (const x of d.index || []) {
          set.add(x.name);
          if (x.rel) set.add(String(x.rel).toLowerCase());
          if (x.path) set.add(String(x.path).replace(/\\/g, '/').toLowerCase());
        }
        setKnown(set);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setIntro(null);
    if (!docRef) return undefined;
    api('/api/docs/item?ref=' + encodeURIComponent(docRef))
      .then((d) => { if (alive) setIntro(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [docRef, tick]);

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
          const out = [];
          if (d.main) {
            const id = linkDocId(d.main);
            if (id) out.push({ docId: id, label: d.main.rel || d.main.path || '主篇', note: d.main.note || '', main: true });
          }
          for (const l of d.links || []) {
            const id = linkDocId(l);
            if (id) out.push({ docId: id, label: l.rel || l.path || '补充', note: l.note || '', main: false });
          }
          setLinks(out);
        })
        .catch(() => { if (alive) setLinks([]); });
    } else {
      const out = [];
      if (docRef) out.push({ docId: docRef, label: '主篇', note: '', main: true });
      for (const l of owner?.docLinks || []) {
        const id = linkDocId(l);
        if (id) out.push({ docId: id, label: l.rel || l.path || '补充', note: l.note || '', main: false });
      }
      setLinks(out);
    }
    return () => { alive = false; };
  }, [kind, ownerKey, owner, docRef, tick]);

  const openExtra = useMemo(() => {
    if (kind === 'repo' && ownerKey) return { repoKey: ownerKey };
    if (kind === 'board' && ownerKey) return { boardKey: ownerKey, boardName: ownerName || '' };
    return {};
  }, [kind, ownerKey, ownerName]);

  const openEdit = useCallback(() => {
    if (!docRef) return;
    openByDocId(docRef, null, openExtra);
  }, [docRef, openByDocId, openExtra]);

  const openDoc = useCallback(
    (id) => openByDocId(id, null, openExtra),
    [openByDocId, openExtra]
  );

  /** 追加一篇 reference（落盘 + 挂进介绍集） */
  const addRef = useCallback(async (dialog, toast) => {
    if (!ownerKey || !docRef.startsWith('rel:')) {
      toast && toast('当前简介无法补充（需要自有树路径）');
      return null;
    }
    const name = await dialog({
      title: '补充介绍文档',
      input: true,
      placeholder: '文档名（如 architecture / api-notes）',
    });
    if (name === null) return null;
    const slug = slugName(String(name).trim() || 'note').replace(/\.md$/i, '');
    const dir = introDirFromRef(docRef) || (kind === 'repo' ? `repo/${ownerKey}` : `board/${ownerName || ownerKey}`);
    const rel = `${dir}/reference/${slug}.md`;
    await api('/api/docs/item', {
      method: 'POST',
      body: { rel, body: `# ${String(name).trim() || slug}\n\n（待补）\n` },
    });
    try {
      if (kind === 'repo') {
        await api('/api/repos/docs', { method: 'POST', body: { id: ownerKey, rel } });
      } else {
        await api('/api/docs/link', { method: 'POST', body: { board: ownerKey, doc: rel } });
      }
    } catch {
      /* 集里已有 / 旧数据：文件已创建即可 */
    }
    toast && toast(`已补充：${rel}`);
    reload();
    openByDocId('rel:' + rel, null, openExtra);
    return rel;
  }, [ownerKey, docRef, kind, ownerName, openByDocId, openExtra, reload]);

  return {
    kind,
    label,
    ownerKey,
    docRef,
    intro,
    known,
    links,
    onNavClick,
    openEdit,
    openDoc,
    addRef,
    reload,
    canEdit: !!docRef,
  };
}
