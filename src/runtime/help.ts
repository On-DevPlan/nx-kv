// help：完全由命令表生成。
//
// 命令表的一行见 spec.ts 的 entryOf —— 纯「声明 → 文本」，runtime/spec 之外没有副本。
// 本文件是纯函数层：表由调用方（cli.ts）传入，不持有自己的状态，
// 因此 help 文本不可能与实际命令脱节。
import { APP_NAME } from '../core/paths.js';
import { badInput } from '../core/errors.js';
import { MODULES } from './registry.js';
import { cliPathsOf, entryOf, usageOf, type AnyAction } from './spec.js';

export type HelpEntry = ReturnType<typeof entryOf>;

// 解析帮助主题。既接受模块 id（repos），也接受命令组（repo）——
// 用户脑子里想的是「repo 相关的东西」，不会去记内部模块名。
// 这条路径不能报错退出：`nx-kv help <随便什么>` 失败会让最需要帮助的人卡住。
export function helpEntries(commands: readonly AnyAction[], topic?: unknown): HelpEntry[] {
  const all = commands.map(entryOf);
  if (!topic) return all;

  const t = String(topic);
  if (MODULES.some((m) => m.id === t)) return all.filter((e) => e.module === t);

  const byRoot = all.filter((e) => e.command.split(' ')[1] === t);
  if (byRoot.length) return byRoot;

  // 命令本身的 id 也认（如 `nx-kv help repo.add`）
  const byId = all.filter((e) => e.id === t);
  if (byId.length) return byId;

  const topics = [...new Set(all.map((e) => e.module))].join(', ');
  throw badInput(`未知帮助主题: ${t}（可用模块: ${topics}；或命令组如 repo / skill / gh）`);
}

export function renderHelp(entries: readonly HelpEntry[], topic: unknown, version: string): string {
  const lines: string[] = [];
  if (!topic) {
    lines.push(`${APP_NAME} · nx-kv v${version}`);
    lines.push('本机任务队列 + 仓库/文档中枢：serve 驱动 CLI 与 Web，同源同构。');
    lines.push('');
  }

  const groups = new Map<string, HelpEntry[]>();
  for (const e of entries) {
    if (!groups.has(e.module)) groups.set(e.module, []);
    groups.get(e.module)!.push(e);
  }

  for (const [mod, list] of groups) {
    const title =
      MODULES.find((m) => m.id === mod)?.title || (mod === 'platform' ? '平台命令' : mod);
    lines.push(title + ':');
    const width = Math.max(...list.map((e) => e.usage.length));
    for (const e of list) lines.push('  ' + e.usage.padEnd(width + 2) + e.summary);
    lines.push('');
  }

  lines.push('通用:');
  lines.push('  --json    机器可读输出（agent 模式）');
  return lines.join('\n');
}

// `nx-kv <命令> --help`：只打印这一条，而不是整个模块——
// 之前这里传的是 cmd.cli[0]，对别名 action（cli 是数组的数组）会拼出 "bundled,list"。
export function printCommandHelp(cmd: AnyAction): void {
  const lines: string[] = [usageOf(cmd)];
  if (cmd.summary) lines.push('    ' + cmd.summary);
  lines.push('');

  const aliases = cliPathsOf(cmd).slice(1).map((p) => APP_NAME + ' ' + p.join(' '));
  if (aliases.length) lines.push('别名: ' + aliases.join('  ·  '));
  if (cmd.http) lines.push('对应路由: ' + cmd.http[0] + ' ' + cmd.http[1]);
  lines.push('所属模块: ' + (cmd.module || 'platform'));
  console.log(lines.join('\n'));
}
