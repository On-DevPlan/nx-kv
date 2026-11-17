// 「按模板新建任务」的统一入口（#151）：模板正文里有 {{槽位}} 时先去参数填写
// 中间页，否则直接走原来的纯文本草稿路径。目录页与组页共用这一层，避免两版
// 下拉又漂移（用户明确要求「以 repo 那个为准」）。
import { putFillSession, type FillSession } from './fill-session.js';
import { templateSlots } from '../prompts/template-preview.js';

interface NavApp {
  onNavigate?: (hash: string) => void;
}

/** 含有槽位 → 已转向参数页并返回 true；无槽位 → 调用方继续原来的新建路径。 */
export function startFillIfSlotted(
  tpl: { id?: string; body?: unknown } | null | undefined,
  ctx: Omit<FillSession, 'templateId'>,
  app: NavApp,
): boolean {
  const slots = templateSlots(tpl?.body);
  if (!slots.length || !tpl?.id) return false;
  const sessionId = putFillSession({ ...ctx, templateId: String(tpl.id) });
  app.onNavigate?.(`#/templates/fill/${sessionId}`);
  return true;
}
