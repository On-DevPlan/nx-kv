// MD 任务附件：本机 localStorage（按 task id）+ File → 条目转换。

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

/** @returns {Promise<{items: object[], imageInserts: string[]}>} */
export async function filesToAttachments(fileList) {
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
  return { items, imageInserts };
}
