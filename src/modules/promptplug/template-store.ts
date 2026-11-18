// 段模板的用户数据（#161）：每段可有多条模板，启用哪条自己挑。
//
// 真相仍是插件类里的 `templates`（出厂内置，代码即真相）；这里只存**用户层**：
//   - items：用户添加/复制的模板条目（builtin 永远在插件类里，不落盘）
//   - activeId：该段当前启用的模板（'builtin' 或用户条目 id）
//
// 为什么 JSON 而不是 DB：段模板是**显示态偏好**（跟侧边栏 prefs 同级），不是
// 业务数据——换库不迁移、跨机器不同步都可接受；JSON 一个文件看得见摸得着。
// localStorage 缺席的是浏览器端；这是宿主端文件，用 APP_DIR 落盘。
//
// 并发：单进程 serve 读写足够；写入走临时文件 + rename 原子替换。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR } from '../../core/paths.js';
import type { TemplateText } from './base.js';

const FILE = join(APP_DIR, 'promptplug-templates.json');

export interface UserTemplate extends TemplateText {
  /** 创建时间（epoch ms；排序/展示用） */
  createdAt: number;
}

/** 某一段的用户层模板数据。 */
export interface SegmentTemplates {
  /** 当前启用的模板 id（'builtin' = 出厂第一条；缺省 = builtin） */
  activeId: string;
  /** 用户条目（出厂 builtin 不在内） */
  items: UserTemplate[];
}

const DEFAULT_SEGMENT: SegmentTemplates = { activeId: 'builtin', items: [] };

type Store = Record<string, SegmentTemplates>;

function readStore(): Store {
  try {
    if (!existsSync(FILE)) return {};
    const raw = JSON.parse(readFileSync(FILE, 'utf8')) as Store;
    if (!raw || typeof raw !== 'object') return {};
    // 外部数据边界：逐段校验后才收（脏段丢掉用默认）
    const out: Store = {};
    for (const [id, seg] of Object.entries(raw)) {
      if (!seg || typeof seg !== 'object') continue;
      const items = Array.isArray((seg as SegmentTemplates).items)
        ? (seg as SegmentTemplates).items.filter(
            (t) => t && typeof t.text === 'string' && typeof t.id === 'string' && t.id !== 'builtin',
          )
        : [];
      out[id] = {
        activeId: typeof (seg as SegmentTemplates).activeId === 'string' ? (seg as SegmentTemplates).activeId : 'builtin',
        items,
      };
    }
    return out;
  } catch {
    return {}; // 损坏不炸宿主：全部回落 builtin
  }
}

function writeStore(store: Store): void {
  try {
    mkdirSync(APP_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    renameSync(tmp, FILE);
  } catch {
    // 落盘失败不炸宿主（只读盘 / 隐私目录等）：本次修改内存可见，重启即失
  }
}

/** 某段的用户层模板数据（无记录 → 默认：启用 builtin、无条目）。 */
export function segmentTemplatesOf(id: string): SegmentTemplates {
  const seg = readStore()[id];
  return seg ? { ...seg, items: [...seg.items] } : { ...DEFAULT_SEGMENT, items: [] };
}

/** 全部段的用户层模板数据（设置页一次拉全）。 */
export function allSegmentTemplates(): Record<string, SegmentTemplates> {
  return readStore();
}

export interface UpsertTemplateInput {
  /** 段（插件 id） */
  segment: string;
  /** 条目 id；缺 = 新建 */
  id?: string;
  name?: string;
  text: string;
}

/** 添加 / 更新一条用户模板；返回该段最新数据。 */
export function upsertTemplate({ segment, id, name, text }: UpsertTemplateInput): SegmentTemplates {
  const store = readStore();
  const seg = store[segment] || { ...DEFAULT_SEGMENT, items: [] };
  const body = String(text ?? '');
  const title = String(name ?? '').trim() || '未命名模板';
  const now = Date.now();
  const key = id && !String(id).startsWith('u_') && id !== 'builtin' ? `u_${id}` : String(id ?? '');
  const hit = key ? seg.items.find((t) => t.id === key) : undefined;
  if (hit) {
    hit.name = title;
    hit.text = body;
    if (seg.activeId === hit.id) seg.activeId = hit.id; // 编辑启用中的模板即时生效
  } else {
    const nid = `u_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    seg.items.push({ id: nid, name: title, text: body, createdAt: now });
    seg.activeId = nid; // 新建即启用（复制后修改的直感）
  }
  store[segment] = seg;
  writeStore(store);
  return { ...seg, items: [...seg.items] };
}

/** 删除一条用户模板；删的是启用条目时回落 builtin。 */
export function deleteTemplate(segment: string, id: string): SegmentTemplates {
  const store = readStore();
  const seg = store[segment];
  if (seg) {
    seg.items = seg.items.filter((t) => t.id !== id);
    if (seg.activeId === id) seg.activeId = 'builtin';
    store[segment] = seg;
    writeStore(store);
  }
  return segmentTemplatesOf(segment);
}

/** 切换某段启用的模板（'builtin' 或用户条目 id；非法 id 静默回落 builtin）。 */
export function activateTemplate(segment: string, id: string): SegmentTemplates {
  const store = readStore();
  const seg = store[segment] || { ...DEFAULT_SEGMENT, items: [] };
  const key = String(id ?? '') || 'builtin';
  seg.activeId = key === 'builtin' || seg.items.some((t) => t.id === key) ? key : 'builtin';
  store[segment] = seg;
  writeStore(store);
  return { ...seg, items: [...seg.items] };
}

/** 某段当前**启用模板的正文**（装配时传给插件构造；builtin → '' 用类内默认）。 */
export function activeTemplateTextOf(id: string): string {
  const seg = readStore()[id];
  if (!seg || seg.activeId === 'builtin') return '';
  const hit = seg.items.find((t) => t.id === seg.activeId);
  return hit ? String(hit.text ?? '') : '';
}
