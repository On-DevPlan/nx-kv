// 仓库管理页的图标集（#143）——图形本体已迁进 svghub 资产库。
//
// 这里只保留**组件名**：仓库页里图标是按组件用的（<IconRepo size={14} />），
// 名字承载语义（branch / repo / refRepo / doc / docs）。组件名 → 资产名的映射
// 见下；改形状去 svghub/catalog-*.ts，改语义名才动这里。
//
// 视觉口径随资产库统一：24×24、currentColor、线宽 1.8（原先这里是 1.6，
// 两套线宽并存在同一页会让图标看起来「一深一浅」）。
import { glyph } from '../../svghub/icon.jsx';

/** 分支（项目组） */
export const IconBranch = glyph('board');
/** 开发仓库 */
export const IconRepo = glyph('repo');
/** 参考仓库（只读） */
export const IconRefRepo = glyph('repo-ref');
/** 文档 */
export const IconDoc = glyph('doc');
/** 文档集 */
export const IconDocs = glyph('docs');
/** 检索 */
export const IconSearch = glyph('search');
/** 新增 */
export const IconPlus = glyph('plus');
/** 刷新 / 同步（资产库里的名字是 refresh，sync 是同一颗图形） */
export const IconSync = glyph('refresh');
/** 外部打开 */
export const IconOpen = glyph('open');
/** 下拉箭头（与侧栏的右向 chevron 不是同一颗，别混） */
export const IconChevron = glyph('chevron-down');
/** 选中 */
export const IconCheck = glyph('check');
/** 关闭 */
export const IconX = glyph('x');
/** 成员 */
export const IconUsers = glyph('users');
/** 目录 */
export const IconFolder = glyph('folder');
/** 摘除绑定 */
export const IconUnlink = glyph('unlink');
/** 概览（网格） */
export const IconGrid = glyph('overview');
/** 编辑 */
export const IconEdit = glyph('edit');
/** 删除 */
export const IconTrash = glyph('trash');
/** 绑定 / 链接 */
export const IconLink = glyph('link');
