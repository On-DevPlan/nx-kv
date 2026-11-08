// 统一资源表 attachments 的唯一读写实现（schema v2）。
//
// 这里只做「资源是什么 / 归谁所有」两件事，不做业务编排：
//   · resources：file（本机或云端字节）、url（外部链接）、task（topic 内任务）、ref（文档）；
//   · relations：task_attach / ref_attach 的整组重写与孤儿查询；
//   · 正文解析：`![名](fileId)` / `[名](fileId)`、`nxkv://task/<id>`、`nxkv://ref/<id>`、
//     `[名](http(s)://…)` 都落库。用户可见的 markdown 写法不变。
//
// 为什么放在 core：localatt/attachstore（字节存储）与 docs/localtask 仓储（关系）
// 都要用它，放模块层会造成「核心存储依赖业务模块」的倒挂。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
// 不 import fileapi：它经 config → db/index → bootstrap → migrator 会绕回本模块。
// 这里只需要「按扩展名补一个够用的 MIME」，真实 MIME 由上传/同步路径写入。
const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8', csv: 'text/csv; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
function mimeFromName(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || '';
}

/** 与 shared/attach.js 同一口径（core 不能反向 import shared）。 */
const FILE_ID_RE = /^[0-9a-fA-F]{16,}(\.[A-Za-z0-9]{1,8})?$/;
const MD_LINK_RE = /!?\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g;
const NXKV_TASK_RE = /^nxkv:\/\/task\/(\d+)$/i;
const NXKV_REF_RE = /^nxkv:\/\/ref\/([A-Za-z0-9_-]+)$/i;

const sha1 = (s) => createHash('sha1').update(String(s), 'utf8').digest('hex');

export function isFileId(value) {
  return FILE_ID_RE.test(String(value ?? '').trim());
}

/** refs.locator → ref_id（与 import-json 的 refIdOf 同一公式；路径统一 POSIX）。 */
export function refIdFor(locator) {
  return 'ref_' + sha1(String(locator ?? '').replace(/\\/g, '/')).slice(0, 16);
}

export function urlAttachmentId(url) {
  return 'att_url_' + sha1(String(url || '').trim().toLowerCase()).slice(0, 16);
}

export function taskAttachmentId(topicKey, seq) {
  return 'att_task_' + sha1(`${String(topicKey || '')}:${Number(seq) || 0}`).slice(0, 16);
}

export function refAttachmentId(refId) {
  return 'att_ref_' + sha1(String(refId || '')).slice(0, 16);
}

