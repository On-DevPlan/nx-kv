// git 封装：参考仓库唯一允许碰 git 的地方。
//
// 边界（service.js 头注释同步声明）：只有 type=ref 的仓库走这里——clone / pull / 读
// origin 三件事；开发仓库（type=dev）绝不进来，git 状态/diff/push 依然归 git 自己。
// 错误一律归 EXTERNAL（core/errors.js 的既有码）——失败原因是外部命令，不是本工具的输入。
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import { external } from '../../core/errors.js';

/** remote 地址的传输类型。 */
export type RemoteKind = 'ssh' | 'https' | 'other';

/** `git remote -v` 的一条候选。 */
export interface RemoteInfo {
  name: string;
  url: string;
  kind: RemoteKind;
}

function run(args: string[], { cwd, timeoutMs }: { cwd?: string; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const out = [String(stderr || ''), String(stdout || '')].filter(Boolean).join('\n').trim();
        reject(new Error(out || err.message));
        return;
      }
      resolve(String(stdout || '').trim());
    });
    // 超时不是「失败」而是「不可达」——kill 掉并让错误信息带上网关词
    if (timeoutMs) {
      const _timer = setTimeout(() => {
        try { child.kill(); } catch { /* 已经退了 */ }
        reject(new Error(`git ${args[0]} 超时（${timeoutMs}ms）—— 网络不可达或远端无响应`));
      }, timeoutMs);
      if (typeof child.unref === 'function') child.unref();
    }
  });
}

// SSH ↔ HTTPS 互变（只处理 github 形态——这是参考仓库的绝对主力；其它 host 原样返回 null）。
// 来源是 mmx-research-gitclone 的既有教训：SSH 挂了别放弃，换 HTTPS 再试一次（反之亦然）。
function altUrl(url: unknown): string | null {
  const s = String(url || '').trim();
  let m = /^git@([^:/]+):(.+?)(?:\.git)?$/i.exec(s);
  if (m && /(^|\.)github\.com$/i.test(m[1] as string)) return 'https://github.com/' + (m[2] as string);
  m = /^https:\/\/github\.com\/(.+?)(?:\.git)?$/i.exec(s);
  if (m) return 'git@github.com:' + (m[1] as string);
  return null;
}

async function tryClone(url: string, dest: string, depth: number): Promise<string> {
  const args = ['clone', '--depth', String(depth), url, dest];
  try {
    await run(args);
    return url;
  } catch (err) {
    throw new Error(`git clone ${url} 失败: ${String((err as Error).message).slice(-500)}`);
  }
}

/**
 * 浅克隆。主 URL 失败时用变形 URL（SSH↔HTTPS，仅 github）再试一次；
 * 两个都挂 → external()，带上两次失败的输出尾部（agent 靠它判断网络/权限问题）。
 * 返回实际成功的那条 URL（登记时以它为准）。
 */
export async function gitClone(url: unknown, dest: string, { depth = 1 }: { depth?: number } = {}): Promise<string> {
  const urls = [String(url).trim()];
  const alt = altUrl(url);
  if (alt) urls.push(alt);
  const failures: string[] = [];
  for (const u of urls) {
    try {
      return await tryClone(u, dest, depth);
    } catch (err) {
      failures.push(String((err as Error).message || err));
    }
  }
  throw external('克隆失败（' + failures.length + ' 个通道都试过）:\n' + failures.join('\n'));
}

/** gitPull 的业务结果：updated = 拉到新提交；upToDate = 已是最新；conflict = 需人工决策。 */
export interface GitPullResult {
  status: 'updated' | 'upToDate' | 'conflict';
  output: string;
}

/**
 * git pull --ff-only。刻意不用默认 pull：非 ff 的落后需要人决策（stash/reset/merge），
 * 自动 merge 只会制造"看起来同步了"的脏状态。
 * 返回 { status: 'updated' | 'upToDate' | 'conflict', output }。
 */
export async function gitPull(dir: string): Promise<GitPullResult> {
  try {
    const output = await run(['pull', '--ff-only'], { cwd: dir });
    return { status: /up.to.date|up to date/i.test(output) ? 'upToDate' : 'updated', output };
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    // 非 ff / 本地改动挡路 → 是需要人决策的冲突状态，不是外部故障
    if (/not.fast.forward|divergent|local changes|would be overwritten/i.test(msg)) {
      return { status: 'conflict', output: msg.slice(-500) };
    }
    throw external('git pull 失败: ' + msg.slice(-500));
  }
}

