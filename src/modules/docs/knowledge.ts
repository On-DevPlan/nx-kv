// 复合知识查询：一个仓库的完整上下文，一次取齐（agent 领取任务后的供料口）。
// `repo knowledge --md` 给出项目介绍 + 组介绍 + 组内描述 + 组绑定文档 + 参考仓库文本；
// 自有文档正文来自库内 `ref_bodies`；外部文档按 refs.locator 读盘（闭包内）。
//
// v8 读取规则：宿主 ext 里的 DocRef 只有 refId；没有约定路径、没有惰性播种。
// 单文件 256KB 截断：知识是给人/模型读的，不是备份通道。
import * as store from './store.js';
import { reposBridge } from './repos-bridge.js';
import { getDb } from '../../core/db/index.js';
import { refDocById } from '../../core/attachmentdb.js';
import { renderRepoKnowledgeMd } from './knowledge-md.js';
import type { DocRef } from './docref.js';

const MAX_DOC_BYTES = 256 * 1024;

/** 知识查询的文档条目（自有/外部/missing/目录/补充文档共用；外部 JSON 形状）。 */
export interface KnowledgeDoc {
  docId?: string;
  refId?: string;
  title?: string;
  body?: string;
  abs?: string;
  name?: string;
  path?: string;
  note?: string;
  tag?: string;
  missing?: boolean;
  dir?: boolean;
  files?: string[];
  isReference?: boolean;
  [key: string]: any;
}

/** 介绍文档集（introSetOf 的产出）。 */
export interface IntroSet {
  main: KnowledgeDoc | null;
  extras: KnowledgeDoc[];
  count: number;
}

/** 组知识（repoKnowledge 的 boards 条目）。 */
export interface BoardKnowledge {
  name: string;
  key: string;
  intro: KnowledgeDoc;
  introSet: IntroSet;
  note: KnowledgeDoc;
  docLinks: KnowledgeDoc[];
  externalDirs: KnowledgeDoc[];
}

/** 参考仓库条目。 */
export interface RefRepoItem {
  name: string;
  path: string;
  remote: string;
  note: string;
  groups: string[];
  direct: boolean;
}

/** 仓库知识报告（repoKnowledge 的出参）。 */
export interface RepoKnowledgeResult {
  repo: { key: string; name: string; path: string; desc: string; remote: string; type: string };
  intro: KnowledgeDoc | null;
  introSet: IntroSet;
  boards: BoardKnowledge[];
  refRepos: RefRepoItem[];
  warnings: string[];
  md?: string;
}

/** readOwn / readExternal 的读侧选项。 */
interface ReadOpts {
  warnings?: string[];
  label?: string;
}

async function listDirMd(dir: string): Promise<string[]> {
  const fsp = await import('node:fs/promises');
  const out: string[] = [];
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > 3 || out.length >= 200) return;
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= 200) return;
      const abs = (await import('node:path')).join(d, e.name);
      if (e.isDirectory() && !['node_modules', '.git', '.obsidian'].includes(e.name)) await walk(abs, depth + 1);
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push(abs);
    }
  };
  await walk(dir, 1);
  return out;
}

async function readExternalDoc(abs: unknown, { warnings, label }: ReadOpts): Promise<KnowledgeDoc> {
  let st: Awaited<ReturnType<typeof import('node:fs/promises').stat>> | null = null;
  try {
    st = await import('node:fs/promises').then((m) => m.stat(abs as string));
  } catch {
    /* 缺失走 missing */
  }
  if (!st) return { missing: true, docId: store.externalDocId(abs as string), path: abs as string };
  if (st.isDirectory()) {
    return { dir: true, docId: store.externalDocId(abs as string), path: abs as string, files: await listDirMd(abs as string) };
  }
  let body: string;
  try {
    body = await import('node:fs/promises').then((m) => m.readFile(abs as string, 'utf8'));
  } catch {
    return { missing: true, docId: store.externalDocId(abs as string), path: abs as string };
  }
  return docOut(store.externalDocId(abs as string), body, { warnings, label });
}

function docOut(docId: string, body: unknown, { warnings, label }: ReadOpts): KnowledgeDoc {
  const text = String(body || '');
  let out = text;
  if (Buffer.byteLength(text, 'utf8') > MAX_DOC_BYTES) {
    out = Buffer.from(text, 'utf8').slice(0, MAX_DOC_BYTES).toString('utf8');
    if (warnings) warnings.push(`${label || docId} 超过 256KB —— 已截断（完整内容用 nx-kv docs get --ref 读取）`);
  }
  const m = /^#\s+(.+)$/m.exec(out);
  return { docId, title: m ? (m[1] ?? '').trim() : '', body: out };
}

