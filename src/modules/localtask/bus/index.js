import { EVENTS } from '../../../core/workflow/event-names.js';

/**
 * 轻量 EventBus（进程内）。scheduler 听 dag:mutated。
 */
export function createEventBus() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  return {
    EVENTS,

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },

    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },

    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch {
          /* 单订阅者失败不拖垮总线 */
        }
      }
    },

    clear() {
      listeners.clear();
    },
  };
}

export { EVENTS };
