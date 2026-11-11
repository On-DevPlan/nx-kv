// tasktool/update.js —— 「改任务」的编排：改正文 + **改归属项目即搬家**。
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
import { badInput } from '../../core/errors.js';
import { applyGroupFields, parseFrontmatter, preserveFrontmatter } from '../../shared/frontmatter.js';
import { resolveGroupTarget } from '../localtask/board-target.js';
import * as service from '../localtask/service.js';
import { normalizedGroupStore } from './group-store.js';

/** 改任务 / 重开的参数（透传 localtask/service，形状由 service 层校验；寻址三件套对齐 TaskAddress） */
export interface UpdateTaskParams {
  cwd?: string;
  key?: string;
  id?: string | number;
  text?: unknown;
  [k: string]: any;
}

/**
 * 解析这次编辑的**归属落点**。
 *
 * effective frontmatter = 旧 ∪ 新（新键优先，与服务端 preserveFrontmatter 同一口径）。
 * 判据不是「project 字段变没变」而是**不变式本身**：归属项目的登记队列 ≠ 任务所在队列
 * 就要搬。只比字段会漏掉历史脏数据——#43 的现场正是上一轮把 project 改成了 nx-kv
 * 但队列还在 nx-as，字段没变、搬家用不上，用户怎么改都「没有变化」。
 * 同队列 → null（纯文案编辑，与搬家无关）。
 *
 * @returns null | { moveTo: {cwd: string, name: string}, text: string }
 */
async function resolveAttributionChange({ cwd, key, id, text }: UpdateTaskParams): Promise<null | { moveTo: { cwd: string; name: string }; text: string }> {
  if (text === undefined || text === null || !String(text).trim()) return null;
  const current = await service.getTask({ cwd, key, id });
  const oldFm = parseFrontmatter(current.text);
  const merged = preserveFrontmatter(current.text, String(text));
  const newFm = parseFrontmatter(merged);
  const oldProject = String(oldFm.project || '').trim();
  const newProject = String(newFm.project || '').trim();
  if (!newProject) return null;
  const projectChanged = newProject !== oldProject;
  let target: any;
  try {
    target = resolveGroupTarget(
      { board: String(newFm.board || '').trim(), project: newProject, cwd: '' },
      await normalizedGroupStore(),
    );
  } catch (err) {
    // 归属字段是这次明确要改的：解析不到（未登记 / 不是本组成员）就明说，不静默吞掉；
    // 归属没变的普通文案编辑不因归属元数据解析失败被拦（fail-open，同派任务口径）
    if (projectChanged) throw badInput(`改归属失败：${(err as Error).message}`);
    return null;
  }
  return {
    moveTo: { cwd: target.cwd, name: target.projectName || target.projectKey },
    // 介绍引用跟着换——正文说 B、projectIntro 还指着 A 的文档就是在撒谎
    text: applyGroupFields(merged, target.fields),
  };
}

/** 改任务（CLI `localtask update` / HTTP PATCH /api/localtasks/item 同走这里）。 */
export async function updateTask(params: UpdateTaskParams): Promise<Record<string, any>> {
  const plan = await resolveAttributionChange(params);
  if (!plan) return service.updateTask(params as Record<string, any>); // service 层参数尚未类型化
  return service.updateTask({ ...params, text: plan.text, moveTo: plan.moveTo } as Record<string, any>);
}

/** 重开任务（用户的修改反馈；--text 可能带着改过的归属，同样搬家）。 */
export async function reopenTask(params: UpdateTaskParams): Promise<Record<string, any>> {
  const plan = await resolveAttributionChange(params);
  if (!plan) return service.reopenTask(params);
  return service.reopenTask({ ...params, text: plan.text, moveTo: plan.moveTo });
}
