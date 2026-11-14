// 通用 CLI 运行器：解析 argv → 匹配 action → 校验 → 执行 → 渲染。
//
// 改造前这里是一个 400 行的 switch，每条命令要在 BOOL_FLAGS / helpText / case /
// renderXxx 四处重复登记。现在命令表、help 文本、参数校验全部由 action 声明派生，
// 新增命令只需在所属模块的 actions 里加一条（或按模板形态写一个 @action 装饰类）。
//
// **双通道**：业务 action 走 @action 装饰的 zod 契约（zod-bridge：归一化 + zod 校验）；
// legacy flags 表契约只服务 runtime 内建命令（serve / help / version）。
// token 扫描一层两通道共用（`--` / `---` 的语义只有一份），只在「归一化 + 校验」处分叉。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { APP_NAME, DEFAULT_PORT } from '../core/paths.js';
import { toErrorPayload, exitCodeOf, badInput } from '../core/errors.js';
import { ACTIONS, registry } from './registry.js';
import type { Registry } from './registry.js';
import {
  cliPathsOf,
  argSpecsOf,
  flagSpecsOf,
  applySpec,
  usageOf,
  entryOf,
  type AnyAction,
  type ArgSpecInput,
} from './spec.js';
import { normalizeCliValue, parseZodInput, type FieldDesc } from './zod-bridge.js';
import type { ZodBoundAction } from './action-decorator.js';
import { helpEntries, renderHelp, printCommandHelp } from './help.js';
import { publishCommandTable } from '../core/command-table.js';

const VERSION: string = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;

// ---- 平台命令：不属于任何功能域，不参与 action 表 ----
// 用与 action 相同的形状声明，好让参数解析与 help 生成保持同一套逻辑。
//
// `routes` 已迁入 system 模块（它消费的命令表来自 core 的快照格子，不再依赖本文件）。
// serve / help / version 暂留这里：help 与 version 要看注册表与命令表全集（模块
// import runtime 会成环），serve 要挂 localtask 的面板占位——迁入 platform 模块
// 列入后续阶段（见 plan/174 的偏离表）。
const BUILTINS: AnyAction[] = [
  {
    id: 'serve',
    cli: ['serve'],
    summary: '启动 Web 面板（默认 :7877；--port N 改端口；--no-open 不开浏览器；--allow-origin 收紧跨域来源；端口上已有本面板则直接打开它；NX_SERVE_NO_OPEN=1 全局不开浏览器）',
    flags: {
      port: { type: 'number', default: DEFAULT_PORT },
      'no-open': { type: 'boolean' },
      // --auto-exit：面板（web）全关且无等待中的主题时，serve 自动退出。
      // 用户手动 `nx-kv serve` 默认不带该标志，面板不会自己跑掉；
      // wait 临时拉起 serve 时会加 --no-open --auto-exit，用完即让位。
      'auto-exit': { type: 'boolean', hint: '面板关闭后空闲自释放（wait 临时拉起实例专用）' },
      // 宽限期：连续多久无面板活动后才允许释放（与 --auto-exit 配合使用）
      idle: { type: 'number', hint: '空闲宽限期（秒；与 --auto-exit 配合，默认 120）' },
      // --allow-origin：跨域来源白名单（逗号分隔）。缺省 = 放行全部——面板要能被
      // 内网穿透 / 移动端访问（任务 #57）。收紧时只放行指定来源。
      'allow-origin': { type: 'string', hint: '跨域来源白名单（逗号分隔）；缺省放行全部' },
    },
    run: (ctx) => cmdServe(ctx as ServeCtx),
  },
  {
    id: 'help',
    cli: ['help'],
    summary: '显示帮助（可跟模块名或命令组，如 nx-kv help todo）',
    args: [{ name: 'topic', required: false }] as ArgSpecInput[],
    // 走标准 action 形态：--json 时 emit 会序列化返回的条目，
    // 于是 `help --json` 输出的是可解析的命令表而非帮助文本
    run: (ctx) => helpEntries(ALL_COMMANDS, (ctx as { topic?: unknown }).topic),
    render: (entries, ctx) => renderHelp(entries as ReturnType<typeof entryOf>[], (ctx as { topic?: unknown }).topic, VERSION),
  },
  // render 让 `nx-kv version` 输出裸版本号（脚本里可 `V=$(nx-kv version)`），
  // 而 `--json` 仍走序列化，保持机器可读
  { id: 'version', cli: ['version'], summary: '显示版本', run: () => VERSION, render: (v) => String(v) },
];

export const ALL_COMMANDS: readonly AnyAction[] = [...BUILTINS, ...ACTIONS];

