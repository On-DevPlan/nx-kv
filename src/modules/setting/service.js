// 设置模块：本机行为的开关。
//
// 为什么单独成模块而不是塞进 system：设置是**用户会主动改的东西**，
// 需要 CLI 与面板两端都能读写（`nx-kv setting set` / 清单页的开关），
// 而 system 是只读聚合器（bootstrap / health / routes），不承担写操作。
//
// 落在 ~/.nx-kv/config.json：与登录态同一个文件（都是「怎么用这个工具」而非业务数据）。
import { loadConfig, saveConfig } from '../../core/config.js';
import { attachmentsRootFromEnv } from '../../core/paths.js';
import { localDirFor } from '../../core/attachstore.js';
import { badInput } from '../../core/errors.js';

const toBool = (v) => v === true || String(v) === 'true';

export async function getSettings() {
  const cfg = await loadConfig();
  return {
    autoSyncAttachments: cfg.autoSyncAttachments,
    attachmentsDir: cfg.attachmentsDir,
    // 派生信息：面板要把「附件会落到哪」直接显示出来，省得用户去猜默认值
    attachmentsRoot: attachmentsRootFromEnv(),
    resolvedDir: localDirFor(cfg.groupId, cfg.attachmentsDir),
    groupId: cfg.groupId,
    baseUrl: cfg.baseUrl,
  };
}

export async function setSettings(patch = {}) {
  const body = {};
  if (patch.autoSyncAttachments !== undefined) body.autoSyncAttachments = toBool(patch.autoSyncAttachments);
  if (patch.attachmentsDir !== undefined) body.attachmentsDir = String(patch.attachmentsDir || '').trim();
  if (!Object.keys(body).length) {
    throw badInput('没有要改的设置：--autoSyncAttachments <true|false> / --attachmentsDir <目录>');
  }
  await saveConfig({ ...(await loadConfig()), ...body });
  return getSettings();
}

export function renderSettings(d) {
  return [
    `附件读取时自动下载: ${d.autoSyncAttachments ? '开' : '关'}`,
    `附件默认目录:       ${d.resolvedDir}`,
    d.attachmentsDir ? `（由设置覆盖；默认根目录 ${d.attachmentsRoot}）` : '',
    `当前工作空间:       ${d.groupId || '默认组'}`,
  ]
    .filter(Boolean)
    .join('\n');
}
