// 壳层关闭态把手：不依赖 SidebarPanel 是否被 FlexLayout 渲染出来。
// weight 被拖到近 0 时 tab 内容不挂载 → panel 里的 portal 跟着没了，界面卡死。
// 这个把手挂在 document.body 上（position:fixed），只要模型里侧栏处于 closed（或缺失）就显示。
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons.jsx';
import { useApp } from '../../app-context.jsx';
import {
  findComponentPanel,
  restoreSidebarTab,
  saveModel,
  setTabsetAttrs,
  tabsetOfComponent,
  tabsetWeight,
} from '../../workspace.js';
import { classifySideState, sideStateAttrs } from './side-state.js';

export default function SidebarRescueFab({ model }) {
  const app = useApp() || {};
  const [show, setShow] = useState(false);

  const sync = useCallback(() => {
    if (!model) { setShow(false); return; }
    const tab = findComponentPanel(model, 'sidebar');
    if (!tab) { setShow(true); return; }
    const tsId = tabsetOfComponent(model, 'sidebar');
    const w = tabsetWeight(model, tsId);
    setShow(classifySideState(w) === 'closed');
  }, [model]);

  useEffect(() => {
    if (!model) return undefined;
    sync();
    const listener = { onAfterAction: () => sync() };
    model.addChangeListener(listener);
    const t = setInterval(sync, 400);
    return () => {
      model.removeChangeListener(listener);
      clearInterval(t);
    };
  }, [model, sync]);

  const expand = useCallback(() => {
    if (!model) return;
    let tsId = tabsetOfComponent(model, 'sidebar');
    if (!tsId) tsId = restoreSidebarTab(model);
    if (tsId) {
      setTabsetAttrs(model, tsId, sideStateAttrs('expanded'));
      saveModel(model);
    }
  }, [model]);

  if (!show || typeof document === 'undefined') return null;

  return createPortal(
    <div className="nx-side-fab-layer nx-side-fab-fixed" role="navigation" aria-label="目录已关闭">
      <button
        type="button"
        className="nx-side-fab"
        title="展开目录"
        aria-label="展开目录"
        onClick={expand}
      >
        <Icon name="sidebar" size={14} />
      </button>
      <button
        type="button"
        className="nx-side-fab-gear"
        title="设置（浮动面板）"
        aria-label="设置"
        onClick={() => app.shell && app.shell.openSettings()}
      >
        <Icon name="gear" size={14} />
      </button>
    </div>,
    document.body
  );
}
