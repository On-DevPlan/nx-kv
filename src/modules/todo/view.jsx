// 清单页：三个桶（待办 / 已完成 / 冻结）+ 主题筛选 + 增删改查与状态流转。
// 每个按钮 = 一条 /api 路由 = 一条 CLI 命令（三者同源于模块的 action 声明）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useStore } from '../../web/frontend/store.jsx';
import { useToast, useGuard, useDialog, Modal, Copyable } from '../../web/frontend/components/ui.jsx';
import { CliHints } from '../../web/frontend/components/CliHints.jsx';

const BUCKETS = [
  ['open', '待办'],
  ['done', '已完成'],
  ['freeze', '冻结'],
];

const shortTime = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');

// 单个桶超过这个条数就折叠。已完成常年上百条，全铺出来会把待办挤到看不见。
const COLLAPSE_AT = 15;

// 一个任务在哪些桶里可能重名 —— 定位按内容，UI 必须能显示出内容重复
const taskKey = (bucket, t) => `${bucket}:${t.id}:${t.text}`;

function TaskRow({ bucket, task, dupCount, onAct }) {
  const isDone = bucket === 'done';
  const isFrozen = bucket === 'freeze';
  const dt = isDone ? task.doneAt : isFrozen ? task.frozenAt : task.createdAt;

  return (
    <div className="row">
      <span className="tid">#{task.id}</span>
      <Copyable className="topic" text={task.topic} title="点击复制主题">{task.topic}</Copyable>
      <span className="text" title={task.text}>{task.text}</span>
      {dupCount > 1 ? (
        <span className="tag" title={`同内容有 ${dupCount} 条，操作时需要消歧`}>同内容×{dupCount}</span>
      ) : null}
      <span className="muted time">{shortTime(dt)}</span>
      <span className="acts">
        {bucket === 'open' ? (
          <>
            <button className="btn small" onClick={() => onAct('done', task)}>完成</button>
            <button className="btn small ghost" onClick={() => onAct('freeze', task)}>冻结</button>
          </>
        ) : null}
        {isFrozen ? (
          <button className="btn small" onClick={() => onAct('unfreeze', task)}>解冻</button>
        ) : null}
        <button className="btn small ghost" onClick={() => onAct('edit', task, bucket)}>编辑</button>
        <button className="btn small ghost danger" onClick={() => onAct('remove', task, bucket)}>删除</button>
      </span>
      {task.note ? <div className="note">{task.note}</div> : null}
    </div>
  );
}

