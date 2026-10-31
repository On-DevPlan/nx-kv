// 内联 SVG 图标集（ft-svg 规范：24 网格 / 线宽 1.8 / round 端点 / currentColor）。
// 无原生 emoji；激活态与主题跟随 currentColor。尺寸由 CSS 类控制（.ic 14px 基准）。
const P = (d) => <path d={d} />;

const ICONS = {
  folder: (
    <>
      <path d="M3.5 6.5c0-1.1.9-2 2-2h4l2 2.5h7c1.1 0 2 .9 2 2v8.5c0 1.1-.9 2-2 2h-13c-1.1 0-2-.9-2-2z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.6 2.3 4 5.2 4 8.5s-1.4 6.2-4 8.5c-2.6-2.3-4-5.2-4-8.5s1.4-6.2 4-8.5z" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20.2 20.2-4.5-4.5" />
    </>
  ),
  plus: P('M12 5v14M5 12h14'),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.4 9.3a2.7 2.7 0 1 1 3.6 2.5c-.7.4-1 .9-1 1.7" />
      <path d="M12 16.6v.2" />
    </>
  ),
  back: P('M14.5 5.5 8 12l6.5 6.5'),
  chevron: P('m9 6 6 6-6 6'),
  /** 侧栏展开 / 布局示意：左轨 + 面板 */
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 3.8v4.4h-4.4" />
    </>
  ),
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="12" rx="1.8" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  cloud: P('M7 18.5a4.2 4.2 0 0 1-.4-8.4 5.6 5.6 0 0 1 10.9 1.2 3.6 3.6 0 0 1-.6 7.2z'),
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4.5" rx="1" />
      <path d="M5.5 9v9c0 .8.7 1.5 1.5 1.5h10c.8 0 1.5-.7 1.5-1.5V9M10 13h4" />
    </>
  ),
  check: P('m5 12.5 4.5 4.5L19 7.5'),
  trash: (
    <>
      <path d="M4.5 6.5h15M9.5 6V4.5c0-.6.4-1 1-1h3c.6 0 1 .4 1 1V6M6.5 6.5l.8 12c.1.9.8 1.5 1.7 1.5h6c.9 0 1.6-.6 1.7-1.5l.8-12" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9" rx="1.8" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  warn: (
    <>
      <path d="M12 3.8 21.2 20H2.8z" />
      <path d="M12 10v4.2M12 17.2v.4" />
    </>
  ),
  list: P('M8.5 6h12M8.5 12h12M8.5 18h12M4 6h.5M4 12h.5M4 18h.5'),
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  dots: (
    <>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.4 2" />
    </>
  ),
  send: P('M4 12 20 4l-4 16-4.5-6.5z'),
  repo: (
    <>
      <path d="M4.5 5.5c0-1.1.9-2 2-2h13v15h-13c-1.1 0-2 .7-2 1.8z" />
      <path d="M4.5 20.3c0-1.1.9-1.8 2-1.8h13" />
    </>
  ),
  jump: P('M6 18 18 6M9 6h9v9'),
  x: P('M6 6l12 12M18 6 6 18'),
  pin: P('M12 21v-7M7.5 4h9l-1.2 6.5c1 .8 1.7 2 1.7 3.5h-11c0-1.5.7-2.7 1.7-3.5z'),
  edit: P('M4 20h16M13.5 4.5l4 4L8 18H4v-4z'),
  flow: P('M4 7h6M14 7h6M4 17h6M14 17h6M10 7a4 4 0 0 0 4 4M14 13a4 4 0 0 0-4 4'),
};

export function Icon({ name, size = 14, className = '', title }) {
  const glyph = ICONS[name];
  if (!glyph) return null;
  return (
    <svg
      className={'ic' + (className ? ' ' + className : '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  );
}