/** 读 origin URL（读配置，不算状态探测）。没有 origin 返回 ''。 */
export async function gitOrigin(dir: string): Promise<string> {
  try {
    return await run(['remote', 'get-url', 'origin'], { cwd: dir });
  } catch {
    return '';
  }
}

/** URL 的传输类型：ssh（git@ 或 ssh://）/ https / 其它。选远程地址时 SSH 优先。 */
export function remoteKind(url: unknown): RemoteKind {
  const s = String(url || '').trim();
  if (/^git@/.test(s) || /^ssh:\/\//i.test(s)) return 'ssh';
  if (/^https?:\/\//i.test(s)) return 'https';
  return 'other';
}

/** gitLsRemote 的结论：exists = 仓库存在；missing = 地址失效；unreachable = 连不上。 */
export interface GitLsRemoteResult {
  status: 'exists' | 'missing' | 'unreachable';
  detail: string;
  branches: string[];
}

/**
 * 检查远程仓库**是否存在**（只读，不落任何东西）。
 *
 * 用 `git ls-remote --heads <url>`：能列出分支 = 存在；报 "repository not found"
 * = 不存在；其它（超时/鉴权/DNS）= 不可达。三种结论必须分清——
 * 「不存在」和「连不上」对用户的行动完全不同（前者该换地址，后者该修网络）。
 *
 * 返回 { status: 'exists' | 'missing' | 'unreachable', detail, branches }
 */
export async function gitLsRemote(url: unknown, timeoutMs = 8000): Promise<GitLsRemoteResult> {
  const target = String(url || '').trim();
  if (!target) return { status: 'unreachable', detail: '没有远程地址', branches: [] };
  try {
    const out = await run(['ls-remote', '--heads', target], { timeoutMs });
    const branches = out.split('\n').filter(Boolean).map((l) => l.split('\t')[1]).filter(Boolean) as string[];
    return {
      status: 'exists',
      detail: branches.length ? `${branches.length} 个分支` : '仓库可访问（没有分支）',
      branches,
    };
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (/not found|does not exist|repository .* not found|no such file or directory|Could not read from remote repository/i.test(msg)) {
      return { status: 'missing', detail: '远程仓库不存在（地址可能失效或仓库已删除）', branches: [] };
    }
    if (/authentication failed|could not read username|permission denied|403|401/i.test(msg)) {
      return { status: 'unreachable', detail: '鉴权失败（需要凭据）', branches: [] };
    }
    return { status: 'unreachable', detail: '网络不可达或远端无响应', branches: [] };
  }
}

/**
 * `git remote -v` 的全部远程地址，按 (name,url) 去重。
 * 返回 [{ name, url, kind }]。目录不是 git 仓库 / 没有远程 → []。
 */
export async function gitRemotes(dir: string): Promise<RemoteInfo[]> {
  let out = '';
  try {
    out = await run(['remote', '-v'], { cwd: dir });
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const list: RemoteInfo[] = [];
  for (const line of out.split('\n')) {
    // 形如：origin\tgit@github.com:a/b.git (fetch)
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!m) continue;
    const name = m[1] as string;
    const url = m[2] as string;
    const k = name + ' ' + url; // fetch/push 成对出现，按 (name,url) 去重
    if (seen.has(k)) continue;
    seen.add(k);
    list.push({ name, url, kind: remoteKind(url) });
  }
  return list;
}

/**
 * 从 gitRemotes 的结果里挑一个「采纳」的地址：
 *   1. 优先名为 origin 的；
 *   2. 同一名字下有多条时 **SSH 优先**，其次 https（用户要求：git remote -v 优先 ssh）；
 *   3. 没有 origin 就取第一个 remote。
 */
export function pickRemote(remotes: RemoteInfo[]): RemoteInfo | null {
  if (!Array.isArray(remotes) || !remotes.length) return null;
  const rank: Record<string, number> = { ssh: 0, https: 1, other: 2 };
  const byName = new Map<string, RemoteInfo[]>();
  for (const r of remotes) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name)!.push(r);
  }
  const chosenName = byName.has('origin') ? 'origin' : remotes[0]!.name;
  const group = byName.get(chosenName) || [];
  return group.slice().sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9))[0] || null;
}

/** 目录里有没有 .git（目录或文件——worktree 下是文件）。 */
export async function hasGit(dir: string): Promise<boolean> {
  try {
    await fsp.stat(dir + '\\.git');
    return true;
  } catch {
    // Windows 以外的分隔符写法（测试里可能传 posix 风格路径）
    try {
      await fsp.stat(dir + '/.git');
      return true;
    } catch {
      return false;
    }
  }
}
