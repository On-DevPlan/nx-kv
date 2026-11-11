// 看板（主题容器）service：仓库的多项目编排层。
//
// 一个看板 = 一个主题；成员关系挂 board.repoKeys（**按 key**，有序），
// 不在任何看板里的仓库 = 未分组。
//
// **为什么成员用 key 而不是仓库 id**：id 是本机行主键（r_xxx），换机导入后必然不同；
// key 才是仓库的身份（归一化远程地址派生，或自定义）。关系一律用 key，
// 导出导入才能精确映射——这正是「只有有序的 key 才能映射」的目的。
//
// 与 repo 登记的关系：看板只存 key 引用，登记数据（name/desc/path…）的唯一真相在 s.repos——
// 删看板不动登记，删登记要同步摘引用（见 service.js 的 removeRepo）。
//
// **成员可以是「本地未拥有」的 key**（导入时对方组里有、本地没有的仓库）：
// 位置保留在组里（完整复制导出方的布局），投影里 present=false 标出来，
// 有远程地址的还能一键 clone 补齐。clone 后 key 相同 → 占位自动转正。
//
// 本文件是门面（不含传输层概念，不认识 argv 与 HTTP）。
// 实现按职责拆在 boards/ 子目录（本文件只做 re-export，import 路径不变）：
//   core.js      成员投影与看板 CRUD、定位助手（findBoardIn / repoKeyIn）
//   members.js   成员操作：聚合/移出（assign）、占位线索/重绑/清理
//   docs.js      组内描述（board note）——描述 = 文档
//   transfer.js  看板导入导出与按前缀归组（一次性命令）
export {
  listBoards,
  getBoard,
  createBoard,
  updateBoard,
  removeBoard,
} from './boards/core.js';
export {
  assignRepo,
  setMemberHint,
  rekeyMember,
  prunePlaceholders,
} from './boards/members.js';
export { setBoardRepoNote } from './boards/docs.js';
export {
  importBoards,
  exportBoards,
  applyPrefixGroup,
} from './boards/transfer.js';
