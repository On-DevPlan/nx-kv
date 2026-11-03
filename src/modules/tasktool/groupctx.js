// tasktool/groupctx.js —— **项目组上下文封装**（交付层）。
//
// todo.md 的原文口径：
//   「如果是获得在项目组的仓库的一个任务，该对返回的提示词进行封装，就比如说返回
//    整个项目组的一些基本概念，还有对应的一些参考文件的地址，就是封装对应的提示词
//    保持在原本的提示此任务下面对上下文环境进行一个封装」
//
// 也就是说：agent 领到「组内某个仓库」的任务时，除了任务本身，还要知道
//   - 这个项目是干什么的（项目介绍）
//   - 这个组是干什么的（组介绍 md / 组描述）
//   - 本项目在组里占什么位置（组内描述）
//   - 组里还有谁、各自什么角色（兄弟仓库的组内描述）
//   - 组的参考文件在哪（自有树路径 / 外部绝对路径——agent 可直接读盘）
//
// 任务原文（task.text）**不被改写**：上下文一律进 instruction 字段（与收尾指令、
// 时间目标 check 指令并列），保持「原文 + 上下文封装」的结构。
//
// 组材料已经在 docs 模块落盘（组介绍 md / 组绑定文档 / 组内描述）——这里只做**读取与
// 编排**，不重复实现文档逻辑。动态 import + fail-open：组上下文读不出来绝不能拖垮领取。
let docsMod = null;
async function docsService() {
  if (!docsMod) docsMod = await import('../docs/knowledge.js');
  return docsMod;
}

const MAX_INTRO_CHARS = 2400; // 介绍正文上限：太长就截断并指向全文路径

/** 介绍正文截断（超过上限就截，并给出全文路径） */
function clipIntro(body, path) {
  const text = String(body || '');
  if (text.length <= MAX_INTRO_CHARS) return text.trim();
  return text.slice(0, MAX_INTRO_CHARS).trim() + (path ? `\n（全文：${path}）` : '…');
}

/**
 * 读某个工作目录所属的项目组上下文。
 * @returns {Promise<null | {repo:{name,key}, groups:Array}>} null = 不在项目组里 / 读取失败
 */
export async function readGroupContext(cwd) {
  try {
    const { groupContextFor } = await docsService();
    return await groupContextFor(cwd);
  } catch {
    return null; // fail-open：上下文是增强，不是领取的前提
  }
}

/**
 * 把组上下文渲染成交付文本里的一段。
 * 结构：项目介绍 → 组概念 → 本项目位置 → 兄弟成员 → 参考文件地址。
 *
 * 项目介绍**不带组也要给**：项目级任务（不在任何组里的仓库）同样要知道自己是谁。
 */
export function renderGroupContext(ctx) {
  if (!ctx) return '';
  const lines = [];
  const repo = ctx.repo || {};
  if (repo.intro && repo.intro.body) {
    lines.push(`〔项目介绍 · ${repo.name || repo.key || ''}〕${repo.intro.path ? `（${repo.intro.path}）` : ''}：`);
    lines.push(clipIntro(repo.intro.body, repo.intro.path));
    lines.push('');
  }
  if (!ctx.groups || !ctx.groups.length) return lines.join('\n').trim();
  for (const g of ctx.groups) {
    lines.push(`〔项目组上下文 · ${g.name}〕`);
    if (g.desc) lines.push(`组定位：${g.desc}`);
    if (g.intro && g.intro.body) {
      lines.push(`组介绍（${g.intro.path || 'docs'}）：`);
      lines.push(clipIntro(g.intro.body, g.intro.path));
    }
    if (g.note) lines.push(`本项目在组里的位置：${g.note}`);
    if (g.peers && g.peers.length) {
      lines.push('组内成员：');
      for (const p of g.peers) lines.push(`  - ${p.name}：${p.note || '（无组内描述）'}`);
    }
    if (g.docLinks && g.docLinks.length) {
      lines.push('组绑定参考文件（可直接读取）：');
      for (const d of g.docLinks) {
        lines.push(`  - ${d.abs || d.rel}${d.note ? `  # ${d.note}` : ''}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}
