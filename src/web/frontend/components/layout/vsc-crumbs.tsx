// VS Code 式面包屑（任务页顶条，#254/#259/#261）：段间「>」分隔、点段弹同级下拉
// （定宽 150、超高容器内滚、贴视口夹取）；悬浮整行亮出**复制**钮（路径复制偏好两态）；
// 下拉里的**任务条目** hover 亮出双操作——复制该任务路径 + 预览（旁路打开该任务原文，
// onPreviewTask 由宿主任务页给）。#261 明确：双按钮在下拉条目上，不在当前任务段上。
// 旧 RouteBreadcrumb（[ 目录 / #N ] 方括号式）继续服务其余页面；任务页只换这条。
import { useMemo, useState } from 'react';
import { useApp } from '../../app-context.jsx';
import { PopMenu } from '../popup/index.jsx';
import type { PopMenuItem } from '../popup/index.jsx';
import { Icon } from '../icons.jsx';
import { useToast } from '../toast/index.jsx';
import { copyPayloadOf, nsFirstTargetOf, taskCopyPayload, vscTrailOf } from './vsc-crumbs-model.js';
import type { VscSegment, VscSibling, VscTrail } from './vsc-crumbs-model.js';
import './vsc-crumbs.css';

interface MenuState {
  x: number;
  y: number;
  width?: number;
  items: Array<PopMenuItem | string>;
}

export default function VscCrumbs({ onPreviewTask }: { onPreviewTask?: ((taskId: string) => void) | null } = {}) {
  const app = useApp();
  const toast = useToast();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const trail: VscTrail | null = useMemo(
    () => vscTrailOf(app.route, app.rows || [], app.repoData || {}, app.prefs || {}),
    [app.route, app.rows, app.repoData, app.prefs]
  );
  if (!trail) return null;

  const style = app.prefs && app.prefs.copyPathStyle === 'prompt' ? 'prompt' : 'raw';

  const copyText = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(what);
    } catch {
      toast('复制失败：剪贴板不可用');
    }
  };

  const openSiblings = (seg: VscSegment, e: { clientX: number; clientY: number }) => {
    if (!seg.siblings.length) return;
    setMenu({
      x: e.clientX,
      y: e.clientY + 6,
      width: 150, // #259 验收：下拉定宽 150px
      items: seg.siblings.map((s: VscSibling) => ({
        label: s.label,
        icon: s.nsId ? 'flow' : undefined,
        onClick: () => {
          if (s.nsId) {
            // 命名空间项：先切侧栏分区，再落它的首个成员页（看板 → 组页；否则 → 目录页）
            app.patchPrefs?.({ focusNs: s.nsId });
            const ns = ((app.prefs || {}).namespaces || []).find((n) => n.id === s.nsId);
            const hash = nsFirstTargetOf(ns, app.rows || [], (app.repoData || {}).boards || []);
            if (hash && app.onNavigate) app.onNavigate(hash);
            else toast(`已切到「${s.label}」（还没有可打开的目录）`);
            return;
          }
          if (s.hash && app.onNavigate) app.onNavigate(s.hash);
        },
        // #261 验收：下拉任务条目 hover 出双操作——复制该任务路径 + 预览该任务原文
        hoverActions:
          s.taskId && seg.kind === 'task' ? (
            <>
              <span
                role="button"
                title={style === 'prompt' ? '复制该任务的访问提示词' : '复制该任务的路径 + 任务号'}
                onClick={() =>
                  copyText(
                    taskCopyPayload(trail.cwd, trail.dirName, s.taskId || '', style),
                    style === 'prompt' ? '已复制访问提示词' : '已复制路径'
                  )
                }
              >
                <Icon name="copy" size={12} />
              </span>
              {onPreviewTask && (
                <span role="button" title="预览原文（旁路打开）" onClick={() => onPreviewTask(s.taskId || '')}>
                  <Icon name="eye" size={12} />
                </span>
              )}
            </>
          ) : undefined,
      })),
    });
  };

  const copyTitle =
    style === 'prompt'
      ? '复制访问提示词（CLI 指令 + 引导）——设置 → 偏好可切换为原始路径'
      : '复制路径 + 任务号——设置 → 偏好可切换为访问提示词';

  return (
    <div className="vsc-crumbs">
      <nav className="vsc-crumbs-path" aria-label="当前位置">
        {trail.segments.map((seg, i) => (
          <span key={seg.kind} className={'vsc-crumb' + (i === trail.segments.length - 1 ? ' is-cur' : '')}>
            {i > 0 && (
              <span className="vsc-sep" aria-hidden>
                &gt;
              </span>
            )}
            <button
              type="button"
              className="vsc-crumb-t"
              disabled={!seg.siblings.length}
              title={seg.siblings.length ? `显示「${seg.label}」的同级` : seg.label}
              onClick={(e) => openSiblings(seg, e)}
            >
              {seg.label}
            </button>
          </span>
        ))}
      </nav>
      {/* #254：悬浮整行亮出复制钮（当前任务的路径 + 任务号，按偏好两态） */}
      <button type="button" className="vsc-copy" title={copyTitle} aria-label={copyTitle}
        onClick={() => copyText(copyPayloadOf(trail, style), style === 'prompt' ? '已复制访问提示词' : '已复制路径')}>
        <Icon name="copy" size={13} />
      </button>
      {menu && <PopMenu x={menu.x} y={menu.y} width={menu.width} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
