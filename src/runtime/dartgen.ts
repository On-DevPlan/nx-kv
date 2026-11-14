// Dart 发射器：契约快照 → 零依赖 Dart 包。
//
// 只认 IR（contract.ts 的 ContractSnapshot），不 import zod——这样 zod 内部结构
// 变化不会波及生成器，生成的产物也能靠 JSON 快照独立复现。
//
// 三条刻意的取舍：
//   1. **零依赖**：包只有 dart:core（+ 需要序列化数组入参时 dart:convert），
//      传输层由调用方注入（fr 侧塞 MnWsAppClient，自带应用前缀与设备令牌）。
//   2. **只做反序列化**：端侧是消费者，不需要 toJson。少一半代码、少一半漂移面。
//   3. **信封只拆一次**：`{ok,data}` / `{ok,error}` 的拆解写死在生成物里，
//      调用方永远拿强类型对象，也永远不需要知道 nx-kv 的信封长什么样。

import type { ContractSnapshot } from './contract.js';
import type { FieldDesc, TypeNode } from './zod-bridge.js';

/** Dart 保留字（参数名撞上就得加后缀）。 */
const DART_KEYWORDS = new Set([
  'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'covariant', 'default', 'deferred', 'do', 'dynamic', 'else', 'enum', 'export',
  'extends', 'extension', 'external', 'factory', 'false', 'final', 'finally', 'for', 'function',
  'get', 'hide', 'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library',
  'mixin', 'new', 'null', 'on', 'operator', 'part', 'required', 'rethrow', 'return', 'set',
  'show', 'static', 'super', 'switch', 'sync', 'this', 'throw', 'true', 'try', 'typedef', 'var',
  'void', 'while', 'with', 'yield',
]);

const camel = (s: string): string => s.replace(/[-_](\w)/g, (_m, c: string) => c.toUpperCase());
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const dartName = (s: string): string => {
  const n = lowerFirst(camel(s));
  return DART_KEYWORDS.has(n) ? n + 'Value' : n;
};
const docComment = (text: string | undefined, indent: string): string[] =>
  text ? [`${indent}/// ${text.replace(/\s+/g, ' ')}`] : [];

/** 收集树里所有模型 / 枚举（同名同形只留一份；同名不同形在 describeOutput 已拦）。 */
function collect(output: TypeNode, models: Map<string, TypeNode & { k: 'model' }>, enums: Map<string, string[]>): void {
  switch (output.k) {
    case 'model':
      if (models.has(output.name)) return;
      models.set(output.name, output);
      for (const f of output.fields) collect(f.type, models, enums);
      return;
    case 'enum':
      enums.set(output.name, output.values);
      return;
    case 'list':
    case 'map':
      collect(output.of, models, enums);
      return;
    default:
      return;
  }
}

/**
 * 入参去重：同一个 Dart 形参只能出现一次。
 *
 * 为什么会重名：action 的 input 允许「两种写法指向同一个字段」的别名
 * （`--goal-prompt` 与驼峰 `goalPrompt`，CLI 与 HTTP body 各用各的）。
 * 生成器按 camelCase 取形参名，两个别名就撞成同一个 `goalPrompt` ——
 * Dart 侧直接编译不过（duplicate parameter name）。这里按「优先没有连字符的写法」
 * 只留一个：发出去的 body 键名仍然是 action 声明过的，语义不变。
 */
function dedupeInput(input: FieldDesc[]): FieldDesc[] {
  const byName = new Map<string, FieldDesc>();
  for (const f of input) {
    const n = dartName(f.name);
    const prev = byName.get(n);
    if (!prev || (prev.name.includes('-') && !f.name.includes('-'))) byName.set(n, f);
  }
  return [...byName.values()];
}

