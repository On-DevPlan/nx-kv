// localtask/update.ts —— 「改任务」的编排：改正文 + **改归属项目即搬家**。
//
// 派任务（add.js 的 submitTask）有一条铁律：**归属决定落点**——`--project X` 的任务
// 落进 X 的登记路径队列。但这条规则此前只在提交那一刻生效：用户提交后发现归属填错、
// 把正文里的 project 改掉再保存，正文是改了，队列没动——任务还挂在旧项目队列里，
// 旧项目的 agent 照旧领走，新项目的 agent 永远看不见（任务 #43「重新修改提交无效」）。
//
// 本模块把同一条铁律补到**改任务 / 重开**上：编辑后的 effective project 变了 →
// 任务搬进新项目的登记路径队列（service 的 moveTo），frontmatter 的介绍引用一并刷新。
// 落点解析与 add.js 共用同一份实现（board-target.resolveGroupTarget + group-store），
// 不另起炉灶。
import { badInput } from '../../../core/errors.js';
import { resolveGroupTarget } from '../ops/board-target.js';
import * as service from '../service.js';
import { normalizedGroupStore } from '../ops/group-store.js';

/** 改任务 / 重开的参数（透传 localtask/service，形状由 service 层校验；寻址三件套对齐 TaskAddress） */
export interface UpdateTaskParams {
  cwd?: string;
  key?: string;
  id?: string | number;
  text?: unknown;
  [k: string]: any;
}

/**
 * 解析这次编辑的**归属落点**（#197：归属改由显式参数给出，不再读正文 frontmatter）。
 *
 * @param project 目标归属仓库（key / 名称 / 路径）；不传 = 不改归属
 * @param board   目标组（id / key / 名称）；不传 = 不改组
 * @returns null（纯文案编辑）或 { moveTo, text, groupKey, groupName }
 */
async function resolveAttributionChange({ text, project, board }: UpdateTaskParams): Promise<
  null | { moveTo: { cwd: string; name: string; groupKey: string; groupName: string }; text: string }
> {
  if (!project && !board) return null;
  let target: any;
  try {
    target = resolveGroupTarget(
      { board: String(board || '').trim(), project: String(project || '').trim(), cwd: '' },
      await normalizedGroupStore(),
    );
  } catch (err) {
    // 归属是这次明确要改的：解析不到（未登记 / 不是本组成员）就明说，不静默吞
    throw badInput(`改归属失败：${(err as Error).message}`);
  }
  if (!target.cwd) {
    throw badInput('改归属失败：没有解析出目标项目路径（--project 必须指向已登记仓库）');
  }
  return {
    moveTo: {
      cwd: target.cwd,
      name: target.projectName || target.projectKey,
      groupKey: target.boardKey,
      groupName: target.boardName,
    },
    // #197：正文只存 markdown（历史 --- 头在迁移时已剥光，运行时不剥）
    text: text === undefined || text === null ? '' : String(text),
  };
}

/** 改任务（CLI `localtask update` / HTTP PATCH /api/localtasks/item 同走这里）。 */
export async function updateTask(params: UpdateTaskParams): Promise<Record<string, any>> {
  const plan = await resolveAttributionChange(params);
  if (!plan) return service.updateTask(params as Record<string, any>); // service 层参数尚未类型化
  const patch: Record<string, any> = { ...params, moveTo: plan.moveTo };
  if (plan.text) patch.text = plan.text; // 只改归属、不动正文时别把正文清空
  return service.updateTask(patch);
}

/** 重开任务（用户的修改反馈；--text 可能带着改过的归属，同样搬家）。 */
export async function reopenTask(params: UpdateTaskParams): Promise<Record<string, any>> {
  const plan = await resolveAttributionChange(params);
  if (!plan) return service.reopenTask(params);
  const patch: Record<string, any> = { ...params, moveTo: plan.moveTo };
  if (plan.text) patch.text = plan.text;
  return service.reopenTask(patch);
}
