// 配置与维护 action（自 index.js 拆出）：设置 config / 清理 prune / 调序 reorder。
import * as service from './service.js';
import { BLOCK_DEFS, resolveBlockTemplates } from '../../shared/prompt-blocks.js';
import { badInput } from '../../core/errors.js';
import { CWD, KEY } from './action-flags.js';

export const maintenanceActions = [
  {
    id: 'localtask.config',
    cli: ['localtask', 'config'],
    http: ['PATCH', '/api/localtasks/setting'],
    summary:
      '配置等待超时（秒）/ ack 汇报要求（ack 区块，done 指令与收尾要求唯一出口）/ 每区块模板列表',
    flags: {
      timeout: { type: 'number', hint: '超时秒数（1-600）' },
      ack: {
        type: 'string',
        hint: 'ack 汇报要求（写入 ack 区块的「命令行」模板并启用；默认内置要求 agent 调 localtask done）。传空 = 恢复内置',
      },
      // **整体替换**多条列表（面板旧字段兼容；服务层按条拼接后写入对应区块）
      'ack-list': { type: 'array', hint: '整体替换 ack 完成总结提示词列表（多条）' },
      ackList: { type: 'array', hint: '同 --ack-list（驼峰写法，HTTP body 用）' },
      'delivery-template': {
        type: 'string',
        hint: '交付上下文模板（写入 context 区块的「命令行」模板并启用）；置空 = 恢复内置默认模板。变量与语法见 skill / docs',
      },
      'reset-delivery-template': { type: 'boolean', hint: '恢复 context 区块内置模板' },
      'attach-template': {
        type: 'string',
        hint: '附件段提示词（写入 attachment 区块的「命令行」模板并启用）；置空 = 恢复内置默认模板',
      },
      attachTemplate: { type: 'string', hint: '同 --attach-template（驼峰写法，HTTP body 用）' },
      'reset-attach-template': { type: 'boolean', hint: '恢复 attachment 区块内置模板' },
      'append-mode': {
        type: 'string',
        hint: '系统上下文追加模式（全局）：xml（默认，每段包独立标签）/ plain（按空行直接拼正文）。HTTP body 用 appendMode',
      },
      'block-templates': {
        type: 'string',
        hint: '每区块模板列表（JSON 对象）：{"context":{"active":"builtin","list":[…]},…}。HTTP body 用 blockTemplates（对象）',
      },
    },
    run: async (ctx) => {
      const patch = { timeoutSec: ctx.timeout };
      if (ctx.ack !== undefined) patch.ackPrompt = ctx.ack;
      const ackList = ctx.ackList ?? ctx['ack-list'];
      if (ackList !== undefined) {
        if (ctx.ack !== undefined) throw badInput('--ack-list 不能与 --ack 同用');
        patch.ackPrompt = ackList;
      }
      // 交付上下文模板（任务 #62）：置空 = 恢复内置默认模板
      if (ctx['delivery-template'] !== undefined) patch.deliveryTemplate = ctx['delivery-template'];
      if (ctx['reset-delivery-template']) patch.deliveryTemplate = '';
      // 附件段提示词（任务 #82）：置空 = 恢复内置默认
      const attachTpl = ctx.attachTemplate ?? ctx['attach-template'];
      if (attachTpl !== undefined) patch.attachTemplate = attachTpl;
      if (ctx['reset-attach-template']) patch.attachTemplate = '';
      // 系统上下文追加模式（全局）
      const appendMode = ctx.appendMode ?? ctx['append-mode'];
      if (appendMode !== undefined) patch.appendMode = appendMode;
      // 每区块模板列表（设置面板「提示词模板」模块）：支持 JSON 字符串 / HTTP body 对象
      let blockTemplates = ctx.blockTemplates ?? ctx['block-templates'];
      if (typeof blockTemplates === 'string') {
        try {
          blockTemplates = JSON.parse(blockTemplates);
        } catch {
          throw badInput(
            '--block-templates 需为合法 JSON 对象（形如 {"context":{"active":"builtin","list":[…]}}）'
          );
        }
      }
      if (blockTemplates !== undefined) patch.blockTemplates = blockTemplates;
      return service.updateSettings(patch);
    },
    render: (s) => {
      const ack = s.ackPromptList && s.ackPromptList.length ? `ack 提示词 ${s.ackPromptList.length} 条` : 'ack 提示词已清空';
      const mode = s.appendMode === 'plain' ? '正文直追加' : 'XML 区块';
      const active = resolveBlockTemplates(s.blockTemplates);
      const blocks = BLOCK_DEFS.map((d) => `${d.id}=${active[d.id].builtin ? '内置' : `「${active[d.id].name}」`}`).join('，');
      return `已配置等待超时 ${s.timeoutSec} 秒（推荐 ${s.recommendedSec}，最大 ${s.maxSec}）· ${ack} · 追加模式：${mode} · 区块模板：${blocks}`;
    },
  },

  {
    id: 'localtask.prune',
    cli: ['localtask', 'prune'],
    http: ['POST', '/api/localtasks/prune'],
    summary: '清理旧脏数据（旧模型无目录主题、空主题；等待中一律保留）',
    flags: {
      'all-finished': { type: 'boolean', hint: '连同已全部领取、无待领的主题一起清' },
      'dry-run': { type: 'boolean', hint: '只报告将清理哪些，不实际删除' },
    },
    run: (ctx) => service.pruneTopics({ allFinished: ctx['all-finished'], dryRun: ctx['dry-run'] }),
    render: (d) => {
      const head = d.dryRun ? '（预演）将清理' : '已清理';
      if (!d.count) return `${head} 0 个主题（无旧脏数据）。`;
      return `${head} ${d.count} 个主题：\n` + d.removed.map((r) => `  - [${r.reason}] ${r.name}${r.cwd ? `  ${r.cwd}` : ''}`).join('\n');
    },
  },

  {
    id: 'localtask.reorder',
    cli: ['localtask', 'reorder'],
    http: ['PATCH', '/api/localtasks/reorder'],
    summary: '调整待领取任务优先级（--id <编号> 移到 --before-id <编号> 前或 --after-id <编号> 后）',
    flags: {
      id: { type: 'number', required: true, hint: '要移动的任务编号' },
      beforeId: { type: 'number', hint: '插到该编号之前（与 afterId 二选一）' },
      afterId: { type: 'number', hint: '插到该编号之后（与 beforeId 二选一）' },
      // 连字符写法也认：help 文案一直写的是 --before-id / --after-id，
      // 但真去敲会报「未知参数」——文档与实现对不上，用户第一次用就踩。
      'before-id': { type: 'number', hint: '同 --beforeId（连字符写法）' },
      'after-id': { type: 'number', hint: '同 --afterId（连字符写法）' },
      cwd: CWD,
      key: KEY,
    },
    run: (ctx) =>
      service.reorderTasks({
        id: ctx.id,
        beforeId: ctx.beforeId !== undefined ? ctx.beforeId : ctx['before-id'],
        afterId: ctx.afterId !== undefined ? ctx.afterId : ctx['after-id'],
        cwd: ctx.cwd,
        key: ctx.key,
      }),
    render: (d) => {
      const order = d.topic.tasks.filter((x) => x.status === 'pending').map((x) => `#${x.id}`);
      return `主题「${d.name}」待领取顺序：${order.join(' -> ') || '（无待领取）'}`;
    },
  },
];
