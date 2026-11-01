// 最小 ZIP 读写器：只用 node:zlib，不引入依赖。
//
// 用途：`repo export --zip` 把布局 JSON、说明文件与文档树打成一个包（换机/交接时一个文件带走），
// `repo import` 直接吃这个包（v4 起 zip 是导出的本体，导入端必须能拆包）。
// 读写同源：本地文件头 + 数据 + 中央目录 + EOCD，deflate（method 8）。
// 不支持压缩级别调优、加密、ZIP64（>4GB 或 >65535 条目才需要，导出物远不到；读取时遇到就拒绝）。
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { badInput } from './errors.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/**
 * 打包。entries: [{ name: 'a/b.json', data: Buffer|string }]
 * 返回 Buffer。
 */
export function makeZip(entries, { mtime = new Date(0) } = {}) {
  const { time, date } = dosTime(mtime);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const deflated = deflateRawSync(raw);
    // 压缩后更大就存原始（STORE=0）——小文件常见，省不了反而浪费 CPU
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // version needed
    local.writeUInt16LE(0x0800, 6);    // flags: UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);        // extra len
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);      // version made by
    central.writeUInt16LE(20, 6);      // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);      // extra
    central.writeUInt16LE(0, 32);      // comment
    central.writeUInt16LE(0, 34);      // disk
    central.writeUInt16LE(0, 36);      // internal attrs
    central.writeUInt32LE(0, 38);      // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ─── 读取 ─────────────────────────────────────────────────────────────

// 解压总量上限：远大于任何真实导出物，但能在几个数量级之前拦住 zip bomb
// （几十 MB 的包解出几个 GB，把内存吃满——读取外部文件必须设防）。
const MAX_TOTAL_UNCOMPRESSED = 64 * 1024 * 1024;

/**
 * 拆包。返回 [{ name, data: Buffer }]（保持中央目录顺序）。
 * 只认「本地文件头 + 数据 + 中央目录 + EOCD」布局；拒 ZIP64 与加密位。
 * 尺寸一律以中央目录为准——本地头在有 data descriptor 时尺寸位是 0，不可信。
 */
export function readZip(buf) {
  const u8 = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  // EOCD 从尾部往前找签名（容忍 ZIP 注释，注释最长 65535）
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (u8.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw badInput('不是 zip 文件（找不到 EOCD）');
  const total = u8.readUInt16LE(eocd + 10);
  const cdSize = u8.readUInt32LE(eocd + 12);
  const cdOff = u8.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) {
    throw badInput('不支持 ZIP64 的 zip 包');
  }
  const out = [];
  let p = cdOff;
  let acc = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > u8.length || u8.readUInt32LE(p) !== 0x02014b50) throw badInput('zip 中央目录损坏');
    const flags = u8.readUInt16LE(p + 8);
    const method = u8.readUInt16LE(p + 10);
    const compSize = u8.readUInt32LE(p + 20);
    const nameLen = u8.readUInt16LE(p + 28);
    const extraLen = u8.readUInt16LE(p + 30);
    const commentLen = u8.readUInt16LE(p + 32);
    const localOff = u8.readUInt32LE(p + 42);
    if (flags & 0x1) throw badInput('不支持加密的 zip 包');
    if (compSize === 0xffffffff || localOff === 0xffffffff) throw badInput('不支持 ZIP64 的 zip 包');
    const name = u8.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    // 数据区从本地头自己的名字/extra 长度算起——两条记录的长度可能不同
    if (localOff + 30 > u8.length || u8.readUInt32LE(localOff) !== 0x04034b50) throw badInput('zip 本地文件头损坏');
    const lNameLen = u8.readUInt16LE(localOff + 26);
    const lExtraLen = u8.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    if (start + compSize > u8.length) throw badInput('zip 数据区越界（包已损坏）');
    const raw = u8.slice(start, start + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw);
    else throw badInput('不支持的 zip 压缩方法: ' + method);
    acc += data.length;
    if (acc > MAX_TOTAL_UNCOMPRESSED) throw badInput('zip 解压总量超过 64MB 上限（疑似 zip bomb）');
    out.push({ name, data });
  }
  return out;
}
