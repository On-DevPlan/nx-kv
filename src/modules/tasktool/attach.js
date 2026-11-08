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
//   - 解析：附件语法只有一份实现（modules/todo/attach.js——零依赖纯函数，
//     面板与 Node 共用），这里只消费不重写；
//   - 标注：交付载荷带 task.attachments（id/kind/name/localPath/synced/storage），
//     instruction 追加〔附件〕段告诉 agent 去哪读文件。
//
// fail-open 纪律与 todo 相同：附件能不能拿到跟任务能不能交付是两件事——
// 标注 / 同步的任何失败都不许拖垮 get/wait；正文没有引用时**载荷逐字节不变**。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, resolve as resolvePath } from 'node:path';
import { badInput } from '../../core/errors.js';
import { renderInstruction } from '../../core/instruction-template.js';
import { DEFAULT_ATTACH_TEMPLATE } from '../../shared/prompt-blocks.js';
import { stripFrontmatter } from '../../shared/frontmatter.js';
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
  resolveRefId,
  unlinkAttachment,
  upsertFileAttachment,
} from '../../core/attachmentdb.js';
import * as service from '../localtask/service.js';

// 资源类型只有四种（用户口径）：file（含图片）/ url / task / ref。
// 旧数据里 kind='image' 或没有 kind 的一律按 file 处理（向后兼容）。
const KIND_LABEL = { file: '附件', url: '链接', task: '任务', ref: '文档' };
const IMAGE_LABEL = '图片';
const ORIGIN_LABEL = { inline: '正文内嵌', area: '附件区' };

