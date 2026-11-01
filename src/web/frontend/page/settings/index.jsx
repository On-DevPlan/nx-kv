// 设置面板（浮动）：左侧 tab 导航 + 右侧内容区。
//
// 为什么是浮动面板：设置是「临时开一块、看完就关」的东西，长期占工作区不合适；
// 齿轮按钮（侧边栏头部 / 窄轨）打开它，重复点只聚焦已开的那块。
//
// 分区（tab）竖排在面板左侧——设置项一多，堆成一根长列就得上下滚；
// 竖排导航把「有哪几类设置」摊开在一眼可见的位置，点哪看哪。
//
// 收敛了什么（todo「设置面板统一收敛到侧边栏」的落点）：
//   - 偏好：侧边栏/看板默认收起、隐藏仓库恢复——原在齿轮气泡里
//   - 工作区：重置布局
//   - 云端与存储：附件自动下载 / 附件目录 / 仓库存储根——原散在云端页与仓库页弹窗
//   - 模板与任务工具：模板配置走独立面板；任务工具本机暂无全局开关（时间窗口随任务携带）
//   - 项目级设置：每个项目的介绍文档（自有 md 或外部只读绑定）——原无入口
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useApp } from '../../app-context.jsx';
import { useDialog, useToast } from '../../components/ui.jsx';
import { Icon } from '../../components/icons.jsx';
import { openPanel } from '../../workspace.js';
import './style.css';

// 分区清单 = 左侧导航 = tab
const SECTIONS = [
  { id: 'pref', label: '偏好', icon: 'flow' },
  { id: 'work', label: '工作区', icon: 'sidebar' },
  { id: 'cloud', label: '云端与存储', icon: 'cloud' },
  { id: 'template', label: '模板与任务工具', icon: 'list' },
  { id: 'project', label: '项目级设置', icon: 'repo' },
];

/**
 * 项目级「持续 get」（waitgoal）编辑器：落在 repo 记录的 getLoop 字段。
 * 开启后该项目 `localtask get` 无任务时自动唤起阻塞窗口等人回填，
 * 领到的交付文本追加「继续 get 直到超时」的项目模板（提示词增强，基于项目）。
 */
function GetLoopEditor({ repo }) {
  const app = useApp() || {};
  const toast = useToast();
  const loop = repo.getLoop && typeof repo.getLoop === 'object' ? repo.getLoop : null;
  const [on, setOn] = useState(!!(loop && loop.enabled));
  const [minutes, setMinutes] = useState(String((loop && loop.waitMinutes) || 10));
  const [tpl, setTpl] = useState(String((loop && loop.template) || ''));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api('/api/repos/' + encodeURIComponent(repo.id), {
        method: 'PATCH',
        body: {
          getLoop: {
            enabled: on,
            ...(on ? { waitMinutes: Number(minutes) || 10, template: tpl } : {}),
          },
        },
      });
      toast(`已保存「${repo.name}」的持续 get 设置`);
      app.refreshRepos && app.refreshRepos();
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setp-loop">
      <label className="setp-row">
        <span>持续 get（waitgoal）</span>
        <button className={'toggle' + (on ? ' on' : '')} onClick={() => setOn(!on)}>
          <span className="dot" />
          {on ? '开' : '关'}
        </button>
      </label>
      {on && (
        <>
          <div className="setp-row">
            <span>阻塞窗口（分钟）</span>
            <input className="setp-min" value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="numeric" />
          </div>
          <textarea
            className="setp-suffix-ta mono"
            rows={3}
            value={tpl}
            placeholder="留空 = 默认模板（继续调用 localtask get 直到 timeout）"
            onChange={(e) => setTpl(e.target.value)}
            spellCheck={false}
          />
        </>
      )}
      <div className="setp-proj-a">
        <button className="btn sm" disabled={busy} onClick={save}>保存持续 get 设置</button>
      </div>
    </div>
  );
}

