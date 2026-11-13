// CLI/面板提交任务时的**工作组目标解析**：--board / --project → frontmatter 字段 + 落点目录。
//
// 纯逻辑（store 由调用方注入）：单元测试直接喂数组，不碰磁盘。
//
// **输入是归一化后的形状**（调用方用 repos 服务的 boardRepoKeys / deriveKey 归一）：
//   boards[i] = { id, name, key, memberKeys: string[] }   ← 成员键（不是 repoIds）
//   repos[i]  = { key, name, path }
// 归一化放在调用方，是因为 repos 模块在**模块互依禁列**里（localtask 不能静态引它）。
//
// 语义（**正逻辑：项目优先**）：
//   --project <key|name|path> 归属项目 = 任务挂在哪个项目上；落点目录由它推导
//                              （进那个项目的队列）。给了它就不用管 --cwd。
//   --board  <id|key|name>    工作组（看板）：归属项目**必须是它的成员**，一起写进
//                              正文 frontmatter（board + project），任务才出现在组面板里。
//   --cwd    目录             只在没有 --project 时用来指定「落在哪个队列」；
//                              与 --board 并用时**不参与归属推断**（归属只能是项目）。
//
// frontmatter 字段（正文头部，写给 agent 读）：
//   board / project          归属（组 id / 项目 key）
//   boardIntro / projectIntro 介绍文档的 docId（ref:<refId>，用 docs get --ref 读）
//   boardDesc / projectDesc  一句话摘要（组 desc / 项目 desc）
//
// 为什么不能从 cwd 反推项目：--cwd 是「队列地址」，--project 是「归属」——
// 两件事。反推等于让地址决定归属，用户以为在挂项目，实际被目录牵着走。
// 组内任务必须显式指明组内项目：归属不明就不该静默落在某个目录。
import { badInput } from '../../core/errors.js';

/** 归一化后的看板形状（外部 JSON → any）。 */
export type BoardLike = any;
/** 归一化后的仓库形状（外部 JSON → any）。 */
export type RepoLike = any;

