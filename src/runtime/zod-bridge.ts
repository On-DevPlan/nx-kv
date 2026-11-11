// zod 桥接层：zod schema ↔ CLI/HTTP 形态的转换。
//
// **zod 能替代「校验」，替代不了「归一化」。** zod 的 schema 面向「已成形的数据」：
// HTTP JSON body 里 number 就是 number；CLI argv 里一切都是字符串，HTTP query 里
// 也都是字符串。同一份 schema 要同时吃两种形态，中间必须有一层把文本归一成
// schema 期待的形状——这一层只能从 schema 的内部结构反推（zod 没有公开的
// 「CLI 形态」概念），所以：
//
//   - 归一化规则是**代码**，不是 schema：随 schema 变化自动跟随，但规则本身写死；
//   - 归一化必须知道每个字段是 number / boolean / array / kv / raw，
//     而 zod 不暴露这个信息，只能读 `_zod.def.type`（**内部 API，随版本可能变**——
//     zod 升级先看这里）；
//   - `z.coerce` 不能直接用：`z.coerce.boolean()` 把字符串 'false' 变成 true，
//     `z.coerce.number()` 把空串变成 0。两个都与既有 CLI 语义冲突，必须自己写。
//
// 与模板的一处刻意差异：kind 里没有 'json' 只有 **'raw'**——继承 legacy flags 的
// 既有语义（原样透传，不做字符串化、也不 JSON.parse 字符串）。可见域 scope 这类
// 「值本身是数组/对象」的字段靠它活着：走 'json' 会把 CLI 的裸字符串强行 parse，
// 语义就变了。CLI 侧要传结构化值时用 `--set k=v`（kv）或显式 JSON 文本。
//
// 「用法:」前缀是**对外契约**：assets 文档教 agent 用错误文本里的「用法:」判定
// 参数错误，不得丢。
import { badInput } from '../core/errors.js';
import type { ZodType } from 'zod';

export type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'kv' | 'raw';

export interface FieldDesc {
  name: string;
  kind: FieldKind;
  /** 位置参数（按 args 顺序消费 argv），其余是 --flag */
  positional: boolean;
  /** 没有 default 且非 optional → 必填 */
  required: boolean;
  default?: unknown;
  enumValues?: string[];
}

interface Unwrapped {
  inner: unknown;
  optional: boolean;
  defaultValue?: unknown;
}

/**
 * 拆掉 optional / nullable / default 外壳，拿到真正的类型 schema。
 * 读的是 zod v4 的 `_zod.def`（内部 API）——zod 没有公开的「取内层类型」方法。
 */
function unwrap(field: unknown): Unwrapped {
  let cur = field as { _zod?: { def?: Record<string, unknown> } };
  let optional = false;
  let defaultValue: unknown;
  for (;;) {
    const def = cur?._zod?.def;
    const tag = def?.type;
    if (tag === 'optional' || tag === 'nullable') {
      optional = true;
      cur = (def?.innerType as typeof cur) ?? cur;
      continue;
    }
    if (tag === 'default') {
      const dv = def?.defaultValue;
      defaultValue = typeof dv === 'function' ? (dv as () => unknown)() : dv;
      cur = (def?.innerType as typeof cur) ?? cur;
      continue;
    }
    break;
  }
  return { inner: cur, optional, defaultValue };
}

function kindOf(inner: unknown): FieldKind {
  const tag = (inner as { _zod?: { def?: { type?: string } } })?._zod?.def?.type;
  switch (tag) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return 'enum';
    case 'array':
      return 'array';
    case 'record':
      return 'kv';
    case 'unknown':
    case 'any':
      return 'raw';
    default:
      return 'string';
  }
}

function enumValuesOf(inner: unknown): string[] {
  const def = (inner as { _zod?: { def?: { entries?: Record<string, string> } } })?._zod?.def;
  return Object.values(def?.entries ?? {});
}

