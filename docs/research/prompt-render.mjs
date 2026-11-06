// 提示词模板渲染的**原型**：占位符 / 段落 / 列表三件套 + 按 slot 拼装。
// 对应 entities.sql 里 templates 表那段注释。零依赖、纯函数。
//
// 三条契约：
//   1. 单遍渲染 —— 插入的值不再被扫描，用户正文里的 {{...}} 逐字原样
//   2. 不折叠空白 —— 除"独占一行的块标记连同行尾换行一起消费"外，一个空白都不动
//   3. 标记独占一行时不留空行：段落丢弃后不长出空行，保留时也不多出空行

/** 从 from 开始找与 openName 配对的 closeName，处理嵌套。 */
function findBlock(src, from, openName, closeName) {
  let depth = 1;
  let i = from;
  while (i < src.length) {
    const open = src.indexOf(openName, i);
    const close = src.indexOf(closeName, i);
    if (close < 0) return null;                       // 没闭合 → 整体当普通文本
    if (open >= 0 && open < close) { depth++; i = open + openName.length; continue; }
    depth--;
    if (depth === 0) return { innerEnd: close, outerEnd: close + closeName.length };
    i = close + closeName.length;
  }
  return null;
}

/** 标记是否独占一行：前面只剩行首，后面只剩空白 + 换行。返回换行之后的位置。 */
function skipOwnLine(src, start, afterTag) {
  const lineStart = src.lastIndexOf('\n', start - 1) + 1;
  if (src.slice(lineStart, start).trim() !== '') return afterTag;
  const m = /^[ \t]*\r?\n/.exec(src.slice(afterTag));
  return m ? afterTag + m[0].length : afterTag;
}

