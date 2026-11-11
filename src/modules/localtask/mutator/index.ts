// DagMutator —— 全系统唯一允许改 WorkflowSnapshot 的入口
import { EVENTS } from '../bus/index.js';
import {
  assertBind,
  assertEdge,
  findNode,
  wouldCreateCycle,
} from './validate.js';
import type { WorkflowSnapshot } from '../../../core/workflow/types.js';

/** mutator 依赖的快照存储（store/index.js 的 createSnapshotStore 出站形状）。 */
export type SnapshotStoreLike = ReturnType<typeof import('../store/index.js').createSnapshotStore>;

/** mutator 用到的总线最小面。 */
export interface EventBusLike {
  emit(event: string, payload: unknown): void;
}

/** createDagMutator 的依赖。 */
export interface DagMutatorDeps {
  store: SnapshotStoreLike;
  bus?: EventBusLike;
}

/** addNode / bindPlugin 的节点 / 绑定目标入参（外部 JSON → any）。 */
export type DagMutatorNodeInput = any;
export type DagMutatorTargetInput = { workflow?: boolean; nodeId?: string | number } | any;

/** DagMutator 的出站形状（createDagMutator 返回的对象；显式声明避免 ReturnType 循环引用）。 */
export interface DagMutator {
  addNode(workflowId: string, node: DagMutatorNodeInput): Promise<WorkflowSnapshot>;
  removeNode(workflowId: string, nodeId: string | number): Promise<WorkflowSnapshot>;
  addEdge(workflowId: string, from: string | number, to: string | number): Promise<WorkflowSnapshot>;
  removeEdge(workflowId: string, from: string | number, to: string | number): Promise<WorkflowSnapshot>;
  bindPlugin(workflowId: string, target: DagMutatorTargetInput, spec: any): Promise<WorkflowSnapshot>;
  unbindPlugin(workflowId: string, target: DagMutatorTargetInput, name: string): Promise<WorkflowSnapshot>;
  updatePluginConfig(workflowId: string, target: DagMutatorTargetInput, name: string, config: Record<string, unknown>): Promise<WorkflowSnapshot>;
  setNodeState(workflowId: string, nodeId: string | number, state: any): Promise<WorkflowSnapshot>;
}

/**
 * @param {{ store: ReturnType<import('../store/index.js').createSnapshotStore>, bus?: { emit: Function } }} deps
 */
