// 任务/文档共用的附件口径：归一化、展示标签、接口地址。
//
// 前端**不拼正文**：所有写入都走 `localtask attach` / `docs attach` 的
// `--no-embed` 路径（attachments + task_attach/ref_attach），正文由编辑器自己管。
import { api } from '../../api/client.js';

export const AREA_LABEL = { inline: '正文内嵌', area: '附件区' };
export const AREA_OF = (role) => (role === 'attach' || role === 'doc' ? 'area' : 'inline');

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function fmtSize(n) {
  const v = Number(n) || 0;
  if (!v) return '';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

export function contentUrl(id) {
  return `/api/file/content/${encodeURIComponent(String(id))}`;
}

/** 决策文档 locator（后端存的是裸路径）→ 面板 docId（rel: / path:）。 */
export function docIdOfLocator(locator) {
  const s = String(locator || '').replace(/\\/g, '/');
  if (/^(rel|path):/.test(s)) return s;
  if (/^\/|[A-Za-z]:\//.test(s)) return `path:${s}`;
  return s ? `rel:${s}` : '';
}

/** 统一展示形状：服务端两类清单字段不同，这里收口成一套。 */
export function normAttachment(a) {
  const role = String(a.role || 'inline');
  const isImage =
    a.kind === 'file' &&
    (a.isImage === true || /^image\//i.test(a.mime || '') || IMG_EXT.test(a.name || ''));
  const urlText = typeof a.url === 'string' ? a.url : a.url && a.url.href ? a.url.href : '';
  return {
    ...a,
    role,
    area: AREA_OF(role),
    areaLabel: AREA_LABEL[AREA_OF(role)],
    kind: a.kind === 'file' && isImage ? 'image' : a.kind,
    sizeText: fmtSize(a.size),
    href: a.kind === 'file' ? contentUrl(a.id) : a.href || urlText,
    targetSeq: a.targetSeq ?? (a.meta && a.meta.seq) ?? null,
    targetKey: a.targetKey || (a.meta && a.meta.topicKey) || '',
    targetRef: a.targetKey || (a.meta && a.meta.refId) || '',
    locator: a.locator || a.relPath || (a.meta && a.meta.locator) || '',
  };
}

const KIND_BADGE = { image: '图片', file: '文件', url: '链接', task: '任务', ref: '文档' };
export const badgeOf = (kind) => KIND_BADGE[kind] || '附件';

/** 任务侧/文档侧的列表与关系接口（同一套字段，只换 URL）。 */
export function endpointOf(host, { hostId, hostKey, hostCwd, refId }) {
  if (host === 'task') {
    // 任务定位二选一：全局池用 key，代码目录用 cwd（后端 getTask 两种都认）。
    const where = hostKey ? { key: hostKey } : hostCwd ? { cwd: hostCwd } : {};
    const q = new URLSearchParams({ id: String(hostId) });
    if (hostKey) q.set('key', hostKey);
    else if (hostCwd) q.set('cwd', hostCwd);
    return {
      list: () => api(`/api/localtasks/attachments?${q.toString()}`),
      attach: (body) => api('/api/localtasks/attach', {
        method: 'POST',
        body: { id: Number(hostId), ...where, ...body, noEmbed: true },
      }),
      detach: (attachment, purge) => api('/api/localtasks/attach', {
        method: 'DELETE',
        body: { id: Number(hostId), ...where, attachment, purge },
      }),
    };
  }
  const q = new URLSearchParams({ ref: String(refId || '') });
  return {
    list: () => api(`/api/docs/attachments?${q.toString()}`),
    attach: (body) => api('/api/docs/attach', { method: 'POST', body: { ref: refId, ...body, noEmbed: true } }),
    detach: (attachment, purge) => api('/api/docs/attach', {
      method: 'DELETE',
      body: { ref: refId, attachment, purge },
    }),
  };
}

/** 待确认条目 → attach 请求体（文件先上传拿到 fileId）。 */
export function attachBodyOf(item) {
  if (item.source === 'file') return { fileId: item.fileId, name: item.name };
  if (item.source === 'url') return { url: item.url, name: item.name };
  if (item.source === 'task') return { task: String(item.seq), name: item.name };
  if (item.source === 'ref') return { doc: item.docRef, name: item.name };
  return {};
}
