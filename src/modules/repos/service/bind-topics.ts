// 队列绑定（T05）：把「未绑定」队列按路径前缀 re-point 到真实仓库。
//
// 迁移裁决（D3）：legacy 队列全部挂哨兵仓库 `__unbound__`（旧 key 是目录名
// sha1，对不上任何真实仓库），**不做自动猜绑**——猜错比不猜糟。真实绑定
// 只有一个写入口：用户显式跑本命令（按登记的仓库路径前缀匹配，最长前缀赢）。
import { nowMs } from '../../../core/db/time.js';
import repoLayer from '../repo/index.js';
import { loadStore } from './store.js';
import { deriveKey } from './identity.js';
import { getRepo } from './crud.js';
import { normalizePathKey } from './context.js';
import type { DbApi } from '../../../core/db/driver.js';
import type { RepoEntry } from '../repo/rows.js';

const repo = repoLayer;

/** 留在哨兵上的队列（计划/执行共用）。 */
export interface TopicBindLeft {
  topicKey: string;
  name: string;
  cwd: string;
}

/** 命中并绑定的队列（apply=false 时是计划）。 */
export interface TopicBindHit extends TopicBindLeft {
  repoKey: string;
  repoName: string;
}

/** bindTopicsToRepos 的返回：预览（apply=false）与执行（apply=true）两种形状。 */
export type BindTopicsResult =
  | { apply: false; scanned: number; bound: TopicBindHit[]; left: TopicBindLeft[] }
  | {
      apply: true;
      scanned: number;
      bound: TopicBindHit[];
      left: TopicBindLeft[];
      changed: number;
    };

/**
 * 按路径前缀把哨兵上的队列绑到真实仓库。
 *
 * @param {object} [opts]
 * @param {string} [opts.repo]    仓库标识（id / key / 路径 / 名称）；缺省 = 全部登记仓库
 * @param {boolean} [opts.apply]  false = 预览（零副作用）；true = 先建 refs 再绑
 * @returns {{apply, scanned, bound: Array, left: Array, refs?: object}}
 *   bound  = 命中并绑定的队列（apply=false 时是计划）
 *   left   = 留在哨兵的队列（cwd 对不上任何仓库 / 全局池）
 */
export async function bindTopicsToRepos({ repo: repoLocator = '', apply = false }: { repo?: unknown; apply?: boolean } = {}): Promise<BindTopicsResult> {
  const s = await loadStore();
  let targets: RepoEntry[];
  if (repoLocator) {
    targets = [await getRepo(repoLocator)];
  } else {
    targets = s.repos.filter((r) => r.path);
  }
  const prefixes = targets
    .map((r) => ({ key: deriveKey(r), name: r.name, prefix: normalizePathKey(r.path) }))
    .filter((x) => x.prefix);

  const planFor = (conn: DbApi): { scanned: number; bound: TopicBindHit[]; left: TopicBindLeft[] } => {
    const topics = repo.repos.listUnboundTopics(conn);
    const bound: TopicBindHit[] = [];
    const left: TopicBindLeft[] = [];
    for (const t of topics) {
      const nk = normalizePathKey(t.cwd);
      let hit: { key: string; name: string; prefix: string } | null = null;
      for (const p of prefixes) {
        // 相等或在其子目录下；嵌套登记时**最长前缀赢**（更具体的仓库接管）
        if (nk && (nk === p.prefix || nk.startsWith(p.prefix + '/'))) {
          if (!hit || p.prefix.length > hit.prefix.length) hit = p;
        }
      }
      if (hit) bound.push({ topicKey: String(t.key), name: String(t.name || ''), cwd: String(t.cwd || ''), repoKey: hit.key, repoName: hit.name });
      else left.push({ topicKey: String(t.key), name: String(t.name || ''), cwd: String(t.cwd || '') });
    }
    return { scanned: topics.length, bound, left };
  };

  if (!apply) {
    const plan = repo.txw(planFor);
    return { apply: false, ...plan };
  }
  return repo.txw((conn: DbApi) => {
    const plan = planFor(conn);
    let changed = 0;
    for (const b of plan.bound) {
      const row = conn.get('SELECT id FROM topics WHERE key = :k', { k: b.topicKey });
      if (row && repo.repos.bindTopicToRepo(conn, row.id, b.repoKey, nowMs())) changed += 1;
    }
    return { apply: true, bound: plan.bound, left: plan.left, scanned: plan.scanned, changed };
  });
}
