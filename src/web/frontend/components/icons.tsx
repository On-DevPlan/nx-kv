// 内联 SVG 图标集（对外接口不变）——图形定义已于本轮迁进 svghub 资产库。
//
// 为什么留这个文件：全仓 30+ 个文件从 `components/icons.jsx` 取 `Icon`，接口
// `<Icon name="…" size={…} />` 是稳定契约。资产库换了存放方式（从 JSX 表换成
// 可序列化的数据），调用点一个都不用改——这正是「统一管理 + 多路复用」的落点。
//
// 新增图标请改 svghub/catalog-*.ts，不要在这里加分支。
export { Icon } from '../svghub/icon.jsx';
export type { IconProps } from '../svghub/icon.jsx';
