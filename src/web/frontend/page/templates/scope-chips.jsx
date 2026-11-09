// 模板可见域 chips（#128/#130/#131）：全局开关 + 定向加删 + 创建来源。
// 设置页与管理面板共用——MD 编辑只在 maincontent，可见域配置跟模板走。
import { useMemo, useState } from 'react';
import { useToast } from '../../components/toast/index.jsx';
import { useApp } from '../../app-context.jsx';

/** 从 App 上下文建「scope 条目 → 人话」字典。 */
export function useScopeCatalog() {
  const app = useApp() || {};
  const topics = app.rows || [];
  const repos = (app.repoData && app.repoData.repos) || [];
  const boards = (app.repoData && app.repoData.boards) || [];

  return useMemo(() => {
    const topicByKey = new Map();
    for (const t of topics) {
      if (t && t.key) topicByKey.set(String(t.key), t.name || t.key);
    }
    const repoByKey = new Map();
    for (const r of repos) {
      if (!r || !r.key) continue;
      if ((r.type || 'repo') === 'group') continue;
      repoByKey.set(String(r.key), r.name || r.key);
    }
    const groupByKey = new Map();
    for (const r of repos) {
      if (r && (r.type || '') === 'group' && r.key) {
        groupByKey.set(String(r.key), r.name || r.key);
      }
    }
    for (const b of boards) {
      const k = String((b && (b.key || b.id)) || '');
      if (k) groupByKey.set(k, (b && b.name) || k);
    }
    return { topicByKey, repoByKey, groupByKey, topics, repos, boards };
  }, [topics, repos, boards]);
}

export function scopeLabel(s, catalog) {
  if (s === '*') return '全局';
  const i = String(s).indexOf(':');
  if (i < 0) return String(s);
  const kind = String(s).slice(0, i);
  const key = String(s).slice(i + 1);
  const kindWord = { topic: '目录', repo: '项目', group: '组' }[kind] || kind;
  let name = '';
  if (kind === 'topic') name = catalog.topicByKey.get(key) || '';
  else if (kind === 'repo') name = catalog.repoByKey.get(key) || '';
  else if (kind === 'group') name = catalog.groupByKey.get(key) || '';
  if (name) return `${kindWord} · ${name}`;
  const short = /^[0-9a-f]{16}$/.test(key) ? `${key.slice(0, 6)}…` : key;
  return `${kindWord} ${short}`;
}

export function scopeHint(template) {
  const scope = Array.isArray(template.scope) ? template.scope : [];
  if (!scope.length) return '无绑定';
  if (scope.length === 1 && scope[0] === '*') return '全局';
  if (scope.includes('*') && scope.length > 1) return `${scope.length} 项（含全局）`;
  return `${scope.length} 项`;
}

/**
 * @param {{ scope: string[], onChange: (next: string[]) => void | Promise<void>, originTopic?: string, catalog?: ReturnType<typeof useScopeCatalog>, classPrefix?: string }} props
 * onChange 既可受控即时保存（管理面板），也可只改草稿（新增表单）。
 */
export default function ScopeChips({
  scope: rawScope,
  onChange,
  originTopic = '',
  catalog: catalogProp,
  classPrefix = 'setp',
}) {
  const toast = useToast();
  const catalogHook = useScopeCatalog();
  const catalog = catalogProp || catalogHook;
  const [picker, setPicker] = useState(null);
  const scope = Array.isArray(rawScope) ? rawScope : [];
  const hasGlobal = scope.includes('*');
  const rest = scope.filter((s) => s !== '*');
  const p = classPrefix;

  const originName = originTopic
    ? catalog.topicByKey.get(originTopic) ||
      (/^[0-9a-f]{16}$/.test(originTopic) ? `${originTopic.slice(0, 6)}…` : originTopic)
    : '';

  const save = async (next) => {
    try {
      await onChange(next);
    } catch (e) {
      toast(String(e.message || e));
    }
  };

  const addEntry = async (entry) => {
    if (scope.includes(entry)) {
      toast('已经在可见范围里了');
      setPicker(null);
      return;
    }
    await save([...scope, entry]);
    setPicker(null);
  };

  const options = useMemo(() => {
    if (picker === 'topic') {
      return (catalog.topics || [])
        .filter((t) => t && t.key)
        .map((t) => ({
          entry: `topic:${t.key}`,
          label: t.name || t.key,
          sub: t.cwd || '',
        }));
    }
    if (picker === 'repo') {
      return (catalog.repos || [])
        .filter((r) => r && r.key && (r.type || 'repo') !== 'group' && r.key !== '__unbound__')
        .map((r) => ({
          entry: `repo:${r.key}`,
          label: r.name || r.key,
          sub: r.key,
        }));
    }
    if (picker === 'group') {
      const seen = new Set();
      const out = [];
      for (const r of catalog.repos || []) {
        if (!r || (r.type || '') !== 'group' || !r.key || seen.has(r.key)) continue;
        seen.add(r.key);
        out.push({ entry: `group:${r.key}`, label: r.name || r.key, sub: r.key });
      }
      for (const b of catalog.boards || []) {
        const k = b && (b.key || b.id);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push({ entry: `group:${k}`, label: (b && b.name) || k, sub: String(k) });
      }
      return out;
    }
    return [];
  }, [picker, catalog]);

  return (
    <div className={`${p}-scope-block`}>
      <div className={`${p}-scope`}>
        {scope.map((s) => (
          <button
            key={s}
            type="button"
            className={`${p}-scope-chip on`}
            title={`${s} —— 点击移除`}
            onClick={() => save(scope.filter((x) => x !== s))}
          >
            {scopeLabel(s, catalog)} ×
          </button>
        ))}
      </div>
      <div className={`${p}-scope-add`}>
        <span className={`${p}-scope-add-label`}>添加</span>
        <button
          type="button"
          className={`${p}-scope-add-btn`}
          disabled={hasGlobal}
          title={hasGlobal ? '已绑定全局' : '加上「全局」绑定（与目录/项目/组平级）'}
          onClick={() => !hasGlobal && save(['*', ...rest])}
        >
          全局
        </button>
        {['topic', 'repo', 'group'].map((k) => (
          <button
            key={k}
            type="button"
            className={`${p}-scope-add-btn` + (picker === k ? ' on' : '')}
            onClick={() => setPicker(picker === k ? null : k)}
          >
            {{ topic: '目录', repo: '项目', group: '组' }[k]}
          </button>
        ))}
        {originName ? (
          <span className={`${p}-scope-origin`} title={`创建于主题 ${originTopic}`}>
            创建于 {originName}
          </span>
        ) : null}
      </div>
      {picker && (
        <div className={`${p}-scope-pick`} role="listbox" aria-label="选择可见对象">
          {!options.length ? (
            <div className={`${p}-scope-pick-empty`}>暂无可选项</div>
          ) : (
            options.map((o) => (
              <button
                key={o.entry}
                type="button"
                className={`${p}-scope-pick-it`}
                disabled={scope.includes(o.entry)}
                title={o.sub || o.entry}
                onClick={() => addEntry(o.entry)}
              >
                <span className={`${p}-scope-pick-name`}>{o.label}</span>
                {scope.includes(o.entry) ? (
                  <span className={`${p}-scope-pick-done`}>已加</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
