// 导入执行：diffImport 的差异 → 按策略落库（文档树还原 → 登记/覆盖/另存 → 看板与绑定 → 关系）。
import { join, resolve } from 'node:path';
import { loadConfig } from '../../../core/config.js';
import { badInput, notFound } from '../../../core/errors.js';
import { writeOwnDoc, externalClosure } from '../../docs/store.js';
import * as service from '../service.js';
import * as boards from '../boards.js';
import { gitClone, hasGit } from '../git.js';
import { clean, parseLayout } from './layout.js';
import { diffImport } from './diff.js';
import type { LayoutRepo } from './layout.js';
import type { DiffDocEntry, DiffImportResult, DiffField } from './diff.js';
import type { RepoEntry, Store } from '../repo/rows.js';
import type { RepoPatch } from '../service/crud.js';

/** 导入结果里的未匹配条目（成员/看板/参考关系共用一份清单）。 */
export interface ImportUnmatched {
  board: string;
  entry: string;
  reason: string;
  remote?: string;
  clonable?: boolean;
  name?: string;
}

/** repoImport 的返回。 */
export interface RepoImportResult {
  strategy: string;
  created: Array<{ key: string; id: string; cloned: boolean }>;
  updated: Array<{ key: string; fields: string[] }>;
  duplicated: Array<{ key: string; newKey: string; id: string }>;
  cloned: Array<{ key: string; dest: string; remote: string }>;
  skipped: Array<{ key: string; why: string }>;
  unmatched: ImportUnmatched[];
  warnings: string[];
  boardsCreated: number;
  boardsMerged: number;
  links: number;
  docs: { written: string[]; skipped: Array<{ refId: string; why: string }> };
  pendingExternal: Array<{ owner: string; path: string }>;
}

/** repoImport 的参数。 */
export interface RepoImportInput {
  json?: unknown;
  /** zip 拆出的文档条目 [{refId, data}]（先还原正文，再还原绑定） */
  docsFiles?: DiffDocEntry[];
  /** 要处理的 key（空 = 全部） */
  selection?: string | string[];
  /** ours=保留本地 / overwrite=用导入覆盖 / duplicate=另存 key-import-N */
  strategy?: string;
  /** 要处理的看板 key（空 = 全部） */
  boardSelection?: string | string[];
  /** all | dev | ref | none */
  clone?: string;
}

// 仓库的 key（自定义 > remote 派生 > local 兜底）
const deriveKeyOf = (r: RepoEntry): string => service.deriveKey(r);

function cloneModeFor(type: string, clone: unknown): boolean {
  if (clone === 'all') return true;
  if (clone === 'dev') return type === 'dev';
  if (clone === 'ref') return type === 'ref';
  return false; // none
}

/**
 * 执行导入。
 *   selection       要处理的 key（空 = 全部）
 *   strategy        ours=保留本地 / overwrite=用导入覆盖 / duplicate=另存 key-import-N
 *   boardSelection  要处理的看板 key（空 = 全部）
 *   clone           all | dev | ref | none
 *   docsFiles       zip 拆出的文档条目 [{refId, data}]（先还原正文，再还原绑定）
 */
