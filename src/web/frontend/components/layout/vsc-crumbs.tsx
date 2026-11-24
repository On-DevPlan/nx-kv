// VS Code 式面包屑（任务页顶条，#254/#259）：段间「>」分隔、点段弹同级下拉（定宽 150、
// 超高容器内滚）；悬浮任务段亮出**两个** icon btn——复制（路径复制偏好两态）与预览
// （打开旁路原文子侧边栏，onPreview 由宿主任务页给）。
// 旧 RouteBreadcrumb（[ 目录 / #N ] 方括号式）继续服务其余页面；任务页只换这条。
import { useMemo, useState } from 'react';
import { useApp } from '../../app-context.jsx';
import { PopMenu } from '../popup/index.jsx';
import type { PopMenuItem } from '../popup/index.jsx';
import { Icon } from '../icons.jsx';
import { useToast } from '../toast/index.jsx';
import { copyPayloadOf, nsFirstTargetOf, vscTrailOf } from './vsc-crumbs-model.js';
import type { VscSegment, VscSibling } from './vsc-crumbs-model.js';
import './vsc-crumbs.css';

interface MenuState {
  x: number;
  y: number;
  width?: number;
  items: Array<PopMenuItem | string>;
}

export default function VscCrumbs({ onPreview }: { onPreview?: (() => void) | null } = {}) {
  const app = useApp();
  const toast = useToast();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const trail = useMemo(
    () => vscTrailOf(app.route, app.rows || [], app.repoData || {}, app.prefs || {}),
    [app.route, app.rows, app.repoData, app.prefs]
  );
  if (!trail) return null;

  const style = app.prefs && app.prefs.copyPathStyle === 'prompt' ? 'prompt' : 'raw';

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
      })),
    });
  };

  const copy = async () => {
    const text = copyPayloadOf(trail, style);
    try {
      await navigator.clipboard.writeText(text);
      toast(style === 'prompt' ? '已复制访问提示词' : '已复制路径');
    } catch {
      toast('复制失败：剪贴板不可用');
    }
  };

  const copyTitle =
    style === 'prompt'
      ? '复制访问提示词（CLI 指令 + 引导）——设置 → 偏好可切换为原始路径'
      : '复制路径 + 任务号——设置 → 偏好可切换为访问提示词';

  return (
    <div className="vsc-crumbs">
      <nav className="vsc-crumbs-path" aria-label="当前位置">
        {trail.segments.map((seg, i) => {
          const isCur = i === trail.segments.length - 1;
          return (
            <span key={seg.kind} className={'vsc-crumb' + (isCur ? ' is-cur' : '')}>
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
              {/* #259 验收：任务段 hover 出两个 icon btn——复制路径 + 预览原文（旁路子侧边栏） */}
              {isCur && (
                <span className="vsc-acts">
                  <button type="button" className="vsc-copy" title={copyTitle} aria-label={copyTitle} onClick={copy}>
                    <Icon name="copy" size={13} />
                  </button>
                  {onPreview && (
                    <button
                      type="button"
                      className="vsc-copy"
                      title="预览原文（旁路打开）"
                      aria-label="预览原文"
                      onClick={onPreview}
                    >
                      <Icon name="eye" size={13} />
                    </button>
                  )}
                </span>
              )}
            </span>
          );
        })}
      </nav>
      {menu && <PopMenu x={menu.x} y={menu.y} width={menu.width} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
