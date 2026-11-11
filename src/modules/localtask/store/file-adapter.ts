import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { APP_DIR } from '../../../core/paths.js';
import type { WorkflowSnapshot } from '../../../core/workflow/types.js';

function defaultDir(): string {
  return process.env.NX_KV_WORKFLOW_STORE || join(APP_DIR, 'workflows');
}

export interface FileAdapterOptions {
  dir?: string;
}

export function createFileAdapter({ dir }: FileAdapterOptions = {}) {
  const root: string = dir || defaultDir();
  let queue: Promise<void> = Promise.resolve();

  function pathFor(id: string | number): string {
    const safe = String(id).replace(/[^a-zA-Z0-9._-]+/g, '_');
    return join(root, `${safe}.json`);
  }

  async function get(id: string | number): Promise<WorkflowSnapshot | null> {
    try {
      const raw = await readFile(pathFor(id), 'utf8');
      return JSON.parse(raw) as WorkflowSnapshot;
    } catch (err) {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  function set(snapshot: WorkflowSnapshot): Promise<void> {
    const run = queue.then(async (): Promise<void> => {
      const p = pathFor(snapshot.workflowId);
      await mkdir(dirname(p), { recursive: true });
      const tmp = `${p}.tmp`;
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
      for (let i = 0; ; i += 1) {
        try {
          await rename(tmp, p);
          return;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException | undefined)?.code;
          if (i >= 4 || (code !== 'EPERM' && code !== 'EACCES')) throw err;
          await new Promise<void>((r) => setTimeout(r, 25 * (i + 1)));
        }
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  return { get, set, pathFor, root };
}
