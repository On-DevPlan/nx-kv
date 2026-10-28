// 清单页：三个桶（待办 / 已完成 / 冻结）+ 主题筛选 + 增删改查与状态流转。
// 每个按钮 = 一条 /api 路由 = 一条 CLI 命令（三者同源于模块的 action 声明）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useStore } from '../../web/frontend/store.jsx';
import { useToast, useGuard, useDialog, Modal, Copyable } from '../../web/frontend/components/ui.jsx';
import { CliHints } from '../../web/frontend/components/CliHints.jsx';
import TaskEditor from './editor.jsx';
import GroupPopup from './group-popup.jsx';
import RowMenu from './row-menu.jsx';
import { AttachmentText } from './markdown.jsx';
import { clipboardFiles, snippetsOf, uploadMany } from './upload.js';

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
    <div className="row cloud-row">
      <div className="row-main">
        <span className="tid">#{task.id}</span>
        <Copyable className="topic" text={task.topic} title="点击复制主题">{task.topic}</Copyable>
        <span className="text" title={task.text}>
          <AttachmentText text={task.text} compact />
        </span>
        {dupCount > 1 ? (
          <span className="tag" title={`同内容有 ${dupCount} 条，操作时需要消歧`}>同内容×{dupCount}</span>
        ) : null}
        <span className="muted time">{shortTime(dt)}</span>
        <span className="acts">
          {bucket === 'open' ? (
            <button className="btn small ghost" onClick={() => onAct('done', task)}>完成</button>
          ) : null}
          {isFrozen ? (
            <button className="btn small ghost" onClick={() => onAct('unfreeze', task)}>解冻</button>
          ) : null}
          {/* 低频操作收进 ⋯ 菜单：四个钮常驻会把窄桶正文挤成一字竖条 */}
          <RowMenu
            items={[
              bucket === 'open' && { label: '冻结', onPick: () => onAct('freeze', task) },
              { label: '编辑', onPick: () => onAct('edit', task, bucket) },
              { label: '删除', danger: true, onPick: () => onAct('remove', task, bucket) },
            ]}
          />
        </span>
      </div>
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
  const [loadErr, setLoadErr] = useState(''); // 首载/刷新失败要停在页面上，不能只有一闪而过的 toast
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ topic: '', text: '' });
  const [modal, setModal] = useState(null);
  // 工作空间弹窗（清单的设置，不再是独立 tab）
  const [showGroup, setShowGroup] = useState(false);
  // 已完成常常上百条，默认只展示前 N 条，避免整页全是历史噪音
  const [expanded, setExpanded] = useState({});
  // 正在编辑的那一条：{ task, pick }。pick 是消歧下标，必须原样回传后端。
  const [editing, setEditing] = useState(null);
  // 本机设置：读任务时是否自动把附件下载到本地（给 agent 读本地文件用）。
  // 存整份设置（而不只是那个布尔）—— 开关的 tooltip 要显示附件会落到哪个目录。
  const [setting, setSetting] = useState(null);

  const group = boot?.groupId ?? 0;
  const groupName = (boot?.groups || []).find((g) => g.id === group)?.name || (group ? `#${group}` : '默认组');

  const load = useCallback(async () => {
    if (!boot?.loggedIn) return;
    try {
      setData(await api('/api/todo'));
      setLoadErr('');
    } catch (e) {
      setLoadErr(String(e.message || e));
    }
  }, [boot?.loggedIn]);

  useEffect(() => {
    load();
    // groupId 变化后必须重取 —— 否则界面还显示上一个工作空间的数据
  }, [load, group]);

  // 设置是**本机**行为（存 ~/.nx-kv/config.json），与登录态无关，所以单独取一次。
  // 失败静默：拿不到设置不该让清单页打不开。
  useEffect(() => {
    api('/api/setting')
      .then(setSetting)
      .catch(() => {});
  }, []);

  const autoSync = !!setting?.autoSyncAttachments;

  const toggleAutoSync = () => guard(async () => {
    const next = !autoSync;
    const s = await api('/api/setting', { method: 'POST', body: { autoSyncAttachments: next } });
    setSetting(s);
    toast(next ? '已开启：读任务时自动下载附件到本地' : '已关闭自动下载附件');
  });

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
      <div className="cloud-page">
        <div className="card" style={{ padding: 16 }}>
          <div className="colhead"><h3>请先登录</h3></div>
          <div className="muted">在「登录」页填写邮箱与密码，或执行 <code>nx-kv auth login &lt;email&gt;</code>。</div>
        </div>
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
      // 编辑现在要能上传图片、插入嵌入，单行 dialog 装不下 —— 交给编辑器弹窗。
      // 刻意 early-return：保存由弹窗内部完成，成功后才 reload。
      setEditing({ task: target.task, pick: target.pick });
      return;
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

  // 快速新增栏也能 Ctrl+V 贴图：贴一张截图再回车，任务与附件一次成型。
  // 没有文件时**不能** preventDefault —— 那是普通文本粘贴，交给浏览器默认行为。
  const pasteIntoQuickAdd = async (e) => {
    const files = clipboardFiles(e);
    if (!files.length) return;
    e.preventDefault();
    try {
      const rs = await uploadMany(files, { group });
      const md = snippetsOf(rs);
      setForm((f) => ({ ...f, text: [f.text, md].filter(Boolean).join(' ') }));
      toast(rs.length === 1 ? `已上传 ${rs[0].name} 并附到内容里` : `已上传 ${rs.length} 个附件并附到内容里`);
    } catch (err) {
      toast(String((err && err.message) || err));
    }
  };

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

  return (
    <div className="cloud-page">
      {/* 筛选行：工作空间 / 主题在左，本机设置与刷新在右 —— 不与投递混排 */}
      <div className="cloud-toolbar">
        {/* 工作空间是**清单的设置**，不是独立功能域：点这颗药丸弹出子弹窗，
            里面切换 / 看成员 / 改名 / 解散 / 新建都在那儿。 */}
        <button
          className="pill on rp-ws-trigger"
          title="切换工作空间 / 管理（清单按工作空间隔离）"
          onClick={() => setShowGroup(true)}
        >
          {groupName} <span className="rp-caret">▾</span>
        </button>
        <span className="sep"></span>
        <label>主题</label>
        <select value={ui.topic} onChange={(e) => patchUi({ topic: e.target.value })}>
          <option value="">全部</option>
          {topics.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="grow"></span>
        <label
          className={'toggle' + (autoSync ? ' on' : '')}
          title={
            '开启后，读取任务时会把正文引用的附件下载到本地，并把本地绝对路径一并返回给 agent。\n' +
            `当前目录：${setting ? setting.resolvedDir : '（读取中…）'}`
          }
        >
          <input type="checkbox" checked={autoSync} onChange={toggleAutoSync} />
          <span className="dot" />
          附件自动下载
        </label>
        <button className="btn small ghost" onClick={reload} disabled={busy}>{busy ? '刷新中…' : '刷新'}</button>
      </div>

      {/* 投递条：一个整体的输入组（主题 | 内容 | 提交），两侧 Enter 都能提交 */}
      <div className="cloud-compose">
        <input
          className="cloud-compose-topic"
          placeholder="主题"
          aria-label="新任务主题"
          value={form.topic}
          onChange={(e) => setForm({ ...form, topic: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <input
          className="cloud-compose-text"
          placeholder="要做什么…（可 Ctrl+V 粘贴图片）"
          aria-label="新任务内容"
          value={form.text}
          title="可以直接 Ctrl+V 粘贴截图：会自动上传为附件并附在内容里"
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          onPaste={pasteIntoQuickAdd}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <button className="btn" onClick={add}>加入待办</button>
      </div>

      {/* 读取失败停在页面上（带重试）；首载中不给空态引导（那会误导） */}
      {loadErr ? (
        <div className="cloud-error">
          <span>清单读取失败：{loadErr}</span>
          <button className="btn small ghost" onClick={reload}>重试</button>
        </div>
      ) : null}
      {!data && !loadErr ? <div className="cloud-loading muted">读取中…</div> : null}

      {data ? (
      <div className="cols">
        {BUCKETS.map(([key, label]) => (
          <div className={'col col-' + key} key={key}>
            <div className="colhead">
              <h3>{label}</h3>
              <span className="cnt">{(filtered?.[key] || []).length}</span>
              {key === 'done' && (filtered?.done || []).length ? (
                <>
                  <span className="grow"></span>
                  <button className="btn small ghost" onClick={archive}
                    title="把较旧的完成记录移到冷 key">归档旧记录</button>
                </>
              ) : null}
            </div>
            <div className="card list">
              {(filtered?.[key] || []).length
                ? visible(key, filtered[key]).map((t) => (
                    <TaskRow key={taskKey(key, t)} bucket={key} task={t}
                      dupCount={dupCounts.get(t.text) || 1} onAct={onAct} />
                  ))
                : (
                  <div className="cloud-empty">
                    {key === 'open'
                      ? <>还没有待办<br />在上方投递条输入，<kbd>Enter</kbd> 直达</>
                      : key === 'done' ? '还没有完成记录' : '没有冻结的任务'}
                  </div>
                )}
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
      ) : null}

      <CliHints module="todo" />
      {/* 工作空间弹窗：清单的设置入口（切换 / 成员 / 改名 / 解散 / 新建） */}
      {showGroup ? <GroupPopup onClose={() => setShowGroup(false)} /> : null}
      {editing ? (
        <Modal title="编辑任务" onClose={() => setEditing(null)}>
          <TaskEditor
            task={editing.task}
            pick={editing.pick}
            group={group}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await reload();
              await refreshBoot();
            }}
          />
        </Modal>
      ) : null}
      {modal ? <Modal title={modal.title} onClose={() => setModal(null)}>{modal.node}</Modal> : null}
      {dialogNode}
    </div>
  );
}
