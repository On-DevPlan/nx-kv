// 冒烟分组 7：文档落盘（seed → set → knowledge → export/import zip）、任务工具 --duration 门禁。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function run(ctx) {
  const { check, cli, cliJson, tmp, base } = ctx;

  // ─── 13. 文档：repo/board 描述 → 直接 ref → knowledge → export/import zip ───
  const repoDir = join(tmp, 'proj-alpha');
  mkdirSync(repoDir, { recursive: true });
  check(
    'repo add + board add + assign',
    (await cli(['repo', 'add', repoDir, '--name', 'alpha', '--desc', '管清单的', '--remote', 'https://github.com/me/alpha'])).status === 0 &&
      (await cli(['board', 'add', 'nx系列', '--desc', 'nx 工具链'])).status === 0 &&
      (await cli(['board', 'assign', 'alpha', '--board', 'nx系列'])).status === 0
  );
  check('board note', (await cli(['board', 'note', 'alpha', '--board', 'nx系列', '--note', '组里的任务出入口'])).status === 0);
  // repo add 的 --desc 直接落成项目主篇（直接 ref，没有路径）
  const docList0 = await cliJson(['repo', 'doc', 'list', 'alpha']);
  const mainDocId = String((docList0.main && docList0.main.docId) || '');
  check('repo add 把 --desc 落成主篇 ref', /^ref:ref_[0-9a-f]{16}$/.test(mainDocId), JSON.stringify(docList0).slice(0, 200));
  const seeded = await cliJson(['docs', 'get', mainDocId]);
  check('主篇正文包含初始描述', String(seeded.body || '').includes('管清单的'), JSON.stringify(seeded).slice(0, 200));

  const list1 = await cliJson(['docs', 'list']);
  check('docs list 已含项目/组/组内描述 3 份', list1.count === 3, JSON.stringify(list1.docs.map((d) => d.refId)));

  check('docs set 写正文', (await cli(['docs', 'set', mainDocId, '--body', '# alpha\n\n改过的介绍'])).status === 0);
  const got1 = await cliJson(['docs', 'get', mainDocId]);
  check('docs get 读回正文', got1.body === '# alpha\n\n改过的介绍');

  // 项目补充篇：新建直接 ref + 写正文
  const qa = await cliJson(['docs', 'ref', 'add', '--owner', 'repo', '--repo', 'alpha', '--desc', 'qa']);
  check('docs ref add 新建补充篇', /^ref_/.test(qa.refId || ''), JSON.stringify(qa).slice(0, 200));
  check('docs set 写补充篇', (await cli(['docs', 'set', 'ref:' + qa.refId, '--body', '# 问答\n\n常见问题'])).status === 0);
  const idx = await cliJson(['docs', 'index']);
  check('docs index 双链索引含 qa', Array.isArray(idx.index) && idx.index.some((x) => x.name === 'qa'), JSON.stringify(idx).slice(0, 160));

  // 外部 md：登记为 mdfile（只挂附件区，正文逐字节不变）
  const extMd = join(tmp, '外部方案.md');
  writeFileSync(extMd, '# 外部方案\n\n正文', 'utf8');
  const linked = await cliJson(['docs', 'link-file', mainDocId, '--path', extMd]);
  check('docs link-file 登记外部 md', /^att_mdfile_[0-9a-f]{16}$/.test(linked.attachmentId || ''), JSON.stringify(linked));
  const docAtts = await cliJson(['docs', 'attachments', mainDocId]);
  check(
    '附件区出现 kind=mdfile，正文未被改写',
    docAtts.attachments.some((a) => a.id === linked.attachmentId && a.kind === 'mdfile') &&
      (await cliJson(['docs', 'get', mainDocId])).body === '# alpha\n\n改过的介绍',
    JSON.stringify(docAtts.attachments).slice(0, 240)
  );
  const know = await cliJson(['repo', 'knowledge', 'alpha']);
  check(
    'knowledge 聚合形状',
    know.repo.key === 'github.com/me/alpha' && Array.isArray(know.boards) && know.boards.length === 1 && know.boards[0].name === 'nx系列',
    JSON.stringify(know).slice(0, 200)
  );
  check('knowledge 组内描述已落文档', know.boards[0].note && !know.boards[0].note.missing);
  const knowMd = await cliJson(['repo', 'knowledge', 'alpha', '--md']);
  check('knowledge --md 单篇以仓库标题开头', typeof knowMd.md === 'string' && knowMd.md.startsWith('# alpha'));
  const docList = await cliJson(['repo', 'doc', 'list', 'alpha']);
  check(
    'repo doc list：主篇 + 补充篇',
    !!(docList.main && (docList.links || []).some((x) => x.ref === qa.refId)),
    JSON.stringify(docList).slice(0, 240)
  );
  const knowMd2 = await cliJson(['repo', 'knowledge', 'alpha', '--md']);
  check(
    'knowledge --md 其余介绍文档给 docs get --ref 引导',
    /其余介绍文档[\s\S]*docs get --ref ref_/.test(String(knowMd2.md || '')),
    String(knowMd2.md || '').slice(-300)
  );

  const zipPath = join(tmp, 'export.zip');
  check('repo export --zip', (await cli(['repo', 'export', '--zip', zipPath])).status === 0);
  // 换环境导入：登记与库都指向新的空目录（模拟换机），zip 直接吃
  process.env.NX_KV_REPOS_STORE = join(tmp, 'repos2.json');
  process.env.NX_KV_DB = join(tmp, 'nxkv2.db');
  const imp = await cliJson(['repo', 'import', zipPath]);
  check('import zip 执行成功', imp && !imp.__error, JSON.stringify(imp).slice(0, 200));
  check('import 还原文档 4 份', imp.docs && imp.docs.written.length === 4, JSON.stringify(imp.docs).slice(0, 200));
  const list2 = await cliJson(['docs', 'list']);
  check('导入后 docs list 4 份', list2.count === 4, JSON.stringify(list2.docs.map((d) => d.refId)));
  const got = await cliJson(['docs', 'get', mainDocId]);
  check('导入还原正文', got.body === '# alpha\n\n改过的介绍');
  const boardAfter = await cliJson(['board', 'get', 'nx系列']);
  check('导入还原成员与组内描述', boardAfter.repos.length === 1 && boardAfter.repos[0].note === '组里的任务出入口');

  const docsHttp = await (await fetch(base + '/api/docs')).json();
  check('api docs 列表可达', docsHttp.ok && Array.isArray(docsHttp.data.docs) && docsHttp.data.docs.length === 4);

  // ─── 14. 任务工具：--duration → get 领取带 check 指令 → done 门禁 ───
  const ttDir = join(tmp, 'tt-proj');
  mkdirSync(ttDir, { recursive: true });
  const ttAdd = await cliJson(['localtask', 'add', '带时限的任务', '--cwd', ttDir, '--duration', '90m', '--goal-prompt', '重点看流程']);
  check('tasktool: add --duration 落声明', ttAdd.task && ttAdd.task.timegoal && ttAdd.task.timegoal.duration === '90m', JSON.stringify(ttAdd.task).slice(0, 120));

  // mdfile 冒烟：localtask 挂外部 md → 附件清单 → docs mdfiles / mdfile 读正文
  const mdPath = join(tmp, 'local-plan.md');
  writeFileSync(mdPath, '# 本地计划\n\n正文', 'utf8');
  const mdAtt = await cliJson(['localtask', 'attach', '--id', String(ttAdd.task.id), '--cwd', ttDir, '--mdfile', mdPath]);
  check(
    'localtask attach --mdfile 落 nxkv://mdfile 链接',
    /^\[local-plan\.md\]\(nxkv:\/\/mdfile\/att_mdfile_[0-9a-f]{16}\)$/.test(mdAtt.markdown || ''),
    JSON.stringify(mdAtt).slice(0, 200)
  );
  const mdList = await cliJson(['localtask', 'attachments', '--id', String(ttAdd.task.id), '--cwd', ttDir]);
  const mdItem = (mdList.attachments || [])[0];
  check(
    'mdfile 进附件清单且带外部路径',
    mdList.count === 1 && mdItem && mdItem.kind === 'mdfile' && mdItem.absPath === mdPath,
    JSON.stringify(mdList.attachments).slice(0, 240)
  );
  const mdFiles = await cliJson(['docs', 'mdfiles']);
  check('docs mdfiles 列出台账', (mdFiles || []).some((x) => x.absPath === mdPath), JSON.stringify(mdFiles).slice(0, 240));
  const mdBody = await cliJson(['docs', 'mdfile', mdItem.id]);
  check('docs mdfile 读到正文', mdBody.body === '# 本地计划\n\n正文' && mdBody.missing === false, JSON.stringify(mdBody).slice(0, 200));
  const ttGet = await cliJson(['localtask', 'get', '--cwd', ttDir, '--json']);
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
  const emptyGet = await cliJson(['localtask', 'get', '--cwd', ttDir, '--json']);
  check('tasktool: get 空队列 instant timeout', emptyGet.status === 'timeout' && emptyGet.instant === true);
}
