// legacy 文件探测：只负责「把 ~/.nx-kv 下的 legacy JSON 读进来」，不做任何写库。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_FILES } from './data.js';

function readJson(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    return { ok: true, data: JSON.parse(raw), path };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, missing: true, path };
    return { ok: false, error: String((err && err.message) || err), path };
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
export function scanLegacy(appDir) {
  const files = {};
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
