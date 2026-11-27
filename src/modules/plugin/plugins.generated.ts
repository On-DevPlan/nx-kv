// AUTO-GENERATED —— 由 scripts/gen-plugins.mjs 生成，勿手改。
//
// 内置插件：只列包名与**相对包根**的目录；宿主按目录解析 package.json 的 nxkv 产物。
export interface PluginPackageRef {
  /** 包名（展示 / 门禁校验用；运行时不走 node_modules 解析） */
  name: string;
  /** 相对包根的插件目录（dev 与发布包同一布局：packages/<目录>） */
  dir: string;
}

export const PLUGIN_PACKAGES: readonly PluginPackageRef[] = [
  { name: "@nx-kv/plugin-dir-annotate", dir: "packages/plugin-dir-annotate" },
  { name: "@nx-kv/plugin-task-template", dir: "packages/plugin-task-template" },
];
