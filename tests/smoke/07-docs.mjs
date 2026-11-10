// 冒烟分组 7：文档落盘（seed → set → knowledge → export/import zip）、任务工具 --duration 门禁。
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function run(ctx) {
  const { check, cli, cliJson, tmp, base } = ctx;

  // ─── 13. 文档落盘：seed → set → knowledge → export/import zip（仓库登记不触网）───
  const repoDir = join(tmp, 'proj-alpha');
  mkdirSync(repoDir, { recursive: true });
  check(
    'repo add + board add + assign',
    (await cli(['repo', 'add', repoDir, '--name', 'alpha', '--desc', '管清单的', '--remote', 'https://github.com/me/alpha'])).status === 0 &&
      (await cli(['board', 'add', 'nx系列', '--desc', 'nx 工具链'])).status === 0 &&
      (await cli(['board', 'assign', 'alpha', '--board', 'nx系列'])).status === 0
  );
  check('board note', (await cli(['board', 'note', 'alpha', '--board', 'nx系列', '--note', '组里的任务出入口'])).status === 0);
  // repo add 的 --desc 现在是「初始描述 → 写进主篇文档」，不再只存字符串
  check('repo add 直接把 --desc 播种成主篇 md', existsSync(join(tmp, 'docs', 'repo', 'github.com', 'me', 'alpha.md')));

  const seedPrev = await cliJson(['docs', 'seed']);
  check('docs seed 预览 0 份（add / board add / board note 都已直接落文档）', seedPrev.count === 0, JSON.stringify(seedPrev.items || seedPrev).slice(0, 160));
  check('docs seed --apply', (await cli(['docs', 'seed', '--apply'])).status === 0);
  const list1 = await cliJson(['docs', 'list']);
  check('docs list 落盘 3 份', list1.count === 3, JSON.stringify(list1.docs.map((d) => d.rel)));
  check('约定路径就位（key 分段即目录）', existsSync(join(tmp, 'docs', 'repo', 'github.com', 'me', 'alpha.md')));

  check('docs set 写正文', (await cli(['docs', 'set', 'repo/github.com/me/alpha.md', '--body', '# alpha\n\n改过的介绍'])).status === 0);
  const repoShow = await cliJson(['repo', 'get', 'alpha']);
  check('保存后摘要回写 desc', repoShow.desc === '改过的介绍', repoShow.desc);

  check('docs add 自由文档', (await cli(['docs', 'add', 'notes/free.md', '--body', '# 自由\n\n链接 [[alpha]]'])).status === 0);
  // 介绍是**md 列表**（#58）：介绍目录里的补充说明进介绍集
  check('docs add 补充说明（介绍目录内）', (await cli(['docs', 'add', 'repo/github.com/me/alpha/reference/qa.md', '--body', '# 问答\n\n常见问题'])).status === 0);
  const idx = await cliJson(['docs', 'index']);
  check('docs index 双链索引含 alpha', Array.isArray(idx.index) && idx.index.some((x) => x.name === 'alpha'), JSON.stringify(idx).slice(0, 160));

  const know = await cliJson(['repo', 'knowledge', 'alpha']);
  check(
    'knowledge 聚合形状',
    know.repo.key === 'github.com/me/alpha' && Array.isArray(know.boards) && know.boards.length === 1 && know.boards[0].name === 'nx系列',
    JSON.stringify(know).slice(0, 200)
  );
  check('knowledge 组内描述已播种', know.boards[0].note && !know.boards[0].note.missing);
  const knowMd = await cliJson(['repo', 'knowledge', 'alpha', '--md']);
  check('knowledge --md 单篇以仓库标题开头', typeof knowMd.md === 'string' && knowMd.md.startsWith('# alpha'));
  const docList = await cliJson(['repo', 'doc', 'list', 'alpha']);
  check(
    'repo doc list：主篇 + 介绍目录里的补充篇',
    !!(docList.main && (docList.extras || []).some((x) => String(x.rel || '').endsWith('qa.md'))),
    JSON.stringify(docList).slice(0, 240)
  );
  const knowMd2 = await cliJson(['repo', 'knowledge', 'alpha', '--md']);
  check('knowledge --md 列出其余介绍文档', String(knowMd2.md || '').includes('qa.md'), String(knowMd2.md || '').slice(-300));

  const zipPath = join(tmp, 'export.zip');
  check('repo export --zip', (await cli(['repo', 'export', '--zip', zipPath])).status === 0);
  // 换环境导入：登记与文档树指向新的空目录（模拟换机），zip 直接吃
  process.env.NX_KV_REPOS_STORE = join(tmp, 'repos2.json');
  process.env.NX_KV_DOCS_DIR = join(tmp, 'docs2');
  const imp = await cliJson(['repo', 'import', zipPath]);
  check('import zip 执行成功', imp && !imp.__error, JSON.stringify(imp).slice(0, 200));
  check('import 还原文档树（5 份全写入）', imp.docs && imp.docs.written.length === 5, JSON.stringify(imp.docs).slice(0, 200));
  const list2 = await cliJson(['docs', 'list']);
  check('导入后 docs list 5 份', list2.count === 5, JSON.stringify(list2.docs.map((d) => d.rel)));
  const got = await cliJson(['docs', 'get', 'repo/github.com/me/alpha.md']);
  check('导入还原正文', got.body === '# alpha\n\n改过的介绍');
  const boardAfter = await cliJson(['board', 'get', 'nx系列']);
  check('导入还原成员与组内描述', boardAfter.repos.length === 1 && boardAfter.repos[0].note === '组里的任务出入口');

  const docsHttp = await (await fetch(base + '/api/docs')).json();
  check('api docs 列表可达', docsHttp.ok && Array.isArray(docsHttp.data.docs) && docsHttp.data.docs.length === 5);

  // ─── 14. 任务工具：--duration → get 领取带 check 指令 → done 门禁 ───
  const ttDir = join(tmp, 'tt-proj');
  mkdirSync(ttDir, { recursive: true });
  const ttAdd = await cliJson(['localtask', 'add', '带时限的任务', '--cwd', ttDir, '--duration', '90m', '--goal-prompt', '重点看流程']);
  check('tasktool: add --duration 落声明', ttAdd.task && ttAdd.task.timegoal && ttAdd.task.timegoal.duration === '90m', JSON.stringify(ttAdd.task).slice(0, 120));
  const ttGet = await cliJson(['localtask', 'get', '--cwd', ttDir, '--summary', '领活', '--json']);
  check(
    'tasktool: get 领取交付带 check 指令',
    ttGet.status === 'ok' && /timegoal check --task task:/.test(ttGet.instruction || '') && /sub agent/.test(ttGet.instruction || ''),
    String(ttGet.instruction || '').slice(0, 160)
  );
  const ttDone = await cliJson(['localtask', 'done', '--id', '1', '--cwd', ttDir, '--summary', '提前收工', '--json']);
  check(
    'tasktool: done 未到点 blocked（不抛错）',
    ttDone.status === 'blocked' && ttDone.reason === 'goal_not_reached' && ttDone.remainingSec > 0,
    JSON.stringify(ttDone).slice(0, 160)
  );
  const emptyGet = await cliJson(['localtask', 'get', '--cwd', ttDir, '--summary', '再领', '--json']);
  check('tasktool: get 空队列 instant timeout', emptyGet.status === 'timeout' && emptyGet.instant === true);
}
