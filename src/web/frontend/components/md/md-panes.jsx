// MD 工作台的多面板组件入口（对外 import 面不变：MdPanes / ModeSeg 再导出）。
//
// 本文件只保留**结构钉测试锚定**的部分（tests/unit/md-editor-pro-gaps、
// md-view-selection-backspace、md-title-height 直接对本文件源码做断言）：
//   TitleArea      标题输入（ResizeObserver 跟宽重算，#94）
//   LivePreview    块编辑器外壳：跨块选区删除 / Delete 并块 / IME 守卫 / 复选框点击
//   SourceEditor   源码编辑器外壳：IME 守卫 / textarea 拖放（#118）
// 其余按职责拆到同目录兄弟文件：
//   md-panes-root.jsx    MdPanes（模式分发+文档级快捷键）与 ModeSeg
//   live-block.jsx       LiveBlock 单块渲染
//   slash-menu.jsx       斜杠菜单组件与键盘助手
//   use-slash-menu.js    两个编辑器共用的斜杠菜单状态 hook
//   find-bar.jsx         查找条
//   status-bar.jsx       源码底栏
//   use-live-preview.js  LivePreview 容器 hook（状态/查找/斜杠/@ 附件/编辑器 API）
//   use-source-editor.js SourceEditor 容器 hook
//   md-panes-keys.js     块编辑器按键子动作（Enter 拆块 / Backspace / Shift+Enter / ↑↓）
//   md-panes-helpers.js  共享小助手（块渲染、快捷键表、拖放 hook）
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import AttachPicker from './attach-picker.jsx';
import LiveBlock from './live-block.jsx';
import { EditorFindBar } from './find-bar.jsx';
import { handleSlashKey, SlashMenu } from './slash-menu.jsx';
import { StatusBar } from './status-bar.jsx';
import { useLivePreview } from './use-live-preview.js';
import { useSourceEditor } from './use-source-editor.js';
import { FMT_KEYS } from './md-panes-helpers.js';
import {
  handleArrowNav,
  handleBackspaceStart,
  handleBareListEscape,
  handleEnterSplit,
  handleSoftBreak,
} from './md-panes-keys.js';
import {
  filesFromDataTransfer,
  indentLines,
  runFormat,
  toggleNthTodo,
} from '../../modules/md/md-edit-ops.js';
import { isFrontmatterBlock, normalizeBlockText } from '../../modules/md/md-parse.js';

export { MdPanes, ModeSeg } from './md-panes-root.jsx';

// 标题输入：自动增高 textarea —— input 不能软换行，长标题会横向溢出（UIUX E1）。
// 标题在语义上仍是单条逻辑行：Enter 不产生换行，把焦点交给正文。
//
// **高度必须跟着宽度一起重算**（2026-11-08 #94 验收反馈「title下有一大段空白」）：
// fit() 读 scrollHeight，而 scrollHeight 是**当前宽度**下折行的结果——面板
// 刚打开、布局尚未定宽时，标题会按极窄宽度折成七八行，scrollHeight 暴涨到
// 几百 px（实测窄容器 316px、用户现场 271px）。此后宽度恢复正常、标题只占
// 一行，高度却再也降不回去（fit 只在 value 变化时跑，宽度变化不触发）——
// 标题下方就留着一大段空白。
//
// 修法：ResizeObserver 观察自身宽度，宽度一变就重算高度（宽度是唯一会让
// scrollHeight 变化的外部因素；文字变化由 value 依赖覆盖）。
function TitleArea({ value, onTitle, placeholder, className, onFocus, onEnter }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    // 宽度变了要重算：面板拖宽/拖窄、布局首次定宽、浮窗开合都会改宽度。
    // 观察自身盒子（含 padding）比监听 window resize 准——窗口没变、面板变了
    // 同样要重算。
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => fit());
      ro.observe(el);
    } else {
      window.addEventListener('resize', fit);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', fit);
    };
  }, [value]);
  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      rows={1}
      spellCheck={false}
      aria-label="标题"
      onChange={(e) => onTitle(e.target.value, 'typing')}
      onFocus={onFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter?.();
        }
      }}
    />
  );
}

