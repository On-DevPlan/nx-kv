// Scheduler —— 听 bus → 拓扑就绪；永不调用 onGet
import { EVENTS } from '../bus/index.js';
import { driveReadyStates } from './state-drive.js';

/**
 * @param {{ store: ReturnType<import('../store/index.js').createSnapshotStore>, bus: ReturnType<import('../bus/index.js').createEventBus>, debounceMs?: number }} deps
 */
export function createScheduler({ store, bus, debounceMs = 10 }) {
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();
  let unsub = null;

  async function runOnce(workflowId) {
    const snap = await store.load(workflowId);
    const expected = snap.revision;
    const draft = structuredClone(snap);
    const { changed, readyIds } = driveReadyStates(draft);
    if (!changed) return { changed: false, readyIds };
    const saved = await store.saveAtomic(draft, { expectedRevision: expected });
    for (const nodeId of readyIds) {
      bus.emit(EVENTS.NODE_STATE_CHANGED, { workflowId, nodeId, state: 'ready' });
    }
    return { changed: true, readyIds, revision: saved.revision };
  }

  function schedule(workflowId) {
    const prev = timers.get(workflowId);
    if (prev) clearTimeout(prev);
    timers.set(
      workflowId,
      setTimeout(() => {
        timers.delete(workflowId);
        runOnce(workflowId).catch(() => {});
      }, debounceMs),
    );
  }

  function start() {
    if (unsub) return;
    unsub = bus.on(EVENTS.DAG_MUTATED, (payload) => {
      if (payload?.workflowId) schedule(payload.workflowId);
    });
  }

  function stop() {
    if (unsub) unsub();
    unsub = null;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }

  return { start, stop, runOnce, schedule };
}

export { driveReadyStates } from './state-drive.js';
