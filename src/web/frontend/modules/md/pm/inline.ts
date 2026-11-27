// PM 内核 M1 行内层：markdown 行内文本 ↔ PM inline 节点（text + marks）。
//
// 语义对齐 md-render.ts 的 inline() 主链与 model/ 各行内规则（顺序敏感处一致）：
//   转义(\X) → 代码 span(`x`) → 粗体(**x**) → 链接([t](u)，三类目标、文本原子) →
//   斜体(*x*) / 删除线(~~x~~) / 高亮(==x==)
// 与渲染器的差异（M1 刻意为之，round-trip 字节保真优先）：
//   - 双链 [[..]] / 脚注 [^..] / 行内公式 $..$ / 图片 ![..](..) / 裸 URL /
//     尖括号自动链接 / 引用式链接 **不解析**——原样留在 text 里，序列化原样还原；
//   - 链接文本原子（渲染器顺序保证 <a> 内部不再套强调，这里同口径）；
//   - 链接目标只认三类（http 外链 / nxkv://task|ref 内链 / 32hex fileId 附件），
//     其余括号形态保持字面；strong 与 em 不可嵌套（渲染器自身的表达边界）。
// 序列化对会重新触发解析的字符做最小转义（`\` `` ` `` `*` `~` `=`、链接文本内的
// `]`、行首 `#`），与 escapePreRule 的还原语义互为镜像。
import type { Node as PMNode, Schema } from 'prosemirror-model';
import { mdMark } from './schema.js';

/** 一段行内文本与其标记名集合（tokenizer 的中间产物）。 */
interface Run {
  text: string;
  /** 标记名；链接是 `link:<kind>:<target>` 复合名（拆解见 markFor）。 */
  marks: string[];
}

/** 链接目标分类（与渲染器 looksLikeFileId / nxkv 前缀判定同口径）。 */
function linkKind(target: string): 'ext' | 'attach' | 'nxkv' | null {
  if (/^https?:\/\//.test(target)) return 'ext';
  if (/^nxkv:\/\/(?:task|ref)\//i.test(target)) return 'nxkv';
  if (/^[0-9a-f]{32}$/.test(target)) return 'attach';
  return null;
}

/**
 * 行内扫描：原始文本 → 带标记 run（递归承载标记嵌套）。
 * 扫描顺序即语义顺序；转义 `\X` 在扫描期就地消费成字面字符。
 */
function scanRuns(src: string, base: string[]): Run[] {
  const runs: Run[] = [];
  let plain = '';
  const flushPlain = () => {
    if (plain) {
      runs.push({ text: plain, marks: base });
      plain = '';
    }
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      // 反斜杠转义：下一字符按字面收（escapePreRule 的还原对偶）
      plain += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      // 代码 span：单层反引号对（渲染器 `([^`]+)` 口径）
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flushPlain();
        runs.push({ text: src.slice(i + 1, end), marks: [...base, 'code'] });
        i = end + 1;
        continue;
      }
    }
    if (src.startsWith('**', i)) {
      // 粗体：内容不含 *（渲染器 `\*\*([^*]+)\*\*` 口径）
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flushPlain();
        runs.push(...scanRuns(src.slice(i + 2, end), [...base, 'strong']));
        i = end + 2;
        continue;
      }
    }
    if (ch === '[') {
      // 链接（原子）：[text](target)——三类目标才成链，否则整体按字面
      const close = src.indexOf(']', i + 1);
      if (close > i + 1 && src[close + 1] === '(') {
        const pEnd = src.indexOf(')', close + 2);
        if (pEnd > close + 2) {
          const target = src.slice(close + 2, pEnd).trim();
          const kind = linkKind(target);
          if (kind && !/\s/.test(target)) {
            flushPlain();
            runs.push({ text: src.slice(i + 1, close), marks: [...base, `link:${kind}:${target}`] });
            i = pEnd + 1;
            continue;
          }
        }
      }
    }
    if (ch === '*' && src[i + 1] !== '*' && src[i - 1] !== '*') {
      // 斜体：单 *，内容不含 * 与换行（emphasisInlineRule 口径；`_x_` 刻意不认）
      let j = i + 1;
      while (j < src.length && src[j] !== '*' && src[j] !== '\n') j += 1;
      if (src[j] === '*' && j > i + 1 && src[j + 1] !== '*') {
        flushPlain();
        runs.push(...scanRuns(src.slice(i + 1, j), [...base, 'em']));
        i = j + 1;
        continue;
      }
    }
    if (src.startsWith('~~', i)) {
      const end = src.indexOf('~~', i + 2);
      if (end > i + 2) {
        flushPlain();
        runs.push(...scanRuns(src.slice(i + 2, end), [...base, 'strike']));
        i = end + 2;
        continue;
      }
    }
    if (src.startsWith('==', i)) {
      const end = src.indexOf('==', i + 2);
      if (end > i + 2) {
        flushPlain();
        runs.push(...scanRuns(src.slice(i + 2, end), [...base, 'highlight']));
        i = end + 2;
        continue;
      }
    }
    plain += ch;
    i += 1;
  }
  flushPlain();
  return runs;
}