/** 原始取值（不字符串化），供真值判断用。this 前缀走当前循环项。 */
function lookupRaw(path, ctx) {
  const p = String(path).trim();
  if (!p) return undefined;
  let cur;
  let rest;
  if (p === 'this') { cur = ctx.this; rest = []; }
  else if (p.startsWith('this.')) { cur = ctx.this; rest = p.slice(5).split('.'); }
  else if (p.startsWith('@')) { cur = ctx[p]; rest = []; }
  else { cur = ctx; rest = p.split('.'); }
  for (const seg of rest) {
    if (cur === null || cur === undefined) return undefined;
    if (!Object.prototype.hasOwnProperty.call(Object(cur), seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** 输出用取值：对象/数组不直接输出（那种场景该用 {{#each}}）。 */
function lookupText(path, ctx) {
  const v = lookupRaw(path, ctx);
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return '';
  if (typeof v === 'object') return '';
  return String(v);
}

/** 段落取舍：缺失 / 空串 / 0 / false / 空数组 → 丢弃。 */
function truthy(v) {
  if (v === undefined || v === null || v === '' || v === 0 || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function render(tpl, ctx = {}) {
  const src = String(tpl ?? '');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('{{', i);
    if (start < 0) { out += src.slice(i); break; }
    out += src.slice(i, start);

    const end = src.indexOf('}}', start);
    if (end < 0) { out += src.slice(start); break; }
    const tag = src.slice(start + 2, end);
    let next = end + 2;

    const each = tag.match(/^#each\s+([\s\S]+)$/);
    if (each) {
      const blk = findBlock(src, next, '{{#each ', '{{/each}}');
      if (!blk) { out += src.slice(start); break; }
      const inner = src.slice(skipOwnLine(src, start, next), blk.innerEnd);
      const items = lookupRaw(each[1], ctx);
      if (Array.isArray(items)) {
        items.forEach((item, idx) => {
          out += render(inner, { ...ctx, this: item, '@index': idx });
        });
      }
      next = skipOwnLine(src, start, blk.outerEnd);
    } else if (tag.startsWith('#')) {
      // 三种写法（与 Handlebars 对齐）：
      //   {{#if x}} / {{#unless x}} / {{#with x}}   → 闭合是 {{/if}} {{/unless}} {{/with}}
      //   {{#x}}                                     → 裸段落，闭合是 {{/x}}（兼容旧写法）
      const raw = tag.slice(1).trim();
      const m = raw.match(/^(if|unless|with)\s+([\s\S]+)$/);
      const helper = m ? m[1] : '';
      const arg = m ? m[2].trim() : raw;
      const blk = findBlock(src, next, '{{#' + helper + ' ', '{{/' + (helper || arg) + '}}');
      const blk2 = blk || findBlock(src, next, '{{#' + raw + '}}', '{{/' + (helper || arg) + '}}');
      if (!blk2) { out += src.slice(start); break; }
      const v = lookupRaw(arg, ctx);
      const keep = helper === 'unless' ? !truthy(v) : truthy(v);
      if (keep) out += render(src.slice(skipOwnLine(src, start, next), blk2.innerEnd), ctx);
      next = skipOwnLine(src, start, blk2.outerEnd);
    } else if (tag.startsWith('/')) {
      next = skipOwnLine(src, start, end + 2);          // 孤立闭合标记：无操作
    } else {
      out += lookupText(tag, ctx);
    }
    i = next;
  }
  return out;
}

/**
 * 按 slot 拼装：prefix → suffix → tail，同类按 sort_order。
 * 模板自己的 vars 先铺，ctx 覆盖它（内置变量与外部参数优先级更高）。
 * 渲染后为空的整段丢掉，避免留下一堆空行。
 */
export function assemble(templates, ctx = {}) {
  const SLOT = { prefix: 0, suffix: 1, tail: 2 };
  return (templates || [])
    .filter((t) => t && Number(t.enabled ?? 1) === 1)
    .map((t) => {
      let vars = {};
      try { vars = typeof t.vars === 'string' ? JSON.parse(t.vars || '{}') : (t.vars || {}); } catch { vars = {}; }
      return { ...t, text: render(t.body, { ...vars, ...ctx }) };
    })
    .sort((a, b) => (SLOT[a.slot] ?? 1) - (SLOT[b.slot] ?? 1) || (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
    .map((t) => t.text.replace(/\s+$/, ''))
    .filter((s) => s.length)
    .join('\n');
}

// ── 变量声明与正文的一致性检查 ─────────────────────────────────────────
// vars_schema 是「声明」，body 是「实际用了什么」。两者不一致时：
//   正文用了没声明的变量 → 前端渲染不出输入框，用户永远填不上 → 静默丢值
// 所以在写入/保存模板时就该拦住，而不是等渲染出来发现少了东西。

/** 扫出正文里用到的变量：占位符 / 段落 / 列表 三类。 */
export function scanVariables(body) {
  const src = String(body ?? '');
  const placeholders = new Set();
  const sections = new Set();
  const lists = new Set();
  const re = /\{\{([#/]?)([^{}]*)\}\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sigil = m[1];
    const body2 = m[2].trim();
    if (!body2) continue;
    if (sigil === '/') continue;                       // 闭合标记不计
    if (sigil === '#') {
      const each = body2.match(/^each\s+([\s\S]+)$/);
      if (each) { lists.add(each[1].trim()); continue; }
      // 块助手（if / unless / with）的**参数**才是变量名，助手名不算
      const block = body2.match(/^(?:if|unless|with)\s+([\s\S]+)$/);
      sections.add((block ? block[1] : body2).trim());
      continue;
    }
    if (body2.startsWith('@') || body2 === 'this' || body2.startsWith('this.')) continue;  // 循环内的局部名
    placeholders.add(body2);
  }
  return { placeholders: [...placeholders], sections: [...sections], lists: [...lists] };
}

/**
 * 正文用到、但 vars_schema 里没声明的变量。
 * 只是"根路径"级别的检查（{{a.b.c}} 与声明 a.b 视为同一个根 a）——
 * 细到叶子容易误报，而且前端表单本来就是按根键排的。
 */
export function undeclaredVars(body, schema) {
  const declared = new Set();
  for (const v of (schema || [])) {
    if (v && v.key) declared.add(String(v.key).split('.')[0]);
  }
  const { placeholders, sections, lists } = scanVariables(body);
  const used = new Set([...placeholders, ...sections, ...lists].map((k) => String(k).split('.')[0]));
  return [...used].filter((k) => !declared.has(k));
}
