// 仓库上下文 service：登记、CRUD、目录扫描。
//
// **来历**：这套东西原本长在 nx-rh（`src/modules/repos/`），2026-10-23 整体迁到 nx-kv
// （远程清单 topic=goal 的 #72）：仓库登记是**本机事实**（路径、标签、描述），
// 它的价值是给「本地任务管理」当上下文——agent 领到任务时就知道这条任务属于哪个仓库、
// 周围关联着哪些看板。所以它跟着任务走，而不是跟着另一个工具走。
//
// 本文件是业务真相源的**门面**，不含任何传输层概念（不认识 argv，也不认识 HTTP）。
// git 边界（2026-10-27 收紧为两条）：开发仓库（type=dev）不碰 git——状态/diff/pull/push
// 一律不做（git 客户端是无底洞）；参考仓库（type=ref）只做 clone/pull/读 origin 三件事
// （见 git.js / ref.js）——它的价值就是「把远程仓库抓到本机参考并保持新鲜」。
//
// 实现按职责拆在 service/ 子目录（本文件只做 re-export，import 路径不变）：
//   identity.js     身份与输入归一（key 派生 / 冻结 key / 成员 key 兼容读取）——纯函数
//   store.js        JSON 形态 store 的组装与整份落库（mutateStore 适配器）
//   crud.js         登记 CRUD（list/add/update/remove/get）与 key 定位
//   context.js      目录扫描与「本地任务上下文」视图（contextMap / contextForPath）
//   bind-topics.js  队列绑定（哨兵上的「未绑定」队列按路径前缀挂到真实仓库）
export {
  newId,
  deriveKey,
  dirnameFromRemote,
  boardKeyOf,
  storedBoardKey,
  boardRepoKeys,
  findBoard,
  normalizeKey,
  localKeyOf,
  keyFromRemote,
  normalizeRemoteKey,
} from './service/identity.js';
export { loadStore, mutateStore, saveStore } from './service/store.js';
export {
  listRepos,
  addRepo,
  writeRepoDocContent,
  updateRepo,
  removeRepo,
  getRepo,
  repoKeyOf,
  resolveRepoKey,
  resolveBoardKey,
} from './service/crud.js';
export {
  scanRepos,
  repoOpen,
  normalizePathKey,
  contextForPath,
  contextMap,
  findRepoByName,
} from './service/context.js';
export { docsIndexRoot, bindTopicsToRepos } from './service/bind-topics.js';
