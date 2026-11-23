// 任务操作模板（#251）：从目录任务页抽出的「行尾 / 批量」动作，两个页面共用。
//
// 抽离口径：**动作本身（弹窗文案 / 接口调用顺序 / 提示语 / 文档落库）一份**，
// 只有「任务在哪个队列」随页面变化——所以每个动作都收一个 scope
// （{ cwd } 目录队列 或 { key } 全局池）。组页的行分属不同成员队列，由调用方按行
// 解析出 scope 再传进来，动作层不需要知道「组」这件事。
//
// 目录页（page/dir）与组页（page/group）都只做接线，不再各写一遍这些流程。
import {
  addTask,
  cancelManyTasks,
  closeManyTasks,
  findTaskItem,
  patchTaskItem,
  postReopen,
  removeManyTasks,
  removeTaskItem,
  setPlanStatus,
} from '../../api/tasks.js';
import type { TaskScope } from '../../api/tasks.js';
import { FEEDBACK_HEADING, PLAIN_FEEDBACK_HEADING, buildReopenText } from '../../modules/board/reopen-text.js';
import { docIdOf, saveDoc, scopeOf } from '../../modules/md/doc-store.js';
import type { DialogFn } from '../../components/popup/index.js';
import type { LocalTask } from '../../types.js';

/** 动作层需要的外部能力（两页各自把自己的 dialog / toast / 刷新递进来）。 */
export interface TaskOpsDeps {
  dialog: DialogFn;
  toast: (msg: string) => void;
  /** 队列数据刷新（/api/localtasks 重取） */
  refresh?: () => void | Promise<unknown>;
  /** doc-store 的落点 key：目录页给 dirKey，组页给看板 id（草稿正文按同一寻址） */
  docKey?: string;
  /** 单条删除成功后回调（目录页借此关掉已打开的任务页） */
  onDeleted?: (t: LocalTask) => void;
}

/** 一条 DAG 落盘 patch（与 DagEditor 内部 DagPatch 同形）。 */
export interface DagPatchInput {
  id: number;
  gate?: boolean;
  blockBy?: number[];
}

/** 一次批量动作的范围：同一队列的一组编号（组页的行分属多条成员队列）。 */
export interface ScopeIds {
  scope: TaskScope;
  ids: number[];
}

