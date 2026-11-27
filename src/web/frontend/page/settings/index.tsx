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
//   - 本机存储：附件根 / 仓库存储根——原散在云端页与仓库页弹窗
//   - 模板分两块（不混在一起）：任务模板（任务正文骨架，纯文字）与
//     提示词模板（每区块各自的模板列表 / 启用项；编辑区下方给只读参数速查，语法教程只在 skill / docs）
//   - 任务工具：timegoal / waitgoal 的用法口径（时长在发布/编辑任务时显式给——CLI --duration 或编辑页「时间目标」栏，无全局默认）
//   （#145：「项目级设置」整 tab 删除——介绍/图标/持续 get 都与仓库管理页重复，
//    现统一在 repos 页：行内「更多 → 持续 get」modal、编辑表单图标、查看详情文档集。）
//   （#150：「任务工具」tab 删除——正文早已不在 bodies 里，点开只剩空白标题页。）
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getSettings, saveSettings, getOrphans, purgeOrphans } from './api.js';
import { useApp } from '../../app-context.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { Icon } from '../../components/icons.jsx';
import { Button } from '../../components/button/index.jsx';
import PromptTemplatesSection from './prompt-templates-section.jsx';
import PluginsSection from './plugins-section.jsx';
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
  { id: 'storage', label: '本机存储', icon: 'archive' },
  { id: 'docsCleanup', label: '文档清理', icon: 'archive' },
  { id: 'prompts', label: '提示词模板', icon: 'flow' },
  { id: 'plugins', label: '插件', icon: 'flow' },
];

/** 孤儿清单的一行（/api/docs/orphans 的响应形状）。 */
interface OrphanRowView {
  refId: string;
  desc: string;
  origin: string;
  locator: string;
  unboundAt: number | null;
  remainingDays: number;
  due: boolean;
  hasBody: boolean;
  bodyBytes: number;
}

/** 清理留痕的一行。 */
interface OrphanLogView {
  refId: string;
  desc: string;
  deletedAt: number;
  ttlDays: number;
  reason: string;
}

interface OrphanData {
  ttlDays: number;
  total: number;
  due: number;
  dueEmpty: number;
  dueWithBody: number;
  dueSoon: number;
  untimed: number;
  orphans: OrphanRowView[];
  recentDeletions: OrphanLogView[];
  eligible?: string[];
  deleted?: OrphanLogView[];
}

