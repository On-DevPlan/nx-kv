// codegen：从同一份 action 契约生成两样东西——
//   1. client.generated.ts：给前端用的类型安全 apiclient
//   2. cli-tree.json：CLI 命令树快照（面板 / 文档可消费的事实源）
//
// **「半自动化」的边界（模板 spike 的量化结论）：**
// 自动：每个 action 一个方法（名字、入参/返回类型来自 zod schema）、路由模式、
//       路径参数抽取、query/body 分流。
// 手写：传输层（api/client.ts 的 api()——错误信封/超时已是现成的）、
//       页面接线（哪个按钮调哪个 action）。
//
// 刻意偏差：生成的 client **不在前端做 zod 运行时校验**（schema 只以 import type
// 出现，返回值 as 断言）——省掉浏览器包里整个 zod；服务端仍在 zod-bridge 双端守
// schema（CLI 与 HTTP 共用同一份）。
//
// 只生成 zod 通道（@action 装饰）的 action；legacy flags 通道的 action 继续由前端
// 手写 client.js 调用（迁移完成后删除）。
//
// 入参 schema 常量**不再跨文件引用**：契约（zod）就声明在各自的 action 文件里，
// 入参类型经基类泛型模板（ActionBase<typeof input> + 幻影字段 _input）流到前端——
// 生成物只引 action 类（清单），不引契约文件，也不再依赖
// `<camelCase(actionId)>Input` 命名约定。
//
// 出参没有 schema——**实现即契约**：返回类型直接从 action 类的方法签名推断，
// 同一信息只声明一次，「两份声明漂移」无从发生。
import { describeInput } from './zod-bridge.js';
import { routeParams, type ZodBoundAction } from './action-decorator.js';
import { cliPathsOf } from './spec.js';

/**
 * 前端方法名：取 actionId 最后一段，撞名时加模块前缀（todo.get 与 repo.get → get / repoGet）。
 */
export function clientMethodNames(actions: readonly ZodBoundAction[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const a of actions) {
    const parts = a.id.split('.');
    // 方法名必须是合法标识符：'repo.bind-topics' → 'bindTopics'
    const base = parts[parts.length - 1]!.replace(/[-_](\w)/g, (_m, c) => c.toUpperCase());
    let candidate = base;
    if (used.has(candidate)) {
      const module = parts.length > 1 ? parts[parts.length - 2]! : 'action';
      candidate = module + base[0]!.toUpperCase() + base.slice(1);
      let n = 2;
      while (used.has(candidate)) candidate = `${module}${base[0]!.toUpperCase()}${base.slice(1)}${n++}`;
    }
    used.add(candidate);
    names.set(a.id, candidate);
  }
  return names;
}

/**
 * 入参类型锚点：**从 action 类反推**——类上的泛型实参（基类模板封装的 schema 类型）
 * 经幻影字段 `_input` 露出，前端只引 action 类即可拿到入参形状：
 *
 *   z.input<InstanceType<typeof LocaltaskGetAction>['_input']>
 *
 * 契约常量因此降级为「文件内的实现细节」——不再有独立的 schemas.ts，
 * 也不再需要 `<camelCase(actionId)>Input` 命名约定（约定破了会生成指向不存在
 * 符号的代码，是旧方案最大的脆弱点）。
 */
function inputTypeOf(a: ZodBoundAction): string {
  return `z.input<InstanceType<typeof ${a.className}>['_input']>`;
}