function metaOf(row) {
  try {
    const v = JSON.parse(String((row && row.meta) || '{}'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * 正文 → 资源引用清单（顺序即 position）。只认：
 *   file：markdown 目标就是 fileId；
 *   task：nxkv://task/<全局 tasks.id>；
 *   ref：nxkv://ref/<ref_id>；
 *   url：markdown 目标是 http(s) 绝对地址。
 * 其它链接（相对路径、锚点、普通 wiki 双链）不落资源表。
 */
export function parseAttachmentRefs(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text ?? '').matchAll(MD_LINK_RE)) {
    const name = String(m[1] || '').trim();
    const target = String(m[2] || '').trim();
    const isImage = m[0].startsWith('![');
    let ref = null;
    if (isFileId(target)) {
      ref = { kind: 'file', id: target, name: name || target, isImage };
    } else {
      const task = target.match(NXKV_TASK_RE);
      const doc = target.match(NXKV_REF_RE);
      if (task) ref = { kind: 'task', targetTaskId: Number(task[1]), name: name || `任务 ${task[1]}` };
      else if (doc) ref = { kind: 'ref', targetRefId: doc[1], name: name || doc[1] };
      else if (/^https?:\/\//i.test(target)) ref = { kind: 'url', url: target, name: name || target };
    }
    if (!ref) continue;
    // 同一资源出现多次只保留第一条（关系表一资源一 role 一行，position 取首次出现）
    const key = ref.id || (ref.kind === 'task' ? `task:${ref.targetTaskId}` : '')
      || (ref.kind === 'ref' ? `ref:${ref.targetRefId}` : '')
      || (ref.kind === 'url' ? `url:${ref.url.toLowerCase()}` : '');
    if (seen.has(key)) continue;
    seen.add(key);
    ref.position = out.length;
    ref.role = ref.kind === 'task' || ref.kind === 'ref' ? 'reference' : 'inline';
    out.push(ref);
  }
  return out;
}

/** 插入/更新一个本机或云端文件资源（id = fileId）。 */
export function upsertFileAttachment(conn, {
  id,
  name = '',
  localPath = '',
  mime = '',
  size = 0,
  hash = '',
  storage = '',
  groupId = 0,
  meta = {},
  atMs = Date.now(),
} = {}) {
  const fid = String(id || '').trim();
  if (!isFileId(fid)) throw new Error(`非法 fileId: ${fid}`);
  const cur = conn.get('SELECT * FROM attachments WHERE id = :id', { id: fid });
  const mergedMeta = { ...(cur ? metaOf(cur) : {}), ...(meta || {}) };
  if (!cur) {
    conn.run(
      `INSERT INTO attachments
         (id, kind, name, local_path, url, mime, size, hash, storage, group_id,
          target_kind, target_key, target_seq, dedupe_key, meta, deleted_at, created_at, updated_at)
       VALUES (:id, 'file', :name, :localPath, '', :mime, :size, :hash, :storage, :groupId,
               '', '', NULL, '', :meta, NULL, :at, :at)`,
      {
        id: fid,
        name: String(name || ''),
        localPath: String(localPath || ''),
        mime: String(mime || ''),
        size: Math.max(0, Number(size) || 0),
        hash: String(hash || ''),
        storage: String(storage || ''),
        groupId: Number(groupId) || 0,
        meta: JSON.stringify(mergedMeta),
        at: atMs,
      }
    );
    return fid;
  }
  conn.run(
    `UPDATE attachments SET
       name = :name,
       local_path = :localPath,
       mime = :mime,
       size = :size,
       hash = :hash,
       storage = :storage,
       group_id = :groupId,
       meta = :meta,
       deleted_at = NULL,
       updated_at = :at
     WHERE id = :id`,
    {
      id: fid,
      // 空值不覆盖已有真实值（正文先落占位、上传后补元数据的场景）
      name: String(name || cur.name || ''),
      localPath: String(localPath || cur.local_path || ''),
      mime: String(mime || cur.mime || ''),
      size: Math.max(0, Number(size) || Number(cur.size) || 0),
      hash: String(hash || cur.hash || ''),
      storage: String(storage || cur.storage || ''),
      groupId: Number(groupId) || Number(cur.group_id) || 0,
      meta: JSON.stringify(mergedMeta),
      at: atMs,
    }
  );
  return fid;
}

function upsertDeduped(conn, {
  id, kind, name, dedupeKey, url = '', targetKind = '', targetKey = '', targetSeq = null,
  meta = {}, atMs = Date.now(),
}) {
  const row = conn.get(
    'SELECT * FROM attachments WHERE dedupe_key = :key AND deleted_at IS NULL',
    { key: dedupeKey }
  );
  if (row) {
    // 存量脏数据自愈：旧行把正文写进 name（多行/超长）时，后续 attach 用新值覆盖。
    const dirtyName = String(row.name || '').includes('\n') || String(row.name || '').length > 200;
    if (name && (!row.name || dirtyName)) {
      conn.run('UPDATE attachments SET name = :name, updated_at = :at WHERE id = :id', {
        id: row.id, name, at: atMs,
      });
    }
    return row.id;
  }
  conn.run(
    `INSERT INTO attachments
       (id, kind, name, local_path, url, mime, size, hash, storage, group_id,
        target_kind, target_key, target_seq, dedupe_key, meta, deleted_at, created_at, updated_at)
     VALUES (:id, :kind, :name, '', :url, '', 0, '', '', 0,
             :targetKind, :targetKey, :targetSeq, :dedupeKey, :meta, NULL, :at, :at)`,
    {
      id,
      kind,
      name: String(name || ''),
      url: String(url || ''),
      targetKind,
      targetKey: String(targetKey || ''),
      targetSeq,
      dedupeKey,
      meta: JSON.stringify(meta || {}),
      at: atMs,
    }
  );
  return id;
}

export function ensureUrlAttachment(conn, { url, name = '', atMs = Date.now() } = {}) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return null;
  return upsertDeduped(conn, {
    id: urlAttachmentId(u),
    kind: 'url',
    name: name || u,
    dedupeKey: 'url:' + u.toLowerCase(),
    url: u,
    atMs,
  });
}

/**
 * 去掉正文头部的 frontmatter（与 shared/frontmatter.js 的 stripFrontmatter 同口径）。
 * core 是最底层，不能反向 import shared，所以这里保留一份最小实现。
 */
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FM_KV_RE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;
function stripFrontmatter(src) {
  return String(src ?? '').replace(FM_RE, (block, inner) => {
    const kv = String(inner || '').split(/\r?\n/).some((l) => FM_KV_RE.test(l));
    return kv ? '' : block;
  });
}

/** 任务标题 = 正文（去 frontmatter）首个非空行，去 # 前缀，截 80 字。 */
function taskTitleOf(body) {
  const text = String(stripFrontmatter(String(body || ''))).trim();
  const first = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  return first.replace(/^#+\s*/, '').trim().slice(0, 80);
}

/**
 * task 型附件的展示名：只允许「#seq 标题」这种短标签，**绝不允许正文**。
 * 调用方（CLI/面板）可能把整段正文当 name 传进来，这里统一兜底：
 *   - 单行且 ≤80 字 → 视为用户给的别名，去 #seq/# 前缀后保留；
 *   - 多行或超长 → 判定为正文，改用任务实时标题。
 */
function taskAttachmentName(name, seq, title) {
  const raw = String(name || '').trim();
  const firstLine = raw.split(/\r?\n/)[0].trim();
  const alias = firstLine.replace(/^#\s*\d+\s*/u, '').replace(/^#+\s*/u, '').trim();
  const bodyLike = raw.includes('\n') || raw.length > 80 || !alias;
  const label = bodyLike ? title || `任务 #${seq}` : alias.slice(0, 80);
  return `#${seq} ${label}`.trim();
}

export function ensureTaskAttachment(conn, { taskId, atMs = Date.now(), name = '' } = {}) {
  const row = conn.get(
    `SELECT t.id AS taskId, t.seq, t.body, k.key AS topicKey
       FROM tasks t JOIN topics k ON k.id = t.topic_id
      WHERE t.id = :id`,
    { id: Number(taskId) }
  );
  if (!row) return null;
  const seq = Number(row.seq) || 0;
  return upsertDeduped(conn, {
    id: taskAttachmentId(row.topicKey, seq),
    kind: 'task',
    name: taskAttachmentName(name, seq, taskTitleOf(row.body)),
    dedupeKey: `task:${row.topicKey}:${seq}`,
    targetKind: 'task',
    targetKey: String(row.topicKey),
    targetSeq: seq,
    meta: { taskId: Number(row.taskId), topicKey: String(row.topicKey), seq },
    atMs,
  });
}

export function ensureRefAttachment(conn, { refId, atMs = Date.now(), name = '' } = {}) {
  const row = conn.get('SELECT id, locator FROM refs WHERE id = :id', { id: String(refId || '') });
  if (!row) return null;
  return upsertDeduped(conn, {
    id: refAttachmentId(row.id),
    kind: 'ref',
    name: name || String(row.locator || row.id).split('/').pop(),
    dedupeKey: `ref:${row.id}`,
    targetKind: 'ref',
    targetKey: String(row.id),
    meta: { refId: String(row.id), locator: String(row.locator || '') },
    atMs,
  });
}

/** 一条正文引用 → 资源 id（无法解析到真实目标的返回 null）。 */
export function ensureAttachment(conn, ref, { atMs = Date.now() } = {}) {
  if (!ref) return null;
  if (ref.kind === 'file') {
    return upsertFileAttachment(conn, {
      id: ref.id,
      name: ref.name,
      mime: mimeFromName(ref.name),
      storage: '',
      meta: { isImage: !!ref.isImage, source: 'body' },
      atMs,
    });
  }
  if (ref.kind === 'url') return ensureUrlAttachment(conn, { url: ref.url, name: ref.name, atMs });
  if (ref.kind === 'task') {
    return ensureTaskAttachment(conn, { taskId: ref.targetTaskId, name: ref.name, atMs });
  }
  if (ref.kind === 'ref') return ensureRefAttachment(conn, { refId: ref.targetRefId, name: ref.name, atMs });
  return null;
}

// ── 关系表写入（任务/文档共用一套语义） ────────────────────────────────
//
// role 是**边的语义**，不是资源的属性；同一资源对同一宿主只有一行（PK）。
// 冲突时的处置规则（2026-11-08 附件区改造）：
//   已有 role 优先级 >= 新 role → 保留已有（正文同步不能把用户显式挂的东西降级）；
//   否则升级（正文里出现的资源后来被显式挂载 → attach，删正文行也不会丢）；
//   同 role 重复写只刷新 position（正文改了，顺序跟着改）。
// 优先级 attach > doc > reference > inline：越"显式"越不容易被正文覆盖。
const ROLE_PRIORITY = { inline: 0, reference: 1, doc: 2, attach: 3 };
const HOST_TABLE = {
  task: { table: 'task_attach', col: 'task_id', roles: ['inline', 'attach', 'doc'] },
  ref: { table: 'ref_attach', col: 'ref_id', roles: ['inline', 'attach', 'reference'] },
};

function hostOf(host) {
  const h = HOST_TABLE[String(host || '')];
  if (!h) throw new Error(`未知附件宿主: ${host}（应为 task 或 ref）`);
  return h;
}

/**
 * 写一条宿主 ↔ 资源的关系（upsert，带 role 优先级）。
 * @returns {string} 实际落库的 role
 */
export function linkAttachment(conn, {
  host, hostId, attachmentId, role = 'attach', position, note = '', atMs = Date.now(),
} = {}) {
  const h = hostOf(host);
  const hostVal = host === 'task' ? Number(hostId) : String(hostId || '');
  const att = String(attachmentId || '');
  if (!att) throw new Error('linkAttachment 需要 attachmentId');
  if (!h.roles.includes(role)) throw new Error(`非法 role: ${role}（${host} 只允许 ${h.roles.join('/')}）`);
  const idOk = host === 'task' ? Number.isFinite(hostVal) : !!hostVal;
  if (!idOk) throw new Error(`linkAttachment 需要有效的 ${host} 宿主 id`);

  const cur = conn.get(
    `SELECT role, position FROM ${h.table} WHERE ${h.col} = :host AND attachment_id = :att`,
    { host: hostVal, att }
  );
  if (cur) {
    const curRank = ROLE_PRIORITY[cur.role] ?? 0;
    const newRank = ROLE_PRIORITY[role] ?? 0;
    if (curRank > newRank) return cur.role; // 显式边不被正文降级
    if (curRank === newRank) {
      const pos = position === undefined ? cur.position : position;
      conn.run(
        `UPDATE ${h.table} SET position = :pos WHERE ${h.col} = :host AND attachment_id = :att`,
        { pos: Number(pos) || 0, host: hostVal, att }
      );
      return cur.role;
    }
    conn.run(
      `UPDATE ${h.table} SET role = :role, position = :pos, note = :note
        WHERE ${h.col} = :host AND attachment_id = :att`,
      { role, pos: Number(position) || 0, note: String(note || ''), host: hostVal, att }
    );
    return role;
  }
  let pos = position;
  if (pos === undefined) {
    // 附件区（非 inline）默认追加到末尾；inline 的 position 由正文解析给出
    const row = conn.get(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM ${h.table}
        WHERE ${h.col} = :host AND role <> 'inline'`,
      { host: hostVal }
    );
    pos = Number((row && row.next) || 0);
  }
  conn.run(
    `INSERT INTO ${h.table} (${h.col}, attachment_id, role, position, note, created_at)
     VALUES (:host, :att, :role, :pos, :note, :at)`,
    { host: hostVal, att, role, pos: Number(pos) || 0, note: String(note || ''), at: atMs }
  );
  return role;
}

/** 解除一条关系（只删边，不删资源字节）。返回是否真的删掉。 */
export function unlinkAttachment(conn, { host, hostId, attachmentId } = {}) {
  const h = hostOf(host);
  const hostVal = host === 'task' ? Number(hostId) : String(hostId || '');
  const att = String(attachmentId || '');
  const r = conn.run(
    `DELETE FROM ${h.table} WHERE ${h.col} = :host AND attachment_id = :att`,
    { host: hostVal, att }
  );
  return Number(r.changes) || 0;
}

/**
 * 删除资源行（可选连字节一起删）。仍被任何任务/文档引用时拒绝——关系表是权威，
 * 「解除关系」和「删资源」是两步，不能因为一次 detach --purge 误删别人在用的文件。
 * @returns {{removed:boolean, reason?:string, attachment?:object}}
 */
export function deleteAttachment(conn, id, { attachmentsRoot, purgeBytes = true } = {}) {
  const row = getAttachment(conn, id);
  if (!row) return { removed: false, reason: 'not-found' };
  const still = conn.get(
    `SELECT 1 AS x FROM task_attach WHERE attachment_id = :id
     UNION ALL SELECT 1 FROM ref_attach WHERE attachment_id = :id LIMIT 1`,
    { id: row.id }
  );
  if (still) return { removed: false, reason: 'in-use', attachment: row };
  let bytesRemoved = false;
  if (purgeBytes && row.kind === 'file' && row.localPath && within(attachmentsRoot, row.localPath)) {
    try {
      if (existsSync(row.localPath)) {
        unlinkSync(row.localPath);
        bytesRemoved = true;
      }
    } catch {
      return { removed: false, reason: 'file-locked', attachment: row };
    }
  }
  conn.run('DELETE FROM attachments WHERE id = :id', { id: row.id });
  return { removed: true, bytesRemoved, attachment: row };
}

/** 任务正文里的资源整组重写（只动 inline 边，显式 attach/doc 保留）。 */
export function syncTaskAttachments(conn, { taskId, text, atMs = Date.now() } = {}) {
  const id = Number(taskId);
  if (!Number.isFinite(id)) return 0;
  const refs = parseAttachmentRefs(text);
  const ids = [];
  for (const r of refs) {
    const att = ensureAttachment(conn, r, { atMs });
    if (att && !ids.includes(att)) ids.push(att);
  }
  conn.run("DELETE FROM task_attach WHERE task_id = :id AND role = 'inline'", { id });
  ids.forEach((att, pos) => {
    linkAttachment(conn, { host: 'task', hostId: id, attachmentId: att, role: 'inline', position: pos, atMs });
  });
  return ids.length;
}

/** 文档正文里的资源整组重写（inline + reference 边；显式 attach 保留）。 */
export function syncRefAttachments(conn, { refId, text, atMs = Date.now() } = {}) {
  const id = String(refId || '');
  if (!id) return 0;
  const refs = parseAttachmentRefs(text);
  const rows = [];
  for (const r of refs) {
    const att = ensureAttachment(conn, r, { atMs });
    if (att && !rows.some((x) => x.id === att)) rows.push({ id: att, role: r.role });
  }
  conn.run("DELETE FROM ref_attach WHERE ref_id = :id AND role IN ('inline', 'reference')", { id });
  rows.forEach((x, pos) => {
    linkAttachment(conn, { host: 'ref', hostId: id, attachmentId: x.id, role: x.role, position: pos, atMs });
  });
  return rows.length;
}

/**
 * 把一个「文档标识」解析成 refs.id：先按 id，再按 locator（原样 / 反斜杠归一），
 * 都没有返回 null。CLI `--ref` 与面板选择器共用这一条，避免各自猜地址语法。
 */
export function resolveRefId(conn, input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const byId = conn.get('SELECT id FROM refs WHERE id = :id AND deleted_at IS NULL', { id: raw });
  if (byId) return byId.id;
  const loc = raw.replace(/\\/g, '/');
  const byLoc = conn.get(
    'SELECT id FROM refs WHERE locator = :loc AND deleted_at IS NULL', { loc }
  );
  if (byLoc) return byLoc.id;
  const derived = refIdFor(loc);
  const byDerived = conn.get('SELECT id FROM refs WHERE id = :id AND deleted_at IS NULL', { id: derived });
  return byDerived ? byDerived.id : null;
}

/** 确保 refs 行存在（文档保存 / 索引重建共用；已有行不重置 state）。 */
export function ensureDocRef(conn, { locator, atMs = Date.now() } = {}) {
  const loc = String(locator || '').trim().replace(/\\/g, '/');
  if (!loc) return null;
  const id = refIdFor(loc);
  conn.run(
    `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
     VALUES (:id, 'md', :locator, 'orphan', 0, NULL, :at, :at)
     ON CONFLICT(id) DO UPDATE SET type = 'md', locator = excluded.locator, updated_at = excluded.updated_at`,
    { id, locator: loc, at: atMs }
  );
  return id;
}

/** 文档删除：refs 行消失，ref_attach / ref_bindings 随之 CASCADE。 */
export function forgetDocRef(conn, locator) {
  const loc = String(locator || '').trim().replace(/\\/g, '/');
  if (!loc) return 0;
  const r = conn.run('DELETE FROM refs WHERE id = :id', { id: refIdFor(loc) });
  return Number(r.changes) || 0;
}

/** 全量重扫任务正文（迁移与导入后用；幂等）。 */
export function syncTaskAttachmentIndex(conn, { atMs = Date.now() } = {}) {
  const rows = conn.all('SELECT id, body FROM tasks ORDER BY id');
  let n = 0;
  for (const row of rows) n += syncTaskAttachments(conn, { taskId: row.id, text: row.body, atMs });
  return n;
}

/** 全量重扫 docs 自有树 + 外部 .md（迁移与索引重建用；幂等）。 */
export function syncDocAttachmentIndex(conn, { docsRoot, atMs = Date.now() } = {}) {
  const root = String(docsRoot || '');
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && /\.md$/i.test(e.name)) files.push(abs);
    }
  };
  if (root && existsSync(root)) walk(root);
  let n = 0;
  const covered = new Set();
  for (const abs of files.sort()) {
    const locator = relative(root, abs).replace(/\\/g, '/');
    covered.add(resolve(abs).replace(/\\/g, '/').toLowerCase());
    let text = '';
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const refId = ensureDocRef(conn, { locator, atMs });
    n += syncRefAttachments(conn, { refId, text, atMs });
  }
  // 外部 .md（refs.locator 是绝对路径）：不在 docs 树里，但同样是文档库的一行。
  // 迁移必须把它们的正文引用也落库，否则「存量文档的图片」只有正文 fileId 字符串。
  for (const row of conn.all("SELECT id, locator FROM refs WHERE type = 'md'")) {
    const loc = String(row.locator || '');
    if (!isAbsolute(loc) || !existsSync(loc)) continue;
    if (covered.has(resolve(loc).replace(/\\/g, '/').toLowerCase())) continue;
    if (!/\.md$/i.test(loc)) continue;
    let text = '';
    try {
      text = readFileSync(loc, 'utf8');
    } catch {
      continue;
    }
    n += syncRefAttachments(conn, { refId: row.id, text, atMs });
  }
  return n;
}

const ATT_SELECT = `SELECT id, kind, name, local_path, url, mime, size, hash, storage, group_id,
       target_kind, target_key, target_seq, meta, deleted_at, created_at, updated_at
  FROM attachments`;

function rowView(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    localPath: row.local_path,
    url: row.url,
    mime: row.mime,
    size: Number(row.size) || 0,
    hash: row.hash,
    storage: row.storage,
    groupId: Number(row.group_id) || 0,
    targetKind: row.target_kind,
    targetKey: row.target_key,
    targetSeq: row.target_seq === null || row.target_seq === undefined ? null : Number(row.target_seq),
    meta: metaOf(row),
    deletedAt: row.deleted_at,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export function getAttachment(conn, id) {
  const row = conn.get(`${ATT_SELECT} WHERE id = :id`, { id: String(id || '') });
  return row ? rowView(row) : null;
}

export function listTaskAttachments(conn, taskId) {
  return conn
    .all(
      `SELECT a.id, a.kind, a.name, a.local_path, a.url, a.mime, a.size, a.hash, a.storage,
              a.group_id, a.target_kind, a.target_key, a.target_seq, a.meta,
              a.deleted_at, a.created_at, a.updated_at, ta.role, ta.position, ta.note
         FROM task_attach ta JOIN attachments a ON a.id = ta.attachment_id
        WHERE ta.task_id = :id AND a.deleted_at IS NULL
        ORDER BY ta.position, a.id`,
      { id: Number(taskId) }
    )
    .map((r) => ({ ...rowView(r), role: r.role, position: Number(r.position) || 0, note: r.note }));
}

/** CLI 只有 topicKey + seq 时的查询入口。 */
export function listTaskAttachmentsBySeq(conn, { topicKey, seq }) {
  const row = conn.get(
    `SELECT t.id FROM tasks t JOIN topics k ON k.id = t.topic_id
      WHERE k.key = :key AND t.seq = :seq`,
    { key: String(topicKey || ''), seq: Number(seq) }
  );
  return row ? listTaskAttachments(conn, Number(row.id)) : [];
}

export function listRefAttachments(conn, refId) {
  return conn
    .all(
      `SELECT a.id, a.kind, a.name, a.local_path, a.url, a.mime, a.size, a.hash, a.storage,
              a.group_id, a.target_kind, a.target_key, a.target_seq, a.meta,
              a.deleted_at, a.created_at, a.updated_at, ra.role, ra.position, ra.note
         FROM ref_attach ra JOIN attachments a ON a.id = ra.attachment_id
        WHERE ra.ref_id = :id AND a.deleted_at IS NULL
        ORDER BY ra.position, a.id`,
      { id: String(refId || '') }
    )
    .map((r) => ({ ...rowView(r), role: r.role, position: Number(r.position) || 0, note: r.note }));
}

/**
 * 无主资源：没有任何 task_attach / ref_attach 边。
 * 软删的任务/文档仍算「有主」（软删可恢复，不能在这里把字节删掉）。
 */
export function listOrphans(conn) {
  return conn
    .all(
      `${ATT_SELECT}
       WHERE deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM task_attach ta WHERE ta.attachment_id = attachments.id)
         AND NOT EXISTS (SELECT 1 FROM ref_attach ra WHERE ra.attachment_id = attachments.id)
       ORDER BY created_at, id`
    )
    .map(rowView);
}

function within(root, p) {
  if (!root || !p) return false;
  const a = resolve(root).replace(/\\/g, '/').toLowerCase();
  const b = resolve(p).replace(/\\/g, '/').toLowerCase();
  return b === a || b.startsWith(a.replace(/\/+$/, '') + '/');
}

export function pruneOrphans(conn, { attachmentsRoot, dryRun = false } = {}) {
  const rows = listOrphans(conn);
  const removed = [];
  const skipped = [];
  for (const row of rows) {
    if (dryRun) {
      removed.push(row);
      continue;
    }
    const still = conn.get(
      `SELECT 1 AS x FROM task_attach WHERE attachment_id = :id
       UNION ALL SELECT 1 FROM ref_attach WHERE attachment_id = :id LIMIT 1`,
      { id: row.id }
    );
    if (still) {
      skipped.push(row);
      continue;
    }
    if (row.kind === 'file' && row.localPath && within(attachmentsRoot, row.localPath)) {
      try {
        if (existsSync(row.localPath)) unlinkSync(row.localPath);
      } catch {
        /* 文件被占用：留到下次，先不删行（否则会变成无记录的残文件） */
        skipped.push(row);
        continue;
      }
    }
    conn.run('DELETE FROM attachments WHERE id = :id AND deleted_at IS NULL', { id: row.id });
    removed.push(row);
  }
  return { removed, skipped };
}

/** 迁移后归档旧 manifest（运行时不再写它，归档只是留证据）。 */
export function archiveAttachmentManifests(root, tag) {
  const out = [];
  if (!root || !existsSync(root)) return out;
  const candidates = [];
  const local = join(root, 'local', 'manifest.json');
  if (existsSync(local)) candidates.push(local);
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'local') continue;
    const p = join(root, e.name, 'manifest.json');
    if (existsSync(p)) candidates.push(p);
  }
  for (const from of candidates) {
    const to = from.replace(/manifest\.json$/i, `manifest.migrated-${tag}.json`);
    try {
      if (existsSync(to)) continue;
      renameSync(from, to);
      out.push({ from, to });
    } catch {
      /* 归档失败不影响运行时（DB 已是唯一真相） */
    }
  }
  return out;
}
