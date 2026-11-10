// 仓库登记 CRUD：清单、登记、更新、删除、单条查询、key 定位。
import { resolve } from 'node:path';
import { badInput, notFound, conflict } from '../../../core/errors.js';
import { sanitizeGetLoop } from '../../tasktool/getloop.js';
import repoLayer from '../repo/index.js';
import { loadStore, mutateStore } from './store.js';
import {
  sanitizeIcon,
  sanitizeLinks,
  normalizeRepoInput,
  deriveKey,
  normalizeKey,
  boardRepoKeys,
  storedBoardKey,
} from './identity.js';

/**
 * **中心清单**：一份扁平的仓库列表（按名称排序），每条带它所属的看板。
 *
 * 为什么是「中心清单 + 看板只是标签」：
 *   - 仓库登记是**唯一真相**（name/path/tags/desc/notes），它一直在这张清单里；
 *   - 看板只存 `repoIds`（引用），所以**加入看板是复制**，不是移动——
 *     同一个仓库可以同时在多个看板里（fr 同时在「fr常用」与「远程打字」）；
 *   - 取消某份「副本」只摘那个看板的引用，仓库本体纹丝不动。
 *
 * 之前页面是「按看板分组的卡片墙 + 拖拽」，那套交互读起来就是「移动」，
 * 而且同一个仓库会在多个分组里重复出现、看不到全貌。现在主视图是这张扁平的
 * 中心清单，看板退成筛选器与标签。
 */
