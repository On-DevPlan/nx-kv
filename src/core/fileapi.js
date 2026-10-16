// 后端文件（图床）客户端 —— 对接 dev_ctr_hello 的 /api/v1/files* 与 /files/:fileId。
//
// 与 kvapi.js 共用同一套信封判定：**HTTP 恒为 200，成败看 body 里的 `code`**（0 = 成功），
// 所以这里复用 kvapi 导出的 call()，不另写一份解析。
//
// 上传走 multipart（后端 r.GetUploadFile("file")），其余走 JSON。
//
// fileId 是后端生成的不透明串：16 字节随机 → 32 位 hex；原文件名带扩展名时
// 后端会在 id 后再接 `.<ext>`（service/file/file.go 的 newFileId + "." + newExt），
// 所以 id 偶尔带后缀。判定「像不像 fileId」一律走 attach.js 的 looksLikeFileId。
import { badInput, external, notFound } from './errors.js';
import { loadConfig, normalizeGroupId } from './config.js';
import { call } from './kvapi.js';

const TIMEOUT_MS = 60000;

// 扩展名 → Content-Type。上传时按文件名猜：一律 octet-stream 会让浏览器
// 拿到 application/octet-stream 而不内联渲染，图片就「预览不出来」了。
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
};

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg', '.ico']);

