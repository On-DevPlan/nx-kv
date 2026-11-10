// tasktool/attach-resource.js —— 附件的「资源视图模型」：关系表行 → 展示/取用信息。
//
// 资源类型只有四种（用户口径）：file（含图片）/ url / task / ref。
// 旧数据里 kind='image' 或没有 kind 的一律按 file 处理（向后兼容）。
//
// 视图模型只依赖 core 与 shared（纯函数 + 关系表查询），不碰同步与云端：
// file 型资源的可达性（本机副本绝对路径 vs fileId + 同步命令）由 fileStateOf 给出，
// 调用方（attach.js 的编排层）负责把本机仓 / 云端镜像的命中结果喂进来。
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { isImageName } from '../../core/fileapi.js';
import { stripFrontmatter } from '../../shared/frontmatter.js';

const KIND_LABEL = { file: '附件', url: '链接', task: '任务', ref: '文档' };
const IMAGE_LABEL = '图片';
export const ORIGIN_LABEL = { inline: '正文内嵌', area: '附件区' };
export const STATUS_LABEL = { pending: '待领取', claimed: '进行中', done: '已交付', cancelled: '已作废' };
// 「文档资料」绑定进原文的单篇上限（#162）：文档全文跟着每轮交付走，不能把整本书塞进提示词；
// 截断后仍给 docs get 命令，agent 需要全文时自己取。
export const MAX_INLINE_DOC_CHARS = 20000;

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

export function kindLabelOf(kind, isImage) {
  if (kind === 'file') return isImage ? IMAGE_LABEL : KIND_LABEL.file;
  return KIND_LABEL[kind] || KIND_LABEL.file;
}

export function sizeTextOf(n) {
  const v = Math.max(0, Number(n) || 0);
  if (!v) return '';
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
}

export function hostOfUrl(href) {
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
export function targetLookupsOf(db, rows) {
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

/** 文件型资源的可达性：本机有盘上副本 → 绝对路径；否则给 fileId + 同步命令。 */
export function fileStateOf(a, { localPath = '', storage = '', name = '', size } = {}) {
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

export function resourceOf(row, lookups = {}) {
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
    // 边上的说明（desc，#162）：attach --note 的落点；交付清单按它渲染
    note: String(row.note || ''),
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
