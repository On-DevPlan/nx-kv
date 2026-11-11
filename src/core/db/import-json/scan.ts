// legacy 文件探测：只负责「把 ~/.nx-kv 下的 legacy JSON 读进来」，不做任何写库。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_FILES } from './data.js';

/** 单个 legacy 文件的读取结果（外部 JSON → 宽松类型）。 */
export interface LegacyFileRecord {
  ok: boolean;
  data?: any;
  path: string;
  missing?: boolean;
  error?: string;
}

/** 探测结果：按 kind 归档的读取结果 + 「有没有任何 legacy 数据」。 */
export interface ScanResult {
  files: Record<string, any>;
  any: boolean;
}

function readJson(path: string): LegacyFileRecord {
  try {
    const raw = readFileSync(path, 'utf8');
    return { ok: true, data: JSON.parse(raw), path };
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'ENOENT') return { ok: false, missing: true, path };
    return { ok: false, error: String((err as Error | null)?.message || err), path };
  }
}

/**
 * 探测 legacy 数据。
 *
 * `localtasks.json` 缺失时回落到 `sessiontasks.json`（改名前的旧文件），
 * 与运行期 `legacyStorePath()` 同口径 —— 只认「主文件不在」这一种情况。
 *
 * @returns {{files: object, any: boolean}}
 */
export function scanLegacy(appDir: string): ScanResult {
  const files: Record<string, any> = {};
  for (const [kind, name] of Object.entries(LEGACY_FILES)) {
    files[kind] = readJson(join(appDir, name));
  }
  if (!files.localtasks.ok && files.localtasks.missing && files.sessiontasks.ok) {
    files.localtasks = files.sessiontasks;
    files.localtasksFromLegacyName = true;
  }
  const any = ['localtasks', 'repos', 'timegoals', 'templates', 'config'].some((k) => files[k] && files[k].ok);
  return { files, any };
}
