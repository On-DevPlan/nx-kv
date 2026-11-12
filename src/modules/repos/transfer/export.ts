// 布局导出（v4）：仓库 + 分组 + 参考关系 + **自有文档树**，以**全局唯一 key** 为身份映射。
// 导出物里**不出现任何本地路径**；外部绑定只记引用**不进包**（模型 C 的铁律）。
import { join, resolve } from 'node:path';
import fsp from 'node:fs/promises';
import { makeZip } from '../../../core/zip.js';
import { sanitizeDocRef, withLinkMeta } from '../../docs/docref.js';
import { listOwnDocs } from '../../docs/store.js';
import * as service from '../service.js';
import type { RepoEntry, BoardEntry, Store } from '../repo/rows.js';
import type { LayoutLink } from './layout.js';

/** repoExport 的参数。 */
export interface RepoExportOptions {
  /** 只导出这些 key（空 = 全部） */
  repoKeys?: string[];
  /** 只导出这些看板 key（空 = 全部） */
  boardKeys?: string[];
  /** 是否带上不属于任何看板的仓库（默认 true） */
  includeUnassigned?: boolean;
}

/** 导出布局里的仓库条目。 */
export interface ExportRepoEntry {
  key: string;
  keyCustom: boolean;
  name: string;
  desc: string;
  type: string;
  /** 文档绑定覆盖（v4）：显式导出（哪怕指向约定路径——导入端 diff 要看得见） */
  doc?: any;
  remote?: string;
  remotes?: string[];
  notes?: string;
}

/** 导出布局里看板的成员条目。 */
export interface ExportBoardRepoEntry {
  key: string;
  note?: string;
}

/** 导出布局里的看板条目。 */
export interface ExportBoardEntry {
  key: string;
  name: string;
  desc: string;
  repos: ExportBoardRepoEntry[];
  /** 文档绑定（v4）：组介绍覆盖 */
  doc?: any;
  /** 组级附加文档列表（note/tag 注解跟条目一起走） */
  docLinks?: any[];
  /** 组内描述覆盖（v4） */
  repoDocs?: Record<string, any>;
}

/** repoExport 的返回（v4 layout）。 */
export interface ExportLayout {
  version: number;
  exportedAt: string;
  repos: ExportRepoEntry[];
  boards: ExportBoardEntry[];
  links: LayoutLink[];
  warnings: string[];
  /** zip 内文档清单（repoExportZip 填充） */
  docs?: { files: string[] };
}

// 仓库的 key（自定义 > remote 派生 > local 兜底）
const deriveKeyOf = (r: RepoEntry): string => service.deriveKey(r);

/**
 * 导出布局。
 *   repoKeys / boardKeys  只导出这些 key（空 = 全部）
 *   includeUnassigned     是否带上不属于任何看板的仓库（默认 true）
 *   boardSelection        只导出这些看板的成员关系（与 boardKeys 同义，保留旧名）
 */