export function createDagMutator({ store, bus }: DagMutatorDeps): DagMutator {
  async function mutate(workflowId: string, fn: (draft: WorkflowSnapshot) => void): Promise<WorkflowSnapshot> {
    const snap = await store.load(workflowId);
    const expected = snap.revision;
    const draft = structuredClone(snap);
    fn(draft);
    const saved = await store.saveAtomic(draft, { expectedRevision: expected });
    bus?.emit(EVENTS.DAG_MUTATED, { workflowId, revision: saved.revision, snapshot: saved });
    return saved;
  }

  return {
    async addNode(workflowId: string, node: DagMutatorNodeInput): Promise<WorkflowSnapshot> {
      if (!node?.id && node?.id !== 0) throw new Error('node.id required');
      return mutate(workflowId, (draft) => {
        if (findNode(draft, node.id)) throw new Error(`node exists: ${node.id}`);
        draft.nodes.push({
          id: node.id,
          kind: node.kind === 'control' ? 'control' : 'task',
          state: node.state || 'pending',
          plugins: Array.isArray(node.plugins) ? node.plugins : [],
          payload: node.payload,
        });
      });
    },

    async removeNode(workflowId: string, nodeId: string | number): Promise<WorkflowSnapshot> {
      return mutate(workflowId, (draft) => {
        draft.nodes = (draft.nodes || []).filter((n) => String(n.id) !== String(nodeId));
        draft.edges = (draft.edges || []).filter(
          (e) => String(e.from) !== String(nodeId) && String(e.to) !== String(nodeId),
        );
      });
    },

    async addEdge(workflowId: string, from: string | number, to: string | number): Promise<WorkflowSnapshot> {
      return mutate(workflowId, (draft) => {
        assertEdge(draft, from, to);
        if (wouldCreateCycle(draft, from, to)) throw new Error('edge would create cycle');
        const exists = (draft.edges || []).some(
          (e) => String(e.from) === String(from) && String(e.to) === String(to),
        );
        if (!exists) draft.edges.push({ from, to });
      });
    },

    async removeEdge(workflowId: string, from: string | number, to: string | number): Promise<WorkflowSnapshot> {
      return mutate(workflowId, (draft) => {
        draft.edges = (draft.edges || []).filter(
          (e) => !(String(e.from) === String(from) && String(e.to) === String(to)),
        );
      });
    },

    async bindPlugin(workflowId: string, target: DagMutatorTargetInput, spec: any): Promise<WorkflowSnapshot> {
      // target: { workflow: true } | { nodeId }
      // 动态加载 plugins 桶 → IoC 自注册；再调 onBind 规范化 config
      const { getPlugin } = await import('../../tasktool/plugins/index.js');
      return mutate(workflowId, (draft) => {
        const ctx = { snapshot: Object.freeze(structuredClone(draft)) };
        if (target?.workflow) {
          const normalized = assertBind(null, spec, 'workflow');
          const impl = getPlugin(normalized.name);
          if (impl) {
            normalized.config = impl.onBind(
              { ...ctx, nodeId: undefined },
              normalized.config || {},
            );
          }
          const list = draft.workflowPlugins || (draft.workflowPlugins = []);
          if (normalized.name === 'timegoal' && list.some((p) => p.name === 'timegoal')) {
            throw new Error('workflow may bind at most one timegoal');
          }
          list.push(normalized);
          bus?.emit(EVENTS.GOAL_BOUND, { workflowId, target: 'workflow', plugin: normalized });
          return;
        }
        const node = findNode(draft, target.nodeId)!;
        const normalized = assertBind(node, spec, 'node');
        const impl = getPlugin(normalized.name);
        if (impl) {
          normalized.config = impl.onBind(
            { ...ctx, nodeId: node.id },
            normalized.config || {},
          );
        }
        node.plugins = node.plugins || [];
        node.plugins.push(normalized);
        if (normalized.scope === 'control') node.kind = 'control';
        bus?.emit(EVENTS.GOAL_BOUND, {
          workflowId,
          target: 'node',
          nodeId: node.id,
          plugin: normalized,
        });
      });
    },

    async unbindPlugin(workflowId: string, target: DagMutatorTargetInput, name: string): Promise<WorkflowSnapshot> {
      return mutate(workflowId, (draft) => {
        if (target?.workflow) {
          draft.workflowPlugins = (draft.workflowPlugins || []).filter((p) => p.name !== name);
          bus?.emit(EVENTS.GOAL_UNBOUND, { workflowId, target: 'workflow', name });
          return;
        }
        const node = findNode(draft, target.nodeId);
        if (!node) throw new Error(`node not found: ${target.nodeId}`);
        node.plugins = (node.plugins || []).filter((p) => p.name !== name);
        bus?.emit(EVENTS.GOAL_UNBOUND, {
          workflowId,
          target: 'node',
          nodeId: node.id,
          name,
        });
      });
    },

    async updatePluginConfig(workflowId: string, target: DagMutatorTargetInput, name: string, config: Record<string, unknown>): Promise<WorkflowSnapshot> {
      return mutate(workflowId, (draft) => {
        const list = target?.workflow
          ? draft.workflowPlugins || []
          : findNode(draft, target.nodeId)?.plugins || [];
        const plugin = list.find((p) => p.name === name);
        if (!plugin) throw new Error(`plugin not bound: ${name}`);
        plugin.config = { ...(plugin.config || {}), ...config };
        bus?.emit(EVENTS.GOAL_CONFIG_UPDATED, { workflowId, target, name, config: plugin.config });
      });
    },

    async setNodeState(workflowId: string, nodeId: string | number, state: any): Promise<WorkflowSnapshot> {
      return mutate(workflowId, (draft) => {
        const node = findNode(draft, nodeId);
        if (!node) throw new Error(`node not found: ${nodeId}`);
        node.state = state;
        bus?.emit(EVENTS.NODE_STATE_CHANGED, { workflowId, nodeId, state });
      });
    },
  };
}

export { assertBind, assertEdge, wouldCreateCycle } from './validate.js';
