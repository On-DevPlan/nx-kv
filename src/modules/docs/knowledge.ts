// 复合知识查询：一个仓库的完整上下文，一次取齐。
//
// 这是「get 时封装上下文」的供料口：agent 领到某个仓库的任务后，
// `nx-kv repo knowledge --md` 给出项目介绍 + 所属组介绍 + 组内描述 + 组绑定文档 +
// 参考仓库的单篇文本——自有文档正文来自库内 `ref_bodies`，不再读盘。
//
// 读取规则：
//   - 绑定优先（DocRef），缺省走约定路径；约定路径缺失时惰性播种（字符串字段非空）
//   - 外部目录绑定只列文件清单，不进全文（目录全文没有边界）
//   - 单文件 256KB 截断：知识是给人/模型读的，不是备份通道
import { sep } from 'node:path';
import * as paths from './paths.js';
import * as store from './store.js';
import { ensureSeedForRel } from './seed.js';
import { reposBridge } from './repos-bridge.js';
import type { DocRef } from './docref.js';

const MAX_DOC_BYTES = 256 * 1024;

/** 知识查询的文档条目（自有/外部/missing/目录/补充文档共用；外部 JSON 形状）。 */
export interface KnowledgeDoc {
  docId?: string;
  title?: string;
  body?: string;
  abs?: string;
  name?: string;
  rel?: string;
  path?: string;
  note?: string;
  tag?: string;
  missing?: boolean;
  dir?: boolean;
  files?: string[];
  isReference?: boolean;
  [key: string]: any;
}

/** 介绍文档集（readIntroSet 的产出）。 */
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

/** readOwn / readRef 的读侧选项。 */
interface ReadOpts {
  warnings?: string[];
  label?: string;
}

// 读自有文档（约定路径可惰性播种）；返回 {docId, title, body} | {missing:true}
async function readOwn(rel: string, { warnings, label }: ReadOpts): Promise<KnowledgeDoc> {
  let body: string | null = null;
  try {
    body = await store.readOwnDoc(rel);
  } catch {
    const seeded = await ensureSeedForRel(rel);
    if (seeded === null) return { missing: true, docId: paths.ownDocId(rel) };
    body = seeded;
  }
  return docOut(paths.ownDocId(rel), body, { warnings, label });
}

