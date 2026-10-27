// git 封装：参考仓库唯一允许碰 git 的地方。
//
// 边界（service.js 头注释同步声明）：只有 type=ref 的仓库走这里——clone / pull / 读
// origin 三件事；开发仓库（type=dev）绝不进来，git 状态/diff/push 依然归 git 自己。
// 错误一律归 EXTERNAL（core/errors.js 的既有码）——失败原因是外部命令，不是本工具的输入。
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import { external } from '../../core/errors.js';

function run(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const out = [String(stderr || ''), String(stdout || '')].filter(Boolean).join('\n').trim();
        reject(new Error(out || err.message));
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

// SSH ↔ HTTPS 互变（只处理 github 形态——这是参考仓库的绝对主力；其它 host 原样返回 null）。
// 来源是 mmx-research-gitclone 的既有教训：SSH 挂了别放弃，换 HTTPS 再试一次（反之亦然）。
function altUrl(url) {
  const s = String(url || '').trim();
  let m = /^git@([^:/]+):(.+?)(?:\.git)?$/i.exec(s);
  if (m && /(^|\.)github\.com$/i.test(m[1])) return 'https://github.com/' + m[2];
  m = /^https:\/\/github\.com\/(.+?)(?:\.git)?$/i.exec(s);
  if (m) return 'git@github.com:' + m[1];
  return null;
}

async function tryClone(url, dest, depth) {
  const args = ['clone', '--depth', String(depth), url, dest];
  try {
    await run(args);
    return url;
  } catch (err) {
    throw new Error(`git clone ${url} 失败: ${String(err.message).slice(-500)}`);
  }
}

/**
 * 浅克隆。主 URL 失败时用变形 URL（SSH↔HTTPS，仅 github）再试一次；
 * 两个都挂 → external()，带上两次失败的输出尾部（agent 靠它判断网络/权限问题）。
 * 返回实际成功的那条 URL（登记时以它为准）。
 */
export async function gitClone(url, dest, { depth = 1 } = {}) {
  const urls = [String(url).trim()];
  const alt = altUrl(url);
  if (alt) urls.push(alt);
  const failures = [];
  for (const u of urls) {
    try {
      return await tryClone(u, dest, depth);
    } catch (err) {
      failures.push(String(err.message || err));
    }
  }
  throw external('克隆失败（' + failures.length + ' 个通道都试过）:\n' + failures.join('\n'));
}

/**
 * git pull --ff-only。刻意不用默认 pull：非 ff 的落后需要人决策（stash/reset/merge），
 * 自动 merge 只会制造"看起来同步了"的脏状态。
 * 返回 { status: 'updated' | 'upToDate' | 'conflict', output }。
 */
export async function gitPull(dir) {
  try {
    const output = await run(['pull', '--ff-only'], { cwd: dir });
    return { status: /up.to.date|up to date/i.test(output) ? 'upToDate' : 'updated', output };
  } catch (err) {
    const msg = String(err.message || err);
    // 非 ff / 本地改动挡路 → 是需要人决策的冲突状态，不是外部故障
    if (/not.fast.forward|divergent|local changes|would be overwritten/i.test(msg)) {
      return { status: 'conflict', output: msg.slice(-500) };
    }
    throw external('git pull 失败: ' + msg.slice(-500));
  }
}

/** 读 origin URL（读配置，不算状态探测）。没有 origin 返回 ''。 */
export async function gitOrigin(dir) {
  try {
    return await run(['remote', 'get-url', 'origin'], { cwd: dir });
  } catch {
    return '';
  }
}

/** 目录里有没有 .git（目录或文件——worktree 下是文件）。 */
export async function hasGit(dir) {
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