export async function repoImport({
  json,
  docsFiles = [],
  selection,
  strategy = 'ours',
  boardSelection,
  clone = 'none',
}: RepoImportInput = {}): Promise<RepoImportResult> {
  if (!['ours', 'overwrite', 'duplicate'].includes(strategy)) {
    throw badInput('strategy 只能是 ours | overwrite | duplicate，收到: ' + strategy);
  }
  const layout = parseLayout(json);
  const diff: DiffImportResult = await diffImport(JSON.stringify(layout), docsFiles);

  const cfg = await loadConfig();
  const gitRepoRoot = clean(cfg.gitRepoRoot);
  const gitDevRoot = clean(cfg.gitDevRoot);
  const warnings: string[] = [];

  const sel = new Set((Array.isArray(selection) ? selection : selection ? [selection] : []).map(clean).filter(Boolean));
  const want = (k: string): boolean => !sel.size || sel.has(k);
  const bsel = new Set((Array.isArray(boardSelection) ? boardSelection : boardSelection ? [boardSelection] : []).map(clean).filter(Boolean));
  const wantBoard = (k: string): boolean => !bsel.size || bsel.has(k);

  const created: RepoImportResult['created'] = [];
  const updated: RepoImportResult['updated'] = [];
  const duplicated: RepoImportResult['duplicated'] = [];
  const cloned: RepoImportResult['cloned'] = [];
  const skipped: RepoImportResult['skipped'] = [];
  const keyMap = new Map<string, string>(); // 导入 key -> 本地 repo id

  // ① 文档还原（先于一切绑定——绑定可能指向即将恢复的文档）。
  //    ours（缺省）= 本地已有且内容不同 → 跳过保本地；overwrite = 全部覆盖；
  //    duplicate 对文档不适用（描述没有「另存一份」的意义）→ 按 ours。
  //    先按 layout.refs 建 ref 行（id / origin / locator / desc），再写正文。
  const docs = { written: [] as string[], skipped: [] as Array<{ refId: string; why: string }> };
  const { getDb } = await import('../../../core/db/index.js');
  const { ensureDocRef } = await import('../../../core/attachmentdb.js');
  const db = getDb();
  for (const r of layout.refs || []) {
    const exists = db.get('SELECT 1 AS x FROM refs WHERE id = :id AND deleted_at IS NULL', { id: r.refId });
    if (exists) {
      if (strategy === 'overwrite' && r.desc) {
        db.run('UPDATE refs SET "desc" = :desc, updated_at = :at WHERE id = :id', { desc: r.desc, at: Date.now(), id: r.refId });
      }
      continue;
    }
    ensureDocRef(db, { ref: r.refId, locator: r.locator });
    if (r.origin === 'external') {
      db.run("UPDATE refs SET origin = 'external' WHERE id = :id", { id: r.refId });
    }
    if (r.desc) db.run('UPDATE refs SET "desc" = :desc WHERE id = :id', { desc: r.desc, id: r.refId });
  }
  if (docsFiles.length) {
    for (const item of diff.docs) {
      const f = docsFiles.find((x) => x.refId === item.refId);
      if (!f) continue;
      if (strategy !== 'overwrite' && item.status !== 'new') {
        docs.skipped.push({ refId: item.refId, why: item.status === 'same' ? '一致' : '本地已有不同内容（保留本地）' });
        continue;
      }
      ensureDocRef(db, { ref: f.refId });
      await writeOwnDoc(f.refId, f.data.toString('utf8'));
      docs.written.push(item.refId);
    }
  }

  // 先登记本地已有的（哪怕这次不动，也要能解析关系）
  // keyMap: repoKey -> repoKey（关系的身份；本地有没有这条登记用 keyMap.has 判断）
  const s0: Store = await service.loadStore();
  for (const r of s0.repos) keyMap.set(service.deriveKey(r), service.deriveKey(r));

  for (const item of diff.repos) {
    if (!want(item.key)) continue;
    const inc = item.incoming;
    try {
      if (item.status === 'same') {
        skipped.push({ key: item.key, why: '已一致' });
        continue;
      }

      if (item.status === 'changed') {
        if (strategy === 'ours') {
          skipped.push({ key: item.key, why: '保留本地（ours）' });
          continue;
        }
        if (strategy === 'overwrite') {
          const patch: RepoPatch = {};
          let descIn: string | null = null;
          for (const f of item.fields) {
            // 描述是文档（不再是字符串字段）：攒下来单独写主篇，不进 updateRepo 的 patch
            if (f.field === 'desc') { descIn = inc.desc; continue; }
            if (f.field === 'type') patch.type = inc.type;
            else if (f.field === 'remote') patch.remote = inc.remote || '';
            else patch[f.field] = (inc as any)[f.field];
          }
          await service.updateRepo(item.local!.id, patch);
          if (descIn !== null) {
            await service.writeRepoDocContent({ key: item.key, name: inc.name || item.key }, descIn);
          }
          updated.push({ key: item.key, fields: item.fields.map((f: DiffField) => f.field) });
          continue;
        }
        // duplicate：另存一份（占位路径带上新 key，避免与原记录/前一次复制撞路径）
        const newKey = await uniqueKey(item.key);
        const r: RepoEntry = await service.addRepo({
          path: placeholderPath({ ...inc, key: newKey }, gitRepoRoot, gitDevRoot, newKey),
          name: (inc.name || inc.key) + ' (import)',
          desc: inc.desc,
          notes: inc.notes,
          type: inc.type,
          remote: inc.remote || '',
          key: newKey,
          keyCustom: true,
          remotes: inc.remotes || [],
        }, { seedDoc: false });
        duplicated.push({ key: item.key, newKey, id: r.id });
        keyMap.set(newKey, newKey);
        continue;
      }

      // status === 'new'：登记（可选 clone）
      const type = inc.type;
      const root = type === 'ref' ? gitRepoRoot : gitDevRoot;
      const wantClone = cloneModeFor(type, clone) && !!inc.remote && !!root;
      if (cloneModeFor(type, clone) && inc.remote && !root) {
        warnings.push(`「${inc.name || inc.key}」需要克隆但 ${type === 'ref' ? 'gitRepoRoot' : 'gitDevRoot'} 未设置 —— 只登记`);
      }

      // 磁盘上已经有同源目录（换机搬过 / 以前 clone 过）就直登记，不再 clone
      let dest: string | null = null;
      if (root && inc.remote) {
        const guess = resolve(join(resolve(root), service.dirnameFromRemote(inc.remote)));
        if (await hasGit(guess)) dest = guess;
      }

      if (!dest && wantClone) {
        dest = resolve(join(resolve(root), service.dirnameFromRemote(inc.remote)));
        const used = await gitClone(inc.remote, dest, { depth: 1 });
        cloned.push({ key: item.key, dest, remote: used });
        const r: RepoEntry = await service.addRepo({
          path: dest, name: inc.name, desc: inc.desc, notes: inc.notes,
          type, remote: used, key: inc.key, keyCustom: inc.keyCustom, remotes: inc.remotes || [],
        }, { seedDoc: false });
        created.push({ key: item.key, id: r.id, cloned: true });
        keyMap.set(item.key, item.key);
        continue;
      }

      const r: RepoEntry = await service.addRepo({
        path: dest || placeholderPath(inc, gitRepoRoot, gitDevRoot),
        name: inc.name,
        desc: inc.desc,
        notes: inc.notes,
        type,
        remote: inc.remote || '',
        key: inc.key,
        keyCustom: inc.keyCustom,
        remotes: inc.remotes || [],
      }, { seedDoc: false });
      created.push({ key: item.key, id: r.id, cloned: !!dest });
      keyMap.set(item.key, item.key);
    } catch (err) {
      const msg = String((err as Error)?.message || err);
      if (/已.*登记|已存在/.test(msg)) skipped.push({ key: item.key, why: msg });
      else warnings.push(`「${inc.name || item.key}」导入失败: ${msg}`);
    }
  }

  // 看板：按 key 匹配，缺失则新建；成员按 repo key 解析
  let boardsCreated = 0;
  let boardsMerged = 0;
  const unmatched: ImportUnmatched[] = [];
  for (const bd of diff.boards) {
    if (!wantBoard(bd.key)) continue;
    const inc = bd.incoming;
    let b = (await service.loadStore()).boards.find((x) => service.storedBoardKey(x) === bd.key);
    try {
      if (!b) {
        await boards.createBoard({ name: inc.name, desc: inc.desc, key: bd.key }, { seedDoc: false });
        boardsCreated += 1;
        b = (await service.loadStore()).boards.find((x) => service.storedBoardKey(x) === bd.key);
      } else {
        boardsMerged += 1;
        if (strategy === 'overwrite' && inc.desc && inc.desc !== (b.desc || '')) {
          await boards.updateBoard(b.id, { desc: inc.desc });
        }
      }
      if (!b) continue;
      // **完整复制导出方的组布局**：按导入文件的顺序重建成员列表。
      // 本地没有的成员（占位）也保留位置 —— 组结构照抄，缺的那几个标出来等 clone。
      for (const m of inc.repos) {
        const known = keyMap.has(m.key);
        await boards.assignRepo({ key: m.key, board: b.id }).catch(() => {});
        if (!known) {
          // 占位成员的线索一起带走：只留一个 key 的话，导入端既看不到名字，
          // 也不知道该 clone 哪个地址——「待初始化」就永远待着，还删不掉。
          await boards
            .setMemberHint({ board: b.id, key: m.key, name: m.name, remote: m.remote, desc: m.desc, type: m.type })
            .catch(() => {});
        }
        if (m.note) {
          // 组内描述挂在 key 上：占位成员也保留描述，等仓库补齐后自动生效。
          // **直接写摘要字段**，不走 setBoardRepoNote —— 后者会把这句话写进
          // group 文档，覆盖刚从 zip 还原的正文（描述以文档为准，文字只是影子）。
          await service
            .mutateStore((s) => {
              const bb = s.boards.find((x) => x.id === b!.id);
              if (!bb) return;
              if (!bb.repoNotes) bb.repoNotes = {};
              bb.repoNotes[m.key] = m.note;
            })
            .catch(() => {});
        }
        if (!known) {
          unmatched.push({
            board: inc.name,
            entry: m.key,
            reason: '本地未拥有',
            remote: m.remote || '',
            clonable: !!m.remote,
            name: m.name || '',
          });
        }
      }
    } catch (err) {
      warnings.push(`看板「${inc.name}」导入失败: ${String((err as Error)?.message || err)}`);
    }
  }

  // ② 文档绑定还原（与成员重建同一哲学：完整复制导出方的布局）。
  //    看板：doc 覆盖 / docLinks 整表重建 / repoDocs 整表重建——成员都重建了，
  //    绑定跟着走才不会出现「成员是新的、描述还挂在老 key 上」的错位。
  //    仓库：新建的仓库带上 doc 覆盖；overwrite 时同样写入（ours 不动本地绑定）。
  const bindingBoards = diff.boards.filter(
    (bd) =>
      wantBoard(bd.key) &&
      (bd.incoming.doc || (bd.incoming.docLinks && bd.incoming.docLinks.length) || (bd.incoming.repoDocs && Object.keys(bd.incoming.repoDocs).length))
  );
  const bindingRepos = diff.repos.filter(
    (item) =>
      want(item.key) &&
      (item.incoming.doc || (item.incoming.docLinks && item.incoming.docLinks.length)) &&
      (item.status === 'new' || strategy === 'overwrite')
  );
  if (bindingBoards.length || bindingRepos.length) {
    await service.mutateStore((s2: Store) => {
      for (const bd of bindingBoards) {
        const b = s2.boards.find((x) => service.storedBoardKey(x) === bd.key);
        if (!b) continue;
        const inc = bd.incoming;
        if (inc.doc) b.doc = { ...inc.doc };
        else delete b.doc;
        if (inc.docLinks && inc.docLinks.length) b.docLinks = inc.docLinks.map((x: any) => ({ ...x }));
        else delete b.docLinks;
        if (inc.repoDocs && Object.keys(inc.repoDocs).length) {
          b.repoDocs = {};
          for (const [rk, ref] of Object.entries(inc.repoDocs)) b.repoDocs[rk] = { ...ref };
        } else delete b.repoDocs;
      }
      for (const item of bindingRepos) {
        const r = s2.repos.find((x) => deriveKeyOf(x) === item.key);
        if (!r) continue;
        if (item.incoming.doc) r.doc = { ...item.incoming.doc };
        else delete r.doc;
        if (item.incoming.docLinks && item.incoming.docLinks.length) {
          r.docLinks = item.incoming.docLinks.map((x: any) => ({ ...x }));
        } else delete r.docLinks;
      }
      return true;
    });
  }

  // ③ 外部绑定存在性检查：路径缺失 = 待初始化（不阻塞——文档先恢复，等用户接上 vault）
  const pendingExternal: Array<{ owner: string; path: string }> = [];
  for (const c of await externalClosure(await service.loadStore())) {
    // ClosureEntry.owner 标注可选，但 externalClosure 组装时恒有值（'repo/<name>' 等）
    if (!c.exists) pendingExternal.push({ owner: c.owner as string, path: c.path });
  }
  for (const p of pendingExternal) {
    warnings.push(`外部绑定路径缺失（待初始化）: ${p.owner} → ${p.path}`);
  }

  // 参考关系
  let linksDone = 0;
  for (const l of diff.links) {
    const rkey = l.ref;
    if (!keyMap.has(rkey)) {
      unmatched.push({ board: '(参考关系)', entry: rkey, reason: '参考仓库本地未拥有' });
      continue;
    }
    for (const t of l.to) {
      try {
        if (t.repo) {
          if (!keyMap.has(t.repo)) {
            unmatched.push({ board: `(参考关系 ${l.ref})`, entry: t.repo, reason: '本地未拥有' });
            continue;
          }
          await refBind(rkey, t.repo, null, t.note);
        } else if (t.board) {
          const bs = (await service.loadStore()).boards.find((x) => service.storedBoardKey(x) === t.board);
          if (!bs) { unmatched.push({ board: `(参考关系 ${l.ref})`, entry: '看板 ' + t.board, reason: '看板未建立' }); continue; }
          await refBind(rkey, null, service.storedBoardKey(bs), t.note);
        }
        linksDone += 1;
      } catch (err) {
        warnings.push(`参考关系 ${l.ref} → ${t.repo || t.board} 失败: ${String((err as Error)?.message || err)}`);
      }
    }
  }

  return {
    strategy,
    created,
    updated,
    duplicated,
    cloned,
    skipped,
    unmatched,
    warnings,
    boardsCreated,
    boardsMerged,
    links: linksDone,
    docs,
    pendingExternal,
  };
}

