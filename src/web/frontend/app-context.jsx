// 应用上下文：工作区里的**面板**要拿到全局数据（本机队列、仓库、导航、模板…）。
//
// 面板由 FlexLayout 的 factory 直接渲染，拿不到 App 的 props——所以用 Context 递。
// 这里只放「面板用得着的全局只读数据 + 少数动作」，不放面板自己的状态
//（那属于面板自己的 store 或 FlexLayout 的 config）。
import { createContext, useContext } from 'react';

export const AppContext = createContext(null);

/** 面板里取全局上下文；没有 Provider 时返回 null（便于单测里单独渲染面板） */
export function useApp() {
  return useContext(AppContext);
}