/** Dart 类型名 */
function dartType(t: TypeNode): string {
  switch (t.k) {
    case 'string':
      return 'String';
    case 'int':
      return 'int';
    case 'number':
      return 'num';
    case 'bool':
      return 'bool';
    case 'unknown':
      return 'dynamic';
    case 'enum':
    case 'model':
      return t.name;
    case 'list':
      return `List<${dartType(t.of)}>`;
    case 'map':
      return `Map<String, ${dartType(t.of)}>`;
  }
}

/** 把 `src` 处的值读成目标类型（递归） */
function readExpr(t: TypeNode, src: string): string {
  switch (t.k) {
    case 'string':
      return `${src} as String`;
    case 'int':
      return `(${src} as num).toInt()`;
    case 'number':
      return `${src} as num`;
    case 'bool':
      return `${src} as bool`;
    case 'unknown':
      return src;
    case 'enum':
      return `${t.name}.values.byName(${src} as String)`;
    case 'model':
      return `${t.name}.fromJson(${src} as Map<String, dynamic>)`;
    case 'list':
      return `(${src} as List).map<${dartType(t.of)}>((e) => ${readExpr(t.of, 'e')}).toList()`;
    case 'map':
      return `(${src} as Map).map<String, ${dartType(t.of)}>((k, v) => MapEntry(k as String, ${readExpr(t.of, 'v')}))`;
  }
}

function emitEnums(enums: Map<string, string[]>): string {
  const out: string[] = [];
  for (const [name, values] of enums) {
    for (const v of values) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
        throw new Error(
          `枚举 ${name} 的值 ${JSON.stringify(v)} 不是合法 Dart 标识符；` +
            '要么改取值，要么给这个 action 换个出参（生成器不做改名映射，改名会静默漂移）',
        );
      }
    }
    out.push(`/// 取值：${values.join(' / ')}\nenum ${name} { ${values.join(', ')} }`);
  }
  return out.join('\n\n');
}

function emitModel(model: TypeNode & { k: 'model' }): string {
  const fields = model.fields;
  const lines: string[] = [];
  lines.push(`class ${model.name} {`);
  const ctorArgs = fields
    .map((f) => `${f.required ? 'required ' : ''}this.${dartName(f.name)}`)
    .join(', ');
  lines.push(`  const ${model.name}({${ctorArgs}});`);
  lines.push('');
  for (const f of fields) {
    lines.push(...docComment(f.hint, '  '));
    lines.push(`  final ${dartType(f.type)}${f.required ? '' : '?'} ${dartName(f.name)};`);
  }
  lines.push('');
  lines.push(`  factory ${model.name}.fromJson(Map<String, dynamic> json) => ${model.name}(`);
  for (const f of fields) {
    const key = `json['${f.name}']`;
    const expr = readExpr(f.type, key);
    lines.push(`        ${dartName(f.name)}: ${f.required ? expr : `${key} == null ? null : ${expr}`},`);
  }
  lines.push('      );');
  lines.push('}');
  return lines.join('\n');
}

/** 入参字段 → Dart 形参（GET 走 query，其余走 JSON body） */
function paramOf(f: FieldDesc): string {
  const type =
    f.kind === 'number'
      ? 'num'
      : f.kind === 'boolean'
        ? 'bool'
        : f.kind === 'array'
          ? 'List<String>'
          : f.kind === 'kv' || f.kind === 'raw'
            ? 'Map<String, dynamic>'
            : f.kind === 'enum'
              ? 'String'
              : 'String';
  // 位置参数上写 `required` 是语法错误（Dart 只允许命名参数带它）：
  // 必填与否已经由「非空类型 + 没有默认值」表达，这里不能再加修饰符。
  return `${type}${f.required ? '' : '?'} ${dartName(f.name)}`;
}

function methodNameOf(id: string, used: Set<string>): string {
  const parts = id.split('.');
  // 用**整条 id** 取名（localtask.list → localtaskList）：只取末段会让
  // localtask.list 与 docs.list 都叫 list，端侧天天撞名（设计里已把这条写成硬规则）
  const base = lowerFirst(camel(parts.join('-')));
  let name = base;
  if (used.has(name)) {
    const module = parts.length > 1 ? lowerFirst(camel(parts[parts.length - 2]!)) : 'action';
    name = `${module}${base.charAt(0).toUpperCase()}${base.slice(1)}`;
  }
  let n = 2;
  while (used.has(name)) name = `${base}${n++}`;
  used.add(name);
  return name;
}

