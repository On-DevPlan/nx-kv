// prompt golden（S0 基线，S1 起走插件路径）：**源数据夹具**（groupCtx / attachments /
// queueInfo / enabled / seed）经 promptplug 插件 data() 真实变换 + compose 真实渲染，
// 输出存 tests/unit/__golden__/prompt-instruction/*.txt。
//
// 对账两层：
//   1. ctx：{...seed, ...插件写回段} 与 .ctx.json 逐字节一致（插件变换语义没变）；
//   2. instruction 渲染输出与 .txt 逐字节一致（compose / 模板 / 引擎没变）。
//
// 夹具原则：源数据全部静态手写（形状取自真实聚合输入），不调用任何 Date.now /
// 磁盘 / DB——golden 必须可复现。附件条目形状 = attachTemplateCtx（ctxItemOf）的输入行。
//
// 重新生成基线：NX_KV_GOLDEN_WRITE=1 node --import tsx --test tests/unit/prompt-golden.test.mjs
// （基线版本：v2 = S1 插件化后首次生成；v1 为改造前 composeSystemBlocks 直渲染版）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachTemplateCtx } from '../../src/modules/localtask/ops/attach-template.js';
import { compose } from '../../src/modules/promptplug/compose.js';
import { buildPlugins } from '../../src/modules/promptplug/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN_DIR = join(root, 'tests', 'unit', '__golden__', 'prompt-instruction');
const WRITE = process.env.NX_KV_GOLDEN_WRITE === '1';

// ── 夹具零件（源形状） ─────────────────────────────────────────────────────

// schema v12 起 ref 的「分类标签」tag 已退役：夹具不再喂它，插件也不再搬它。
const docLink = (refId, desc, title, note = '') => ({
  refId, desc, title, hasBody: true, note,
});
const refRepoSrc = (key, name, path, note = '') => ({ key, name, path, note });
const peerSrc = (name, note, path) => ({ name, note, path });

const baseSeed = {
  source: 'local',
  summary: 'S0 golden 夹具现状',
  name: 'nx-kv',
  params: {},
};

/** 附件条目源（ctxItemOf 的输入行）。 */
const fileAttachSrc = {
  id: 'att_file_1', kind: 'file', name: '设计稿.png', size: 102400,
  mime: 'image/png', isImage: true, localPath: 'D:/att/设计稿.png',
  fileId: 'ae6263b6b5e0f4b1c82663b674b94330',
};
const urlAttachSrc = {
  id: 'att_url_1', kind: 'url', name: '需求说明.html', origin: 'area',
  href: 'https://example.com/spec', note: '网页存档',
};
const repoAttachSrc = {
  id: 'att_repo_1', kind: 'repo', origin: 'area', name: 'agentdaw',
  repoKey: 'github.com/eqarx/agentdaw', repoName: 'agentdaw', repoDesc: '参考实现',
  repoType: 'ref', typeLabel: '参考仓库', localPath: 'D:/a_other/nxkvrepo/agentdaw',
  exists: true, missing: false, branch: 'main', docs: ['ref_aaa111'], docCount: 1,
  getCmd: 'nx-kv repo get --id github.com/eqarx/agentdaw',
  docCmd: 'nx-kv repo doc list --id github.com/eqarx/agentdaw',
  note: 'API 口径以它为准',
};
const refAttachSrc = {
  id: 'att_ref_1', kind: 'ref', role: 'doc', origin: 'area', refId: 'ref_f8051715c0df3f1c',
  name: 'nx-kv · 本机任务队列与文档中枢.md', desc: '一句话描述', docContent: '# nx-kv · 本机任务队列与文档中枢\n\n本机任务队列 + 文档库 + 仓库登记的一体化工具。',
  note: '组介绍主篇',
};

