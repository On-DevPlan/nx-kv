// schema-bridge：zod shape → PluginSchema（纯数据注册面）的桥（方案 §1.4 映射表）。
//
// 仿 runtime/zod-bridge.ts 的手法（unwrap/kindOf/description），但**不能复用它**——
// runtime/zod-bridge 不在 layering.test 的 MODULE_RUNTIME_CONTRACT 白名单里，模块
// import 它过不了分层测试。这里自持一份最小实现，升级警戒同款：
//   _zod.def 是 zod 内部 API——zod 升级先看本文件与 runtime/zod-bridge.ts / codegen.ts。
//
// 下钻规则（两层）：
//   - 顶层段（object）下钻到段内一级叶子：repo.name / attach.count / attach.list；
//   - 数组字段记 kind 'list'（元素不下钻——UI 变量目录不进到数组元素内部）；
//   - label 取 .describe() 的文本（zod-bridge 已验证该读取方式），无描述用字段名。
import type { FieldDecl, PluginSchema } from '../../shared/prompt-plugin.js';
import type { z } from 'zod';

/** 拆掉 optional / nullable / default / nullable 外壳（zod v4 内部 API，见头注释警戒）。 */
function unwrap(field: unknown): { inner: unknown; optional: boolean } {
  let cur = field as { _zod?: { def?: Record<string, unknown> } };
  let optional = false;
  for (;;) {
    const def = cur?._zod?.def;
    const tag = def?.type;
    if (tag === 'optional' || tag === 'nullable') {
      if (tag === 'optional') optional = true;
      cur = (def?.innerType as typeof cur) ?? cur;
      continue;
    }
    break;
  }
  return { inner: cur, optional };
}

function tagOf(inner: unknown): string {
  const tag = (inner as { _zod?: { def?: { type?: string } } })?._zod?.def?.type;
  return String(tag || '');
}

function enumValuesOf(inner: unknown): string[] {
  const def = (inner as { _zod?: { def?: { entries?: Record<string, string> } } })?._zod?.def;
  return Object.values(def?.entries ?? {});
}

function hintOf(field: unknown): string | undefined {
  const d = (field as { description?: unknown })?.description;
  return typeof d === 'string' && d ? d : undefined;
}

/** shape 递归下钻到段内一级叶子（深度 ≤2）。 */
function walk(prefix: string, node: unknown, out: FieldDecl[], depth: number): void {
  const { inner } = unwrap(node);
  const hint = hintOf(node) || hintOf(inner);
  const label = hint || prefix;
  const tag = tagOf(inner);
  if (depth > 0 && (tag === 'object' || tag === 'loose_object' || tag === 'strict_object')) {
    const def = (inner as { _zod?: { def?: { shape?: Record<string, unknown> } } })?._zod?.def;
    const shape = (def?.shape ?? {}) as Record<string, unknown>;
    for (const [k, child] of Object.entries(shape)) walk(`${prefix}.${k}`, child, out, depth - 1);
    return;
  }
  let kind: FieldDecl['kind'] = 'string';
  let enumValues: readonly string[] | undefined;
  switch (tag) {
    case 'number': case 'int': kind = 'number'; break;
    case 'boolean': kind = 'boolean'; break;
    case 'enum': kind = 'enum'; enumValues = enumValuesOf(inner); break;
    case 'array': kind = 'list'; break;
    default: kind = 'string'; break; // string / literal / 其余 → 文本
  }
  out.push({ key: prefix, kind, label, ...(hint && hint !== prefix ? { desc: hint } : {}), ...(enumValues ? { enumValues } : {}) });
}

/**
 * zod strictObject shape → PluginSchema。
 * fields：顶层段 + 段内一级叶子（模板变量白名单与 UI 目录的唯一来源）。
 * blank：全字段声明 default 时可派生（safeParse({})）；派生不出为 null（UI 不强求初值）。
 */
export function pluginSchemaOf<S extends z.ZodObject<z.ZodRawShape>>(schema: S): PluginSchema<unknown> {
  const fields: FieldDecl[] = [];
  const def = (schema as unknown as { _zod?: { def?: { shape?: Record<string, unknown> } } })?._zod?.def;
  const shape = (def?.shape ?? {}) as Record<string, unknown>;
  for (const [k, child] of Object.entries(shape)) walk(k, child, fields, 1);
  let blank: unknown = null;
  try {
    blank = schema.parse({}) ?? null;
  } catch {
    blank = null; // 有 required 字段 → 派生不出零 I/O 占位
  }
  return { fields, blank };
}
