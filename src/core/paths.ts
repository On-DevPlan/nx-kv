// 路径与常量的唯一权威来源。
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { badInput } from './errors.js';

export const APP_NAME = 'nx-kv';
// 用户目录：默认 ~/.nx-kv，可用 NX_KV_HOME 覆盖（测试把整份真实数据拷到临时目录跑迁移）。
// 收口成一个变量：库、docs、attachments、panels.json、backups 全在它下面，
// 散着各自读 homedir 就会出现「库在临时目录、日志写到真实 home」这种最难查的混搭。
export const APP_DIR = process.env.NX_KV_HOME || join(homedir(), '.nx-kv');
export const STORE_PATH = join(APP_DIR, 'store.json');

// 数据库文件（唯一权威）：默认 APP_DIR/nxkv.db，可用 NX_KV_DB 覆盖（测试隔离用）。
// **只这一个路径变量**：库化后再有第二个「某份数据在哪」的变量，
// 就是最典型的"静默读写错库"。
export const DB_FILE_NAME = 'nxkv.db';

/** 库落点：path 是库文件，appDir 是 legacy JSON 导入的扫描根（跟着目录走）。 */
export interface StoreTarget {
  path: string;
  appDir: string;
}

// 库路径解析（唯一权威）。除了显式 NX_KV_DB，还会回落到各域 legacy env 的
// 目录（repos / localtask 的 JSON 时代隔离约定）—— T06 起 config 偏好与队列级
// timegoal 都进同一份库，core 层的默认打开（getDb / openStore 无参）必须与
// 域仓储的解析落在同一个文件上，否则就是「读路径静默换库」（T05 的教训）。
// appDir 是 legacy JSON 导入的扫描根，跟着目录走。
export function defaultStoreTarget(): StoreTarget {
  const explicit = process.env.NX_KV_DB;
  if (explicit) return { path: explicit, appDir: APP_DIR };
  // 只保留两个**活**的测试隔离 env（localtask / repos 的 open.js 映射机制）；
  // NX_KV_TEMPLATES_STORE / NX_KV_TIMEGOAL_STORE / NX_KV_SESSIONTASK_STORE 已随
  // 各域切库下线（T07），不再进解析链。
  for (const v of [process.env.NX_KV_REPOS_STORE, process.env.NX_KV_LOCALTASK_STORE]) {
    if (v) {
      const dir = dirname(v);
      return { path: join(dir, DB_FILE_NAME), appDir: dir };
    }
  }
  return { path: join(APP_DIR, DB_FILE_NAME), appDir: APP_DIR };
}

export function dbPathFromEnv(): string {
  return defaultStoreTarget().path;
}
// 备份目录（VACUUM INTO 落这里；保留最近 5 份）
export function backupsDirFromEnv(): string {
  return process.env.NX_KV_BACKUPS || join(APP_DIR, 'backups');
}

export const DEFAULT_PORT = 7877;

// 本机附件仓根目录。**刻意放在 nx-kv 的用户目录下**（~/.nx-kv/attachments/）：
// agent 读附件只认本地路径，放在项目目录里会随 cwd 漂移，还会被 git 捡走。
export const ATTACHMENTS_DIR = join(APP_DIR, 'attachments');

// 允许测试与多实例覆盖存储位置：NX_KV_STORE 环境变量优先
export function storePathFromEnv(): string {
  return process.env.NX_KV_STORE || STORE_PATH;
}

// 允许测试与多实例覆盖附件目录：NX_KV_ATTACHMENTS 环境变量优先
export function attachmentsRootFromEnv(): string {
  return process.env.NX_KV_ATTACHMENTS || ATTACHMENTS_DIR;
}

// mdfile 的默认附件目录。
//
// **语义（2026-11 硬约束）**：这个目录只用来存放 mdfile 的默认附件，
// 只能通过 attach 访问；文档正文的唯一真相在 `ref_bodies`，这里不再承载文档。
// 除 attachment 层与迁移脚本外，任何模块不得直接用 fs 打开这个目录下的文件。
// 环境变量名 `NX_KV_DOCS_DIR` 保留（用户的既有配置不能因为改名作废）。
export function mdfileDirFromEnv(appDir: string = APP_DIR): string {
  return process.env.NX_KV_DOCS_DIR || join(appDir, 'docs');
}

// 名称安全校验：拒绝路径穿越（保留中文等合法命名）。
//
// 用于「这个字符串会被用作**目录名**」的场景：skill 名、内置包名、适配器 id。
// 因此拒绝前导点——避免意外生成隐藏目录。
// 注意：文件路径不要用这个，用下面的 assertSafeRelPath——像 .gitignore 这样的
// 文件名是合法且常见的，用名称规则去卡它会把正常文件挡在门外。
export function assertSafeName(name: unknown, label = 'skill 名称'): string {
  if (!name || typeof name !== 'string' || /[\\/]/.test(name) || name.includes('..') || name.startsWith('.')) {
    throw badInput('非法 ' + label + ': ' + String(name));
  }
  return name;
}

// 相对路径校验：一切来自外部的「某个目录内的文件路径」都要过这里。
// 允许子目录（git 的 --file 常带路径）与前导点（.gitignore / .github/workflows/x.yml）。
// 拒绝绝对路径与 .. 段——历史上 applySkillSide 做了这类校验而 gitResolve/gitDiff 没做，
// 同一类输入校验强度不一致，本身就是可乘之口。
//
// 返回**归一化后**的路径（折叠重复分隔符、去掉 './' 段），调用方应使用返回值。
export function assertSafeRelPath(
  input: unknown,
  { label = '文件路径', allowSubdir = true }: { label?: string; allowSubdir?: boolean } = {},
): string {
  if (!input || typeof input !== 'string') throw badInput(label + '不能为空');
  if (/^([a-zA-Z]:|[\\/])/.test(input)) throw badInput(label + '必须是相对路径: ' + input);

  const segments = input.split(/[\\/]+/).filter((x) => x !== '' && x !== '.');
  if (!segments.length) throw badInput('非法 ' + label + ': ' + input);
  if (segments.includes('..')) throw badInput(label + '不得包含 ..: ' + input);
  if (!allowSubdir && segments.length > 1) {
    throw badInput(label + '不能包含路径分隔符: ' + input);
  }
  return segments.join('/');
}