/** 任务级 goal（wait.ts 组装后的 ctx 形状）。 */
const taskGoal = {
  name: '交付时限', durationHuman: '2小时', elapsedHuman: '48分钟', remainingHuman: '1小时12分钟',
  elapsedSec: 2880, durationSec: 7200, remainingSec: 4320, overtimeSec: 0,
  reached: false, blocked: false, goalKey: 'tg_216', extra: 'golden 阶段先不做 UI',
  check: '〔时间目标〕每轮推进先跑 nx-kv timegoal check --task tg_216 --summary "<本轮现状>"；到点后再 localtask done。',
  statusLine: '',
};
// #161：任务级 goal **无自定义 prompt**（goals.prompt 收敛后出厂场景）——
// timecheck 段的出厂正文（else 分支）就靠这条夹具钉住。
const factoryGoal = {
  name: '交付时限', durationHuman: '2小时', elapsedHuman: '5分钟', remainingHuman: '1小时55分钟',
  elapsedSec: 300, durationSec: 7200, remainingSec: 6900, overtimeSec: 0,
  reached: false, blocked: false, goalKey: 'task:nx-kv:301', extra: 'golden 覆盖出厂正文',
  check: '', statusLine: '',
};
const dirGoal = {
  name: '验收窗口', durationHuman: '30分钟', elapsedHuman: '18分钟', remainingHuman: '12分钟',
  elapsedSec: 1080, durationSec: 1800, remainingSec: 720, overtimeSec: 0,
  reached: false, blocked: false, goalKey: '', extra: '',
  check: '', statusLine: '〔时间目标「验收窗口」剩余 12 分钟〕',
};
const blockedGoal = {
  name: '交付时限', durationHuman: '2小时', elapsedHuman: '1小时23分钟', remainingHuman: '37分钟',
  elapsedSec: 4980, durationSec: 7200, remainingSec: 2220, overtimeSec: 0,
  reached: false, blocked: true, goalKey: 'tg_216', extra: '',
  check: '〔时间目标〕每轮推进先跑 nx-kv timegoal check --task tg_216 --summary "<本轮现状>"。',
  statusLine: '',
};


// ── 10 个场景（源数据夹具） ─────────────────────────────────────────────────

