// tasktool/attach-template.js —— 交付 instruction〔附件〕段的模板 ctx 与渲染。
//
// 输出由模板渲染（内置 DEFAULT_ATTACH_TEMPLATE 或配置模板），保证「配置模板」与
// 「内置默认」走同一份 ctx、同一套口径；渲染失败时用最朴素的逐条文本兜底
// （fail-open：附件路径必须到达 agent，模板写错不许吞掉附件信息）。
import { isAbsolute } from 'node:path';
import { renderInstruction } from '../../core/instruction-template.js';
import { DEFAULT_ATTACH_TEMPLATE } from '../../shared/prompt-blocks.js';
import { isImageName } from '../../core/fileapi.js';
import { hostOfUrl, kindLabelOf, ORIGIN_LABEL, sizeTextOf, STATUS_LABEL } from './attach-resource.js';

/**
 * 单条附件的模板 ctx。
 *
 * 通用字段（所有类型都有）：kind / kindLabel / name / size / sizeText / mime /
 * storage / role / origin / originLabel / usage / cmd / locator / needsSync。
 * 类型专属子对象（只有对应类型才有）：
 *   file → { localPath, fileId, exists, syncCmd }
 *   url  → { href, host }
 *   task → { taskId, topicKey, topicName, seq, title, status, statusLabel,
 *            address, storedAddress, addressDrift, resolved, purged, deleted, showCmd }
 *   ref  → { refId, title, relPath, readCmd, content, truncated }
 *     content 只在「文档资料」绑定（role='doc'，交付读全文）且真的读到时非空。
 *   mdfile → { absPath, anchorDir, content, truncated, stale, missing, readCmd }
 *     content 是读时从磁盘现取的正文（截断 2 万字）；missing 时为空、stale 表示指纹漂移。
 * 通用 note = 边上的说明（desc，#162）：attach --note 的落点，清单行透出。
 * 旧模板兼容：平铺别名 localPath / fileId / urlText / href / taskId / title /
 * seq / showCmd / refId / relPath / readCmd / target / area / areaLabel。
 */
