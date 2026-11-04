import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { APP_DIR } from '../../../core/paths.js';

/** @typedef {import('../../../core/workflow/types.js').WorkflowSnapshot} WorkflowSnapshot */

function defaultDir() {
  return process.env.NX_KV_WORKFLOW_STORE || join(APP_DIR, 'workflows');
}

export function createFileAdapter({ dir } = {}) {
  const root = dir || defaultDir();
  let queue = Promise.resolve();

  function pathFor(id) {
    const safe = String(id).replace(/[^a-zA-Z0-9._-]+/g, '_');
    return join(root, `${safe}.json`);
  }

  async function get(id) {
    try {
      const raw = await readFile(pathFor(id), 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  function set(snapshot) {
    const run = queue.then(async () => {
      const p = pathFor(snapshot.workflowId);
      await mkdir(dirname(p), { recursive: true });
      const tmp = `${p}.tmp`;
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
      for (let i = 0; ; i += 1) {
        try {
          await rename(tmp, p);
          return;
        } catch (err) {
          if (i >= 4 || (err.code !== 'EPERM' && err.code !== 'EACCES')) throw err;
          await new Promise((r) => setTimeout(r, 25 * (i + 1)));
        }
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  return { get, set, pathFor, root };
}