/**
 * 单栏实时预览：阅读态渲染 + 点击块就地改源码。
 * 无双栏、无高亮描边块。
 */
function LivePreview({
  title, body, onTitle, onBody, articleRef, attachments, docKey, onFiles, editorApiRef, onTextSel,
  onCloseSelMenu, hideTitle = false, attachHost = null,
}) {
  const {
    blocks, focus, setFocus, pendingSelRef, pendingFormatRef, liveTaRef,
    commit, updateAt, applyBlockOp,
    slash, slashRef, setSlashBoth, moveSlash, pickSlash, hoverSlash,
    findOpen, setFindOpen, findQuery, setLiveQuery, findIdx, liveMatches, jumpLive,
    hitBlock, findInputRef,
    picker, onDraftAddFiles, apiBase, rootProps, emptyDoc,
    ingestFiles, onBlockFocus, onTaReady, onBlockChange, onBlockBlur,
  } = useLivePreview({ body, onBody, articleRef, attachments, docKey, onFiles, onCloseSelMenu, attachHost });

  // ── 跨块选区（#124）：块粒度的「统一删除」────────────────────────────
  // 视图块是渲染好的 HTML，选区字符偏移无法精确映射回各块源码（markdown
  // 标记在渲染时被剥掉）——沿用本编辑器一贯的保守口径（#98 同源）：**升到
  // 块级映射**。选区两端落在不同视图块上 → 触到的整段块 [lo, hi] 就是操作
  // 单元：删除 = 整段移除（浮层按钮与 Backspace/Delete 走同一实现）；
  // 复制 = 整段源码（task.jsx 侧拼好入剪贴板）。单块内选区仍是 #98 的
  // 字符级 indexOf 映射，行为不变。
  const removeBlockRange = useCallback((lo, hi) => {
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return false;
    if (lo < 0 || hi < lo || hi >= blocks.length) return false;
    const next = blocks.slice();
    next.splice(lo, hi - lo + 1);
    commit(next);
    // 删完落焦到接缝块（原 lo 位置，越界夹回末块），光标在块首——与单块
    // 删除的落点语义一致（删完可以接着打字）；op 走历史栈，Ctrl+Z 可撤销。
    const fi = Math.min(lo, Math.max(0, next.length - 1));
    pendingSelRef.current = { index: fi, start: 0, end: 0 };
    setFocus(fi);
    return true;
  }, [blocks, commit]);

  useImperativeHandle(editorApiRef, () => ({
    ...apiBase,
    /** 跨块选区的浮层「删除选区」（#124）：整段移除 [lo, hi] 块（含端点） */
    deleteBlockRange(lo, hi) {
      return removeBlockRange(lo, hi);
    },
  }), [apiBase, removeBlockRange]);

  // document 捕获：预览态划选后按 Backspace/Delete —— 把选中文字删掉（#98）。
  // 视图块是渲染好的 HTML，选区落在不可编辑内容上，浏览器默认对 Backspace
  // 无动于衷（编辑态 textarea 原生行为本来就对，这里只补视图态这一块）。
  // 单块选区按字符级映射（选区文本在块源码里 indexOf 定位；跨 markdown 标记
  // 时 indexOf 不中 → 保守放弃，不做错位改写）；跨块选区升到块级（#124，
  // removeBlockRange：触到的整段块全移除）。
  // 删除后进编辑态、光标落接缝（op 走历史栈，Ctrl+Z 可撤）。
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      // 焦点在可编辑元素里：原生行为已正确（textarea 选区删除 / contentEditable 标题）
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = String(sel.toString() || '');
      if (!text.trim()) return;
      const elOf = (n) => (n?.nodeType === 3 ? n.parentElement : n);
      const blockA = elOf(sel.anchorNode)?.closest?.('.mdw-lp-block');
      if (!blockA || !articleRef.current?.contains(blockA)) return;
      const i = Number(blockA.getAttribute('data-i'));
      if (!Number.isInteger(i) || i < 0 || i >= blocks.length) return;
      // 跨块选区（#124）：两端落在不同视图块 → 块粒度统一删除。字符级映射
      // 跨块做不到（渲染 HTML 的选区偏移映射不回源码），按 #98 的保守口径
      // 升到块级；浮层上的「删除选区」按钮走同一实现（editorApi.deleteBlockRange）。
      const blockF = elOf(sel.focusNode)?.closest?.('.mdw-lp-block');
      if (blockF && blockF !== blockA && articleRef.current?.contains(blockF)) {
        const iff = Number(blockF.getAttribute('data-i'));
        if (Number.isInteger(iff) && iff >= 0 && iff < blocks.length && iff !== i) {
          e.preventDefault();
          removeBlockRange(Math.min(i, iff), Math.max(i, iff));
          onCloseSelMenu?.();
        }
        return;
      }
      const raw = normalizeBlockText(blocks[i] ?? '');
      const pos = raw.indexOf(text);
      if (pos === -1) return; // 跨标记：保守放弃，不删
      e.preventDefault();
      updateAt(i, raw.slice(0, pos) + raw.slice(pos + text.length));
      pendingSelRef.current = { index: i, start: pos, end: pos };
      onCloseSelMenu?.();
      setFocus(i);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [blocks, onBody, articleRef, onCloseSelMenu, removeBlockRange]);

  // 复选框开关：DOM 序号 → 源码第 n 个 todo，走纯函数切换（updateAt=op 通道，可撤销）
  const onToggleTodo = (idx, n) => {
    const raw = normalizeBlockText(blocks[idx] ?? '');
    const next = toggleNthTodo(raw, n);
    if (next) updateAt(idx, next);
  };

  // 视图块点击：复选框直接切换（#99：视图态 ☑/☐ 可点——专业编辑器基线行为）。
  // 不进编辑态。DOM 里 .mdw-cb 的序号与块源码里 todo 行的序号一一对应（按行序渲染）。
  const onViewClick = (e, index) => {
    const cb = e.target.closest?.('.mdw-cb');
    if (cb) {
      e.stopPropagation();
      const cbs = [...e.currentTarget.querySelectorAll('.mdw-cb')];
      onToggleTodo?.(index, cbs.indexOf(cb));
      return;
    }
    // 划选评论：有选区时不进编辑，把选区留给上层 mouseup 浮层
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    onBlockFocus(index);
  };

  const onKeyDown = (i, e) => {
    const val = normalizeBlockText(blocks[i] ?? '');
    const ta = e.target;
    liveTaRef.current = ta;

    // IME 组合中（拼音候选未上屏）：按键归输入法，块级快捷键一概不接——
    // 否则选字回车的 Enter 会被当「拆块」、删拼音的 Backspace 会被当「并块」
    // （标题区同款守卫，见 TitleArea 的 onEnter）。
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;

    // 优先处理斜杠菜单（用 ref，避免闭包里 slash 过期）
    if (handleSlashKey(e, slashRef, {
      move: moveSlash,
      pick: pickSlash,
      close: () => setSlashBoth(null),
    })) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setSlashBoth(null);
      ta.blur();
      setFocus(null);
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey) {
      const op = FMT_KEYS[e.key.toLowerCase()];
      if (op) {
        e.preventDefault();
        applyBlockOp(i, runFormat(ta, op));
        return;
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      applyBlockOp(i, indentLines(ta, e.shiftKey));
      return;
    }

    const ctx = {
      e, i, val, ta, blocks, commit, setFocus, pendingSelRef, slashRef, liveTaRef, setSlashBoth, applyBlockOp,
    };
    // Notion：Enter = 在光标处拆成新块（列表续行优先）；Shift+Enter = 块内软换行
    if (e.key === 'Enter' && !e.shiftKey && !mod && handleEnterSplit(ctx)) return;
    // Backspace：空首块移除 / 块首并上块（FM 块除外）/ 裸列表项一键逃出（#100）
    if (e.key === 'Backspace' && handleBackspaceStart(ctx)) return;
    if (e.key === 'Backspace' && handleBareListEscape(ctx)) return;

    // Delete 在块尾（无选区、非末块）：把下一块并进来，光标落接缝——
    // Backspace 并上块的镜像（Notion 行为）。FM 块同理不许被并：
    // 合并会把下一块的 `---` 撕碎成普通文本。
    if (
      e.key === 'Delete'
      && ta.selectionStart === val.length && ta.selectionEnd === val.length
      && i < blocks.length - 1 && !slashRef.current
      && !isFrontmatterBlock(normalizeBlockText(blocks[i + 1] ?? ''))
    ) {
      e.preventDefault();
      setSlashBoth(null);
      const nxt = normalizeBlockText(blocks[i + 1] ?? '');
      const next = blocks.slice();
      next[i] = val + nxt;
      next.splice(i + 1, 1);
      pendingSelRef.current = { index: i, start: val.length, end: val.length };
      commit(next);
      setFocus(i);
      return;
    }
    // Shift+Enter：块头/块尾新开空块（中段放行原生插入）
    if (e.key === 'Enter' && e.shiftKey && !mod && !slashRef.current && handleSoftBreak(ctx)) return;
    // 斜杠菜单打开时禁止块间跳转（必须用 ref，避免闭包过期）
    if (slashRef.current) return;
    // ↑↓ 跨块：块首 ↑ 落上一块末尾、块尾 ↓ 落下一块开头；软换行块走视觉行兜底（#92）
    handleArrowNav(ctx);
  };

  return (
    <div {...rootProps}>
      <div className="mdw-lp-sheet" ref={articleRef}>
        {findOpen && (
          <EditorFindBar
            query={findQuery}
            setQuery={setLiveQuery}
            index={findIdx}
            total={liveMatches.length}
            onNext={() => jumpLive(findIdx + 1)}
            onPrev={() => jumpLive(findIdx - 1)}
            onClose={() => setFindOpen(false)}
            inputRef={findInputRef}
          />
        )}
        {/* 标题行：评论/反馈面板不要（#104——引用信息在面板头部，标题行是多余的） */}
        {!hideTitle && (
          <TitleArea
            className="mdw-lp-title"
            value={title}
            placeholder="无标题"
            onTitle={onTitle}
            onFocus={() => { setFocus(null); setSlashBoth(null); }}
            onEnter={() => { if (blocks.length) setFocus(0); }}
          />
        )}
        <div className={`mdw-lp-blocks${emptyDoc ? ' is-empty-doc' : ''}`}>
          {blocks.map((b, i) => (
            <LiveBlock
              key={`${docKey}-${i}`}
              index={i}
              text={b}
              focused={focus === i}
              hit={hitBlock === i}
              attachments={attachments}
              pendingSelRef={pendingSelRef}
              pendingFormatRef={pendingFormatRef}
              onFocus={onBlockFocus}
              onViewClick={onViewClick}
              onTaReady={onTaReady}
              onChange={(v) => onBlockChange(i, v)}
              onBlur={onBlockBlur}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPasteFiles={(files, ta) => ingestFiles(files, ta)}
              onTextSel={onTextSel}
            />
          ))}
        </div>
        {emptyDoc && focus === null ? (
          <button
            type="button"
            className="mdw-lp-add is-empty-hint"
            aria-label="开始输入"
            onClick={() => setFocus(0)}
          >
            <span className="mdw-lp-add-hint">输入正文，或键入 / 唤起命令…</span>
          </button>
        ) : (
          <button
            type="button"
            className="mdw-lp-add"
            aria-label="继续输入"
            onClick={() => {
              commit([...blocks, '']);
              setFocus(blocks.length);
            }}
          />
        )}
      </div>
      {slash && createPortal(
        <SlashMenu
          items={slash.items}
          active={slash.active}
          onHover={hoverSlash}
          onPick={pickSlash}
          style={{ left: slash.x, top: slash.y }}
        />,
        document.body
      )}
      {/* @ 附件选择面板（#108/#109）：圆角下拉 + 搜索框 + ↑↓ 选择 +
          「＋ 添加附件」（共享选择弹窗）+ 任务条目 ↗ 右侧并排看原文 */}
      {picker.menu && createPortal(
        <AttachPicker
          items={picker.items}
          query={picker.menu.query}
          onQuery={picker.setQuery}
          active={picker.active}
          onHover={picker.move}
          onPick={picker.pick}
          loading={picker.menu.loading}
          error={picker.menu.error}
          position={{ left: picker.menu.x, top: picker.menu.y }}
          host={attachHost}
          onReload={picker.reload}
          onAddFiles={attachHost ? null : onDraftAddFiles}
        />,
        document.body
      )}
    </div>
  );
}

