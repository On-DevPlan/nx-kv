// 仓库管理页的图标集（#143）：一律内联 SVG，不引图标库。
//
// 口径：24×24 viewBox、`stroke="currentColor"`、线宽 1.6、圆角端点——
// 这样颜色跟着文字走（主题切换不用改 SVG），尺寸靠 CSS 的 width/height 控制。
// 图标只表达「这是哪一类东西」，不做装饰：分支 ⑂ / 仓库 ◈ / 参考仓库 ⑃ / 文档 ▤。
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 15, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 分支（组）：一条主干 + 一条分出又并回的分支。 */
export function IconBranch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="6" cy="19" r="2.2" />
      <circle cx="18" cy="12" r="2.2" />
      <path d="M6 7.2v9.6" />
      <path d="M6 12h6.6a2 2 0 0 1 2 2v-4a2 2 0 0 1 2-2" />
    </Svg>
  );
}

/** 仓库（开发仓库）：一个盒子。 */
export function IconRepo(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" />
      <path d="M4 8.5 12 13l8-4.5" />
      <path d="M12 13v7" />
    </Svg>
  );
}

/** 参考仓库：盒子 + 指向它的箭头（「拿来看的」）。 */
export function IconRefRepo(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 9 10 5.4l6.5 3.6v5.6L10 18.2 3.5 14.6z" />
      <path d="M3.5 9 10 12.8 16.5 9" />
      <path d="M10 12.8v5.4" />
      <path d="M15.5 17.5h5" />
      <path d="M18.4 15.4 20.5 17.5l-2.1 2.1" />
    </Svg>
  );
}

/** 文档：一张带折角的纸。 */
export function IconDoc(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3.5h7.2L18 8.3V20.5H6z" />
      <path d="M13 3.5v5h5" />
      <path d="M8.8 12.6h6.4M8.8 16.2h4.4" />
    </Svg>
  );
}

/** 文档集（多篇）：一叠纸。 */
export function IconDocs(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 6.5h9.5V21H8z" />
      <path d="M5.5 17.5V3.5h9" />
      <path d="M10.6 11h4.3M10.6 14.6h3" />
    </Svg>
  );
}

/** 搜索。 */
export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.8" cy="10.8" r="6" />
      <path d="m15.3 15.3 4.2 4.2" />
    </Svg>
  );
}

/** 加号。 */
export function IconPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Svg>
  );
}

/** 同步（环形箭头）。 */
export function IconSync(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7" />
      <path d="M19.8 4.4v4.4h-4.4" />
    </Svg>
  );
}

/** 在外部打开（文件管理器 / 文档页）。 */
export function IconOpen(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13.5 4.5H20v6.5" />
      <path d="M20 4.5 11.5 13" />
      <path d="M17 14.5V20H4V7h5.5" />
    </Svg>
  );
}

/** 展开 / 收起（下拉箭头）。 */
export function IconChevron(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m7 10 5 5 5-5" />
    </Svg>
  );
}

/** 勾选（当前分支）。 */
export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m5 12.5 4.6 4.5L19 7" />
    </Svg>
  );
}

/** 关闭。 */
export function IconX(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Svg>
  );
}

/** 成员（人）。 */
export function IconUsers(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.6 19.6c.6-3 3-4.6 5.9-4.6s5.3 1.6 5.9 4.6" />
      <path d="M16 5.6a3 3 0 0 1 0 5.9" />
      <path d="M17.4 15.3c2 .5 3.3 2 3.7 4.3" />
    </Svg>
  );
}

/** 文件夹。 */
export function IconFolder(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 6.5h5l1.8 2.2h10.2V19H3.5z" />
    </Svg>
  );
}

/** 摘除 / 删除（减号放在盒子里：语义是「只摘绑定」）。 */
export function IconUnlink(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.5 14.5 8 16a3.5 3.5 0 0 1-5-5l2.2-2.2" />
      <path d="M14.5 9.5 16 8a3.5 3.5 0 0 1 5 5l-2.2 2.2" />
      <path d="M9.8 14.2 14.2 9.8" />
    </Svg>
  );
}

/** 概览（main 分支）：网格。 */
export function IconGrid(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.6" y="3.6" width="7" height="7" rx="1.4" />
      <rect x="13.4" y="3.6" width="7" height="7" rx="1.4" />
      <rect x="3.6" y="13.4" width="7" height="7" rx="1.4" />
      <rect x="13.4" y="13.4" width="7" height="7" rx="1.4" />
    </Svg>
  );
}

/** 编辑（铅笔）。 */
export function IconEdit(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 19.5h3.2l9.6-9.6a2.1 2.1 0 0 0 0-3l-1.7-1.7a2.1 2.1 0 0 0-3 0L3 14.8z" />
      <path d="m13.4 6.6 4 4" />
    </Svg>
  );
}

/** 删除（垃圾桶）。 */
export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.8h5V7" />
      <path d="M6.4 7l1 12.2h9.2L17.6 7" />
      <path d="M10.2 10.6v6M13.8 10.6v6" />
    </Svg>
  );
}

/** 绑定 / 链接。 */
export function IconLink(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1L11.6 7.3" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" />
    </Svg>
  );
}
