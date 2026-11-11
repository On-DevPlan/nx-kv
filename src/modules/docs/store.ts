// 文档存储原语：自有树 CRUD（原子写）+ 外部绑定闭包。
//
// **自有树**：~/.nx-kv/docs/ 下的真实 .md 文件，是描述内容的唯一权威。
// **外部绑定**：repos.json 里登记的外部绝对路径（文件或目录），只读引用——
// 「绑定闭包」= 全部外部路径的集合，外部读取只允许落在闭包内：
// 少了这道闸，`docs get path:D:\任意文件` 就成了任意文件读入口。
//
// 本文件不含业务语义（不认识 DocRef 之外的绑定模型，也不认识 action）。
import { join } from 'node:path';
import fsp from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { docsRoot, assertOwnedRel, ownDocId, extDocId } from './paths.js';
import { exists, walkFiles } from '../../core/fstree.js';
import { notFound } from '../../core/errors.js';
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import { ensureDocRef, forgetDocRef, syncRefAttachments } from '../../core/attachmentdb.js';

/** 自有树里的一个文档行。 */
export interface OwnDocRow {
  rel: string;
  abs: string;
  size: number;
  /** listOwnDocsIn 只给 rel/abs/size/name，不计算 md5 */
  md5?: string;
}

/** 介绍目录内的文档（listOwnDocsIn 产出，rel 相对自有树根）。 */
export interface OwnDocRowIn extends OwnDocRow {
  name: string;
}

/** 外部绑定闭包条目（externalClosure 产出）。 */
export interface ClosureEntry {
  path: string;
  /** 登记来源（'repo/<name>' / 'board/<name>[/<repoKey>]'） */
  owner?: string;
  exists: boolean;
  isDir: boolean;
}

// 外部目录枚举的跳过名单（Obsidian vault 里也有 .obsidian / node_modules 这类噪音）
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash', 'dist', 'build', '__pycache__', '.venv']);

