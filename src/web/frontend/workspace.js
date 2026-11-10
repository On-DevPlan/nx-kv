// 工作区 —— 布局模型（唯一真源）+ 持久化 + 开面板。
//
// 这一层贴着 FlexLayout 的模型语义写，不自造：
//   · 模型 = JSON 树（row → tabset → tab），UI 是它的投影
//   · 所有改动走 Actions.*（model.doAction），**不直接改节点属性**
//   · 存盘 = model.toJson()；恢复 = Model.fromJson()
//   · 拖拽/停靠的语义由库负责，我们只提供「往哪个 tabset 塞哪块面板」
//
// 实现按职责拆在同名目录里，本文件只做再导出（对外契约不变）：
//   workspace/layout.js  布局 JSON、全局属性、读盘愈合、存盘剪枝
//   workspace/panels.js  面板定位、区域 tabset 认领、单面板位清场
//   workspace/open.js    开面板流程（策略表落点在 workspace/areas.js）
export * from './workspace/layout.js';
export * from './workspace/panels.js';
export * from './workspace/open.js';
