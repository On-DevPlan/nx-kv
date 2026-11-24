// 参数填写页 → 任务编辑器的一次性意图（#151）。
//
// 「直接提交」按钮需要：参数页渲染出纯文本草稿 → 开任务页 → 任务页自动触发提交
// 落库为待领取任务。App.openPage 的 config 只认 {dirKey|groupId, task}，多带字段
// 会被丢掉（路由反向映射也只认这套键），所以不往 config 里塞 autoSubmit 标志，
// 改用一个以 docId 为键的一次性 intent：参数页 set，任务页 mount 时 take（取后即删）。
// StrictMode 双跑 / 重复挂载都只会消费一次。
export interface TaskIntent {
  /** 进页后自动触发 submit() 落库为待领取任务 */
  submit?: boolean;
}

const pending = new Map<string, TaskIntent>();

const keyOf = (id: unknown): string => String(id || '');

export function setTaskIntent(id: unknown, intent: TaskIntent): void {
  const k = keyOf(id);
  if (k) pending.set(k, { ...intent });
}

/** 取走并清除（同一 docId 只消费一次）。 */
export function takeTaskIntent(id: unknown): TaskIntent | undefined {
  const k = keyOf(id);
  if (!k) return undefined;
  const v = pending.get(k);
  if (v) pending.delete(k);
  return v;
}
