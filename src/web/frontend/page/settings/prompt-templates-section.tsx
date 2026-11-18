// 设置面板「提示词模板」（#161：只读注册表 + 用户层模板管理）。
//
// 结构（#152 定型）：出厂正文 = 插件类里的 `templates`（代码即出厂真相）；
// #161 在其上叠加**用户层**（template-store，JSON）：每段可复制出多条模板、
// 启用哪条自己挑、编辑保存走后端变量白名单校验。编辑器在 prompt-template-editor.tsx。
//
// 这一页回答四个问题：
//   1. 有哪些时机（get / check / done）、每个时机依次有哪些段 —— 注册表 groups；
//   2. 每一段当前用的正文 —— 启用模板（builtin 或用户条目），可编辑可复制；
//   3. 这一段能吃哪些变量 —— 注册表 fields（声明即文档，不写第二份）；
//   4. 真实领取的输出长什么样 —— 交付预览（含 timegoal check 链的同源效果）。
import { useEffect, useState } from 'react';
import { Button } from '../../components/button/index.js';
import { useToast } from '../../components/toast/index.jsx';
import {
  getLocaltaskSettings,
  getPromptRegistry,
  previewDelivery,
  saveLocaltaskSettings,
} from './api.js';
import { APPEND_MODES } from '../../../../shared/prompt-blocks.js';
import { varGroupsOf } from './prompt-vars.js';
import PromptTemplateEditor, { type SegmentTemplates } from './prompt-template-editor.js';

/** 注册表里的一段（= 一个插件的声明面；/api/prompt/registry 的 plugins 项）。 */
export interface PluginDesc {
  id: string;
  group: string;
  order: number;
  tag: string;
  label: string;
  template: string;
  templates: { id: string; name: string; text: string }[];
  fields: { key: string; kind: string; label: string; desc?: string }[];
  /** 本段可见的顶层段 = seed ∪ 自己的 dataSchema 顶层（每段只看自己的数据） */
  varScope: string[];
}

/** 时机链（后端给的是稳定序；这里只补一句中文说明）。 */
const GROUP_LABEL: Record<string, string> = {
  get: '领取交付（get）',
  check: '每轮检查（check）',
  done: '尝试完成（done）',
};

const GROUP_HINT: Record<string, string> = {
  get: 'agent 执行 get 领走任务时拼在任务正文之后的一大段',
  check: '每轮等待检查时告诉 agent「离目标还差多少」',
  done: 'agent 调 done 时给出的完成门禁',
};

/** 预览结果（POST /api/localtasks/preview 的 segments = compose 的 trace）。 */
interface PreviewResult {
  instruction: string;
  segments: { id: string; label: string; text: string }[];
  at: string;
}

function groupLabel(g: string): string {
  return GROUP_LABEL[g] || g;
}