// 给重复导入起一个不冲突的 key：key-import-1/2/3…
async function uniqueKey(base: string): Promise<string> {
  const s = await service.loadStore();
  const used = new Set(s.repos.map((r) => service.deriveKey(r)));
  for (let i = 1; i < 1000; i++) {
    const k = `${base}-import-${i}`;
    if (!used.has(k)) return k;
  }
  return `${base}-import-${Date.now().toString(36)}`;
}

// 没有可 clone 的远程地址时，登记路径只是占位（目录不存在，等 clone 后 update --path）。
// 占位目录名取 key 的末段——复制出来的条目 key 不同，目录也就不会撞。
function placeholderPath(inc: LayoutRepo, gitRepoRoot: string, gitDevRoot: string, keyOverride?: string): string {
  const root = inc.type === 'ref' ? gitRepoRoot : gitDevRoot;
  const base = resolve(root || '.');
  const k = keyOverride || inc.remote || inc.key;
  const dir = service.dirnameFromRemote(k).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
  return join(base, dir);
}

// 关系重建：参考仓库 → 组 / 单个开发仓库，两类并存。
//   boardKey_ 给了 → 写组级绑定（group_refs）；
//   repoKey 给了  → 写仓库级绑定（dev.ext.ext_linked），不再折算成它所属的组。
// 入参一律是 **key**（关系的身份），不再用随机 id。
async function refBind(refKey: string, repoKey: string | null | undefined, boardKey_: string | null | undefined, note: string | undefined): Promise<number> {
  return service.mutateStore((s) => {
    const r = s.repos.find((x) => deriveKeyOf(x) === refKey);
    if (!r) throw badInput('参考仓库不存在: ' + refKey);
    if (boardKey_) {
      const b = s.boards.find((x) => service.storedBoardKey(x) === boardKey_);
      if (!b) throw notFound('看板不存在: ' + boardKey_);
      if (!Array.isArray(b.refs)) b.refs = [];
      const hit = b.refs.find((l) => l.id === refKey);
      if (!hit) b.refs.push(note ? { id: refKey, note } : { id: refKey });
      else if (note) hit.note = note;
    }
    if (repoKey) {
      const dev = s.repos.find((x) => deriveKeyOf(x) === repoKey && (x.type || 'dev') !== 'ref');
      if (!dev) throw badInput('绑定的开发仓库不存在: ' + repoKey);
      if (!Array.isArray(dev.linked)) dev.linked = [];
      const hit = dev.linked.find((l) => l && l.kind === 'ref' && String(l.id) === refKey);
      if (!hit) dev.linked.push(note ? { kind: 'ref', id: refKey, note } : { kind: 'ref', id: refKey });
      else if (note) hit.note = note;
    }
    return (boardKey_ ? 1 : 0) + (repoKey ? 1 : 0);
  });
}
