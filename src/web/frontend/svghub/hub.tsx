// SVG 资产库页（#/svghub）：**一处存放、多处复用**的可视化资产目录。
//
// 页面的三件事：
//   1) 看得见：全库图标按分类陈列，搜索按「名字 / 中文名 / 别名」命中；
//   2) 弄得懂：选中一份就给出它的名字、分类、挂载点、三种尺寸预览；
//   3) 拿得走：复制 SVG 源码 / 复制 React 用法 / 下载 .svg。
//
// 这里不复制任何图形数据——列表、预览、导出全部读 svghub/index.ts 的同一份
// SVG_ASSETS。资产改了，这页和界面上所有挂载点同时变。
import { useMemo, useState } from 'react';
import { useToast } from '../components/toast/index.jsx';
import { SVG_GROUPS, SVG_ASSETS, assetOf, hubStats, searchAssets } from './index.js';
import type { SvgGroupId } from './types.js';
import { SvgIcon } from './icon.jsx';
import { downloadSvg, svgMarkup } from './serialize.js';
import './hub.css';

/** 分类筛选项：all 是「全部」。 */
type Filter = SvgGroupId | 'all';

const ALL: Filter = 'all';

/** 资产库页（面板 component = 'svghub'）。 */
export default function SvgHub() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(ALL);
  const [sel, setSel] = useState<string>(SVG_ASSETS[0]?.name || '');

  const stats = useMemo(() => hubStats(), []);
  const hits = useMemo(() => {
    const list = searchAssets(q);
    return filter === ALL ? list : list.filter((a) => a.group === filter);
  }, [q, filter]);
  const current = assetOf(sel) || hits[0];

  const copy = async (text: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(ok);
    } catch {
      // 剪贴板在非安全上下文不可用：退回 execCommand（与 components/ui 的 Copyable 同策）
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        toast(ok);
      } catch {
        toast('复制失败（剪贴板不可用）');
      }
    }
  };

  const copySvg = () => {
    if (!current) return;
    void copy(svgMarkup(current), `已复制 ${current.name}.svg 源码`);
  };

  const copyUsage = () => {
    if (!current) return;
    const usage = `<Icon name="${current.name}" />\n<SvgIcon name="${current.name}" size={16} />`;
    void copy(usage, '已复制 React 用法');
  };

  const copyIndex = () => {
    const list = SVG_ASSETS.map((a) => ({ name: a.name, label: a.label, group: a.group, where: a.where || '' }));
    void copy(JSON.stringify(list, null, 2), `已复制资产清单（${list.length} 条）`);
  };

  return (
    <div className="shub">
      <header className="shub-head">
        <div className="shub-title">
          <SvgIcon name="shapes" size={22} />
          <div>
            <h2>SVG 资产库</h2>
            <p className="shub-sub">
              {stats.total} 份资产 · 已挂载 {stats.mounted} · {stats.groups} 个分类
              —— 界面上的图标全部来自这里，改一份就改全场。
            </p>
          </div>
        </div>
        <div className="shub-tools">
          <label className="shub-search">
            <SvgIcon name="search" size={13} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索名字 / 中文名 / 别名，例如 repo、参考仓库、等待"
              aria-label="搜索 SVG 资产"
            />
            {q ? (
              <button type="button" className="shub-clear" title="清空" onClick={() => setQ('')}>
                <SvgIcon name="x" size={12} />
              </button>
            ) : null}
          </label>
          <button type="button" className="btn small ghost" title="把全库清单（名字/中文名/分类/挂载点）复制走" onClick={copyIndex}>
            复制清单
          </button>
        </div>
      </header>

      <div className="shub-chips" role="tablist" aria-label="按分类筛选">
        <button
          type="button"
          role="tab"
          aria-selected={filter === ALL}
          className={'shub-chip' + (filter === ALL ? ' is-on' : '')}
          onClick={() => setFilter(ALL)}
        >
          全部 <span className="shub-chip-n">{SVG_ASSETS.length}</span>
        </button>
        {SVG_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={filter === g.id}
            className={'shub-chip' + (filter === g.id ? ' is-on' : '')}
            title={g.hint}
            onClick={() => setFilter(g.id)}
          >
            {g.label} <span className="shub-chip-n">{SVG_ASSETS.filter((a) => a.group === g.id).length}</span>
          </button>
        ))}
      </div>

      <div className="shub-body">
        <div className="shub-wall" aria-live="polite">
          {hits.length === 0 ? (
            <div className="shub-empty">
              <SvgIcon name="search" size={18} />
              <p>没有命中「{q}」的资产。换个词，或者点「全部」看看。</p>
              <button type="button" className="btn small ghost" onClick={() => { setQ(''); setFilter(ALL); }}>
                清空筛选
              </button>
            </div>
          ) : (
            hits.map((a) => (
              <button
                key={a.name}
                type="button"
                className={'shub-card' + (current && current.name === a.name ? ' is-on' : '')}
                title={`${a.label} · ${a.name}${a.where ? '\n挂载：' + a.where : '\n尚未挂载'}`}
                onClick={() => setSel(a.name)}
              >
                <span className="shub-glyph">
                  <SvgIcon name={a.name} size={28} />
                </span>
                <span className="shub-name">{a.name}</span>
                <span className="shub-label">{a.label}</span>
                {a.where ? null : <span className="shub-fresh">未挂载</span>}
              </button>
            ))
          )}
        </div>

        {current ? (
          <aside className="shub-detail">
            <div className="shub-preview">
              <SvgIcon name={current.name} size={72} />
            </div>
            <div className="shub-detail-h">
              <h3>{current.label}</h3>
              <code className="shub-detail-name">{current.name}</code>
            </div>
            <dl className="shub-meta">
              <dt>分类</dt>
              <dd>{SVG_GROUPS.find((g) => g.id === current.group)?.label || current.group}</dd>
              <dt>挂载点</dt>
              <dd>{current.where || '尚未挂载——资产已入库，等一处用它'}</dd>
              <dt>网格</dt>
              <dd>24×24 · 线宽 {current.w ?? 1.8} · currentColor</dd>
              {current.keys && current.keys.length ? (
                <>
                  <dt>别名</dt>
                  <dd>{current.keys.join(' / ')}</dd>
                </>
              ) : null}
            </dl>

            <div className="shub-sizes">
              <span>实际尺寸</span>
              <span className="shub-size-row">
                {[12, 14, 16, 20].map((n) => (
                  <span key={n} className="shub-size" title={`${n}px`}>
                    <SvgIcon name={current.name} size={n} />
                    <em>{n}</em>
                  </span>
                ))}
              </span>
            </div>

            <div className="shub-acts">
              <button type="button" className="btn small primary" onClick={copySvg}>
                <SvgIcon name="copy" size={13} /> 复制 SVG
              </button>
              <button type="button" className="btn small ghost" onClick={copyUsage}>
                复制用法
              </button>
              <button
                type="button"
                className="btn small ghost"
                title={`下载 ${current.name}.svg`}
                onClick={() => {
                  downloadSvg(current.name, svgMarkup(current));
                  toast(`已下载 ${current.name}.svg`);
                }}
              >
                <SvgIcon name="download" size={13} /> .svg
              </button>
            </div>

            <pre className="shub-code">{svgMarkup(current)}</pre>
            <p className="shub-note">
              增删资产改 <code>src/web/frontend/svghub/catalog-*.ts</code>；
              调用方只认名字，不认图形——这就是复用。
            </p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