/** Dart 包的文件集合（相对 contract/dart/ 的路径 → 内容）。 */
export function emitDartPackage(snapshot: ContractSnapshot): Record<string, string> {
  const models = new Map<string, TypeNode & { k: 'model' }>();
  const enums = new Map<string, string[]>();
  for (const a of snapshot.actions) collect(a.output, models, enums);

  const pkg = snapshot.app.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '_client';
  const rootModels = new Map(snapshot.actions.map((a) => [a.id, a.output] as const));

  // ---- models.dart ----
  const modelSrc = [
    '// GENERATED by nx-kv scripts/gen-dart-client.mjs —— 勿手改。',
    `// 契约指纹：${snapshot.hash}（nx-kv ${snapshot.version}）`,
    '',
    '// ignore_for_file: unnecessary_cast',
    '',
    emitEnums(enums),
    [...models.values()].map(emitModel).join('\n\n'),
  ]
    .filter((s) => s !== '')
    .join('\n') + '\n';

  // ---- api.dart ----
  const used = new Set<string>();
  const methodLines: string[] = [];
  for (const a of snapshot.actions) {
    const root = rootModels.get(a.id)!;
    if (root.k !== 'model') throw new Error(`action ${a.id} 的出参不是模型`);
    const [method, path] = (a.http ?? 'GET ').split(' ') as [string, string];
    const fields = dedupeInput(a.input);
    const params = fields.map(paramOf).join(', ');
    const isGet = method === 'GET' || method === 'HEAD';
    const body = isGet ? 'null' : bodyMap(fields);
    const query = isGet ? queryMap(fields) : 'const <String, String>{}';
    methodLines.push(
      [
        ...docComment(a.summary, '  '),
        `  /// action: ${a.id} · 认证/前缀由注入的 transport 负责`,
        `  Future<${root.name}> ${methodNameOf(a.id, used)}(${params}) async {`,
        `    final query = ${query};`,
        `    final body = ${body};`,
        `    final data = _unwrap(await _send('${method}', '${path}', query, body));`,
        `    return ${root.name}.fromJson(data);`,
        '  }',
      ].join('\n'),
    );
  }

  const needsConvert = snapshot.actions.some(
    (a) => (a.http ?? 'GET').startsWith('GET') && a.input.some((f) => f.kind === 'array' || f.kind === 'kv'),
  );

  const apiSrc = [
    '// GENERATED by nx-kv scripts/gen-dart-client.mjs —— 勿手改。',
    `// 契约指纹：${snapshot.hash}（nx-kv ${snapshot.version}）`,
    '',
    needsConvert ? "import 'dart:convert';" : '',
    "import 'models.dart';",
    '',
    '// 指纹对不上就是「端侧跑在旧契约上」的硬信号：拿它跟 GET /api/contract 的 hash 比。',
    `const String contractHash = '${snapshot.hash}';`,
    `const String contractVersion = '${snapshot.version}';`,
    '',
    '/// 传输层契约（由调用方注入）：返回**完整信封**（`{ok,data}` / `{ok,error}`）的 JSON。',
    '///',
    '/// fr 侧的实现只有一行：把 method/path/query/body 交给 MnWsAppClient，应用前缀与',
    '/// 设备令牌都由它负责——生成物不知道 nx-kv 挂在哪、也不需要知道。',
    'typedef NxKvTransport = Future<dynamic> Function(',
    '  String method,',
    '  String path,',
    '  Map<String, String> query,',
    '  Object? body,',
    ');',
    '',
    '/// 服务端信封里的业务错误。',
    'class NxKvApiException implements Exception {',
    '  NxKvApiException(this.message);',
    '',
    '  final String message;',
    '',
    '  @override',
    '  String toString() => \'NxKvApiException: $message\';',
    '}',
    '',
    'Map<String, dynamic> _unwrap(dynamic raw) {',
    '  if (raw is! Map) throw NxKvApiException(\'响应不是 JSON 对象：$raw\');',
    '  if (raw[\'ok\'] != true) throw NxKvApiException(\'\${raw["error"] ?? raw}\');',
    '  final data = raw[\'data\'];',
    '  if (data is! Map) throw NxKvApiException(\'data 不是对象：$data\');',
    '  return data.cast<String, dynamic>();',
    '}',
    '',
    `class ${pascalOf(pkg)}Api {`,
    `  ${pascalOf(pkg)}Api(this._send);`,
    '',
    '  final NxKvTransport _send;',
    '',
    methodLines.join('\n\n'),
    '}',
    '',
  ].join('\n');

  const entry = [
    '// GENERATED by nx-kv scripts/gen-dart-client.mjs —— 勿手改。',
    "export 'src/api.dart';",
    "export 'src/models.dart';",
    '',
  ].join('\n');

  return {
    // pubspec 的 description 只能是 ASCII —— 不是洁癖，是踩出来的：
    // pub 读 **git 源**的 pubspec 时按系统 ANSI 码页解码（Windows 中文 = GBK），
    // UTF-8 的多字节尾巴会把行尾 `\n` 一起吃进残缺的 GBK 字符里，于是
    // description 与 version 被拼成一行，报「Mapping values are not allowed here」，
    // 而错误信息指向的是 version 的冒号 —— 看着像缩进问题。
    // 同一个包用 path 引入却完全正常（path 源走 UTF-8 读），所以这个坑只在
    // 「锁 sha 的 git 依赖」这条真实消费路径上出现。
    'pubspec.yaml': [
      `name: ${pkg}`,
      `description: nx-kv contract client (${snapshot.hash}) - generated, zero deps.`,
      `version: ${snapshot.version}`,
      'publish_to: none',
      'environment:',
      "  sdk: '>=3.0.0 <4.0.0'",
      '',
    ].join('\n'),
    '.gitignore': [
      '# 生成器不产这两样；它们属于消费者，入库只会打架',
      '.dart_tool/',
      'pubspec.lock',
      '',
    ].join('\n'),
    'lib/nx_kv_client.dart': entry,
    'lib/src/models.dart': modelSrc,
    'lib/src/api.dart': apiSrc,
  };
}