export async function repoExport({ repoKeys, boardKeys, includeUnassigned = true }: RepoExportOptions = {}): Promise<ExportLayout> {
  const s: Store = await service.loadStore();
  const warnings: string[] = [];
  const keyOf = new Map<string, string>(s.repos.map((r): [string, string] => [r.id, service.deriveKey(r)]));
  // 看板用**冻结 key**（库里落库的那个；改名过的组不随名字漂）
  const boardKeyOf = new Map<string, string>(s.boards.map((b): [string, string] => [b.id, service.storedBoardKey(b)]));

  const wantRepo = (k: string): boolean => !repoKeys?.length || repoKeys.includes(k);
  const wantBoard = (k: string): boolean => !boardKeys?.length || boardKeys.includes(k);

  // 成员按 key 存（board.repoKeys）——与仓库登记同一套身份
  const memberKeysOf = (b: BoardEntry) => service.boardRepoKeys(b, s);
  const inAnyBoard = new Set(s.boards.flatMap(memberKeysOf));
  const selectedBoards = s.boards.filter((b) => wantBoard(boardKeyOf.get(b.id)!));
  // 选中的仓库 = 直接指定的 + 选中看板的成员 + （可选）未分组仓库
  const selectedIds = new Set<string>();
  for (const r of s.repos) {
    if (!wantRepo(keyOf.get(r.id)!)) continue;
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

  const repos: ExportRepoEntry[] = [];
  for (const r of s.repos) {
    if (!selectedIds.has(r.id)) continue;
    const k = keyOf.get(r.id);
    if (!k) {
      warnings.push(`仓库「${r.name}」没有可用的 key —— 已跳过（先 repo key refresh 或 repo key set）`);
      continue;
    }
    const entry: ExportRepoEntry = {
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

  const boardsOut: ExportBoardEntry[] = selectedBoards.map((b) => {
    const entry: ExportBoardEntry = {
      key: boardKeyOf.get(b.id)!,
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
      .map((l: any) => {
        const d = sanitizeDocRef(l);
        if (!d) return null;
        return withLinkMeta(d, l);
      })
      .filter(Boolean);
    if (links.length) entry.docLinks = links;
    const repoDocs: Record<string, any> = {};
    for (const [rk, ref] of Object.entries(b.repoDocs || {})) {
      const d = sanitizeDocRef(ref);
      if (d) repoDocs[rk] = d;
    }
    if (Object.keys(repoDocs).length) entry.repoDocs = repoDocs;
    return entry;
  });

  // 参考关系：ref → 组 / ref → 单个开发仓库，两类并存，note 随关系走。
  // 同一个 ref 被多个组共享 → 一条 link 的 to 里多个 {board}；
  // 直接绑在仓库上的 → to 里追加 {repo}（不折算成组，也不被组覆盖）。
  const selectedKeySet = new Set(repos.map((r) => r.key));
  const links: LayoutLink[] = [];
  for (const b of s.boards) {
    const bkey = boardKeyOf.get(b.id);
    if (!bkey || !wantBoard(bkey)) continue;
    for (const l of Array.isArray(b.refs) ? b.refs : []) {
      const r = s.repos.find((x) => keyOf.get(x.id) === l.id);
      if (!r) continue;
      const rk = keyOf.get(r.id);
      if (!rk || !selectedKeySet.has(rk)) continue;
      let hit = links.find((x) => x.ref === rk);
      if (!hit) {
        hit = { ref: rk, to: [] };
        links.push(hit);
      }
      hit.to.push(l.note ? { board: bkey, note: l.note } : { board: bkey });
    }
  }
  // 仓库级直接绑定：dev 的 linked（{kind:'ref'}）→ to 里追加 {repo}
  for (const d of s.repos) {
    if ((d.type || 'dev') === 'ref') continue;
    const dk = keyOf.get(d.id);
    if (!dk || !selectedKeySet.has(dk)) continue;
    for (const l of Array.isArray(d.linked) ? d.linked : []) {
      if (!l || l.kind !== 'ref') continue;
      const rk = String(l.id || '');
      if (!rk || !selectedKeySet.has(rk)) continue;
      let hit = links.find((x) => x.ref === rk);
      if (!hit) {
        hit = { ref: rk, to: [] };
        links.push(hit);
      }
      if (hit.to.some((t) => t.repo === dk)) continue;
      hit.to.push(l.note ? { repo: dk, note: l.note } : { repo: dk });
    }
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
export async function repoExportZip(options: RepoExportOptions = {}): Promise<Buffer> {
  const layout = await repoExport(options);
  const docEntries: Array<{ name: string; data: Buffer }> = [];
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
    // 正文只从 DB 取（v6 起不再有磁盘副本）
    docEntries.push({ name: 'docs/' + f.rel, data: Buffer.from(f.body ?? '', 'utf8') });
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
    '  - 外部 md 文件（attachments.kind=mdfile）默认不打包：它们只是路径指针，字节不在库内',
    '    （条目在本地 attachments 表里，换机后需按原路径重新登记）',
    '',
    `仓库 ${layout.repos.length} 个 / 看板 ${layout.boards.length} 个 / 关系 ${layout.links.length} 条 / 文档 ${docEntries.length} 份`,
  ].join('\n');
  return makeZip(
    [{ name: 'layout.json', data: JSON.stringify(layout, null, 2) }, { name: 'README.txt', data: readme }, ...docEntries],
    { mtime: new Date() }
  );
}

/** writeExportZip 的返回。 */
export interface WriteExportZipResult {
  file: string;
  bytes: number;
}

// 写入 zip 到磁盘（CLI --zip 用）
export async function writeExportZip(file: unknown, options: RepoExportOptions = {}): Promise<WriteExportZipResult> {
  const buf = await repoExportZip(options);
  const abs = resolve(String(file));
  await fsp.mkdir(join(abs, '..'), { recursive: true });
  await fsp.writeFile(abs, buf);
  return { file: abs, bytes: buf.length };
}
