// 路由页声明：把模板（server-cli-web）的 `routes/<名>.ts` + `definePage` 约定，
// 落成「hash 视图 ↔ 面板」的**一张表**。
//
// 为什么要有这一层：原来是 route-map 里两段手写 switch（两个方向各写一遍），
// 「config 与地址必须逐字互逆」这条恒等式只能写在注释里——加一种页面得在四处改，
// 任一处漏改就裂面板（任务 #86 的真实故障）。现在一个视图一个文件、双向映射同文件
// 相邻书写，加一个页面 = 加一个文件 + 在 routes/index.ts 登记一行。
//
// 与模板的差异：模板用 react-router 的 `path` 做声明式路由；这里保留 FlexLayout
// 工作台与 hash 路由，所以 `view`（hash 一级段）就是声明键，不引入 react-router。
import type { AppRoute, PanelConfig, SpecCtx } from '../types.js';

/** 面板落点：`component` 是 panels.tsx 注册表里的键，`config` 是面板自己的 JSON。 */
export interface RoutePanel {
  component: string;
  config: PanelConfig;
}

/** 反向映射的返回：undefined = 这块面板不归本视图；null = 归本视图但**有意**不改地址。 */
export type ReverseResult = string | null | undefined;

export interface RouteReverse {
  /** panels.tsx 里的 component 名 */
  component: string;
  /** 同一个 component 被多个视图写回时，数字小的先试（组锚定页比目录页更具体） */
  order?: number;
  /** 面板 config（FlexLayout 节点里的 JSON，外部边界）→ hash */
  format: (cfg: Record<string, any>) => ReverseResult;
}

export interface RoutePage {
  /** hash 一级视图名（`#/<view>/…`），也是查表键 */
  view: string;
  /** 路由 → 面板 + 页签名；null = 这条路由不开面板 */
  panelOf: (route: AppRoute, ctx: SpecCtx) => { panel: RoutePanel; name: string } | null;
  /** 该视图负责写回的 component：一个视图可能写回多种分量（dir 的 page / dir） */
  reverse?: RouteReverse[];
}

/** 声明式登记：只做类型收敛，不加任何运行时行为（与模板同名约定同义）。 */
export function definePage(def: RoutePage): RoutePage {
  return def;
}