export async function listRepos() {
  const s = await loadStore();
  // docs/paths 反过来依赖本文件的 normalizeKey（动态引入避免静态环）
  const { repoDocRel, groupNoteRel } = await import('../../docs/paths.js');
  const boardsOf = new Map(); // repoKey -> [看板投影]
  for (const b of s.boards) {
    for (const rk of boardRepoKeys(b, s)) {
      if (!boardsOf.has(rk)) boardsOf.set(rk, []);
      boardsOf.get(rk).push({
        id: b.id,
        name: b.name,
        desc: b.desc || '',
        key: storedBoardKey(b),
        note: (b.repoNotes || {})[rk] || '',
        // 组内描述也是文档：前端点「描述」直接开这篇（绑定优先，缺省约定路径）
        noteDocRel: (b.repoDocs || {})[rk]?.rel || groupNoteRel(b.name, rk),
        noteDocPath: (b.repoDocs || {})[rk]?.path || '',
      });
    }
  }
  const { docSetOf } = await import('../../docs/brief.js');
  const rows = s.repos.map(({ tags: _dropped, ...r }) => {
      const rk = deriveKey(r);
      return {
        ...r,
        type: r.type || 'dev', // 旧数据无 type 字段 = dev
        key: rk,                // 老数据没有 key 字段 → 现算（Projection 不落盘，导出照样可用）
        keyCustom: !!r.keyCustom,
        remotes: Array.isArray(r.remotes) ? r.remotes : [],
        linked: Array.isArray(r.linked) ? r.linked : [],
        // 文档路径（绑定优先，缺省约定路径）——纯字符串拼接，给前端零派生消费
        docRel: r.doc?.rel || repoDocRel(rk),
        boards: boardsOf.get(rk) || [],
      };
    });
  // 描述 = 绑定的文档集（主篇标题 + 补充篇），不再是 desc 字符串
  for (const row of rows) row.descDocs = await docSetOf(row, 'repo');
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function addRepo(input) {
  if (!input || !input.path) throw badInput('path 不能为空');
  const repo = normalizeRepoInput(input);
  await mutateStore((s) => {
    if (s.repos.some((r) => r.path.toLowerCase() === repo.path.toLowerCase())) {
      throw conflict('该路径已登记: ' + repo.path);
    }
    // **key 全局唯一**（跨 dev/ref）：它是身份，也是导入导出的映射依据。
    const dup = s.repos.find((r) => deriveKey(r) === repo.key);
    if (dup) {
      throw conflict(
        `key「${repo.key}」已被仓库「${dup.name}」占用（path: ${dup.path || '未登记'}）—— key 是全局身份，不会自动加后缀；请换一个 key，或先修改/删除那条登记`
      );
    }
    s.repos.push(repo);
  });
  await seedRepoDoc(repo);
  return repo;
}

/**
 * 描述是文档：add 时给的 desc 只是**初始正文**，落到主篇 md（repo/<key>/index.md 的旧单文件位），
 * 再按 md 回写摘要。文档已在就不动——老仓库重登记不该把写过的介绍冲掉。
 * 动态 import 同 listRepos：docs 是叶子，repos 反向依赖它（静态引会成环）。
 */
async function seedRepoDoc(repo) {
  const desc = String((repo && repo.desc) || '').trim();
  if (!desc) return null;
  const { repoDocRel } = await import('../../docs/paths.js');
  const store = await import('../../docs/store.js');
  const rel = repoDocRel(repo.key);
  if (await store.ownDocExists(rel)) return null;
  return writeRepoDocContent(repo, desc);
}

/**
 * 把一段文本写成仓库的主篇文档（覆盖正文，标题取仓库名）。
 * 导入覆盖（transfer 的 overwrite 策略）走这里——描述不能再经 updateRepo 的 desc 字段。
 */
export async function writeRepoDocContent(repo, text) {
  const { repoDocRel } = await import('../../docs/paths.js');
  const store = await import('../../docs/store.js');
  const { writeBackSummary } = await import('../../docs/seed.js');
  const rel = repoDocRel(repo.key);
  const body = `# ${repo.name || repo.key}\n\n${String(text || '').trim()}\n`;
  await store.writeOwnDoc(rel, body);
  await writeBackSummary(rel, body);
  return rel;
}

export async function updateRepo(id, patch) {
  return mutateStore((s) => {
    // 定位：id → key → 绝对路径 → 名称（与 getRepo 同一口径——
    // 「用本机仓库接管待初始化的 key」这类场景给的是路径或 key，不是行主键）
    const raw = String(id || '').trim();
    const r =
      s.repos.find((x) => x.id === raw) ||
      s.repos.find((x) => deriveKey(x) === normalizeKey(raw)) ||
      s.repos.find((x) => x.path && x.path.toLowerCase() === resolve(raw).toLowerCase()) ||
      s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
    if (!r) throw notFound('repo 不存在: ' + id);
    const beforeKey = deriveKey(r);
    if (patch.name !== undefined) r.name = String(patch.name).trim();
    if (patch.icon !== undefined) r.icon = sanitizeIcon(patch.icon);
    if (patch.desc !== undefined) {
      throw badInput(
        '描述已改为文档（不再是字符串）：改正文用 `docs set <rel>`，换绑主篇用 ' +
        '`docs bind --repo <仓库> --rel <路径>`，加补充篇用 `docs link --board <看板> --doc <路径>`'
      );
    }
    if (patch.notes !== undefined) r.notes = String(patch.notes);
    if (patch.type !== undefined) {
      const t = patch.type === 'ref' ? 'ref' : patch.type === 'dev' ? 'dev' : null;
      if (!t) throw badInput('type 只能是 dev | ref，收到: ' + patch.type);
      r.type = t;
      if (!Array.isArray(r.linked)) r.linked = [];
      // 转成 dev 时清掉「指向目标」的绑定（{repo|board}），但**保留反向引用**（{ref}）——
      // dev 仓库身上挂的参考列表是它自己的属性，与它是什么类型无关。
      // v4：它若作为参考仓库被组共享，也要从所有组摘掉（组里只允许 type=ref）。
      if (t === 'dev') {
        r.linked = r.linked.filter((l) => l.kind === 'ref');
        const gone = deriveKey(r);
        for (const b of s.boards) {
          if (Array.isArray(b.refs)) b.refs = b.refs.filter((x) => x.id !== gone);
        }
        // 仓库级直接绑定也要摘（原来指向它这个 ref，现在它已经不是参考仓库了）
        for (const other of s.repos) {
          if (other === r || !Array.isArray(other.linked)) continue;
          other.linked = other.linked.filter((l) => !(l && l.kind === 'ref' && String(l.id) === gone));
        }
      }
    }
    if (patch.remote !== undefined) {
      // 改 remote：非自定义 key 跟随 remote 重算；自定义 key 保持不变（用户显式选择）。
      r.remote = String(patch.remote || '').trim();
      if (!r.keyCustom) r.key = deriveKey(r);
      r.keyUpdatedAt = new Date().toISOString();
    }
    if (patch.remotes !== undefined) {
      r.remotes = Array.isArray(patch.remotes) ? patch.remotes.map((x) => String(x).trim()).filter(Boolean) : [];
    }
    if (patch.keyCustom !== undefined) r.keyCustom = patch.keyCustom === true;
    if (patch.key !== undefined) {
      const k = patch.key === '' ? '' : normalizeKey(patch.key);
      if (patch.key !== '' && !k) throw badInput('key 不合法: ' + patch.key);
      // 显式给 key = 视为自定义（keyCustom 未同时显式指定时）
      if (patch.keyCustom === undefined && k) r.keyCustom = true;
      r.key = k || deriveKey(r);
      r.keyUpdatedAt = new Date().toISOString();
    }
    if (patch.linked !== undefined) r.linked = sanitizeLinks(patch.linked);
    if (patch.getLoop !== undefined) {
      // 项目级「持续 get」（waitgoal）配置：null/ false = 清除；对象 = 与已有字段合并后落库
      if (patch.getLoop === null) {
        delete r.getLoop;
      } else {
        const v = sanitizeGetLoop(patch.getLoop);
        const merged = sanitizeGetLoop({ ...(r.getLoop || {}), ...v });
        if (merged) r.getLoop = merged;
        else delete r.getLoop;
      }
    }
    if (patch.path !== undefined) {
      const abs = resolve(String(patch.path));
      // 改路径同样要防重复登记，否则两条记录指向同一目录，扫描时无法判断是否已登记
      if (s.repos.some((x) => x.id !== r.id && x.path.toLowerCase() === abs.toLowerCase())) {
        throw conflict('该路径已登记: ' + abs);
      }
      r.path = abs;
    }
    r.updatedAt = new Date().toISOString();
    // key 全局唯一：改 key / remote / keyCustom 后统一在这里兜底校验一次。
    // （放在最后、且对所有更新都跑——便宜，且不会漏掉某个分支。）
    const finalKey = deriveKey(r);
    if (!finalKey) throw badInput('key 不能为空：没有远程地址时，key 必须显式给出');
    const dup = s.repos.find((x) => x.id !== r.id && deriveKey(x) === finalKey);
    if (dup) {
      throw conflict(
        `key「${finalKey}」已被仓库「${dup.name}」占用（path: ${dup.path || '未登记'}）—— key 是全局身份，不会自动加后缀；请换一个 key`
      );
    }
    // 参考仓库改 key：仓库级绑定存在别人的 ext 里（没有 FK），必须跟着改，
    // 否则绑定会静默指向一个不存在的 key（组级 group_refs 由 DB 的 ON UPDATE CASCADE 跟随）。
    if (finalKey !== beforeKey) {
      for (const other of s.repos) {
        if (other === r || !Array.isArray(other.linked)) continue;
        for (const l of other.linked) {
          if (l && l.kind === 'ref' && String(l.id) === beforeKey) l.id = finalKey;
        }
      }
    }
    r.key = finalKey;
    return r;
  });
}

export async function removeRepo(id) {
  // 删仓库前置检查：队列绑定在 topics.repo_key（FK CASCADE）——真删会把
  // 该仓库下的队列连同任务一起级联掉，这是谁都不预期的副作用，必须先挡。
  const raw = String(id || '').trim();
  if (raw) {
    const k = await resolveRepoKey(raw).catch(() => null);
    if (k) {
      const bound = repoLayer.txw((conn) => repoLayer.repos.countTopicsOfRepo(k, conn));
      if (bound > 0) {
        throw conflict(`仓库「${k}」下还有 ${bound} 条队列绑定 —— 先解绑（或删除队列）再删除登记`);
      }
    }
  }
  return mutateStore((s) => {
    // 定位：id → key → 绝对路径 → 名称（与 getRepo/updateRepo 同一口径）
    const raw = String(id || '').trim();
    const idx = s.repos.findIndex(
      (x) =>
        x.id === raw ||
        deriveKey(x) === normalizeKey(raw) ||
        (x.path && x.path.toLowerCase() === resolve(raw).toLowerCase()) ||
        String(x.name).toLowerCase() === raw.toLowerCase()
    );
    if (idx < 0) throw notFound('repo 不存在: ' + id);
    const deadKey = deriveKey(s.repos[idx]);
    // 看板里同步摘引用（看板成员存 key，登记没了就是死引用）
    for (const b of s.boards) {
      if (Array.isArray(b.repoKeys)) b.repoKeys = b.repoKeys.filter((k) => k !== deadKey);
      if (b.repoNotes && b.repoNotes[deadKey]) delete b.repoNotes[deadKey];
      // 组级参考绑定：删掉的是参考仓库 → 它从所有组里消失
      if (Array.isArray(b.refs)) b.refs = b.refs.filter((r) => r.id !== deadKey);
    }
    // 绑定是双向记录：两边都要清（全部按 key 比对）
    //   ref 侧的 {kind:'repo', id:被删仓库的 key} 与 {kind:'board', id:被删看板的 key}
    //   dev 侧的 {kind:'ref', id:被删参考仓库的 key}
    for (const r of s.repos) {
      if (!Array.isArray(r.linked)) continue;
      r.linked = r.linked.filter((l) => l.id !== deadKey);
    }
    return s.repos.splice(idx, 1)[0];
  });
}

// id / key / 绝对路径 / 名称 均可定位（agent 场景常直接给路径或 key）
export async function getRepo(idOrPathOrKey) {
  const s = await loadStore();
  const raw = String(idOrPathOrKey || '').trim();
  let r = s.repos.find((x) => x.id === raw);
  if (!r && raw) {
    const k = normalizeKey(raw);
    if (k) r = s.repos.find((x) => deriveKey(x) === k);
  }
  if (!r) {
    const p = resolve(raw);
    r = s.repos.find((x) => x.path.toLowerCase() === p.toLowerCase());
  }
  if (!r) r = s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!r) throw notFound('repo 不存在: ' + raw);
  // 带上它所属的看板（中心清单的同一份数据，单条查询也别缺这一维）
  const rk = deriveKey(r);
  const { repoDocRel } = await import('../../docs/paths.js');
  const boards = s.boards
    .filter((b) => boardRepoKeys(b, s).includes(rk))
    .map((b) => ({ id: b.id, name: b.name, desc: b.desc || '', key: storedBoardKey(b) }));
  const { tags: _dropped, ...base } = r;
  return {
    ...base,
    type: base.type || 'dev',
    key: rk,
    keyCustom: !!base.keyCustom,
    remotes: Array.isArray(base.remotes) ? base.remotes : [],
    linked: Array.isArray(base.linked) ? base.linked : [],
    docRel: base.doc?.rel || repoDocRel(rk),
    boards,
  };
}

