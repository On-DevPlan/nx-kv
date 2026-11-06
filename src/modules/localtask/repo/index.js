// localtask 仓储门面：模块内统一从这里拿 repo（不直接 import core/db）。
//
// 为什么收一道门面：① 调用方不用记 repo 下有哪几个文件；② 「打开库」这件事只发生
// 在 repo/open.js（每个 repo 函数经它自动打开连接）；③ 将来 repo 再拆
// （goals / links）只动本文件。
import { openLocaltaskStore, resetLocaltaskStore, db, txw, resolveLocaltaskDb } from './open.js';
import * as topics from './topics.js';
import * as tasks from './tasks.js';
import * as presence from './presence.js';
import * as settings from './settings.js';
import { createDbTopicAdapter } from './snapshot.js';
import * as links from './links.js';

export {
  openLocaltaskStore,
  resetLocaltaskStore,
  db,
  txw,
  resolveLocaltaskDb,
  topics,
  tasks,
  presence,
  settings,
  links,
  createDbTopicAdapter,
};
export { closeDb, isStoreOpen } from '../../../core/db/index.js';

/** 便捷聚合：`repo.topics.ensureTopic(...)` / `repo.tasks.claimTask(...)`。 */
export default {
  open: openLocaltaskStore,
  reset: resetLocaltaskStore,
  db,
  txw,
  resolveLocaltaskDb,
  topics,
  tasks,
  links,
  presence,
  settings,
  createDbTopicAdapter,
};