/** 源码编辑器：soft-wrap、行号、查找、格式 API、粘贴/拖图、行首 /（状态与逻辑见 use-source-editor.js） */
function SourceEditor({ title, body, onTitle, onBody, editorApiRef, onFiles, onTextSel }) {
  const ed = useSourceEditor({ body, onBody, editorApiRef, onFiles, onTextSel });
  const { ingestImages } = ed;
  // IME 组合中（拼音候选未上屏）：按键归输入法，快捷键一概不接（块编辑器同款守卫）
  const onKeyDown = (e) => {
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
    ed.onKeyDown(e);
  };
  return (
    <div {...ed.rootProps}>
      <TitleArea
        className="mdw-title-input"
        value={title}
        placeholder="任务标题"
        onTitle={onTitle}
        onEnter={ed.focusBodyStart}
      />
      {ed.findOpen && <EditorFindBar {...ed.findBarProps} />}
      <div className={`mdw-editor-row${ed.showLines ? ' has-gutter' : ''}${ed.showRuler ? ' has-ruler' : ''}`}>
        {ed.showLines && (
          <div className="mdw-gutter" ref={ed.gutterRef} aria-hidden>
            {ed.lineNums.map((n) => (
              <div key={n} className="mdw-gutter-ln">{n}</div>
            ))}
          </div>
        )}
        <div className="mdw-editor-stage">
          {ed.showRuler && <div className="mdw-ruler" aria-hidden title="约 80 字符参考" />}
          <textarea
            ref={ed.taRef}
            className={`mdw-editor${ed.wrap ? ' is-wrap' : ' is-nowrap'}`}
            value={body}
            spellCheck={false}
            wrap={ed.wrap ? 'soft' : 'off'}
            aria-label="正文源码"
            placeholder="用 Markdown 写任务——行首 / 出命令 · Ctrl/⌘F 查找 · Ctrl/⌘B 粗体"
            onChange={ed.onChange}
            onKeyDown={onKeyDown}
            onKeyUp={ed.syncCaret}
            onClick={ed.onClick}
            onSelect={ed.syncCaret}
            onScroll={ed.syncGutter}
            onPaste={ed.onPaste}
            onDrop={(e) => {
              // 拖文件进来 = 与粘贴同一通道（实时预览态已有拖放，源码态补齐对等能力）
              const files = filesFromDataTransfer(e.dataTransfer);
              if (!files.length) return;
              e.preventDefault();
              ingestImages(files);
            }}
            onMouseUp={ed.onMouseUp}
          />
        </div>
      </div>
      <StatusBar {...ed.statusProps} />
      {ed.slash && createPortal(
        <SlashMenu {...ed.slashMenuProps} />,
        document.body
      )}
    </div>
  );
}

export { LivePreview, SourceEditor };