/** `link:<kind>:<target>` 复合名 → schema mark（其余名字直取同名 mark）。 */
function markFor(schema: Schema, name: string): PMNode['marks'] {
  if (!name.startsWith('link:')) return [mdMark(schema, name).create()];
  const rest = name.slice('link:'.length);
  const sep = rest.indexOf(':');
  if (sep < 0) return [mdMark(schema, 'link').create({ href: rest, kind: 'ext' })];
  const kind = rest.slice(0, sep);
  const target = rest.slice(sep + 1);
  return [mdMark(schema, 'link').create({ href: target, kind })];
}

/** 行内文本 → PM inline 节点数组（段落 / 标题的内容）。 */
export function parseInline(text: string, schema: Schema): PMNode[] {
  const nodes: PMNode[] = [];
  for (const run of scanRuns(text, [])) {
    const marks = run.marks.map((m) => markFor(schema, m)).flat();
    if (run.text) nodes.push(schema.text(run.text, marks));
  }
  return nodes;
}

/** 节点的标记名集合（link 归一为 'link'，排序后作分组键）。 */
function markNames(node: PMNode): string {
  return node.marks
    .map((m) => (m.type.name === 'link' ? 'link' : m.type.name))
    .sort()
    .join(',');
}

/** 会重新触发解析的字面字符 → 转义（链接文本的 `]` 由链接分支单独处理）。 */
function escapeText(s: string): string {
  return s.replace(/[\\`*=~]/g, (c) => `\\${c}`);
}

/**
 * 无标记文本的**字节保真快路**：直排结果重解析后必须仍是「唯一、无标记、文本
 * 全等」——源文里的孤立 `*` / 反引号不被无谓转义（`a * b` 原样），而真正会
 * 配对成形的（`x **y** z`、`` `code` ``）走全转义。字符串相等不够（结构可能
 * 已变），必须按结构判。
 */
/** 无标记快路需要验证的语法字符（`[ ]` 触发验证——链接形态的门在此把关）。 */
const SYNTAX_CHARS = /[\\`*=~[\]]/;

function roundTripStable(schema: Schema, body: string): boolean {
  if (!SYNTAX_CHARS.test(body)) return true;
  const nodes = parseInline(body, schema);
  if (nodes.length !== 1) return false;
  const only = nodes[0];
  if (!only || only.type.name !== 'text' || only.marks.length > 0) return false;
  return only.text === body;
}

/** 单标记包裹对（strong/em/strike/highlight；多种标记并存时 M1 不包裹）。 */
const WRAP_PAIRS: Record<string, [string, string]> = {
  strong: ['**', '**'],
  em: ['*', '*'],
  strike: ['~~', '~~'],
  highlight: ['==', '=='],
};

/**
 * 行内节点序列化回 markdown 文本（换行即段内软换行）。
 * 相邻同标记的 text 先合并再整段包裹，避免 `**a****b**` 粘连；
 * 链接逐节点还原 `[text](href)`（链接文本原子，无合并）；
 * 无标记文本走 roundTripStable 快路保字节。
 */
export function serializeInline(nodes: readonly PMNode[], schema: Schema): string {
  interface Group {
    names: string;
    items: PMNode[];
  }
  const groups: Group[] = [];
  for (const node of nodes) {
    const isBreak = node.type.name === 'hardBreak';
    const names = isBreak ? '\n' : markNames(node);
    const last = groups[groups.length - 1];
    if (last && last.names === names && node.type.name === 'text') {
      last.items.push(node);
    } else {
      groups.push({ names, items: [node] });
    }
  }
  let out = '';
  for (const group of groups) {
    if (group.names === '\n') {
      out += '\n';
      continue;
    }
    const body = group.items
      .map((n) => (n.type.name === 'hardBreak' ? '\n' : n.textContent))
      .join('');
    const names = group.names ? group.names.split(',') : [];
    if (names.length === 1 && names[0] === 'code') {
      out += `\`${body}\``;
      continue;
    }
    if (names.length === 1 && names[0] === 'link') {
      for (const node of group.items) {
        const link = node.marks.find((m) => m.type.name === 'link');
        const href = String(link?.attrs.href ?? '');
        out += `[${escapeText(node.textContent).replace(/\]/g, '\\]')}](${href})`;
      }
      continue;
    }
    let text = names.length ? escapeText(body) : body;
    if (!names.length && !roundTripStable(schema, text)) text = escapeText(body);
    const wrapName = names.length === 1 ? names[0] : undefined;
    if (wrapName) {
      const pair = WRAP_PAIRS[wrapName];
      if (pair) text = `${pair[0]}${text}${pair[1]}`;
    }
    out += text;
  }
  return out;
}