export default function TodoView() {
  const { boot, ui, patchUi, refreshBoot } = useStore();
  const toast = useToast();
  const guard = useGuard();
  const { dialog, node: dialogNode } = useDialog();

  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ topic: '', text: '' });
  const [modal, setModal] = useState(null);
  // 已完成常常上百条，默认只展示前 N 条，避免整页全是历史噪音
  const [expanded, setExpanded] = useState({});

  const group = boot?.groupId ?? 0;
  const groupName = (boot?.groups || []).find((g) => g.id === group)?.name || (group ? `#${group}` : '默认组');

  const load = useCallback(async () => {
    if (!boot?.loggedIn) return;
    try {
      setData(await api('/api/todo'));
    } catch (e) {
      toast(e.message);
    }
  }, [boot?.loggedIn, toast]);

  useEffect(() => {
    load();
    // groupId 变化后必须重取 —— 否则界面还显示上一个工作空间的数据
  }, [load, group]);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  // 同内容出现几次 —— 让用户在点「删除」前就看见歧义风险。
  // 按内容而不是 id 统计：id 会被复用（分配只扫 open + freeze），拿它计数毫无意义。
  const dupCounts = useMemo(() => {
    const m = new Map();
    if (!data) return m;
    for (const [key] of BUCKETS) {
      for (const t of data[key] || []) m.set(t.text, (m.get(t.text) || 0) + 1);
    }
    return m;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const topic = ui.topic;
    const pick = (arr) => (arr ? (topic ? arr.filter((t) => t.topic === topic) : arr) : null);
    return { open: pick(data.open), done: pick(data.done), freeze: pick(data.freeze) };
  }, [data, ui.topic]);

  if (!boot?.loggedIn) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="colhead"><h3>请先登录</h3></div>
        <div className="muted">在「登录」页填写邮箱与密码，或执行 <code>nx-kv auth login &lt;email&gt;</code>。</div>
      </div>
    );
  }

  // 消歧：同内容多条时让用户选一条（与 CLI 的 --pick 对应）。
  //
  // 定位按**内容**而不是 id —— id 会被复用（分配只扫 open + freeze），
  // 拿它定位迟早改错数据。
  //
  // 返回的 `pick` 是**在候选列表里的下标**，必须原样回传给后端 ——
  // 否则后端会再次面对「同内容多条」而拒绝执行（这是刻意的：
  // 不替调用方猜）。候选顺序与服务端 locateAll 一致：
  // 按 open → done → freeze、桶内按数组顺序。
  const pickOne = async (task, bucket) => {
    const candidates = [];
    for (const [key] of BUCKETS) {
      for (const t of data[key] || []) if (t.text === task.text) candidates.push({ bucket: key, task: t });
    }
    if (candidates.length <= 1) return { bucket, task, pick: undefined };

    const self = candidates.findIndex((c) => c.bucket === bucket && c.task.createdAt === task.createdAt);
    const answer = await dialog({
      title: `「${task.text.slice(0, 30)}」有 ${candidates.length} 条，选哪一条？`,
      message: candidates
        .map((c, i) => `[${i}] ${c.bucket}  ${shortTime(c.task.createdAt)}  #${c.task.id}`)
        .join('\n'),
      input: true,
      placeholder: `输入 0..${candidates.length - 1}`,
      value: String(self >= 0 ? self : 0),
    });
    if (answer === null) return null;
    const i = Number(answer);
    if (!Number.isInteger(i) || !candidates[i]) {
      toast(`请输入 0..${candidates.length - 1}`);
      return null;
    }
    return { ...candidates[i], pick: i };
  };

  const onAct = (act, task, bucket) => guard(async () => {
    // 会改动「某一条」的动作都要先消歧；状态流转只作用于待办/冻结，那里的内容一般唯一
    const needsPick = act === 'remove' || act === 'edit';
    const target = needsPick ? await pickOne(task, bucket) : { bucket, task, pick: undefined };
    if (!target) return;
    // 定位键：当前内容。edit 时即便内容被改成新的，也是用改前的内容定位。
    const body = { group, ref: target.task.text, pick: target.pick };

    if (act === 'done') {
      const result = await dialog({ title: '完成结果', message: `完成「${task.text.slice(0, 40)}」`, input: true, placeholder: '可选：写一句完成结果' });
      if (result === null) return;
      await api('/api/todo/done', { method: 'POST', body: { ...body, result: result || undefined } });
      toast('已完成');
    } else if (act === 'freeze') {
      await api('/api/todo/freeze', { method: 'POST', body });
      toast('已冻结');
    } else if (act === 'unfreeze') {
      await api('/api/todo/unfreeze', { method: 'POST', body });
      toast('已解冻');
    } else if (act === 'remove') {
      const ok = await dialog({ message: `删除「${task.text.slice(0, 40)}」？`, danger: true });
      if (!ok) return;
      await api('/api/todo/item', { method: 'DELETE', body });
      toast('已删除');
    } else if (act === 'edit') {
      const text = await dialog({ title: '编辑内容', input: true, value: target.task.text });
      if (text === null || !text) return;
      await api('/api/todo/item', {
        method: 'PATCH',
        body: { ...body, text, matchTopic: target.task.topic },
      });
      toast('已更新');
    }
    await reload();
    await refreshBoot();
  });

  // 归档：把已完成里较旧的条目移到冷 key（todo:done:cold:<日期>）。
  // 后端没有「批量删」接口，所以这是清理已完成列表的唯一手段。
  const archive = () => guard(async () => {
    const before = await dialog({
      title: '归档已完成的旧记录',
      message: '把「完成时间早于该日期」的记录移到冷 key（默认 30 天前）。留空用默认值。',
      input: true,
      placeholder: 'YYYY-MM-DD，留空 = 30 天前',
    });
    if (before === null) return;
    const r = await api('/api/todo/archive', { method: 'POST', body: { before: before.trim() || undefined, group } });
    toast(r.moved ? `已归档 ${r.moved} 条 → ${r.coldKey}` : '没有需要归档的记录');
    await reload();
  });

  const add = () => guard(async () => {
    const topic = form.topic.trim();
    const text = form.text.trim();
    if (!topic) { toast('请填主题'); return; }
    if (!text) { toast('请填内容'); return; }
    const r = await api('/api/todo', { method: 'POST', body: { topic, text, group } });
    setForm({ topic, text: '' });
    toast(`已加入待办${r.topicAdded ? `（新主题 ${topic}）` : ''}`);
    await reload();
  });

  const visible = (key, items) => (expanded[key] ? items : items.slice(0, COLLAPSE_AT));

  const topics = data?.topics || [];
  const counts = filtered
    ? BUCKETS.map(([k, label]) => `${label} ${(filtered[k] || []).length}`).join(' · ')
    : '';

  return (
    <>
      <div className="toolbar">
        <label>工作空间</label>
        <span className="pill on">{groupName}</span>
        <span className="sep"></span>
        <label>主题</label>
        <select value={ui.topic} onChange={(e) => patchUi({ topic: e.target.value })}>
          <option value="">全部</option>
          {topics.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="sep"></span>
        <input placeholder="主题" size="8" value={form.topic}
          onChange={(e) => setForm({ ...form, topic: e.target.value })} />
        <input placeholder="要做什么…" size="30" value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button className="btn" onClick={add}>加入待办</button>
        <button className="btn ghost" onClick={reload} disabled={busy}>{busy ? '刷新中…' : '刷新'}</button>
      </div>

      <div className="muted" style={{ margin: '0 0 8px 2px', fontSize: 12 }}>{counts}</div>

      <div className="cols">
        {BUCKETS.map(([key, label]) => (
          <div className="col" key={key}>
            <div className="colhead">
              <h3>{label}</h3>
              <span className="muted">{(filtered?.[key] || []).length}</span>
              {key === 'done' && (filtered?.done || []).length ? (
                <button className="btn small ghost" style={{ marginLeft: 'auto' }} onClick={archive}
                  title="把较旧的完成记录移到冷 key">归档旧记录</button>
              ) : null}
            </div>
            <div className="card list">
              {(filtered?.[key] || []).length
                ? visible(key, filtered[key]).map((t) => (
                    <TaskRow key={taskKey(key, t)} bucket={key} task={t}
                      dupCount={dupCounts.get(t.text) || 1} onAct={onAct} />
                  ))
                : <div className="row muted">（空）</div>}
              {(filtered?.[key] || []).length > COLLAPSE_AT ? (
                <div className="row muted" style={{ cursor: 'pointer', justifyContent: 'center' }}
                  onClick={() => setExpanded((e) => ({ ...e, [key]: !e[key] }))}>
                  {expanded[key] ? '收起' : `还有 ${filtered[key].length - COLLAPSE_AT} 条，点击展开`}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <CliHints module="todo" />
      {modal ? <Modal title={modal.title} onClose={() => setModal(null)}>{modal.node}</Modal> : null}
      {dialogNode}
    </>
  );
}