export default function PromptTemplatesSection() {
  const toast = useToast();
  const [plugins, setPlugins] = useState<PluginDesc[] | null>(null);
  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [appendMode, setAppendMode] = useState<string>('xml');
  const [selectedId, setSelectedId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [varQuery, setVarQuery] = useState('');
  const [segTemplates, setSegTemplates] = useState<Record<string, SegmentTemplates>>({});

  const loadRegistry = (onReady: (r: any) => void) => {
    getPromptRegistry()
      .then((r) => {
        const list: PluginDesc[] = Array.isArray(r?.plugins) ? r.plugins : [];
        setPlugins(list);
        setGroups((r?.groups as Record<string, string[]>) || {});
        setSegTemplates(
          (r?.segmentTemplates && typeof r.segmentTemplates === 'object'
            ? (r.segmentTemplates as Record<string, SegmentTemplates>)
            : {}) || {},
        );
        onReady(r);
      })
      .catch((e) => toast('读取失败：' + ((e as Error).message || e)));
  };

  useEffect(() => {
    let alive = true;
    Promise.all([getPromptRegistry(), getLocaltaskSettings()])
      .then(([r, s]) => {
        if (!alive) return;
        const list: PluginDesc[] = Array.isArray(r?.plugins) ? r.plugins : [];
        setPlugins(list);
        setGroups((r?.groups as Record<string, string[]>) || {});
        setSegTemplates(
          (r?.segmentTemplates && typeof r.segmentTemplates === 'object'
            ? (r.segmentTemplates as Record<string, SegmentTemplates>)
            : {}) || {},
        );
        const mode = s?.settings?.appendMode === 'plain' ? 'plain' : 'xml';
        setAppendMode(mode);
        // 默认选中 get 链首段（agent 最常看到的那一段）
        const first = (r?.groups?.get?.[0] as string) || list[0]?.id || '';
        setSelectedId(first);
      })
      .catch((e) => alive && toast('读取失败：' + ((e as Error).message || e)));
    return () => {
      alive = false;
    };
  }, [toast]);

  if (!plugins) return <div className='setp-note'>读取提示词注册表…</div>;
  const selected = plugins.find((p) => p.id === selectedId) || plugins[0];
  if (!selected) return <div className='setp-note'>注册表为空：没有任何提示词插件。</div>;

  const order = Object.keys(groups).length ? Object.keys(groups) : [...new Set(plugins.map((p) => p.group))];
  const byId = new Map(plugins.map((p) => [p.id, p]));
  const varGroups = varGroupsOf(selected.fields, varQuery);
  const activeMode = APPEND_MODES.find((m) => m.id === appendMode) || APPEND_MODES[0]!;

  const setMode = async (mode: string) => {
    if (busy || mode === appendMode) return;
    setBusy(true);
    try {
      const d = await saveLocaltaskSettings({ appendMode: mode === 'plain' ? 'plain' : 'xml' });
      setAppendMode(d?.appendMode === 'plain' ? 'plain' : 'xml');
      setPreview(null); // 追加方式变了，旧预览已不代表当前输出
      toast('已保存追加模式（全局生效）');
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await previewDelivery({ id: 0, text: '（预览草稿）这是一条用于查看提示词渲染效果的任务', summary: '' });
      setPreview({
        instruction: String(d?.instruction || ''),
        segments: Array.isArray(d?.segments) ? d.segments : [],
        at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      });
      setPreviewOpen(true);
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='setp-tpl-editor'>
      <div className='setp-tpl-head'>
        <span className='setp-tpl-head-label'>系统提示词追加方式</span>
        <div className='setp-seg' role='group' aria-label='系统提示词追加方式'>
          {APPEND_MODES.map((m) => (
            <button
              key={m.id}
              type='button'
              className={'setp-seg-btn' + (appendMode === m.id ? ' is-on' : '')}
              aria-pressed={appendMode === m.id}
              title={m.desc}
              disabled={busy}
              onClick={() => void setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className='setp-note'>{activeMode.desc}</span>
      </div>

      <div className='ppt-split'>
        {/* 左轨：按时机分组，只做导航（顺序由类声明 order 决定，不可拖） */}
        <div className='ppt-rail'>
          <div className='ppt-rail-head'>
            <b>时机 / 段落</b>
            <span className='setp-note'>共 {plugins.length} 段</span>
          </div>
          <div className='ppt-rail-list'>
            {order.map((g) => {
              const ids = groups[g] || plugins.filter((p) => p.group === g).map((p) => p.id);
              return (
                <div key={g} className='ppt-grp'>
                  <div className='ppt-grp-head' title={GROUP_HINT[g] || ''}>
                    {groupLabel(g)}
                  </div>
                  {ids.map((id, i) => {
                    const p = byId.get(id);
                    if (!p) return null;
                    return (
                      <div
                        key={id}
                        className={'ppt-rail-row' + (p.id === selected.id ? ' is-on' : '')}
                        role='button'
                        tabIndex={0}
                        onClick={() => setSelectedId(id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedId(id);
                          }
                        }}
                      >
                        <span className='ppt-rail-pos'>{i + 1}</span>
                        <span className='ppt-rail-main'>
                          <span className='ppt-rail-label'>{p.label}</span>
                          <span className='ppt-rail-active'>{p.id}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* 右区：内置正文（只读）+ 变量目录 + 交付预览 */}
        <div className='ppt-ed'>
          <div className='ppt-ed-head'>
            <div className='ppt-ed-title'>
              <b>{selected.label}</b>
              <code className='ppt-ed-tag'>{selected.tag}</code>
              <span
                className='ppt-pill is-write'
                title={`本段渲染时的数据域：${selected.varScope.join(' / ')}（seed + 本段自己产的数据；不含别的段）`}
              >
                数据域 {selected.varScope.filter((s) => !['task', 'cwd', 'goal', 'source', 'summary', 'name', 'params'].includes(s)).join(' · ') || '仅任务上下文'}
              </span>
              <span className='ppt-pill'>{groupLabel(selected.group)} · 第 {selected.order} 位</span>
            </div>
            <span className='ppt-ed-sub'>
              {GROUP_HINT[selected.group] || ''}
              {' · 本段的模板只能引用自己的变量与任务上下文，别的段的数据引用不到'}
            </span>
          </div>

          <PromptTemplateEditor
            segment={selected.id}
            label={selected.label}
            builtinText={selected.template}
            seg={segTemplates[selected.id]}
            onChanged={() => loadRegistry(() => toast('注册表已刷新'))}
          />

          {selected.fields.length > 0 && (
            <div className='ppt-vars' aria-label='该段可用变量'>
              <div className='ppt-vars-head'>
                <span className='ppt-vars-cap'>可用变量（{selected.fields.length}）</span>
                <input
                  className='ppt-vars-q'
                  value={varQuery}
                  placeholder='过滤变量，如 localPath'
                  aria-label='过滤变量'
                  onChange={(e) => setVarQuery(e.target.value)}
                />
              </div>
              <div className='ppt-vars-body'>
                {varGroups.map((g) => (
                  <div className='ppt-vars-grp' key={g.group || '_main'}>
                    {g.group && (
                      <div className='ppt-vars-grp-head' title={`在 {{#each ${g.group.slice(0, -2)}}} 内部写相对名`}>
                        {g.group} 内部（each 里写相对名，共 {g.rows.length}）
                      </div>
                    )}
                    <div className='ppt-vars-chips'>
                      {g.rows.map((r) => (
                        <code
                          key={r.full}
                          className='ppt-var'
                          aria-disabled='true'
                          title={`${r.full}${r.desc ? ` —— ${r.desc}` : ''}`}
                        >
                          <span className='ppt-var-key'>{r.rel}</span>
                          {r.label && r.label !== r.full && r.label !== r.rel && (
                            <span className='ppt-var-desc'>{r.label}</span>
                          )}
                        </code>
                      ))}
                    </div>
                  </div>
                ))}
                {varGroups.length === 0 && <span className='ppt-vars-cap'>没有匹配「{varQuery}」的变量</span>}
              </div>
            </div>
          )}

          <div className='ppt-actions'>
            <span className='setp-note'>模板改动即时生效（交付与 timegoal check 同源）。</span>
            <span className='spacer' />
            <Button
              variant='secondary'
              className='ppt-preview-btn'
              disabled={busy}
              title='用一条草稿任务渲染当前内置模板的实际输出'
              onClick={() => void runPreview()}
            >
              预览交付
            </Button>
          </div>

          <div className='ppt-pv'>
            <button type='button' className='ppt-pv-head' aria-expanded={previewOpen} onClick={() => setPreviewOpen((v) => !v)}>
              <b>交付预览</b>
              <span className='setp-note'>
                {preview ? `命中 ${preview.segments.length}/${plugins.length} 段 · ${preview.at} 渲染` : '尚未渲染 · 按内置模板合成'}
              </span>
              <span className='ppt-pv-toggle'>{previewOpen ? '收起 ⌃' : '展开 ⌄'}</span>
            </button>
            {previewOpen && (
              <div className='ppt-pv-body'>
                {preview ? (
                  <>
                    <pre className='ppt-pv-pre'>{preview.instruction || '（本次领取没有可输出的段落）'}</pre>
                    {preview.segments.length > 0 && (
                      <div className='ppt-pv-segs'>
                        {preview.segments.map((s, i) => (
                          <span className='ppt-pv-seg' key={`${s.id}-${i}`}>
                            <span className='ppt-pv-seg-label'>{s.label}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className='ppt-pv-empty'>点右上「预览交付」，用一条草稿任务渲染真实领取时会拿到的提示词。</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