const normPath = (p: unknown): string => String(p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();

/**
 * 介绍文档的地址：ref:<refId>（绑定存在时）；没有绑定给空串。
 * agent 拿到后用 `nx-kv docs get --ref <refId>` 读正文。
 */
function introDocId(ref: unknown): string {
  const r = ref as { ref?: string } | null | undefined;
  return r && typeof r === 'object' && r.ref ? 'ref:' + r.ref : '';
}

/** 看板按 id / key / 名称匹配（组名最像人话，agent 上下文里只有组名） */
export function findBoard(boards: BoardLike[], want: unknown): BoardLike | null {
  const w = String(want ?? '').trim();
  if (!w) return null;
  return (
    (boards || []).find((b) => b.id === w) ||
    (boards || []).find((b) => b.key === w) ||
    (boards || []).find((b) => String(b.name || '').toLowerCase() === w.toLowerCase()) ||
    null
  );
}

/** 仓库按 key / 名称 / 路径匹配 */
export function findRepo(repos: RepoLike[], want: unknown): RepoLike | null {
  const w = String(want ?? '').trim();
  if (!w) return null;
  const wp = normPath(w);
  return (
    (repos || []).find((r) => r.key === w) ||
    (repos || []).find((r) => String(r.name || '').toLowerCase() === w.toLowerCase()) ||
    (repos || []).find((r) => normPath(r.path) === wp) ||
    null
  );
}

/** 看板成员键（归一化后的形状；兼容直接给 repoKeys 的用法） */
export function memberKeysOf(board: BoardLike | null | undefined): Set<string> {
  if (!board) return new Set();
  if (Array.isArray(board.memberKeys)) return new Set(board.memberKeys.filter(Boolean));
  if (Array.isArray(board.repoKeys)) return new Set(board.repoKeys.filter(Boolean));
  if (Array.isArray(board.repos)) {
    return new Set(board.repos.map((m: any) => (typeof m === 'string' ? m : m && m.key)).filter(Boolean));
  }
  return new Set();
}

/** resolveGroupTarget 的入参（--board / --project / --cwd 原始值）。 */
export interface GroupTargetWant {
  board?: string;
  project?: string;
  cwd?: string;
}

/** resolveGroupTarget 注入的仓库登记 / 看板清单。 */
export interface GroupTargetStore {
  boards?: BoardLike[];
  repos?: RepoLike[];
}

/** resolveGroupTarget 的出站形状。 */
export interface GroupTargetResult {
  boardId: string;
  boardName: string;
  projectKey: string;
  projectName: string;
  cwd: string;
  fields: Record<string, unknown>;
}

/**
 * 解析提交目标。
 * @param {{board?: string, project?: string, cwd?: string}} want  --board / --project / --cwd 原始值
 * @param {{boards: Array, repos: Array}} store   仓库登记与看板（由调用方注入，归一化后）
 * @returns {{boardId: string, boardName: string, projectKey: string, projectName: string, cwd: string, fields: object}}
 */
export function resolveGroupTarget(want: GroupTargetWant, store: GroupTargetStore): GroupTargetResult {
  const boards = (store && store.boards) || [];
  const repos = (store && store.repos) || [];
  const boardWant = String(want.board ?? '').trim();
  const projWant = String(want.project ?? '').trim();
  const cwdWant = String(want.cwd ?? '').trim();
  if (!boardWant && !projWant) {
    return { boardId: '', boardName: '', projectKey: '', projectName: '', cwd: '', fields: {} };
  }

  let board: BoardLike | null = null;
  if (boardWant) {
    board = findBoard(boards, boardWant);
    if (!board) {
      throw badInput(
        `找不到项目组「${boardWant}」（可用 nx-kv board list 看清单；id / key / 名称都认）`
      );
    }
  }

  // 成员集合：有组时只能在组内选（--project 必须是该组成员）
  const memberKeys = board ? memberKeysOf(board) : null;
  let repo: RepoLike | null = null;
  if (projWant) {
    repo = findRepo(repos, projWant);
    if (!repo) {
      throw badInput(`找不到项目「${projWant}」（可用 nx-kv repo list 看登记；key / 名称 / 路径都认）`);
    }
    if (memberKeys && !memberKeys.has(repo.key)) {
      throw badInput(
        `项目「${repo.name || repo.key}」不是项目组「${board.name}」的成员（先 nx-kv board assign 挂进去）`
      );
    }
    // --project 与 --cwd 都给了却指向不同项目 → 用错了，不静默取一个
    if (cwdWant && repo.path && normPath(cwdWant) !== normPath(repo.path)) {
      throw badInput(
        `--cwd 指向「${cwdWant}」，--project 指向「${repo.name || repo.key}」（${repo.path}）——不是同一个项目；给了 --project 就不用再给 --cwd`
      );
    }
  } else if (board) {
    // 有组就必须有归属项目：组内任务不能归属不明。
    // 列出成员**名字**（用户真会敲进 --project 的值）；认不出名字的退回 key。
    const members = [...(memberKeys || [])].map((k) => {
      const r = (repos || []).find((x) => x.key === k);
      return r && r.name ? r.name : k;
    });
    throw badInput(
      `--board「${board.name}」的任务要指明归属项目：加 --project <项目>` +
        (members.length ? `（本组成员：${members.join(' / ')}）` : '')
    );
  }

  // frontmatter 字段：**归属**（board id / project key）+ **介绍引用**（docId + 一行摘要）。
  // 介绍用引用式而不是内联正文：agent 拿到 refId 就能用 docs get 读；
  // 内联既撑爆 frontmatter，又会在介绍更新后留下过期副本。
  const fields: Record<string, unknown> = {};
  if (board) {
    fields.board = board.id;
    fields.boardIntro = introDocId(board.doc);
    fields.boardDesc = String(board.desc || '').trim();
  }
  if (repo) {
    fields.project = repo.key;
    fields.projectIntro = introDocId(repo.doc);
    fields.projectDesc = String(repo.desc || '').trim();
  }

  return {
    boardId: board ? board.id : '',
    boardName: board ? board.name || '' : '',
    projectKey: repo ? repo.key : '',
    projectName: repo ? repo.name || repo.key : '',
    // 落点：有项目就用项目登记的路径（进它的队列）；否则调用方给的 cwd 说了算
    cwd: repo ? repo.path || '' : '',
    fields,
  };
}
