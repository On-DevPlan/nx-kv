// 目录详情页的展示层组件：顶栏占位、本机卡片、云端卡片、云端三列。
//
// 从 view-dir.jsx 拆出来——那里是「状态与编排」，这里是「画什么」；
// 混在一起会把视图文件撑到闸门之外（对齐设计稿 §7.1 的组件划分意图）。
import { useState } from 'react';
import { Icon } from '../../web/frontend/components/icons.jsx';

export function fmtCreated(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s || ''));
  return m ? `${m[1].slice(5)} ${m[2]}` : String(s || '');
}

export function TopBar({ topic, onNavigate }) {
  return (
    <div className="topbar">
      <button className="back" aria-label="返回" onClick={() => onNavigate('#/overview')}><Icon name="back" size={16} /></button>
      <div className="tt"><div className="n">{topic?.name || '目录'}</div></div>
    </div>
  );
}

export function LocalCard({ t, expanded, toggleExpand, menu, fail, flash, draggable, onDragStart, onDragEnd, onDragOver, onDrop, insertAfter }) {
  const long = t.text.length > 160 || t.text.split('\n').length > 4;
  const migrated = !!t.migratedTo;
  return (
    <div
      className={
        'card' + (migrated ? ' tomb' : '') + (fail ? ' fail' : '') + (flash ? ' flash' : '') +
        (insertAfter ? ' d-after' : '')
      }
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      title={t.text}
    >
      <div className="tx">{t.text}</div>
      {long && (
        <button className="more-tx" onClick={toggleExpand}>{expanded ? '收起' : '展开全文'}</button>
      )}
      {migrated ? (
        <div className="rsum">
          已迁移 → 云端「{t.migratedTo.topic}」 · {fmtCreated(t.migratedTo.at)}
        </div>
      ) : (
        t.roundSummary && <div className="rsum"><b>回执</b> {t.roundSummary}</div>
      )}
      <div className="meta">
        <span className="mono">#{t.id}</span>
        <span>{fmtCreated(t.createdAt)}</span>
        {t.from === 'cloud' && <span className="tag src">来自云端</span>}
        {t.status === 'consumed' && <span className="tag">已领取{t.pickupSec != null ? ` · ${t.pickupSec}s` : ''}</span>}
        <span className="grow" />
      </div>
      <span className="ops">
        <button title="更多操作" aria-label="更多操作" onClick={(e) => { e.stopPropagation(); menu({ x: e.clientX, y: e.clientY }); }}>
          <Icon name="dots" size={11} />
        </button>
      </span>
    </div>
  );
}

export function CloudCard({ t, menu, draggable, onDragStart, onDragEnd, fail, flash }) {
  const [expanded, setExpanded] = useState(false);
  const long = t.text.length > 160 || t.text.split('\n').length > 4;
  return (
    <div
      className={'card' + (fail ? ' fail' : '') + (flash ? ' flash' : '') + (expanded ? ' expanded' : '') + (t.from === 'local' ? ' from-local' : '')}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={t.text}
      data-cloud-id={t.id}
    >
      <div className="tx">{t.text}</div>
      {long && <button className="more-tx" onClick={() => setExpanded((v) => !v)}>{expanded ? '收起' : '展开全文'}</button>}
      {t.note && <div className="rsum"><b>note</b> {t.note}</div>}
      <div className="meta">
        <span className="mono">#{t.id}</span>
        <span className="mono faint">{t.topic}</span>
        <span>{fmtCreated(t.createdAt)}</span>
        {t.from === 'local' && <span className="tag src">来自本机</span>}
        {t.doneAt && <span className="tag">{fmtCreated(t.doneAt)} 完成</span>}
        <span className="grow" />
      </div>
      <span className="ops">
        <button title="更多操作" aria-label="更多操作" onClick={(e) => { e.stopPropagation(); menu({ x: e.clientX, y: e.clientY }); }}>
          <Icon name="dots" size={11} />
        </button>
      </span>
    </div>
  );
}