/** 行标题：正文首个非空行（去掉 `#` 前缀）。 */
export function taskTitle(t: LocalTask): string {
  const line = (t.text || '').split('\n').find((l) => l.trim()) || `#${t.id}`;
  return line.replace(/^#\s*/, '');
}

/** scope → 查询串（单条读取用：全局池按 key，目录按 cwd）。 */
function scopeQuery(scope: TaskScope, id: number | string): string {
  return scope.key && !scope.cwd
    ? `key=${encodeURIComponent(scope.key)}&id=${Number(id)}`
    : `cwd=${encodeURIComponent(scope.cwd || '')}&id=${Number(id)}`;
}

/** scope → 新建任务的落点（#190：只有目录队列，按 cwd 投递）。 */
function addScope(scope: TaskScope): { cwd?: string } {
  return { cwd: scope.cwd };
}

/** 把一条任务的正文写回 doc-store（打开任务页时读的是这里，不是 rows 快照）。 */
function saveTaskDoc(deps: TaskOpsDeps, landedKey: string | undefined, id: number | string, text: string): void {
  if (!text) return;
  saveDoc(docIdOf(scopeOf(landedKey || deps.docKey), String(id)), { body: text });
}

async function guard(deps: TaskOpsDeps, fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (e) {
    deps.toast(String((e as Error)?.message || e));
    return false;
  }
}

/**
 * 反馈 / 重开（#74 / #75 / #79）：已完成 → 派生新任务（原任务留档）；
 * 未完成 → 就地回写正文并重开。base 取**服务端当前正文**，取不到才退 rows 快照。
 */
export async function runFeedbackTask(deps: TaskOpsDeps, scope: TaskScope, t: LocalTask): Promise<void> {
  const { dialog, toast } = deps;
  const title = taskTitle(t);
  const acked = !!t.completedAt;
  const body = await dialog({
    title: acked ? `反馈 · #${t.id}` : `反馈修改 · #${t.id}`,
    input: true,
    placeholder: acked
      ? '写下反馈（将新开一条任务，原任务不动）'
      : '写下要改的地方（留空 = 只重开，不改正文）',
  });
  if (body === null || body === undefined) return;
  const fb = String(body).trim();

  await guard(deps, async () => {
    // #79：列表行的 text 是 rows 快照，可能落后于盘上；先取服务端当前正文
    const fresh = await findTaskItem(scopeQuery(scope, t.id));
    const baseText = String(fresh?.text ?? '').trim() || String(t.text || '').trim();
    const ackSummary = acked ? (fresh?.roundSummary || t.roundSummary || '') : '';
    if (!fb && !acked && !baseText) {
      toast('拿不到任务当前正文，已取消（防止丢内容）');
      return;
    }

    if (acked) {
      // #75：反馈 = 新开任务，正文 = 旧正文 + 上轮总结 + 本轮反馈
      const reopenArgs = {
        base: baseText,
        feedback: fb,
        ackSummary,
        feedbackHeading: FEEDBACK_HEADING,
        bold: true,
      };
      const text = fb ? buildReopenText(reopenArgs) : '';
      if (!text) {
        toast('写一下反馈');
        return;
      }
      const res = await addTask({
        ...addScope(scope),
        text,
        forkOf: String(t.id),
        forkKind: 'reopen',
      });
      const newId = String(res?.task?.id ?? res?.id ?? '');
      saveTaskDoc(deps, res?.key, newId, text);
      toast(`已反馈「${title}」→ 新任务 #${newId || '?'}`);
      deps.refresh?.();
      return;
    }

    // #74 就地回写：#79 纯反馈不传 text——服务端把反馈段原子追加到盘上当前正文
    const res = await postReopen({
      ...scope,
      id: t.id,
      kind: 'reopen',
      ...(fb ? { feedback: fb, feedbackHeading: PLAIN_FEEDBACK_HEADING, feedbackBold: false } : {}),
    });
    const sameId = String(res?.task?.id ?? t.id);
    saveTaskDoc(deps, res?.key, sameId, String(res?.task?.text ?? ''));
    toast(
      `已回写「${title}」#${sameId}` + (res?.moved && res.name ? `；归属迁到「${res.name}」` : ''),
    );
    deps.refresh?.();
  });
}

/** 单条删除（软删除，CLI 可恢复）。 */
export async function runDeleteTask(deps: TaskOpsDeps, scope: TaskScope, t: LocalTask): Promise<void> {
  const { dialog, toast } = deps;
  const ok = await dialog({
    title: `删除任务「${taskTitle(t)}」`,
    message: '软删除：CLI localtask task restore 可恢复。',
    danger: true,
    okText: '删除',
  });
  if (!ok) return;
  await guard(deps, async () => {
    await removeTaskItem({ ...scope, id: t.id });
    toast(`已删除「${taskTitle(t)}」`);
    deps.onDeleted?.(t);
    deps.refresh?.();
    return true;
  });
}

/** 批量动作的总条数。 */
const totalOf = (groups: ScopeIds[]): number => groups.reduce((n, g) => n + g.ids.length, 0);

/** 批量软删除（组页按成员队列分组多次调用，提示只报一次总数）。 */
export async function runBatchDelete(deps: TaskOpsDeps, groups: ScopeIds[]): Promise<boolean> {
  const total = totalOf(groups);
  if (!total) return false;
  const ok = await deps.dialog({
    title: `删除选中的 ${total} 条任务`,
    message: '软删除：CLI localtask task restore 可恢复。',
    danger: true,
    okText: '删除',
  });
  if (!ok) return false;
  let count = 0;
  for (const g of groups) {
    const res = await guard(deps, () => removeManyTasks({ ...g.scope, ids: g.ids }));
    if (res === false) return false;
    count += (res as { count?: number }).count ?? g.ids.length;
  }
  deps.toast(`已删除 ${count} 条任务`);
  deps.refresh?.();
  return true;
}

/** 批量取消（只处理待领取，其余跳过）。 */
export async function runBatchCancel(deps: TaskOpsDeps, groups: ScopeIds[]): Promise<boolean> {
  const total = totalOf(groups);
  if (!total) return false;
  const ok = await deps.dialog({
    title: `取消选中的 ${total} 条待领取任务`,
    message: '只处理待领取任务；已领取/已完成/已取消会跳过。取消为终态，原文留档。',
    okText: '取消任务',
  });
  if (!ok) return false;
  let count = 0;
  let skipped = 0;
  for (const g of groups) {
    const res = await guard(deps, () => cancelManyTasks({ ...g.scope, ids: g.ids }));
    if (res === false) return false;
    const r = res as { count?: number; skipped?: unknown[] };
    count += r.count ?? 0;
    skipped += r.skipped?.length || 0;
  }
  deps.toast(`已取消 ${count} 条任务${skipped ? `，跳过 ${skipped} 条` : ''}`);
  deps.refresh?.();
  return true;
}

/** 批量标为完成（待领取 + 已领取都能收口）。 */
export async function runBatchComplete(deps: TaskOpsDeps, groups: ScopeIds[]): Promise<boolean> {
  const total = totalOf(groups);
  if (!total) return false;
  const ok = await deps.dialog({
    title: `把选中的 ${total} 条任务标为完成`,
    message:
      '待领取与已领取（正在跑）都能收：已领取的直接收口，agent 侧回执会被忽略。已完成/已取消会跳过。完成会补一条完成记录，原文留档。',
    okText: '标为完成',
  });
  if (!ok) return false;
  let count = 0;
  let skipped = 0;
  let claimed = 0;
  for (const g of groups) {
    const res = await guard(deps, () => closeManyTasks({ ...g.scope, ids: g.ids, status: 'done' }));
    if (res === false) return false;
    const r = res as { count?: number; skipped?: unknown[]; claimedClosed?: unknown[] };
    count += r.count ?? 0;
    skipped += r.skipped?.length || 0;
    claimed += r.claimedClosed?.length || 0;
  }
  deps.toast(
    `已标为完成 ${count} 条任务${claimed ? `（含 ${claimed} 条已领取）` : ''}${skipped ? `，跳过 ${skipped} 条` : ''}`,
  );
  deps.refresh?.();
  return true;
}

/** 闸门快捷开关（挡住队列里排在我后面的待领取任务）。 */
export async function runToggleGate(deps: TaskOpsDeps, scope: TaskScope, t: LocalTask): Promise<void> {
  const next = !t.blocksFollowing;
  const res = await guard(deps, () => patchTaskItem({ ...scope, id: t.id, gate: next }));
  if (!res) return;
  deps.toast(next ? `#${t.id} 已设为闸门——挡住所有后续待领取任务` : `#${t.id} 闸门已取消`);
  deps.refresh?.();
}

/** 一次草稿态切换的范围：同一队列的一组任务。 */
export interface PlanGroup {
  scope: TaskScope;
  ids: Array<number | string>;
}

/** 草稿态切换（pending ↔ plan；plan 不进 get/wait 队列）。组页按成员队列分组，提示只报一次。 */
export async function runPlanSwitch(
  deps: TaskOpsDeps,
  groups: PlanGroup[],
  to: 'plan' | 'pending',
): Promise<void> {
  const total = groups.reduce((n, g) => n + g.ids.length, 0);
  if (!total) return;
  await guard(deps, async () => {
    for (const g of groups) {
      for (const id of g.ids) await setPlanStatus({ ...g.scope, id: Number(id), to });
    }
    deps.toast(to === 'plan' ? `已把 ${total} 条任务转为草稿（不进队列）` : `已把 ${total} 条草稿转回待领取`);
    deps.refresh?.();
    return true;
  });
}

/** 编排落盘：逐条任务级 PATCH（本任务 gate/blockBy + 下游各方 blockBy）。失败上抛。 */
export async function saveDagPatches(
  deps: TaskOpsDeps,
  scope: TaskScope,
  patches: DagPatchInput[],
): Promise<void> {
  try {
    for (const p of patches) await patchTaskItem({ ...scope, ...p });
    deps.toast('编排已保存');
    deps.refresh?.();
  } catch (e) {
    deps.toast(String((e as Error)?.message || e));
    throw e;
  }
}
