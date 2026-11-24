// localtask/add.ts —— 「派任务」的编排（从 localtask/index.js 的 action run 整体迁入）。
//
// 边界（与 claim/get.js 同一条分工：localtask = 队列本体 + 派任务编排）：
// 队列读写、落盘、唤醒注册表都在 localtask/service.js；这里只做**编排**——
// 落点与 frontmatter 的统一解析 → 任务级 timegoal 声明归一 → 委托 service.addTask
// 入队（有 wait 在等则即时投递）。
//
// 为什么要有这一个模块：派任务的**落点判定只此一份实现**。此前它内联在
// localtask.add 的 action run 里，面板提交又自己判了一遍（四路分支），远程导入
// 则绕过组语义直插队列——同一件事多处实现，必然分叉。现在 CLI、HTTP、面板提交、
// 远程清单导入（import-remote）走同一条 submitTask：显式 --board/--project 走
// 严格口径（校验成员资格与目录一致），正文自带 frontmatter 走 fail-open
//（认得出归属就补介绍引用、落点跟到项目队列）。
//
// 至此三个任务动词（领 get / 等 wait / 派 add）同构：action 层一律一行委托，
// 编排住在本域（add.js / update.js），队列本体只有 service.js 一处。
import { addTask, normalizeCwd } from '../service.js';
import { parseFrontmatter, stripFrontmatter } from '../../../shared/frontmatter.js';
import { resolveGroupTarget } from '../ops/board-target.js';
import { normalizedGroupStore } from '../ops/group-store.js';

export interface SubmitTaskOptions {
  /** 任务正文（Markdown，frontmatter 允许在头部） */
  text?: unknown;
  /** 工作目录（显式给时不被 fail-open 挪窝；严格口径下只做一致性校验） */
  cwd?: unknown;
  /** 顺带刷新该主题的当前现状（可选） */
  summary?: unknown;
  /** 推到全局共享池 */
  global?: boolean;
  /** 工作组（id / key / 名称；严格口径） */
  board?: unknown;
  /** 归属项目（仓库 key / 名称 / 路径；严格口径） */
  project?: unknown;
  /** 任务级 timegoal 时长（2h / 90m / 5小时）：领取即计时 */
  duration?: unknown;
  /** 时间目标附加要求（只给它不给 duration 会在 sanitize 报错） */
  goalPrompt?: unknown;
  blockBy?: unknown;
  blocksFollowing?: boolean;
  forkOf?: unknown;
  forkKind?: unknown;
}

/**
 * 派任务统一入口。
 *
 * 落点与归属的口径（**归属决定落点，目录不参与归属推断**）：
 *   2. 显式 `--board` / `--project`   → 严格口径：resolveGroupTarget 校验（组要配项目、
 *                                      项目须是组成员、--cwd 与 --project 不一致直接报错），
 *                                      frontmatter 统一落字段，落点 = 项目登记路径；
 *   3. 无 flag 但正文自带 frontmatter → fail-open：认得出归属就补介绍引用，**落点跟到
 *                                      解析出的项目路径**（调用方没显式给 cwd 时）——
 *                                      显式给了 cwd 就尊重调用方，只补字段不挪窝；
 *                                      解析不了（组没了 / 成员变了 / 写法不对）原样提交，不拦任务；
 *   4. 都没有                          → 按调用方目录（缺省进程 cwd）入队。
 *
 * @returns service.addTask 的返回（{status, key, cwd, name, task, delivered, queued, …}）
 */
export async function submitTask({
  text: rawText,
  cwd: rawCwd,
  summary,
  board,
  project,
  duration,
  goalPrompt,
  blockBy,
  blocksFollowing = false,
  forkOf,
  forkKind,
}: SubmitTaskOptions = {}): Promise<Record<string, any>> {
  let text = String(rawText ?? '');
  let cwd: unknown = rawCwd;
  // 任务级 timegoal 声明（--duration/--goal-prompt 落下来的）：校验在 sanitizeTaskGoal
  // （时长写法错误在**发布时报**，不在领取时报）；只带了 goal-prompt 没带 duration → 报错。
  const timegoal = duration || goalPrompt ? { duration, prompt: goalPrompt } : undefined;

  // #197：归属不再写进正文 frontmatter——组上下文与所属仓库作为结构化参数交给 addTask，
  // 由它落 topics.group_key / tasks.repo_key。正文只留 markdown 本身。
  let groupKey = '';
  let groupName = '';
  let repoKey = '';
  if (board || project) {
    // --cwd **只在显式给了**时才参与校验（须与 --project 指向同一个项目）。
    const explicitCwd = rawCwd ? normalizeCwd(rawCwd as string).cwd : '';
    const target = resolveGroupTarget(
      { board: board as string | undefined, project: project as string | undefined, cwd: explicitCwd },
      await normalizedGroupStore(),
    );
    groupKey = target.boardKey;
    groupName = target.boardName;
    repoKey = target.projectKey;
    if (target.cwd) cwd = target.cwd;
  } else {
    // 兼容旧草稿：正文里可能还带 frontmatter（面板草稿 / 导入的 md）→ 提取成结构化
    // 参数后**剥掉**，保证库里不再存 `---` 头。
    const fm = parseFrontmatter(text);
    if (fm.board || fm.project) {
      try {
        const target = resolveGroupTarget(
          { board: fm.board, project: fm.project, cwd: '' } as { board?: string; project?: string; cwd?: string },
          await normalizedGroupStore(),
        );
        groupKey = target.boardKey;
        groupName = target.boardName;
        repoKey = target.projectKey;
        if (target.cwd && !rawCwd) cwd = target.cwd;
      } catch {
        /* 解析不出就只剥头，不拦任务 */
      }
      text = stripFrontmatter(text);
    }
  }

  // localtask 的 addTask 尚未类型化（解构参数只推断出带默认值的键），按运行时形状整包断言
  return addTask({
    text,
    cwd,
    summary,
    timegoal,
    blockBy,
    blocksFollowing: !!blocksFollowing,
    // 任务链（#69）：这条任务从哪条派生（裸数字=同主题父任务，'key:id'=跨主题）
    forkOf,
    forkKind,
    groupKey,
    groupName,
    repoKey,
  } as Record<string, any>);
}