const scenarios = {
  '01-full-delivery': {
    seed: {
      ...baseSeed,
      cwd: 'D:/DevProjects/my/github/nx-kv',
      task: { id: 216, text: '# 调研\n\n把提示词模板做成完全插件注册中心。\n\n## 验收\n\n- [x] 出方案' },
      goal: taskGoal,
    },
    groupCtx: {
      repo: {
        name: 'nx-kv', key: 'github.com/on-devplan/nx-kv',
        intro: { body: '# nx-kv · 本机任务队列与文档中枢\n\n一条 npx 命令起 Web 面板。', path: 'D:/repos/nx-kv.md', refId: 'ref_f8051715c0df3f1c', desc: 'nx-kv 介绍' },
        docLinks: [docLink('ref_4986517d09fbba23', '测试约定', '测试约定', '跑全量前先读'), docLink('ref_c0143b35cfa7e857', '', '')],
        refRepos: [refRepoSrc('github.com/milkdown', 'milkdown', 'D:/DevProjects/git-repo/milkdown')],
      },
      groups: [{
        name: 'nx', key: 'group/nx', desc: 'nx 组按仓库名前缀「nx」自动归组。',
        note: '工作流层：本机 SQLite 队列 + refs 文档库',
        intro: { body: '# nx 组\n\n自研 nx 系列工具链仓库。', path: 'D:/repos/nx.md', refId: 'ref_nxgroup01', desc: 'nx 组介绍' },
        peers: [peerSrc('nx-as', '', 'D:/DevProjects/my/github/nx-as'), peerSrc('nx-rp', '渲染引擎', 'D:/DevProjects/my/github/nx-rp')],
        docLinks: [docLink('ref_nxgroup01', 'nx 组介绍', 'nx 组')],
        refRepos: [refRepoSrc('github.com/blocknote', 'blocknote', 'D:/DevProjects/git-repo/blocknote', '编辑器参考')],
      }],
    },
    attachments: [fileAttachSrc, urlAttachSrc, refAttachSrc],
    queueInfo: {
      topic: 'D:/DevProjects/my/github/nx-kv',
      count: 2,
      list: [
        { id: 217, title: '实现 S2 模板资产化' },
        { id: 218, title: 'S3 注册表外露' },
      ],
    },
    enabled: true, waitMinutes: 30,
  },
  '02-repo-only': {
    seed: {
      ...baseSeed,
      cwd: 'D:/DevProjects/my/github/nx-as',
      task: { id: 87, text: 'ui优化：文字被按钮遮挡' },
      goal: null,
    },
    groupCtx: {
      repo: { name: 'nx-as', key: 'github.com/on-devplan/nx-as', intro: null, docLinks: [], refRepos: [] },
      groups: [],
    },
    attachments: [],
    queueInfo: null,
    enabled: true, waitMinutes: 0,
  },
  '03-cwd-unregistered': {
    seed: {
      ...baseSeed,
      cwd: 'D:/somewhere/未登记目录',
      task: { id: 42, text: '在未登记目录里干活' },
      goal: null,
    },
    groupCtx: null,
    attachments: [],
    queueInfo: null,
    enabled: true, waitMinutes: 0,
  },
  '04-repo-no-intro': {
    seed: {
      ...baseSeed,
      cwd: 'D:/DevProjects/my/github/nx-kn',
      task: { id: 9, text: '已登记但没写介绍' },
      goal: null,
    },
    groupCtx: {
      repo: { name: 'nx-kn', key: 'github.com/on-devplan/nx-kn', intro: null, docLinks: [], refRepos: [] },
      groups: [],
    },
    attachments: [],
    queueInfo: null,
    enabled: true, waitMinutes: 0,
  },
  '05-group-empty-shell': {
    seed: {
      ...baseSeed,
      cwd: 'D:/DevProjects/my/github/nx-cd',
      task: { id: 81, text: '空壳组的交付' },
      goal: null,
    },
    groupCtx: {
      repo: {
        name: 'nx-cd', key: 'github.com/on-devplan/nx-bt',
        intro: { body: '# nx-cd\n\n移动端工具。', path: '', refId: '', desc: '' },
        docLinks: [], refRepos: [],
      },
      groups: [{
        name: 'mobile', key: 'group/mobile', desc: '', note: '',
        intro: null,
        peers: [peerSrc('nx-ft', '', 'D:/DevProjects/my/test/nx-ft')],
        docLinks: [], refRepos: [],
      }],
    },
    attachments: [],
    queueInfo: null,
    enabled: true, waitMinutes: 0,
  },
  '06-attach-file-only': {
    seed: {
      ...baseSeed,
      cwd: 'D:/DevProjects/my/github/nx-kv',
      task: { id: 205, text: 'md 编辑器块侧栏' },
      goal: null,
    },
    groupCtx: null,
    attachments: [fileAttachSrc],
    queueInfo: null,
    enabled: true, waitMinutes: 0,
  },
  '08-attach-repo-ref': {
    seed: {
      ...baseSeed,
      cwd: 'D:/DevProjects/my/github/nx-kv',
      task: { id: 188, text: '按参考仓库的 API 实现 xx' },
      goal: null,
    },
    groupCtx: null,
    attachments: [repoAttachSrc],
    queueInfo: null,
    enabled: true, waitMinutes: 0,
  },
  '07-goal-directory-status': {
    seed: {
      ...baseSeed,
      cwd: 'D:/DevProjects/my/github/nx-kv',
      task: { id: 100, text: '列表逃逸' },
      goal: dirGoal,
    },
    groupCtx: null,
    attachments: [],
    queueInfo: null,
    enabled: true, waitMinutes: 0,
  },
  '08-goal-blocked-guard': {
    seed: {
      ...baseSeed,
      cwd: 'D:/DevProjects/my/github/nx-kv',
      task: { id: 205, text: '到点前的 done 尝试' },
      goal: blockedGoal,
    },
    groupCtx: null,
    attachments: [],
    queueInfo: null,
    enabled: true, waitMinutes: 0,
  },
  '11-goal-factory-body': {
    seed: {
      ...baseSeed,
      cwd: 'D:/DevProjects/my/github/nx-kv',
      task: { id: 301, text: '带时间目标但没有自定义提示词的任务' },
      goal: factoryGoal,
    },
    groupCtx: null,
    attachments: [],
    queueInfo: null,
    enabled: true, waitMinutes: 0,
  },
  '09-ext-queue': {
    seed: {
      ...baseSeed,
      cwd: 'D:/DevProjects/my/github/nx-kv',
      task: { id: 214, text: '队列余量提示' },
      goal: null,
    },
    groupCtx: null,
    attachments: [],
    queueInfo: {
      topic: 'D:/DevProjects/my/github/nx-kv',
      count: 3,
      list: [
        { id: 215, title: '重构文档为唯一基准' },
        { id: 216, title: 'zod 映射裁决' },
        { id: 217, title: '这是一条特别特别长的标题——超过四十个字也会原样出现在模板清单行里不做截断处理' },
      ],
    },
    enabled: true, waitMinutes: 0,
  },
  '10-minimal': {
    seed: {
      ...baseSeed,
      cwd: '',
      task: { id: 7, text: '最小交付：只有任务与 ack' },
      goal: null,
    },
    groupCtx: null,
    attachments: [],
    queueInfo: null,
    enabled: false, waitMinutes: 0,
  },
};

