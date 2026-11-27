// 外部段来源（gettask 插件区块）：promptplug 只认声明，不认识插件宿主。
//
// 为什么要有这一层：设置页的注册表 / 模板保存校验 / segmentTemplates 都要知道
// 「除内置段之外还有哪些段」。让 promptplug import plugin 会把提示词域绑死到
// 插件实现上（也违反「promptplug 不 import 其他模块」的设计）。所以由插件宿主在
// 自己的入口把声明**注册进来**，promptplug 只读这份纯数据。
//
// 声明是同步可缓存的纯结构；来源允许异步（宿主加载插件包是异步的）。任何失败都
// 按「没有外部段」处理——设置页 / 装配绝不能因为某个插件坏掉而整体不可用。
import type { FieldDecl } from '../../shared/prompt-plugin.js';

/** 一个外部段的声明面（与 PluginUIDescriptor 同形，仅 group 固定 gettask）。 */
export interface ExternalSegmentDecl {
  /** 段 id（`plugin:<pluginId>:<localId>`，即模板存储键与设置页的段标识） */
  id: string;
  group: 'gettask';
  /** 设置页展示顺序（全局唯一） */
  order: number;
  /** XML 标签（`nxkv.plugin.<pluginId>.<tag>`） */
  tag: string;
  label: string;
  description?: string;
  /** 出厂模板正文（用户覆盖存 template-store） */
  template: string;
  /** 模板可见变量（不含 seed；装配时会自动补 task.id / task.text） */
  fields: FieldDecl[];
}

export type ExternalSegmentSource = () => ExternalSegmentDecl[] | Promise<ExternalSegmentDecl[]>;

let source: ExternalSegmentSource | null = null;

/** 插件宿主注册 / 注销外部段来源（传 null 清空，测试用）。 */
export function registerExternalSegments(next: ExternalSegmentSource | null): void {
  source = next;
}

/** 当前全部外部段（来源缺失 / 抛错 → 空数组）。 */
export async function externalSegments(): Promise<ExternalSegmentDecl[]> {
  if (!source) return [];
  try {
    const list = await source();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 按段 id 取一条外部段声明（未知 → null）。 */
export async function externalSegmentOf(id: string): Promise<ExternalSegmentDecl | null> {
  const want = String(id || '');
  if (!want) return null;
  const list = await externalSegments();
  return list.find((s) => s.id === want) || null;
}
