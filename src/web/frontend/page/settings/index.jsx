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
//   - 提示词 / 模板：任务模板槽位 + 回调提示词 + ack 完成总结提示词（都收在这一栏，多条可配）
//   - 任务工具：timegoal / waitgoal 的用法口径（时长在发布/编辑任务时显式给——CLI --duration 或编辑页「时间目标」栏，无全局默认）
//   - 项目级设置：介绍文档 / 项目 icon（标题旁圆形入口）/ 持续 get
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useApp } from '../../app-context.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { Icon } from '../../components/icons.jsx';
import { PromptItemsEditor } from '../../modules/prompts/prompt-editor.jsx';
import PromptsSection from './prompts-section.jsx';
import { openPanel } from '../../workspace.js';
import './style.css';

// 多条提示词的条数上限（与服务端 clampTaskSuffixList / clampAckPromptList 一致）
const MAX_PROMPT_ITEMS = 10;

// 内置「持续 get」默认模板的预设文案（与服务端 waitgoal-config 默认同文案；%s = 任务编号，
// 存取时与 {{task.id}} 互转——见 GetLoopEditor）。服务端常量带 core 依赖，前端本地声明。
const GETLOOP_DEFAULT_PRESET =
  '不要直接结束本轮：完成上面的任务（%s）之后，继续调用 nx-kv localtask get（带 --summary 当前现状）领取下一条任务，直到 get 返回 timeout 为止。';

// 分区清单 = 左侧导航 = tab
const SECTIONS = [
  { id: 'pref', label: '偏好', icon: 'flow' },
  { id: 'work', label: '工作区', icon: 'sidebar' },
  { id: 'cloud', label: '云端与存储', icon: 'cloud' },
  { id: 'prompts', label: '提示词 / 模板', icon: 'list' },
  { id: 'template', label: '任务工具', icon: 'clock' },
  { id: 'project', label: '项目级设置', icon: 'repo' },
];

/**
 * 单张项目卡：icon 在标题左侧；点开后编辑条走文档流（头下方整宽），
 * 不被设置面板 overflow 裁切。
 */
function ProjectCard({ repo, docStateOf, openDoc, bindExternal, unbind }) {
  const app = useApp() || {};
  const toast = useToast();
  const [iconValue, setIconValue] = useState(repo.icon || '');
  const [iconOpen, setIconOpen] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);

  useEffect(() => {
    setIconValue(repo.icon || '');
  }, [repo.icon]);

  const saveIcon = async (next) => {
    const icon = String(next ?? iconValue).trim();
    if (icon === String(repo.icon || '').trim()) {
      setIconOpen(false);
      return;
    }
    setIconBusy(true);
    try {
      await api('/api/repos/' + encodeURIComponent(repo.id), { method: 'PATCH', body: { icon } });
      setIconValue(icon);
      toast(icon ? `已保存「${repo.name}」的图标` : `已清除「${repo.name}」的图标`);
      app.refreshRepos && app.refreshRepos();
      setIconOpen(false);
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setIconBusy(false);
    }
  };

  const st = docStateOf(repo);
  const loopOn = !!(repo.getLoop && repo.getLoop.enabled);

  return (
    <div className="setp-proj">
      <div className="setp-proj-head">
        <div className={'setp-icon' + (iconOpen ? ' open' : '')}>
          <button
            type="button"
            className="setp-icon-btn"
            title={iconValue ? `项目图标：${iconValue}（点击修改）` : '设置项目图标（emoji / 单字符）'}
            aria-label="项目图标"
            aria-expanded={iconOpen}
            onClick={() => setIconOpen((o) => !o)}
          >
            {iconValue
              ? <span className="setp-icon-glyph" aria-hidden>{iconValue}</span>
              : <Icon name="folder" size={14} />}
          </button>
        </div>
        <div className="setp-proj-meta">
          <div className="setp-proj-t">
            <b>{repo.name}</b>
            <span className={'setp-badge ' + st.kind}>
              {st.kind === 'external' ? '外部' : st.kind === 'own' ? '自有' : '约定'}
            </span>
            {loopOn && <span className="setp-badge loop">持续 get</span>}
          </div>
          <div className="setp-proj-p mono" title={st.label}>{st.label}</div>
        </div>
      </div>
      {iconOpen && (
        <div className="setp-icon-edit" role="group" aria-label="编辑项目图标">
          <input
            autoFocus
            value={iconValue}
            maxLength={8}
            placeholder="emoji 或单字符"
            onChange={(e) => setIconValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveIcon(iconValue); }
              if (e.key === 'Escape') {
                e.preventDefault();
                setIconValue(repo.icon || '');
                setIconOpen(false);
              }
            }}
            disabled={iconBusy}
          />
          <button type="button" className="btn sm" disabled={iconBusy} onClick={() => saveIcon(iconValue)}>保存</button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={iconBusy || !iconValue}
            title="清空，侧栏回退默认文件夹图标"
            onClick={() => saveIcon('')}
          >
            清除
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={iconBusy}
            onClick={() => { setIconValue(repo.icon || ''); setIconOpen(false); }}
          >
            取消
          </button>
        </div>
      )}
      <div className="setp-proj-a">
        <button className="btn ghost sm" onClick={() => openDoc(repo)}>打开介绍</button>
        <button className="btn ghost sm" onClick={() => bindExternal(repo)}>绑定外部…</button>
        {repo.doc ? <button className="btn ghost sm" onClick={() => unbind(repo)}>解除绑定</button> : null}
      </div>
      <GetLoopEditor repo={repo} />
    </div>
  );
}