/**
 * 把 action 的 input schema 拆成逐字段说明（CLI 与 HTTP 共用同一份）。
 *
 * **顺序很重要**：位置参数按 `args` 的声明顺序消费 argv，不是按 schema 字段顺序。
 * 两者不一致时按 schema 顺序会把值对调——所以这里先把位置参数按 args 顺序
 * 排到前面，其余字段保持 schema 顺序。
 */
export function describeInput(input: ZodType, args: readonly string[] = []): FieldDesc[] {
  const shape = (input as unknown as { shape: Record<string, unknown> }).shape;
  const positionalIndex = new Map(args.map((n, i) => [n, i]));
  const entries = Object.entries(shape).sort(([an], [bn]) => {
    const ai = positionalIndex.get(an);
    const bi = positionalIndex.get(bn);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return 0;
  });
  const out: FieldDesc[] = [];
  for (const [name, field] of entries) {
    const { inner, optional, defaultValue } = unwrap(field);
    const kind = kindOf(inner);
    out.push({
      name,
      kind,
      positional: positionalIndex.has(name),
      required: !optional && defaultValue === undefined,
      default: defaultValue,
      enumValues: kind === 'enum' ? enumValuesOf(inner) : undefined,
    });
  }
  return out;
}

/** CLI 文本 / HTTP query / 路由参数 → schema 期待的值。 */
export function normalizeCliValue(desc: FieldDesc, raw: unknown): unknown {
  // 裸 flag（`--depth` 后面没跟值）会被解析器记成 true。
  // 放任下去：Number(true) === 1 会静默变成「深度 1」这种另一个合法值，
  // String(true) 则会把路径变成 'true'。宁可报错，也不要把笔误变成别的语义。
  if (raw === true && desc.kind !== 'boolean') {
    throw badInput(`参数 --${desc.name} 需要提供值`);
  }

  switch (desc.kind) {
    case 'number': {
      const s = String(raw).trim();
      if (s === '') throw badInput(`参数 --${desc.name} 需要提供值`);
      const n = Number(s);
      if (!Number.isFinite(n)) throw badInput(`参数 ${desc.name} 必须是数字，收到: ${String(raw)}`);
      return n;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (raw === true) return true; // 裸 `--flag` = 打开
      const s = String(raw).toLowerCase();
      // zod 的 coerce.boolean() 会把 'false' 变成 true —— 这里必须自己判。
      return !(s === 'false' || s === '0' || s === 'no' || s === '');
    }
    case 'array': {
      if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
      return String(raw)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    }
    case 'kv': {
      // CLI：可重复的 `--set k=v`（解析器把同名 flag 收成数组）
      // HTTP：{k: v} 对象或 ['k=v'] 数组
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...(raw as object) };
      const list = Array.isArray(raw) ? raw : [raw];
      const out: Record<string, string> = {};
      for (const item of list) {
        const s = String(item);
        const eq = s.indexOf('=');
        if (eq <= 0) throw badInput(`参数 --${desc.name} 需要 key=value 形式，收到 ${JSON.stringify(item)}`);
        out[s.slice(0, eq).trim()] = s.slice(eq + 1);
      }
      return out;
    }
    case 'raw':
      // 原样透传（legacy 'raw' 的既有语义）：HTTP body 里已是结构化值的原样进；
      // CLI 的裸字符串**不**做 JSON.parse——scope 这类多形态字段的解析由 action 自己当家。
      return raw;
    default:
      // string / enum：原样透传（裸 flag 的情况已在函数开头的守卫里报错拦下）
      return String(raw);
  }
}

/**
 * 用 zod 校验输入（并应用 default）。失败时抛带「用法:」前缀的参数错误——
 * 「用法:」是对 agent 的分类契约，不得丢。
 */
export function parseZodInput(input: ZodType, values: Record<string, unknown>, usage: string): unknown {
  const result = input.safeParse(values);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join('.') || '(根)'} ${i.message}`)
    .join('；');
  throw badInput(`用法: ${usage} —— 参数不合法: ${issues}`);
}