// 命令表快照：registry 已经发布过「action 版」，这里覆盖成**含平台命令的完整版**。
// 面板（/api/bootstrap）读的是同一个格子，所以 CLI 跑起来后两边看到的是同一张表。
publishCommandTable(ALL_COMMANDS.map(entryOf));

// ---- 参数解析 ----

interface ServeCtx extends Record<string, unknown> {
  port?: number;
  'no-open'?: boolean;
  'auto-exit'?: boolean;
  idle?: number;
  'allow-origin'?: string;
}

/** @action 装饰的 zod 通道 action（channel 标记由 zodActionsOf 写入）。 */
function isZodAction(cmd: AnyAction): cmd is ZodBoundAction & AnyAction {
  return cmd.channel === 'zod';
}

// 全局 flag 先摘掉：它们可以出现在 argv 任意位置，不属于任何 action 的声明。
export function splitGlobals(argv: string[]): { rest: string[]; json: boolean; xml: boolean } {
  const rest: string[] = [];
  let json = false;
  let xml = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') {
      json = true;
      continue;
    }
    // #128：交付里的类 XML 区块在 JSON 字符串里换行会被写成 \n；
    // --xml 让 instruction 原样打印（真实换行、标签不转义），给按文本/XML 读 stdout 的消费方。
    if (a === '--xml') {
      xml = true;
      continue;
    }
    rest.push(a);
  }
  return { rest, json, xml };
}

/** 从交付数据里取出原样 instruction（类 XML 区块）；没有就返回 null。 */
export function xmlInstructionOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const v = (data as Record<string, unknown>).instruction;
  return typeof v === 'string' && v.trim() ? v : null;
}

/**
 * #130：交付类命令（get / preview）用 --json 时，给 stderr 的提醒语。
 *
 * 交付的 instruction 是引擎**封装好的 context 原文**（提示词块 + 类 XML 区块 + 回执位），
 * 不是给程序解析的数据。JSON 会把换行转义成 \n，agent 再拿 JSON 解析器去"读"它，
 * 看到的只是一坨转义串——精心封装的上下文等于丢了。所以提醒：按原文读用默认输出 / --xml。
 * 只对**有 instruction 字段**的交付数据说；普通查询命令不该多嘴。
 */
export function deliveryJsonHint(data: unknown): string | null {
  if (xmlInstructionOf(data) === null) return null;
  return (
    '[nx-kv] 提示：本次输出的 instruction 是引擎封装的 context 原文（JSON 里换行已转义成 \\n）。\n' +
    '         要按原文读，用不带 --json 的默认输出，或加 --xml；不要用 JSON 解析器去解析它。\n'
  );
}

// 匹配命令：把声明路径与 argv 前缀逐 token 比较，选最长匹配。
//
// 逐 token 比较（而非只取「开头连续的非 flag token」）是必需的——有些命令路径
// 本身就含 flag，例如 `skill install --list` 是「列出内置包」而非「安装」。
// 最长优先则让 ['skill','central','add'] 压过 ['skill','central']，子命令与别名因此共存。
export function resolveCommand(argv: string[]): { cmd: AnyAction; path: string[]; rest: string[] } | null {
  let best: { cmd: AnyAction; path: string[]; len: number } | null = null;
  for (const cmd of ALL_COMMANDS) {
    for (const path of cliPathsOf(cmd)) {
      if (path.length > argv.length || path.length <= (best?.len ?? -1)) continue;
      if (path.every((seg, i) => seg === argv[i])) {
        best = { cmd, path, len: path.length };
      }
    }
  }
  return best ? { cmd: best.cmd, path: best.path, rest: argv.slice(best.len) } : null;
}

// 「像 flag」的 token：-- 后跟字母/数字才算。
// `---` 开头的是**正文**（markdown frontmatter / 分隔线），`--` 是「后面全是位置参数」
// 的约定——两者都不是 flag。任务正文以 frontmatter 开头时（`localtask add "---
// board: …"`）正需要这条，否则会被当成未知参数报错。
function looksLikeFlag(tok: unknown): boolean {
  return /^--[A-Za-z0-9]/.test(String(tok ?? ''));
}

// 解析剩余 token。布尔 flag 不吞下一个 token —— 否则 `skill install --force demo`
// 会把 force 解析成字符串 'demo'，而 demo 本该是位置参数。
// 任务文本带空格时给 `--ref` 加引号（见 spec.ts 关于 rest flag 的说明）。
//
// 双通道共用这一层：bools 由调用方按通道算好传入（legacy 来自 flags 表，
// zod 来自 fields 的 kind）。保留 (rest, cmd) 兼容签名供单测直接调用。
export function parseRest(
  rest: readonly string[],
  cmd: AnyAction | { flags?: AnyAction['flags'] },
): { positionals: string[]; flags: Record<string, unknown> } {
  const bools = booleanNamesOf(cmd as AnyAction);
  return scanTokens(rest, bools);
}

