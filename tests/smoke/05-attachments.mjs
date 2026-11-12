// 冒烟分组 5：附件——上传 / 嵌入任务 / 同步到本地 / 自动下载（CLI 链路）。
//
// 这一段的要害是「附件能不能变成 agent 手上的一个本地文件」——
// 上传只认 multipart、后端不回原名、本地名字只能自己定，这些都在这里钉死。
// 注：pngBytes / upFileId 会挂到 ctx 上，供 06-web.mjs 的面板链路用例复用。
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function run(ctx) {
  const { check, cli, cliJson, tmp } = ctx;

  // ─── 11c. 附件：上传 / 嵌入任务 / 同步到本地 / 自动下载 ──────
  const attHome = process.env.NX_KV_ATTACHMENTS;
  const pngPath = join(tmp, 'logo.png');
  const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  writeFileSync(pngPath, pngBytes);

  const up = await cliJson(['file', 'upload', '--path', pngPath]);
  check('file upload 返回 32 位 hex fileId', /^[0-9a-f]{32}$/.test(up.fileId || ''), JSON.stringify(up).slice(0, 160));
  check(
    'file upload 认出图片并给出 markdown 片段',
    up.isImage === true && up.markdown.image === `![logo.png](${up.fileId})`,
    JSON.stringify(up.markdown)
  );

  const docxPath = join(tmp, '报告.docx');
  writeFileSync(docxPath, Buffer.from('PK\u0003\u0004 fake docx body'));
  const upDoc = await cliJson(['file', 'upload', '--path', docxPath]);
  check(
    'file upload 支持 docx（按链接语法）',
    upDoc.isImage === false && upDoc.markdown.file === `[报告.docx](${upDoc.fileId})`,
    JSON.stringify(upDoc.markdown)
  );

  check('file list 看到两个附件', (await cliJson(['file', 'list'])).total === 2);
  check('未同步时 localPath 为空', (await cliJson(['file', 'list'])).files.every((f) => f.localPath === ''));
  check(
    'file get 读到元数据',
    await (async () => {
      const fi = await cliJson(['file', 'get', up.fileId]);
      return fi.fileId === up.fileId && fi.size === pngBytes.length;
    })()
  );
  check('file get 不存在的 id 报错', (await cli(['file', 'get', 'f'.repeat(32)])).status === 1);

  await cli(['todo', 'add', '--topic', 'att', '待办带附件']);
  const attached = await cliJson(['todo', 'attach', '--ref', '待办带附件', '--fileId', up.fileId, '--name', 'logo.png', '--kind', 'image']);
  check(
    'todo attach 把嵌入追加进正文末尾',
    attached.task.text === `待办带附件 ![logo.png](${up.fileId})`,
    attached.task.text
  );
  const attached2 = await cliJson(['todo', 'attach', '--ref', attached.task.text, '--fileId', upDoc.fileId, '--kind', 'file']);
  check('再追加一个 docx 附件', attached2.task.text.includes(`[${upDoc.fileId}](${upDoc.fileId})`), attached2.task.text);
  check(
    'todo attach 拒绝不像附件 id 的值',
    (await cli(['todo', 'attach', '--ref', attached2.task.text, '--fileId', 'http://evil/x.png'])).status === 1
  );

  const attList = await cliJson(['todo', 'attachments', '--ref', attached2.task.text]);
  check('todo attachments 列出 2 个附件且类型正确', attList.count === 2 && attList.attachments[0].kind === 'image', JSON.stringify(attList.attachments));



  const sync1 = await cliJson(['file', 'sync']);
  check('file sync 下载两个附件', sync1.downloaded === 2, JSON.stringify(sync1).slice(0, 200));
  check('落盘目录在 nx-kv 用户目录下（测试用 NX_KV_ATTACHMENTS 覆盖）', sync1.usedDir.startsWith(attHome), sync1.usedDir);
  check('返回的是**本地绝对路径**且文件真的在', sync1.files.every((f) => existsSync(f.path)), JSON.stringify(sync1.files.map((f) => f.path)));
  check('非图片附件保留扩展名（否则双击打不开）', sync1.files.some((f) => f.path.endsWith('.docx')), JSON.stringify(sync1.files.map((f) => f.name)));

  const sync2 = await cliJson(['file', 'sync']);
  check('二次同步跳过未变更（不重复下载）', sync2.downloaded === 0 && sync2.skipped === 2, JSON.stringify(sync2).slice(0, 160));

  check('setting 默认不开自动下载', (await cliJson(['setting', 'get'])).autoSyncAttachments === false);
  check('setting set 打开自动下载', (await cliJson(['setting', 'set', '--autoSyncAttachments'])).autoSyncAttachments === true);
  check('setting.set 无参数报错', (await cli(['setting', 'set'])).status === 1);

  // 换一个目录，验证「读任务时自动下载」这条链路真的会落盘并回传全路径
  const attHome2 = join(tmp, 'attachments-2');
  process.env.NX_KV_ATTACHMENTS = attHome2;
  const read = await cliJson(['todo', 'get', '--ref', attached2.task.text]);
  check('todo get 回传 attachments', Array.isArray(read.attachments) && read.attachments.length === 2, JSON.stringify(read).slice(0, 240));
  check('每个附件都带存在的本地全路径', read.attachments.every((a) => existsSync(a.localPath)), JSON.stringify(read.attachments.map((a) => a.localPath)));
  check('图片按 markdown 里的说明取名落盘', read.attachments[0].localPath.endsWith('logo.png'), read.attachments[0].localPath);
  check('读取时自动下载有如实报告', !!read.attachmentsSync && read.attachmentsSync.downloaded === 2, JSON.stringify(read.attachmentsSync));
  check(
    'todo list 也带本地路径',
    await (async () => {
      const l = await cliJson(['todo', 'list', '--topic', 'att']);
      const t = l.open.find((x) => x.text === attached2.task.text);
      return !!t && t.attachments.length === 2 && existsSync(t.attachments[0].localPath);
    })()
  );
  // 关掉开关后：不再触网同步（无 attachmentsSync），但**附件标注仍在**
  // ——「这条任务挂了附件」本身是清单事实，与「要不要下载」是两回事。
  check('关掉自动下载后不再同步，但附件标注仍保留', await (async () => {
    await cli(['setting', 'set', '--autoSyncAttachments=false']);
    const l = await cliJson(['todo', 'list', '--status', 'open']);
    const t = l.open.find((x) => x.text === attached2.task.text);
    return l.attachmentsSync === undefined && !!t && t.attachments.length === 2 && t.attachments[0].synced === true;
  })());
  process.env.NX_KV_ATTACHMENTS = attHome;

  check(
    'file content（CLI）给出地址与本地路径',
    await (async () => {
      const c = await cliJson(['file', 'content', up.fileId]);
      return /^https?:\/\//.test(c.url) && c.localPath.endsWith('.png');
    })()
  );

  const removed = await cliJson(['file', 'remove', upDoc.fileId]);
  check('file remove 软删成功', removed.status === 'ok' && removed.deleted === true, JSON.stringify(removed));
  check('remove 后只剩一个附件', (await cliJson(['file', 'list'])).total === 1);

  // 附件必须与任务落在**同一个**工作空间。这里刻意用 `group use shared`（改本机配置）
  // 而不是 `--group` —— 「配置里是 190、这条命令没传 --group」正是最容易静默错位的路径。
  await cli(['group', 'use', 'shared']);
  const sharedUp = await cliJson(['file', 'upload', '--path', pngPath, '--name', 'shared.png']);
  check('切组后上传落进该空间', /^[0-9a-f]{32}$/.test(sharedUp.fileId || ''));
  check('该空间 list 能看到它', (await cliJson(['file', 'list'])).files.some((f) => f.fileId === sharedUp.fileId));
  check(
    '切回默认组后就看不到它（空间隔离生效）',
    await (async () => {
      await cli(['group', 'use', 'default']);
      return (await cliJson(['file', 'list'])).files.every((f) => f.fileId !== sharedUp.fileId);
    })()
  );
  check(
    'sync 落到该工作空间的目录（不是 default）',
    await (async () => {
      await cli(['group', 'use', 'shared']);
      const s = await cliJson(['file', 'sync']);
      await cli(['group', 'use', 'default']);
      return /[\\/]190$/.test(s.usedDir) && s.files.length === 1 && existsSync(s.files[0].path);
    })()
  );

  // 传给 06-web.mjs：面板链路要用同一张图的 bytes 与已上传的 fileId
  ctx.pngBytes = pngBytes;
  ctx.upFileId = up.fileId;
}