/** 云端三列（待办 / 已完成 / 冻结）。props 与父组件同名，JSX 原样搬过来。 */
export function CloudColumns({
  drag, onCloudColDrop, cloudItems, batchToCloud, startMove, copyText,
  cloudDone, cloudFreeze, cloudUnfreeze, cloudRemove, flashId, failId,
  onCardDragStart, onCardDragEnd, setMenu,
}) {
  return (
      <div className="pane-b" style={{ maskImage: 'none', WebkitMaskImage: 'none' }}>
        <div
          className={'col cloud-col' + (drag && drag.side === 'local' ? ' drop-ok' : '')}
          onDragOver={(e) => { if (drag?.side === 'local') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
          onDrop={onCloudColDrop}
        >
          <div className="col-h">
            待办 <span className="k">{cloudItems?.open.length ?? '…'}</span>
            <span className="grow" />
            <button className="mini" title="批量迁移：把本机待领取全部迁到云端" onClick={batchToCloud}>批量迁移</button>
          </div>
          <div className="col-b">
            {(cloudItems?.open || []).map((t) => (
              <CloudCard key={t.id} t={t} draggable flash={flashId === 'cloud:' + t.id}
                onDragStart={(e) => onCardDragStart(e, { side: 'cloud', topic: t.topic, text: t.text, id: t.id })}
                onDragEnd={onCardDragEnd}
                fail={failId === t.id}
                menu={(p) => setMenu({
                  x: p.x, y: p.y,
                  items: [
                    { label: '迁到本机…', icon: 'flow', onClick: () => startMove('cloud', t) },
                    { label: '复制', icon: 'list', onClick: () => copyText(t.text) },
                    'sep',
                    { label: '标记完成…', icon: 'check', onClick: () => cloudDone(t) },
                    { label: '冻结', icon: 'archive', onClick: () => cloudFreeze(t) },
                    { label: '删除', icon: 'trash', danger: true, onClick: () => cloudRemove(t) },
                  ],
                })}
              />
            ))}
            {cloudItems && !cloudItems.open.length && <div className="col-empty">云端暂无此目录的任务</div>}
          </div>
        </div>
        <div className="col cloud-col">
          <div className="col-h">已完成 <span className="k">{cloudItems?.done.length ?? '…'}</span><span className="grow" /></div>
          <div className="col-b">
            {(cloudItems?.done || []).map((t) => (
              <CloudCard key={t.id} t={t}
                menu={(p) => setMenu({
                  x: p.x, y: p.y,
                  items: [
                    { label: '复制', icon: 'list', onClick: () => copyText(t.text) },
                    t.note ? { label: '复制完成结果', icon: 'list', onClick: () => copyText(t.note) } : null,
                    { label: '删除', icon: 'trash', danger: true, onClick: () => cloudRemove(t) },
                  ].filter(Boolean),
                })}
              />
            ))}
            {cloudItems && !cloudItems.done.length && <div className="col-empty">空</div>}
          </div>
        </div>
        <div className="col cloud-col">
          <div className="col-h">冻结 <span className="k">{cloudItems?.freeze.length ?? '…'}</span><span className="grow" /></div>
          <div className="col-b">
            {(cloudItems?.freeze || []).map((t) => (
              <CloudCard key={t.id} t={t}
                menu={(p) => setMenu({
                  x: p.x, y: p.y,
                  items: [
                    { label: '解冻回待办', icon: 'refresh', onClick: () => cloudUnfreeze(t) },
                    { label: '复制', icon: 'list', onClick: () => copyText(t.text) },
                    { label: '删除', icon: 'trash', danger: true, onClick: () => cloudRemove(t) },
                  ],
                })}
              />
            ))}
            {cloudItems && !cloudItems.freeze.length && <div className="col-empty">空</div>}
          </div>
        </div>
      </div>
  );
}
