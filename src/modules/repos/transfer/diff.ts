// 导入差异检查：逐条给出 status 与字段级差异。**零副作用**（不落盘、不触网）。
import { md5Of } from '../../../core/fstree.js';
import { listOwnDocs } from '../../docs/store.js';
import * as service from '../service.js';
import { clean, parseLayout } from './layout.js';
import type { LayoutRepo, LayoutBoard, LayoutLink } from './layout.js';
import type { RepoEntry, BoardEntry, Store } from '../repo/rows.js';

/** zip 拆出的文档条目（v8：文件名就是 refId）。 */
export interface DiffDocEntry {
  refId: string;
  data: Buffer;
}

/** 字段级差异（local = 本地值，incoming = 导入值）。 */
export interface DiffField {
  field: string;
  local: any;
  incoming: any;
}

/** 仓库差异条目。 */
export interface DiffRepoEntry {
  key: string;
  status: 'new' | 'same' | 'changed';
  local: {
    id: string;
    name: string;
    desc: string;
    type: string;
    remote: string;
    path: string;
  } | null;
  incoming: LayoutRepo;
  fields: DiffField[];
  canClone: boolean;
}

/** 本地未拥有的看板成员（面板的「克隆到本地」按钮要用 remote）。 */
export interface DiffMissingMember {
  key: string;
  name: string;
  remote: string;
  type: string;
  clonable: boolean;
}

/** 看板差异条目。 */
export interface DiffBoardEntry {
  key: string;
  status: 'new' | 'same' | 'changed';
  local: { id: string; name: string; desc: string } | null;
  incoming: LayoutBoard;
  fields: DiffField[];
  missingMembers: DiffMissingMember[];
}

/** 文档差异条目。 */
export interface DiffDocStatus {
  refId: string;
  status: 'new' | 'changed' | 'same';
}

/** diffImport 的 summary 计数。 */
export interface DiffSummary {
  new: number;
  changed: number;
  same: number;
  missing: number;
  boardsNew: number;
  boardsChanged: number;
  docsNew: number;
  docsChanged: number;
  docsSame: number;
}

/** diffImport 的返回。 */
export interface DiffImportResult {
  version: number;
  repos: DiffRepoEntry[];
  boards: DiffBoardEntry[];
  links: LayoutLink[];
  docs: DiffDocStatus[];
  missing: string[];
  summary: DiffSummary;
  warnings: string[];
}

const COMPARE_FIELDS = ['name', 'desc', 'notes', 'type', 'remote'];

/**
 * 导入差异：逐条给出 status 与字段级差异。
 *   new            本地没有这个 key
 *   same           本地有且字段一致
 *   changed        本地有但字段有差异（fields 列出每一项）
 *   missing-local  文件里被看板/关系引用，但文件与本地都没有定义（断链）
 * docsFiles: zip 拆出的文档条目 [{refId, data}]（面板 JSON 粘贴导入没有这一段——
 * 差异里 docs 为空数组，summary 计数全 0）。
 */
