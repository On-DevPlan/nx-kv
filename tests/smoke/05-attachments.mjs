// 冒烟分组 5：本机附件——上传 / 嵌入本地任务 / 交付标注（CLI 链路）。
//
// 这一段的要害是「附件能不能变成 agent 手上的一个本地文件」：
// 上传落本机附件仓、正文里的 id 能被识别、领取交付直接给绝对路径。
// 注：pngBytes / upFileId 会挂到 ctx 上，供 06-web.mjs 的面板链路用例复用。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function run(ctx) {
  const { check, cli, cliJson, tmp } = ctx;

  // ─── 11c. 附件：上传 / 嵌入任务 / 交付标注 ──────────────────
  const attHome = process.env.NX_KV_ATTACHMENTS;
  const pngPath = join(tmp, 'logo.png');
  const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  writeFileSync(pngPath, pngBytes);

  const up = await cliJson(['file', 'upload', '--path', pngPath]);
  check('file upload 返回 32 位 hex fileId', /^[0-9a-f]{32}$/.test(up.fileId || ''), JSON.stringify(up).slice(0, 160));
  check(
    '上传落本机附件仓（storage=local，字节真的在盘）',
    up.storage === 'local' && up.localPath.startsWith(attHome) && existsSync(up.localPath),
    JSON.stringify(up).slice(0, 240)
  );
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

  check(
    'file get 读到元数据',
    await (async () => {
      const fi = await cliJson(['file', 'get', up.fileId]);
      return fi.fileId === up.fileId && fi.size === pngBytes.length && fi.storage === 'local';
    })()
  );
  check('file get 不存在的 id 报错', (await cli(['file', 'get', 'f'.repeat(32)])).status === 1);

  // ─── 嵌入本地任务 → 领取交付带本地绝对路径 ──────────────────
  const topic = join(tmp, 'projAtt');
  mkdirSync(topic, { recursive: true });
  const added = await cliJson(['localtask', 'add', '带附件的任务', '--cwd', topic]);
  const attached = await cliJson([
    'localtask', 'attach', '--id', String(added.task.id), '--cwd', topic,
    '--fileId', up.fileId, '--name', 'logo.png', '--kind', 'image',
  ]);
  check(
    'localtask attach 把嵌入追加进正文末尾',
    attached.task.text.endsWith(`![logo.png](${up.fileId})`),
    attached.task.text
  );
  const attached2 = await cliJson([
    'localtask', 'attach', '--id', String(added.task.id), '--cwd', topic,
    '--fileId', upDoc.fileId, '--kind', 'file',
  ]);
  check(
    '再追加一个 docx 附件',
    attached2.task.text.includes(`[报告.docx](${upDoc.fileId})`),
    attached2.task.text
  );
  check(
    'localtask attach 拒绝不像附件 id 的值',
    (await cli([
      'localtask', 'attach', '--id', String(added.task.id), '--cwd', topic,
      '--fileId', 'http://evil/x.png',
    ])).status === 1
  );

  const attList = await cliJson(['localtask', 'attachments', '--id', String(added.task.id), '--cwd', topic]);
  check(
    'localtask attachments 列出 2 个附件且类型正确',
    attList.count === 2 && attList.attachments[0].kind === 'file' && attList.attachments[0].isImage === true,
    JSON.stringify(attList.attachments)
  );
  check(
    '本机仓命中 → synced/localPath 指向真实文件',
    attList.attachments.every((a) => a.synced === true && a.storage === 'local' && existsSync(a.localPath)),
    JSON.stringify(attList.attachments.map((a) => a.localPath))
  );

  const wait = await cliJson(['localtask', 'wait', '--cwd', topic]);
  check(
    '领取交付带附件清单（2 个，全部本机可读）',
    wait.status === 'ok' &&
      Array.isArray(wait.task.attachments) &&
      wait.task.attachments.length === 2 &&
      wait.task.attachments.every((a) => a.storage === 'local' && existsSync(a.localPath)),
    JSON.stringify(wait.task.attachments || null).slice(0, 300)
  );
  check(
    'instruction 的附件段给出本地绝对路径',
    (wait.instruction || '').includes(wait.task.attachments[0].localPath) &&
      (wait.instruction || '').includes('本任务包含 2 个附件'),
    JSON.stringify(wait.instruction || '').slice(0, 300)
  );

  check(
    'file content（CLI）给出地址与本地路径',
    await (async () => {
      const c = await cliJson(['file', 'content', up.fileId]);
      return /^\/api\/file\/content\//.test(c.url) && c.localPath.endsWith('.png') && existsSync(c.localPath);
    })()
  );

  // ─── 无主资源：没被任何任务引用的上传可被回收 ───────────────
  const orphanPath = join(tmp, 'orphan.png');
  writeFileSync(orphanPath, pngBytes);
  const orphan = await cliJson(['file', 'upload', '--path', orphanPath]);
  check(
    '无主资源清单能看到未被引用的上传',
    await (async () => {
      const o = await cliJson(['file', 'orphans']);
      return o.total === 1 && o.attachments[0].id === orphan.fileId;
    })()
  );
  check(
    'prune --dry-run 只列不删',
    await (async () => {
      const p = await cliJson(['file', 'prune', '--dry-run']);
      return p.dryRun === true && p.removed === 1;
    })()
  );
  check(
    'prune 真的回收（文件也从盘上删掉）',
    await (async () => {
      const p = await cliJson(['file', 'prune']);
      return p.removed === 1 && !existsSync(orphan.localPath);
    })()
  );

  // 传给 06-web.mjs：面板链路要用同一张图的 bytes 与已上传的 fileId
  ctx.pngBytes = pngBytes;
  ctx.upFileId = up.fileId;
}
