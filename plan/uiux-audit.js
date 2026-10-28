/**
 * nx-kv 面板 v2 设计稿 · 自动验收审计
 *
 * ⚠ 两个坑，改这个文件前先记住：
 * 1) 本文件要能在浏览器里直接跑（整段粘贴到 Console），所以不能带 shebang——
 *    `#!/usr/bin/env node` 在浏览器里是语法错误，整个脚本会静默不执行。
 * 2) 本文件会被内联进 HTML 的 script 元素里跑，所以正文里<b>不能出现字面的
 *    script 开闭标签</b>——HTML 解析器会在脚本内遇到结束标签时提前截断脚本，
 *    后半段变成文本，直接语法错误（而且是静默失败：页面照常显示，断言没跑）。
 *
 * 用途：把设计稿 §7.5「验收自查表」变成**可执行**的断言，避免靠肉眼点。
 *
 * 两种跑法：
 * 1) 浏览器控制台：打开 plan/uiux-redesign.html → F12 → Console → 整段粘贴本文件 → 回车。
 *    （审计用的是页面里的顶层变量 state / renderMain / cardMenu / openModal …）
 * 2) 命令行（headless Chrome，自动出结果）：用 node 读设计稿，在 body 收尾前拼一个
 *    内容为本文件的脚本块，写到临时 html，再用 headless Chrome 的 --dump-dom 打开。
 *    结果：页面上出现一个 id 为 audit 的 pre 元素，内容即通过 / 失败清单。
 *    （拼接代码别写进本文件的注释里——见上面第 2 条坑。）
 *
 * 断言覆盖：视图完整性 / 死按钮 / 图标按钮标签 / 焦点管理 / 验收项 DOM 在位。
 * 新增交互时同步在这里加一条——设计稿改了，审计要能立刻发现漏网。
 */
(function () {
  const errs = [];
  const T = (name, fn) => { try { fn(); } catch (e) { errs.push(name + ' >> ' + e.message); } };

  // —— 1. 六个视图都能渲染 ——
  T('all-views-render', () => {
    ['detail', 'overview', 'global', 'cloudAll', 'repos', 'settings'].forEach((v) => {
      state.view = v;
      renderMain();
      if (!document.getElementById('main').innerHTML.trim()) throw new Error(v + ' 视图渲染为空');
    });
    state.view = 'detail';
    renderMain();
  });

  // —— 2. 没有「点了没反应」的按钮 ——
  T('no-dead-buttons', () => {
    const dead = [];
    document.querySelectorAll('button').forEach((b) => {
      const wired = b.hasAttribute('data-act') || b.hasAttribute('data-src') || b.hasAttribute('data-more') ||
        b.hasAttribute('data-rail') || b.hasAttribute('data-mi') || b.id || b.type === 'submit';
      if (!wired) dead.push((b.className || '?') + '|' + b.textContent.trim().slice(0, 16));
    });
    if (dead.length) throw new Error('无行为按钮 ' + dead.length + ' 个: ' + dead.join(' / '));
  });

  // —— 3. 纯图标按钮必须有 title / aria-label ——
  T('icon-buttons-labeled', () => {
    const bad = [];
    document.querySelectorAll('button').forEach((b) => {
      if (!b.textContent.trim() && !b.getAttribute('title') && !b.getAttribute('aria-label')) bad.push(b.className || '?');
    });
    if (bad.length) throw new Error('图标按钮缺 title/aria-label: ' + bad.join(','));
  });

  // —— 4. 渲染区无原生 emoji（R10 图标体系化：图标一律内联 SVG） ——
  T('no-native-emoji', () => {
    const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}]/gu;
    ['side', 'rail', 'main'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const hit = el.innerHTML.match(re);
      if (hit && hit.length) throw new Error('#' + id + ' 出现原生 emoji: ' + [...new Set(hit)].join(' '));
    });
  });

  // —— 5. 浮层焦点管理：进得去、退得回来 ——
  T('menu-focus-in', () => {
    const trigger = document.querySelector('[data-act="cardmenu"]');
    cardMenu(trigger);
    if (!document.activeElement.closest('.gmenu')) throw new Error('菜单打开后焦点没进菜单');
    closeMenu();
  });
  T('modal-focus-and-return', () => {
    const btn = document.querySelector('[data-act="newtask"]');
    btn.focus();
    openModal({ title: 'x', body: '<textarea data-m="input"></textarea>', onConfirm: () => {} });
    if (document.activeElement.tagName !== 'TEXTAREA') throw new Error('模态打开后焦点没进输入框');
    closeModal();
    if (document.activeElement !== btn) throw new Error('模态关闭后焦点没归还触发元素');
  });

  // —— 6. 验收项在 DOM 里真的在位（对应 §7.5 自查表）——
  T('checklist-dom-present', () => {
    state.view = 'detail';
    renderMain();
    const need = [
      ['.trow.group', '侧边栏分组行'],
      ['.trow.child', '侧边栏目录行'],
      ['.col[data-col="doing"]', '本机·进行中列'],
      ['.col[data-col="pending"]', '本机·待领取列'],
      ['.col[data-col="consumed"]', '本机·已领取列'],
      ['.col.cloud-col[data-col="open"]', '云端·待办列'],
      ['.col.cloud-col[data-col="done"]', '云端·已完成列'],
      ['.col.cloud-col[data-col="freeze"]', '云端·冻结列'],
      ['.seg [data-src="both"]', '并列/仅本机/仅云端切换'],
      ['.pane[data-pane="local"]', '本机栏'],
      ['.pane[data-pane="cloud"]', '云端栏'],
      ['.badge-wait', '等待回填徽标'],
    ];
    const miss = need.filter(([sel]) => !document.querySelector(sel)).map(([, n]) => n);
    if (miss.length) throw new Error('验收项在 DOM 里找不到: ' + miss.join('、'));
  });

  // —— 7. 侧边栏编排：分组/目录行可拖、落点三态样式齐备 ——
  T('sidebar-drag-affordances', () => {
    renderSide();
    if (!document.querySelector('.trow.group[draggable]')) throw new Error('分组行不可拖');
    if (!document.querySelector('.trow.child[draggable]')) throw new Error('目录行不可拖');
    const css = Array.from(document.styleSheets).map((s) => { try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n'); } catch (e) { return ''; } }).join('\n');
    ['.d-before', '.d-after', '.d-into'].forEach((c) => { if (css.indexOf(c) < 0) throw new Error('缺落点样式 ' + c); });
  });

  const out = document.createElement('pre');
  out.id = 'audit';
  out.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:999;background:#1c1c1c;color:#fff;padding:10px 14px;border-radius:8px;font:12px/1.5 monospace;white-space:pre-wrap;max-width:520px';
  out.textContent = errs.length ? '✗ AUDIT FAILED\n' + errs.join('\n') : '✓ AUDIT PASS（视图/死按钮/标签/焦点/验收项/无emoji 全过）';
  document.body.appendChild(out);
  if (errs.length) console.error('[uiux-audit] 失败项:\n' + errs.join('\n'));
  else console.log('[uiux-audit] 全部通过');
})();
