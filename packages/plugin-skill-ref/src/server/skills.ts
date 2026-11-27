// 技能扫描：从仓库 / 工作目录的 .claude/skills 与用户配置目录里发现 SKILL.md。
//
// 目录约定（与 Claude Skill 一致）：`<root>/<skill-name>/SKILL.md`。
// 也兼容三种配置写法：
//   - 技能根目录（内含 <skill>/SKILL.md）
//   - .claude 目录（自动下钻 skills/）
//   - 单个技能目录（本身就有 SKILL.md）
//
// 插件是进程内可信代码，这里直接读文件系统；不碰宿主库，也不认识宿主表。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export type SkillSource = 'repo' | 'cwd' | 'config';

export interface SkillEntry {
  /** 稳定 id（`skill:<技能目录或文件的绝对路径>`，路径分隔符统一成 /） */
  id: string;
  name: string;
  description: string;
  /** 技能目录（单文件技能 = 文件所在目录） */
  dir: string;
  /** SKILL.md（或单文件 .md）的绝对路径 */
  skillFile: string;
  /** 扫描来源根目录 */
  root: string;
  source: SkillSource;
  /** 目录名（frontmatter name 可以不同） */
  dirName: string;
}

export interface SkillScanInput {
  repoRoot?: string;
  cwd?: string;
  extraDirs?: readonly string[];
}

export interface SkillScanResult {
  skills: SkillEntry[];
  roots: { path: string; source: SkillSource }[];
  warnings: string[];
}

const MAX_SKILLS = 500;
const MAX_ENTRIES = 500;
const MAX_HEAD_BYTES = 65536;

function msgOf(e: unknown): string {
  return String((e as Error)?.message || e);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** 技能目录里优先找 SKILL.md（大小写双写兼容），找不到返回 ''。 */
function skillFileOf(dir: string): string {
  for (const name of ['SKILL.md', 'skill.md', 'Skill.md']) {
    const file = join(dir, name);
    if (isFile(file)) return file;
  }
  return '';
}

function toPosix(path: string): string {
  return resolve(path).replace(/\\/g, '/');
}

function skillIdOf(dir: string): string {
  return `skill:${toPosix(dir)}`;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return String(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/** 极简 YAML frontmatter：只取顶层 key: value（支持 | / > 折叠）。 */
function frontmatterOf(source: string): { data: Record<string, string>; body: string } {
  const lines = source.split(/\r?\n/);
  if ((lines[0] || '').trim() !== '---') return { data: {}, body: source };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) return { data: {}, body: source };
  const data: Record<string, string> = {};
  let i = 1;
  while (i < end) {
    const line = lines[i] ?? '';
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m || !m[1]) {
      i++;
      continue;
    }
    const key = m[1];
    let value = String(m[2] ?? '').trim();
    if (/^[|>][-+]?\s*$/.test(value)) {
      const fold = value.startsWith('>');
      const parts: string[] = [];
      i++;
      while (i < end) {
        const raw = lines[i] ?? '';
        if (!/^\s/.test(raw) && raw.trim() !== '') break;
        const text = raw.trim();
        if (text) parts.push(text);
        i++;
      }
      value = parts.join(fold ? ' ' : '\n');
    } else {
      value = unquote(value);
      i++;
    }
    data[key] = value;
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

function fallbackDescription(body: string): string {
  for (const raw of body.split(/\r?\n/)) {
    const text = raw.trim();
    if (!text || text.startsWith('#')) continue;
    return text.slice(0, 300);
  }
  return '';
}

interface ParsedSkill {
  name: string;
  description: string;
}

function parseSkill(file: string, fallbackName: string): ParsedSkill {
  let source = '';
  try {
    source = readFileSync(file, 'utf8').slice(0, MAX_HEAD_BYTES);
  } catch {
    return { name: fallbackName, description: '' };
  }
  const { data, body } = frontmatterOf(source);
  return {
    name: String(data.name || '').trim() || fallbackName,
    description: String(data.description || '').trim() || fallbackDescription(body),
  };
}

function candidateRoots(input: SkillScanInput): { path: string; source: SkillSource }[] {
  const out: { path: string; source: SkillSource }[] = [];
  const seen = new Set<string>();
  const add = (path: string, source: SkillSource): void => {
    if (!path) return;
    const dir = resolve(path);
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) return;
    if (!isDir(dir)) return;
    seen.add(key);
    out.push({ path: dir, source });
  };
  const addClaudeSkills = (base: string | undefined, source: SkillSource): void => {
    if (!base) return;
    add(join(base, '.claude', 'skills'), source);
  };
  addClaudeSkills(input.repoRoot, 'repo');
  addClaudeSkills(input.cwd, 'cwd');

  for (const raw of input.extraDirs || []) {
    const text = String(raw || '').trim();
    if (!text) continue;
    const dir = resolve(text);
    if (skillFileOf(dir)) {
      add(dir, 'config'); // 单个技能目录
      continue;
    }
    const name = basename(dir).toLowerCase();
    if (name === 'skills') {
      add(dir, 'config');
    } else if (name === '.claude') {
      add(join(dir, 'skills'), 'config');
    } else {
      const nested = join(dir, '.claude', 'skills');
      if (isDir(nested)) add(nested, 'config');
      else if (isDir(join(dir, 'skills'))) add(join(dir, 'skills'), 'config');
      else add(dir, 'config');
    }
  }
  return out;
}

/** 扫描全部技能根目录（去重、排序、上限保护）。 */
export function scanSkills(input: SkillScanInput = {}): SkillScanResult {
  const roots = candidateRoots(input);
  const skills: SkillEntry[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  const push = (dir: string, file: string, root: string, source: SkillSource): boolean => {
    const singleFile = file === dir;
    const id = singleFile ? `skill:${toPosix(file)}` : skillIdOf(dir);
    if (seen.has(id)) return true;
    const skillDir = singleFile ? dirname(file) : dir;
    const dirName = singleFile ? basename(file).replace(/\.md$/i, '') : basename(dir);
    const parsed = parseSkill(file, dirName);
    seen.add(id);
    skills.push({
      id,
      name: parsed.name,
      description: parsed.description.slice(0, 4000),
      dir: skillDir,
      skillFile: file,
      root,
      source,
      dirName,
    });
    if (skills.length >= MAX_SKILLS) {
      warnings.push(`技能数量超过 ${MAX_SKILLS} 条，已截断`);
      return false;
    }
    return true;
  };

  for (const root of roots) {
    const single = skillFileOf(root.path);
    if (single) {
      // 配置里直接指向单个技能目录
      if (!push(root.path, single, root.path, root.source)) break;
      continue;
    }
    let entries;
    try {
      entries = readdirSync(root.path, { withFileTypes: true });
    } catch (e) {
      warnings.push(`读取技能目录失败：${root.path}（${msgOf(e)}）`);
      continue;
    }
    let count = 0;
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (++count > MAX_ENTRIES) {
        warnings.push(`技能目录条目超过 ${MAX_ENTRIES} 个，已截断：${root.path}`);
        break;
      }
      const full = join(root.path, entry.name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        const file = skillFileOf(full);
        if (file && !push(full, file, root.path, root.source)) break;
      } else if (stat.isFile() && full.toLowerCase().endsWith('.md')) {
        // 根目录直接放单文件技能（少见但兼容）
        if (!push(full, full, root.path, root.source)) break;
      }
    }
    if (skills.length >= MAX_SKILLS) break;
  }

  skills.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { skills, roots, warnings };
}
