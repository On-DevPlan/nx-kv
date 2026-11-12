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

/** `setting get` 的结果形状（含派生字段）。 */
export interface SettingsView {
  attachmentsRoot: string;
  resolvedDir: string;
  gitRepoRoot: string;
  gitDevRoot: string;
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
  };
}

export async function setSettings(patch: {
  gitRepoRoot?: unknown;
  gitDevRoot?: unknown;
} = {}): Promise<SettingsView> {
  const body: Record<string, unknown> = {};
  if (patch.gitRepoRoot !== undefined) body.gitRepoRoot = String(patch.gitRepoRoot || '').trim();
  if (patch.gitDevRoot !== undefined) body.gitDevRoot = String(patch.gitDevRoot || '').trim();
  if (!Object.keys(body).length) {
    throw badInput(
      '没有要改的设置：--gitRepoRoot <参考仓库根目录> / --gitDevRoot <开发仓库克隆根>'
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
  ].filter(Boolean).join('\n');
}
