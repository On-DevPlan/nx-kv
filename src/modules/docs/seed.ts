// 字符串字段 ↔ md 文档的桥梁：摘要派生回写 + 迁移种子。
//
// **权威关系**：md 是描述内容的唯一权威；repos.json 里的 desc / repoNotes 字符串
// 降级为**短摘要**——组详情表格、repo list、zip layout 读的永远是它，所以每次
// 保存 md 都要单向回写一份新摘要，读取方一行都不用改。
//
// **迁移 = 惰性 + 显式**：惰性（doc.get 发现约定路径缺失且字符串非空 → 先播种）
// 保证任何读路径自动补齐；显式（docs seed --apply）可预览、可测试。
import * as paths from './paths.js';
import * as store from './store.js';
import { reposBridge } from './repos-bridge.js';
import { parseFrontmatter } from '../../core/frontmatter.js';

const clean = (v: unknown): string => String(v || '').trim();

/** 摘要 = frontmatter description 优先，否则首个非标题非引用非空行，截 120 字 */
export function summaryFromMd(body: unknown): string {
  const fm = parseFrontmatter(String(body || ''));
  if (fm.description) return fm.description.slice(0, 120);
  for (const raw of String(body || '').split('\n')) {
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('>')) continue;
    return t.slice(0, 120);
  }
  return '';
}

/** 约定路径的归属（ownerOfRel 的产出）：反查要回写的字符串字段。 */
export type RelOwner =
  | { kind: 'repo'; repo: any; repoKey?: string }
  | { kind: 'board'; board: any; repoKey?: string }
  | { kind: 'note'; board: any; repoKey: string };

/** 一条种子计划项。 */
export interface SeedItem {
  rel: string;
  title: string;
  body: string;
}

/**
 * 约定路径归属：rel → { kind:'repo'|'board'|'note', ... }（反查要回写的字符串字段）。
 * 大小写不敏感比较（Windows 文件系统不分大小写，用户手写路径两种大小写都该认）。
 */
export async function ownerOfRel(rel: unknown): Promise<RelOwner | null> {
  const want = String(rel || '').replace(/\\/g, '/').toLowerCase();
  if (!want) return null;
  const { loadStore, deriveKey, boardRepoKeys } = await reposBridge();
  const s = await loadStore();
  for (const r of s.repos) {
    if (paths.repoDocRel(deriveKey(r)).toLowerCase() === want) return { kind: 'repo', repo: r };
  }
  for (const b of s.boards) {
    if (paths.boardDocRel(b.name).toLowerCase() === want) return { kind: 'board', board: b };
    for (const rk of boardRepoKeys(b, s)) {
      if (paths.groupNoteRel(b.name, rk).toLowerCase() === want) {
        return { kind: 'note', board: b, repoKey: rk };
      }
    }
  }
  return null;
}

/**
 * 保存 md 后回写短摘要（单向：md → 字符串字段）。非约定路径返回 null（自由文档不回写）。
 * 手动 repo update --desc 改的摘要，下次保存 md 时会被这里的派生值覆盖——这是有意的：
 * 摘要是文档的影子，不是第三个真相源。
 */
export async function writeBackSummary(rel: unknown, body: unknown): Promise<string | null> {
  const owner = await ownerOfRel(rel);
  if (!owner) return null;
  const summary = summaryFromMd(body);
  const { mutateStore } = await reposBridge();
  return mutateStore((s: any) => {
    if (owner.kind === 'repo') {
      const r = s.repos.find((x: any) => x.id === owner.repo.id);
      if (r) r.desc = summary;
    } else if (owner.kind === 'board') {
      const b = s.boards.find((x: any) => x.id === owner.board.id);
      if (b) b.desc = summary;
    } else {
      const b = s.boards.find((x: any) => x.id === owner.board.id);
      if (b) {
        if (!b.repoNotes) b.repoNotes = {};
        if (summary) b.repoNotes[owner.repoKey] = summary;
        else delete b.repoNotes[owner.repoKey];
      }
    }
    return summary;
  });
}

// ─── 迁移种子 ──────────────────────────────────────────────────────────

// 种子标题：项目/组用名字本身；组内描述用「组名 · 仓库名」（同一仓库在多个组里各有一份）
async function seedTitle(owner: RelOwner): Promise<string> {
  if (owner.kind === 'repo') return owner.repo.name || owner.repoKey || '';
  if (owner.kind === 'board') return owner.board.name;
  const { loadStore, deriveKey } = await reposBridge();
  const s = await loadStore();
  const r = s.repos.find((x: any) => deriveKey(x) === owner.repoKey);
  return (owner.board.name || '') + ' · ' + ((r && r.name) || owner.repoKey);
}

// 字符串字段非空 + 约定路径文件缺失 = 候选种子
async function candidateOf(rel: string, field: unknown, owner: RelOwner): Promise<SeedItem | null> {
  if (!clean(field)) return null;
  if (await store.ownDocExists(rel)) return null;
  const title = await seedTitle(owner);
  return { rel, title, body: '# ' + title + '\n\n' + clean(field) + '\n' };
}

/** 种子计划（零副作用）：列出所有「字符串有值、文档还没落盘」的约定路径 */
export async function seedPlan(): Promise<{ items: SeedItem[]; count: number }> {
  const { loadStore, deriveKey, boardRepoKeys } = await reposBridge();
  const s = await loadStore();
  const items: SeedItem[] = [];
  for (const r of s.repos) {
    const rel = paths.repoDocRel(deriveKey(r));
    const c = await candidateOf(rel, r.desc, { kind: 'repo', repo: r });
    if (c) items.push(c);
  }
  for (const b of s.boards) {
    const rel = paths.boardDocRel(b.name);
    const c = await candidateOf(rel, b.desc, { kind: 'board', board: b });
    if (c) items.push(c);
    for (const rk of boardRepoKeys(b, s)) {
      const nrel = paths.groupNoteRel(b.name, rk);
      const nc = await candidateOf(nrel, (b.repoNotes || {})[rk], { kind: 'note', board: b, repoKey: rk });
      if (nc) items.push(nc);
    }
  }
  return { items, count: items.length };
}

/** 执行种子（幂等：已有文档的路径自动跳过）。 */
export async function seedApply(): Promise<{ written: number; items: string[] }> {
  const plan = await seedPlan();
  for (const item of plan.items) {
    await store.writeOwnDoc(item.rel, item.body);
  }
  return { written: plan.items.length, items: plan.items.map((x) => x.rel) };
}

/**
 * 惰性种子：doc.get 读约定路径发现文件缺失时调用。
 * 对应字符串字段非空 → 播种并返回正文；否则返回 null（调用方按「文档不存在」处理）。
 * 读路径最多一次副作用，之后文件已在，幂等。
 */
export async function ensureSeedForRel(rel: unknown): Promise<string | null> {
  const owner = await ownerOfRel(rel);
  if (!owner) return null;
  const field =
    owner.kind === 'repo' ? owner.repo.desc : owner.kind === 'board' ? owner.board.desc : (owner.board.repoNotes || {})[owner.repoKey] || '';
  if (!clean(field)) return null;
  const title = await seedTitle(owner);
  const body = '# ' + title + '\n\n' + clean(field) + '\n';
  await store.writeOwnDoc(rel as string, body);
  return body;
}
