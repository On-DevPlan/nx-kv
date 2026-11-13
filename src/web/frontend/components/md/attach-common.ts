// 任务/文档共用的附件口径：归一化、展示标签、接口地址。
//
// 前端**不拼正文**：所有写入都走 `localtask attach` / `docs attach` 的
// `--no-embed` 路径（attachments + task_attach/ref_attach），正文由编辑器自己管。
import { api } from '../../api/client.js';

/** 附件分区：正文内嵌（role=inline）/ 附件区（role=attach|doc）。 */
export type AttachAreaKind = 'area' | 'inline';

/** 附件宿主（任务侧走 localtask.attach，文档侧走 docs.attach）。 */
export type AttachHostKind = 'task' | 'doc';

/**
 * 一条附件：服务端两类清单（task_attach / ref_attach）与本地草稿条目共用。
 *
 * 按索引签名放行——这是**外部数据边界**：任务侧、文档侧字段不同，本地草稿
 * 又是第三套（type/size/url），这里只声明各消费点真的读到的字段。
 */
export interface Attachment {
  [k: string]: any;
  id?: string | number;
  name?: string;
  title?: string;
  kind?: string;
  type?: string;
  role?: string;
  badge?: string;
  kindLabel?: string;
  size?: number | string;
  sizeText?: string | number;
  areaLabel?: string;
  area?: AttachAreaKind;
  /** 地址：文件/链接条目用；老数据可能是 `{ href }` 形态（normAttachment 收口） */
  url?: any;
  href?: string;
  mime?: string;
  isImage?: boolean;
  locator?: string;
  refId?: string;
  taskId?: string | number;
  topicKey?: string;
  seq?: number;
  targetSeq?: number | null;
  targetKey?: string;
  targetRef?: string;
  note?: string;
  position?: number;
  meta?: Record<string, any>;
}

/** 归一化后的展示形状：各字段已收口成一套（服务端字段差异见 normAttachment）。 */
export interface NormalizedAttachment extends Attachment {
  role: string;
  area: AttachAreaKind;
  areaLabel: string;
  sizeText: string;
  href: string;
  targetSeq: number | null;
  targetKey: string;
  targetRef: string;
  locator: string;
}

/** 附件清单接口的出站形状（任务侧 / 文档侧同形）。 */
export interface AttachListData {
  attachments?: Attachment[];
}

/** 查询附件清单 / 增删绑定的取数描述（attach-common.endpointOf 的入参）。 */
export interface AttachHostRef {
  hostId?: string | number;
  hostKey?: string;
  hostCwd?: string;
  refId?: string;
}

/** 一类来源的可用性（「添加附件」弹窗按它决定显示哪几块）。 */
export interface AttachAllow {
  file: boolean;
  url: boolean;
  task: boolean;
  ref: boolean;
}

/** 可关联的任务（本主题内）：只用到编号与标题/正文首行。 */
export interface TaskOption {
  id: string | number;
  text?: string;
  title?: string;
  status?: string;
}

/** 可关联的文档（ref）：弹窗自己拉一份，或由宿主传入。 */
export interface DocOption {
  /** 提交给 attach 的文档地址：refId / ref:<id> */
  ref: string;
  /** 列表主标签：desc（缺省回落到文档标题） */
  title?: string;
  /** 次级说明：desc 与标题不同时给标题，便于区分同名文档 */
  sub?: string;
  /** 文档短描述（v7；提示词与列表的快速定位标签） */
  desc?: string;
  name?: string;
}

/** 端点三件套：清单 / 挂载 / 解除。 */
export interface AttachEndpoint {
  list: () => Promise<AttachListData>;
  attach: (body: Record<string, any>) => Promise<any>;
  detach: (attachment: string | number | undefined, purge: boolean) => Promise<any>;
}

/** 待确认条目 → attach 请求体的最小形状（attachBodyOf 的入参）。 */
export interface AttachDraftItem {
  source: string;
  fileId?: string | null;
  name?: string;
  url?: string;
  seq?: number | string;
  docRef?: string;
  note?: string;
  inline?: boolean;
}