/** 读一条 DocRef{ref}：自有 / 外部单文件 / 外部目录（展开成多篇）。 */
async function readRefDocs(raw: DocRef | null | undefined, opts: ReadOpts): Promise<KnowledgeDoc[]> {
  const refId = String((raw && raw.ref) || '');
  if (!refId) return [];
  const row = refDocById(getDb(), refId);
  if (!row) return [{ missing: true, refId, docId: 'ref:' + refId }];
  if (row.origin === 'external' && row.locator) {
    const one = await readExternalDoc(row.locator, opts);
    if (one.dir) {
      const files = one.files || [];
      const docs: KnowledgeDoc[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const d = await readExternalDoc(files[i], opts);
        docs.push({ ...d, refId, name: String(files[i]).replace(/\\/g, '/').split('/').pop() || '' });
      }
      return docs;
    }
    return [{ ...one, refId, note: String((raw && raw.note) || ''), tag: String((raw && raw.tag) || '') }];
  }
  if (!row.hasBody) {
    return [{
      missing: true,
      refId,
      docId: 'ref:' + refId,
      title: row.desc,
      note: String((raw && raw.note) || ''),
      tag: String((raw && raw.tag) || ''),
    }];
  }
  return [{
    ...docOut('ref:' + refId, row.body ?? '', opts),
    refId,
    note: String((raw && raw.note) || ''),
    tag: String((raw && raw.tag) || ''),
  }];
}

/** 宿主的介绍文档集：主篇（doc）+ 补充篇（docLinks）。 */
async function introSetOf(host: any, opts: ReadOpts): Promise<IntroSet> {
  const mainDocs = await readRefDocs(host && host.doc, opts);
  const main = mainDocs[0] || null;
  const extras: KnowledgeDoc[] = mainDocs.slice(1);
  for (const l of Array.isArray(host && host.docLinks) ? host.docLinks : []) {
    extras.push(...(await readRefDocs(l, opts)));
  }
  return { main, extras, count: (main ? 1 : 0) + extras.length };
}

/**
 * 仓库知识聚合。locator: id / key / 路径 / 名称（缺省 = 当前目录）。
 * md=true 时额外返回 md 文本。
 */
export async function repoKnowledge(locator?: string, { md = false }: { md?: boolean } = {}): Promise<RepoKnowledgeResult> {
  const { getRepo, loadStore, deriveKey, boardKeyOf, boardRepoKeys } = await reposBridge();
  let repo: any;
  try {
    repo = await getRepo(locator || process.cwd());
  } catch (err) {
    const e = err as { name?: string } | null;
    if (!locator && e && e.name === 'AppError') {
      throw Object.assign(err as object, {
        message: '当前目录不在已登记仓库内——请给 repo id / key / 路径，或先 repo add 登记',
      });
    }
    throw err;
  }
  const s = await loadStore();
  const rk = deriveKey(repo);
  const warnings: string[] = [];

  const introSet = await introSetOf(repo, { warnings, label: '项目介绍' });
  const intro: KnowledgeDoc | null = introSet.main;

  const boards: BoardKnowledge[] = [];
  for (const b of s.boards) {
    const members = boardRepoKeys(b, s);
    if (!members.includes(rk)) continue;
    const bkey = boardKeyOf(b.name);
    const bIntroSet = await introSetOf(b, { warnings, label: `组介绍·${b.name}` });
    const bIntro: KnowledgeDoc = bIntroSet.main || { missing: true };
    const noteDocs = await readRefDocs((b.repoDocs || {})[rk], { warnings, label: `组内描述·${b.name}/${rk}` });
    const note = noteDocs[0] || { missing: true };
    const docLinks: KnowledgeDoc[] = [];
    const externalDirs: KnowledgeDoc[] = [];
    for (const d of bIntroSet.extras) {
      if (d.dir) externalDirs.push(d);
      else docLinks.push(d);
    }
    boards.push({ name: b.name, key: bkey, intro: bIntro, introSet: bIntroSet, note, docLinks, externalDirs });
  }

  // 参考仓库（repos 里 type=ref，不是文档库 refs）：两类来源并存——组级
  // （group_refs，组内共享）与仓库级（dev.linked）。同一个参考仓库出现多次只列
  // 一次，groups 记它来自哪些组，direct 记它是否直接绑在本仓库。
  const refRepos: RefRepoItem[] = [];
  const seenRefRepos = new Map<string, RefRepoItem>();
  for (const b of s.boards) {
    if (!boardRepoKeys(b, s).includes(rk)) continue;
    for (const l of Array.isArray(b.refs) ? b.refs : []) {
      const r = s.repos.find((x: any) => deriveKey(x) === l.id);
      if (!r) continue;
      const hit = seenRefRepos.get(l.id);
      if (hit) {
        if (!hit.groups.includes(b.name)) hit.groups.push(b.name);
        if (l.note && !hit.note) hit.note = l.note;
        continue;
      }
      const item: RefRepoItem = { name: r.name, path: r.path || '', remote: r.remote || '', note: l.note || '', groups: [b.name], direct: false };
      seenRefRepos.set(l.id, item);
      refRepos.push(item);
    }
  }
  for (const l of Array.isArray(repo.linked) ? repo.linked : []) {
    if (!l || l.kind !== 'ref') continue;
    const id = String(l.id);
    const r = s.repos.find((x: any) => deriveKey(x) === id);
    if (!r) continue;
    const hit = seenRefRepos.get(id);
    if (hit) {
      hit.direct = true;
      if (l.note && !hit.note) hit.note = l.note;
      continue;
    }
    const item: RefRepoItem = { name: r.name, path: r.path || '', remote: r.remote || '', note: l.note || '', groups: [], direct: true };
    seenRefRepos.set(id, item);
    refRepos.push(item);
  }

  const out: RepoKnowledgeResult = {
    repo: { key: rk, name: repo.name, path: repo.path, desc: repo.desc || '', remote: repo.remote || '', type: repo.type || 'dev' },
    intro,
    introSet,
    boards,
    refRepos,
    warnings,
  };
  if (md) out.md = renderRepoKnowledgeMd(out);
  return out;
}

