// 设置模块：本机行为的开关。
//
// 为什么单独成模块而不是塞进 system：设置是**用户会主动改的东西**，
// 需要 CLI 与面板两端都能读写（`nx-kv setting set` / 清单页的开关），
// 而 system 是只读聚合器（bootstrap / health / routes），不承担写操作。
//
// 落在 SQLite settings 表（`app.*`）：与数据同生命周期，备份跟着库走。
import { loadConfig, saveConfig } from '../../core/config.js';
import { attachmentsRootFromEnv } from '../../core/paths.js';
import { localDir } from '../../core/localatt.js';
import { badInput } from '../../core/errors.js';
import type { SidebarNsState } from '../../core/config.js';

/** `setting get` 的结果形状（含派生字段）。 */
export interface SettingsView {
  attachmentsRoot: string;
  resolvedDir: string;
  gitRepoRoot: string;
  gitDevRoot: string;
  /** 无归属 ref 的保留天数（到期清理；默认 3） */
  orphanTtlDays: number;
  /** #180：侧栏命名空间（分组 + 当前聚焦）；CLI/面板都从这里读写 */
  sidebarNamespaces: SidebarNsState;
}

export async function getSettings(): Promise<SettingsView> {
  const cfg = await loadConfig();
  return {
    // 派生信息：面板要把「附件会落到哪」直接显示出来，省得用户去猜默认值
    attachmentsRoot: attachmentsRootFromEnv(),
    resolvedDir: localDir(),
    // 参考仓库（type=ref）的存储根；空 = clone 会被拒绝，直到用户显式设置
    gitRepoRoot: cfg.gitRepoRoot,
    gitDevRoot: cfg.gitDevRoot,
    orphanTtlDays: cfg.orphanTtlDays,
    sidebarNamespaces: cfg.sidebarNamespaces,
  };
}

export async function setSettings(patch: {
  gitRepoRoot?: unknown;
  gitDevRoot?: unknown;
  orphanTtlDays?: unknown;
  /** #180：CLI 可传 JSON 字符串或对象；HTTP 直接传对象 */
  sidebarNamespaces?: unknown;
} = {}): Promise<SettingsView> {
  const body: Record<string, unknown> = {};
  if (patch.gitRepoRoot !== undefined) body.gitRepoRoot = String(patch.gitRepoRoot || '').trim();
  if (patch.gitDevRoot !== undefined) body.gitDevRoot = String(patch.gitDevRoot || '').trim();
  if (patch.orphanTtlDays !== undefined) {
    const n = Math.trunc(Number(patch.orphanTtlDays));
    if (!Number.isFinite(n) || n < 1 || n > 3650) {
      throw badInput('孤儿文档保留天数必须是 1–3650 的整数');
    }
    body.orphanTtlDays = n;
  }
  if (patch.sidebarNamespaces !== undefined) {
    let raw = patch.sidebarNamespaces;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { throw badInput('sidebarNamespaces 不是合法 JSON'); }
    }
    body.sidebarNamespaces = raw;
  }
  if (!Object.keys(body).length) {
    throw badInput(
      '没有要改的设置：--gitRepoRoot <参考仓库根目录> / --gitDevRoot <开发仓库克隆根> / --orphanTtlDays <天数> / --sidebarNamespaces <JSON>'
    );
  }
  await saveConfig({ ...(await loadConfig()), ...body });
  return getSettings();
}

export function renderSettings(d: SettingsView): string {
  return [
    `附件默认目录:       ${d.resolvedDir}`,
    `（附件根目录 ${d.attachmentsRoot}）`,
    `参考仓库存储根:     ${d.gitRepoRoot || '（未设置 —— clone 参考仓库前先 nx-kv setting set --gitRepoRoot <非C盘目录>）'}`,
    `开发仓库克隆根:     ${d.gitDevRoot || '（未设置 —— 导入布局时开发仓库只登记不克隆）'}`,
    `孤儿文档保留:       ${d.orphanTtlDays} 天（无归属 ref 到期后软删；有正文的不自动删）`,
    `侧栏命名空间:       ${d.sidebarNamespaces.groups.length} 个分组（当前：${d.sidebarNamespaces.focus || '默认'}）`,
  ].filter(Boolean).join('\n');
}
