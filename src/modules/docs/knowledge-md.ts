// repo knowledge 的 markdown 渲染（`repo knowledge --md`）。
// 从 knowledge.ts 拆出：知识聚合与交付层读取分开，主文件保持在行数门禁内。
import { getDb } from '../../core/db/index.js';
import type { KnowledgeDoc, RepoKnowledgeResult, IntroSet } from './knowledge.js';

/** 文档集 → markdown 行（主篇正文 + 其余各篇的取用指令） */
export function introMdLines(set: IntroSet | null | undefined, fallback: KnowledgeDoc | null | undefined): string[] {
  const out: string[] = [];
  const main = (set && set.main) || (fallback && !fallback.missing ? fallback : null);
  if (main && main.body) out.push(String(main.body).trim());
  const extras = (set && set.extras) || [];
  if (extras.length) {
    out.push('', '其余介绍文档（可用命令读取）:');
    for (const d of extras) {
      // ref 是 DB 实体：给 refId 让调用方按 id 取，不展示路径。
      const refId = d.rel
        ? String(getDb().get('SELECT id FROM refs WHERE rel = :rel AND deleted_at IS NULL', { rel: d.rel })?.id || '')
        : '';
      out.push(`- nx-kv docs get --ref ${refId || d.docId || ''}`);
    }
  }
  return out;
}

/** 单篇 markdown：项目介绍 → 各组（介绍/组内描述/绑定文档）→ 参考仓库 */
export function renderRepoKnowledgeMd(k: RepoKnowledgeResult): string {
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