// 单篇 markdown 渲染在 knowledge-md.ts（保持本文件在行数门禁内）

/**
 * **项目组上下文**（交付层用）：某个工作目录所属仓库所在的项目组材料。
 *
 * 只取交付时必须带上的部分——项目介绍、组定位、组介绍、本项目在组里的位置、
 * 兄弟成员的组内描述、组绑定参考文件的可读路径。
 */
export async function groupContextFor(cwd: unknown, { board = '' }: { board?: string } = {}): Promise<GroupContextResult | null> {
  const { loadStore, deriveKey, boardKeyOf, boardRepoKeys, normalizePathKey } = await reposBridge();
  const s = await loadStore();
  const want = normalizePathKey(cwd);
  if (!want) return null;
  const repo = s.repos.find((r: any) => normalizePathKey(r.path) === want);
  if (!repo) return null; // 没登记的目录：没有项目，也没有组
  const rk = deriveKey(repo);
  const warnings: string[] = [];
  const groups: GroupContextGroup[] = [];

  // 项目主篇：repo.doc；其余 docLinks 只给 desc + 取用指令（不内嵌）。
  const repoDocs = await readRefDocs(repo.doc, { warnings, label: '项目介绍' });
  const repoMain = repoDocs[0] || null;
  const repoIntro: ContextIntro = {
    body: (repoMain && repoMain.body) || '',
    path: '',
    title: (repoMain && repoMain.title) || '',
    refId: (repoMain && repoMain.refId) || '',
    desc: '',
  };
  const repoDocLinks: BoundDoc[] = (Array.isArray(repo.docLinks) ? repo.docLinks : []).map((l: any) => ({
    refId: String(l.ref || ''),
    desc: String(l.note || ''),
    title: '',
    hasBody: true,
    origin: '',
    type: 'repo' as const,
    repoKey: rk,
    groupKey: null,
    position: 0,
    note: String(l.note || ''),
    body: '',
  }));

  // 参考仓库（repos 里 type=ref，不是文档库 refs）：本仓库直接绑定与组级绑定
  // 是两类并列来源，交付时要给「名称 + 本机路径 + 一句描述」。
  const refRepoItemOf = (id: unknown, note?: string): { key: string; name: string; path: string; note: string } | null => {
    const rr = s.repos.find((x: any) => x.type === 'ref' && deriveKey(x) === String(id));
    if (!rr) return null;
    return { key: String(id), name: rr.name, path: rr.path || '', note: note || '' };
  };
  const repoRefRepos = (Array.isArray(repo.linked) ? repo.linked : [])
    .filter((l: any) => l && l.kind === 'ref')
    .map((l: any) => refRepoItemOf(l.id, l.note))
    .filter(Boolean) as Array<{ key: string; name: string; path: string; note: string }>;

  // #64 作用域：只有组任务（正文 frontmatter 带 board）才挂组上下文。
  const wantBoard = String(board || '').trim();
  for (const b of s.boards) {
    if (!wantBoard) continue;
    const members = boardRepoKeys(b, s);
    if (!members.includes(rk)) continue;
    if (![String(b.id || ''), String(b.key || ''), boardKeyOf(b.name), String(b.name || '')].includes(wantBoard)) continue;
    const gkey = String(b.key || boardKeyOf(b.name));
    const gDocs = await readRefDocs(b.doc, { warnings, label: `组介绍·${b.name}` });
    const gMain = gDocs[0] || null;
    const intro: ContextIntro = {
      body: (gMain && gMain.body) || '',
      path: '',
      title: (gMain && gMain.title) || '',
      refId: (gMain && gMain.refId) || '',
      desc: '',
    };
    const docLinks: BoundDoc[] = (Array.isArray(b.docLinks) ? b.docLinks : []).map((l: any) => ({
      refId: String(l.ref || ''),
      desc: String(l.note || ''),
      title: '',
      hasBody: true,
      origin: '',
      type: 'group' as const,
      repoKey: gkey,
      groupKey: null,
      position: 0,
      note: String(l.note || ''),
      body: '',
    }));
    // 本项目在组里的位置
    const noteDocs = await readRefDocs((b.repoDocs || {})[rk], { warnings, label: `组内描述·${b.name}` });
    const noteOwn = noteDocs[0] || null;
    // 兄弟成员（组内各仓库的组内描述）
    const peers: Array<{ name: string; note: string; path: string }> = [];
    for (const mkey of members) {
      const mr = s.repos.find((x: any) => deriveKey(x) === mkey);
      const mname = mr ? mr.name : mkey;
      if (mkey === rk) continue;
      const peerDocs = await readRefDocs((b.repoDocs || {})[mkey], { warnings, label: `组内描述·${b.name}/${mkey}` });
      const peer = peerDocs[0];
      peers.push({
        name: mname,
        note: (peer && peer.body) || (b.repoNotes || {})[mkey] || '',
        path: (mr && mr.path) || '',
      });
    }
    groups.push({
      name: b.name,
      key: gkey,
      desc: b.desc || '',
      intro,
      introSet: { main: null, extras: [], count: 0 },
      note: ((noteOwn && noteOwn.body) || (b.repoNotes || {})[rk] || ''),
      peers,
      docLinks,
      refRepos: (Array.isArray(b.refs) ? b.refs : []).map((l: any) => refRepoItemOf(l.id, l.note)).filter(Boolean) as Array<{ key: string; name: string; path: string; note: string }>,
    });
  }
  return {
    repo: { name: repo.name, key: rk, intro: repoIntro, introSet: { main: null, extras: [], count: 0 }, docLinks: repoDocLinks, refRepos: repoRefRepos },
    groups,
  };
}

/** 介绍主篇（提示词用）：正文 + desc + refId；没有路径。 */
export interface ContextIntro {
  body: string;
  path: string;
  title: string;
  refId: string;
  desc: string;
}

/** groupContextFor 的组条目。 */
export interface GroupContextGroup {
  name: string;
  key: string;
  desc: string;
  intro: ContextIntro;
  introSet: IntroSet;
  note: string;
  peers: Array<{ name: string; path: string; note: string }>;
  docLinks: BoundDoc[];
  refRepos: Array<{ key: string; name: string; path: string; note: string }>;
}

/** groupContextFor 的出参。 */
export interface GroupContextResult {
  repo: {
    name: string;
    key: string;
    intro: ContextIntro;
    introSet: IntroSet;
    docLinks: BoundDoc[];
    refRepos: Array<{ key: string; name: string; path: string; note: string }>;
  };
  groups: GroupContextGroup[];
}

/** bound-docs 的行形状（这里只用于给模板留的占位结构）。 */
interface BoundDoc {
  refId: string;
  desc: string;
  title: string;
  hasBody: boolean;
  origin: string;
  type: 'repo' | 'group' | 'group_repo';
  repoKey: string;
  groupKey: string | null;
  position: number;
  note: string;
  body: string;
}
