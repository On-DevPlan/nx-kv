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
import { docsRoot, assertOwnedRel, ownDocId, extDocId } from './paths.js';
import { exists, walkFiles } from '../../core/fstree.js';
import { notFound } from '../../core/errors.js';

// 外部目录枚举的跳过名单（Obsidian vault 里也有 .obsidian / node_modules 这类噪音）
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash', 'dist', 'build', '__pycache__', '.venv']);

// 原子写 + 进程内串行化（与 repos/localtask 同一模式：Windows rename 偶发 EPERM 重试；
// 串行化避免并发写互相覆盖）。
let writeQueue = Promise.resolve();
function queuedWrite(abs, data) {
  const run = writeQueue.then(async () => {
    await fsp.mkdir(join(abs, '..'), { recursive: true });
    const tmp = abs + '.tmp';
    await fsp.writeFile(tmp, data, 'utf8');
    for (let i = 0; ; i++) {
      try {
        await fsp.rename(tmp, abs);
        return;
      } catch (err) {
        if (i >= 4 || (err.code !== 'EPERM' && err.code !== 'EACCES')) throw err;
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
export async function listOwnDocs() {
  const root = docsRoot();
  if (!(await exists(root))) return [];
  const files = await walkFiles(root);
  const out = [];
  for (const [rel, info] of files) {
    if (!/\.md$/i.test(rel)) continue;
    out.push({ rel, abs: info.abs, size: info.size, md5: info.md5 });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export async function ownDocExists(rel) {
  const norm = assertOwnedRel(rel);
  return exists(join(docsRoot(), ...norm.split('/')));
}

/** 读自有文档正文（utf8）。缺失抛 notFound。 */
export async function readOwnDoc(rel) {
  const norm = assertOwnedRel(rel);
  try {
    return await fsp.readFile(join(docsRoot(), ...norm.split('/')), 'utf8');
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'EISDIR')) throw notFound('文档不存在: ' + norm);
    throw err;
  }
}

/** 写自有文档（mkdir -p + 原子写）。返回归一化 rel，调用方应使用返回值。 */
export async function writeOwnDoc(rel, body) {
  const norm = assertOwnedRel(rel);
  await queuedWrite(join(docsRoot(), ...norm.split('/')), String(body ?? ''));
  return norm;
}

/** 删自有文档。缺失抛 notFound；顺带清掉写盘时可能残留的 .tmp。 */
export async function removeOwnDoc(rel) {
  const norm = assertOwnedRel(rel);
  const abs = join(docsRoot(), ...norm.split('/'));
  try {
    await fsp.unlink(abs);
  } catch (err) {
    if (err && err.code === 'ENOENT') throw notFound('文档不存在: ' + norm);
    throw err;
  }
  await fsp.unlink(abs + '.tmp').catch(() => {});
  return norm;
}

// ─── 外部绑定闭包 ──────────────────────────────────────────────────────

/**
 * 全部已登记的外部路径（repos.json 里能扫到的每一处 DocRef）。
 * 返回 [{ path, owner, exists, isDir }]——isDir/exists 现场探测，
 * 不存在的路径保留在列表里（读取侧动态标 missing，导入侧标待初始化）。
 */
export async function externalClosure(store) {
  const list = [];
  const seen = new Set();
  const addRef = (ref, owner) => {
    const p = ref && typeof ref === 'object' ? String(ref.path || '').trim() : '';
    if (!p) return;
    const k = p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    if (seen.has(k)) return;
    seen.add(k);
    list.push({ path: p, owner });
  };
  for (const r of store.repos || []) addRef(r.doc, 'repo/' + (r.name || r.id));
  for (const b of store.boards || []) {
    addRef(b.doc, 'board/' + b.name);
    for (const l of Array.isArray(b.docLinks) ? b.docLinks : []) addRef(l, 'board/' + b.name);
    for (const [rkey, ref] of Object.entries(b.repoDocs || {})) addRef(ref, 'board/' + b.name + '/' + rkey);
  }
  for (const item of list) {
    let st = null;
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

const normAbs = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * 校验外部路径是否落在绑定闭包内（精确命中，或闭包内某目录的前缀）。
 * 命中返回实际绝对路径；闭包外返回 null——调用方一律拒绝。
 */
export function resolveExternal(absPath, closure) {
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
export async function listExternalDocs(closure, { maxDepth = 3, maxFiles = 200 } = {}) {
  const out = [];
  const seen = new Set();
  const push = (abs) => {
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
    const walk = async (dir, depth) => {
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
export function externalDocId(abs) {
  return extDocId(abs);
}

export { ownDocId };
