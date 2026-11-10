// 关系表写入（任务/文档共用一套语义）。
//
// role 是**边的语义**，不是资源的属性；同一资源对同一宿主只有一行（PK）。
// 冲突时的处置规则（2026-11-08 附件区改造）：
//   已有 role 优先级 >= 新 role → 保留已有（正文同步不能把用户显式挂的东西降级）；
//   否则升级（正文里出现的资源后来被显式挂载 → attach，删正文行也不会丢）；
//   同 role 重复写只刷新 position（正文改了，顺序跟着改）。
// 优先级 attach > doc > reference > inline：越"显式"越不容易被正文覆盖。
import { parseAttachmentRefs } from './ids.js';
import { ensureAttachment } from './resources.js';

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
 *
 * note 是**边上的说明**（desc）：只在与现存 role 同级且调用方**显式给了** note
 * （!== undefined）时才更新——正文同步等不关心 note 的调用方不传，就不会把
 * 用户写的说明冲掉（#162：attach --ref --note 走 embed 路径时说明不再丢）。
 * @returns {string} 实际落库的 role
 */
export function linkAttachment(conn, {
  host, hostId, attachmentId, role = 'attach', position, note, atMs = Date.now(),
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
      if (note === undefined) {
        conn.run(
          `UPDATE ${h.table} SET position = :pos WHERE ${h.col} = :host AND attachment_id = :att`,
          { pos: Number(pos) || 0, host: hostVal, att }
        );
      } else {
        conn.run(
          `UPDATE ${h.table} SET position = :pos, note = :note
            WHERE ${h.col} = :host AND attachment_id = :att`,
          { pos: Number(pos) || 0, note: String(note || ''), host: hostVal, att }
        );
      }
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

/**
 * 改一条关系上的说明（desc，#168）：面板里给已挂载的文档绑定补/改说明。
 * 只动 note，不动 role/position——角色是「这条边是什么」，说明是「它讲什么」。
 * @returns {number} 受影响行数（0 = 没有这条边）
 */
export function updateAttachmentNote(conn, { host, hostId, attachmentId, note = '' } = {}) {
  const h = hostOf(host);
  const hostVal = host === 'task' ? Number(hostId) : String(hostId || '');
  const att = String(attachmentId || '');
  if (!att) return 0;
  const r = conn.run(
    `UPDATE ${h.table} SET note = :note WHERE ${h.col} = :host AND attachment_id = :att`,
    { note: String(note || ''), host: hostVal, att }
  );
  return Number(r.changes) || 0;
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
  // 整组重写前先把边上的说明（note，#162）抄下来：正文同步只管「正文里有哪些引用」，
  // 不该把用户写在该边上的 desc 冲掉——重插时原样带回。
  const notes = new Map(
    conn.all("SELECT attachment_id, note FROM task_attach WHERE task_id = :id AND role = 'inline'", { id })
      .map((r) => [r.attachment_id, r.note])
  );
  conn.run("DELETE FROM task_attach WHERE task_id = :id AND role = 'inline'", { id });
  ids.forEach((att, pos) => {
    linkAttachment(conn, {
      host: 'task', hostId: id, attachmentId: att, role: 'inline', position: pos,
      note: notes.has(att) ? notes.get(att) : undefined, atMs,
    });
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
  // 同任务侧：整组重写保留边上的说明（note）。
  const notes = new Map(
    conn.all("SELECT attachment_id, note FROM ref_attach WHERE ref_id = :id AND role IN ('inline', 'reference')", { id })
      .map((r) => [r.attachment_id, r.note])
  );
  conn.run("DELETE FROM ref_attach WHERE ref_id = :id AND role IN ('inline', 'reference')", { id });
  rows.forEach((x, pos) => {
    linkAttachment(conn, {
      host: 'ref', hostId: id, attachmentId: x.id, role: x.role, position: pos,
      note: notes.has(x.id) ? notes.get(x.id) : undefined, atMs,
    });
  });
  return rows.length;
}
