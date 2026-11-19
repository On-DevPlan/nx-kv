// 文档级快捷键的**判定**与**节流**（md-panes-root 的 window 捕获阶段用）。
//
// 抽成纯函数是为了能在 node 里钉住三条语义（#189 快捷键优化）：
//   1. 只有**完整的组合按击**才算一次（Ctrl/⌘ + 单个字母）；
//   2. 按住不放产生的 key repeat、输入法组合态一律不算新按键
//      ——此前 Ctrl+S 按住不放会按键盘重复率疯狂弹「已保存」toast；
//   3. 保存类组合键节流：间隔窗口内的重复按压只认第一次（连击 / 多键同按）。

/** 判定只需要这几个字段（DOM KeyboardEvent 的结构子集，便于单测造对象）。 */
export interface DocKeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** 按住不放的自动重复 */
  repeat?: boolean;
  /** 输入法组合中 */
  isComposing?: boolean;
  /** 部分浏览器组合态下 key 为 'Process'，只剩 229 可判 */
  keyCode?: number;
}

/** 同一组合键的最小触发间隔（ms）：够吞掉连击与按住，又不挡人手正常两次保存。 */
export const COMBO_GAP_MS = 400;

/**
 * 归一化这一次按键：返回小写字母（如 `'s'`）表示「完整按下了一组修饰键 + 字母」，
 * 返回 null 表示这次按键不该被文档级快捷键接管。
 */
export function docComboOf(e: DocKeyLike): string | null {
  if (e.altKey) return null;
  if (!(e.metaKey || e.ctrlKey)) return null;
  // 按住不放的自动重复不是一次新按键——「按一次只触发一次」的根
  if (e.repeat) return null;
  // 输入法组合中归输入法（中文输入时 ctrl 组合不能抢）
  if (e.isComposing || e.keyCode === 229) return null;
  const k = String(e.key || '').toLowerCase();
  return k.length === 1 ? k : null;
}

/** 节流闸门：按组合键分别计时，返回 true = 这一击放行。 */
export type ComboGate = (key: string, now?: number) => boolean;

/** 造一个节流闸门（同一 key 在 gapMs 内只放行第一次；不同 key 互不影响）。 */
export function createComboGate(gapMs: number = COMBO_GAP_MS): ComboGate {
  const last = new Map<string, number>();
  return (key: string, now: number = Date.now()) => {
    const prev = last.get(key);
    if (prev != null && now - prev < gapMs) return false;
    last.set(key, now);
    return true;
  };
}
