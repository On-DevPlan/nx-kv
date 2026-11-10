/** 秒 → 人读（check 日志的已用/剩余）。 */
export function fmtSec(v) {
  const s = Math.max(0, Number(v) || 0);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}
