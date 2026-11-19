// JSON 时代的 topic-adapter 已下线（T03）。
//
// 快照 ↔ 主题桶的投影现在直接走 SQLite：
//   get / set / has 三件套在 repo/snapshot.js（createDbTopicAdapter），
//   CAS 在 BEGIN IMMEDIATE 里比较（JSON 版是先读后写，有竞态窗口）。
// 本文件保留一个转发导出，谁还在 import 旧名字就照常工作；
// 以后新代码一律从 repo/snapshot.js 拿。
export { createDbTopicAdapter as createTopicAdapter } from '../repo/snapshot.js';
