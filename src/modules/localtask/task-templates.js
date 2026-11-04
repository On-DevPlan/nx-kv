// （#54 自 service.js 拆出）交付「收尾指令」模板与 ack 总结提示词的字段钳制：
// settings.taskSuffix / settings.ackPrompt 的存储形态、条数/长度上限与缺省值都在这里。
// wait 交付任务时的「收尾指令」**模板**（CLI/HTTP 可改；置空关闭）。
// 含 {{ 标记 → 模板：wait 返回时渲染成融合指令（goal 状态 + 收尾要求）放进返回载荷的
// instruction 字段，task.text 保持库存原文；不含 {{ 的纯文本 → v0.x 行为不变（追加到
// task.text 末尾）。作用不变：从每条任务层面反复强调「计划最后再 wait 一次」，防漂移。
// 占位符清单见 core/instruction-template.js；渲染是服务端确定性替换，goal.prompt 原文逐字嵌入。
export const DEFAULT_TASK_SUFFIX =
  '{{#goal}}〔时间目标「{{goal.name}}」{{goal.remainingHuman}}〕{{/goal}}' +
  '规划计划，然后完成这个任务；计划的最后一个动作，是再次调用 ' +
  'nx-kv localtask wait（带上 --cwd 当前工作目录、--summary 当前现状、--json）收尾本轮，' +
  '在拿到下一条任务或超时之前不要提前结束。';
const MAX_SUFFIX_LEN = 2000; // 收尾指令模板长度上限（单条本体；渲染产物不设限）
const MAX_SUFFIX_ENTRIES = 10; // 收尾指令条数上限（多条按空行拼接后统一分流渲染）

// 归一化收尾追加语（单条）：缺省（旧 store 无此字段）→ 默认；显式传 ''（清空）→ '' 表示关闭。
// 注意：与 timeoutSec 不同——timeoutSec 缺省→推荐值（仍开启），taskSuffix 缺省→默认文本。
// 因此从老 store 读 settings.taskSuffix 时，clampTaskSuffix 会自动补默认；想"关闭"必须显式 ''。
export function clampTaskSuffix(v) {
  if (v === undefined || v === null) return DEFAULT_TASK_SUFFIX;
  let s = String(v).trim();
  if (s.length > MAX_SUFFIX_LEN) s = s.slice(0, MAX_SUFFIX_LEN);
  return s;
}

// 归一化收尾指令**列表**（settings.taskSuffix 的存储形态，v0.14 起多条）。
// 接受 string（旧模型单条，整体算一条、不拆段）或 string[]（多条）；逐条 trim、
// 空条丢弃、单条超长截断（同 clampTaskSuffix）、条数超上限截断。
// 缺省 → [默认模板]；显式 '' / [] → [] 表示关闭。
export function clampTaskSuffixList(v) {
  if (v === undefined || v === null) return [DEFAULT_TASK_SUFFIX];
  const raw = Array.isArray(v) ? v : [v];
  const list = [];
  for (const item of raw) {
    let s = String(item ?? '').trim();
    if (!s) continue;
    if (s.length > MAX_SUFFIX_LEN) s = s.slice(0, MAX_SUFFIX_LEN);
    list.push(s);
    if (list.length >= MAX_SUFFIX_ENTRIES) break;
  }
  return list;
}

// 交付侧取用：多条按空行拼接成单个模板串，之后的分流逻辑（含 {{ → instruction，
// 纯文本 → 追加正文）与单条时代完全一致——任一条含 {{ 即整体走模板渲染。
export function joinTaskSuffix(v) {
  return clampTaskSuffixList(v).join('\n\n');
}
// ─── ack 完成总结提示词（settings.ackPrompt）─────────────────────────
//
// agent 完成任务时写的**完成总结（ack）**该按什么格式——这本来是各处硬写的
// 口径，现在收进设置里：与 taskSuffix 同款多条列表、同款占位符语法
// （core/instruction-template.js），多条按空行拼成一段，随领取交付的
// instruction 一起给到 agent。
//
// 与 taskSuffix 的两点不同：
//   1. **缺省为空**（taskSuffix 缺省有内置默认）——没配置就不往交付里追加
//      任何东西，默认交付逐字不变。
//   2. 它不是「收尾指令」，是「总结格式要求」——所以不拼进 task.text，只进
//      instruction 字段。
export function clampAckPromptList(v) {
  if (v === undefined || v === null) return [];
  const raw = Array.isArray(v) ? v : [v];
  const list = [];
  for (const item of raw) {
    let s = String(item ?? '').trim();
    if (!s) continue;
    if (s.length > MAX_SUFFIX_LEN) s = s.slice(0, MAX_SUFFIX_LEN);
    list.push(s);
    if (list.length >= MAX_SUFFIX_ENTRIES) break;
  }
  return list;
}

export function joinAckPrompt(v) {
  return clampAckPromptList(v).join('\n\n');
}