function ctxItemOf(a: any): any {
  const kind = ['url', 'task', 'ref', 'mdfile'].includes(a.kind) ? a.kind : 'file';
  const isImage = kind === 'file' && (a.isImage === undefined ? isImageName(a.name, a.mime) : !!a.isImage);
  const role = String(a.role || '');
  const origin =
    a.origin === 'area' || a.area === 'area' || (!a.origin && !a.area && (role === 'attach' || role === 'doc'))
      ? 'area'
      : 'inline';
  const size = Number(a.size) || 0;
  const item = {
    id: String(a.id || ''),
    kind,
    kindLabel: kindLabelOf(kind, isImage),
    isImage,
    name: String(a.name || ''),
    size,
    sizeText: a.sizeText || sizeTextOf(size),
    mime: String(a.mime || ''),
    storage: String(a.storage || ''),
    role: String(a.role || ''),
    origin,
    originLabel: a.originLabel || ORIGIN_LABEL[origin],
    usage: String(a.usage || ''),
    cmd: String(a.cmd || ''),
    locator: String(a.locator || ''),
    needsSync: !!a.needsSync,
    // 边上的说明（desc，#162）：清单行用 {{#if note}} 透出，agent 据此决定是否深入
    note: String(a.note || ''),
    // 兼容旧字段
    area: origin,
    areaLabel: a.areaLabel || ORIGIN_LABEL[origin],
    target: String(a.target || ''),
    targetKind: String(a.targetKind || ''),
    targetKey: String(a.targetKey || ''),
    targetSeq: a.targetSeq === null || a.targetSeq === undefined ? null : Number(a.targetSeq),
  };

  if (kind === 'file') {
    const fileId = String(a.fileId || a.id || '');
    const localPath = String(a.localPath || '');
    const exists = a.exists === undefined ? !!localPath : !!a.exists;
    const syncCmd = String(a.syncCmd !== undefined ? a.syncCmd : exists ? '' : `nx-kv file sync --ids ${fileId}`);
    const file = { localPath, fileId, exists, syncCmd };
    const usage = String(a.usage || (exists
      ? `已在本机：直接读取 ${localPath}`
      : `尚未同步到本地（fileId ${fileId}）：先运行 ${syncCmd}，再读取本机副本`));
    const cmd = String(a.cmd !== undefined ? a.cmd : exists ? '' : syncCmd);
    return {
      ...item,
      ...file,
      path: localPath,
      file,
      usage,
      cmd,
      locator: String(a.locator || (exists ? localPath : `未同步（fileId ${fileId}）`)),
      needsSync: a.needsSync === undefined ? !exists : !!a.needsSync,
    };
  }

  if (kind === 'url') {
    const href = String(a.href || (typeof a.url === 'string' ? a.url : '') || '');
    const host = String(a.host || hostOfUrl(href));
    return {
      ...item,
      href,
      host,
      urlText: href,
      url: { href, host },
      usage: String(a.usage || `外部链接，可直接抓取：${href}`),
      locator: String(a.locator || href),
      needsSync: false,
    };
  }

  if (kind === 'task') {
    const seq = Number(a.seq) || Number(a.targetSeq) || 0;
    const topicKey = String(a.topicKey || a.targetKey || '');
    const showCmd = String(a.showCmd || `nx-kv localtask show --id ${seq}${topicKey ? ` --key ${topicKey}` : ''}`);
    const title = String(a.title || '');
    const task = {
      taskId: Number(a.taskId) || 0,
      topicKey,
      topicName: String(a.topicName || ''),
      seq,
      title,
      status: String(a.status || ''),
      statusLabel: String(a.statusLabel || STATUS_LABEL[a.status] || a.status || ''),
      address: String(a.address || `${topicKey}:${seq}`),
      storedAddress: String(a.storedAddress || `${topicKey}:${seq}`),
      addressDrift: !!a.addressDrift,
      resolved: a.resolved === undefined ? true : !!a.resolved,
      purged: !!a.purged,
      deleted: !!a.deleted,
      showCmd,
    };
    return {
      ...item,
      ...task,
      task,
      usage: String(a.usage || `这是任务引用而不是副本（地址 ${task.address}）：用 ${showCmd} 读取最新正文`),
      cmd: String(a.cmd !== undefined ? a.cmd : showCmd),
      locator: String(a.locator || `#${seq} ${title}${task.topicName || topicKey ? ` · ${task.topicName || topicKey}` : ''}`),
      needsSync: false,
    };
  }

  if (kind === 'mdfile') {
    const absPath = String(a.absPath || a.localPath || '');
    const anchorDir = String(a.anchorDir || '');
    const content = String(a.mdContent || '');
    const truncated = !!a.mdTruncated;
    const stale = !!a.mdStale;
    const missing = a.mdMissing === undefined ? !absPath : !!a.mdMissing;
    const readCmd = String(a.readCmd || `nx-kv docs mdfile ${item.id}`);
    const mdfile = { absPath, anchorDir, content, truncated, stale, missing, readCmd };
    const usage = String(a.usage || (missing
      ? `外部 md 文件当前不可读（${absPath || '路径为空'}）：用 ${readCmd} 查看状态`
      : `这是外部 md 文件（源文件不在库里）：用 ${readCmd} 读取磁盘当前内容${stale ? '；内容已变化，与登记指纹不一致' : ''}`));
    return {
      ...item,
      absPath,
      anchorDir,
      path: absPath,
      mdPath: absPath,
      content,
      truncated,
      stale,
      missing,
      mdfile,
      usage,
      cmd: String(a.cmd !== undefined ? a.cmd : readCmd),
      locator: String(a.locator || absPath || item.name),
      needsSync: false,
    };
  }

  const refId = String(a.refId || a.targetKey || '');
  const relPath = String(a.relPath || a.locator || '');
  // docTitle：文档资料绑定读到全文时提取的首行 # 标题（比文件名更说明内容，#162）
  const title = String(a.docTitle || a.title || String(a.name || '').replace(/\.md$/i, ''));
  const readCmd = String(a.readCmd || (relPath
    ? `nx-kv docs get ${isAbsolute(relPath) ? `path:${relPath}` : `rel:${relPath}`}`
    : ''));
  const content = String(a.docContent || '');
  const truncated = !!a.docTruncated;
  const ref = { refId, title, relPath, readCmd, content, truncated };
  // 文档资料绑定（role='doc'，#162）：读到了全文 → usage 指向「文档原文」段；
  // 没读到（fail-open）→ 退回普通取用命令，不假装内容存在。
  // 外部 md 未登记附件时必须说清楚「为什么没有正文」并给登记命令，
  // 否则用户会以为文档本身是空的（2026-11 收口口径）。
  let usage = String(a.usage || '');
  if (a.role === 'doc') {
    usage = content
      ? `这是文档资料绑定（进原文）：全文已附在本清单末尾的「文档原文」段${truncated ? `，内容有截断——完整版用 ${readCmd} 读取` : ''}`
      : a.docMissing
        ? `这是文档资料绑定（进原文），但无法内联：${String(a.docMissingReason || '正文缺失')}` +
          `${a.docRegisterCmd ? `。先登记为附件：${a.docRegisterCmd}` : ''}` +
          `${readCmd ? `；登记后用 ${readCmd} 读取` : ''}`
        : readCmd
          ? `这是文档资料绑定（进原文），但本次未能读到全文：用 ${readCmd} 读取`
          : `这是文档资料绑定（进原文），但本次未能读到全文（refId ${refId}）：先用 nx-kv docs list 定位路径，再 docs get 读取`;
  } else {
    usage = usage || (readCmd
      ? `这是文档库里的 md 文件：用 ${readCmd} 读取`
      : `这是文档库里的 md 文件（refId ${refId}）：先用 nx-kv docs list 定位路径，再 docs get 读取`);
  }
  return {
    ...item,
    ...ref,
    ref,
    usage,
    cmd: String(a.cmd !== undefined ? a.cmd : readCmd),
    locator: String(a.locator || `${title}${relPath ? `（${relPath}）` : ''}`),
    needsSync: false,
  };
}

