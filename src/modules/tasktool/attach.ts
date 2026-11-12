// tasktool/attach.js —— 本地任务链路的附件编排（标注 / 追加 / 清单）。
//
// 背景（任务 #15「localtask 附件功能未实现」）：web 编辑器已把附件以
// `![名](fileId)` 嵌进正文，但链路的 **agent 侧**对不上——get/wait 交付的
// 正文里躺着一串 fileId，没有附件清单、没有本地路径；CLI 也没法给本机任务挂附件。
//
// 口径（任务 #15 验收反馈 2026-11-04）：**本地任务的贴图走本地存储，与云端
// 零关联**——
//   - `localtask attach --path` 落**本机附件仓**（core/localatt.js，不发网）；
//   - 领取标注先查本机仓：命中直接给绝对路径，agent 零网络读文件；
//   - 未命中的 id（云端清单附件的引用、或 CLI --fileId 引的云端 id）才按本机
//     设置 autoSyncAttachments 走云端镜像（core/attachstore.js），fail-open。
//   - 解析：附件语法只有一份实现（shared/attach.js——零依赖纯函数，
//     面板与 Node 共用），这里只消费不重写；
//   - 标注：交付载荷带 task.attachments（id/kind/name/localPath/synced/storage），
//     instruction 追加〔附件〕段告诉 agent 去哪读文件。
//
// fail-open 纪律与 todo 相同：附件能不能拿到跟任务能不能交付是两件事——
// 标注 / 同步的任何失败都不许拖垮 get/wait；正文没有引用时**载荷逐字节不变**。
//
// 拆分：资源视图模型（行 → 展示/取用信息）在 attach-resource.js；
// 〔附件〕段模板 ctx 与渲染在 attach-template.js（这里 re-export，import 路径不变）；
// 本文件只做编排——标注、挂载、清单、解除。
import { readFile } from 'node:fs/promises';
import { basename, resolve as resolvePath } from 'node:path';
import { badInput } from '../../core/errors.js';
import { loadConfig, resolveGroupId } from '../../core/config.js';
import { contentTypeOf, isImageName } from '../../core/fileapi.js';
import { localIndex as cloudMirrorIndex, syncAttachments } from '../../core/attachstore.js';
import { localIndex as localStoreIndex, localUpload } from '../../core/localatt.js';
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import { attachmentsRootFromEnv } from '../../core/paths.js';
import {
  deleteAttachment,
  ensureRefAttachment,
  ensureTaskAttachment,
  ensureUrlAttachment,
  linkAttachment,
  listTaskAttachmentsBySeq,
  readMdfile,
  registerMdfile,
  resolveRefId,
  unlinkAttachment,
  updateAttachmentNote,
  upsertFileAttachment,
} from '../../core/attachmentdb.js';
import * as service from '../localtask/service.js';
import { inlineDocContent } from './doc-inline.js';
import { fileStateOf, resourceOf, targetLookupsOf, type ResourceLookups } from './attach-resource.js';

export { attachmentInstruction, attachInstructionOf, attachTemplateCtx } from './attach-template.js';

// 附件语法的唯一解析/生成实现（零依赖纯函数；todo 与面板共用同一份）。
// todo 在模块互依禁列里 → 动态 import（与 getloop/add 的 reposStore 同一惯例）。
let todoAttach: any = null;
async function todoAttachMod(): Promise<any> {
  if (!todoAttach) todoAttach = await import('../../shared/attach.js');
  return todoAttach;
}

/** file 行逐个标注可达性：本机仓命中 → 本地绝对路径；否则看云端镜像。 */
function annotateFileRows(rows: any[], lookups: ResourceLookups, store: any, mirror: any): any[] {
  return rows.map((row) => {
    const a = resourceOf(row, lookups);
    if (a.kind !== 'file') return a;
    const s = store.index.get(row.id);
    if (s) return fileStateOf(a, { localPath: s.path, storage: 'local', name: a.name || s.name, size: s.size });
    const m = mirror.index.get(row.id);
    return fileStateOf(a, {
      localPath: (m && m.path) || '',
      storage: 'cloud',
      name: a.name || (m && m.name) || row.id,
      size: m && m.size,
    });
  });
}

