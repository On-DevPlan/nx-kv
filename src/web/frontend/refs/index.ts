// refs 模块的统一出口：面板、文档页、仓库管理页都从这里取。
//
// 分层（自上而下）：
//   ops.ts    写操作（新建 / 改 desc / 摘除 / 删除）+ 统一广播
//   api.ts    传输层（HTTP 路径与 body 只在这里拼）
//   rows.ts   展示规则（主名 / 副标题 / 归属计数与筛选，纯函数）
//   follow.ts 面板跟随左侧目录的路由解析（纯函数）
//
// 为什么单独成模块（#120）：这些逻辑原本散在 page/refs、page/doc、page/repos 三处，
// 各自拼 body、各自 toast、各自记得发 doc-bus —— 列表一致性靠人肉维护，必然分叉。
export * from './api.js';
export * from './rows.js';
export * from './ops.js';
export { resolveFollowedHost } from './follow.js';
export type { FollowedHost, FollowResolution } from './follow.js';