export async function diffImport(json: unknown, docsFiles: DiffDocEntry[] = []): Promise<DiffImportResult> {
  const layout = parseLayout(json);
  const s: Store = await service.loadStore();
  const localByKey = new Map<string, RepoEntry>(s.repos.map((r): [string, RepoEntry] => [service.deriveKey(r), r]));

  const repos: DiffRepoEntry[] = layout.repos.map((inc) => {
    const local = localByKey.get(inc.key) || null;
    if (!local) {
      return {
        key: inc.key,
        status: 'new',
        local: null,
        incoming: inc,
        fields: [],
        canClone: !!inc.remote,
      };
    }
    const fields: DiffField[] = [];
    for (const f of COMPARE_FIELDS) {
      // type 读时默认 dev（老记录没有该字段）——比较也要按同一默认值来，
      // 否则每条老仓库都会被误报成「type 有差异」。
      const a = f === 'type' ? clean((local as any)[f]) || 'dev' : clean((local as any)[f]);
      const b = clean((inc as any)[f]);
      if (a !== b) fields.push({ field: f, local: a, incoming: b });
    }
    return {
      key: inc.key,
      status: fields.length ? 'changed' : 'same',
      local: { id: local.id, name: local.name, desc: local.desc, type: local.type || 'dev', remote: local.remote || '', path: local.path },
      incoming: inc,
      fields,
      canClone: !!inc.remote,
    };
  });

  const knownKeys = new Set([...repos.map((r) => r.key), ...localByKey.keys()]);
  const missing = new Set<string>();
  for (const b of layout.boards) for (const m of b.repos) if (!knownKeys.has(m.key)) missing.add(m.key);
  for (const l of layout.links) {
    if (!knownKeys.has(l.ref)) missing.add(l.ref);
    for (const t of l.to) if (t.repo && !knownKeys.has(t.repo)) missing.add(t.repo);
  }

  const boardByKey = new Map<string, BoardEntry>(s.boards.map((b): [string, BoardEntry] => [service.storedBoardKey(b), b]));
  const boardsOut: DiffBoardEntry[] = layout.boards.map((inc) => {
    const local = boardByKey.get(inc.key) || null;
    const fields: DiffField[] = [];
    if (local) {
      if (clean(local.name) !== inc.name) fields.push({ field: 'name', local: local.name, incoming: inc.name });
      if (clean(local.desc) !== inc.desc) fields.push({ field: 'desc', local: local.desc || '', incoming: inc.desc });
    }
    // 本地未拥有的成员：带上 remote（面板的「克隆到本地」按钮要用它）
    const missingMembers: DiffMissingMember[] = inc.repos
      .filter((m) => !knownKeys.has(m.key))
      .map((m) => {
        const src = layout.repos.find((x) => x.key === m.key);
        return {
          key: m.key,
          name: (src && src.name) || m.key,
          remote: (src && src.remote) || '',
          type: (src && src.type) || 'dev',
          clonable: !!(src && src.remote),
        };
      });
    return {
      key: inc.key,
      status: !local ? 'new' : fields.length ? 'changed' : 'same',
      local: local ? { id: local.id, name: local.name, desc: local.desc || '' } : null,
      incoming: inc,
      fields,
      missingMembers,
    };
  });

  // 文档差异：zip 带来的 docs/<refId>.md 与本地 ref 正文逐篇 md5 比较
  const docsOut: DiffDocStatus[] = [];
  if (docsFiles.length) {
    const local = new Map<string, string>((await listOwnDocs()).map((f: any): [string, string] => [f.id, f.md5]));
    for (const f of docsFiles) {
      const localMd5 = local.get(f.refId);
      if (localMd5 === undefined) docsOut.push({ refId: f.refId, status: 'new' });
      else if (localMd5 !== md5Of(f.data)) docsOut.push({ refId: f.refId, status: 'changed' });
      else docsOut.push({ refId: f.refId, status: 'same' });
    }
  }

  const summary: DiffSummary = {
    new: repos.filter((r) => r.status === 'new').length,
    changed: repos.filter((r) => r.status === 'changed').length,
    same: repos.filter((r) => r.status === 'same').length,
    missing: missing.size,
    boardsNew: boardsOut.filter((b) => b.status === 'new').length,
    boardsChanged: boardsOut.filter((b) => b.status === 'changed').length,
    docsNew: docsOut.filter((d) => d.status === 'new').length,
    docsChanged: docsOut.filter((d) => d.status === 'changed').length,
    docsSame: docsOut.filter((d) => d.status === 'same').length,
  };

  return {
    version: layout.version || 5,
    repos,
    boards: boardsOut,
    links: layout.links,
    docs: docsOut,
    missing: [...missing],
    summary,
    warnings: Array.isArray(layout.warnings) ? layout.warnings : [],
  };
}
