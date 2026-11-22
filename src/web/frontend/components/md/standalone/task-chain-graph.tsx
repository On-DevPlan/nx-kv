// 任务链**树图**（#177）：单向树的图形化可视化——根在上、子节点向下并排（组织图样式）。
//
// 为什么是 SVG 而不是缩进列表：一条任务下的旁支（两个并行评论 + 反馈 + 分支）在
// 列表里会被读成一条线；树图能一眼看出「谁是谁的子节点、哪几条是并行的」。
//
// 布局：后序 DFS——叶子各占一格，父节点居中于子区间；纵向按深度排。整图可滚动。
// 节点：类型标签（评论/反馈/分支/起点）+ #id + 状态点 + 时间；当前任务绿描边。
// 点击节点旁路打开（现有 onOpenNode 接口不变）。
import type { ChainTreeNode } from '../../../page/dir/task-utils.js';

const NW = 148; // 节点宽
const NH = 58; // 节点高
const GX = 20; // 兄弟间距
const GY = 46; // 层间距

const KIND_LAB: Record<string, string> = {
  origin: '起点',
  reopen: '反馈',
  feedback: '反馈',
  comment: '评论',
  fork: '分支',
};
const STATUS_LAB: Record<string, string> = {
  pending: '待领取',
  claimed: '已领取',
  done: '已完成',
  cancelled: '已取消',
  plan: '草稿',
};
/** 类型 → 描边/标签色（浅色主题下可读）。 */
const KIND_COLOR: Record<string, string> = {
  origin: '#6B7078',
  reopen: '#B4703A',
  feedback: '#B4703A',
  comment: '#3F6E9E',
  fork: '#7A5FA8',
};
const STATUS_DOT: Record<string, string> = {
  pending: '#8A8F98',
  claimed: '#C99A2E',
  done: '#2F6F5E',
  cancelled: '#C0392B',
  plan: '#9AA0A8',
};

interface Placed {
  id: string;
  x: number;
  y: number;
  depth: number;
  kind: string;
  status: string;
  label: string;
  time: string;
  current: boolean;
  missing: boolean;
  node: ChainTreeNode;
}

export interface ChainGraphProps {
  root: ChainTreeNode;
  onOpen?: (n: ChainTreeNode) => void;
}

/** 量宽：后序算每棵子树的布局宽度（叶子一格，父=max(自身, 子宽和+间距)）。 */
function measure(n: ChainTreeNode): number {
  const kids = n.children || [];
  if (!kids.length) return NW;
  const sum = kids.reduce((s, k) => s + measure(k), 0) + GX * (kids.length - 1);
  return Math.max(NW, sum);
}

function fmtTime(v?: string): string {
  const s = String(v || '').trim();
  if (!s) return '';
  // '2026-11-22 13:44:04' → '11-22 13:44'
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : s.slice(0, 16);
}

export default function ChainGraph({ root, onOpen }: ChainGraphProps) {
  const placed: Placed[] = [];
  const edges: { from: Placed; to: Placed }[] = [];
  let cursor = 0;

  const place = (n: ChainTreeNode, depth: number): Placed => {
    const w = measure(n);
    const kids = n.children || [];
    const p: Placed = {
      id: String(n.id),
      x: 0,
      y: depth * (NH + GY),
      depth,
      kind: String(n.forkKind || (depth === 0 ? 'origin' : '')),
      status: String(n.status || ''),
      label: String(n.excerpt || `#${n.id}`),
      time: fmtTime(n.createdAt),
      current: !!n.current,
      missing: !!n.missing,
      node: n,
    };
    if (!kids.length) {
      p.x = cursor + (w - NW) / 2;
      cursor += w + GX;
    } else {
      const left = cursor;
      const childPlaced = kids.map((k) => place(k, depth + 1));
      // 父居中于子区间
      const first = childPlaced[0]!;
      const last = childPlaced[childPlaced.length - 1]!;
      p.x = (first.x + last.x) / 2;
      // 防止父越界（子区间比自身窄时保持左对齐到区间内）
      p.x = Math.min(Math.max(p.x, left), left + w - NW);
      for (const c of childPlaced) edges.push({ from: p, to: c });
      cursor = Math.max(cursor, left + w + GX);
    }
    placed.push(p);
    return p;
  };
  place(root, 0);

  const width = Math.max(NW, cursor - GX) + 24;
  const height = (Math.max(0, ...placed.map((p) => p.depth)) + 1) * (NH + GY) - GY + 24;

  return (
    <div className="mdw-chain-graph-wrap">
      <svg
        className="mdw-chain-graph"
        width={width + 8}
        height={height + 8}
        viewBox={`-12 -12 ${width} ${height}`}
        role="img"
        aria-label="任务链树图"
      >
        {/* 连线先画（压在节点下面）：父底中 → 竖下 → 横到子 → 竖下 */}
        {edges.map((e, i) => {
          const x1 = e.from.x + NW / 2;
          const y1 = e.from.y + NH;
          const x2 = e.to.x + NW / 2;
          const y2 = e.to.y;
          const midY = y1 + (y2 - y1) / 2;
          return (
            <path
              key={`e${i}`}
              d={`M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`}
              fill="none"
              stroke="var(--line, #D8D6D0)"
              strokeWidth="1.4"
            />
          );
        })}
        {placed.map((p) => {
          const kindColor = KIND_COLOR[p.kind] || '#6B7078';
          const dot = STATUS_DOT[p.status] || '#8A8F98';
          const lab = KIND_LAB[p.kind] || (p.depth === 0 ? '起点' : '?');
          const st = STATUS_LAB[p.status] || p.status || '';
          return (
            <g
              key={`n${p.id}`}
              className={'mdw-chain-node' + (p.current ? ' is-current' : '') + (p.missing ? ' is-missing' : '')}
              transform={`translate(${p.x}, ${p.y})`}
              onClick={() => { if (!p.current && !p.missing) onOpen?.(p.node); }}
              style={{ cursor: p.current || p.missing ? 'default' : 'pointer' }}
            >
              <title>
                {`#${p.id} ${lab}${st ? ' · ' + st : ''}\n${p.label}${p.time ? '\n' + p.time : ''}${p.current ? '\n（当前任务）' : ''}`}
              </title>
              <rect
                width={NW}
                height={NH}
                rx="8"
                fill={p.current ? 'var(--soft, #F4F6F4)' : 'var(--paper, #FFFFFF)'}
                stroke={p.current ? 'var(--mdw-accent, #2F6F5E)' : 'var(--line, #D8D6D0)'}
                strokeWidth={p.current ? 2 : 1}
              />
              {/* 类型标签（左上角小胶囊） */}
              <rect x="8" y="7" width={lab.length * 12 + 12} height="16" rx="8" fill={kindColor} opacity="0.12" />
              <text x="14" y="19" fontSize="10" fontWeight="600" fill={kindColor}>{lab}</text>
              <text x={NW - 10} y="19" fontSize="10" fill="var(--faint, #8A8F98)" textAnchor="end">#{p.id}</text>
              {/* 标题（单行截断） */}
              <text x="10" y="37" fontSize="11.5" fill="var(--ink, #16181C)">
                {p.label.length > 15 ? p.label.slice(0, 15) + '…' : p.label}
              </text>
              {/* 状态点 + 状态 + 时间 */}
              <circle cx="13" cy="47" r="3" fill={dot} />
              <text x="21" y="50" fontSize="10" fill="var(--ink-2, #454A52)">{st}</text>
              {p.time ? <text x={NW - 10} y="50" fontSize="9.5" fill="var(--faint, #8A8F98)" textAnchor="end">{p.time}</text> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
