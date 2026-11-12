// 浏览器侧的附件上传 —— 「选择文件 / 粘贴 / 拖入」三条路共用一个入口。
//
// 上传走本机服务 /api/file（base64），由服务端落本机附件仓；不碰云端、不需要登录。
//
// 独立成文件，是因为**不止一个地方要传附件**（任务编辑器、文档编辑器），
// 而「截图粘贴过来往往没有文件名」「剪贴板里既有文件又有文本」这类坑只该踩一次。

import { api } from '../../api/client.js';

/** 常见 MIME → 扩展名：粘贴来的截图没有文件名，靠它补后缀。 */
const EXT_BY_TYPE: Record<string, string> = {
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

const pad = (n: number): string => String(n).padStart(2, '0');
const stamp = (): string => {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

/**
 * 只读 `dataTransfer` 的事件面。
 *
 * React 合成事件与 window 上的原生 DragEvent 都会传进来（拖拽监听挂在 window 上），
 * 结构上只要这个字段就够——参数收窄成某一种反而会挡住另一种。
 */
interface DataTransferEvent {
  dataTransfer: DataTransfer | null;
}

/** 只读 `clipboardData` 的事件面（同上：只要这一个字段）。 */
interface ClipboardDataEvent {
  clipboardData: DataTransfer | null;
}

/** 剪贴板里的文件。截图工具给的是「无名字的 blob」，所以拿到的 name 常常不可信。 */
export function clipboardFiles(e: ClipboardDataEvent): File[] {
  const dt = e.clipboardData;
  if (!dt) return [];
  const out: File[] = [];
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

export function droppedFiles(e: DataTransferEvent): File[] {
  const dt = e.dataTransfer;
  if (!dt) return [];
  return Array.from(dt.files || []).filter((f) => f && f.size > 0);
}

/**
 * 给文件起一个**好认**的名字：粘贴来的往往叫 `image.png` 甚至空名，
 * 而这个名字会一路用下去（嵌入的说明文字 + 落盘的文件名），
 * 叫「粘贴图片-20261016-113005.png」比叫 image.png 有用得多。
 */
export function readableName(file: File, index = 0): string {
  const raw = String(file.name || '').trim();
  const generic = !raw || /^image\.(png|jpe?g)$/i.test(raw) || /^blob$/i.test(raw);
  if (!generic) return raw;
  const fromName = raw.includes('.') ? raw.slice(raw.lastIndexOf('.')) : '';
  const ext = EXT_BY_TYPE[file.type] || fromName || '.bin';
  return `粘贴图片-${stamp()}${index > 0 ? `-${index + 1}` : ''}${ext}`;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error(`读取文件失败: ${file.name || '（无名）'}`));
    fr.onload = () => resolve(String(fr.result || ''));
    fr.readAsDataURL(file);
  });
}

/** 单次上传的选项。 */
export interface UploadOptions {
  /** 同一批里的序号（给粘贴图片起名 -2/-3）。 */
  index?: number;
}

/** 上传单个文件到本机附件仓，返回元数据 + 可直接贴进正文的 markdown 片段。 */
export async function uploadOne(file: File | undefined, { index = 0 }: UploadOptions = {}) {
  const picked = file as File;
  const name = readableName(picked, index);
  const content = await readAsDataURL(picked);
  const r = await api('/api/file', {
    method: 'POST',
    body: { name, content, contentType: picked.type || '' },
  });
  return { ...r, name };
}

/** 批量上传的选项：在单次上传的基础上多一个进度回调。 */
export interface UploadManyOptions {
  /** 每开始传一个回调一次（done 从 1 起）。 */
  onProgress?: (done: number, total: number, file: File) => void;
}

/**
 * 批量上传。让调用方**一次拿到全部片段再插入**，而不是边传边插 ——
 * 后者在连续插入时会和光标位置打架（插入后 DOM 里光标还没更新，
 * 第二次插入会算错落点，几个附件就变成倒序）。
 */
export async function uploadMany(files: File[], { onProgress }: UploadManyOptions = {}) {
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    if (onProgress) onProgress(i + 1, files.length, f);
    out.push(await uploadOne(f, { index: i }));
  }
  return out;
}

/** 上传结果里真正被正文消费的字段（其余按后端 payload 放行）。 */
export interface UploadResult {
  name?: string;
  isImage?: boolean;
  markdown: { image?: string; file?: string };
  [k: string]: any;
}

/** 上传结果 → 贴进正文的 markdown（图片用 ![]，其他用 []）。 */
export function snippetsOf(results: UploadResult[]): string {
  return results.map((r) => (r.isImage ? r.markdown.image : r.markdown.file)).join(' ');
}
