// 布局导出（v4）：仓库 + 分组 + 参考关系 + **自有文档树**，以**全局唯一 key** 为身份映射。
// 导出物里**不出现任何本地路径**；外部绑定只记引用**不进包**（模型 C 的铁律）。
import { join, resolve } from 'node:path';
import fsp from 'node:fs/promises';
import { makeZip } from '../../../core/zip.js';
import { sanitizeDocRef, withLinkMeta } from '../../docs/docref.js';
import { listOwnDocs } from '../../docs/store.js';
import * as service from '../service.js';

// 仓库的 key（自定义 > remote 派生 > local 兜底）
const deriveKeyOf = (r) => service.deriveKey(r);

/**
 * 导出布局。
 *   repoKeys / boardKeys  只导出这些 key（空 = 全部）
 *   includeUnassigned     是否带上不属于任何看板的仓库（默认 true）
 *   boardSelection        只导出这些看板的成员关系（与 boardKeys 同义，保留旧名）
 */
export async function repoExport({ repoKeys, boardKeys, includeUnassigned = true } = {}) {
  const s = await service.loadStore();
  const warnings = [];
  const keyOf = new Map(s.repos.map((r) => [r.id, service.deriveKey(r)]));
  // 看板用**冻结 key**（库里落库的那个；改名过的组不随名字漂）
  const boardKeyOf = new Map(s.boards.map((b) => [b.id, service.storedBoardKey(b)]));

  const wantRepo = (k) => !repoKeys?.length || repoKeys.includes(k);
  const wantBoard = (k) => !boardKeys?.length || boardKeys.includes(k);

  // 成员按 key 存（board.repoKeys）——与仓库登记同一套身份
  const memberKeysOf = (b) => service.boardRepoKeys(b, s);
  const inAnyBoard = new Set(s.boards.flatMap(memberKeysOf));
  const selectedBoards = s.boards.filter((b) => wantBoard(boardKeyOf.get(b.id)));
  // 选中的仓库 = 直接指定的 + 选中看板的成员 + （可选）未分组仓库
  const selectedIds = new Set();
  for (const r of s.repos) {
    if (!wantRepo(keyOf.get(r.id))) continue;
    if (repoKeys?.length) selectedIds.add(r.id);
  }
  for (const b of selectedBoards) {
    for (const k of memberKeysOf(b)) {
      const hit = s.repos.find((r) => deriveKeyOf(r) === k);
      if (hit) selectedIds.add(hit.id);
    }
  }
  if (includeUnassigned && !repoKeys?.length && !boardKeys?.length) {
    for (const r of s.repos) if (!inAnyBoard.has(deriveKeyOf(r))) selectedIds.add(r.id);
  }

  const repos = [];
  for (const r of s.repos) {
    if (!selectedIds.has(r.id)) continue;
    const k = keyOf.get(r.id);
    if (!k) {
      warnings.push(`仓库「${r.name}」没有可用的 key —— 已跳过（先 repo key refresh 或 repo key set）`);
      continue;
    }
    const entry = {
      key: k,
      keyCustom: !!r.keyCustom,
      name: r.name,
      desc: r.desc || '',
      type: r.type || 'dev',
    };
    // 文档绑定覆盖（v4）：显式导出（哪怕指向约定路径——导入端 diff 要看得见）
    const doc = sanitizeDocRef(r.doc);
    if (doc) entry.doc = doc;
    if (r.remote) entry.remote = r.remote;
    if (Array.isArray(r.remotes) && r.remotes.length) entry.remotes = r.remotes.slice();
    if (r.notes) entry.notes = r.notes;
    if (!r.remote && (r.type || 'dev') === 'dev') {
      warnings.push(`开发仓库「${r.name}」没有远程地址 —— 导入端只能按 key 登记，无法 clone`);
    }
    repos.push(entry);
  }

  const boardsOut = selectedBoards.map((b) => {
    const entry = {
      key: boardKeyOf.get(b.id),
      name: b.name,
      desc: b.desc || '',
      // 成员按 key 引用（占位成员也在——本地没有的仓库照样导出，导入端会标「本地未拥有」）
      repos: service.boardRepoKeys(b, s)
        .map((k) => {
          const note = (b.repoNotes || {})[k] || '';
          return note ? { key: k, note } : { key: k };
        }),
    };
    // 文档绑定（v4）：组介绍覆盖 / 组级附加列表 / 组内描述覆盖
    const bdoc = sanitizeDocRef(b.doc);
    if (bdoc) entry.doc = bdoc;
    // docLinks 条目 = DocRef + 注解（note/tag），注解跟条目一起走（withLinkMeta 统一口径）
    const links = (Array.isArray(b.docLinks) ? b.docLinks : [])
      .map((l) => {
        const d = sanitizeDocRef(l);
        if (!d) return null;
        return withLinkMeta(d, l);
      })
      .filter(Boolean);
    if (links.length) entry.docLinks = links;
    const repoDocs = {};
    for (const [rk, ref] of Object.entries(b.repoDocs || {})) {
      const d = sanitizeDocRef(ref);
      if (d) repoDocs[rk] = d;
    }
    if (Object.keys(repoDocs).length) entry.repoDocs = repoDocs;
    return entry;
  });

  // 参考关系：ref → 目标（repo key / board key），note 随关系走
  const selectedKeySet = new Set(repos.map((r) => r.key));
  const links = [];
  for (const r of s.repos) {
    if ((r.type || 'dev') !== 'ref' || !(r.linked || []).length) continue;
    const k = keyOf.get(r.id);
    if (!k || !selectedKeySet.has(k)) continue;
    const to = [];
    for (const l of r.linked) {
      // 关系引用已经是 key（迁移后），直接用
      if (l.kind === 'repo') {
        if (selectedKeySet.has(l.id)) to.push(l.note ? { repo: l.id, note: l.note } : { repo: l.id });
      } else if (l.kind === 'board') {
        if (wantBoard(l.id)) to.push(l.note ? { board: l.id, note: l.note } : { board: l.id });
      }
    }
    if (to.length) links.push({ ref: k, to });
  }

  // 看板关系里可能引用了没被选中的仓库 —— 如实报告，导入端会标「本地未拥有」
  for (const b of boardsOut) {
    for (const m of b.repos) {
      if (!selectedKeySet.has(m.key)) {
        warnings.push(`看板「${b.name}」的成员 ${m.key} 不在导出范围内 —— 导入端会显示为「本地未拥有」`);
      }
    }
  }

  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    repos,
    boards: boardsOut,
    links,
    warnings,
  };
}