// 原子写 + 进程内串行化（与 repos/localtask 同一模式：Windows rename 偶发 EPERM 重试；
// 串行化避免并发写互相覆盖）。
let writeQueue: Promise<void> = Promise.resolve();
function queuedWrite(abs: string, data: string): Promise<void> {
  const run = writeQueue.then(async () => {
    await fsp.mkdir(join(abs, '..'), { recursive: true });
    const tmp = abs + '.tmp';
    await fsp.writeFile(tmp, data, 'utf8');
    for (let i = 0; ; i++) {
      try {
        await fsp.rename(tmp, abs);
        return;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (i >= 4 || (e.code !== 'EPERM' && e.code !== 'EACCES')) throw err;
        await new Promise((r) => setTimeout(r, 25 * (i + 1)));
      }
    }
  });
  writeQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

// ─── 自有树 CRUD ───────────────────────────────────────────────────────

/** 自有树全部 .md（walkFiles 已含 size），按 rel 排序。树不存在 → 空数组。 */
export async function listOwnDocs(): Promise<OwnDocRow[]> {
  const root = docsRoot();
  if (!(await exists(root))) return [];
  const files = await walkFiles(root);
  const out: OwnDocRow[] = [];
  for (const [rel, info] of files) {
    if (!/\.md$/i.test(rel)) continue;
    out.push({ rel, abs: info.abs, size: info.size, md5: info.md5 });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export async function ownDocExists(rel: string): Promise<boolean> {
  const norm = assertOwnedRel(rel);
  return exists(join(docsRoot(), ...norm.split('/')));
}

/** 读自有文档正文（utf8）。缺失抛 notFound。 */
export async function readOwnDoc(rel: string): Promise<string> {
  const norm = assertOwnedRel(rel);
  try {
    return await fsp.readFile(join(docsRoot(), ...norm.split('/')), 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e && (e.code === 'ENOENT' || e.code === 'EISDIR')) throw notFound('文档不存在: ' + norm);
    throw err;
  }
}

/** 写自有文档（mkdir -p + 原子写）。返回归一化 rel，调用方应使用返回值。 */
export async function writeOwnDoc(rel: string, body: unknown): Promise<string> {
  const norm = assertOwnedRel(rel);
  const text = String(body ?? '');
  await queuedWrite(join(docsRoot(), ...norm.split('/')), text);
  // 文档正文里用到的资源立刻进 ref_attach：不论从 CLI、面板还是别的模块写盘，
  // 都在这个唯一落盘口同步，避免「有的入口写了关系、有的没写」。
  const db = getDb();
  tx(
    (conn) => {
      const refId = ensureDocRef(conn, { locator: norm });
      syncRefAttachments(conn, { refId, text });
    },
    { db, mode: 'IMMEDIATE' }
  );
  return norm;
}

/** 删自有文档。缺失抛 notFound；顺带清掉写盘时可能残留的 .tmp。 */
export async function removeOwnDoc(rel: string): Promise<string> {
  const norm = assertOwnedRel(rel);
  const abs = join(docsRoot(), ...norm.split('/'));
  try {
    await fsp.unlink(abs);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e && e.code === 'ENOENT') throw notFound('文档不存在: ' + norm);
    throw err;
  }
  await fsp.unlink(abs + '.tmp').catch(() => {});
  // 文档删除 = refs 行删除（ref_bindings / ref_attach 由 FK CASCADE 跟着走），
  // 它引用过的资源因此变成可列出的孤儿，交给 file orphans / prune 回收。
  const db = getDb();
  tx((conn) => forgetDocRef(conn, norm), { db, mode: 'IMMEDIATE' });
  return norm;
}

// ─── 外部绑定闭包 ──────────────────────────────────────────────────────

/**
 * 全部已登记的外部路径（repos.json 里能扫到的每一处 DocRef）。
 * 返回 [{ path, owner, exists, isDir }]——isDir/exists 现场探测，
 * 不存在的路径保留在列表里（读取侧动态标 missing，导入侧标待初始化）。
 */
export async function externalClosure(store: any): Promise<ClosureEntry[]> {
  const list: ClosureEntry[] = [];
  const seen = new Set<string>();
  const addRef = (ref: unknown, owner: string): void => {
    const p = ref && typeof ref === 'object' ? String((ref as { path?: unknown }).path || '').trim() : '';
    if (!p) return;
    const k = p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    if (seen.has(k)) return;
    seen.add(k);
    // exists/isDir 稍后统一现场探测，这里先占位
    list.push({ path: p, owner, exists: false, isDir: false });
  };
  for (const r of store.repos || []) addRef(r.doc, 'repo/' + (r.name || r.id));
  for (const r of store.repos || []) for (const l of Array.isArray(r.docLinks) ? r.docLinks : []) addRef(l, 'repo/' + (r.name || r.id));
  for (const b of store.boards || []) {
    addRef(b.doc, 'board/' + b.name);
    for (const l of Array.isArray(b.docLinks) ? b.docLinks : []) addRef(l, 'board/' + b.name);
    for (const [rkey, ref] of Object.entries(b.repoDocs || {})) addRef(ref, 'board/' + b.name + '/' + rkey);
  }
  for (const item of list) {
    let st: Stats | null = null;
    try {
      st = await fsp.stat(item.path);
    } catch {
      /* 缺失：保留，标记不存在 */
    }
    item.exists = !!st;
    item.isDir = st ? st.isDirectory() : false;
  }
  return list;
}

const normAbs = (p: unknown): string => String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * 校验外部路径是否落在绑定闭包内（精确命中，或闭包内某目录的前缀）。
 * 命中返回实际绝对路径；闭包外返回 null——调用方一律拒绝。
 */
export function resolveExternal(absPath: string, closure: readonly ClosureEntry[]): string | null {
  const want = normAbs(absPath);
  if (!want) return null;
  for (const item of closure) {
    const base = normAbs(item.path);
    if (!base) continue;
    if (want === base) return absPath;
    if (item.isDir && want.startsWith(base + '/')) return absPath;
  }
  return null;
}

/**
 * 枚举外部文档：单文件绑定 = 文件本身；目录绑定 = 递归 .md（限深 maxDepth、总量 maxFiles）。
 * 返回绝对路径数组（保持稳定排序）。
 */
export async function listExternalDocs(
  closure: readonly ClosureEntry[],
  { maxDepth = 3, maxFiles = 200 }: { maxDepth?: number; maxFiles?: number } = {}
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (abs: string): void => {
    const k = normAbs(abs);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(abs);
  };
  for (const item of closure) {
    if (!item.exists) continue;
    if (!item.isDir) {
      if (/\.md$/i.test(item.path)) push(item.path);
      continue;
    }
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (out.length >= maxFiles || depth > maxDepth) return;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (out.length >= maxFiles) return;
        const abs = join(dir, e.name);
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          await walk(abs, depth + 1);
        } else if (e.isFile() && /\.md$/i.test(e.name)) {
          push(abs);
        }
      }
    };
    await walk(item.path, 1);
  }
  return out;
}

/** 外部路径的 docId（调用方必须先用 resolveExternal 校验过闭包内） */
export function externalDocId(abs: string): string {
  return extDocId(abs);
}

export { ownDocId };

/**
 * 某个目录下的文档（介绍目录用）：[{ rel, abs, size }]，rel 相对**自有树根**。
 * 只取该目录直属与其子目录（reference/ 等）的 .md。
 */
export async function listOwnDocsIn(dirRel: string): Promise<OwnDocRowIn[]> {
  const prefix = String(dirRel || '').split('\\').join('/').replace(/\/+$/, '') + '/';
  const out: OwnDocRowIn[] = [];
  for (const d of await listOwnDocs()) {
    if (!d.rel.startsWith(prefix)) continue;
    out.push({ rel: d.rel, abs: d.abs, size: d.size, name: d.rel.slice(prefix.length) });
  }
  return out;
}