const extOf = (name) => {
  const m = /(\.[A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
};

export function contentTypeOf(name, fallback = 'application/octet-stream') {
  return MIME[extOf(name)] || fallback;
}

export function isImageName(name, contentType = '') {
  const e = extOf(name);
  if (e) return IMAGE_EXT.has(e);
  return /^image\//i.test(String(contentType));
}

export function normalizeFileMeta(d = {}) {
  return {
    fileId: String(d.fileId ?? ''),
    url: String(d.url ?? ''),
    accessLevel: String(d.accessLevel ?? ''),
    size: Number(d.size) || 0,
    contentType: String(d.contentType ?? ''),
    groupId: Number(d.groupId) || 0,
    groupName: String(d.groupName ?? ''),
    sha256: String(d.sha256 ?? ''),
    md5: String(d.md5 ?? ''),
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    createdAt: String(d.createdAt ?? ''),
    expireAt: String(d.expireAt ?? ''),
  };
}

const gidQuery = (groupId) => {
  const n = normalizeGroupId(groupId);
  return n === undefined ? '' : `?groupId=${n}`;
};

/** 出图地址：一律**自己拼**，不用后端回的 url。
 *  后端 url 按请求 Host 推断（可能被反代写成内网地址），自己拼才跟 baseUrl 一致，
 *  也才在假后端 / 换域名时都可预期。 */
export function accessUrlOf(baseUrl, fileId) {
  return String(baseUrl || '').replace(/\/$/, '') + '/files/' + encodeURIComponent(fileId);
}

export async function fileAccessUrl(fileId) {
  const cfg = await loadConfig();
  // fileId 可能带扩展名（xxx.docx）；encodeURIComponent 不会编码 `.`，安全
  return accessUrlOf(cfg.baseUrl, fileId);
}

// ---- 上传（multipart）----

async function parseEnvelope(res, ctxLabel) {
  let envelope;
  try {
    envelope = JSON.parse(await res.text());
  } catch {
    throw external(`后端返回了非 JSON（HTTP ${res.status}）: ${ctxLabel}`);
  }
  const code = envelope.code ?? res.status;
  if (code !== 0) {
    if (code === 401) throw badInput('未登录或登录已过期（执行 nx-kv auth login <email>）');
    throw external(`后端 code=${code}: ${envelope.message || '(无消息)'}`, { code, path: ctxLabel });
  }
  return envelope.data ?? null;
}

/**
 * 上传一个文件到当前用户空间（group）。
 * buffer 是完整字节：CLI 从本机文件读、面板从 base64 解 —— 两条路共用这一处。
 */
export async function fileUpload({
  name,
  buffer,
  contentType,
  groupId,
  accessLevel = 'public',
  tags = [],
  key = '',
  expireSeconds = 0,
} = {}) {
  if (!name) throw badInput('上传必须带文件名');
  if (!buffer || !buffer.length) throw badInput('上传内容为空');

  const cfg = await loadConfig();
  const url = cfg.baseUrl.replace(/\/$/, '') + '/api/v1/files';
  const ct = contentType || contentTypeOf(name);

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: ct }), String(name));
  form.append('accessLevel', String(accessLevel));
  const gid = normalizeGroupId(groupId);
  if (gid !== undefined) form.append('groupId', String(gid));
  if (expireSeconds) form.append('expireSeconds', String(expireSeconds));
  if (key) form.append('key', String(key));
  for (const t of tags) form.append('tags', String(t));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    // ⚠️ 不能自己设 content-type：multipart 的 boundary 由 FormData 生成，
    // 手写一个会丢掉 boundary，后端解析直接失败。
    res = await fetch(url, {
      method: 'POST',
      headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : {},
      body: form,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw external(`上传超时（${TIMEOUT_MS}ms）: ${name}`);
    throw external(`无法连接后端 ${cfg.baseUrl}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  const data = await parseEnvelope(res, 'POST /api/v1/files');
  if (!data || !data.fileId) throw external('上传成功但后端未返回 fileId');
  return normalizeFileMeta(data);
}

// ---- 列表 / 元数据 / 删除（JSON）----

export async function listFiles({ groupId, limit = 100, offset = 0 } = {}) {
  const n = normalizeGroupId(groupId);
  const q = `?limit=${Number(limit) || 100}&offset=${Number(offset) || 0}` + (n === undefined ? '' : `&groupId=${n}`);
  const data = await call({ method: 'GET', path: '/api/v1/files' + q });
  return {
    total: Number(data?.total) || 0,
    hasMore: data?.hasMore === true,
    items: (data?.items ?? []).map(normalizeFileMeta),
  };
}

/** 一次拉全（分页直到 total 或页数上限），供同步用。
 *  上限存在的意义：列表接口异常返回 hasMore=true 时不会把 CLI 卡死。 */
export async function listAllFiles({ groupId, pageSize = 200, maxPages = 50 } = {}) {
  const out = [];
  let total = 0;
  for (let page = 0; page < maxPages; page++) {
    const r = await listFiles({ groupId, limit: pageSize, offset: page * pageSize });
    out.push(...r.items);
    total = r.total;
    if (!r.items.length || out.length >= total) break;
  }
  return { total, items: out };
}

export async function fileInfo(fileId, groupId) {
  if (!fileId) throw badInput('缺少 fileId');
  const data = await call({
    method: 'GET',
    path: `/api/v1/files/${encodeURIComponent(fileId)}/info` + gidQuery(groupId),
    allowMissing: true,
  });
  if (!data) throw notFound(`附件不存在: ${fileId}（可能已被删除或不在当前工作空间）`);
  return normalizeFileMeta(data);
}

export async function deleteFile(fileId, groupId) {
  if (!fileId) throw badInput('缺少 fileId');
  await call({
    method: 'DELETE',
    path: `/api/v1/files/${encodeURIComponent(fileId)}` + gidQuery(groupId),
  });
  return { fileId, deleted: true };
}

/**
 * 取文件本体：返回未解析的 fetch Response（调用方 pipe / arrayBuffer）。
 * 走的是**无鉴权的出图路由** /files/:fileId —— 与 <img src> 同一条路，
 * 所以「浏览器能预览」与「CLI 能下载」在权限上永远一致。
 */
export async function openFileStream(fileId) {
  if (!fileId) throw badInput('缺少 fileId');
  const cfg = await loadConfig();
  const url = await fileAccessUrl(fileId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : {},
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw external(`下载超时（${TIMEOUT_MS}ms）: ${fileId}`);
    throw external(`无法连接后端 ${cfg.baseUrl}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw notFound(`附件下载失败（HTTP ${res.status}）: ${fileId}`);
  return res;
}

export async function downloadFile(fileId) {
  const res = await openFileStream(fileId);
  return Buffer.from(await res.arrayBuffer());
}
