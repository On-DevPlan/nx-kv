// templates 模块的辅助函数/常量（legacy 形态里与 action 表同文件，迁来时一并搬到这里）。
//
// 参数与返回值暂用宽松类型（迁移期），服务层类型化推进时逐个收紧。
import { topicKeyOf } from '../../core/topic-key.js';
import { resolve as resolvePath } from 'node:path';
import { badInput } from '../../core/errors.js';

export const renderList: any = (d: any) => {
  const lines: any = [`模板 ${d.templates.length} 个（默认: ${d.defaultId}）`];
  for (const t of d.templates) {
    const head: any = String(t.body || '').split('\n').find((l: any) => l.trim()) || '（空）';
    const scopeMark: any = d.scoped
      ? `  · ${t.perm && t.perm.edit ? '本主题可编辑' : '仅可用'}`
      : '';
    lines.push(`  ${t.id === d.defaultId ? '★' : ' '} ${t.id}${t.builtin ? ' [内置]' : ''}  ${t.name}  ·  ${head.trim().slice(0, 40)}${scopeMark}`);
  }
  return lines.join('\n');
};

export function parseScope(raw: any) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') return raw;
  const s: any = raw.trim();
  if (!s) return undefined;
  if (s.startsWith('[')) return s; // JSON 数组
  return s.split(',').map((x: any) => x.trim()).filter(Boolean);
}

export function topicFromCwd(raw: any) {
  const s: any = String(raw || '').trim();
  if (!s) return undefined;
  return topicKeyOf(resolvePath(s), '');
}

export function parseValues(raw: any) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'object') return raw;
  const s: any = String(raw).trim();
  if (!s) return undefined;
  try {
    const v: any = JSON.parse(s);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('不是对象');
    return v;
  } catch (e: any) {
    throw badInput(`--values 要传 JSON 对象（形如 {"背景":"要做的事"}）：${e.message || e}`);
  }
}
