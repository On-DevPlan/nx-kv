// 任务正文的内联渲染：把类 markdown 的附件嵌入画出来。
//
// 只认一件事：`![说明](fileId)` 与 `[文件名](fileId)`（解析在 ./attach.js，
// 与 Node 侧**同一份实现**）。其余 markdown 一律按纯文本呈现 —— 面板不是
// markdown 渲染器，多解析一种语法就多一类「预览与真实内容不一致」的坑。
//
// 图片走 /api/file/content/<id>：本机服务代理后端出图，于是
//   1. 浏览器不需要直连后端（不受 CORS / 内网地址 / 混合内容影响）；
//   2. 预览与 CLI 下载走的是同一条后端路由，权限行为必然一致。
import { parseEmbeds } from './attach.js';

const contentUrl = (id) => `/api/file/content/${encodeURIComponent(id)}`;

/** 这段文字里有没有嵌入（用于决定要不要渲染富文本） */
export function hasEmbeds(text) {
  return parseEmbeds(text).some((s) => s.type !== 'text');
}

export function AttachmentText({ text, compact = false, className = '' }) {
  const segs = parseEmbeds(text);
  // 没有嵌入就走「零包装」路径：字符串原样渲染，避免给每条普通任务都套一层 span
  if (!segs.some((s) => s.type !== 'text')) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className ? `mdtext ${className}` : 'mdtext'}>
      {segs.map((seg, i) => {
        if (seg.type === 'text') return <span key={i} className="mdtext-plain">{seg.value}</span>;
        const href = contentUrl(seg.id);
        if (seg.type === 'image') {
          return (
            <a
              key={i}
              className={'embed-image' + (compact ? ' compact' : '')}
              href={href}
              target="_blank"
              rel="noreferrer"
              title={seg.alt ? `${seg.alt}（点击看原图）` : seg.id}
            >
              <img src={href} alt={seg.alt || seg.id} loading="lazy" />
            </a>
          );
        }
        return (
          <a key={i} className="embed-file" href={href} target="_blank" rel="noreferrer" title={seg.id}>
            {seg.alt || seg.id}
          </a>
        );
      })}
    </span>
  );
}