function syncSummaryOf(sync: any): any {
  if (!sync) return null;
  const failures = sync.failures || [];
  return {
    dir: sync.dir || '—',
    downloaded: Number(sync.downloaded) || 0,
    skipped: Number(sync.skipped) || 0,
    failureCount: failures.length,
    failures,
    text:
      `目录 ${sync.dir || '—'} · 下载 ${Number(sync.downloaded) || 0} · 跳过 ${Number(sync.skipped) || 0}` +
      (failures.length ? ` · 失败 ${failures.length}` : ''),
  };
}

/**
 * 附件模板 ctx（附件段与系统区块共用）。
 * 新语法：{{attach.count}}、`{{#each attach.list}}`（按类型分支的结构化元素）、
 * `{{#if attach.syncSummary}}`（本次跑过云端同步才出现）。
 * 旧写法 `{{#attach}}` / `{{attach.sync}}` / `{{attach.syncText}}` 已废弃，不再提供别名。
 */
export function attachTemplateCtx(attachments: unknown, sync: unknown): Record<string, any> {
  const list: any[] = Array.isArray(attachments) ? attachments : [];
  const items = list.map(ctxItemOf);
  return {
    attach: {
      count: items.length,
      // 两类来源分开计数：正文内嵌 vs 附件区（关系表里 role=attach/doc 的行）
      inlineCount: items.filter((a) => a.origin !== 'area').length,
      areaCount: items.filter((a) => a.origin === 'area').length,
      hasInline: items.some((a) => a.origin !== 'area'),
      hasArea: items.some((a) => a.origin === 'area'),
      needsSyncCount: items.filter((a) => a.needsSync).length,
      // 结构化数组：模板用循环组织清单，不再由服务端拼多行字符串。
      list: items,
      // 同步汇总只描述「这一次批量同步」；单条附件可达性看它自己的 file.localPath / file.exists
      syncSummary: syncSummaryOf(sync),
    },
  };
}