// zip 内文档条目的体积/数量防御：导出物是「描述」不是备份通道
const MAX_DOC_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_DOC_ENTRIES = 60000;

/** 导出为 zip：layout.json(v4) + README.txt + docs/<自有树>。返回 Buffer。 */
export async function repoExportZip(options = {}) {
  const layout = await repoExport(options);
  const docEntries = [];
  const own = await listOwnDocs();
  for (const f of own) {
    if (docEntries.length >= MAX_DOC_ENTRIES) {
      layout.warnings.push(`文档条目超过 ${MAX_DOC_ENTRIES} 上限，未打包: ${f.rel}`);
      continue;
    }
    if (f.size > MAX_DOC_ENTRY_BYTES) {
      layout.warnings.push(`文档超过 2MB 未打包: ${f.rel}`);
      continue;
    }
    docEntries.push({ name: 'docs/' + f.rel, data: await fsp.readFile(f.abs) });
  }
  // zip 内清单进 layout（diff 展示用；实际内容就是 zip 条目本身）
  layout.docs = { files: docEntries.map((e) => e.name.slice('docs/'.length)) };

  const readme = [
    'nx-kv 仓库布局导出',
    `导出时间: ${layout.exportedAt}`,
    `格式版本: ${layout.version}`,
    '',
    '导入方法:',
    '  nx-kv repo import <本文件>.zip --diff     # 先看差异（zip 直接吃）',
    '  nx-kv repo import <本文件>.zip            # 执行导入',
    '  面板: 仓库页 →「导入导出」→ 粘贴 layout.json（zip 导入走 CLI）',
    '',
    '说明:',
    '  - 每个仓库以全局唯一 key 标识（来自远程地址或自定义）',
    '  - 不包含任何本地路径，换机导入后需 clone 或手工登记',
    '  - 看板以 board/<名称> 为 key；关系与组内描述都在 layout.json 里',
    '  - docs/ 是自有文档树（项目/组介绍、组内描述），导入后原样恢复',
    '  - 外部绑定（如 Obsidian vault）只记引用，不在包里——路径缺失会标「待初始化」',
    '',
    `仓库 ${layout.repos.length} 个 / 看板 ${layout.boards.length} 个 / 关系 ${layout.links.length} 条 / 文档 ${docEntries.length} 份`,
  ].join('\n');
  return makeZip(
    [{ name: 'layout.json', data: JSON.stringify(layout, null, 2) }, { name: 'README.txt', data: readme }, ...docEntries],
    { mtime: new Date() }
  );
}

// 写入 zip 到磁盘（CLI --zip 用）
export async function writeExportZip(file, options = {}) {
  const buf = await repoExportZip(options);
  const abs = resolve(String(file));
  await fsp.mkdir(join(abs, '..'), { recursive: true });
  await fsp.writeFile(abs, buf);
  return { file: abs, bytes: buf.length };
}
