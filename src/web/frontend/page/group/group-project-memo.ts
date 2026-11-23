// 「组的归属项目」记忆（#187）：每个组记住上次选的成员项目，下次进去直接用。
//
// 为什么是 localStorage 而不是 settings 表：这是**本机界面习惯**（跟侧栏折叠态同类），
// 不是任务数据；换机器重选一次无成本，也不该占 settings 的全局键。
const KEY = 'nx-kv-group-project-v1';

function readAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** 某组上次选的归属项目 key（没记过 → 空串）。 */
export function readGroupProject(boardId: unknown): string {
  const id = String(boardId || '');
  if (!id) return '';
  return String(readAll()[id] || '');
}

/** 记住某组的归属项目（下拉切换时调用）。 */
export function rememberGroupProject(boardId: unknown, projectKey: unknown): void {
  const id = String(boardId || '');
  const k = String(projectKey || '');
  if (!id || !k) return;
  try {
    const all = readAll();
    if (all[id] === k) return;
    all[id] = k;
    // 只保留最近 200 个组，避免 localStorage 无限长
    const keys = Object.keys(all);
    if (keys.length > 200) for (const old of keys.slice(0, keys.length - 200)) delete all[old];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 存不进去不影响本次选择 */
  }
}
