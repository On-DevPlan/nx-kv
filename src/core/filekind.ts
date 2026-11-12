// 文件类型与本地文件名的纯函数（无网络、无 DB）。
//
// 从原来的云端 fileapi / attachstore 抽出：删除云端图床后，本地任务与文档
// 仍需要「按扩展名猜 MIME / 判断图片 / 生成安全文件名」这几个helper。
import { extname, parse as parsePath } from 'node:path';

// 扩展名 → Content-Type。上传时按文件名猜：一律 octet-stream 会让浏览器
// 拿到 application/octet-stream 而不内联渲染，图片就「预览不出来」了。
const MIME: Record<string, string> = {
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

const extOf = (name: unknown): string => {
  const m = /(\.[A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? (m[1] ?? '').toLowerCase() : '';
};

export function contentTypeOf(name: unknown, fallback = 'application/octet-stream'): string {
  return MIME[extOf(name)] || fallback;
}

export function isImageName(name: unknown, contentType = ''): boolean {
  const e = extOf(name);
  if (e) return IMAGE_EXT.has(e);
  return /^image\//i.test(String(contentType));
}

// Windows 保留设备名做文件名会让文件无法访问
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** 收成跨平台可用的单段文件名（保留中文）。 */
export function safeFileName(name: unknown): string {
  let s = String(name ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!s) s = 'file';
  if (RESERVED.has(parsePath(s).name.toLowerCase())) s = '_' + s;
  return s.slice(0, 120);
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain; charset=utf-8': '.txt',
  'text/markdown; charset=utf-8': '.md',
};

/**
 * 本地落点文件名。优先用调用方给的「人读名字」，否则退回 fileId；
 * 两者都没有扩展名时，再按 fileId 自带后缀 / Content-Type 补一个。
 */
export function localNameFor(fileId: string, preferred: unknown, contentType = ''): string {
  let base = safeFileName(preferred || fileId);
  if (!extname(base)) {
    const fromId = extname(String(fileId));
    const guess = fromId || EXT_BY_TYPE[String(contentType).toLowerCase()] || '';
    if (guess) base += guess;
  }
  return base;
}