// 读外部绑定（闭包校验由调用方完成——这里的 ref 全部来自 store 登记本身）
async function readExternalDoc(abs: unknown, { warnings, label }: ReadOpts): Promise<KnowledgeDoc> {
  let st: Awaited<ReturnType<typeof import('node:fs/promises').stat>> | null = null;
  try {
    st = await import('node:fs/promises').then((m) => m.stat(abs as string));
  } catch {
    /* 缺失走 missing */
  }
  if (!st) return { missing: true, docId: paths.extDocId(abs as string) };
  if (st.isDirectory()) return { dir: true, docId: paths.extDocId(abs as string), files: await listDirMd(abs as string) };
  let body: string;
  try {
    body = await import('node:fs/promises').then((m) => m.readFile(abs as string, 'utf8'));
  } catch {
    return { missing: true, docId: paths.extDocId(abs as string) };
  }
  return docOut(paths.extDocId(abs as string), body, { warnings, label });
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

// 统一出参：title = 首个 # 标题；超限截断并记 warning
function docOut(docId: string, body: unknown, { warnings, label }: ReadOpts): KnowledgeDoc {
  const text = String(body || '');
  let out = text;
  if (Buffer.byteLength(text, 'utf8') > MAX_DOC_BYTES) {
    out = Buffer.from(text, 'utf8').slice(0, MAX_DOC_BYTES).toString('utf8');
    if (warnings) warnings.push(`${label || docId} 超过 256KB —— 已截断（完整内容直接读文件: ${docId}）`);
  }
  const m = /^#\s+(.+)$/m.exec(out);
  return { docId, title: m ? (m[1] ?? '').trim() : '', body: out };
}

/** 单元格文档读取：DocRef（自有 / 外部 / **ref 仓库内**）→ 出参；缺省 ref 走约定路径 */
async function readRef(ref: DocRef | null | undefined, fallbackRel: string, opts: ReadOpts): Promise<KnowledgeDoc> {
  if (!ref || ref.rel) return readOwn((ref && ref.rel) || fallbackRel, opts);
  return readExternalDoc(ref.path, opts);
}

/**
 * 仓库知识聚合。locator: id / key / 路径 / 名称（缺省 = 当前目录）。
 * md=true 时额外返回 md 文本（get 封装直接可用的单篇形态）。
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
  const closure = await store.externalClosure(s);

  // 介绍是**文档集**（主篇 + 其余各篇）——#58
  const introSet = await readIntroSet({
    dirRel: paths.repoDocDirRel(rk),
    legacyRel: paths.repoDocRel(rk),
    ref: repo.doc,
    links: repo.docLinks,
    warnings,
    label: '项目介绍',
  });
  const intro: KnowledgeDoc = introSet.main ? { ...introSet.main } : { missing: true, docId: paths.repoDocRel(rk) };

  // 所属组：显式成员（与 listBoards 同一口径）
  const boards: BoardKnowledge[] = [];
  for (const b of s.boards) {
    const members = boardRepoKeys(b, s);
    if (!members.includes(rk)) continue;
    const bkey = boardKeyOf(b.name);
    const bIntroSet = await readIntroSet({
      dirRel: paths.boardDocDirRel(b.name),
      legacyRel: paths.boardDocRel(b.name),
      ref: b.doc,
      links: b.docLinks,
      warnings,
      label: `组介绍·${b.name}`,
    });
    const bIntro: KnowledgeDoc = bIntroSet.main ? { ...bIntroSet.main } : { missing: true, docId: paths.boardDocRel(b.name) };
    const noteRef = (b.repoDocs || {})[rk];
    const note = await readRef(noteRef, paths.groupNoteRel(b.name, rk), { warnings, label: `组内描述·${b.name}/${rk}` });
    // 组级附加文档：自有/单文件进全文；目录绑定只列清单
    const docLinks: KnowledgeDoc[] = [];
    const externalDirs: KnowledgeDoc[] = [];
    for (const l of Array.isArray(b.docLinks) ? b.docLinks : []) {
      const meta = l.tag ? { tag: l.tag } : {};
      if (l.rel) {
        docLinks.push({ note: l.note || '', ...meta, ...(await readOwn(l.rel, { warnings, label: `组绑定·${l.rel}` })) });
        continue;
      }
      const abs = l.path && store.resolveExternal(l.path, closure);
      if (!abs) {
        if (l.path) warnings.push(`组绑定「${l.path}」不在绑定闭包内 —— 已跳过`);
        continue;
      }
      const st = await import('node:fs/promises').then((m) => m.stat(abs).catch(() => null));
      if (!st) {
        docLinks.push({ note: l.note || '', ...meta, missing: true, docId: paths.extDocId(abs) });
      } else if (st.isDirectory()) {
        externalDirs.push({ path: abs, note: l.note || '', ...meta, files: await listDirMd(abs) });
      } else {
        docLinks.push({ note: l.note || '', ...meta, ...(await readExternalDoc(abs, { warnings, label: `组绑定·${l.path}` })) });
      }
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
  // 仓库级直接绑定：不经过组，单独并入（同一个参考仓库两类都有时只加 direct 标记）
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
    intro: intro.missing ? null : intro,
    introSet,
    boards,
    refRepos,
    warnings,
  };
  if (md) out.md = renderMd(out);
  return out;
}

// 单篇 markdown：项目介绍 → 各组（介绍/组内描述/绑定文档）→ 参考仓库
function renderMd(k: RepoKnowledgeResult): string {
  const lines: string[] = [];
  const heading = (t: string) => (lines.length ? lines.push('', t) : lines.push(t));
  heading(`# ${k.repo.name}`);
  lines.push(...introMdLines(k.introSet, k.intro));
  for (const b of k.boards) {
    heading(`## 组：${b.name}`);
    lines.push(...introMdLines(b.introSet, b.intro));
    if (b.note && !b.note.missing) lines.push(b.note.body!.trim());
    for (const d of b.docLinks) {
      if (!d.missing && d.body) lines.push(d.body.trim());
    }
    for (const dir of b.externalDirs) {
      lines.push('', `外部目录「${dir.path}」（${dir.files!.length} 个文档，按需读盘）:`);
      for (const f of dir.files!) lines.push(`- ${f}`);
    }
  }
  if (k.refRepos.length) {
    heading('## 参考仓库');
    for (const r of k.refRepos) {
      const src = r.direct && !r.groups.length ? '［直接绑定］' : r.direct ? '［组 + 直接绑定］' : '';
      lines.push(`- ${r.name}${r.remote ? `（${r.remote}）` : ''}${src}${r.note ? ` —— ${r.note.split('\n')[0] ?? ''}` : ''}`);
    }
  }
  return lines.join('\n');
}


/**
 * **项目组上下文**（交付层用）：某个工作目录所属仓库所在的项目组材料。
 *
 * 与 repoKnowledge 的区别：那是「一份完整的知识报告」（CLI 给人看）；
 * 这里只取**交付时必须带上的那部分**——项目介绍、组定位、组介绍、
 * 本项目在组里的位置、兄弟成员的组内描述、组绑定参考文件的**可读路径**。
 *
 * 返回 { repo:{name,key,intro:{body,path}}, groups:[{name,key,desc,intro:{body,path},note,peers,docLinks}] }
 * 不在项目组里 → groups 为空数组（组上下文段不拼，但项目介绍照给）。
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
  const closure = await store.externalClosure(s);
  const groups: GroupContextGroup[] = [];

  // 项目介绍（项目级任务也要带——它回答「这个项目是干什么的」）。
  // 介绍是**文档集**（主篇 + 其余各篇），不是孤立的一篇——#58。
  const repoIntroSet = await readIntroSet({
    dirRel: paths.repoDocDirRel(rk),
    legacyRel: paths.repoDocRel(rk),
    ref: repo.doc,
    links: repo.docLinks,
    warnings,
    label: '项目介绍',
  });
  const repoIntro = mainAsIntro(repoIntroSet);
  // 项目自己登记的补充文档（外部 / ref 仓库里的文件）——交付时给可读路径
  const repoDocLinks = linkEntries(repo.docLinks, closure);

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

  // #64 作用域：只有组任务（正文 frontmatter 带 board）才挂组上下文。单 repo 主题里
  // 提交的纯项目任务只给项目介绍，组材料一律不挂——成员身份不等于「这条任务属于组」。
  const wantBoard = String(board || '').trim();
  for (const b of s.boards) {
    if (!wantBoard) continue;
    const members = boardRepoKeys(b, s);
    if (!members.includes(rk)) continue;
    // 组任务只挂**它归属的那个组**（id / key / 名称都认，与 --board 的寻址口径一致）；
    // 归属值对不上任何组（陈旧数据）时同纯项目任务一样不挂，避免错挂别组。
    if (![String(b.id || ''), boardKeyOf(b.name), String(b.name || '')].includes(wantBoard)) continue;
    // 组介绍（绑定优先 → 介绍目录主篇 → 旧单文件；是文档集，不是一篇）
    const introSet = await readIntroSet({
      dirRel: paths.boardDocDirRel(b.name),
      legacyRel: paths.boardDocRel(b.name),
      ref: b.doc,
      links: b.docLinks,
      warnings,
      label: `组介绍·${b.name}`,
    });
    const intro = mainAsIntro(introSet);
    // 本项目在组里的位置
    const noteRef = (b.repoDocs || {})[rk];
    const noteOwn = await readRef(noteRef, paths.groupNoteRel(b.name, rk), { warnings, label: `组内描述·${b.name}` });
    // 兄弟成员（组内各仓库的组内描述）；path = 本机磁盘路径（#163：agent 看到名字
    // 就能定位兄弟仓库，不用再查清单）
    const peers: Array<{ name: string; note: string; path: string }> = [];
    for (const mkey of members) {
      const mr = s.repos.find((x: any) => deriveKey(x) === mkey);
      const mname = mr ? mr.name : mkey;
      if (mkey === rk) continue; // 本项目单列
      const peerNote = await readRef(
        (b.repoDocs || {})[mkey],
        paths.groupNoteRel(b.name, mkey),
        { warnings, label: `组内描述·${b.name}/${mkey}` }
      );
      peers.push({
        name: mname,
        note: peerNote.body || (b.repoNotes || {})[mkey] || '',
        path: (mr && mr.path) || '',
      });
    }
    // 组绑定参考文件（给可读路径——agent 直接读盘）；tag 随条目走（有才带）
    const docLinks = linkEntries(b.docLinks, closure);
    groups.push({
      name: b.name,
      key: boardKeyOf(b.name),
      desc: b.desc || '',
      intro,
      introSet,
      note: noteOwn.body || (b.repoNotes || {})[rk] || '',
      peers,
      docLinks,
      refRepos: (Array.isArray(b.refs) ? b.refs : []).map((l: any) => refRepoItemOf(l.id, l.note)).filter(Boolean) as Array<{ key: string; name: string; path: string; note: string }>,
    });
  }
  return {
    repo: { name: repo.name, key: rk, intro: repoIntro, introSet: repoIntroSet, docLinks: repoDocLinks, refRepos: repoRefRepos },
    groups,
  };
}

/** groupContextFor 的组条目。 */
export interface GroupContextGroup {
  name: string;
  key: string;
  desc: string;
  intro: { body: string; path: string; title: string };
  introSet: IntroSet;
  note: string;
  peers: Array<{ name: string; note: string; path: string }>;
  docLinks: KnowledgeDoc[];
  refRepos: Array<{ key: string; name: string; path: string; note: string }>;
}

/** groupContextFor 的出参。 */
export interface GroupContextResult {
  repo: {
    name: string;
    key: string;
    intro: { body: string; path: string; title: string };
    introSet: IntroSet;
    docLinks: KnowledgeDoc[];
    refRepos: Array<{ key: string; name: string; path: string; note: string }>;
  };
  groups: GroupContextGroup[];
}

/**
 * **介绍文档集**（多篇 md 的列表）：主篇 + 其余各篇。
 *
 *   dirRel    介绍目录（自有树内）：repo/<key> · board/<组 slug>
 *   legacyRel 旧单文件路径（读时回落，保证既有数据继续可用）
 *   ref       DocRef 覆盖（绑定的文件或目录）；给了就以它为准
 *
 * 返回 { main, extras, count }：
 *   main   = 主篇（目录 index.md → 没有目录则旧单文件 → 再没有则绑定的那一篇）
 *   extras = 其余文档（目录内的其余 md；reference/ 子目录下的标 isReference）
 *
 * 每篇都带两套坐标：
 *   docId  面板导航用（'rel:…' 自有树 / 'path:…' 外部绝对路径）
 *   abs    仅外部文档有：磁盘绝对路径（自有文档正文在 DB，没有磁盘副本）
 *
 * 为什么描述是「列表」而不是一篇：介绍往往不止主篇——还有架构、问答、规范等补充
 * 说明。只给一篇，等于让 agent 拿着半张地图干活（#58）。
 */
export async function readIntroSet({
  dirRel,
  legacyRel,
  ref,
  links = [],
  warnings,
  label,
}: {
  dirRel: string;
  legacyRel: string;
  ref: DocRef | null;
  links?: unknown;
  warnings?: string[];
  label?: string;
}): Promise<IntroSet> {
  // 1) 绑定了文档 / 目录 → 以绑定为准
  if (ref) {
    if (ref.rel) {
      const one = await readOwn(ref.rel, { warnings, label });
      if (one.missing) return emptyIntroSet();
      return {
        main: { docId: paths.ownDocId(ref.rel), title: one.title, body: one.body },
        extras: [],
        count: 1,
      };
    }
    if (ref.path) {
      const st = await import('node:fs/promises').then((m) => m.stat(ref.path as string).catch(() => null));
      if (!st) return emptyIntroSet();
      if (!st.isDirectory()) {
        const one = await readExternalDoc(ref.path, { warnings, label });
        if (one.missing) return emptyIntroSet();
        return {
          main: { docId: paths.extDocId(ref.path), title: one.title, body: one.body, abs: ref.path },
          extras: [],
          count: 1,
        };
      }
      // 绑的是目录 → 目录内全部 .md（主篇 = index.md，其余为补充说明）
      const files = await listDirMd(ref.path);
      const mainFile = files.find((f) => f.toLowerCase().endsWith('/index.md')) || files[0] || '';
      const others = files.filter((f) => f !== mainFile);
      const mainDoc = mainFile ? await readExternalDoc(mainFile, { warnings, label }) : null;
      return {
        main: mainDoc && !mainDoc.missing
          ? { docId: paths.extDocId(mainFile), title: mainDoc.title, body: mainDoc.body, abs: mainFile }
          : null,
        extras: others.map((f) => ({
          docId: paths.extDocId(f),
          name: baseNameOf(f),
          rel: '',
          abs: f,
          isReference: isReferencePath(f),
        })),
        count: files.length,
      };
    }
  }
  // 2) 无绑定：目录主篇优先 → 回落旧单文件
  //    目录里没有 index.md 时，目录内的 md 仍然算「描述的一部分」——
  //    描述是列表，不该因为少一篇主篇就把其余也藏起来。
  const mainRel = dirRel ? paths.docMainRel(dirRel) : '';
  const inDir = dirRel ? await store.listOwnDocsIn(dirRel) : [];
  // 已在 store 里登记过的（docLinks）不重复列：它们由「补充文档」那层负责
  const registered = new Set<string>(
    (Array.isArray(links) ? (links as Array<{ rel?: string }>) : [])
      .map((l) => String(l.rel || ''))
      .filter(Boolean),
  );
  const extrasOf = (skipRel: string): KnowledgeDoc[] =>
    inDir
      .filter((d) => d.rel !== skipRel && !registered.has(d.rel))
      .map((d) => ({
        docId: paths.ownDocId(d.rel),
        name: d.name,
        rel: d.rel,
        isReference: String(d.name || '').toLowerCase().startsWith(paths.DOC_REFERENCE_DIR + '/'),
      }));
  if (mainRel && (await store.ownDocExists(mainRel))) {
    const one = await readOwn(mainRel, { warnings, label });
    const extras = extrasOf(mainRel);
    return {
      main: { docId: paths.ownDocId(mainRel), title: one.title, body: one.body },
      extras,
      count: 1 + extras.length,
    };
  }
  if (legacyRel) {
    const one = await readOwn(legacyRel, { warnings, label });
    if (!one.missing) {
      const extras = extrasOf(legacyRel);
      return {
        main: { docId: paths.ownDocId(legacyRel), title: one.title, body: one.body },
        extras,
        count: 1 + extras.length,
      };
    }
  }
  // 目录里既没有 index.md、旧单文件也没有：目录内的 md 就是全部
  if (inDir.length) {
    const head = inDir[0]!;
    const extras = extrasOf(head.rel);
    const first = await readOwn(head.rel, { warnings, label });
    return {
      main: first.missing
        ? null
        : { docId: paths.ownDocId(head.rel), title: first.title, body: first.body },
      extras,
      count: 1 + extras.length,
    };
  }
  return emptyIntroSet();
}

/** 文档集的主篇 → 旧的单篇形状（{ body, path }），兼容既有消费方 */
function mainAsIntro(set: IntroSet | null | undefined): { body: string; path: string; title: string } {
  const m = set && set.main;
  return m ? { body: m.body || '', path: m.abs || '', title: m.title || '' } : { body: '', path: '', title: '' };
}

/** 登记在 store 里的补充文档（rel 自有树 / path 外部）→ 可读绝对路径条目 */
function linkEntries(links: unknown, closure: readonly store.ClosureEntry[]): KnowledgeDoc[] {
  const out: KnowledgeDoc[] = [];
  for (const l of Array.isArray(links) ? (links as Array<DocRef & { note?: string; tag?: string }>) : []) {
    if (l.rel) {
      out.push({ rel: l.rel, note: l.note || '', ...(l.tag ? { tag: l.tag } : {}) });
      continue;
    }
    const abs = l.path && store.resolveExternal(l.path, closure);
    if (!abs) continue;
    out.push({ path: abs, abs, note: l.note || '', ...(l.tag ? { tag: l.tag } : {}) });
  }
  return out;
}

/** 文档集 → markdown 行（主篇正文 + 其余各篇的可读路径） */
function introMdLines(set: IntroSet | null | undefined, fallback: KnowledgeDoc | null | undefined): string[] {
  const out: string[] = [];
  const main = (set && set.main) || (fallback && !fallback.missing ? fallback : null);
  if (main && main.body) out.push(String(main.body).trim());
  const extras = (set && set.extras) || [];
  if (extras.length) {
    out.push('', '其余介绍文档（可用命令读取）:');
    for (const d of extras) {
      // 自有文档正文在 DB，没有磁盘副本：给可直接执行的读取命令，别给假路径。
      out.push(`- ${d.rel ? `nx-kv docs get rel:${d.rel}` : d.abs || d.docId || ''}`);
    }
  }
  return out;
}

/** 空文档集（没有主篇、也没有其余） */
function emptyIntroSet(): IntroSet {
  return { main: null, extras: [], count: 0 };
}

/** 文件名（路径最后一段） */
function baseNameOf(p: unknown): string {
  const s = String(p || '');
  return s.split(sep).pop() || s.split('/').pop() || '';
}

/** 是否在 reference/ 补充说明子目录下 */
function isReferencePath(p: unknown): boolean {
  const segs = String(p || '').split(sep).join('/').split('/');
  return segs.includes(paths.DOC_REFERENCE_DIR);
}
