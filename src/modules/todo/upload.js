// 浏览器侧的附件上传 —— 「选择文件 / 粘贴 / 拖入」三条路共用一个入口。
//
// 上传走本机服务 /api/file（base64），由服务端转 multipart 发给后端：
// 于是浏览器不必知道后端地址，也不碰 CORS 与凭据。
//
// 独立成文件，是因为**不止一个地方要传附件**（任务编辑器、快速新增那一栏），
// 而「截图粘贴过来往往没有文件名」「剪贴板里既有文件又有文本」这类坑只该踩一次。

import { api } from '../../web/frontend/api/client.js';

const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/zip': '.zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

const pad = (n) => String(n).padStart(2, '0');
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

/** 剪贴板里的文件。截图工具给的是「无名字的 blob」，所以拿到的 name 常常不可信。 */
export function clipboardFiles(e) {
  const dt = e.clipboardData;
  if (!dt) return [];
  const out = [];
  if (dt.items) {
    for (const it of dt.items) {
      if (it.kind !== 'file') continue;
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  if (!out.length && dt.files) out.push(...Array.from(dt.files));
  return out;
}

export function droppedFiles(e) {
  const dt = e.dataTransfer;
  if (!dt) return [];
  return Array.from(dt.files || []).filter((f) => f && f.size > 0);
}

/**
 * 给文件起一个**好认**的名字：粘贴来的往往叫 `image.png` 甚至空名，
 * 而这个名字会一路用下去（嵌入的说明文字 + 落盘的文件名），
 * 叫「粘贴图片-20261016-113005.png」比叫 image.png 有用得多。
 */
export function readableName(file, index = 0) {
  const raw = String(file.name || '').trim();
  const generic = !raw || /^image\.(png|jpe?g)$/i.test(raw) || /^blob$/i.test(raw);
  if (!generic) return raw;
  const fromName = raw.includes('.') ? raw.slice(raw.lastIndexOf('.')) : '';
  const ext = EXT_BY_TYPE[file.type] || fromName || '.bin';
  return `粘贴图片-${stamp()}${index > 0 ? `-${index + 1}` : ''}${ext}`;
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error(`读取文件失败: ${file.name || '（无名）'}`));
    fr.onload = () => resolve(String(fr.result || ''));
    fr.readAsDataURL(file);
  });
}

/** 上传单个文件，返回后端元数据 + 可直接贴进正文的 markdown 片段。 */
export async function uploadOne(file, { group, index = 0 } = {}) {
  const name = readableName(file, index);
  const content = await readAsDataURL(file);
  const r = await api('/api/file', {
    method: 'POST',
    body: { name, content, contentType: file.type || '', group },
  });
  return { ...r, name };
}

/**
 * 批量上传。让调用方**一次拿到全部片段再插入**，而不是边传边插 ——
 * 后者在连续插入时会和光标位置打架（插入后 DOM 里光标还没更新，
 * 第二次插入会算错落点，几个附件就变成倒序）。
 */
export async function uploadMany(files, { group, onProgress } = {}) {
  const out = [];
  for (let i = 0; i < files.length; i++) {
    if (onProgress) onProgress(i + 1, files.length, files[i]);
    out.push(await uploadOne(files[i], { group, index: i }));
  }
  return out;
}

/** 上传结果 → 贴进正文的 markdown（图片用 ![]，其他用 []）。 */
export function snippetsOf(results) {
  return results.map((r) => (r.isImage ? r.markdown.image : r.markdown.file)).join(' ');
}
