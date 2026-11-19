// SVG 资产库 · 数据类型与图元构造器（纯数据，无 React 依赖）。
//
// 口径（与 nx-kv 既有图标规范一致）：
//   24×24 网格 / fill=none / stroke=currentColor / round 端点 —— 颜色跟文字走，
//   尺寸由调用方给（默认 14，侧栏 15，资产库大图 64）。
//
// 图元只收三种：描边路径 p、填充路径 f、圆 c、矩形 r。够表达现有全部图标，
// 也让资产可以直接序列化成独立 .svg 文件（见 serialize.ts）——「一份资产，
// 多处复用」的前提是它不是 React 节点，而是可读可导的数据。

/** 资产分类（资产库页的分类筛选与目录分组用）。 */
export type SvgGroupId = 'nav' | 'repo' | 'doc' | 'state' | 'act';

/** 单个图元。坐标一律 24 网格内。 */
export type SvgEl =
  /** 描边路径（d） */
  | { p: string }
  /** 填充路径（用 currentColor 填，端点已画死，不再套描边） */
  | { f: string }
  /** 圆：cx / cy / r；fill=true 时是实心点 */
  | { c: [number, number, number]; fill?: boolean }
  /** 矩形：x / y / w / h / rx */
  | { r: [number, number, number, number, number?]; fill?: boolean };

/** 一份 SVG 资产。name 是调用键，也是资产库里的检索键。 */
export interface SvgAsset {
  /** 资产名（全库唯一；调用方按字符串引用，例如 <Icon name="repo" />） */
  name: string;
  /** 中文名（资产库列表、title 提示用） */
  label: string;
  /** 分类 */
  group: SvgGroupId;
  /** 图形本体 */
  els: SvgEl[];
  /** 检索词（英文别名 / 同义词 / 拼音），资产库搜索用 */
  keys?: string[];
  /** 挂载点说明：这个资产在界面上的实际位置（空 = 已收进库、尚未挂载） */
  where?: string;
  /** 线宽覆盖（默认 1.8；个别需要更细的图标给 1.6） */
  w?: number;
  /** 默认尺寸覆盖（默认 14） */
  size?: number;
}

/** 分类元信息：资产库的分类条与目录树共用。 */
export interface SvgGroupMeta {
  id: SvgGroupId;
  label: string;
  hint: string;
}

export const SVG_GROUPS: SvgGroupMeta[] = [
  { id: 'nav', label: '外壳与导航', hint: '侧栏、面板、地址与展开折叠' },
  { id: 'repo', label: '仓库与组', hint: '开发仓库 / 参考仓库 / 项目组（分支）' },
  { id: 'doc', label: '文档与任务', hint: '文档、任务、模板与编排' },
  { id: 'state', label: '状态与提示', hint: '完成 / 等待 / 警示 / 锁定' },
  { id: 'act', label: '操作', hint: '增删改、复制、导出、检索' },
];

/** 描边路径 */
export const p = (d: string): SvgEl => ({ p: d });
/** 填充路径（多用于小圆点、实心符号） */
export const f = (d: string): SvgEl => ({ f: d });
/** 圆 */
export const c = (cx: number, cy: number, r: number, fill = false): SvgEl => ({ c: [cx, cy, r], fill });
/** 矩形 */
export const r = (x: number, y: number, w: number, h: number, rx?: number): SvgEl => ({ r: [x, y, w, h, rx] });