// ── 测试本体 ───────────────────────────────────────────────────────────────

/**
 * 交付链 + 宿主取数（#152 起模板正文在插件类里，不再有「解析出的模板」这一层）。
 * 与 claim/wait.ts 同构：交付 = 三条链一起给（get / check / done，合并后按声明 order 排序）。
 */
const pluginsOf = (sc) => [
  ...buildPlugins('get', {
    groupCtx: sc.groupCtx,
    attach: sc.attachments.length ? attachTemplateCtx(sc.attachments).attach : null,
    queueInfo: sc.queueInfo,
    enabled: sc.enabled,
    waitMinutes: sc.waitMinutes,
  }),
  ...buildPlugins('check'),
  ...buildPlugins('done'),
];

/** 源夹具 → 合并后的 ctx（与 compose 内部同一条插件路径）。 */
async function ctxOf(sc) {
  const plugins = pluginsOf(sc);
  const ctx = { ...sc.seed };
  for (const p of plugins) Object.assign(ctx, await p.get('data'));
  return ctx;
}

function renderViaPlugins(sc) {
  return compose({ plugins: pluginsOf(sc), groups: ['get', 'check', 'done'], seed: sc.seed, mode: 'xml' });
}

for (const [name, sc] of Object.entries(scenarios)) {
  test(`golden: ${name}`, async () => {
    const ctx = await ctxOf(sc);
    const ctxJson = JSON.stringify(ctx, null, 2) + '\n';
    const output = await renderViaPlugins(sc);
    const ctxPath = join(GOLDEN_DIR, `${name}.ctx.json`);
    const outPath = join(GOLDEN_DIR, `${name}.txt`);
    if (WRITE) {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(ctxPath, ctxJson, 'utf8');
      writeFileSync(outPath, output, 'utf8');
      return;
    }
    assert.ok(existsSync(ctxPath) && existsSync(outPath), `golden 缺失：${name}（用 NX_KV_GOLDEN_WRITE=1 重新生成）`);
    const expectCtx = readFileSync(ctxPath, 'utf8');
    const expectOut = readFileSync(outPath, 'utf8');
    assert.equal(ctxJson, expectCtx, `${name} 的 ctx（插件变换结果）与基线不一致`);
    if (output !== expectOut) {
      const a = expectOut.split('\n');
      const b = output.split('\n');
      let i = 0;
      while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++;
      const around = (arr) => arr.slice(Math.max(0, i - 2), i + 3).map((l, k) => `  ${Math.max(0, i - 2) + k + 1}: ${l}`).join('\n');
      assert.fail(`${name} 渲染输出与基线不一致（首个差异在第 ${i + 1} 行）\n── 基线 ──\n${around(a)}\n── 实际 ──\n${around(b)}`);
    }
  });
}
