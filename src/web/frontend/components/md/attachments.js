// MD 任务附件：贴图/文件一律走**本机附件仓**（上传落本机盘，正文嵌标准 markdown）。
//
// 图床路径（2026-11-03 任务 #8「本地任务支持附件」）最初传云端图床；任务 #15
// 验收反馈改口径：**本地任务的贴图走本地存储，与云端零关联**——上传不发网
// （本机 serve 落盘即回）、预览读本机文件、agent 领取直接拿本地路径。
// 附件以 `![名](fileId)` / `[名](fileId)` 嵌进任务正文——正文即载体，附件跟着
// 任务走（CLI / 其他机器认语法，本机仓按 id 给文件）。
// 本机仓不可达（serve 没起来——面板本身也起不来）时退回 localStorage 老路：
// 功能不中断，代价是这类附件只活在当前浏览器（界面会照常显示）。
import { uploadMany } from '../cloud/upload.js';

const ATT_KEY = 'nx-kv-md-attachments-v1';

export function loadAttMap() {
  try {
    return JSON.parse(localStorage.getItem(ATT_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function saveAttMap(map) {
  try {
    localStorage.setItem(ATT_KEY, JSON.stringify(map));
  } catch { /* quota */ }
}

export function persistAtt(taskId, list) {
  const map = loadAttMap();
  map[taskId] = list;
  saveAttMap(map);
}

export function loadAttForTask(taskId) {
  const map = loadAttMap();
  return Array.isArray(map[taskId]) ? map[taskId] : [];
}

export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** @returns {Promise<{items: object[], imageInserts: string[]}>} 旧路：localStorage dataURL */
async function legacyFilesToAttachments(fileList) {
  const items = [];
  const imageInserts = [];
  for (const f of [...fileList]) {
    const id = 'a' + Date.now() + Math.random().toString(16).slice(2, 6);
    const isImg = /^image\//.test(f.type);
    const item = { id, name: f.name, type: isImg ? 'image' : 'file', size: fmtSize(f.size) };
    if (isImg) {
      item.url = await readAsDataUrl(f);
      imageInserts.push(`\n![${f.name}](${f.name})\n`);
    }
    items.push(item);
  }
  return { items, imageInserts, fileInserts: [] };
}

/**
 * 文件 → 附件条目 + 正文嵌入片段。
 * 本地任务编辑器专条：**本机附件仓**（local: true——上传不发网，落 ~/.nx-kv
 * /attachments/local/，正文嵌 fileId）；本机仓不可达时整体退回 localStorage
 * 老路（items 带 dataURL，行为与旧版一致）。
 * @returns {Promise<{items: object[], imageInserts: string[], fileInserts: string[]}>}
 */
export async function filesToAttachments(fileList, opts = {}) {
  const files = [...(fileList || [])];
  if (!files.length) return { items: [], imageInserts: [], fileInserts: [] };
  try {
    const ups = await uploadMany(files, { ...(opts.group ? { group: opts.group } : {}), local: true });
    const items = [];
    const imageInserts = [];
    const fileInserts = [];
    for (const r of ups) {
      const fid = r.fileId || r.id;
      const isImg = !!r.isImage;
      items.push({
        id: fid,
        name: r.name,
        type: isImg ? 'image' : 'file',
        size: fmtSize(Number(r.size) || 0),
        url: `/api/file/content/${fid}`,
      });
      const md = r.markdown || {};
      const snip = isImg
        ? (md.image || `![${r.name}](${fid})`)
        : (md.file || `[${r.name}](${fid})`);
      (isImg ? imageInserts : fileInserts).push(`\n${snip}\n`);
    }
    return { items, imageInserts, fileInserts };
  } catch {
    return legacyFilesToAttachments(fileList);
  }
}