/**
 * 给 ref 型附件补**文档标题**（#168）：标题 = 文档正文首行的 `# 标题`。
 * 服务端补（读盘），前端直接显示——用户「填写了标题」后，附件区与 md 编辑器
 * 里的引用名就该是那个标题，而不是文件名。读不到就留空（前端回落附件名）。
 */
async function annotateRefTitles(attachments: any[]): Promise<any[]> {
  const refs = (attachments || [])
    .filter((a) => a.kind === 'ref')
    .map((a) => ({ id: a.refId || a.targetKey || '', locator: a.relPath || a.targetKey || '' }));
  if (!refs.length) return attachments;
  let titles = new Map<string, string>();
  try {
    const { refTitlesOf } = await import('../docs/brief.js');
    titles = await refTitlesOf(refs);
  } catch {
    titles = new Map();
  }
  for (const a of attachments) {
    if (a.kind !== 'ref') continue;
    const t = titles.get(String(a.refId || a.targetKey || ''));
    if (!t) continue;
    a.docTitle = t;
    // 视图标题一并覆盖：附件区、md 编辑器引用名、指令段都读它——一处改，处处一致
    a.title = t;
    a.name = t;
  }
  return attachments;
}

/**
 * mdfile 行的交付注入：读磁盘原文件（读时校验指纹），把正文挂到
 * `mdContent/mdTruncated/mdStale/mdMissing`，模板侧按 mdfile 分支渲染。
 * 读失败（文件没了）只标 missing，不拖垮交付（fail-open）。
 */
const MDFILE_INLINE_MAX = 20000;

async function annotateMdfileContent(attachments: any[]): Promise<any[]> {
  const rows = attachments.filter((a) => a.kind === 'mdfile');
  if (!rows.length) return attachments;
  const db = getDb();
  for (const a of rows) {
    try {
      const r = readMdfile(db, a.id);
      if (!r) continue;
      a.absPath = r.absPath || a.absPath || '';
      a.mdMissing = r.missing;
      a.mdStale = r.stale;
      a.mdContent = r.body.length > MDFILE_INLINE_MAX ? r.body.slice(0, MDFILE_INLINE_MAX) : r.body;
      a.mdTruncated = r.body.length > MDFILE_INLINE_MAX;
    } catch {
      a.mdMissing = true;
      a.mdContent = '';
    }
  }
  return attachments;
}

export interface AnnotateTaskDeliveryOptions {
  /** 是否允许为未命中的附件跑一次云端同步（预览传 false：只读盘、不发网） */
  sync?: boolean;
  topicKey?: unknown;
  /** 是否为「文档资料」绑定（role='doc' 的 kind=ref 附件）读全文并附进视图模型（#162） */
  inlineDocs?: boolean;
}

/**
 * 领取/查看时刻的附件标注：本机仓优先 → 云端镜像兜底 → 标注本地路径。
 *
 * @param task 库存任务（normalizeTask 形状）
 * @returns null = 正文没有附件引用
 *   （调用方据此保持载荷原样）；sync 只在真的跑过云端同步时非 null。
 */
export async function annotateTaskDelivery(
  task: any,
  { sync: allowSync = true, topicKey = '', inlineDocs = false }: AnnotateTaskDeliveryOptions = {},
): Promise<null | { task: any; sync: any | null }> {
  if (!task) return null;
  // schema v2：资源关系在任务入库时就写好了，交付侧只读 task_attach，不再解析正文。
  const rows = listTaskAttachmentsBySeq(getDb(), { topicKey: topicKey || task.key, seq: task.id });
  if (!rows.length) return null;

  // 本机附件仓：本地任务贴图的资源行（零云端依赖，命中即绝对路径）
  const store = await localStoreIndex();
  const cfg = await loadConfig();
  const gid = await resolveGroupId(undefined); // core/config 的 groupId 参数迁移时丢了可缺省标注

  // 不在本机仓的 file 行才考虑云端镜像；自动下载关（或全命中）就一次网都不碰
  const cloudIds = rows
    .filter((r) => r.kind === 'file' && !store.index.has(r.id))
    .map((r) => r.id);
  let sync: any = null;
  if (allowSync && cloudIds.length && cfg.autoSyncAttachments) {
    // 说明文字 → 本地文件名：`![季度报表.docx](id)` 落盘就叫「季度报表.docx」
    const names: Record<string, string> = {};
    for (const r of rows) if (cloudIds.includes(r.id) && r.name) names[r.id] = r.name;
    try {
      sync = await syncAttachments({ groupId: gid, ids: cloudIds, names, dir: cfg.attachmentsDir });
    } catch (e) {
      sync = { dir: '', downloaded: 0, skipped: 0, failures: [{ id: '(整体)', error: String((e as Error).message || e) }] };
    }
  }

  const mirror = await cloudMirrorIndex(gid, cfg.attachmentsDir);
  const attachments = annotateFileRows(rows, targetLookupsOf(getDb(), rows), store, mirror);
  await annotateMdfileContent(attachments);
  await annotateRefTitles(attachments);
  if (inlineDocs) await inlineDocContent(attachments, { id: (task as any).id, key: (task as any).key || (task as any).topicKey });
  return { task: { ...task, attachments }, sync };
}

