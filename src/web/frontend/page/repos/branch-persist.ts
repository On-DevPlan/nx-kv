// 仓库管理页「分支（组）」选择的持久化（#158）——**只是显示态，不是数据**。
//
// 用户在仓库管理页切到某个组分支后，下次进页还落在 main，每次都要重选一遍。
// 把最后的选择记进 localStorage，重开面板 / 换天回来都还停在那个分支上。
//
// 与侧边栏 prefs（nx-kv-sidebar-v1）分开：那边只管侧边栏编排/收起态，
// 这边是仓库页自己的视图偏好，各存各的键。localStorage 缺席（隐私模式等）
// 存取静默降级——回落 main，功能不受影响。

const KEY = 'nx-kv-repos-branch-v1';

/** 读上次选的分支 id；无记录 / 脏数据 / localStorage 不可用 → null（回落 main）。 */
export function loadBranchPref(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    // localStorage 是外部数据边界：非空字符串才收（空串当无记录）
    const v = raw == null ? null : String(raw);
    return v ? v : null;
  } catch {
    return null;
  }
}

/** 记下当前分支 id；写不进去就静默放弃（本次会话内仍然生效）。 */
export function saveBranchPref(id: string): void {
  try {
    const v = String(id || '');
    if (v) localStorage.setItem(KEY, v);
  } catch {
    /* 隐私模式等静默降级 */
  }
}
