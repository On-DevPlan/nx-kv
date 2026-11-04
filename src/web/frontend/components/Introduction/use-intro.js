// 简介数据（项目 / 项目组共用）：页面上只留一行**文字超链接**，
// 点开 DocPanel 阅读/编辑——正文渲染、标题滚动目录、双链全在文档页签里。
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
  const { openByDocId } = useWikiNav(model);
  const label = kind === 'board' ? '组介绍' : '项目介绍';
  const ownerKey = kind === 'board' ? (owner && (owner.id || owner.key)) : (owner && owner.key);
  const ownerName = owner && owner.name;

  const docRef = useMemo(() => introRefOf(owner, kind), [owner, kind]);

  const [links, setLinks] = useState([]); // [{ docId, label, note, main }]
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
          const out = [];
          if (d.main) {
            const id = linkDocId(d.main);
            if (id) out.push({ docId: id, label: d.main.rel || d.main.path || '主篇', note: d.main.note || '', tag: d.main.tag || '', main: true, ref: d.main.ref || '' });
          }
          for (const l of d.links || []) {
            const id = linkDocId(l);
            // ref 随条目留着：ref 形态的链接（参考仓库内文件）不能按 rel 回写，标签编辑要对它关掉
            if (id) out.push({ docId: id, label: l.rel || l.path || '补充', note: l.note || '', tag: l.tag || '', main: false, ref: l.ref || '' });
          }
          setLinks(out);
        })
        .catch(() => { if (alive) setLinks([]); });
    } else {
      // board 分支拉实时数据（GET /api/boards/:id）而不是读 owner prop——
      // owner 是父层的 repoData 快照，addRef / 改 tag 后不会自动刷新：
      // 旧实现读 prop 导致「＋ ref 之后补充行不出现，要刷新页面才见」（既有缺陷）。
      const fromOwner = () => {
        const out = [];
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
          const links = Array.isArray(bd && bd.docLinks) ? bd.docLinks : null;
          if (!links) {
            setLinks(fromOwner());
            return;
          }
          const out = [];
          if (docRef) out.push({ docId: docRef, label: '主篇', note: '', tag: '', main: true, ref: '' });
          // ref 随条目留着：ref 形态的链接（参考仓库内文件）不能按 rel 回写，标签编辑要对它关掉
          for (const l of links) {
            const id = linkDocId(l);
            if (id) out.push({ docId: id, label: l.rel || l.path || '补充', note: l.note || '', tag: l.tag || '', main: false, ref: l.ref || '' });
          }
          setLinks(out);
        })
        .catch(() => { if (alive) setLinks(fromOwner()); });
    }
    return () => { alive = false; };
  }, [kind, ownerKey, owner, docRef, tick]);

  const openExtra = useMemo(() => {
    if (kind === 'repo' && ownerKey) return { repoKey: ownerKey };
    if (kind === 'board' && ownerKey) return { boardKey: ownerKey, boardName: ownerName || '' };
    return {};
  }, [kind, ownerKey, ownerName]);

  /** 打开主篇（缺文档时 DocPanel 给「创建骨架」） */
  const openMain = useCallback(() => {
    if (!docRef) return;
    openByDocId(docRef, null, openExtra);
  }, [docRef, openByDocId, openExtra]);

  const openDoc = useCallback(
    (id) => openByDocId(id, null, openExtra),
    [openByDocId, openExtra]
  );

  /** 追加一篇 reference（落盘 + 挂进介绍集；tag 可选，简介行渲染成小 chip） */
  const addRef = useCallback(async (dialog, toast) => {
    if (!ownerKey || !docRef.startsWith('rel:')) {
      toast && toast('当前简介无法补充（需要自有树路径）');
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
    toast && toast(`已补充：${rel}${tag ? ` [${tag}]` : ''}`);
    reload();
    openByDocId('rel:' + rel, null, openExtra);
    return rel;
  }, [ownerKey, docRef, kind, ownerName, openByDocId, openExtra, reload]);

  /** 改 / 清一篇补充文档的标签（同 doc 重复添加 = 更新该条，note 原样保留） */
  const setLinkTag = useCallback(async (docId, tag, cur) => {
    if (!ownerKey) throw new Error('缺少归属');
    const raw = String(docId || '').startsWith('path:')
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
    links,
    openMain,
    openDoc,
    addRef,
    setLinkTag,
    reload,
    canEdit: !!docRef,
  };
}
