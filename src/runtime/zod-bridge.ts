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
import type { FieldDesc, ModelField, TypeNode } from '../core/contract-types.js';
import type { ZodType } from 'zod';

// 契约的数据形状统一由 core 定义（模块要读快照，而模块够不着 runtime）；
// 这里只负责「zod → 那些形状」的转换，并把类型再导出一次给 runtime 内部用。
export type { FieldDesc, ModelField, TypeNode };

/** 入参字段的 kind（形状定义在 core/contract-types.ts，这里只取别名）。 */
export type FieldKind = FieldDesc['kind'];

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


/** 取 zod schema 上的说明（.describe()）：help 的值占位符用它。 */
function hintOf(field: unknown): string | undefined {
  const d = (field as { description?: unknown })?.description;
  return typeof d === 'string' && d ? d : undefined;
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
    const hint = hintOf(field) || hintOf(inner);
    out.push({
      name,
      kind,
      positional: positionalIndex.has(name),
      required: !optional && defaultValue === undefined,
      default: defaultValue,
      enumValues: kind === 'enum' ? enumValuesOf(inner) : undefined,
      hint,
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

// ─────────────────────────── 出参（跨语言契约） ───────────────────────────
//
// 入参只需要「字段 + kind」这张扁平的说明（CLI/HTTP 归一化够用）；出参要生成别的
// 语言的**类型**，所以必须是**递归结构**：模型里嵌模型、数组里有模型。
//
// 这份 IR 是 JSON 安全的（就是 contract.json 里 output 字段的形状），
// 生成器只认它、不再碰 zod——契约快照因此可以入库对账、可以给端侧当版本号。

const pascal = (s: string): string => {
  const camel = s.replace(/[-_](\w)/g, (_m, c: string) => c.toUpperCase());
  return camel.charAt(0).toUpperCase() + camel.slice(1);
};

/** topics → Topic（数组元素命名用；短词不动，避免 'as' → 'a' 这种自伤） */
const singular = (s: string): string => (s.length > 3 && s.endsWith('s') ? s.slice(0, -1) : s);

/**
 * 把出参 schema 拆成递归类型树。
 *
 * 命名规则（固化成规则表，不做「智能猜测」）：
 *   - 根模型 = 调用方给的 rootName（如 `LocaltaskListOutput`）
 *   - 子模型 = 根名去掉 `Output` 后缀 + 字段名的 Pascal 形式
 *     （`LocaltaskListOutput` 的 `settings` → `LocaltaskListSettings`）
 *   - 数组元素 = 同上，但字段名取单数（`topics` → `LocaltaskListTopic`）
 *   - **同名不同形直接抛错**：生成器不猜、也不加数字后缀糊过去——
 *     真发生了说明命名该改，静默改名只会让端侧类型漂移得莫名其妙。
 */
export function describeOutput(output: ZodType, rootName: string): TypeNode {
  const seen = new Map<string, string>();
  const claim = (name: string, node: TypeNode): TypeNode => {
    const sig = JSON.stringify(node);
    const prev = seen.get(name);
    if (prev !== undefined && prev !== sig) {
      throw new Error(
        `出参模型名冲突：${name} 有两种不同形状。改字段名或显式拆模型，别让生成器猜。`,
      );
    }
    seen.set(name, sig);
    return node;
  };

  const walk = (schema: unknown, name: string): TypeNode => {
    const { inner } = unwrap(schema);
    const def = (inner as { _zod?: { def?: Record<string, unknown> } })?._zod?.def;
    const tag = def?.type as string | undefined;
    switch (tag) {
      case 'string':
        return { k: 'string' };
      case 'number':
        // z.int() 与 z.number() 在 zod v4 里同 tag，靠 format 区分
        return def?.format === 'safeint' ? { k: 'int' } : { k: 'number' };
      case 'boolean':
        return { k: 'bool' };
      case 'enum': {
        const values = Object.values((def?.entries ?? {}) as Record<string, string>);
        return claim(name, { k: 'enum', name, values });
      }
      case 'literal': {
        const values = ((def?.values ?? []) as unknown[]).map((v) => String(v));
        return claim(name, { k: 'enum', name, values });
      }
      case 'array':
        // 名字由调用方按「字段名单数化」算好（topics → LocaltaskListTopic），这里原样往下传
        return { k: 'list', of: walk(def?.element, name) };
      case 'record':
        return { k: 'map', of: walk(def?.valueType, name + 'Value') };
      case 'object': {
        const base = name.replace(/Output$/, '');
        const shape = (def?.shape ?? {}) as Record<string, unknown>;
        const fields: ModelField[] = Object.entries(shape).map(([fname, fs]) => {
          const u = unwrap(fs);
          const required = !u.optional && u.defaultValue === undefined;
          const hint = hintOf(fs) || hintOf(u.inner);
          // 数组字段的元素名取单数：topics → LocaltaskListTopic（而不是 …TopicsItem）
          const isList =
            (u.inner as { _zod?: { def?: { type?: string } } })?._zod?.def?.type === 'array';
          const childName = base + pascal(isList ? singular(fname) : fname);
          return { name: fname, required, type: walk(fs, childName), ...(hint ? { hint } : {}) };
        });
        return claim(name, { k: 'model', name, fields });
      }
      default:
        // date / union / unknown / any …：Dart 侧给 dynamic，不装作知道形状
        return { k: 'unknown' };
    }
  };

  const node = walk(output, rootName);
  if (node.k !== 'model') {
    throw new Error(`出参必须是 z.object({...}) 收口（收到 ${node.k}）——端侧根类型得是个模型`);
  }
  return node;
}
