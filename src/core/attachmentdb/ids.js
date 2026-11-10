// 标识与正文解析：fileId / ref / url / task 四类资源的稳定 id 公式，
// 以及 markdown 正文 → 资源引用清单的纯函数。本文件不碰数据库与文件系统。
import { createHash } from 'node:crypto';

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
export function mimeFromName(name) {
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

export function metaOf(row) {
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
