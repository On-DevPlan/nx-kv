// 仓库上下文模块：action 声明是 CLI 命令、HTTP 路由、help 文案的唯一来源。
// 加一条操作 = 在 actions 里加一项，三端同时获得它。
//
// **来历**：这套命令原本长在 nx-rh（`src/modules/repos/`），2026-10-23 整体迁到 nx-kv
// （远程清单 topic=goal 的 #72）。迁过来的理由：仓库登记是本机事实，而它的价值在于
// 给「本地任务管理」当上下文——所以它该跟着任务走。
//
// 本模块只管**登记**：路径、名称、描述、备注。
// git 边界（2026-10-27 随参考仓库一并声明）：开发仓库（type=dev）的 git 状态 / diff /
// pull / push 一律不做——git 客户端是无底洞，面板里做不出比 IDE 更好的体验。
// 参考仓库（type=ref）例外，只做 clone / sync / check 三件事（见 ref.* 命令族）——
// 它的价值就是「把远程仓库抓到本机参考并保持新鲜」，不做这个它就没存在意义。
//
// 实现拆在 cli/ 子目录（本文件只做组装，import 路径不变）：
//   render.js            CLI 人读渲染与布局读取（readLayout：import 双入口共用）
//   repo-actions.js      repo.* CRUD / 文档集（doc.*）/ 扫描 / 打开
//   remote-actions.js    key 与远程地址（remote / key.* / clone）
//   ref-actions.js       参考仓库与绑定关系（ref.* / bind / note / of / knowledge）
//   transfer-actions.js  布局导入导出与队列绑定（export / import* / bind-topics）
//   board-actions.js     board.*（含按前缀归组的一次性命令）
import { repoActions } from './cli/repo-actions.js';
import { remoteActions } from './cli/remote-actions.js';
import { refActions } from './cli/ref-actions.js';
import { transferActions } from './cli/transfer-actions.js';
import { boardActions } from './cli/board-actions.js';

export default {
  id: 'repos',
  title: '仓库上下文（= Web「仓库」页；本地任务的主题会带上这里的上下文）',
  order: 10,

  // CRUD 完备性声明：本模块管理的是一组「仓库」实体，因此必须齐备五个操作，
  // 且每个都要能从 CLI 与 HTTP 两端调用。
  //   增 repo.add    查(列表) repo.list   查(单条) repo.get
  //   改 repo.update 删 repo.remove
  // tests/unit/registry.test.mjs 据此断言——漏一个、或某个操作缺了某端，直接测试失败。
  resource: 'repo',

  actions: [
    ...repoActions,
    ...remoteActions,
    ...refActions,
    ...transferActions,
    ...boardActions,
  ],
};
