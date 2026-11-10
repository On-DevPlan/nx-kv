// LivePreview 的容器 hook：状态与副作用都收在这里，组件（md-panes.jsx）只留
// 结构钉测试锚定的交互本体（跨块选区删除、Delete 并块、IME 守卫、复选框点击）
// 与 JSX 装配。返回值即组件所需的全部上下文。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAttachPicker } from './attach-picker.jsx';
import { atTriggerAt, padEmbed } from '../../modules/md/attach-mention.js';
import { diffIndex, runFormat, turnBlock } from '../../modules/md/md-edit-ops.js';
import { joinMdBlocks, normalizeBlockText } from '../../modules/md/md-parse.js';
import { bodyBlocksOnly, useDropFiles } from './md-panes-helpers.js';
import { useSlashMenu } from './use-slash-menu.js';

export function useLivePreview({
  body, onBody, articleRef, attachments, docKey, onFiles, onCloseSelMenu, attachHost,
}) {
  const [focus, setFocus] = useState(null);
  const pendingSelRef = useRef(null);
  // 预览态划选后按格式键：先记下待套用的操作，块进入编辑态并恢复选区后再执行
  const pendingFormatRef = useRef(null);
  const liveTaRef = useRef(null); // 当前聚焦块的 textarea
  const blocks = bodyBlocksOnly(body);
  // 空文档：splitMdBlocks('') 会给 ['']，视觉上是一片没有把手的空白——
  // 用幽灵引导条接住第一次点击（聚焦首块），聚焦后让位给 textarea 占位符
  const emptyDoc = blocks.length === 0 || blocks.every((b) => !String(b).trim());

  // ── 查找：块级匹配 + 命中块高亮 + 滚动定位（阅读态此前无查找能力）──
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIdx, setFindIdx] = useState(0);
  const findInputRef = useRef(null);
  const liveMatches = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    blocks.forEach((b, i) => {
      const t = String(b ?? '').toLowerCase();
      let pos = t.indexOf(q);
      while (pos !== -1) {
        out.push({ block: i, start: pos });
        pos = t.indexOf(q, pos + q.length);
      }
    });
    return out;
  }, [blocks, findQuery]);
  const jumpLive = (i) => {
    const total = liveMatches.length;
    if (!total) return;
    const n = ((i % total) + total) % total;
    setFindIdx(n);
    const m = liveMatches[n];
    const el = articleRef.current?.querySelector(`.mdw-lp-block[data-i="${m.block}"]`);
    // 瞬时定位，不走 smooth：平滑滚动与行号槽的即时同步互相打架，命中行会
    // 上下浮动、落点不稳（2026-11-03 任务 #7 移除）。
    el?.scrollIntoView?.({ block: 'center' });
  };
  const hitBlock = liveMatches[findIdx]?.block ?? -1;
  const setLiveQuery = (q) => {
    setFindQuery(q);
    setFindIdx(0);
  };

  // 实时预览不把标题写回正文；composeBody 提交时再拼 `# title`
  // kind：'typing' 连续输入（历史合并成一条）· 'op' 格式/结构操作（各自成条）
  const commit = useCallback(
    (nextBlocks, kind = 'op') => onBody(joinMdBlocks(nextBlocks), kind),
    [onBody]
  );

  const updateAt = (i, v, kind = 'op') => {
    const next = blocks.slice();
    next[i] = v;
    commit(next, kind);
  };

  const applyBlockOp = (i, opResult) => {
    if (!opResult) return;
    pendingSelRef.current = { index: i, start: opResult.start, end: opResult.end };
    updateAt(i, opResult.value);
  };

  // ── 斜杠命令：浮层坐标按块矩形算 ──
  const slashPositionOf = (ta) => {
    const rect = ta.getBoundingClientRect();
    return {
      x: Math.min(window.innerWidth - 220, rect.left),
      y: Math.min(window.innerHeight - 220, rect.bottom + 4),
    };
  };
  const {
    slash, slashRef, slashRafRef, setSlashBoth, refreshSlash, moveSlash, pickSlash, hoverSlash,
  } = useSlashMenu({
    getTa: () => liveTaRef.current,
    positionOf: slashPositionOf,
    onApply: (next, cur) => {
      const idx = cur?.index ?? focus;
      if (idx == null) return;
      applyBlockOp(idx, next);
    },
  });

  useEffect(() => { setFocus(null); setSlashBoth(null); }, [docKey]);

  // ── @ 附件选择（#108/#111）──
  // 草稿（无 v2 host）数据源 = 会话 doc 的附件（图片按名字内嵌，v1 渲染口径）
  const draftItems = useMemo(
    () => (attachHost ? null : (attachments || [])
      .filter((a) => a.type === 'image')
      // 映射成伪附件（kind/id 对齐 embedForAttachment）：草稿的图片按**名字**内嵌
      // （v1 渲染口径：imgMap[name] → dataURL），所以 id 就是名字。
      .map((a) => ({ kind: 'image', id: a.name, name: a.name, sizeText: a.size }))),
    [attachHost, attachments]
  );
  const picker = useAttachPicker({
    host: attachHost,
    itemsOverride: attachHost ? null : draftItems,
    onInsert: ({ index, embed, at, caret }) => {
      // 块内替换：把 '@' 那一段换成引用语法，光标落在引用之后；
      // 引用与正文**前后隔一空**（#111：贴着中文会黏连，行内元素需要边界）
      const val = normalizeBlockText(blocks[index] ?? '');
      const padded = padEmbed(embed, at > 0 ? val[at - 1] : '', val[caret] || '');
      const next = val.slice(0, at) + padded.text + val.slice(caret);
      const caretAt = at + padded.caretAt;
      updateAt(index, next);
      pendingSelRef.current = { index, start: caretAt, end: caretAt };
      setFocus(index);
    },
  });
  // 草稿「＋ 添加附件」：文件走页面附件通道（粘贴同款——传会话 doc 并在插入点
  // 落片段）；@ 占位字符先清掉，插入点用 '@' 原位置。
  const onDraftAddFiles = (files) => {
    const m = picker.menu;
    const pos = m ? { index: m.index, at: m.at, caret: m.caret } : { index: focus ?? 0, at: null, caret: null };
    if (m) {
      const val = normalizeBlockText(blocks[m.index] ?? '');
      updateAt(m.index, val.slice(0, m.at) + val.slice(m.caret));
    }
    requestAnimationFrame(() => {
      onFiles?.(files, {
        mode: 'live',
        focusIndex: pos.index,
        ...(pos.at != null ? { caretInBlock: pos.at } : {}),
      });
    });
  };

  const applyTurn = (index, turnId) => {
    const ta = liveTaRef.current;
    const fake = ta && focus === index
      ? ta
      : { value: normalizeBlockText(blocks[index] ?? ''), selectionStart: 0, selectionEnd: 0 };
    const next = turnBlock(fake, turnId);
    if (next) {
      applyBlockOp(index, next);
      setFocus(index);
    }
  };

  const ingestFiles = (files, ta) => {
    if (!files?.length || !onFiles) return;
    // 实时预览的光标是**块内**偏移，绝不能当全文 insertAt——否则会插进
    // frontmatter（保存时被剥掉，附件仓留下孤儿文件；任务 #15 验收根因）。
    onFiles(files, {
      mode: 'live',
      focusIndex: focus,
      caretInBlock: ta ? ta.selectionStart : null,
    });
  };

  const { rootProps } = useDropFiles({
    baseClass: 'mdw-lp',
    onDropFiles: (files) => ingestFiles(files, null),
  });

  // ── 编辑器命令 API：deleteBlockRange 由组件补上（结构钉锚定实现本体）──
  const apiBase = useMemo(() => ({
    format(op) {
      const ta = liveTaRef.current;
      if (!ta || focus == null) return;
      ta.focus();
      applyBlockOp(focus, runFormat(ta, op));
    },
    turn(turnId) {
      const i = focus ?? 0;
      applyTurn(i, turnId);
    },
    focus() {
      liveTaRef.current?.focus();
    },
    openFind() {
      setFindOpen(true);
      requestAnimationFrame(() => findInputRef.current?.focus());
    },
    /** 预览态划选后按 Ctrl/⌘B/I/E/K：把该块切到编辑态并保留选区，再套用格式 */
    formatSelection(op) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return false;
      const text = String(sel.toString() || '');
      if (!text.trim()) return false;
      const node = sel.anchorNode;
      const el = node?.nodeType === 3 ? node.parentElement : node;
      const blockEl = el?.closest?.('.mdw-lp-block');
      if (!blockEl || !articleRef.current?.contains(blockEl)) return false;
      const i = Number(blockEl.getAttribute('data-i'));
      if (!Number.isInteger(i) || i < 0 || i >= blocks.length) return false;
      const raw = normalizeBlockText(blocks[i] ?? '');
      const pos = raw.indexOf(text);
      if (pos === -1) return false; // 选区跨 markdown 标记时保守放弃，不做错位改写
      pendingSelRef.current = { index: i, start: pos, end: pos + text.length };
      pendingFormatRef.current = op;
      onCloseSelMenu?.();
      setFocus(i);
      return true;
    },
    /** 撤销/重做后把光标放回改动处：把正文偏移换算到具体块与块内偏移 */
    caretFromDiff(prev, next) {
      const prevJ = joinMdBlocks(bodyBlocksOnly(prev));
      const nextJ = joinMdBlocks(bodyBlocksOnly(next));
      const idx = diffIndex(prevJ, nextJ);
      let start = 0;
      for (let i = 0; i < blocks.length; i += 1) {
        // 用真实 joiner 累加，块边界与正文偏移严格对齐（连接符 '\n\n'）
        const end = joinMdBlocks(blocks.slice(0, i + 1)).length;
        if (idx <= end) {
          const off = Math.max(0, Math.min(idx - start, normalizeBlockText(blocks[i] ?? '').length));
          if (focus === i) {
            const ta = liveTaRef.current;
            if (ta) {
              ta.focus();
              ta.setSelectionRange(off, off);
            }
          } else {
            pendingSelRef.current = { index: i, start: off, end: off };
            setFocus(i);
          }
          return;
        }
        start = end + 2;
      }
    },
    // eslint 无 exhaustive-deps；闭包只依赖 blocks/focus/onBody/onCloseSelMenu 这轮的快照
  }), [focus, blocks, onBody, onCloseSelMenu]);

  const onBlockFocus = (idx) => {
    setFocus(idx);
    setSlashBoth(null);
  };
  const onTaReady = (el) => { liveTaRef.current = el; };
  const onBlockChange = (i, v) => {
    updateAt(i, v, 'typing');
    cancelAnimationFrame(slashRafRef.current);
    slashRafRef.current = requestAnimationFrame(() => {
      const ta = liveTaRef.current;
      if (!ta) return;
      refreshSlash(ta, { index: i });
      // @ → 唤起附件选择面板（#108）；不在触发点就收掉
      const hit = atTriggerAt(ta);
      if (hit) picker.open({ index: i, ta, at: hit.at, caret: hit.caret });
      else picker.close();
    });
  };
  const onBlockBlur = () => {
    requestAnimationFrame(() => {
      if (document.activeElement?.closest?.('.mdw-lp-block.is-edit')) return;
      if (document.activeElement?.closest?.('.mdw-slash')) return;
      if (document.activeElement?.closest?.('.mdw-atpick')) return; // @ 附件面板（#108）
      setFocus(null);
      setSlashBoth(null);
    });
  };

  return {
    blocks, focus, setFocus, pendingSelRef, pendingFormatRef, liveTaRef,
    commit, updateAt, applyBlockOp,
    slash, slashRef, setSlashBoth, moveSlash, pickSlash, hoverSlash,
    findOpen, setFindOpen, findQuery, setLiveQuery, findIdx, liveMatches, jumpLive,
    hitBlock, findInputRef,
    picker, onDraftAddFiles, apiBase, rootProps, emptyDoc,
    ingestFiles, onBlockFocus, onTaReady, onBlockChange, onBlockBlur,
  };
}