function booleanNamesOf(cmd: AnyAction): Set<string> {
  const names = new Set(flagSpecsOf(cmd).filter((f) => (f.type || 'string') === 'boolean').map((f) => f.name));
  if (cmd.channel === 'zod') {
    for (const f of (cmd.fields || []) as FieldDesc[]) {
      if (!f.positional && f.kind === 'boolean') names.add(f.name);
    }
  }
  return names;
}

function scanTokens(rest: readonly string[], bools: Set<string>): { positionals: string[]; flags: Record<string, unknown> } {
  const positionals: string[] = [];
  const flags: Record<string, unknown> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--') {
      positionals.push(...rest.slice(i + 1));
      break;
    }
    if (!looksLikeFlag(a)) {
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 2) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = rest[i + 1];
    if (!bools.has(key) && next !== undefined && !looksLikeFlag(next)) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { positionals, flags };
}

// 位置参数按声明顺序映射成具名输入；末尾声明 { rest: true } 的收集剩余全部。
// zod 通道走 fields（positional 顺序）+ restArg 收尾，语义一致。
function mapPositionals(
  positionals: readonly string[],
  specs: readonly { name: string; required: boolean; rest?: boolean }[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = 0;
  for (const spec of specs) {
    if (spec.rest) {
      out[spec.name] = positionals.slice(i);
      i = positionals.length;
      break;
    }
    if (positionals[i] !== undefined) out[spec.name] = positionals[i];
    i++;
  }
  if (i < positionals.length) {
    throw tooManyPositionals(positionals.slice(i));
  }
  return out;
}

// 未知 flag 直接报错——`--fiile` 这类拼写错误应该立刻被指出来，而不是被静默忽略
function assertKnownFlags(flags: Record<string, unknown>, cmd: AnyAction): void {
  const known = new Set(flagSpecsOf(cmd).map((f) => f.name));
  for (const k of Object.keys(flags)) {
    if (!known.has(k)) throw badInput(`未知参数 --${k}（用法见 ${APP_NAME} help）`);
  }
}

function tooManyPositionals(extra: readonly string[]): Error {
  return badInput(`多余的参数: ${extra.join(' ')}（用法见 ${APP_NAME} help）`);
}

// ---- zod 通道的输入解析（模板同款，token 扫描与 legacy 共用） ----

function parseZodChannel(cmd: ZodBoundAction, tail: readonly string[]): Record<string, unknown> {
  const fields = cmd.fields as FieldDesc[];
  const bools = booleanNamesOf(cmd);
  const { positionals, flags } = scanTokens(tail, bools);
  const usage = usageOf(cmd);

  // 位置参数：按 fields 的 positional 顺序消费；restArg 收剩余全部。
  const positionalFields = fields.filter((f) => f.positional);
  const restCount = cmd.restArg ? 1 : 0;
  if (positionals.length > positionalFields.length + restCount) {
    throw badInput(`多余的参数: ${positionals.slice(positionalFields.length + restCount).join(' ')}（用法见 ${APP_NAME} help）`);
  }

  const raw: Record<string, unknown> = {};
  positionalFields.forEach((f, i) => {
    const v = positionals[i];
    if (v !== undefined) raw[f.name] = normalizeCliValue(f, v);
  });
  if (cmd.restArg) {
    const rest = positionals.slice(positionalFields.length);
    const field = fields.find((f) => f.name === cmd.restArg);
    raw[cmd.restArg] = field ? normalizeCliValue(field, rest) : rest;
  }
  for (const [k, v] of Object.entries(flags)) {
    const f = fields.find((x) => x.name === k);
    if (!f) throw badInput(`未知参数 --${k}（用法: ${usage}）`);
    raw[k] = normalizeCliValue(f, v);
  }
  return parseZodInput(cmd.input, raw, usage) as Record<string, unknown>;
}

// ---- 输出 ----

// render 拿到 (data, ctx)，可以是 async——有些渲染需要补一点上下文才能标注
// （例如候选清单要标出哪一项是「当前」），而 `--json` 必须保持纯数据的旧形状。
async function emit(cmd: AnyAction, data: unknown, json: boolean, ctx: unknown, xml = false): Promise<void> {
  // 无返回值的命令（help / serve 这类）不该打印任何东西：落进 JSON.stringify(undefined)
  // 会打出字面量 "undefined"，让 `help --json` 的 stdout 不再是合法 JSON。
  if (data === undefined && !cmd.render) return;

  // #128：--json 与 --xml 二选一。JSON 会把 instruction 里的换行编码成 \n，
  // 严格按文本/XML 解析 stdout 的下游会失效；--xml 给的是逐字原样区块。
  if (xml) {
    if (json) throw badInput('--json 与 --xml 不能同时用：前者会转义区块里的换行，后者要逐字原样输出');
    const text = xmlInstructionOf(data);
    if (text !== null) {
      console.log(text);
      return;
    }
    // 命令没有 instruction 字段（普通 action）→ 回落到常规渲染，别静默打印空行
  }

  if (json) {
    if (data === undefined) return;
    // #130：交付类命令（get / preview）的 instruction 是**引擎封装的 context 原文**——
    // JSON 会把换行转义成 \n，agent 若再拿 JSON 解析器去"读"它，看到的是一坨转义串，
    // 精心封装的提示词/上下文就等于丢了。这里往 stderr 给一句提醒（stdout 仍是纯 JSON）。
    const hint = deliveryJsonHint(data);
    if (hint) process.stderr.write(hint);
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (cmd.render) {
    const text = await cmd.render(data, ctx);
    if (text !== undefined && text !== null && text !== '') console.log(text);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

// 失败一律 exit 1；--json 下输出可解析的错误对象。
// 注意 error 保持字符串（历史契约），code 是新增字段——agent 可据此分支，
// 老消费方按字符串匹配「用法:」「未设置」「不存在」仍然可用。
function fail(err: unknown, json: boolean): void {
  const p = toErrorPayload(err);
  if (json) {
    const payload: Record<string, unknown> = { ok: false, error: p.message, code: p.code };
    if (p.details !== undefined) payload.details = p.details;
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error('错误: ' + p.message);
  }
  process.exitCode = exitCodeOf(p.code);
}

// ---- serve ----

async function cmdServe(ctx: ServeCtx): Promise<void> {
  const { startServer } = await import('./server.js');
  const { startPanelIdleGuard } = await import('../modules/localtask/panel-guard.js');
  const { registerPanel, unregisterPanel, notePanelRequest } = await import(
    '../modules/localtask/service.js'
  );
  const { openBrowser } = await import('../core/open.js');
  const { autoOpenEnabled, resolvePortConflict, describeOccupant } = await import('../core/serve-port.js');
  const host = '127.0.0.1';
  // 跨域放行策略：缺省放行全部；--allow-origin 传具体来源则只放行它们。
  const allowOrigin = ctx['allow-origin'];
  const port = ctx.port || DEFAULT_PORT;
  const autoExit = !!ctx['auto-exit'];
  // --no-open 与 NX_SERVE_NO_OPEN 都看这里：任一为真即完全不开浏览器。
  const canOpen = autoOpenEnabled(ctx['no-open']);

  // 活动观测钩子：每个进来的请求（静态或 /api）都回调一次，供空闲自释放判活。
  // 不参与响应，异常必须吞掉。
  //
  // ⚠️ 这里以前是空函数 —— 于是看门狗的 noteActivity() 从来没被调用过：
  // 空闲时长是从**进程启动**算起的，用户正用着面板也会在 10 分钟后被自动释放。
  // 看门狗要等 server 起好才创建，所以这里用一个可变的 holder，让 onRequest
  // 始终指向当前的 noteActivity。
  let noteActivity = () => {};
  const onRequest = () => {
    try {
      noteActivity();
    } catch {
      /* 观测失败不影响响应 */
    }
    // 记录「面板最近有请求」：SSE 只挂在本地任务页，用户切到别的页时
    // presence 会误判面板已关闭（结构审计发现的真缺口）。
    try {
      notePanelRequest();
    } catch {
      /* ignore */
    }
  };

  let server;
  try {
    server = await startServer({ port, host, onRequest, allowOrigin });
  } catch (err) {
    if (!err || (err as { code?: string }).code !== 'EADDRINUSE') throw err;

    // 端口被占：先问一句「上面跑的是不是我」。
    const decision = await resolvePortConflict(port, APP_NAME, host);

    if (decision.action === 'reuse') {
      // 自己的面板已经在跑：不重复启动，直接把浏览器指过去。
      const addr = `http://${host}:${port}`;
      console.log(APP_NAME + ' 已在运行：' + addr);
      console.log('直接打开浏览器（不重复启动）；如需重启请先停掉旧实例');
      if (canOpen) openBrowser(addr);
      return;
    }

    // 别人占的：顺延到下一个空闲端口，再起自己的面板。
    console.log(
      `端口 ${port} 已被占用（占用者: ${describeOccupant(decision.occupant)}），改用 ${decision.port}`,
    );
    server = await startServer({ port: decision.port, host, onRequest, allowOrigin });
  }

  // server.address() 在 listening 状态下必有值且是对象（host 落地的端口）；
  // 字符串形状只出现在 unix socket（本项目不用），保守收窄一下。
  const address = server!.address();
  const boundPort = typeof address === 'object' && address ? address.port : 0;
  const addr = `http://127.0.0.1:${boundPort}`;

  // 登记自己：presence 要能问**所有**跑着面板的端口（只问默认端口会看不见
  // `serve --port` 或端口被占自动顺延出来的面板 → wait 会多开窗口）。
  try {
    registerPanel(boundPort);
  } catch {
    /* 登记失败不影响面板本身 */
  }
  const unregister = () => {
    try {
      unregisterPanel(boundPort);
    } catch {
      /* ignore */
    }
  };
  process.on('exit', unregister);

  console.log('nx-kv · nx-kv v' + VERSION);
  console.log(`面板:   ${addr}`);
  console.log('CLI:    nx-kv help（每个按钮都有对应命令，agent 可加 --json）');
  if (autoExit) console.log('模式:   空闲自释放（面板关闭且无等待中的主题后自动退出）');
  console.log('按 Ctrl+C 停止');

  if (canOpen) openBrowser(addr);

  const shutdown = () => {
    console.log('\n正在停止...');
    server!.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 启动空闲看门狗（仅 --auto-exit 模式）
  if (autoExit) {
    const guard = startPanelIdleGuard({ server: server!, idleSec: ctx.idle });
    // 接上活动钩子：此后每个面板请求都会刷新「最后一次活动时间」，
    // 空闲时长终于反映**真实使用**而不是进程启动时间。
    noteActivity = guard.noteActivity;
  }
}

// ---- CliApp ----

export class CliApp {
  constructor(private reg: Registry) {}

  /** 全量命令表（help / bootstrap / 面板「CLI 等价」提示共用）。 */
  get commands(): readonly AnyAction[] {
    return [...BUILTINS, ...this.reg.actions];
  }

  /** 唯一对外入口：bin/kv.mjs 与 dev（tsx 直跑）都从 run(argv) 进。 */
  async run(argv: string[]): Promise<void> {
    const { rest, json, xml } = splitGlobals(argv);

    const hit = resolveCommand(rest);

    // 无参数、或只有全局 flag：显示帮助（与历史行为一致，退出码 0）
    if (!hit) {
      if (!rest.length) {
        console.log(renderHelp(helpEntries(this.commands, undefined), '', VERSION));
        return;
      }
      console.error(`未知命令: ${rest.join(' ')}`);
      console.error('运行 ' + APP_NAME + ' help 查看用法');
      process.exitCode = 1;
      return;
    }

    const { cmd, rest: tail } = hit;

    try {
      if (tail.includes('--help')) {
        printCommandHelp(cmd);
        return;
      }

      // 双通道分叉点：zod 走归一化 + zod 校验；legacy 走 flags 表（parseRest +
      // assertKnownFlags + mapPositionals + applySpec）。token 扫描两层共用。
      const input = isZodAction(cmd)
        ? parseZodChannel(cmd, tail)
        : parseLegacyChannel(cmd, tail);

      const data = await cmd.run!(input, { transport: 'cli' });
      await emit(cmd, data, json, input, xml);
    } catch (err) {
      fail(err, json);
    }
  }
}

function parseLegacyChannel(cmd: AnyAction, tail: readonly string[]): Record<string, unknown> {
  const bools = booleanNamesOf(cmd);
  const { positionals, flags } = scanTokens(tail, bools);
  assertKnownFlags(flags, cmd);
  const input = { ...mapPositionals(positionals, argSpecsOf(cmd)), ...flags };
  return applySpec(cmd, input);
}

/** 全项目唯一 CLI 实例（与 registry 单例配套）。 */
export const cliApp = new CliApp(registry);

// 兼容入口：bin/kv.mjs 与既有调用方都用它。
export async function runCli(argv: string[]): Promise<void> {
  return cliApp.run(argv);
}

// ---- 直接运行本文件时进入 CLI ----
// dev：`node --import tsx src/runtime/cli.ts ...`（改码即跑，无需构建）；
// prod：bin/kv.mjs 调 runCli，argv[1] 是 bin → 此处不重复执行；被 import 时不触发。
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  });
}
