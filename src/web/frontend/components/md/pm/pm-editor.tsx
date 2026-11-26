// PM 内核 M1 React 宿主（components 层）：单一实时文档编辑器。
// 方案见《md 编辑器换内核：ProseMirror 迁移路线设计》——本组件是 LivePreview
// 双态块编辑器的替身（?kernel=pm 试点开关，M4 起全量切换）：
//   - 标题仍由 TitleArea 编辑（复用 md-panes 的结构钉实现，等高/宽度契约不动）；
//   - 正文是一个 PM EditorView：阅读即编辑，无双态切换、无逐块 textarea；
//   - 数据契约与 LivePreview 完全一致：进 body（含标题），出 joinMdBlocks(正文块)
//     （标题不写回正文，composeText 落库时再拼）。
// 已知 M1 边界（M3 收口）：斜杠/块侧栏/选区浮层/查找未接 PM（mdw-* 组件原地等桥）；
// Ctrl+Z 走 PM 步骤级历史，页面级 histRef 栈对 PM 模式不再生效（宿主内消化）。
import { useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorState as EditorStateT, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, setBlockType, splitBlock, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { inputRules, textblockTypeInputRule } from 'prosemirror-inputrules';
import { TitleArea } from '../panes/md-panes.jsx';
import { joinMdBlocks, liveBodyBlocks } from '../../../modules/md/md-parse.js';
import { diffIndex } from '../../../modules/md/md-edit-ops.js';
import type { EditorApi } from '../panes/md-panes-helpers.js';
import { blocksToPmDoc, pmDocToBlocks } from '../../../modules/md/pm/adapter.js';
import { mdMark, mdNode, mdSchema } from '../../../modules/md/pm/schema.js';
import 'prosemirror-view/style/prosemirror.css';
import './pm.css';

/** M1 试点开关：URL 带 ?kernel=pm（search 或 hash 均认）显式开启；默认旧编辑器。 */
export function pmKernelEnabled(): boolean {
  return /[?&]kernel=pm/.test(`${window.location.search}${window.location.hash}`);
}

/** 插件集（工厂：宿主重建 state 时复用同一组实例形状）。 */
function buildPlugins(): Plugin[] {
  const headingRule = textblockTypeInputRule(
    /\s*^(#{1,6})\s$/,
    mdNode(mdSchema, 'heading'),
    (m) => ({ level: (m[1] ?? '#').length }),
  );
  return [
    inputRules({ rules: [headingRule] }),
    keymap({
      'Mod-b': (state, dispatch) => toggleMark(mdMark(mdSchema, 'strong'))(state, dispatch),
      'Mod-i': (state, dispatch) => toggleMark(mdMark(mdSchema, 'em'))(state, dispatch),
      'Mod-e': (state, dispatch) => toggleMark(mdMark(mdSchema, 'code'))(state, dispatch),
      // 标题内 Enter：拆块后落回正文段落（Notion 口径）
      Enter: chainCommands(splitBlock, setBlockType(mdNode(mdSchema, 'paragraph'))),
    }),
    keymap({ 'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo }),
    keymap(baseKeymap),
    history(),
  ];
}

/** 正文全文偏移（body-only 空间）→ PM 文档位置（粗近似：跨 hardBreak 记 1 字）。 */
function posForOffset(doc: EditorStateT['doc'], offset: number): number {
  let acc = 0;
  let pos = 1; // doc 起点之后
  let found = offset <= 0;
  doc.forEach((block, blockOffset) => {
    if (found) return;
    if (block.type.name === 'rawBlock') {
      const len = block.content.size;
      if (acc + len >= offset) {
        pos = blockOffset + 1 + (offset - acc);
        found = true;
        return;
      }
      acc += len;
      return;
    }
    block.forEach((inline, inlineOffset) => {
      if (found) return;
      const len = inline.type.name === 'hardBreak' ? 1 : inline.text?.length ?? 0;
      if (acc + len >= offset) {
        pos = inlineOffset + (offset - acc);
        found = true;
        return;
      }
      acc += len;
    });
    if (!found) acc += 1; // 块尾越界余量（\n\n joiner 的近似）
  });
  return found ? pos : doc.content.size;
}

export interface PmEditorProps {
  title: string;
  body: string;
  onTitle?: (v: string, kind?: string) => void;
  onBody?: (b: string, kind?: string) => void;
  editorApiRef?: RefObject<EditorApi | null> | null;
  docKey?: string;
  readOnly?: boolean;
  onEnterTitle?: () => void;
}

export default function PmEditor({
  title,
  body,
  onTitle,
  onBody,
  editorApiRef,
  docKey,
  readOnly = false,
  onEnterTitle,
}: PmEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // 宿主上次回填给父级的正文：区分「外部改 body」（重建 doc）与「自己回显」（忽略）
  const lastEmittedRef = useRef<string | null>(null);
  const onBodyRef = useRef(onBody);
  onBodyRef.current = onBody;
  const plugins = useMemo(buildPlugins, []);

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount) return undefined;
    const doc = blocksToPmDoc(liveBodyBlocks(body));
    const view = new EditorView(mount, {
      state: EditorState.create({ doc, plugins }),
      editable: () => !readOnly,
      dispatchTransaction: (tx) => {
        const next = view.state.apply(tx);
        view.updateState(next);
        if (!tx.docChanged) return;
        const out = joinBlocksOf(next.doc);
        lastEmittedRef.current = out;
        onBodyRef.current?.(out, 'typing');
      },
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // body 只在挂载时取初值；后续同步走下面的外部变更 effect（docKey 重建实例）
    // eslint 无 exhaustive-deps 插件（仓库口径）；重建由 docKey 键控
  }, [docKey, plugins, readOnly]);

  // 外部改 body（页面撤销栈 / 加载新 doc）：序列化对比，不同才重建 doc 并保光标
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const mine = joinBlocksOf(view.state.doc);
    if (body === mine || body === lastEmittedRef.current) return;
    lastEmittedRef.current = body;
    const nextDoc = blocksToPmDoc(liveBodyBlocks(body));
    const head = Math.min(view.state.selection.head, nextDoc.content.size - 1);
    // 先换内容，再按**事务后的文档**定位光标（setSelection 的 selection 必须
    // 属于当前 doc —— 用换文档前解析出的位置会抛 RangeError，探针实锤）。
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, nextDoc.content));
    const target = Math.max(0, Math.min(head, view.state.doc.content.size - 1));
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(target))));
    view.focus();
  }, [body]);

  useImperativeHandle(editorApiRef, () => ({
    focus() {
      viewRef.current?.focus();
    },
    format(op: string) {
      const view = viewRef.current;
      if (!view) return;
      const mark =
        op === 'bold' ? mdMark(mdSchema, 'strong')
        : op === 'italic' ? mdMark(mdSchema, 'em')
        : op === 'code' ? mdMark(mdSchema, 'code')
        : null;
      if (mark) toggleMark(mark)(view.state, view.dispatch);
    },
    /** 页面级撤销栈（PM 模式下外部回写 body）：把 diff 偏移映射回 PM 光标 */
    caretFromDiff(prev: string, next: string) {
      const view = viewRef.current;
      if (!view) return;
      const idx = diffIndex(stripTitle(prev), stripTitle(next));
      const pos = posForOffset(view.state.doc, idx);
      view.focus();
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
    },
    // eslint 无 exhaustive-deps；ref 稳定，无闭包过期面
  }), []);

  return (
    <div className="mdw-lp-sheet">
      <TitleArea
        className="mdw-lp-title"
        value={title}
        placeholder="无标题"
        onTitle={onTitle}
        onEnter={() => {
          if (onEnterTitle) onEnterTitle();
          else viewRef.current?.focus();
        }}
      />
      <div className={`mdw-pm-view${readOnly ? ' is-readonly' : ''}`} ref={containerRef} />
    </div>
  );
}

/** 正文块数组序列化（宿主内统一出口）。 */
function joinBlocksOf(doc: EditorStateT['doc']): string {
  return joinMdBlocks(pmDocToBlocks(doc));
}

/** 全文正文剥标题（caretFromDiff 的 diff 空间与 PM 文档对齐）。 */
function stripTitle(src: string): string {
  return joinMdBlocks(liveBodyBlocks(src));
}