/** 生成前端 apiclient 的 TS 源码（type-only 引 action 类：zod 不进浏览器包）。 */
export function generateClientSource(actions: readonly ZodBoundAction[]): string {
  const withHttp = actions.filter((a) => a.http);
  const methodNames = clientMethodNames(withHttp);

  // 类型锚点只有一类：action 类（清单）。入参形状由类上的泛型推出来，
  // 返回类型则从方法签名直接推断——**实现即契约**。
  const actionClasses = new Map<string, Set<string>>();
  for (const a of withHttp) {
    const classes = actionClasses.get(a.module) || new Set<string>();
    classes.add(a.className);
    actionClasses.set(a.module, classes);
  }
  const imports = [...actionClasses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, names]) => {
      const list = [...names].sort().map((n) => `  ${n},`).join('\n');
      return `import type {\n${list}\n} from '../../../modules/${module}/actions/_manifest.generated.js';`;
    })
    .join('\n');

  const iface = withHttp
    .map((a) => {
      const fields = describeInput(a.input, a.args ?? []);
      const paramType = inputTypeOf(a);
      const required = fields.some((f) => f.required);
      const sig = fields.length === 0 ? '' : required ? `input: ${paramType}` : `input?: ${paramType}`;
      const doc = a.summary ? `/** ${a.summary} */\n  ` : '';
      return `${doc}${methodNames.get(a.id)}(${sig}): Promise<Awaited<ReturnType<InstanceType<typeof ${a.className}>['${a.method}']>>>;`;
    })
    .join('\n');

  const impl = withHttp
    .map((a) => {
      const paramType = inputTypeOf(a);
      const methodName = methodNames.get(a.id)!;
      const [method, pattern] = a.http!;
      const params = routeParams(pattern);
      const fields = describeInput(a.input, a.args ?? []);
      const bodyFields = fields.filter((f) => !params.includes(f.name));
      const required = fields.some((f) => f.required);
      const isGet = method === 'GET' || method === 'HEAD';

      const lines: string[] = [];
      lines.push(`    // action: ${a.id}`);
      const argSig =
        fields.length === 0 ? '' : required ? `input: ${paramType}` : `input?: ${paramType}`;
      lines.push(`    async ${methodName}(${argSig}) {`);
      if (fields.length) {
        // 可选入参统一兜底成对象：后面的索引访问不用再判 undefined
        lines.push(`      const inp = input ?? ({} as ${paramType});`);
      }

      // 路径参数是位置参数（zodActionsOf 已校验 :param ⊆ args），编码后插进模板。
      const pathTemplate = pattern.replace(
        /:([\w-]+)/g,
        (_m: string, k: string) => '${encodeURIComponent(String(inp[' + JSON.stringify(k) + ']))}',
      );
      lines.push(`      ${isGet && bodyFields.length ? 'let' : 'const'} path = \`${pathTemplate}\`;`);

      // 非 GET 且没有 body 字段时，传 undefined（body 变量并不存在）
      const bodyArg = isGet ? '' : bodyFields.length ? ', body' : ', undefined';
      const ret = `return (await transport.request(${JSON.stringify(method)}, path${bodyArg})) as Awaited<ReturnType<InstanceType<typeof ${a.className}>['${a.method}']>>;`;

      if (isGet) {
        if (bodyFields.length) {
          lines.push('      const q = new URLSearchParams();');
          for (const f of bodyFields) {
            lines.push(
              `      if (inp[${JSON.stringify(f.name)}] !== undefined) q.set(${JSON.stringify(f.name)}, String(inp[${JSON.stringify(f.name)}]));`,
            );
          }
          lines.push('      const query = q.toString();');
          lines.push("      if (query) path += path.includes('?') ? '&' + query : '?' + query;");
        }
        lines.push('      ' + ret);
      } else {
        if (bodyFields.length) {
          const body = bodyFields.map((f) => `${JSON.stringify(f.name)}: inp[${JSON.stringify(f.name)}]`);
          lines.push(`      const body = { ${body.join(', ')} };`);
        }
        lines.push('      ' + ret);
      }
      lines.push('    },');
      return lines.join('\n');
    })
    .join('\n');

  const needsZodType = withHttp.some((a) => describeInput(a.input, a.args ?? []).length > 0);
  return `// AUTO-GENERATED —— 由 scripts/gen-api-client.mjs（runtime/codegen.ts）生成，勿手改。
//
// 类型来自 zod schema（import type，zod 运行时不进浏览器包）；运行时校验在服务端
//（runtime/zod-bridge.ts，CLI 与 HTTP 共用同一份 schema）。传输层是手写的那一半：
// 调 createApiClient 时传入 api/client.ts 的 api() 即可。
// 重新生成：pnpm gen:api。新鲜度由 tests/unit/api-client.test.mjs 对账。

${needsZodType ? "import type { z } from 'zod';" : ''}
${imports}

/** 传输层契约（手写的那一半）：返回 data（错误信封由 api() 拆好，失败即 throw）。 */
export interface Transport {
  request(method: string, path: string, body?: unknown): Promise<unknown>;
}

export interface ApiClient {
${iface}
}

export function createApiClient(transport: Transport): ApiClient {
  return {
${impl}
  };
}
`;
}

/** CLI 树节点（序列化用）。 */
export interface TreeNodeJson {
  name: string;
  path: string[];
  action: {
    id: string;
    module: string;
    summary: string;
    usage: string;
    http: string | null;
  } | null;
  children: TreeNodeJson[];
}

/** 从 action 声明派生层级命令树（无第二份手写清单——树是声明的产物）。 */
export function buildTreeJson(actions: readonly ZodBoundAction[]): TreeNodeJson {
  type Node = { name: string; path: string[]; children: Node[]; action?: ZodBoundAction };
  const root: Node = { name: '', path: [], children: [] };
  for (const action of actions) {
    // 别名也是命令路径：每条路径都进树（树 = 命令表的层级视图）
    for (const cliPath of cliPathsOf(action)) {
      let node = root;
      cliPath.forEach((seg, i) => {
        let next = node.children.find((c) => c.name === seg);
        if (!next) {
          next = { name: seg, path: cliPath.slice(0, i + 1), children: [] };
          node.children.push(next);
        }
        node = next;
      });
      node.action = action;
    }
  }
  const toJson = (node: Node): TreeNodeJson => ({
    name: node.name,
    path: node.path,
    action: node.action
      ? {
          id: node.action.id,
          module: node.action.module,
          summary: node.action.summary ?? '',
          usage: node.action.cli.join(' '),
          http: node.action.http ? `${node.action.http[0]} ${node.action.http[1]}` : null,
        }
      : null,
    children: node.children.map(toJson),
  });
  return toJson(root);
}

/** CLI 树快照 JSON（stable：字段序固定，适合入库对账）。 */
export function generateTreeJson(actions: readonly ZodBoundAction[]): string {
  return JSON.stringify(buildTreeJson(actions), null, 2) + '\n';
}
