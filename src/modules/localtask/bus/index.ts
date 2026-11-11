import { EVENTS } from '../../../core/workflow/event-names.js';

/** 订阅回调（事件负载不设类型约束：进程内总线，发什么听什么）。 */
export type EventListener = (payload: unknown) => void;

/**
 * 轻量 EventBus（进程内）。scheduler 听 dag:mutated。
 */
export function createEventBus() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map<string, Set<EventListener>>();

  return {
    EVENTS,

    on(event: string, fn: EventListener): () => boolean {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return () => listeners.get(event)?.delete(fn) ?? false;
    },

    off(event: string, fn: EventListener): void {
      listeners.get(event)?.delete(fn);
    },

    emit(event: string, payload: unknown): void {
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

    clear(): void {
      listeners.clear();
    },
  };
}

export { EVENTS };
