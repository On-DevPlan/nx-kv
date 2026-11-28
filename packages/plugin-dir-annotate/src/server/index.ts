// 目录批注插件：新建任务下拉注册一个 panel 入口；任务编辑页 dock 额外注册「目录要求」区块。
//
// 目录要求（gettask）：
//   · 条目按仓库保存（dir_annotate_requirements）；
//   · 一个主题启用哪些条目按主题保存（dir_annotate_topic_requirements）；
//   · 默认不启用；领取时由插件内部生成完整提示词，全局模板只取 {{prompt}}。
import { definePlugin, paramsOf } from '@nx-kv/plugin-sdk';
import { migrateStorage, readSettings, STORAGE_VERSION, writeSettings } from './settings.js';
import {
  buildRequirementsPrompt,
  listRequirements,
  readTopicRequirements,
  removeRequirement,
  saveRequirement,
  writeTopicRequirements,
} from './requirements.js';

export default definePlugin({
  id: 'dir-annotate',
  version: '0.2.0',
  api: '^1',
  name: '目录批注',
  description: '选择项目目录中的文件、添加批注，最后生成一条任务草稿；并可按主题启用仓库的目录 / 文件维护要求。',
  icon: 'folder',
  order: 20,
  defaultEnabled: true,
  storageVersion: STORAGE_VERSION,
  migrateStorage,
  entries(ctx) {
    const kind = ctx.topic?.kind || (ctx.groupKey ? 'group' : ctx.repoKey ? 'repo' : 'unknown');
    if (kind === 'unknown') return [];
    return [
      {
        id: 'dir-annotate:open',
        pluginId: 'dir-annotate',
        label: '目录批注…',
        description: kind === 'group' ? '先选仓库，再选文件添加批注' : '选择项目文件并添加批注',
        icon: 'folder',
        kind: 'panel',
        order: 20,
        ui: { panel: 'annotate' },
        panel: { title: '目录批注' },
      },
    ];
  },
  async buildDraft() {
    throw new Error('目录批注入口通过面板生成任务，不走 pretask.draft');
  },
  gettask() {
    return [
      {
        id: 'requirements',
        label: '目录要求',
        description: '按主题启用仓库的目录 / 文件维护要求；领取时生成提示词',
        tag: 'requirements',
        order: 20,
        // 模板是全局的：插件已经把仓库 / 主题 / 启用条目渲染成完整提示词。
        template: '{{prompt}}',
        fields: [
          {
            key: 'prompt',
            kind: 'text',
            label: '目录要求提示词',
            desc: '插件按本主题启用的条目生成的完整提示词（直接渲染）',
          },
          { key: 'entryCount', kind: 'number', label: '启用的要求数' },
          { key: 'repoName', kind: 'string', label: '仓库名' },
          { key: 'repoKey', kind: 'string', label: '仓库 key' },
          { key: 'topicKey', kind: 'string', label: '主题 key' },
        ],
        ui: { panel: 'requirements', title: '目录要求' },
        data(ctx) {
          const topicKey = String(ctx.topicKey || ctx.topic?.key || '');
          const repoKey = String(ctx.repoKey || ctx.topic?.repoKey || '');
          if (!topicKey || !repoKey) return null;
          const entries = listRequirements(ctx.storage, repoKey);
          if (!entries.length) return null;
          const enabled = new Set(readTopicRequirements(ctx.storage, topicKey));
          if (!enabled.size) return null;
          const picked = entries.filter((entry) => enabled.has(entry.id));
          if (!picked.length) return null;
          const repoName = String(ctx.topic?.repoName || repoKey);
          const settings = readSettings(ctx.storage);
          return {
            prompt: buildRequirementsPrompt({
              repoName,
              repoKey,
              repoRoot: String(ctx.topic?.repoRoot || ''),
              entries: picked,
              promptHead: settings.promptHead,
              promptTail: settings.promptTail,
            }),
            entryCount: picked.length,
            repoName,
            repoKey,
            topicKey,
          };
        },
      },
    ];
  },
  // 标准候选接口：条目按当前仓库给（组任务由宿主按任务的 repoKey 解析）。
  candidates(ctx) {
    const repoKey = String(ctx.repoKey || ctx.topic?.repoKey || '');
    if (!repoKey) return [];
    return listRequirements(ctx.storage, repoKey).map((entry) => ({
      id: entry.id,
      label: entry.title,
      description: entry.detail,
      kind: 'dir-requirement',
      path: entry.dir,
      text: [entry.title, entry.dir, entry.detail].join(' '),
      meta: { repoKey, dir: entry.dir, title: entry.title, detail: entry.detail },
    }));
  },
  rpc: {
    async getSettings(ctx) {
      return readSettings(ctx.storage);
    },
    async setSettings(ctx, raw) {
      return writeSettings(ctx.storage, paramsOf(raw));
    },
    async requirementsList(ctx, raw) {
      const p = paramsOf(raw) || {};
      const repoKey = String(p.repoKey || ctx.repoKey || ctx.topic?.repoKey || '');
      const repoName = String(ctx.topic?.repoName || '');
      if (!repoKey) return { repoKey: '', repoName, entries: [] };
      return { repoKey, repoName, entries: listRequirements(ctx.storage, repoKey) };
    },
    async requirementsSave(ctx, raw) {
      const p = paramsOf(raw) || {};
      const repoKey = String(p.repoKey || ctx.repoKey || ctx.topic?.repoKey || '');
      const saved = saveRequirement(ctx.storage, repoKey, p);
      return { repoKey, id: saved.id, entries: listRequirements(ctx.storage, repoKey) };
    },
    async requirementsRemove(ctx, raw) {
      const p = paramsOf(raw) || {};
      const repoKey = String(p.repoKey || ctx.repoKey || ctx.topic?.repoKey || '');
      const entries = removeRequirement(ctx.storage, repoKey, p.id);
      return { repoKey, entries };
    },
    async topicRequirementsGet(ctx, raw) {
      const p = paramsOf(raw) || {};
      const topicKey = String(p.topicKey || ctx.topicKey || ctx.topic?.key || '');
      return {
        topicKey,
        ids: topicKey ? readTopicRequirements(ctx.storage, topicKey) : [],
      };
    },
    async topicRequirementsSave(ctx, raw) {
      const p = paramsOf(raw) || {};
      const topicKey = String(p.topicKey || ctx.topicKey || ctx.topic?.key || '');
      if (!topicKey) throw new Error('需要 topicKey（主题）');
      return { topicKey, ids: writeTopicRequirements(ctx.storage, topicKey, p.ids) };
    },
  },
});
