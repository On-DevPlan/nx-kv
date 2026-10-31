// 任务模板：MD 工作台「新建页」的起始正文。
//
// 存 ~/.nx-kv/templates.json（NX_KV_TEMPLATES_STORE 可覆盖，测试隔离）。
// 与本机队列一样是**本机数据**：不进云端、不随工作空间走。内置一条默认模板
// （不可删，可被设为默认的其他模板顶替——删掉的模板若是默认，默认回落到内置）。
//
// 模板正文是 Markdown，第一行若写 `# 标题`，提交时就是任务标题（与 md-parse
// 的 titleFromMd 约定一致）。内置正文刻意与前端 md-parse 的 NEW_TEMPLATE 保持
// 同构——那是 API 不可达时（版本偏差）前端的兜底，两边谁先改都不破坏行为。
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { APP_DIR } from '../../core/paths.js';
import { badInput, notFound } from '../../core/errors.js';

export const BUILTIN_ID = 'default';

// 与前端 md-parse.js 的 NEW_TEMPLATE 保持同构（见文件头注释）
const BUILTIN_BODY = `## 背景

（一句话说清要改什么）

## 验收
- [ ] …

## 约束
- …

## 附件
`;

const builtin = () => ({ id: BUILTIN_ID, name: '默认模板', body: BUILTIN_BODY, builtin: true });

export function storePath() {
  return process.env.NX_KV_TEMPLATES_STORE || join(APP_DIR, 'templates.json');
}

function emptyStore() {
  return { version: 1, defaultId: BUILTIN_ID, templates: [builtin()] };
}

async function loadStore() {
  try {
    const raw = await fsp.readFile(storePath(), 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.templates)) return emptyStore();
    // 内置模板永远在场（被旧版本 store 漏掉时补回）；builtin 标记以代码为准
    const templates = data.templates.filter((t) => t && t.id && !t.builtin);
    templates.unshift(builtin());
    let defaultId = typeof data.defaultId === 'string' ? data.defaultId : BUILTIN_ID;
    if (!templates.some((t) => t.id === defaultId)) defaultId = BUILTIN_ID;
    return { version: 1, defaultId, templates };
  } catch {
    return emptyStore(); // 缺失/损坏 → 出厂态（内置模板兜底，用户数据无则可丢）
  }
}

