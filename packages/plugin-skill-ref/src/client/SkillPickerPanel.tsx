// 任务编辑页底部 dock 的「技能引用」面板：列出候选技能，按任务选中。
//
// 候选条目走宿主的 candidates 标准接口（/api/plugins/candidates），
// 选中结果走插件自己的 RPC（taskSkillsGet / taskSkillsSave，按 task.id 绑定）。
import { useEffect, useMemo, useState } from 'react';
import type { PluginClientApi } from '@nx-kv/plugin-sdk/client';

interface Candidate {
  id: string;
  label: string;
  description?: string;
  kind?: string;
  path?: string;
  pluginId?: string;
  pluginName?: string;
  meta?: {
    dir?: string;
    dirName?: string;
    root?: string;
    source?: string;
    skillFile?: string;
  };
}

const SOURCE_LABEL: Record<string, string> = {
  repo: '仓库',
  cwd: '工作目录',
  config: '配置目录',
};

function msgOf(e: unknown): string {
  return String((e as Error)?.message || e);
}

export default function SkillPickerPanel({ api }: { api: PluginClientApi }) {
  // 真实任务 = 数字任务号；草稿 = draft-N（提交后由 onTaskCreated 迁移）。
  const taskKey = String(api.ctx.location?.taskId || '');
  const isDraft = /^draft/i.test(taskKey);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [list, picked] = await Promise.all([
        api.host.get<{ candidates?: Candidate[] }>('/api/plugins/candidates', {
          pluginId: 'skill-ref',
          topic: api.ctx.topicKey,
          repo: api.ctx.repoKey,
          group: api.ctx.groupKey,
        }),
        api.rpc('taskSkillsGet', { taskKey }),
      ]);
      setCandidates(Array.isArray(list?.candidates) ? list.candidates : []);
      setSelected(new Set(Array.isArray(picked?.ids) ? picked.ids : []));
    } catch (e) {
      setError(msgOf(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!taskKey) {
      setLoading(false);
      return;
    }
    void load();
    // load 依赖 api / taskKey；api 由宿主按 ctx memo
  }, [api, taskKey]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((c) =>
      [c.label, c.description, c.path, c.meta?.dirName, c.meta?.root]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [candidates, query]);

  const candidateIds = useMemo(() => new Set(candidates.map((c) => c.id)), [candidates]);
  const missing = useMemo(
    () => [...selected].filter((id) => !candidateIds.has(id)),
    [selected, candidateIds],
  );

  // 单个技能引用切换：点击即按任务（草稿用 draft-N）保存，不做多选 + 批量保存。
  const toggleSkill = async (id: string) => {
    if (!taskKey) {
      api.toast('任务号未确定，无法保存');
      return;
    }
    if (busy) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setBusy(true);
    setBusyId(id);
    try {
      const r = await api.rpc('taskSkillsSave', { taskKey, ids: [...next] });
      setSelected(new Set(Array.isArray(r?.ids) ? r.ids : [...next]));
    } catch (e) {
      api.toast(msgOf(e));
    } finally {
      setBusy(false);
      setBusyId('');
    }
  };

  if (!taskKey) {
    return <div className="skr-empty">任务号未确定。</div>;
  }
  if (loading) return <div className="skr-empty">扫描技能目录…</div>;
  if (error) {
    return (
      <div className="skr-empty">
        读取失败：{error}
        <button type="button" className="btn ghost sm" onClick={() => void load()}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="skr-panel">
      <div className="skr-head">
        <b>{isDraft ? `技能引用 · 草稿 ${taskKey}` : `技能引用 #${taskKey}`}</b>
        <span className="muted">已引用 {selected.size}</span>
        <span className="skr-spacer" />
        <input
          className="skr-search"
          value={query}
          placeholder="搜索技能名 / 描述 / 路径"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn ghost sm" onClick={() => void load()} disabled={busy}>
          刷新
        </button>
      </div>

      {isDraft ? (
        <div className="skr-draft-hint">点每行右侧「引用 / 移除」即时保存；草稿提交后自动带到新任务。</div>
      ) : null}

      {missing.length > 0 ? (
        <div className="skr-warn">
          有 {missing.length} 个已引用技能在当前目录下找不到（目录被移除或改名）；仍会保留，可点「移除」清掉。
        </div>
      ) : null}

      <div className="skr-list">
        {filtered.length === 0 ? (
          <div className="skr-empty">
            {candidates.length === 0
              ? '当前上下文没有找到技能。把技能放到仓库根的 .claude/skills/<名称>/SKILL.md，或在左下角「技能引用设置」里添加目录。'
              : `没有匹配「${query}」的技能。`}
          </div>
        ) : (
          filtered.map((c) => {
            const picked = selected.has(c.id);
            return (
              <div className="skr-row" key={c.id}>
                <span className="skr-main">
                  <span className="skr-title">
                    <b>{c.label}</b>
                    <span className={`skr-badge ${c.meta?.source || ''}`}>
                      {SOURCE_LABEL[c.meta?.source || ''] || c.meta?.source || '技能'}
                    </span>
                    {c.meta?.dirName && c.meta.dirName !== c.label ? (
                      <span className="skr-dirname">{c.meta.dirName}</span>
                    ) : null}
                  </span>
                  {c.description ? <span className="skr-desc">{c.description}</span> : null}
                  <span className="skr-path mono" title={c.path || ''}>
                    {c.path || c.meta?.dir || c.id}
                  </span>
                </span>
                <span className="skr-side">
                  <span className={`skr-state${picked ? ' on' : ''}`}>{picked ? '已引用' : '未引用'}</span>
                  <button
                    type="button"
                    className={`btn ${picked ? 'ghost' : 'primary'} xs`}
                    disabled={busy}
                    onClick={() => void toggleSkill(c.id)}
                  >
                    {busyId === c.id ? '保存中…' : picked ? '移除' : '引用'}
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