function metaOf(row) {
  const m = row && row.meta;
  if (m && typeof m === 'object') return m;
  try {
    const v = JSON.parse(String(m || '{}'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** 资源类型归一：image / 空 / 其它未知值 → file；url/task/ref 原样。 */
function baseKind(row) {
  const k = String((row && row.kind) || '');
  return k === 'url' || k === 'task' || k === 'ref' ? k : 'file';
}

function kindLabelOf(kind, isImage) {
  if (kind === 'file') return isImage ? IMAGE_LABEL : KIND_LABEL.file;
  return KIND_LABEL[kind] || KIND_LABEL.file;
}

function sizeTextOf(n) {
  const v = Math.max(0, Number(n) || 0);
  if (!v) return '';
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
}

function hostOfUrl(href) {
  try {
    return new URL(String(href || '')).host;
  } catch {
    return '';
  }
}

/** 任务标题 = 正文（去 frontmatter）首个非空行，去 # 前缀，截 80 字。 */
function taskTitleOf(body) {
  const text = String(stripFrontmatter(String(body || ''))).trim();
  const first = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  return first.replace(/^#+\s*/, '').trim().slice(0, 80);
}

/**
 * task / ref 类资源的补充信息（标题、状态、topic、locator）。
 *
 * task 型附件存的是**地址**（target_key=topic_key + target_seq），不复制正文：
 *   - 先按 meta.taskId 这条本地外键 join（任务跨 topic 搬家后 task_id 不变，
 *     topic_key/seq 会变，这里据此发现地址漂移）；
 *   - task_id 指向的行已被 purge 时，退回按存储地址 (target_key, target_seq) 查；
 *   - 两者都没有 → 地址仍合法（seq 不复用），只是正文不可读（已清理）。
 * 标题/状态是读任务时现算的展示字段，不落库（不存 body）。
 */
function targetLookupsOf(db, rows) {
  const tasks = new Map();
  const refs = new Map();
  if (!db) return { tasks, refs };
  const taskSql = `SELECT t.id, t.seq, t.status, t.body, t.deleted_at,
                     k.key AS topicKey, k.name AS topicName
                 FROM tasks t JOIN topics k ON k.id = t.topic_id`;
  for (const row of rows) {
    const meta = metaOf(row);
    if (baseKind(row) === 'task') {
      const taskId = Number(meta.taskId) || 0;
      const storedKey = String(row.targetKey || meta.topicKey || '');
      const storedSeq = Number(row.targetSeq ?? meta.seq) || 0;
      let info = null;
      if (taskId) info = db.get(`${taskSql} WHERE t.id = :id`, { id: taskId });
      if (!info && storedKey && storedSeq) {
        info = db.get(`${taskSql} WHERE k.key = :key AND t.seq = :seq`, { key: storedKey, seq: storedSeq });
      }
      if (info) {
        const topicKey = String(info.topicKey || '');
        const seq = Number(info.seq) || 0;
        tasks.set(row.id, {
          taskId: Number(info.id),
          seq,
          status: String(info.status || ''),
          deleted: !!info.deleted_at,
          topicKey,
          topicName: String(info.topicName || ''),
          title: taskTitleOf(info.body),
          address: `${topicKey}:${seq}`,
          storedAddress: `${storedKey}:${storedSeq}`,
          addressDrift: topicKey !== storedKey || seq !== storedSeq,
          purged: false,
          resolved: true,
        });
      } else {
        tasks.set(row.id, {
          taskId: 0,
          seq: storedSeq,
          status: '',
          deleted: false,
          topicKey: storedKey,
          topicName: '',
          title: '',
          address: `${storedKey}:${storedSeq}`,
          storedAddress: `${storedKey}:${storedSeq}`,
          addressDrift: false,
          purged: true,
          resolved: false,
        });
      }
    }
    if (baseKind(row) === 'ref') {
      const id = String(meta.refId || row.targetKey || '');
      if (!id || refs.has(id)) continue;
      const r = db.get('SELECT id, locator FROM refs WHERE id = :id', { id });
      if (r) refs.set(id, { refId: String(r.id), locator: String(r.locator || '') });
    }
  }
  return { tasks, refs };
}

const STATUS_LABEL = { pending: '待领取', claimed: '进行中', done: '已交付', cancelled: '已作废' };

/** 文件型资源的可达性：本机有盘上副本 → 绝对路径；否则给 fileId + 同步命令。 */
function fileStateOf(a, { localPath = '', storage = '', name = '', size } = {}) {
  const fileId = String(a.fileId || a.id || '');
  const path = String(localPath || '');
  const exists = !!path && existsSync(path);
  const syncCmd = `nx-kv file sync --ids ${fileId}`;
  const nextSize = size === undefined || size === null ? a.size : Number(size) || 0;
  return {
    ...a,
    fileId,
    name: name || a.name,
    size: nextSize,
    sizeText: sizeTextOf(nextSize),
    storage: storage || a.storage || 'cloud',
    localPath: exists ? path : '',
    exists,
    synced: exists,
    // 未同步时才给同步命令（模板用 {{#if syncCmd}} / {{#if needsSync}} 判断）
    syncCmd: exists ? '' : syncCmd,
    needsSync: !exists,
    cmd: exists ? '' : syncCmd,
    locator: exists ? path : `未同步（fileId ${fileId}）`,
    usage: exists
      ? `已在本机：直接读取 ${path}`
      : `尚未同步到本地（fileId ${fileId}）：先运行 ${syncCmd}，再读取本机副本`,
  };
}

function resourceOf(row, lookups = {}) {
  const kind = baseKind(row);
  const meta = metaOf(row);
  const role = String(row.role || 'inline');
  // attach/doc = 附件区；inline/reference = 正文（reference 是正文里的内部资源链接）
  const origin = role === 'attach' || role === 'doc' ? 'area' : 'inline';
  const isImage = kind === 'file' && !!(meta.isImage || isImageName(row.name, row.mime));
  const size = Number(row.size) || 0;
  const base = {
    id: String(row.id || ''),
    kind,
    kindLabel: kindLabelOf(kind, isImage),
    isImage,
    name: String(row.name || row.id || ''),
    size,
    sizeText: sizeTextOf(size),
    mime: String(row.mime || ''),
    role,
    position: Number(row.position) || 0,
    origin,
    originLabel: ORIGIN_LABEL[origin],
    // 兼容旧字段名（旧模板/旧 CLI 输出仍在读 area/areaLabel）
    area: origin,
    areaLabel: ORIGIN_LABEL[origin],
    storage: kind === 'file' ? String(row.storage || '') : kind === 'url' ? 'url' : 'internal',
    synced: kind !== 'file',
    localPath: '',
    targetKind: String(row.targetKind || ''),
    targetKey: String(row.targetKey || ''),
    targetSeq: row.targetSeq === null || row.targetSeq === undefined ? null : Number(row.targetSeq),
  };

  if (kind === 'file') {
    return fileStateOf({ ...base, fileId: base.id, target: '' }, { localPath: '', storage: row.storage });
  }

  if (kind === 'url') {
    const href = String(row.url || meta.url || '');
    return {
      ...base,
      url: href,
      href,
      host: hostOfUrl(href),
      target: '',
      needsSync: false,
      cmd: '',
      locator: href,
      usage: `外部链接，可直接抓取：${href}`,
    };
  }

  if (kind === 'task') {
    // task 型附件只存地址（target_key + target_seq）与本地 join 用的 taskId，
    // 正文/标题都在读取时从 tasks 表现算——任务改过内容，这里会跟着变。
    const info = (lookups.tasks && lookups.tasks.get(base.id)) || null;
    const storedKey = String(row.targetKey || meta.topicKey || '');
    const storedSeq = Number(row.targetSeq ?? meta.seq) || 0;
    const resolved = !!(info && info.resolved);
    const taskId = resolved ? Number(info.taskId) || 0 : 0;
    const seq = info && info.seq ? info.seq : storedSeq;
    const topicKey = info && info.topicKey ? info.topicKey : storedKey;
    const topicName = String((info && info.topicName) || '');
    const title = resolved ? String(info.title || `任务 #${seq}`) : '';
    const status = resolved ? String(info.status || '') : '';
    const statusLabel = resolved ? STATUS_LABEL[status] || status || '未知' : '已清理';
    const address = `${topicKey}:${seq}`;
    const storedAddress = `${storedKey}:${storedSeq}`;
    const addressDrift = !!(info && info.addressDrift);
    const showCmd = `nx-kv localtask show --id ${seq}${topicKey ? ` --key ${topicKey}` : ''}`;
    const place = topicName || topicKey;
    const name = resolved ? `#${seq} ${title}` : `#${storedSeq} 已清理任务`;
    const locator = `${name}${place ? ` · ${place}` : ''}`;
    return {
      ...base,
      // name 只作插入时的兜底；展示优先用实时标题（见 name 覆盖）
      name,
      taskId,
      topicKey,
      topicName,
      seq,
      title,
      status,
      statusLabel,
      deleted: !!(info && info.deleted),
      resolved,
      purged: !resolved,
      address,
      storedAddress,
      addressDrift,
      showCmd,
      target: locator,
      needsSync: false,
      cmd: resolved ? showCmd : '',
      locator,
      usage: resolved
        ? `这是任务引用而不是副本（地址 ${address}）：用 ${showCmd} 读取最新正文；当前状态 ${statusLabel}${info && info.deleted ? '（已软删）' : ''}${addressDrift ? `；任务已移动到 ${address}，原地址 ${storedAddress}` : ''}。任务正文被修改后，读到的是最新内容。`
        : `这是任务引用（地址 ${address}），但目标任务已被清理：地址仍可核验，正文不可读。`,
    };
  }

  // ref：文档库里的 md（locator 是 docs 树相对路径，或外部 md 的绝对路径）
  const info = lookups.refs && lookups.refs.get(String(meta.refId || row.targetKey || ''));
  const refId = String(meta.refId || row.targetKey || (info && info.refId) || '');
  const relPath = String((info && info.locator) || meta.locator || '');
  const title = String(row.name || (relPath ? relPath.split('/').pop() : '') || refId).replace(/\.md$/i, '');
  const readCmd = relPath
    ? `nx-kv docs get ${isAbsolute(relPath) ? `path:${relPath}` : `rel:${relPath}`}`
    : '';
  const locator = `${title}${relPath ? `（${relPath}）` : ''}`;
  return {
    ...base,
    refId,
    relPath,
    title,
    readCmd,
    target: locator,
    needsSync: false,
    cmd: readCmd,
    locator,
    usage: readCmd
      ? `这是文档库里的 md 文件：用 ${readCmd} 读取`
      : `这是文档库里的 md 文件（refId ${refId}）：先用 nx-kv docs list 定位路径，再 docs get 读取`,
  };
}

// 附件语法的唯一解析/生成实现（零依赖纯函数；todo 与面板共用同一份）。
// todo 在模块互依禁列里 → 动态 import（与 getloop/add 的 reposStore 同一惯例）。
let todoAttach = null;
async function todoAttachMod() {
  if (!todoAttach) todoAttach = await import('../../shared/attach.js');
  return todoAttach;
}

/**
 * 领取/查看时刻的附件标注：本机仓优先 → 云端镜像兜底 → 标注本地路径。
 *
 * @param {object|null} task 库存任务（normalizeTask 形状）
 * @param {object} [opts]
 * @param {boolean} [opts.sync=true] 是否允许为未命中的附件跑一次云端同步。
 *   预览（面板「预览 get 提示词」）传 false——**只读盘、不发网**：预览不该因为
 *   打开一次就悄悄下载一堆附件，也不该凭预览改变本机缓存状态。
 * @returns {Promise<null|{task:object, sync:object|null}>} null = 正文没有附件引用
 *   （调用方据此保持载荷原样）；sync 只在真的跑过云端同步时非 null。
 */
export async function annotateTaskDelivery(task, { sync: allowSync = true, topicKey = '' } = {}) {
  if (!task) return null;
  // schema v2：资源关系在任务入库时就写好了，交付侧只读 task_attach，不再解析正文。
  const rows = listTaskAttachmentsBySeq(getDb(), { topicKey: topicKey || task.key, seq: task.id });
  if (!rows.length) return null;

  // 本机附件仓：本地任务贴图的资源行（零云端依赖，命中即绝对路径）
  const store = await localStoreIndex();
  const cfg = await loadConfig();
  const gid = await resolveGroupId();

  // 不在本机仓的 file 行才考虑云端镜像；自动下载关（或全命中）就一次网都不碰
  const cloudIds = rows
    .filter((r) => r.kind === 'file' && !store.index.has(r.id))
    .map((r) => r.id);
  let sync = null;
  if (allowSync && cloudIds.length && cfg.autoSyncAttachments) {
    // 说明文字 → 本地文件名：`![季度报表.docx](id)` 落盘就叫「季度报表.docx」
    const names = {};
    for (const r of rows) if (cloudIds.includes(r.id) && r.name) names[r.id] = r.name;
    try {
      sync = await syncAttachments({ groupId: gid, ids: cloudIds, names, dir: cfg.attachmentsDir });
    } catch (e) {
      sync = { dir: '', downloaded: 0, skipped: 0, failures: [{ id: '(整体)', error: String(e && e.message ? e.message : e) }] };
    }
  }

  const mirror = await cloudMirrorIndex(gid, cfg.attachmentsDir);
  const lookups = targetLookupsOf(getDb(), rows);
  const attachments = rows.map((row) => {
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
  return { task: { ...task, attachments }, sync };
}

/**
 * 交付 instruction 里的〔附件〕段（纯函数）。
 *
 * 固定三段：总数（正文内嵌 X · 附件区 Y）/ 逐条清单 / 取用方式。
 * 输出由内置模板 DEFAULT_ATTACH_TEMPLATE 渲染，保证「配置模板」与「内置默认」
 * 走同一份 ctx、同一套口径；渲染失败时用最朴素的逐条文本兜底（fail-open）。
 *
 * 没有附件 → ''（整段消失）。
 */
export function attachmentInstruction(attachments, sync) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return '';
  try {
    return renderInstruction(DEFAULT_ATTACH_TEMPLATE, attachTemplateCtx(list, sync));
  } catch {
    const ctx = attachTemplateCtx(list, sync).attach;
    const lines = [
      `〔附件〕本任务包含 ${ctx.count} 个附件（正文内嵌 ${ctx.inlineCount} · 附件区 ${ctx.areaCount}）。`,
      '附件清单：',
      ...ctx.list.map((a) => `- [${a.originLabel}] ${a.kindLabel} ${a.name}${a.locator ? `：${a.locator}` : ''}`),
      '取用方式：',
      ...ctx.list.map((a) => `- ${a.name}：${a.usage}`),
    ];
    if (ctx.syncSummary) lines.push(`同步情况：${ctx.syncSummary.text}`);
    return lines.join('\n');
  }
}

function syncSummaryOf(sync) {
  if (!sync) return null;
  const failures = sync.failures || [];
  return {
    dir: sync.dir || '—',
    downloaded: Number(sync.downloaded) || 0,
    skipped: Number(sync.skipped) || 0,
    failureCount: failures.length,
    failures,
    text:
      `目录 ${sync.dir || '—'} · 下载 ${Number(sync.downloaded) || 0} · 跳过 ${Number(sync.skipped) || 0}` +
      (failures.length ? ` · 失败 ${failures.length}` : ''),
  };
}

/**
 * 单条附件的模板 ctx。
 *
 * 通用字段（所有类型都有）：kind / kindLabel / name / size / sizeText / mime /
 * storage / role / origin / originLabel / usage / cmd / locator / needsSync。
 * 类型专属子对象（只有对应类型才有）：
 *   file → { localPath, fileId, exists, syncCmd }
 *   url  → { href, host }
 *   task → { taskId, topicKey, topicName, seq, title, status, statusLabel,
 *            address, storedAddress, addressDrift, resolved, purged, deleted, showCmd }
 *   ref  → { refId, title, relPath, readCmd }
 * 旧模板兼容：平铺别名 localPath / fileId / urlText / href / taskId / title /
 * seq / showCmd / refId / relPath / readCmd / target / area / areaLabel。
 */
function ctxItemOf(a) {
  const kind = ['url', 'task', 'ref'].includes(a.kind) ? a.kind : 'file';
  const isImage = kind === 'file' && (a.isImage === undefined ? isImageName(a.name, a.mime) : !!a.isImage);
  const role = String(a.role || '');
  const origin =
    a.origin === 'area' || a.area === 'area' || (!a.origin && !a.area && (role === 'attach' || role === 'doc'))
      ? 'area'
      : 'inline';
  const size = Number(a.size) || 0;
  const item = {
    id: String(a.id || ''),
    kind,
    kindLabel: kindLabelOf(kind, isImage),
    isImage,
    name: String(a.name || ''),
    size,
    sizeText: a.sizeText || sizeTextOf(size),
    mime: String(a.mime || ''),
    storage: String(a.storage || ''),
    role: String(a.role || ''),
    origin,
    originLabel: a.originLabel || ORIGIN_LABEL[origin],
    usage: String(a.usage || ''),
    cmd: String(a.cmd || ''),
    locator: String(a.locator || ''),
    needsSync: !!a.needsSync,
    // 兼容旧字段
    area: origin,
    areaLabel: a.areaLabel || ORIGIN_LABEL[origin],
    target: String(a.target || ''),
    targetKind: String(a.targetKind || ''),
    targetKey: String(a.targetKey || ''),
    targetSeq: a.targetSeq === null || a.targetSeq === undefined ? null : Number(a.targetSeq),
  };

  if (kind === 'file') {
    const fileId = String(a.fileId || a.id || '');
    const localPath = String(a.localPath || '');
    const exists = a.exists === undefined ? !!localPath : !!a.exists;
    const syncCmd = String(a.syncCmd !== undefined ? a.syncCmd : exists ? '' : `nx-kv file sync --ids ${fileId}`);
    const file = { localPath, fileId, exists, syncCmd };
    const usage = String(a.usage || (exists
      ? `已在本机：直接读取 ${localPath}`
      : `尚未同步到本地（fileId ${fileId}）：先运行 ${syncCmd}，再读取本机副本`));
    const cmd = String(a.cmd !== undefined ? a.cmd : exists ? '' : syncCmd);
    return {
      ...item,
      ...file,
      path: localPath,
      file,
      usage,
      cmd,
      locator: String(a.locator || (exists ? localPath : `未同步（fileId ${fileId}）`)),
      needsSync: a.needsSync === undefined ? !exists : !!a.needsSync,
    };
  }

  if (kind === 'url') {
    const href = String(a.href || (typeof a.url === 'string' ? a.url : '') || '');
    const host = String(a.host || hostOfUrl(href));
    return {
      ...item,
      href,
      host,
      urlText: href,
      url: { href, host },
      usage: String(a.usage || `外部链接，可直接抓取：${href}`),
      locator: String(a.locator || href),
      needsSync: false,
    };
  }

  if (kind === 'task') {
    const seq = Number(a.seq) || Number(a.targetSeq) || 0;
    const topicKey = String(a.topicKey || a.targetKey || '');
    const showCmd = String(a.showCmd || `nx-kv localtask show --id ${seq}${topicKey ? ` --key ${topicKey}` : ''}`);
    const title = String(a.title || '');
    const task = {
      taskId: Number(a.taskId) || 0,
      topicKey,
      topicName: String(a.topicName || ''),
      seq,
      title,
      status: String(a.status || ''),
      statusLabel: String(a.statusLabel || STATUS_LABEL[a.status] || a.status || ''),
      address: String(a.address || `${topicKey}:${seq}`),
      storedAddress: String(a.storedAddress || `${topicKey}:${seq}`),
      addressDrift: !!a.addressDrift,
      resolved: a.resolved === undefined ? true : !!a.resolved,
      purged: !!a.purged,
      deleted: !!a.deleted,
      showCmd,
    };
    return {
      ...item,
      ...task,
      task,
      usage: String(a.usage || `这是任务引用而不是副本（地址 ${task.address}）：用 ${showCmd} 读取最新正文`),
      cmd: String(a.cmd !== undefined ? a.cmd : showCmd),
      locator: String(a.locator || `#${seq} ${title}${task.topicName || topicKey ? ` · ${task.topicName || topicKey}` : ''}`),
      needsSync: false,
    };
  }

  const refId = String(a.refId || a.targetKey || '');
  const relPath = String(a.relPath || a.locator || '');
  const title = String(a.title || String(a.name || '').replace(/\.md$/i, ''));
  const readCmd = String(a.readCmd || (relPath
    ? `nx-kv docs get ${isAbsolute(relPath) ? `path:${relPath}` : `rel:${relPath}`}`
    : ''));
  const ref = { refId, title, relPath, readCmd };
  return {
    ...item,
    ...ref,
    ref,
    usage: String(a.usage || (readCmd
      ? `这是文档库里的 md 文件：用 ${readCmd} 读取`
      : `这是文档库里的 md 文件（refId ${refId}）：先用 nx-kv docs list 定位路径，再 docs get 读取`)),
    cmd: String(a.cmd !== undefined ? a.cmd : readCmd),
    locator: String(a.locator || `${title}${relPath ? `（${relPath}）` : ''}`),
    needsSync: false,
  };
}

/**
 * 附件模板 ctx（附件段与系统区块共用）。
 * 新语法：{{attach.count}}、`{{#each attach.list}}`（按类型分支的结构化元素）、
 * `{{#if attach.syncSummary}}`（本次跑过云端同步才出现）。
 * 旧写法 `{{#attach}}` / `{{attach.sync}}` / `{{attach.syncText}}` 已废弃，不再提供别名。
 */
export function attachTemplateCtx(attachments, sync) {
  const list = Array.isArray(attachments) ? attachments : [];
  const items = list.map(ctxItemOf);
  return {
    attach: {
      count: items.length,
      // 两类来源分开计数：正文内嵌 vs 附件区（关系表里 role=attach/doc 的行）
      inlineCount: items.filter((a) => a.origin !== 'area').length,
      areaCount: items.filter((a) => a.origin === 'area').length,
      hasInline: items.some((a) => a.origin !== 'area'),
      hasArea: items.some((a) => a.origin === 'area'),
      needsSyncCount: items.filter((a) => a.needsSync).length,
      // 结构化数组：模板用循环组织清单，不再由服务端拼多行字符串。
      list: items,
      // 同步汇总只描述「这一次批量同步」；单条附件可达性看它自己的 file.localPath / file.exists
      syncSummary: syncSummaryOf(sync),
    },
  };
}

/**
 * 〔附件〕段渲染（任务 #82 模板化；v4 起走 Handlebars）：
 *   - 配置了模板（attachment 区块当前生效模板）→ 模板渲染。ctx：{{task.id}}/{{task.text}}、
 *     {{attach.count}} / {{attach.inlineCount}} / {{attach.areaCount}}、
 *     `{{#each attach.list}}`（按 kind 分支的结构化清单，含各类型子对象）、
 *     `{{#if attach.syncSummary}}`（本次批量同步汇总）；
 *   - 旧占位符 / 旧闸门**不再兼容**（保存校验会拒绝旧语法，运行期回退内置默认）；
 *   - 空/未配置 → 内置默认（attachmentInstruction，与默认模板同一份 ctx）；
 *   - 渲染失败 → 回退内置默认（fail-open：附件路径必须到达 agent）。
 */
export function attachInstructionOf(tpl, attachments, sync, task) {
  const list = Array.isArray(attachments) ? attachments : [];
  const t = String(tpl || '').trim();
  if (!t || !list.length) return attachmentInstruction(list, sync);
  try {
    return renderInstruction(t, {
      task: task ? { id: task.id, text: String(task.text || '') } : null,
      ...attachTemplateCtx(list, sync),
    });
  } catch {
    return attachmentInstruction(list, sync);
  }
}

/**
 * 给任务挂附件（CLI `localtask attach`）。两种落法：
 *
 *   默认（嵌入正文）：资源写库 + 以 markdown 追加到正文末尾，关系 role=inline；
 *   `--no-embed`   ：只写 attachments + task_attach（role=attach），**不动正文**——
 *                    附件区（面板）与 `localtask attachments` 都能列出。
 *
 * 来源四选一：
 *   --path <本机文件>  落本机附件仓（零云端）
 *   --fileId <id>      引用已有资源（本机仓 / 云端 id 都认）
 *   --url <链接>       外部 URL（kind=url）
 *   --task <seq>       同主题下的另一条任务（kind=task，nxkv://task/<id>）
 *   --ref <路径|id>    文档库里的 ref（kind=ref，nxkv://ref/<refId>）
 */
export async function attachToTask({
  id, cwd, key, path, fileId, name, kind, url, task, ref, note, noEmbed,
} = {}) {
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
    let buffer;
    try {
      buffer = await readFile(abs);
    } catch (e) {
      throw badInput(`读不到文件: ${abs}（${(e && e.code) || e.message}）`);
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
      markdown = embedMarkdown({ name: displayName || fid, id: fid, kind: resolvedKind });
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
    markdown = embedMarkdown({ name: displayName || fid, id: fid, kind: resolvedKind });
  } else if (url) {
    const u = String(url).trim();
    if (!/^https?:\/\//i.test(u)) throw badInput(`--url 需要 http(s) 绝对地址: ${u}`);
    attachmentId = tx(
      (conn) => ensureUrlAttachment(conn, { url: u, name: displayName }),
      { db, mode: 'IMMEDIATE' }
    );
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
    );
    resolvedKind = 'task';
    markdown = `[${displayName || `任务 #${seq}`}](nxkv://task/${Number(row.id)})`;
  } else if (ref) {
    const refId = resolveRefId(db, ref);
    if (!refId) throw badInput(`找不到文档: ${ref}（可先用 docs list 看已有路径）`);
    attachmentId = tx(
      (conn) => ensureRefAttachment(conn, { refId, name: displayName }),
      { db, mode: 'IMMEDIATE' }
    );
    resolvedKind = 'ref';
    markdown = `[${displayName || String(ref).split('/').pop()}](nxkv://ref/${refId})`;
  }

  if (!attachmentId) {
    throw badInput(
      '需要 --path <本机文件>、--fileId <已有附件>、--url <链接>、--task <编号> 或 --ref <文档> 之一'
    );
  }

  // 关系表是权威：先落边（正文同步不会把 attach 降级），正文只是 inline 的呈现。
  // --no-embed 不写正文，也就不该把嵌入片段还给调用方（否则 CLI 会打出误导性的「嵌入:」）。
  if (noEmbed) markdown = '';
  const role = noEmbed ? 'attach' : 'inline';
  if (noEmbed) {
    tx(
      (conn) => {
        const gid = taskGlobalIdOf(conn, { topicKey, seq: cur.id });
        if (!gid) throw badInput(`任务 #${cur.id} 已不存在，无法挂附件`);
        linkAttachment(conn, { host: 'task', hostId: gid, attachmentId, role: 'attach', note });
      },
      { db, mode: 'IMMEDIATE' }
    );
  }

  let r = { key: cur.key, name: topicNameOf(cur), task: cur };
  if (!noEmbed && markdown) {
    // 独立成行追加（与编辑器的插入行为一致：整行图片嵌入渲染为 <img>）
    const text = cur.text ? `${cur.text}\n${markdown}` : markdown;
    r = await service.updateTask({ id: cur.id, cwd, key, text });
  }

  return {
    status: 'ok',
    key: r.key,
    name: r.name,
    fileId: attachmentId,
    kind: resolvedKind,
    markdown,
    area: noEmbed ? 'area' : 'inline',
    role,
    task: r.task,
  };
}

// 任务对象在 service 层有 name/key 等；拿不到时给空串，渲染层会退化成 id。
function topicNameOf(t) {
  return String((t && (t.name || t.topicName)) || '');
}

/** 关系表挂的是全局 tasks.id，而 CLI 只有 (topicKey, seq)——统一在这里换算。 */
function taskGlobalIdOf(conn, { topicKey, seq }) {
  const row = conn.get(
    `SELECT t.id FROM tasks t JOIN topics k ON k.id = t.topic_id
      WHERE k.key = :key AND t.seq = :seq AND t.deleted_at IS NULL`,
    { key: String(topicKey || ''), seq: Number(seq) }
  );
  return row ? Number(row.id) : 0;
}

/**
 * 列出某条任务引用的附件（CLI `localtask attachments`）：不依赖自动下载开关，
 * 本机仓 → 云端镜像逐个标注（agent 据此决定直接读本地还是先 sync）。
 */
export async function listTaskAttachments({ id, cwd, key } = {}) {
  const cur = await service.getTask({ id, cwd, key });
  const cfg = await loadConfig();
  const gid = await resolveGroupId();
  const store = await localStoreIndex();
  const mirror = await cloudMirrorIndex(gid, cfg.attachmentsDir);
  const rows = listTaskAttachmentsBySeq(getDb(), { topicKey: cur.key || key, seq: cur.id });
  const lookups = targetLookupsOf(getDb(), rows);

  const attachments = rows.map((row) => {
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

/**
 * 解除任务与一条资源的关系（CLI `localtask detach`）。
 *
 *   --only-unlink（默认）：只删 task_attach 边，资源与字节保留（可能进孤儿池）；
 *   --purge            ：先解除关系，再在「没有任何任务/文档还在用」时删资源行与字节。
 *
 * 关系表是权威：解除后这条资源不再出现在任务附件清单里，但正文里若仍有内嵌，
 * 下次正文同步会把 inline 边重新写回来（这是正文明示的引用，不算丢）。
 */
export async function detachTaskAttachment({ id, cwd, key, attachment, purge } = {}) {
  const cur = await service.getTask({ id, cwd, key });
  const topicKey = cur.key || key || '';
  const attId = String(attachment || '').trim();
  if (!attId) throw badInput('需要 --attachment <资源 id>（见 localtask attachments 输出）');
  const db = getDb();
  const cfg = await loadConfig();
  const store = await localStoreIndex();
  let deleted = 0;
  let purgeResult = null;
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