/**
 * 仓库的 key（自定义 > remote 派生 > local/<名称> 兜底）。
 * 与 deriveKey 同义，独立导出是为了让「关系一律用 key」这件事在代码里自明。
 */
export const repoKeyOf = deriveKey;

/**
 * 定位一个仓库的 **key**：入参可以是 id / key / 绝对路径 / 名称。
 * 关系引用一律用它——id 是本机行主键，跨机即失效；key 才是身份。
 * 找不到抛 notFound（调用方决定要不要软失败）。
 */
export async function resolveRepoKey(locator) {
  const raw = String(locator || '').trim();
  if (!raw) throw badInput('缺少仓库标识（id / key / 路径 / 名称）');
  const s = await loadStore();
  let r = s.repos.find((x) => x.id === raw);
  if (!r) {
    const k = normalizeKey(raw);
    if (k) r = s.repos.find((x) => deriveKey(x) === k);
  }
  if (!r) {
    const p = resolve(raw);
    r = s.repos.find((x) => x.path.toLowerCase() === p.toLowerCase());
  }
  if (!r) r = s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!r) throw notFound('repo 不存在: ' + raw);
  return deriveKey(r);
}

/** 定位看板的 key：入参可以是 id / 冻结 key / 名称派生 key / 名称。 */
export async function resolveBoardKey(locator) {
  const raw = String(locator || '').trim();
  if (!raw) throw badInput('缺少看板标识（id / key / 名称）');
  const s = await loadStore();
  let b = s.boards.find((x) => x.id === raw);
  if (!b) {
    const k = normalizeKey(raw);
    if (k) b = s.boards.find((x) => storedBoardKey(x) === k);
  }
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!b) throw notFound('看板不存在: ' + raw);
  return storedBoardKey(b);
}
