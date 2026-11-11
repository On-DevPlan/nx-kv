// 附件预览（任务 #71）：图片点击放大 + PDF 内置预览。
//
// 一个**文档级委托监听**覆盖全部渲染面（编辑预览 / 旁路原文 / 弹层 / 组页……），
// 不往每个渲染点接线——md-parse 出来的 `img.md-att-img` / `a.md-att` 是稳定标记：
//   - 点图片 → 灯箱放大（点任意处 / Esc 关闭）；
//   - 点 PDF 附件 → 灯箱内嵌 iframe 预览（浏览器原生 PDF 查看器）+ 下载按钮；
//   - 其它类型（docx/zip/…）维持默认下载，不拦。
// 灯箱是命令式 DOM（非 React state）：预览是纯展示，不参与面板布局与路由，
// state 化只会把「点了张图」抬进 App 的重渲染路径。useEffect 返回卸载函数，测试可清。

declare global {
  interface Window {
    /** 灯箱单例（装一次；卸载时删掉） */
    __mdAttPreview?: { uninstall: () => void };
  }
}

/** 打开灯箱的入参（src 已归一成字符串；kind 区分图片/PDF）。 */
interface LightboxOpenArgs {
  src: string;
  kind: string;
  label?: string;
}

export function installAttachmentPreview(): () => void {
  if (window.__mdAttPreview) return window.__mdAttPreview.uninstall;

  const overlay = document.createElement('div');
  overlay.className = 'md-lightbox';
  overlay.hidden = true;

  const img = document.createElement('img');
  img.className = 'md-lightbox-img';
  img.alt = '';

  const frame = document.createElement('iframe');
  frame.className = 'md-lightbox-frame';
  frame.title = '附件预览';

  const bar = document.createElement('div');
  bar.className = 'md-lightbox-bar';
  const name = document.createElement('span');
  name.className = 'md-lightbox-name';
  const dl = document.createElement('a');
  dl.className = 'md-lightbox-dl';
  dl.textContent = '下载';
  dl.setAttribute('download', '');
  bar.append(name, dl);

  overlay.append(img, frame, bar);

  function open({ src, kind, label }: LightboxOpenArgs) {
    name.textContent = label || '';
    dl.href = src;
    dl.setAttribute('download', label || '');
    dl.hidden = kind !== 'pdf';
    img.hidden = kind !== 'img';
    frame.hidden = kind !== 'pdf';
    if (kind === 'img') img.src = src;
    else frame.src = src;
    overlay.hidden = false;
    document.addEventListener('keydown', onKey);
  }
  function close() {
    overlay.hidden = true;
    img.src = '';
    frame.src = 'about:blank'; // 停掉 PDF 查看器（否则它在后台继续吃内存）
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
  overlay.addEventListener('click', (e) => {
    // 点图片/文档本体不关（PDF 里要点内部控件），点遮罩或关闭区才关
    if (e.target === overlay) close();
  });

  document.addEventListener(
    'click',
    (e) => {
      // DOM 事件边界：target 声明为 EventTarget，点选判定要 Element
      const t = e.target as Element | null;
      if (!t || !t.closest) return; // 非元素目标（文本节点等）不处理
      // DOM 事件边界：closest 返回 Element，图片节点才需要 HTMLImageElement 的 src/alt
      const imgEl = t.closest('img.md-att-img') as HTMLImageElement | null;
      if (imgEl) {
        e.preventDefault();
        open({ src: imgEl.getAttribute('src') || imgEl.src, kind: 'img', label: imgEl.alt || '' });
        return;
      }
      const a = t.closest('a.md-att');
      if (a) {
        // 扩展名从链接文字取（[需求说明.pdf](fileId) → 需求说明.pdf）；
        // fileId 本身不带语义，URL query 也不可信。
        const label = String(a.getAttribute('download') || a.textContent || '').trim();
        if (/\.pdf$/i.test(label)) {
          e.preventDefault();
          open({ src: a.getAttribute('href') || '', kind: 'pdf', label });
        }
        // 其它类型不拦：默认行为就是浏览器下载
      }
    },
    true, // capture：抢在渲染面自己的 click 处理（如旁路原文的事件）之前
  );

  document.body.appendChild(overlay);
  const uninstall = () => {
    close();
    overlay.remove();
    delete window.__mdAttPreview;
  };
  window.__mdAttPreview = { uninstall };
  return uninstall;
}
