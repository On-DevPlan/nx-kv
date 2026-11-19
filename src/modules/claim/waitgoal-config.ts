// claim/waitgoal-config.ts —— 项目级「持续 get」（waitgoal）配置的读取。
//
// 落点：repos.json 的 repo 记录字段 getLoop = { enabled, waitMinutes }。
// **#182 起仓库级配置只剩「开关 + 阻塞分钟」**：交付里那段「继续 get」的**文案**
// 统一由 getloop 插件类的内置模板提供（#152 起正文进代码，不再有「全局模板区块」可配）。
// 此前这里还存一份 repo 级 template（v0.14 起 string[]），
// 与全局模板两处各写一遍必然漂移——那个口子已下线；老数据里的 template 字段
// 读入时一律忽略，下次写回 getLoop 时自然被 sanitizeGetLoop 丢掉。
//
// 「项目」在本仓的正式身份就是 dev 仓库登记（cwd 对得上仓库路径即命中）；
// repos.json 的 loadStore/mutateStore 对 repo 对象上的额外字段原样保留，无需升版。
//
// 语义开关（todo.md 的原文口径）：
//   默认 get 就直接 get（没任务立即空手而回，不阻塞）；
//   项目打开这个设置后 → 无任务自动唤起阻塞等待（打开页面 + 配置的分钟数），
//   且交付文本带「不断调用 get，直到 get 超时」那段指令（提示词增强，文案见全局区块）。
//
// repos 在模块互依禁列里 → 动态 import（与 localtask→timegoal 探针同一惯例）。
// sanitizeGetLoop 已下沉 core/config.ts（repos 与 claim 共用），本文件只留读取。

/** 阻塞窗口默认 10 分钟（上限仍受 wait 的 600s 夹制）。#230 起循环文案唯一真相在 getloop 插件类。 */
export const GET_LOOP_DEFAULT_MINUTES = 10; // 阻塞窗口默认 10 分钟（上限仍受 wait 的 600s 夹制）

/** getLoopForCwd 返回的项目级配置形态（#182 起没有 template：文案归全局区块）。 */
export interface GetLoopState {
  enabled: boolean;
  waitMinutes?: number;
}


let reposMod: any = null;
async function reposStore(): Promise<any> {
  if (!reposMod) reposMod = await import('../repos/service.js');
  return reposMod;
}


/** 按工作目录读项目级 getLoop；目录未登记 / 未开启 → { enabled:false }。读取失败同样降级。 */
export async function getLoopForCwd(cwd: unknown): Promise<GetLoopState> {
  try {
    const { loadStore, normalizePathKey } = await reposStore();
    const s = await loadStore();
    const k = normalizePathKey(cwd);
    const repo = k ? s.repos.find((r: any) => normalizePathKey(r.path) === k) : null;
    const loop = repo && repo.getLoop && typeof repo.getLoop === 'object' ? repo.getLoop : null;
    if (!loop || !loop.enabled) return { enabled: false };
    // #112：显式 0 是合法值（= get 没任务时不阻塞，立即 timeout）；只有字段缺失 /
    // 非数字时才回落到默认 10 分钟（老数据兼容）。
    const rawMinutes = loop.waitMinutes;
    const n = rawMinutes === undefined || rawMinutes === null ? NaN : Number(rawMinutes);
    const minutes = Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 600) : GET_LOOP_DEFAULT_MINUTES;
    return { enabled: true, waitMinutes: minutes };
  } catch {
    return { enabled: false }; // 仓库登记坏了绝不拖垮 get
  }
}