function queryMap(input: FieldDesc[]): string {
  if (!input.length) return 'const <String, String>{}';
  const lines = input.map((f) => {
    const v = dartName(f.name);
    // 必填字段没有「没给」这种状态：它的 Dart 类型就是非空，写 `if (x != null)` 只会
    // 让 analyzer 报 unnecessary_null_comparison（其余 action 里全是要判空的，所以分开写）
    const guard = f.required ? '' : `if (${v} != null) `;
    if (f.kind === 'array') {
      return `    ${guard}'${f.name}': (${v} as List).join(','),`;
    }
    if (f.kind === 'kv' || f.kind === 'raw') {
      return `    ${guard}'${f.name}': jsonEncode(${v}),`;
    }
    // 生成 Dart 的 '${x}' 插值：这里用拼接写，避免在模板串里嵌套插值把自己绕晕
    return '    ' + guard + "'" + f.name + "': '${" + v + "}',";
  });
  return ['<String, String>{', ...lines, '  }'].join('\n');
}

function bodyMap(input: FieldDesc[]): string {
  if (!input.length) return 'const <String, dynamic>{}';
  const lines = input.map((f) => {
    const v = dartName(f.name);
    return f.required
      ? `    '${f.name}': ${v},`
      : `    if (${v} != null) '${f.name}': ${v},`;
  });
  return ['<String, dynamic>{', ...lines, '  }'].join('\n');
}

function pascalOf(s: string): string {
  return s
    .split(/[_\-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}