export interface AttachToTaskOptions {
  /** 任务寻址三件套：形状对齐 localtask 的 TaskAddress（getTask 入参） */
  id?: string | number;
  cwd?: string;
  key?: string;
  path?: unknown;
  fileId?: unknown;
  name?: unknown;
  kind?: unknown;
  url?: unknown;
  task?: unknown;
  ref?: unknown;
  /** 本地 md 文件（kind=mdfile：只登记路径指针，不复制正文） */
  mdfile?: unknown;
  note?: unknown;
  noEmbed?: unknown;
  inline?: unknown;
}

/**
 * 给任务挂附件（CLI `localtask attach`）。两种落法：
 *
 *   默认（嵌入正文）：资源写库 + 以 markdown 追加到正文末尾，关系 role=inline；
 *   `--no-embed`   ：只写 attachments + task_attach（role=attach），**不动正文**——
 *                    附件区（面板）与 `localtask attachments` 都能列出。
 *
 * 文档来源专属：
 *   `--ref` + `--inline`：文档资料绑定（role=doc，#162）——交付时把文档**全文**
 *                    附进提示词（截断 2 万字），而不是只给一条 docs get 命令；
 *                    `--note` 作为该绑定的 desc 一并透出。
 *
 * 来源四选一：
 *   --path <本机文件>  落本机附件仓（零云端）
 *   --fileId <id>      引用已有资源（本机仓 / 云端 id 都认）
 *   --url <链接>       外部 URL（kind=url）
 *   --task <seq>       同主题下的另一条任务（kind=task，nxkv://task/<id>）
 *   --ref <路径|id>    文档库里的 ref（kind=ref，nxkv://ref/<refId>）
 *   --mdfile <路径>    本地 md 文件（kind=mdfile，nxkv://mdfile/<attId>；字节不入库）
 */
