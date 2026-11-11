// 设置面板（浮动）：左侧 tab 导航 + 右侧内容区。
//
// 为什么是浮动面板：设置是「临时开一块、看完就关」的东西，长期占工作区不合适；
// 齿轮按钮（侧边栏头部 / 窄轨）打开它，重复点只聚焦已开的那块。
//
// 分区（tab）竖排在面板左侧——设置项一多，堆成一根长列就得上下滚；
// 竖排导航把「有哪几类设置」摊开在一眼可见的位置，点哪看哪（只响应点击，
// 不随鼠标悬浮切换——避免路过就把正在编辑的页切走）。
//
// 收敛了什么（todo「设置面板统一收敛到侧边栏」的落点）：
//   - 偏好：侧边栏/看板默认收起、隐藏仓库恢复——原在齿轮气泡里
//   - 工作区：重置布局
//   - 云端与存储：附件自动下载 / 附件目录 / 仓库存储根——原散在云端页与仓库页弹窗
//   - 模板分两块（不混在一起）：任务模板（任务正文骨架，纯字符串槽位）与
//     提示词模板（每区块各自的模板列表 / 启用项；编辑区下方给只读参数速查，语法教程只在 skill / docs）
//   - 任务工具：timegoal / waitgoal 的用法口径（时长在发布/编辑任务时显式给——CLI --duration 或编辑页「时间目标」栏，无全局默认）
//   （#145：「项目级设置」整 tab 删除——介绍/图标/持续 get 都与仓库管理页重复，
//    现统一在 repos 页：行内「更多 → 持续 get」modal、编辑表单图标、查看详情文档集。）
//   （#150：「任务工具」tab 删除——正文早已不在 bodies 里，点开只剩空白标题页。）
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../api/client.js';
import { useApp } from '../../app-context.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { Icon } from '../../components/icons.jsx';
import { Button } from '../../components/button/index.jsx';
import PromptTemplatesSection from './prompt-templates-section.jsx';
import TaskTemplatesSection from './task-templates-section.jsx';
import type { TemplateEditorOpts } from './task-templates-section.jsx';
import SidebarSection from './sidebar-section.jsx';
import { openTemplateEditor } from '../../panels.jsx';
import './style.css';

/** 一个设置分区 = 左侧导航的一项 = tab。 */
interface SettingsSection {
  id: string;
  label: string;
  icon: string;
}

// 分区清单 = 左侧导航 = tab
const SECTIONS: SettingsSection[] = [
  { id: 'pref', label: '偏好', icon: 'flow' },
  { id: 'work', label: '工作区', icon: 'sidebar' },
  { id: 'cloud', label: '云端与存储', icon: 'cloud' },
  { id: 'taskTemplates', label: '任务模板', icon: 'list' },
  { id: 'prompts', label: '提示词模板', icon: 'flow' },
  { id: 'sidebar', label: '侧栏显示', icon: 'sidebar' },
];

export default function SettingsPanel() {
  const app = useApp();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const prefs = app.prefs;
  const patchPrefs = app.patchPrefs || (() => {});
  const model = app.model;

  const [tab, setTab] = useState('pref');
  // /api/setting 的响应（外部数据边界）：字段按后端 schema 读
  const [cfg, setCfg] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCfg(await api('/api/setting'));
    } catch (e) {
      toast('读取设置失败：' + ((e as Error).message || e));
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const guard = (fn: () => Promise<unknown>) => fn().catch((e: Error) => toast(String(e.message || e)));

  const saveSetting = (patch: Record<string, unknown>) =>
    guard(async () => {
      setBusy(true);
      try {
        setCfg(await api('/api/setting', { method: 'POST', body: patch }));
        toast('已保存');
      } finally {
        setBusy(false);
      }
    });

  // （#145：「项目级设置」tab 删除——介绍/图标/持续 get 统一收进仓库管理页，
  //   这里不再保留 docStateOf / openDoc / bindExternal / unbind。）

  const openTplEditor = (opts: TemplateEditorOpts) => {
    if (!model) return;
    openTemplateEditor(model, opts || {});
  };

  // ─── 各分区内容 ──────────────────────────────────────────────────────
  const bodies: Record<string, ReactNode> = {
    pref: (
      <>
        <div className="setp-row">
          <span>侧边栏默认收起</span>
          <button
            className={'toggle' + (prefs?.defaultFolded ? ' on' : '')}
            onClick={() => patchPrefs({ defaultFolded: !prefs?.defaultFolded })}
          >
            <span className="dot" />
            {prefs?.defaultFolded ? '开' : '关'}
          </button>
        </div>
        {(prefs?.hidden || []).length > 0 && (
          <div className="setp-row">
            <span>隐藏仓库 {prefs?.hidden?.length} 个</span>
            <Button variant="secondary" onClick={() => patchPrefs({ hidden: [] })}>恢复显示</Button>
          </div>
        )}
      </>
    ),

    work: (
      <>
        <div className="setp-row">
          <span>布局</span>
          <Button
            variant="secondary"
            onClick={async () => {
              const ok = await dialog({
                title: '重置为初始两栏',
                message: '丢掉存下来的布局，回到初始的两栏（目录 + 开始）？',
                okText: '重置',
              });
              if (!ok) return;
              if (app.shell) app.shell.resetLayout();
            }}
          >
            重置为初始两栏
          </Button>
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
            onClick={() => cfg && saveSetting({ autoSyncAttachments: !cfg.autoSyncAttachments })}
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
              onChange={(e) => setCfg((c) => ({ ...(c || {}), attachmentsDir: e.target.value }))}
            />
            <Button variant="secondary" disabled={!cfg || busy} onClick={() => cfg && saveSetting({ attachmentsDir: cfg.attachmentsDir })}>
              保存
            </Button>
          </span>
        </div>
        <div className="setp-row">
          <span>参考仓库存储根</span>
          <span className="setp-input">
            <input
              value={cfg ? cfg.gitRepoRoot || '' : ''}
              placeholder="（未设置 —— clone 参考仓库前先设）"
              onChange={(e) => setCfg((c) => ({ ...(c || {}), gitRepoRoot: e.target.value }))}
            />
            <Button variant="secondary" disabled={!cfg || busy} onClick={() => cfg && saveSetting({ gitRepoRoot: cfg.gitRepoRoot })}>
              保存
            </Button>
          </span>
        </div>
        <div className="setp-row">
          <span>开发仓库克隆根</span>
          <span className="setp-input">
            <input
              value={cfg ? cfg.gitDevRoot || '' : ''}
              placeholder="（未设置 —— 导入布局时只登记不克隆）"
              onChange={(e) => setCfg((c) => ({ ...(c || {}), gitDevRoot: e.target.value }))}
            />
            <Button variant="secondary" disabled={!cfg || busy} onClick={() => cfg && saveSetting({ gitDevRoot: cfg.gitDevRoot })}>
              保存
            </Button>
          </span>
        </div>
      </>
    ),

    taskTemplates: (
      <TaskTemplatesSection openTemplateEditor={openTplEditor} />
    ),

    prompts: (
      <PromptTemplatesSection />
    ),

    // 侧栏显示编排（任务 #61 反馈③）：菜单式的「显示哪些项目组 / 项目」
    sidebar: (
      <SidebarSection />
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
        <div className="setp-h">{SECTIONS.find((s) => s.id === tab)?.label}</div>
        {bodies[tab]}
      </div>
      {dialogNode}
    </div>
  );
}
