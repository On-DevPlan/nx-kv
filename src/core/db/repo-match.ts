// 目录 → 已登记仓库的匹配（纯函数，core 层共用：导入、v16 迁移）。
//
// 口径与 repos 服务一致：路径归一（小写 + 反斜杠转正斜杠 + 去尾斜杠）后，
// 精确优先，否则最长前缀（嵌套登记时更具体的仓库赢）。
// #197 起队列必须绑真实仓库，不再有 __unbound__ 哨兵。

/** 路径归一。 */
export function normRepoPath(p: unknown): string {
  return String(p ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** cwd → 已登记仓库 key（精确优先 → 最长前缀）；匹配不到返回空串。 */
export function matchRepoKey(
  cwd: unknown,
  repos: Array<{ key: string; path: string }>,
): string {
  const nk = normRepoPath(cwd);
  if (!nk) return '';
  let best = '';
  let bestLen = -1;
  for (const r of repos) {
    const rp = normRepoPath(r.path);
    if (!rp) continue;
    if (nk === rp && rp.length > bestLen) {
      best = r.key;
      bestLen = rp.length;
    } else if ((nk.startsWith(rp + '/') || rp.startsWith(nk + '/')) && rp.length > bestLen) {
      best = r.key;
      bestLen = rp.length;
    }
  }
  return best;
}

/** 目录名 → 自动登记仓库 key（local/<name>；撞名加数字后缀）。 */
export function autoRepoKey(cwd: unknown, taken: Set<string>): string {
  const base = String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'unknown';
  let key = `local/${base}`;
  let n = 2;
  while (taken.has(key)) key = `local/${base}-${n++}`;
  return key;
}