/**
 * 项目级「持续 get」（waitgoal）编辑器：落在 repo 记录的 getLoop 字段。
 * 开启后该项目 `localtask get` 无任务时自动唤起阻塞窗口等人回填，
 * 领到的交付文本追加「继续 get 直到超时」的项目模板（提示词增强，基于项目）。
 *
 * #41 交互收敛：一句话即配置——「选模板」（内置默认 + 全局回调提示词条目）+
 * 带 %s 槽位的一句话（%s = 任务编号，存取时与 {{task.id}} 互转）；多条目收起成
 * 标题行，点击展开编辑；说明文字删除。
 */
const GETLOOP_LINE_MAX = 2000;

function GetLoopEditor({ repo }) {
  const app = useApp() || {};
  const toast = useToast();
  const loop = repo.getLoop && typeof repo.getLoop === 'object' ? repo.getLoop : null;
  const [on, setOn] = useState(!!(loop && loop.enabled));
  const [minutes, setMinutes] = useState(String((loop && loop.waitMinutes) || 10));
  // 旧 string 单条归一成一行（按条编辑）；空数组 = 未配置（交付用默认模板）。
  // 展示层 %s ↔ 存储层 {{task.id}} 互转——项目级只写一句话，槽位写 %s。
  const [tpls, setTpls] = useState(() => {
    const raw = loop && loop.template;
    const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    return arr
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .map((s) => s.replaceAll('{{task.id}}', '%s'));
  });
  const [openIdx, setOpenIdx] = useState(-1);
  const [line, setLine] = useState(''); // 一句话输入（可含 %s）
  const [presets, setPresets] = useState([]); // 全局回调提示词条目（选模板用）
  const [busy, setBusy] = useState(false);

  // 选模板的数据源：全局回调提示词（提示词/模板栏里配的那份）
  useEffect(() => {
    api('/api/localtasks')
      .then((d) => setPresets(d?.settings?.taskSuffixList ?? []))
      .catch(() => setPresets([]));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      // %s → {{task.id}}（槽位落库为占位符）；空行丢弃
      const stored = tpls
        .map((s) => String(s ?? '').trim().replaceAll('%s', '{{task.id}}'))
        .filter(Boolean)
        .slice(0, MAX_PROMPT_ITEMS);
      await api('/api/repos/' + encodeURIComponent(repo.id), {
        method: 'PATCH',
        body: {
          getLoop: {
            enabled: on,
            ...(on ? { waitMinutes: Number(minutes) || 10, template: stored } : {}),
          },
        },
      });
      toast(
        on
          ? `已保存「${repo.name}」的持续 get 设置（模板 ${stored.length} 条）`
          : `已关闭「${repo.name}」的持续 get`
      );
      app.refreshRepos && app.refreshRepos();
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const addLine = () => {
    const v = line.trim();
    if (!v || tpls.length >= MAX_PROMPT_ITEMS) return;
    setTpls([...tpls, v.slice(0, GETLOOP_LINE_MAX)]);
    setOpenIdx(tpls.length); // 新行直接展开
    setLine('');
  };

  const fillFromPreset = (text) => setLine(text);

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
          <div className="setp-oneline">
            <select
              className="setp-oneline-pick"
              value=""
              title="选提示词模板填入下方输入框"
              onChange={(e) => {
                if (e.target.value) fillFromPreset(e.target.value);
                e.target.value = '';
              }}
            >
              <option value="">选模板…</option>
              <option value={GETLOOP_DEFAULT_PRESET}>内置默认（继续 get 直到 timeout）</option>
              {presets.map((p, i) => (
                <option key={i} value={p}>
                  {(p.split('\n')[0] || '').slice(0, 40) || `回调提示词 ${i + 1}`}
                </option>
              ))}
            </select>
            <input
              className="setp-oneline-input"
              value={line}
              placeholder="一句话（%s = 任务编号），选模板后可改"
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addLine();
              }}
            />
            <button type="button" className="btn ghost sm" disabled={busy || !line.trim()} onClick={addLine}>
              添加
            </button>
          </div>
          {tpls.length ? (
            <PromptItemsEditor
              items={tpls}
              onChange={setTpls}
              disabled={busy}
              placeholder={'一句话（%s = 任务编号）'}
              accordion
              openIndex={openIdx}
              onOpenChange={setOpenIdx}
            />
          ) : (
            <div className="setp-note">未配置模板 —— 用默认「继续调用 localtask get 直到 timeout」。</div>
          )}
          <div className="setp-proj-a">
            <button
              className="btn ghost sm"
              disabled={busy || tpls.length >= MAX_PROMPT_ITEMS}
              title={tpls.length >= MAX_PROMPT_ITEMS ? `最多 ${MAX_PROMPT_ITEMS} 条` : '新增一条「继续 get」指令'}
              onClick={() => {
                setTpls([...tpls, '']);
                setOpenIdx(tpls.length);
              }}
            >
              添加一条…
            </button>
            <button className="btn sm" disabled={busy} onClick={save}>保存持续 get 设置</button>
          </div>
        </>
      )}
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
            onClick={async () => {
              const ok = await dialog({
                title: '重置为初始两栏',
                message: '丢掉存下来的布局，回到初始的两栏（目录 + 开始）？',
                okText: '重置',
              });
              if (!ok) return;
              app.shell && app.shell.resetLayout();
            }}
          >
            重置为初始两栏
          </button>
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
      </>
    ),

    prompts: (
      <PromptsSection openTemplates={openTemplates} />
    ),

    project: (
      <>
        <div className="setp-projs">
          {repos.map((r) => (
            <ProjectCard
              key={r.key}
              repo={r}
              docStateOf={docStateOf}
              openDoc={openDoc}
              bindExternal={bindExternal}
              unbind={unbind}
            />
          ))}
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
            onMouseEnter={() => setTab(s.id)}
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
