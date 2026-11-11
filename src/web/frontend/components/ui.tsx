// 通用 UI 件：点击复制、错误边界、diff 渲染。
//
// 弹窗与轻提示已收敛到专用目录（2026-11-04 任务 #30 弹窗组件收敛）：
//   toast  → components/toast/（ToastProvider / useToast / useGuard）
//   弹层   → components/popup/（Modal / useDialog / PopMenu / RowMenu / useDismiss）
// 这里只留与弹层无关的展示件。
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useToast } from './toast/index.jsx';

/** Copyable 入参：`text` 是复制内容，`children` 可覆盖展示节点。 */
export interface CopyableProps {
  text?: string;
  className?: string;
  title?: string;
  children?: ReactNode;
}

// ---- 点击即复制：所有路径/长标识的展示标准 ----
// 点一下复制全文；hover 显示「点击复制」提示；复制成功 toast 确认。
export function Copyable({ text, className = '', title, children }: CopyableProps) {
  const toast = useToast();
  const copy = async () => {
    const v = String(text ?? '');
    try {
      await navigator.clipboard.writeText(v);
      toast('已复制: ' + (v.length > 60 ? v.slice(0, 57) + '...' : v));
    } catch {
      // 剪贴板 API 不可用（非安全上下文等）：退回 execCommand
      try {
        const ta = document.createElement('textarea');
        ta.value = v;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        toast('已复制: ' + (v.length > 60 ? v.slice(0, 57) + '...' : v));
      } catch {
        toast('复制失败（剪贴板不可用）');
      }
    }
  };
  return (
    <span
      className={'copyable' + (className ? ' ' + className : '')}
      title={title || '点击复制'}
      onClick={copy}
    >{children !== undefined ? children : text}</span>
  );
}

// ---- 错误边界：把崩溃限制在单个视图内 ----
// 视图都是 lazy() 加载的，没有这层兜底时，任何一个视图抛错（或 chunk 加载失败）
// 都会让整个面板白屏，用户连切到别的 tab 自救都做不到。

/** ErrorBoundary 入参（children 为被兜底的视图）。 */
export interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    // React 传进来的就是抛出的值；按 Error 收口（展示时还有 String() 兜底）
    return { error: error as Error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[nx-kv] 视图渲染失败:', error, info);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="colhead"><h3>这个面板出错了</h3></div>
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 10 }}>
          {String(this.state.error?.message || this.state.error)}
        </div>
        <div className="muted" style={{ marginBottom: 10 }}>
          其他面板不受影响，可以切到别的 tab 继续操作；控制台有完整堆栈。
        </div>
        <button className="btn" onClick={() => this.setState({ error: null })}>重试</button>
      </div>
    );
  }
}

// ---- diff 文本渲染（+/- 行着色） ----

/** DiffPre 入参。 */
export interface DiffPreProps {
  text?: string;
}

export function DiffPre({ text }: DiffPreProps) {
  const lines = String(text ?? '').split('\n');
  return (
    <pre>
      {lines.map((line, i) => (
        <span key={i} className={
          line.startsWith('+') && !line.startsWith('+++') ? 'd-add'
            : line.startsWith('-') && !line.startsWith('---') ? 'd-del' : ''
        }>
          {line}{i < lines.length - 1 ? '\n' : ''}
        </span>
      ))}
    </pre>
  );
}
