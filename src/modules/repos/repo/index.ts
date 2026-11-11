// repos 仓储门面：模块内统一从这里拿 repo（不直接 import core/db）。
//
// 与 localtask/repo/index.js 同一职责：① 调用方不用记 repo 下有哪几个文件；
// ② 「打开库」这件事只发生在 repo/open.js（每个 repo 函数经它自动打开连接）；
// ③ 将来 repo 再拆只动本文件。
import { openReposStore, resetReposStore, db, txw, resolveReposDb } from './open.js';
import * as repos from './repos.js';
import * as refs from './refs.js';
import {
  SENTINEL_REPO_KEY,
  REPO_EXT,
  GROUP_EXT,
  parseExt,
  jsonText,
  msToIso,
  msOfAny,
  compact,
  repoRowToStore,
  groupRowToStore,
} from './rows.js';

export {
  openReposStore,
  resetReposStore,
  db,
  txw,
  resolveReposDb,
  repos,
  refs,
  SENTINEL_REPO_KEY,
  REPO_EXT,
  GROUP_EXT,
  parseExt,
  jsonText,
  msToIso,
  msOfAny,
  compact,
  repoRowToStore,
  groupRowToStore,
};
export { closeDb, isStoreOpen } from '../../../core/db/index.js';

/** 便捷聚合：`repo.repos.bindTopicToRepo(...)` / `repo.refs.listOrphans(...)`。 */
export default {
  open: openReposStore,
  reset: resetReposStore,
  db,
  txw,
  resolveReposDb,
  repos,
  refs,
  rows: { SENTINEL_REPO_KEY, REPO_EXT, GROUP_EXT, parseExt, jsonText, msToIso, msOfAny, compact, repoRowToStore, groupRowToStore },
};