export async function attachToTask({
  id, cwd, key, path, fileId, name, kind, url, task, ref, mdfile, note, noEmbed, inline,
}: AttachToTaskOptions = {}): Promise<Record<string, any>> {
  const cur = await service.getTask({ id, cwd, key }); // 存在性与参数校验都在队列本体
  const topicKey = cur.key || key || '';
  const db = getDb();

  let fid = fileId ? String(fileId).trim() : '';
  let displayName = String(name || '').trim();
  let resolvedKind = kind ? String(kind) : '';
  let attachmentId = '';
  let markdown = '';

  const { looksLikeFileId, embedMarkdown } = await todoAttachMod();

  if (path) {
    // --path：先落本机附件仓再登记——「正文里的 id」与「本机文件」一次性对齐，全程不发网
    const abs = resolvePath(String(path));
    let buffer: Buffer | undefined;
    try {
      buffer = await readFile(abs);
    } catch (e) {
      throw badInput(`读不到文件: ${abs}（${(e as NodeJS.ErrnoException).code || (e as Error).message}）`);
    }
    const fileName = displayName || basename(abs);
    const rec = await localUpload({
      name: fileName,
      buffer,
      contentType: contentTypeOf(fileName),
    });
    fid = rec.fileId;
    displayName = rec.name;
    if (!resolvedKind) resolvedKind = isImageName(rec.name, rec.contentType) ? 'image' : 'file';
    tx(
      (conn) =>
        upsertFileAttachment(conn, {
          id: fid,
          name: rec.name,
          localPath: rec.path,
          mime: rec.contentType,
          size: rec.size,
          storage: 'local',
          meta: { isImage: resolvedKind === 'image', source: 'cli' },
        }),
      { db, mode: 'IMMEDIATE' }
    );
    attachmentId = fid;
    if (!noEmbed) {
      markdown = embedMarkdown({ name: displayName || fid, id: fid, kind: resolvedKind as 'image' | 'file' });
    }
  } else if (fid) {
    if (!looksLikeFileId(fid)) {
      throw badInput(`附件 id 不合法: ${fid}（应为 32 位 hex，可带扩展名）`);
    }
    if (resolvedKind && resolvedKind !== 'image' && resolvedKind !== 'file') {
      throw badInput(`--kind 只能是 image 或 file，收到: ${resolvedKind}`);
    }
    if (!resolvedKind) resolvedKind = isImageName(fid, '') ? 'image' : 'file';
    tx(
      (conn) =>
        upsertFileAttachment(conn, {
          id: fid,
          name: displayName || fid,
          meta: { isImage: resolvedKind === 'image' },
        }),
      { db, mode: 'IMMEDIATE' }
    );
    attachmentId = fid;
    markdown = embedMarkdown({ name: displayName || fid, id: fid, kind: resolvedKind as 'image' | 'file' });
  } else if (url) {
    const u = String(url).trim();
    if (!/^https?:\/\//i.test(u)) throw badInput(`--url 需要 http(s) 绝对地址: ${u}`);
    attachmentId = tx(
      (conn) => ensureUrlAttachment(conn, { url: u, name: displayName }),
      { db, mode: 'IMMEDIATE' }
    ) as string; // ensure*Attachment 现返回 string|null；下一行的 !attachmentId 守卫兜底
    if (!attachmentId) throw badInput(`URL 登记失败: ${u}`);
    resolvedKind = 'url';
    markdown = `[${displayName || u}](${u})`;
  } else if (task !== undefined && task !== null && String(task).trim() !== '') {
    const seq = Number(String(task).replace(/^#/, ''));
    if (!Number.isFinite(seq)) throw badInput(`--task 需要任务编号（同主题 seq）: ${task}`);
    const row = db.get(
      `SELECT t.id, t.seq FROM tasks t JOIN topics k ON k.id = t.topic_id
        WHERE k.key = :key AND t.seq = :seq AND t.deleted_at IS NULL`,
      { key: topicKey, seq }
    );
    if (!row) throw badInput(`主题「${topicKey}」里没有任务 #${seq}`);
    attachmentId = tx(
      (conn) => ensureTaskAttachment(conn, { taskId: Number(row.id), name: displayName }),
      { db, mode: 'IMMEDIATE' }
    ) as string; // 同上：登记失败落空串，由下方 !attachmentId 统一报错
    resolvedKind = 'task';
    markdown = `[${displayName || `任务 #${seq}`}](nxkv://task/${Number(row.id)})`;
  } else if (ref) {
    const refId = resolveRefId(db, ref as string);
    if (!refId) throw badInput(`找不到文档: ${ref}（可先用 docs list 看已有路径）`);
    attachmentId = tx(
      (conn) => ensureRefAttachment(conn, { refId, name: displayName }),
      { db, mode: 'IMMEDIATE' }
    ) as string; // 同上：登记失败落空串，由下方 !attachmentId 统一报错
    resolvedKind = 'ref';
    markdown = `[${displayName || String(ref).split('/').pop()}](nxkv://ref/${refId})`;
  } else if (mdfile) {
    // 外部 md 文件：登记指针（kind=mdfile / storage=external），正文留在磁盘原地
    const rec = tx(
      (conn) => registerMdfile(conn, { path: mdfile, name: displayName }),
      { db, mode: 'IMMEDIATE' }
    );
    attachmentId = rec.id;
    displayName = displayName || rec.name;
    resolvedKind = 'mdfile';
    markdown = `[${displayName}](nxkv://mdfile/${rec.id})`;
  }

  if (!attachmentId) {
    throw badInput(
      '需要 --path <本机文件>、--fileId <已有附件>、--url <链接>、--task <编号>、--ref <文档> 或 --mdfile <本地 md> 之一'
    );
  }
  const wantInline = !!inline;
  if (wantInline && resolvedKind !== 'ref') {
    throw badInput('--inline（文档进原文）只支持 --ref 文档绑定');
  }

  // 关系表是权威：先落边（正文同步不会把 attach 降级），正文只是 inline 的呈现。
  // 边语义：--no-embed → attach（附件区）；--inline → doc（文档资料，交付进原文）；
  // 默认 embed → inline（由正文同步写）。doc 边压得过正文同步的 inline（优先级
  // doc > inline），后续改正文不会把「进原文」降级成路径引用。
  // note（desc）显式随边落库：embed 路径此前只写正文、说明会丢（#162）。
  if (noEmbed) markdown = '';
  const edgeRole = wantInline ? 'doc' : noEmbed ? 'attach' : 'inline';
  let r: any = { key: cur.key, name: topicNameOf(cur), task: cur };
  if (!noEmbed && markdown) {
    const text = cur.text ? `${cur.text}\n${markdown}` : markdown;
    r = await service.updateTask({ id: cur.id, cwd, key, text } as Record<string, any>); // service 层参数尚未类型化
  }
  if (noEmbed || wantInline || note !== undefined) {
    tx(
      (conn) => {
        const gid = taskGlobalIdOf(conn, { topicKey, seq: cur.id });
        if (!gid) throw badInput(`任务 #${cur.id} 已不存在，无法挂附件`);
        // --inline 是用户最新的显式意图：现存的 attach 边优先级更高（不会被 doc
        // 覆盖），这里换边而不是静默忽略；position 跟着旧边走。
        if (wantInline && !noEmbed) {
          const curEdge = conn.get(
            'SELECT role, position FROM task_attach WHERE task_id = :id AND attachment_id = :att',
            { id: gid, att: attachmentId }
          );
          if (curEdge && curEdge.role === 'attach') {
            unlinkAttachment(conn, { host: 'task', hostId: gid, attachmentId });
            linkAttachment(conn, { host: 'task', hostId: gid, attachmentId, role: 'doc', note: note as string | undefined, position: curEdge.position });
            return;
          }
        }
        linkAttachment(conn, { host: 'task', hostId: gid, attachmentId, role: edgeRole, note: note as string | undefined });
      },
      { db, mode: 'IMMEDIATE' }
    );
  }

  return {
    status: 'ok',
    key: r.key,
    name: r.name,
    fileId: attachmentId,
    kind: resolvedKind,
    markdown,
    area: edgeRole === 'inline' ? 'inline' : 'area',
    role: edgeRole,
    task: r.task,
  };
}

// 任务对象在 service 层有 name/key 等；拿不到时给空串，渲染层会退化成 id。
function topicNameOf(t: any): string {
  return String((t && (t.name || t.topicName)) || '');
}

/** 关系表挂的是全局 tasks.id，而 CLI 只有 (topicKey, seq)——统一在这里换算。 */
function taskGlobalIdOf(conn: any, { topicKey, seq }: { topicKey: unknown; seq: unknown }): number {
  const row = conn.get(
    `SELECT t.id FROM tasks t JOIN topics k ON k.id = t.topic_id
      WHERE k.key = :key AND t.seq = :seq AND t.deleted_at IS NULL`,
    { key: String(topicKey || ''), seq: Number(seq) }
  );
  return row ? Number(row.id) : 0;
}

export interface ListTaskAttachmentsOptions {
  /** 任务寻址三件套：形状对齐 localtask 的 TaskAddress（getTask 入参） */
  id?: string | number;
  cwd?: string;
  key?: string;
}

/**
 * 列出某条任务引用的附件（CLI `localtask attachments`）：不依赖自动下载开关，
 * 本机仓 → 云端镜像逐个标注（agent 据此决定直接读本地还是先 sync）。
 */
export async function listTaskAttachments({ id, cwd, key }: ListTaskAttachmentsOptions = {}): Promise<Record<string, any>> {
  const cur = await service.getTask({ id, cwd, key });
  const cfg = await loadConfig();
  const gid = await resolveGroupId(undefined);
  const store = await localStoreIndex();
  const mirror = await cloudMirrorIndex(gid, cfg.attachmentsDir);
  const rows = listTaskAttachmentsBySeq(getDb(), { topicKey: (cur.key || key) as string, seq: cur.id });
  const attachments = annotateFileRows(rows, targetLookupsOf(getDb(), rows), store, mirror);
  await annotateRefTitles(attachments);

  return {
    task: { id: cur.id, key: cur.key || key },
    localDir: store.dir,
    cloudDir: mirror.dir,
    autoSync: !!cfg.autoSyncAttachments,
    count: attachments.length,
    inlineCount: attachments.filter((a) => a.origin !== 'area').length,
    areaCount: attachments.filter((a) => a.origin === 'area').length,
    attachments,
  };
}

export interface NoteTaskAttachmentOptions {
  /** 任务寻址三件套：形状对齐 localtask 的 TaskAddress（getTask 入参） */
  id?: string | number;
  cwd?: string;
  key?: string;
  attachment?: unknown;
  note?: unknown;
}

/**
 * 改一条附件绑定上的**说明**（desc，#168）：面板里给已挂载的文档绑定补/改说明。
 * 只动边上的 note（角色/位置不动）——「这条边是什么」与「它讲什么」分开。
 */
export async function noteTaskAttachment({ id, cwd, key, attachment, note = '' }: NoteTaskAttachmentOptions = {}): Promise<Record<string, any>> {
  const cur = await service.getTask({ id, cwd, key });
  const topicKey = cur.key || key || '';
  const attId = String(attachment || '').trim();
  if (!attId) throw badInput('需要 --attachment <资源 id>（见 localtask attachments 输出）');
  const db = getDb();
  let changed = 0;
  tx(
    (conn) => {
      const gid = taskGlobalIdOf(conn, { topicKey, seq: cur.id });
      if (!gid) throw badInput(`任务 #${cur.id} 已不存在`);
      changed = updateAttachmentNote(conn, { host: 'task', hostId: gid, attachmentId: attId, note: note as string | undefined });
    },
    { db, mode: 'IMMEDIATE' }
  );
  if (!changed) throw badInput(`这条任务上没有附件 ${attId}`);
  return {
    status: 'ok',
    key: cur.key || key,
    name: topicNameOf(cur),
    task: { id: cur.id },
    attachment: attId,
    note: String(note || ''),
  };
}

export interface DetachTaskAttachmentOptions {
  /** 任务寻址三件套：形状对齐 localtask 的 TaskAddress（getTask 入参） */
  id?: string | number;
  cwd?: string;
  key?: string;
  attachment?: unknown;
  purge?: unknown;
}

/**
 * 解除任务与一条资源的关系（CLI `localtask detach`）。
 *
 *   --only-unlink（默认）：只删 task_attach 边，资源与字节保留（可能进孤儿池）；
 *   --purge            ：先解除关系，再在「没有任何任务/文档还在用」时删资源行与字节。
 *
 * 关系表是权威：解除后这条资源不再出现在任务附件清单里，但正文里若仍有内嵌，
 * 下次正文同步会把 inline 边重新写回来（这是正文明示的引用，不算丢）。
 */
export async function detachTaskAttachment({ id, cwd, key, attachment, purge }: DetachTaskAttachmentOptions = {}): Promise<Record<string, any>> {
  const cur = await service.getTask({ id, cwd, key });
  const topicKey = cur.key || key || '';
  const attId = String(attachment || '').trim();
  if (!attId) throw badInput('需要 --attachment <资源 id>（见 localtask attachments 输出）');
  const db = getDb();
  const cfg = await loadConfig();
  const store = await localStoreIndex();
  let deleted = 0;
  let purgeResult: any = null;
  tx(
    (conn) => {
      const gid = taskGlobalIdOf(conn, { topicKey, seq: cur.id });
      if (!gid) throw badInput(`任务 #${cur.id} 已不存在`);
      deleted = unlinkAttachment(conn, { host: 'task', hostId: gid, attachmentId: attId });
      if (purge && deleted) {
        purgeResult = deleteAttachment(conn, attId, {
          attachmentsRoot: attachmentsRootFromEnv() || cfg.attachmentsDir || store.dir,
        });
      }
    },
    { db, mode: 'IMMEDIATE' }
  );
  return {
    status: 'ok',
    key: cur.key || key,
    name: topicNameOf(cur),
    task: { id: cur.id },
    attachment: attId,
    unlinked: deleted,
    purged: !!(purgeResult && purgeResult.removed),
    purgeReason: purgeResult ? purgeResult.reason || '' : '',
    bytesRemoved: !!(purgeResult && purgeResult.bytesRemoved),
  };
}
