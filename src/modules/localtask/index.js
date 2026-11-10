// 本地任务（localtask）模块：本机按「工作目录（cwd）」划分的任务队列——提交（add）、
// 领取（wait）、查看/编辑/删除/调序（list/get/update/remove/reorder）与主题管理。
// 阻塞等待只是当前的一个子功能：agent 在一个对话里需要用户继续给任务时，不必结束
// 本轮、等用户去原始输入框打字，而是把
// `localtask wait --cwd "<工作目录>" --summary "<当前现状>"` 作为本轮**最后一步**调用：
// 命令阻塞、自动打开浏览器弹窗，用户回填后解除阻塞、把新任务作为结果返回，agent 接着干。
//
// 声明了 `resource: 'localtask'`，故 CRUD 五操作齐备且两端可调用
// （tests/unit/registry.test.mjs 据此断言）。工作目录即主题、主题拥有任务队列：
// 同目录共用队列、不同目录互不串，任务可在主题队列里堆积。
//
// 与 todo 的区别：todo 管 KV 后端上的清单（需登录）；localtask 是**本机**
// 任务队列，数据存本地文件，不依赖后端登录态。
//
// 本文件只是对外入口：action 声明按职责拆在同层 action-*.js（flags/render 也有专档），
// 这里按原始顺序组装，import 路径与导出形状不变。
import { queryActions } from './action-query.js';
import { lifecycleActions } from './action-lifecycle.js';
import { submitActions } from './action-submit.js';
import { attachActions } from './action-attach.js';
import { removalActions } from './action-remove.js';
import { topicActions } from './action-topics.js';
import { maintenanceActions } from './action-maintenance.js';
import { moveActions } from './action-move.js';
import { waitingActions } from './action-waiting.js';

// 交付载荷的人读正文：实现下沉到 tasktool/delivery-text.js（与面板预览共用一份，
// 「预览 = 真实领取」这件事才有保障）。这里再导出，既有调用点与单测不用改。
import { deliveryBodyText } from '../tasktool/delivery-text.js';
export { deliveryBodyText };

export default {
  id: 'localtask',
  title: '本地任务（= Web「本地任务」页）',
  order: 20,

  // CRUD 资源声明：主题任务的增删查改齐备，CLI 与面板都能调用
  resource: 'localtask',

  actions: [
    // ─── 查看：总览 / 单条 / 任务链 ──────────────────────────
    ...queryActions,
    // ─── 生命周期：克隆/派生 → 领取/预览 → 重开/完成/时间目标日志 ──
    ...lifecycleActions,
    // ─── 写入：远程导入 / add / update ───────────────────────
    ...submitActions,
    // ─── 附件：挂 / 解除 / 列出 ──────────────────────────────
    ...attachActions,
    // ─── 任务删除 / 批量取消 / 批量收口 / 恢复 ────────────────
    ...removalActions,
    // ─── 主题登记与删除（单个 / 批量）──────────────────────────
    ...topicActions,
    // ─── 配置 / 清理 / 调序 ─────────────────────────────────
    ...maintenanceActions,
    // ─── 本机 ⇄ 云端 迁移（面板与 CLI 同构，原型设计稿 §5/§7.3）───
    ...moveActions,
    // ─── 阻塞等待族（wait 纯 CLI，agent 本轮最后一步）────────────
    ...waitingActions,
  ],
};
