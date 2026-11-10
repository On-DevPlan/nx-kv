// 阻塞等待族 action（自 index.js 拆出）：wait（纯 CLI，agent 本轮最后一步）/
// cancel 关闭等待 / presence 面板活标签探测 / events 等待事件流。
import * as service from './service.js';
import { CWD, SUMMARY } from './action-flags.js';
import { renderWait, renderCancel } from './action-render.js';

export const waitingActions = [
  {
    id: 'localtask.wait',
    cli: ['localtask', 'wait'],
    http: null,
    summary:
      '针对某主题（按 cwd 目录名识别）阻塞等待用户回填（默认 3 分钟，最大 10 分钟）；本地空时自动领取全局共享池的任务',
    flags: {
      cwd: CWD,
      summary: SUMMARY,
      timeout: { type: 'number', hint: '阻塞上限（秒）；缺省用页面配置（推荐 180，最大 600）' },
      'no-open': { type: 'boolean', hint: '不自动打开浏览器（测试用）' },
      param: { type: 'array', hint: '外部参数（平面扩展）：k=v，可重复或逗号分隔；进交付模板 ctx，模板里 {{k}} / {{params.k}} 取' },
    },
    run: async (ctx) => {
      // wait 编排已迁 tasktool/wait.js（任务工具语义归 tasktool；命令名不变）
      const { waitForTask } = await import('../tasktool/wait.js');
      const { parseParams } = await import('../tasktool/params.js');
      return waitForTask({
        cwd: ctx.cwd,
        summary: ctx.summary,
        timeoutSec: ctx.timeout,
        open: !ctx['no-open'],
        params: parseParams(ctx.param),
      });
    },
    render: renderWait,
  },

  {
    id: 'localtask.cancel',
    cli: ['localtask', 'cancel'],
    http: ['POST', '/api/localtasks/cancel'],
    summary: '关闭某主题的等待：阻塞中的 wait 立即收尾（与超时同一出口，带 cancelled 标记；不删主题与任务）',
    flags: {
      cwd: { type: 'string', hint: '工作目录（与 --key 二选一）' },
      key: { type: 'string', hint: '主题 key（与 --cwd 二选一）' },
    },
    run: (ctx) => service.cancelWait({ cwd: ctx.cwd, key: ctx.key }),
    render: renderCancel,
  },

  {
    // 探测常驻面板上当前正打开的「实时任务」标签数（活动 SSE 连接数）。
    // wait 开页前先经此端点：有活标签就复用、不再 openBrowser 新开页（避免 Edge 重复开标签）；
    // 没有活标签时才开页深链。探测失败 / 旧版无此端点时 service 保守返回 0，不阻塞 wait。
    id: 'localtask.presence',
    cli: ['localtask', 'presence'],
    http: ['GET', '/api/localtasks/presence'],
    summary: '探测主面板上当前打开的「实时任务」标签数（活动 SSE 连接数；用于 wait 不重复开页）',
    // HTTP 形态读**本进程**的计数（只有 serve 进程里才有 SSE 连接）；
    // CLI 形态去问常驻主面板 —— 否则 CLI 永远报 0（这条命令形同虚设）。
    run: (ctx, opts) =>
      opts && opts.transport === 'http'
        ? service.httpPanelPresence()
        : service.queryPanelPresence(),
    render: (d) =>
      `主面板当前有 ${d.clients} 个活动标签` +
      (d.source === 'self' ? '（主面板没在跑或探测失败，这里是本进程内计数）' : ''),
  },

  {
    // 等待生命周期事件流：SSE 端点（带 cwd/key 过滤），由 watchEvents 派生 waiting/reminder/resolved。
    // action 标 stream:true → api.js 透传 req/res，run 自己接管响应不走 sendJson。
    id: 'localtask.events',
    cli: ['localtask', 'events'],
    http: ['GET', '/api/localtasks/events'],
    summary: '等待事件流：waiting 开始 / reminder 30s·10s / resolved delivered|timeout（SSE 长连接）',
    flags: {
      cwd: { type: 'string', hint: '工作目录过滤（与 --key 二选一）' },
      key: { type: 'string', hint: '主题 key 过滤（与 --cwd 二选一）' },
      timeout: { type: 'number', hint: '最多监听多少秒后自动结束（默认不限）' },
      limit: { type: 'number', hint: '最多输出多少条事件后自动结束（默认不限）' },
    },
    stream: true,
    // 按传输方式分流：
    //   HTTP → SSE（req/res 透传，api.js 只在 HTTP 下注入 ctx.__raw）
    //   CLI  → 逐行 NDJSON（以前 CLI 跑这条命令必崩：ctx.__raw 是 undefined）
    run: (ctx, opts) =>
      opts && opts.transport === 'http'
        ? service.streamEventsSSE(ctx.__raw.req, ctx.__raw.res, { cwd: ctx.cwd, key: ctx.key })
        : service.streamEventsNDJSON({
            cwd: ctx.cwd,
            key: ctx.key,
            timeoutSec: ctx.timeout,
            limit: ctx.limit,
          }),
  },
];