// 落盘：tmp + 原子 rename + Windows 锁退避（与 localtask saveStore 同一套语义）。
// 同进程串行队列：连续两次「新增」不会互相踩 tmp 文件。
let saveQueue = Promise.resolve();
function saveStore(data) {
  const run = saveQueue.then(async () => {
    const p = storePath();
    await fsp.mkdir(dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    for (let i = 0; ; i++) {
      try {
        await fsp.rename(tmp, p);
        return;
      } catch (err) {
        if (i >= 4 || (err.code !== 'EPERM' && err.code !== 'EACCES')) throw err;
        await new Promise((r) => setTimeout(r, 25 * (i + 1)));
      }
    }
  });
  saveQueue = run.catch(() => {
    /* 失败不阻断后续排队者；本次调用的 rejection 仍返回给调用方 */
  });
  return run;
}

/** 列表视图：templates + defaultId（面板「新建页」按 defaultId 取起始正文） */
export async function listTemplates() {
  const store = await loadStore();
  return { defaultId: store.defaultId, templates: store.templates };
}

function normalizeName(raw) {
  const name = String(raw || '').trim();
  if (!name) throw badInput('需要模板名 <name>');
  return name.slice(0, 60);
}

function normalizeBody(raw) {
  const body = String(raw ?? '');
  return body.trim() ? body : BUILTIN_BODY; // 空正文 → 给内置骨架，别存一个空页
}

/**
 * 解析模板正文来源：--body 给字面量；--body-file 给文件路径；`-` 表示读标准输入。
 * 优先级：body > bodyFile（body 给了就不读文件）。
 *
 * 为什么需要文件/管道：模板正文是多行 Markdown——在 cmd.exe 里往参数里塞换行极难，
 * 「编辑器里写好 → `template add 名称 --body-file 模板.md`」才是能用的姿势。
 * 只给 CLI 用（HTTP 不暴露读文件，见 action 的 transport 分流）。
 */
async function resolveBody({ body, bodyFile } = {}) {
  const lit = body == null ? '' : String(body);
  const p = bodyFile == null ? '' : String(bodyFile).trim();
  // `-` 是「读标准输入」的哨兵（--body - 与 --body-file - 都认）
  if (lit === '-' || (!lit && p === '-')) {
    try {
      return readFileSync(0, 'utf8');
    } catch (e) {
      throw badInput('读标准输入失败: ' + (e.message || e));
    }
  }
  if (lit !== '') return lit;
  if (!p) return undefined;
  try {
    return await fsp.readFile(p, 'utf8');
  } catch (e) {
    throw badInput(`读模板文件失败: ${p}（${e.code || e.message}）`);
  }
}

/** 新增模板（--set-default 同时设为默认）。幂等性不做：同名允许存在，靠 id 区分。 */
export async function addTemplate({ name: rawName, body: rawBody, bodyFile, setDefault = false } = {}) {
  const name = normalizeName(rawName);
  const body = normalizeBody(await resolveBody({ body: rawBody, bodyFile }));
  const store = await loadStore();
  const t = { id: 't_' + crypto.randomBytes(5).toString('hex'), name, body };
  store.templates.push(t);
  if (setDefault) store.defaultId = t.id;
  await saveStore(store);
  return { status: 'ok', template: t, defaultId: store.defaultId };
}

/** 删除模板。内置模板不可删（它是「删光后」的兜底）；删默认则默认回落到内置。 */
export async function removeTemplate({ id } = {}) {
  const want = String(id || '').trim();
  if (!want) throw badInput('需要模板 id');
  if (want === BUILTIN_ID) throw badInput('内置默认模板不可删除（可新增自己的模板并设为默认）');
  const store = await loadStore();
  const idx = store.templates.findIndex((t) => t.id === want);
  if (idx < 0) throw notFound(`没有 id 为 ${want} 的模板（template list 可查）`);
  const [removed] = store.templates.splice(idx, 1);
  const wasDefault = store.defaultId === want;
  if (wasDefault) store.defaultId = BUILTIN_ID;
  await saveStore(store);
  return { status: 'ok', removed, wasDefault, defaultId: store.defaultId };
}

/** 编辑模板（改名 / 改正文；只改传入的字段）。内置模板不可编辑——它是「删光后」的兜底。 */
export async function updateTemplate({ id, name: rawName, body: rawBody, bodyFile } = {}) {
  const want = String(id || '').trim();
  if (!want) throw badInput('需要模板 id');
  if (want === BUILTIN_ID) throw badInput('内置默认模板不可编辑（可新增自己的模板并设为默认）');
  const store = await loadStore();
  const t = store.templates.find((x) => x.id === want);
  if (!t) throw notFound(`没有 id 为 ${want} 的模板（template list 可查）`);
  if (rawName !== undefined) t.name = normalizeName(rawName);
  if (rawBody !== undefined || bodyFile) {
    t.body = normalizeBody(await resolveBody({ body: rawBody, bodyFile }));
  }
  await saveStore(store);
  return { status: 'ok', template: t };
}

/** 设默认模板：新建页的起始正文换成它。 */
export async function setDefaultTemplate({ id } = {}) {
  const want = String(id || '').trim();
  if (!want) throw badInput('需要模板 id');
  const store = await loadStore();
  const t = store.templates.find((x) => x.id === want);
  if (!t) throw notFound(`没有 id 为 ${want} 的模板（template list 可查）`);
  store.defaultId = want;
  await saveStore(store);
  return { status: 'ok', defaultId: store.defaultId, template: t };
}
