// 本地附件仓：**本地任务**（localtask 队列）的贴图/文件原件，落在本机磁盘上。
//
// 口径（任务 #15 验收反馈 2026-11-04）：本地任务的贴图走本地存储，与云端图床
// **零关联**——上传不碰网、预览不透传、agent 领取直接读本地路径。云端清单
// （todo）的附件仍走云端图床（core/fileapi.js + core/attachstore.js 镜像），
// 两条链路互不依赖；只有「正文引用的附件 id」是同一套语法（modules/todo/attach.js）。
//
// 目录：~/.nx-kv/attachments/local/（NX_KV_ATTACHMENTS 可改根目录；与各
// 工作空间的数字目录天然不撞）。台账 manifest.json 形状与 attachstore 一致
// （files: fileId → {name,size,contentType,…}），复用同一套读写函数。
//
// 正文引用语法不变：`![名](fileId)`，fileId 同样是 32 位 hex——面板/解析端
// 不需要知道 id 背后是本地仓还是云端；读取时先查本地仓、未命中再走云端。
import { randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { dirname, join, parse as parsePath } from 'node:path';
import { attachmentsRootFromEnv } from './paths.js';
import { contentTypeOf } from './fileapi.js';
import {
  localNameFor,
  readManifest as readMirrorManifest,
  safeFileName,
  writeManifest as writeMirrorManifest,
} from './attachstore.js';

export const LOCAL_STORE_DIRNAME = 'local';

// 台账读写直接复用镜像那套（同形状：files 是 fileId → 记录）。groupId 字段
// 对本地仓没有意义（readManifest 缺省补 0），写入时不带即可。
const readManifest = (dir) => readMirrorManifest(dir);
const writeManifest = (dir, data) => writeMirrorManifest(dir, data);

/** 本地附件仓根目录（每个实例独立：NX_KV_ATTACHMENTS 覆盖根时测试天然隔离）。 */
export function localDir() {
  return join(attachmentsRootFromEnv(), LOCAL_STORE_DIRNAME);
}

const nowIso = () => new Date().toISOString();

/**
 * 新条目的 id：32 位 hex（16 字节随机）。与云端 fileId 同构——
 * looksLikeFileId（modules/todo/attach.js）照常认，正文语法零分叉。
 * 撞车概率 2^-128，先查本地仓再查云端的读取顺序天然消歧。
 */
function newFileId() {
  return randomBytes(16).toString('hex');
}

// 同目录不重名的落点（`名字 (2).ext`）——台账是唯一真相源，文件名只是给人看的。
function uniqueName(taken, name) {
  if (!taken.has(name)) return name;
  const { name: stem, ext } = parsePath(name);
  let n = 1;
  let candidate = name;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  return candidate;
}

/**
 * 上传一个附件到本地仓：落盘 + 记台账，返回元数据。
 * 不碰网络——本机 serve 进程内一次落盘即完成。
 *
 * @param {{name: string, buffer: Buffer, contentType?: string}} p
 * @returns {Promise<{fileId: string, name: string, size: number, contentType: string, path: string, storage: 'local'}>}
 */
export async function localUpload({ name, buffer, contentType = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('上传内容为空');
  const base = safeFileName(name);
  if (!base || base === 'file') throw new Error('上传需要文件名');
  const dir = localDir();
  const man = await readManifest(dir);
  const id = newFileId();
  // 落盘文件名人读优先（嵌入的说明文字一路跟过来），缺扩展名按 contentType 补
  const fileName = uniqueName(
    new Set(Object.values(man.files).map((r) => String(r?.name || ''))),
    localNameFor(id, base, contentType || contentTypeOf(base))
  );
  const abs = join(dir, fileName);
  await fsp.mkdir(dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buffer);
  const ct = contentType || contentTypeOf(fileName);
  man.files[id] = { name: fileName, size: buffer.length, contentType: ct, createdAt: nowIso() };
  man.updatedAt = nowIso();
  await writeManifest(dir, { ...man, dir });
  return { fileId: id, name: fileName, size: buffer.length, contentType: ct, path: abs, storage: 'local' };
}

/** 台账 + 落盘文件都在 → 返回本地元数据；没传过或文件被手删 → null。 */
export async function localResolve(fileId) {
  const id = String(fileId ?? '').trim();
  if (!id) return null;
  const dir = localDir();
  const man = await readManifest(dir);
  const rec = man.files[id];
  if (!rec || !rec.name) return null;
  const abs = join(dir, String(rec.name));
  if (!existsSync(abs)) return null;
  return {
    fileId: id,
    path: abs,
    name: String(rec.name),
    size: Number(rec.size) || 0,
    contentType: String(rec.contentType || ''),
    storage: 'local',
  };
}

/** 本地仓全部在盘条目（id → 元数据），供领取侧批量标注。 */
export async function localIndex() {
  const dir = localDir();
  const man = await readManifest(dir);
  const index = new Map();
  for (const [id, rec] of Object.entries(man.files)) {
    const abs = join(dir, String(rec?.name || ''));
    if (rec?.name && existsSync(abs)) {
      index.set(id, {
        fileId: id,
        path: abs,
        name: String(rec.name),
        size: Number(rec.size) || 0,
        contentType: String(rec.contentType || ''),
        storage: 'local',
      });
    }
  }
  return { dir, index };
}

/** 本地文件读流（HTTP 透传给面板 <img> 用）；调用方先 localResolve 确认在盘。 */
export function localReadStream(absPath) {
  return createReadStream(absPath);
}