export const AREA_LABEL: Record<AttachAreaKind, string> = { inline: '正文内嵌', area: '附件区' };
export const AREA_OF = (role: string): AttachAreaKind => (role === 'attach' || role === 'doc' ? 'area' : 'inline');

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function fmtSize(n: number | string | null | undefined) {
  const v = Number(n) || 0;
  if (!v) return '';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

export function contentUrl(id: unknown) {
  return `/api/file/content/${encodeURIComponent(String(id))}`;
}

/** 文档地址 → 面板 docId（ref: / path:）。ref 条目请直接用 refId，不走这里。 */
export function docIdOfLocator(locator: unknown) {
  const s = String(locator || '').replace(/\\/g, '/');
  if (/^(ref|path):/.test(s)) return s;
  if (/^\/|[A-Za-z]:\//.test(s)) return `path:${s}`;
  return '';
}

/** 统一展示形状：服务端两类清单字段不同，这里收口成一套。 */
export function normAttachment(a: Attachment): NormalizedAttachment {
  const role = String(a.role || 'inline');
  const isImage =
    a.kind === 'file' &&
    (a.isImage === true || /^image\//i.test(a.mime || '') || IMG_EXT.test(a.name || ''));
  const urlText: string = typeof a.url === 'string' ? a.url : a.url && a.url.href ? String(a.url.href) : '';
  return {
    ...a,
    role,
    area: AREA_OF(role),
    areaLabel: AREA_LABEL[AREA_OF(role)],
    kind: a.kind === 'file' && isImage ? 'image' : a.kind,
    sizeText: fmtSize(a.size),
    href: a.kind === 'file' ? contentUrl(a.id) : a.kind === 'mdfile' ? '' : a.href || urlText,
    targetSeq: a.targetSeq ?? (a.meta && a.meta.seq) ?? null,
    targetKey: a.targetKey || (a.meta && a.meta.topicKey) || '',
    targetRef: a.targetKey || (a.meta && a.meta.refId) || '',
    locator: a.locator || (a.meta && a.meta.locator) || '',
  };
}

const KIND_BADGE: Record<string, string> = { image: '图片', file: '文件', url: '链接', task: '任务', ref: '文档', mdfile: 'md' };
export const badgeOf = (kind: string | undefined) => KIND_BADGE[kind || ''] || '附件';

/** 任务侧/文档侧的列表与关系接口（同一套字段，只换 URL）。 */
export function endpointOf(host: AttachHostKind | undefined, { hostId, hostKey, hostCwd, refId }: AttachHostRef): AttachEndpoint {
  if (host === 'task') {
    // 任务定位二选一：全局池用 key，代码目录用 cwd（后端 getTask 两种都认）。
    const where: { key?: string; cwd?: string } = hostKey ? { key: hostKey } : hostCwd ? { cwd: hostCwd } : {};
    const q = new URLSearchParams({ id: String(hostId) });
    if (hostKey) q.set('key', hostKey);
    else if (hostCwd) q.set('cwd', hostCwd);
    return {
      list: () => api<AttachListData>(`/api/localtasks/attachments?${q.toString()}`),
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
    list: () => api<AttachListData>(`/api/docs/attachments?${q.toString()}`),
    attach: (body) => api('/api/docs/attach', { method: 'POST', body: { ref: refId, ...body, noEmbed: true } }),
    detach: (attachment, purge) => api('/api/docs/attach', {
      method: 'DELETE',
      body: { ref: refId, attachment, purge },
    }),
  };
}

/** 待确认条目 → attach 请求体（文件先上传拿到 fileId）。
 *
 * 文档来源的**字段名按宿主分**（#165 二轮）：任务侧 action 收 `ref`
 * （localtask.attach），文档侧收 `doc`（docs.attach）——之前两侧都发 `doc`，
 * 面板「给任务挂文档」必然失败（未知键透传，attachToTask 收不到 ref）。
 * `note`（绑定说明 / desc）与 `inline`（文档进原文，#162）随条目透传。
 */
export function attachBodyOf(item: AttachDraftItem, host: AttachHostKind = 'task'): Record<string, any> {
  if (item.source === 'file') return { fileId: item.fileId, name: item.name };
  if (item.source === 'url') return { url: item.url, name: item.name };
  if (item.source === 'task') return { task: String(item.seq), name: item.name };
  if (item.source === 'ref') {
    const body: Record<string, any> = host === 'doc'
      ? { doc: item.docRef, name: item.name }
      : { ref: item.docRef, name: item.name };
    if (item.note) body.note = item.note;
    if (host !== 'doc' && item.inline) body.inline = true;
    return body;
  }
  return {};
}
