// （#54 自 service.js 拆出）从远程清单（todo 模块）导入任务到本地队列：
// 先落本地（走 tasktool/add.js 的 submitTask 同一条派任务链路），再标远程完成——顺序不可反。
// 动态 import + fail-soft：没登录/远程不可达只报错这一条，不牵连本地任务其它功能。
import { badInput } from '../../core/errors.js';
import { GLOBAL_KEY, GLOBAL_NAME, GLOBAL_CWD, normalizeCwd } from './paths.js';
// ─── 从远程清单导入任务 ────────────────────────────────────────────────
//
// 「提交方 → 远程清单 → 本地队列」这条链的最后一公里：把远程（KV 后端）上还没人领的
// 任务**搬进本机的任务队列**，让本机的 agent 能领到它。
//
// 导入完成即回填远程：那条远程任务标记为已完成，note 写明「被本地哪个队列领走了」
// （远程清单 topic=goal 的 #74：「当从全局任务导入完成过后，就直接把这个任务标记为
// 已经完成，然后返回提示就是说本地的某一个队列领取了这个任务」）。
//
// 顺序是刻意的：**先落本地，再标远程完成**。反过来（先标远程）一旦本地写失败，
// 任务就两头都没了 —— 提交方看不到、本机也没有。
//
// 依赖边界：远程通道住在 todo 模块（另一个 store，且要登录态）。这里用**动态 import**
// + fail-soft：没登录 / 远程不可达 → 明确报错，但**不牵连本地任务的其它功能**。

/** todo 服务的最小投影（动态加载；跨模块依赖不静态收紧，用 any）。 */
type TodoModule = any;

let todoMod: TodoModule = null;
async function todoService(): Promise<TodoModule> {
  if (!todoMod) todoMod = await import('../todo/service.js');
  return todoMod;
}

/**
 * 合并两个来源的"要导入的远程任务内容"：**ref**（CLI 的 `--ref`，可给多次）与
 * **refs**（面板发的列表）。
 *
 * 为什么两个键：CLI 的 flag 叫 `--ref`（沿用 todo 模块"按内容定位"的约定），
 * 面板一次要导多条，发的是 `refs`；HTTP body 里未声明的键会原样透传，所以两个
 * 都可能到 action 的 ctx 里。**只认一个就会整批丢掉**——曾经只读 `ctx.ref`，
 * 面板那次导入静默地导了 0 条。
 *
 * 单独抽成纯函数是为了能单测（真跑导入要连远程后端，单测里连不上）。
 */
export function mergeImportRefs(refs: unknown, ref: unknown): string[] {
  const a = Array.isArray(refs) ? refs : [];
  const b = Array.isArray(ref) ? ref : [];
  return [...a, ...b].map((r) => String(r ?? '').trim()).filter(Boolean);
}

/** importRemoteTasks 的选项。 */
export interface ImportRemoteTasksOptions {
  /** 目标本地目录（不给则用当前目录） */
  cwd?: string;
  /** true = 导入到全局共享池 */
  global?: boolean;
  /** 要导入的远程任务**内容整串**（面板发这个） */
  refs?: string[];
  /** 同上，CLI 的 `--ref` 走这个键 */
  ref?: string[];
  /** 远程主题（消歧用） */
  topic?: string;
  /** 同内容多条时的编号（消歧用） */
  pick?: number;
  /** 远程工作空间（缺省 = 当前） */
  groupId?: number | string;
}

/**
 * 从远程清单导入任务到本地队列。
 *
 * @param {object}  opts
 * @param {string}  [opts.cwd]     目标本地目录（不给则用当前目录）
 * @param {boolean} [opts.global]  true = 导入到全局共享池
 * @param {Array}   [opts.refs]    要导入的远程任务**内容整串**（面板发这个）
 * @param {Array}   [opts.ref]     同上，CLI 的 `--ref` 走这个键
 * @param {string}  [opts.topic]   远程主题（消歧用）
 * @param {number}  [opts.pick]    同内容多条时的编号（消歧用）
 * @param {number|string} [opts.groupId] 远程工作空间（缺省 = 当前）
 */