/**
 * 交付 instruction 里的〔附件〕段（纯函数）。
 *
 * 固定三段：总数（正文内嵌 X · 附件区 Y）/ 逐条清单 / 取用方式。
 * 输出由内置模板 DEFAULT_ATTACH_TEMPLATE 渲染，保证「配置模板」与「内置默认」
 * 走同一份 ctx、同一套口径；渲染失败时用最朴素的逐条文本兜底（fail-open）。
 *
 * 没有附件 → ''（整段消失）。
 */
export function attachmentInstruction(attachments: unknown, sync: unknown): string {
  const list: any[] = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return '';
  try {
    return renderInstruction(DEFAULT_ATTACH_TEMPLATE, attachTemplateCtx(list, sync));
  } catch {
    const ctx = attachTemplateCtx(list, sync).attach;
    const lines: string[] = [
      `〔附件〕本任务包含 ${ctx.count} 个附件（正文内嵌 ${ctx.inlineCount} · 附件区 ${ctx.areaCount}）。`,
      '附件清单：',
      ...ctx.list.map((a: any) => `- [${a.originLabel}] ${a.kindLabel} ${a.name}${a.locator ? `：${a.locator}` : ''}${a.note ? `  # ${a.note}` : ''}`),
      '取用方式：',
      ...ctx.list.map((a: any) => `- ${a.name}：${a.usage}`),
    ];
    if (ctx.syncSummary) lines.push(`同步情况：${ctx.syncSummary.text}`);
    // 文档原文段与默认模板同口径（#162）：模板挂了也不许把「进原文」的内容丢掉
    for (const a of ctx.list) {
      if (a.kind === 'ref' && a.ref && a.ref.content) {
        lines.push(`〔文档原文 · ${a.ref.title}〕（${a.ref.relPath}）：`, '', a.ref.content, '');
      }
      if (a.kind === 'mdfile' && a.mdfile && a.mdfile.content) {
        lines.push(`〔外部 md · ${a.name}〕（${a.mdfile.absPath}${a.mdfile.truncated ? '，已截断' : ''}${a.mdfile.stale ? '，内容有变化' : ''}）：`, '', a.mdfile.content, '');
      }
    }
    return lines.join('\n');
  }
}

/**
 * 〔附件〕段渲染（任务 #82 模板化；v4 起走 Handlebars）：
 *   - 配置了模板（attachment 区块当前生效模板）→ 模板渲染。ctx：{{task.id}}/{{task.text}}、
 *     {{attach.count}} / {{attach.inlineCount}} / {{attach.areaCount}}、
 *     `{{#each attach.list}}`（按 kind 分支的结构化清单，含各类型子对象）、
 *     `{{#if attach.syncSummary}}`（本次批量同步汇总）；
 *   - 旧占位符 / 旧闸门**不再兼容**（保存校验会拒绝旧语法，运行期回退内置默认）；
 *   - 空/未配置 → 内置默认（attachmentInstruction，与默认模板同一份 ctx）；
 *   - 渲染失败 → 回退内置默认（fail-open：附件路径必须到达 agent）。
 */
export function attachInstructionOf(tpl: unknown, attachments: unknown, sync: unknown, task: any): string {
  const list: any[] = Array.isArray(attachments) ? attachments : [];
  const t = String(tpl || '').trim();
  if (!t || !list.length) return attachmentInstruction(list, sync);
  try {
    return renderInstruction(t, {
      task: task ? { id: task.id, text: String(task.text || '') } : null,
      ...attachTemplateCtx(list, sync),
    });
  } catch {
    return attachmentInstruction(list, sync);
  }
}