/**
 * 回调提示词（wait 收尾指令模板，settings.taskSuffix）的编辑器。
 *
 * 这就是「任务界面的回调提示词」：agent 每次领到任务（wait/get 返回）时，
 * 服务端把这条模板渲染成 instruction 一并交付——含 {{ 走模板渲染（task.text
 * 保持库存原文），纯文本则追加到正文末尾，置空表示关闭。
 */
function CallbackSuffixEditor() {
  const toast = useToast();
  const [suffix, setSuffix] = useState(null);   // null = 还在读
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/localtasks')
      .then((d) => setSuffix(d?.settings?.taskSuffix ?? ''))
      .catch((e) => toast('读取回调提示词失败：' + (e.message || e)));
  }, [toast]);

  const save = async (value) => {
    if (value == null || busy) return;
    setBusy(true);
    try {
      const d = await api('/api/localtasks/setting', { method: 'PATCH', body: { taskSuffix: value } });
      setSuffix(d?.taskSuffix ?? value);
      toast(d?.taskSuffix === '' ? '已关闭回调提示词' : '已保存回调提示词');
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const reload = () => {
    api('/api/localtasks')
      .then((d) => setSuffix(d?.settings?.taskSuffix ?? ''))
      .catch(() => {});
  };

  return (
    <div className="setp-suffix">
      <div className="setp-row">
        <span>回调提示词（领到任务时随任务交付的收尾指令）</span>
        {suffix !== null && !suffix.trim() && <span className="setp-badge">已关闭</span>}
      </div>
      <textarea
        className="setp-suffix-ta mono"
        rows={5}
        value={suffix ?? ''}
        placeholder="读取中…"
        onChange={(e) => setSuffix(e.target.value)}
        disabled={suffix === null}
        spellCheck={false}
      />
      <div className="setp-note">
        占位符：<span className="mono">{'{{task.text}}'}</span> 正文 ·{' '}
        <span className="mono">{'{{goal.name}} {{goal.deadline}} {{goal.remainingHuman}} {{goal.prompt}}'}</span>{' '}
        时间目标状态 · 段落 <span className="mono">{'{{#goal}}…{{/goal}}'}</span> 无目标时整段消失。
        含 <span className="mono">{'{{'}</span> 渲染为独立 instruction 字段；纯文本追加到正文末尾；
        <b>清空保存 = 关闭</b>。默认模板强调「本轮最后再 wait 一次」。
      </div>
      <div className="setp-proj-a">
        <button className="btn sm" disabled={busy || suffix === null} onClick={() => save(suffix)}>保存</button>
        <button
          className="btn ghost sm"
          disabled={busy || suffix === null}
          onClick={() => save('')}
          title="关闭：wait 返回只带任务本体"
        >
          关闭
        </button>
        <button className="btn ghost sm" disabled={busy} onClick={reload}>撤销改动</button>
      </div>
    </div>
  );
}

export default function SettingsPanel() {
  const app = useApp() || {};
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const prefs = app.prefs || {};
  const patchPrefs = app.patchPrefs || (() => {});
  const model = app.model;
  const repos = (app.repoData && app.repoData.repos) || [];

  const [tab, setTab] = useState('pref');
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCfg(await api('/api/setting'));
    } catch (e) {
      toast('读取设置失败：' + (e.message || e));
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const guard = (fn) => fn().catch((e) => toast(String(e.message || e)));

  const saveSetting = (patch) =>
    guard(async () => {
      setBusy(true);
      try {
        setCfg(await api('/api/setting', { method: 'POST', body: patch }));
        toast('已保存');
      } finally {
        setBusy(false);
      }
    });

  // ─── 项目级设置：介绍文档（自有 md 或外部只读绑定）───
  const docStateOf = (r) => {
    if (r.doc && r.doc.path) return { kind: 'external', docId: 'path:' + r.doc.path, label: r.doc.path };
    if (r.doc && r.doc.rel) return { kind: 'own', docId: 'rel:' + r.doc.rel, label: r.doc.rel };
    return { kind: 'default', docId: 'rel:' + (r.docRel || ''), label: r.docRel || '（未创建）' };
  };

  const openDoc = (r) => {
    if (!model) return;
    const st = docStateOf(r);
    if (!st.docId || st.docId === 'rel:') return toast('这个项目还没有介绍文档');
    openPanel(model, { component: 'doc', name: r.name + ' · 介绍', config: { docId: st.docId }, location: 'center' });
  };

  const bindExternal = (r) =>
    guard(async () => {
      const path = await dialog({
        title: '绑定外部介绍文档',
        input: true,
        placeholder: 'D:\\vault\\nx\\nx-kv.md（只读引用，不进导出包）',
      });
      if (!path) return;
      await api('/api/docs/bind', { method: 'POST', body: { repo: r.key, path: path.trim() } });
      toast(`已绑定：${path.trim()}`);
      app.refreshRepos && app.refreshRepos();
    });

  const unbind = (r) =>
    guard(async () => {
      await api('/api/docs/bind', { method: 'POST', body: { repo: r.key, reset: true } });
      toast('已解除绑定（回到约定路径）');
      app.refreshRepos && app.refreshRepos();
    });

  const openTemplates = () => {
    if (!model) return;
    openPanel(model, { component: 'templates', name: '任务模板', config: {}, location: 'center' });
  };

  // ─── 各分区内容 ──────────────────────────────────────────────────────
  const bodies = {
    pref: (
      <>
        <div className="setp-row">
          <span>侧边栏默认收起</span>
          <button
            className={'toggle' + (prefs.defaultFolded ? ' on' : '')}
            onClick={() => patchPrefs({ defaultFolded: !prefs.defaultFolded })}
          >
            <span className="dot" />
            {prefs.defaultFolded ? '开' : '关'}
          </button>
        </div>
        <div className="setp-row">
          <span>看板默认收起</span>
          <button
            className={'toggle' + (prefs.defaultGroupFolded ? ' on' : '')}
            onClick={() => patchPrefs({ defaultGroupFolded: !prefs.defaultGroupFolded })}
          >
            <span className="dot" />
            {prefs.defaultGroupFolded ? '开' : '关'}
          </button>
        </div>
        {(prefs.hidden || []).length > 0 && (
          <div className="setp-row">
            <span>隐藏仓库 {prefs.hidden.length} 个</span>
            <button className="btn ghost sm" onClick={() => patchPrefs({ hidden: [] })}>恢复显示</button>
          </div>
        )}
      </>
    ),

    work: (
      <>
        <div className="setp-row">
          <span>布局</span>
          <button
            className="btn ghost sm"
            onClick={() => {
              if (!confirm('丢掉存下来的布局，回到初始的两栏（目录 + 开始）？')) return;
              app.shell && app.shell.resetLayout();
            }}
          >
            重置为初始两栏
          </button>
        </div>
        <div className="setp-note">
          布局存在浏览器 localStorage（<span className="mono">nx-kv-ui.workspace</span>）——
          拖动面板、拆分、浮出后的样子会记住；「撤销 / 重做」在侧边栏头部。
        </div>
      </>
    ),

    cloud: (
      <>
        <div className="setp-row">
          <span>读任务时自动下载附件</span>
          <button
            className={'toggle' + (cfg && cfg.autoSyncAttachments ? ' on' : '')}
            disabled={!cfg || busy}
            onClick={() => saveSetting({ autoSyncAttachments: !cfg.autoSyncAttachments })}
          >
            <span className="dot" />
            {cfg && cfg.autoSyncAttachments ? '开' : '关'}
          </button>
        </div>
        <div className="setp-row">
          <span>附件目录</span>
          <span className="setp-input">
            <input
              value={cfg ? cfg.attachmentsDir || '' : ''}
              placeholder="（默认 ~/.nx-kv/attachments/）"
              onChange={(e) => setCfg((c) => ({ ...c, attachmentsDir: e.target.value }))}
            />
            <button className="btn ghost sm" disabled={!cfg || busy} onClick={() => saveSetting({ attachmentsDir: cfg.attachmentsDir })}>
              保存
            </button>
          </span>
        </div>
        <div className="setp-row">
          <span>参考仓库存储根</span>
          <span className="setp-input">
            <input
              value={cfg ? cfg.gitRepoRoot || '' : ''}
              placeholder="（未设置 —— clone 参考仓库前先设）"
              onChange={(e) => setCfg((c) => ({ ...c, gitRepoRoot: e.target.value }))}
            />
            <button className="btn ghost sm" disabled={!cfg || busy} onClick={() => saveSetting({ gitRepoRoot: cfg.gitRepoRoot })}>
              保存
            </button>
          </span>
        </div>
        <div className="setp-row">
          <span>开发仓库克隆根</span>
          <span className="setp-input">
            <input
              value={cfg ? cfg.gitDevRoot || '' : ''}
              placeholder="（未设置 —— 导入布局时只登记不克隆）"
              onChange={(e) => setCfg((c) => ({ ...c, gitDevRoot: e.target.value }))}
            />
            <button className="btn ghost sm" disabled={!cfg || busy} onClick={() => saveSetting({ gitDevRoot: cfg.gitDevRoot })}>
              保存
            </button>
          </span>
        </div>
        {cfg && cfg.resolvedDir && <div className="setp-note">附件实际落在：{cfg.resolvedDir}</div>}
      </>
    ),

    template: (
      <>
        <div className="setp-row">
          <span>任务模板</span>
          <button className="btn ghost sm" onClick={openTemplates}>打开模板面板…</button>
        </div>
        <div className="setp-note">
          <b>任务工具（timegoal / waitgoal）：</b>
          发布带时长 → <span className="mono">localtask add "…" --duration 2h</span>（领取即计时）；
          领取 → <span className="mono">localtask get</span>（默认直接领，没任务立即返回；项目开启「持续 get」后自动唤起阻塞窗口等人回填）；
          推进 → <span className="mono">timegoal check --task …</span>；
          完成 → <span className="mono">localtask done --id …</span>（<b>未到时间拒绝标记完成</b>，提示派 sub agent 重提需求）。
        </div>
        <CallbackSuffixEditor />
      </>
    ),

    project: (
      <>
        <div className="setp-note">
          每个项目的介绍文档：默认落在 <span className="mono">~/.nx-kv/docs/repo/&lt;key&gt;.md</span>，
          也可绑到外部文件（只读，不进导出包）。
        </div>
        <div className="setp-projs">
          {repos.map((r) => {
            const st = docStateOf(r);
            return (
              <div key={r.key} className="setp-proj">
                <div className="setp-proj-t">
                  <b>{r.name}</b>
                  <span className={'setp-badge ' + st.kind}>{st.kind === 'external' ? '外部' : st.kind === 'own' ? '自有' : '约定'}</span>
                </div>
                <div className="setp-proj-p mono">{st.label}</div>
                <div className="setp-proj-a">
                  <button className="btn ghost sm" onClick={() => openDoc(r)}>打开介绍</button>
                  <button className="btn ghost sm" onClick={() => bindExternal(r)}>绑定外部…</button>
                  {r.doc ? <button className="btn ghost sm" onClick={() => unbind(r)}>解除绑定</button> : null}
                </div>
                <GetLoopEditor repo={r} />
              </div>
            );
          })}
          {!repos.length && <div className="setp-note">还没有登记仓库。</div>}
        </div>
      </>
    ),
  };

  return (
    <div className="setp">
      <nav className="setp-nav" aria-label="设置分区">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={'setp-navitem' + (tab === s.id ? ' on' : '')}
            aria-current={tab === s.id}
            onClick={() => setTab(s.id)}
          >
            <Icon name={s.icon} size={14} />
            <span>{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="setp-body">
        <div className="setp-h">{SECTIONS.find((s) => s.id === tab).label}</div>
        {bodies[tab]}
      </div>
      {dialogNode}
    </div>
  );
}