export async function importRemoteTasks({
  cwd: rawCwd,
  global: toGlobal = false,
  refs,
  ref,
  topic,
  pick,
  groupId,
}: ImportRemoteTasksOptions = {}): Promise<Record<string, any>> {
  const list = mergeImportRefs(refs, ref);
  if (!list.length) throw badInput('要导入的远程任务不能为空（按内容指定 --ref）');

  const todo = await todoService();
  // 远程这一侧：读当前工作空间的未完成任务（不含历史，面板轮询时才不会拉一坨 done 回来）
  const remote = await todo.listTodos({ status: 'open', groupId });
  const openTasks = Array.isArray(remote.open) ? remote.open : [];

  // 本地落点：先算清楚（global 优先；cwd 缺省用当前目录）
  const local: { key: string; name: string; cwd: string } = toGlobal
    ? { key: GLOBAL_KEY, name: GLOBAL_NAME, cwd: GLOBAL_CWD }
    : (() => {
        const n = normalizeCwd(rawCwd);
        return { key: n.key, name: n.name, cwd: n.cwd };
      })();

  const results: Array<Record<string, any>> = [];
  for (const ref of list) {
    const item: Record<string, any> = { ref: ref.slice(0, 60), imported: false, remoteDone: false };
    // 1) 定位远程那条（按内容；同内容多条时用 topic/pick 消歧，绝不替用户猜）
    let hit: any = null;
    try {
      hit = await todo.getTodo(ref, { topic, pick, groupId });
    } catch (e) {
      // 远程找不到（已被别人领走 / 内容写错）→ 如实报告这一条失败，其余照导
      item.error = String((e && (e as Error).message) || e);
      results.push(item);
      continue;
    }
    const remoteTask = hit && (hit.task || hit);
    const text = String((remoteTask && remoteTask.text) || ref);

    // 2) 先落本地——走与 add 同一条**派任务链路**（tasktool/add.js 的 submitTask）：
    //    正文自带 frontmatter 时 fail-open 补齐归属语义；落点仍是用户选定的主题
    //    （cwd 是这里的显式意图，不会被挪窝）。动态 import：add.js 静态引用本模块，
    //    反向只走动态（与 taskgoal 探针同一惯例）。
    const { submitTask } = await import('../tasktool/add.js');
    const added = await submitTask({ cwd: local.cwd, text, global: toGlobal });
    item.imported = true;
    item.localId = added.task.id;
    item.localTopic = added.name; // addTask 返回形状：主题名在 name（没有 topic 字段）

    // 3) 再把远程那条标完成，note 写明「本地的哪一个队列领走了它」
    try {
      await todo.doneTodo(text, {
        result: `已导入到本地队列「${item.localTopic || local.name}」（本地 #${added.task.id}）`,
        topic: remoteTask && remoteTask.topic ? remoteTask.topic : topic,
        pick,
        groupId,
      });
      item.remoteDone = true;
    } catch (e) {
      // 远程标完成失败：本地已经有这条了，**如实报告**（不能装作成功）
      item.error = `本地已导入，但远程标记失败：${String((e && (e as Error).message) || e)}`;
    }
    results.push(item);
  }

  const imported = results.filter((r) => r.imported).length;
  const remoteDone = results.filter((r) => r.remoteDone).length;
  return {
    status: imported ? 'ok' : 'nothing',
    target: { key: local.key, name: local.name, cwd: local.cwd, global: !!toGlobal },
    imported,
    remoteDone,
    failed: results.filter((r) => !r.imported).length,
    results,
    openCount: openTasks.length,
    // 人话提示（#74 要求的「本地的某一个队列领取了这个任务」）
    message: imported
      ? `已从远程导入 ${imported} 条到「${local.name}」；远程对应任务已标记完成 ${remoteDone} 条`
      : '没有导入任何任务',
  };
}