/** 毫秒 → 本地「YYYY-MM-DD HH:mm」；空值给破折号。 */
function fmtAt(ms?: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SettingsPanel() {
  const app = useApp();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const prefs = app.prefs;
  const patchPrefs = app.patchPrefs || (() => {});

  const [tab, setTab] = useState('pref');
  // /api/setting 的响应（外部数据边界）：字段按后端 schema 读
  const [cfg, setCfg] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  // 孤儿文档清单（/api/docs/orphans）：失绑时间 / 剩余天数 / 是否有正文
  const [orphans, setOrphans] = useState<OrphanData | null>(null);
  const [orphanBusy, setOrphanBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCfg(await getSettings());
    } catch (e) {
      toast('读取设置失败：' + ((e as Error).message || e));
    }
  }, [toast]);

  const loadOrphans = useCallback(async () => {
    try {
      setOrphans((await getOrphans()) as OrphanData);
    } catch (e) {
      toast('读取孤儿文档失败：' + ((e as Error).message || e));
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === 'docsCleanup') void loadOrphans();
  }, [tab, loadOrphans]);

  const guard = (fn: () => Promise<unknown>) => fn().catch((e: Error) => toast(String(e.message || e)));

  // 预演 / 立即清理：立即清理前必须确认；有正文的到期孤儿后端不会删
  const runOrphanGc = (apply: boolean) =>
    guard(async () => {
      if (apply) {
        const ok = await dialog({
          title: '立即清理孤儿文档',
          message: '软删所有「到期 + 没有正文」的孤儿文档；有正文的只列清单，不会自动删。继续？',
          okText: '清理',
        });
        if (!ok) return;
      }
      setOrphanBusy(true);
      try {
        const r = (await purgeOrphans({ apply })) as OrphanData;
        setOrphans(r);
        toast(
          apply
            ? `已清理 ${r.deleted?.length ?? 0} 篇孤儿文档`
            : `预演：将清理 ${r.eligible?.length ?? 0} 篇孤儿文档（未删除）`
        );
      } finally {
        setOrphanBusy(false);
      }
    });

  const saveSetting = (patch: Record<string, unknown>) =>
    guard(async () => {
      setBusy(true);
      try {
        setCfg(await saveSettings(patch));
        toast('已保存');
      } finally {
        setBusy(false);
      }
    });

  // （#145：「项目级设置」tab 删除——介绍/图标/持续 get 统一收进仓库管理页，
  //   这里不再保留 docStateOf / openDoc / bindExternal / unbind。）

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
        {/* #254：任务页面包屑复制钮的内容偏好——原始路径 or 带访问逻辑的 CLI 提示词 */}
        <div className="setp-row">
          <span title="任务页面包屑悬浮出的复制钮复制什么：原始路径 =「目录 #任务号」；访问提示词 = 可直接执行的 CLI 指令加引导">
            路径复制偏好
          </span>
          <span className="setp-seg" role="group" aria-label="路径复制偏好">
            <button
              className={'seg' + (prefs?.copyPathStyle !== 'prompt' ? ' on' : '')}
              onClick={() => patchPrefs({ copyPathStyle: 'raw' })}
            >
              原始路径
            </button>
            <button
              className={'seg' + (prefs?.copyPathStyle === 'prompt' ? ' on' : '')}
              onClick={() => patchPrefs({ copyPathStyle: 'prompt' })}
            >
              访问提示词
            </button>
          </span>
        </div>
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

    storage: (
      <>
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

    docsCleanup: (
      <>
        <div className="setp-row">
          <span>孤儿保留天数</span>
          <span className="setp-input">
            <input
              type="number"
              min={1}
              max={3650}
              value={cfg ? cfg.orphanTtlDays ?? 3 : 3}
              onChange={(e) =>
                setCfg((c) => ({ ...(c || {}), orphanTtlDays: Number(e.target.value) }))
              }
            />
            <Button
              variant="secondary"
              disabled={!cfg || busy}
              onClick={() => cfg && saveSetting({ orphanTtlDays: cfg.orphanTtlDays })}
            >
              保存
            </Button>
          </span>
        </div>
        <div className="setp-note">
          孤儿 = 没有任何 ref_bindings 归属的 ref。到期后软删（ref_bodies 保留）；有正文的到期孤儿不自动删，需人工处置。
        </div>
        <div className="setp-row">
          <span>
            {orphans
              ? `孤儿 ${orphans.total} 篇 · 到期 ${orphans.due}（空壳 ${orphans.dueEmpty} / 有正文 ${orphans.dueWithBody}）` +
                (orphans.dueSoon ? ` · 24h 内到期 ${orphans.dueSoon}` : '') +
                (orphans.untimed ? ` · 未计时 ${orphans.untimed}` : '')
              : '孤儿清单：读取中…'}
          </span>
          <span className="setp-gc-actions">
            <Button variant="secondary" onClick={() => void loadOrphans()}>刷新</Button>
            <Button variant="secondary" disabled={orphanBusy} onClick={() => void runOrphanGc(false)}>预演清理</Button>
            <Button variant="secondary" disabled={orphanBusy} onClick={() => void runOrphanGc(true)}>立即清理</Button>
          </span>
        </div>
        <div className="setp-gc-list">
          {(orphans?.orphans || []).map((o) => (
            <div key={o.refId} className={'setp-gc-item' + (o.due ? ' is-due' : '')}>
              <div className="setp-gc-main">
                <b>{o.desc || o.refId}</b>
                <span className={'setp-badge' + (o.hasBody ? ' soft' : '')}>
                  {o.hasBody ? `有正文 ${o.bodyBytes}B` : '空壳'}
                </span>
                {o.due && <span className="setp-badge is-due">已到期</span>}
              </div>
              <div className="setp-gc-meta">
                <code>{o.refId}</code>
                <span>失绑 {fmtAt(o.unboundAt)}</span>
                <span>{o.unboundAt ? `剩余 ${o.remainingDays} 天` : '未计时（维护时起算）'}</span>
                {o.origin === 'external' && o.locator && <span className="setp-gc-path">{o.locator}</span>}
              </div>
            </div>
          ))}
          {orphans && orphans.orphans.length === 0 && <div className="setp-note">（当前没有孤儿文档）</div>}
          {!orphans && <div className="setp-note">（点「刷新」读取）</div>}
        </div>
        {(orphans?.recentDeletions || []).length > 0 && (
          <>
            <div className="setp-h">最近清理</div>
            <div className="setp-gc-list">
              {(orphans?.recentDeletions || []).map((r) => (
                <div key={r.refId + '@' + r.deletedAt} className="setp-gc-log">
                  {fmtAt(r.deletedAt)} · <code>{r.refId}</code> · {r.reason} · TTL {r.ttlDays} 天
                  {r.desc ? ` · ${r.desc}` : ''}
                </div>
              ))}
            </div>
          </>
        )}
      </>
    ),

    prompts: (
      <PromptTemplatesSection />
    ),

    plugins: (
      <PluginsSection />
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
