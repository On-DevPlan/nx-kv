// tasktool/add.js —— 「派任务」的编排（从 localtask/index.js 的 action run 整体迁入）。
//
// 边界（与 get.js / wait.js 同一条分工：tasktool = 任务工具语义，localtask = 队列本体）：
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
// 编排住在 tasktool/<动词>.js，队列本体只有 service.js 一处。
import { badInput } from '../../core/errors.js';
import { addTask, normalizeCwd } from '../localtask/service.js';
import { applyGroupFields, parseFrontmatter } from '../../shared/frontmatter.js';
import { resolveGroupTarget } from '../localtask/board-target.js';
import { normalizedGroupStore } from './group-store.js';

/**
 * 派任务统一入口。
 *
 * 落点与归属的口径（**归属决定落点，目录不参与归属推断**）：
 *   1. 显式 `--global`                → 全局共享池（--cwd 被忽略；与 --board/--project 互斥）；
 *   2. 显式 `--board` / `--project`   → 严格口径：resolveGroupTarget 校验（组要配项目、
 *                                      项目须是组成员、--cwd 与 --project 不一致直接报错），
 *                                      frontmatter 统一落字段，落点 = 项目登记路径；
 *   3. 无 flag 但正文自带 frontmatter → fail-open：认得出归属就补介绍引用，**落点跟到
 *                                      解析出的项目路径**（调用方没显式给 cwd 时）——
 *                                      显式给了 cwd 就尊重调用方，只补字段不挪窝；
 *                                      解析不了（组没了 / 成员变了 / 写法不对）原样提交，不拦任务；
 *   4. 都没有                          → 按调用方目录（缺省进程 cwd）入队。
 *
 * @param {string}  text        任务正文（Markdown，frontmatter 允许在头部）
 * @param {string}  [cwd]       工作目录（显式给时不被 fail-open 挪窝；严格口径下只做一致性校验）
 * @param {string}  [summary]   顺带刷新该主题的当前现状（可选）
 * @param {boolean} [global]    推到全局共享池
 * @param {string}  [board]     工作组（id / key / 名称；严格口径）
 * @param {string}  [project]   归属项目（仓库 key / 名称 / 路径；严格口径）
 * @param {string}  [duration]  任务级 timegoal 时长（2h / 90m / 5小时）：领取即计时
 * @param {string}  [goalPrompt] 时间目标附加要求（只给它不给 duration 会在 sanitize 报错）
 * @returns {object} service.addTask 的返回（{status, key, cwd, name, task, delivered, queued, …}）
 */
export async function submitTask({
  text: rawText,
  cwd: rawCwd,
  summary,
  global: toGlobal = false,
  board,
  project,
  duration,
  goalPrompt,
  blockBy,
  blocksFollowing = false,
  forkOf,
  forkKind,
} = {}) {
  let text = String(rawText ?? '');
  let cwd = rawCwd;
  // 任务级 timegoal 声明（--duration/--goal-prompt 落下来的）：校验在 sanitizeTaskGoal
  // （时长写法错误在**发布时报**，不在领取时报）；只带了 goal-prompt 没带 duration → 报错。
  const timegoal = duration || goalPrompt ? { duration, prompt: goalPrompt } : undefined;

  if (board || project) {
    if (toGlobal) {
      throw badInput('--global 不能与 --board/--project 同时给：全局池没有工作组/项目归属');
    }
    // --cwd **只在显式给了**时才参与校验（须与 --project 指向同一个项目）。
    // 没给就留空：不能拿「进程当前目录」去跟项目比对——在别的仓库里执行
    // `--project alpha` 是完全正常的用法（给了 --project 就不用再给 --cwd）。
    const explicitCwd = rawCwd ? normalizeCwd(rawCwd).cwd : '';
    const target = resolveGroupTarget({ board, project, cwd: explicitCwd }, await normalizedGroupStore());
    text = applyGroupFields(text, target.fields);
    if (target.cwd) cwd = target.cwd;
  } else {
    // 正文自带 frontmatter（面板草稿 / CLI 直接写 / 导入的 md）→ fail-open 补齐归属语义。
    const fm = parseFrontmatter(text);
    if (fm.board || fm.project) {
      try {
        const target = resolveGroupTarget({ board: fm.board, project: fm.project, cwd: '' }, await normalizedGroupStore());
        text = applyGroupFields(text, target.fields);
        // 落点跟到解析出的项目队列——**只在调用方没显式给 cwd 时**：显式意图优先，
        // 不静默挪窝（与严格口径「cwd 与 project 冲突直接报错」同一精神，fail-open 只是
        // 不拦任务，不是替调用方改主意）；--global 时落点本来就不看 cwd，不挪。
        if (target.cwd && !rawCwd && !toGlobal) cwd = target.cwd;
      } catch {
        /* 保留原正文与调用方落点 */
      }
    }
  }

  return addTask({
    text,
    cwd,
    summary,
    global: toGlobal,
    timegoal,
    blockBy,
    blocksFollowing: !!blocksFollowing,
    // 任务链（#69）：这条任务从哪条派生（裸数字=同主题父任务，'key:id'=跨主题）
    forkOf,
    forkKind,
  });
}
