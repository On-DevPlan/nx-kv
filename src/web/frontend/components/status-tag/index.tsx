// 任务状态 tag 组件（#121）：全应用统一的状态药丸。
//
// 视觉层（.tstat / .tstat-<tone>）在 style.css；色调与文案的映射在 model.js
// （纯函数可单测）。旧的多套状态渲染（overview statusTag、组页 rp-tstat、
// 侧栏 完/跑/等/档、队列表 完/跑/等、工作台状态条）全部收口到这里——
// 口径：蓝 = 进行中（已领取在干）、绿 = 已完成、浅灰 = 待领取。
import { statusTone, statusLabel, statusShort } from './model.js';
import type { StatusRow } from './model.js';

export { statusTone, statusLabel, statusShort } from './model.js';

/** 状态药丸入参。 */
export interface StatusTagProps {
  /** 任务行（status / deletedAt / migratedTo） */
  t: StatusRow | null | undefined;
  /** 单字徽标（等/跑/完/档），title 自动补全称 */
  short?: boolean;
  /** 附加尺寸类 */
  className?: string;
  /** 悬浮提示（缺省：short 时给全称，全称时不加） */
  title?: string;
}

/**
 * 状态 tag 药丸。窄处用 `short` 出单字徽标；`className` 只附尺寸类，
 * 配色一律由 tstat-* 接管（别在外面再写状态色）。
 * @param {object} props
 * @param {object} props.t 任务行（status / deletedAt / migratedTo）
 * @param {boolean} [props.short] 单字徽标（等/跑/完/档），title 自动补全称
 * @param {string} [props.className] 附加尺寸类
 * @param {string} [props.title] 悬浮提示（缺省：short 时给全称，全称时不加）
 */
export default function StatusTag({ t, short = false, className = '', title }: StatusTagProps) {
  const tone = statusTone(t);
  return (
    <span
      className={'tstat tstat-' + tone + (short ? ' tstat-short' : '') + (className ? ' ' + className : '')}
      title={title || (short ? statusLabel(t) : undefined)}
    >
      {short ? statusShort(t) : statusLabel(t)}
    </span>
  );
}
