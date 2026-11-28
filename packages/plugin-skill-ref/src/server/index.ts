// skill-ref：第一个 gettask 案例插件。
//
// 能力：
//   ① 扫描任务所在仓库 / 工作目录的 .claude/skills（组任务按任务落库的 repoKey 解析）；
//   ② 在任务编辑页底部 dock 提供技能选择面板，选中结果按 task.id 绑定；
//   ③ 领取交付时把选中的技能渲染成 nxkv.plugin.skill-ref.skills 区块，
//      内置模板要求 agent 强制加载 SKILL.md；
//   ④ 候选条目走宿主的 candidates 标准接口（面板 / 未来正文搜索与引用共用）。
import { definePlugin, paramsOf, type PluginCandidate, type PluginContext } from '@nx-kv/plugin-sdk';
import {
  migrateStorage,
  readSettings,
  readTaskSkills,
  STORAGE_VERSION,
  writeSettings,
  writeTaskSkills,
} from './storage.js';
import { scanSkills, type SkillEntry, type SkillScanResult } from './skills.js';

const BUILTIN_TEMPLATE = `〔技能加载 · 任务 #{{task.id}}〕
本任务指定了 {{skillCount}} 个技能。开始执行前，必须先用 Skill 工具（或直接读取下列 SKILL.md）**完整加载**这些技能，并严格遵循其中的流程与约束：
{{#each skills}}
- {{name}}
  路径：{{path}}
  说明：{{description}}
{{/each}}
不得跳过加载；如果某个技能无法读取，先报告路径并停下等指令，不要凭猜测继续。`;

/** 扫一次当前上下文可见的技能（repo / cwd / 用户配置目录）。 */
function scanOf(ctx: PluginContext): SkillScanResult {
  const settings = readSettings(ctx.storage);
  const result = scanSkills({
    repoRoot: ctx.topic?.repoRoot || '',
    cwd: String(ctx.cwd || ctx.topic?.cwd || ''),
    extraDirs: settings.extraDirs,
  });
  for (const warning of result.warnings) ctx.log('warn', warning);
  return result;
}

function clip(text: string, max: number): string {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…（完整说明见 SKILL.md）`;
}

function toCandidate(skill: SkillEntry): PluginCandidate {
  return {
    id: skill.id,
    label: skill.name,
    description: skill.description,
    kind: 'skill',
    path: skill.skillFile,
    text: [skill.name, skill.dirName, skill.description, skill.dir, skill.skillFile, skill.root].join(' '),
    meta: {
      dir: skill.dir,
      dirName: skill.dirName,
      root: skill.root,
      source: skill.source,
      skillFile: skill.skillFile,
    },
  };
}

export default definePlugin({
  id: 'skill-ref',
  version: '0.1.0',
  api: '^1',
  name: '技能引用',
  description: '扫描 .claude/skills，把技能绑定到任务；领取时要求 agent 强制加载。',
  icon: 'star',
  order: 30,
  defaultEnabled: true,
  storageVersion: STORAGE_VERSION,
  migrateStorage,
  entries() {
    return [];
  },
  async buildDraft() {
    throw new Error('技能引用只提供 gettask 区块，不生成 pretask 草稿');
  },
  gettask() {
    return [
      {
        id: 'skills',
        label: '技能引用',
        description: '选择技能；领取时要求 agent 强制加载对应 SKILL.md',
        tag: 'skills',
        order: 10,
        template: BUILTIN_TEMPLATE,
        fields: [
          { key: 'skills', kind: 'list', label: '选中的技能', desc: '每条含 name / path / dir / description' },
          { key: 'skills[].name', kind: 'string', label: '技能名' },
          { key: 'skills[].path', kind: 'string', label: 'SKILL.md 路径' },
          { key: 'skills[].dir', kind: 'string', label: '技能目录' },
          { key: 'skills[].description', kind: 'text', label: '技能说明' },
          { key: 'skillCount', kind: 'number', label: '技能数量' },
        ],
        ui: { panel: 'skill-picker', title: '技能引用' },
        data(ctx) {
          // 任务从创建起就是真实实体，直接用任务号。
          const taskKey = String(ctx.task.id || '');
          const ids = readTaskSkills(ctx.storage, taskKey);
          if (!ids.length) return null;
          const byId = new Map(scanOf(ctx).skills.map((skill) => [skill.id, skill]));
          const skills = ids
            .map((id) => byId.get(id))
            .filter((skill): skill is SkillEntry => !!skill)
            .map((skill) => ({
              name: skill.name,
              path: skill.skillFile,
              dir: skill.dir,
              description: clip(skill.description, 600),
            }));
          if (!skills.length) return null;
          return { skillCount: skills.length, skills };
        },
      },
    ];
  },
  candidates(ctx) {
    return scanOf(ctx).skills.map(toCandidate);
  },
  rpc: {
    async getSettings(ctx) {
      return readSettings(ctx.storage);
    },
    async setSettings(ctx, raw) {
      return writeSettings(ctx.storage, paramsOf(raw));
    },
    async taskSkillsGet(ctx, raw) {
      const p = paramsOf(raw);
      const key = p.taskKey ?? p.taskId ?? '';
      if (key === '') return { taskKey: '', ids: [] };
      return { taskKey: String(key), ids: readTaskSkills(ctx.storage, key) };
    },
    async taskSkillsSave(ctx, raw) {
      const p = paramsOf(raw);
      const key = p.taskKey ?? p.taskId;
      if (key === undefined || key === null || key === '') {
        throw new Error('需要 taskKey（任务号或草稿键）');
      }
      return { taskKey: String(key), ids: writeTaskSkills(ctx.storage, key, p.ids) };
    },
  },
});
