// schema-bridge：zod shape → PluginSchema（纯数据注册面）的桥（方案 §1.4 映射表）。
//
// 仿 runtime/zod-bridge.ts 的手法（unwrap/kindOf/description），但**不能复用它**——
// runtime/zod-bridge 不在 layering.test 的 MODULE_RUNTIME_CONTRACT 白名单里，模块
// import 它过不了分层测试。这里自持一份最小实现，升级警戒同款：
//   _zod.def 是 zod 内部 API——zod 升级先看本文件与 runtime/zod-bridge.ts / codegen.ts。
//
// 下钻规则（三层）：
//   - 顶层段（object）下钻到段内一级叶子：repo.name / attach.count / attach.list；
//   - 数组字段记 kind 'list'，并把**元素内部**再展开一层：`attach.list[].file.localPath`。
//     `[]` 只是目录里的记法——模板里在 `{{#each attach.list}}` 内部写的是相对路径
//     `{{file.localPath}}`，两者一眼能对上；
//   - 联合（union / discriminatedUnion）取**各分支字段的并集**：多 kind 的结构
//     （附件条目）不允许因为「它是 union」就在目录里消失。
//   - label 取 .describe() 的文本（zod-bridge 已验证该读取方式），无描述用字段名。
import type { FieldDecl, PluginSchema } from '../../shared/prompt-plugin.js';
import type { z } from 'zod';

/** 拆掉 optional / nullable / default 外壳（zod v4 内部 API，见头注释警戒）。 */
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

function defOf(inner: unknown): Record<string, unknown> | undefined {
  return (inner as { _zod?: { def?: Record<string, unknown> } })?._zod?.def;
}

function isObjectTag(tag: string): boolean {
  return tag === 'object' || tag === 'loose_object' || tag === 'strict_object';
}

function shapeOf(inner: unknown): Record<string, unknown> {
  return (defOf(inner)?.shape ?? {}) as Record<string, unknown>;
}

function elementOf(inner: unknown): unknown {
  return defOf(inner)?.element;
}

function optionsOf(inner: unknown): readonly unknown[] {
  const o = defOf(inner)?.options;
  return Array.isArray(o) ? o : [];
}

function enumValuesOf(inner: unknown): string[] {
  const def = defOf(inner) as { entries?: Record<string, string> } | undefined;
  return Object.values(def?.entries ?? {});
}

function hintOf(field: unknown): string | undefined {
  const d = (field as { description?: unknown })?.description;
  return typeof d === 'string' && d ? d : undefined;
}

/** shape 递归下钻（depth 是「还能往下拆几层 object」）。 */
function walk(prefix: string, node: unknown, out: FieldDecl[], depth: number): void {
  const { inner } = unwrap(node);
  const hint = hintOf(node) || hintOf(inner);
  const label = hint || prefix;
  const tag = tagOf(inner);
  const desc = hint && hint !== prefix ? { desc: hint } : {};

  if (isObjectTag(tag)) {
    const shape = shapeOf(inner);
    if (depth > 0 && Object.keys(shape).length) {
      for (const [k, child] of Object.entries(shape)) walk(`${prefix}.${k}`, child, out, depth - 1);
      return;
    }
    // 空对象 / 深度用尽：记成本段本身（模板里可整体 {{#if x}}）
    out.push({ key: prefix, kind: 'string', label, ...desc });
    return;
  }

  if (tag === 'array') {
    out.push({ key: prefix, kind: 'list', label, ...desc });
    // 元素内部多展开一层：attach.list[] → attach.list[].file.localPath
    const el = elementOf(inner);
    if (el !== undefined) walk(`${prefix}[]`, el, out, Math.max(depth, 1) + 1);
    return;
  }

  if (tag === 'union') {
    // 多分支取并集（discriminatedUnion 的每个 kind 都要在目录里可见）
    const opts = optionsOf(inner);
    if (!opts.length) {
      out.push({ key: prefix, kind: 'string', label, ...desc });
      return;
    }
    for (const opt of opts) walk(prefix, opt, out, depth);
    return;
  }

  let kind: FieldDecl['kind'] = 'string';
  let enumValues: readonly string[] | undefined;
  switch (tag) {
    case 'number': case 'int': kind = 'number'; break;
    case 'boolean': kind = 'boolean'; break;
    case 'enum': kind = 'enum'; enumValues = enumValuesOf(inner); break;
    default: kind = 'string'; break; // string / literal / 其余 → 文本
  }
  out.push({ key: prefix, kind, label, ...desc, ...(enumValues ? { enumValues } : {}) });
}

/** 同名字段去重：union 各分支会重复给公共字段，保留信息量更大的那条（带 enum 值优先）。 */
function dedupe(fields: FieldDecl[]): FieldDecl[] {
  const byKey = new Map<string, FieldDecl>();
  for (const f of fields) {
    const prev = byKey.get(f.key);
    if (!prev) {
      byKey.set(f.key, f);
      continue;
    }
    if (!prev.enumValues?.length && f.enumValues?.length) byKey.set(f.key, f);
  }
  return [...byKey.values()];
}

/**
 * zod strictObject shape → PluginSchema。
 * fields：顶层段 + 段内一级叶子（+ 数组元素内部一层）——模板变量白名单与 UI 目录的唯一来源。
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
  return { fields: dedupe(fields), blank };
}
