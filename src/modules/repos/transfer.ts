// 布局导入导出（v4）：仓库 + 分组 + 参考关系 + **自有文档树**，以**全局唯一 key** 为身份映射。
//
// **为什么 v3**：v2 用远程地址当身份，但同一个仓库的 SSH/HTTPS 写法不同就会被当成
// 两个仓库；开发仓库没有远程地址时只能按名字匹配，重名即歧义。v3 给每个仓库一个
// key（归一化远程地址派生，或用户自定义），导出物里**不出现任何本地路径**。
// **为什么 v4**：描述内容的权威是 ~/.nx-kv/docs/ 下的真实 .md——导出 zip 把整棵
// 自有树原样打包（docs/**），layout 带上 DocRef 绑定；外部绑定只记引用**不进包**
// （模型 C 的铁律）。zip 从此是导出的本体，导入端直接吃 zip（readZip 拆包）。
//
// 导入是三步：`diffImport` 算差异（零副作用）→ 用户在面板里逐条勾选/选策略 →
// `repoImport` 执行。CLI 侧每一步都有同构命令。
//
// 实现按职责拆在 transfer/ 子目录（本文件只做 re-export，import 路径不变）：
//   layout.js  布局解析（JSON → 归一化 layout；兼容 v2/v3）
//   export.js  导出（layout JSON 与 zip 打包）
//   diff.js    导入差异检查（零副作用）
//   import.js  导入执行（策略落库 + 看板/绑定/关系重建）
//   render.js  CLI 人读渲染
export { repoExport, repoExportZip, writeExportZip } from './transfer/export.js';
export { diffImport } from './transfer/diff.js';
export { repoImport } from './transfer/import.js';
export { renderDiff, renderResult } from './transfer/render.js';
