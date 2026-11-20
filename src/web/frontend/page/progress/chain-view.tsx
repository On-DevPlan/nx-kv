// 进程面板的「只看这条任务链」视图（#245）——从 index.tsx 拆出的独立组件。
//
// 为什么单独一个文件：链树渲染（递归 ChainTreeItem）+ 取数 effect + 整版视图 JSX
// 自成一体，与卡片列表零共享状态；拆出去让 index.tsx 回到门禁的 600 行内，
// 也让「树怎么渲染」有自己的家（改树样式/交互只看这一个文件）。
//
// 数据来自 GET /api/localtasks/chain?<q>，后端 taskChain() 的 tree 字段是
// 结构真相（祖先路径 + 自身 + 后代子树，防环）；点节点开任务页。
import { useEffect, useState } from 'react';
import { Icon } from '../../components/icons.jsx';
import { getTaskChain } from './api.js';
import type { ChainTreeNode } from '../dir/task-utils.js';

// 状态点沿用进程卡三色词表（pending→wait / claimed→run / done→done）；
// cancelled 单列。缩进 = 树深；边类型 tag 区分「反馈」轮次与「评论」旁支。
const CHAIN_STATUS: Record<string, string> = { pending: 'wait', claimed: 'run', done: 'done', cancelled: 'cancel' };
const CHAIN_KIND: Record<string, string> = { reopen: '反馈', comment: '评论', feedback: '反馈' };

function ChainTreeItem({ node, depth, onOpen }: {
  node: ChainTreeNode;
  depth: number;
  onOpen: (id: number | string, dirKey?: string) => void;
}) {
  const st = CHAIN_STATUS[String(node.status || '')] || '';
  const kind = node.forkKind ? (CHAIN_KIND[node.forkKind] || node.forkKind) : '';
  return (
    <>
      <button
        type="button"
        className={`mdw-prog-tnode${node.current ? ' current' : ''}`}
        style={{ paddingLeft: 10 + depth * 18 }}
        title={node.excerpt || `任务 #${node.id}`}
        onClick={() => onOpen(node.id, node.key || undefined)}
      >
        <span className={`st ${st}`} />
        <span className="n">#{node.id}</span>
        {kind && <span className="rp-ptag mdw-prog-tkind">{kind}</span>}
        {node.missing && <span className="mdw-prog-tmiss">已不在队列</span>}
        <span className="tx">{node.excerpt || '—'}</span>
      </button>
      {(node.children || []).map((c) => (
        <ChainTreeItem key={`${node.id}:${c.id}`} node={c} depth={depth + 1} onOpen={onOpen} />
      ))}
    </>
  );
}

/** 链视图定位：组模式带所在队列 key，目录模式带 cwd；二者必有其一。 */
export interface ChainViewTarget {
  id: number;
  key?: string;
  cwd?: string;
}

export function ChainView({ target, onBack, onOpen }: {
  target: ChainViewTarget;
  onBack: () => void;
  onOpen: (id: number, dirKey?: string) => void;
}) {
  const [tree, setTree] = useState<ChainTreeNode | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setErr('');
    const q = target.key
      ? `key=${encodeURIComponent(target.key)}&id=${target.id}`
      : `cwd=${encodeURIComponent(target.cwd || '')}&id=${target.id}`;
    getTaskChain(q)
      .then((d) => {
        if (!cancelled) setTree((d && d.tree) || null);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message || String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [target.id, target.key, target.cwd]);

  return (
    <div className="mdw-prog-chain">
      <div className="mdw-prog-chain-h">
        <button type="button" className="mdw-prog-chain-back" onClick={onBack}>
          <Icon name="back" size={12} title={undefined} />
          返回列表
        </button>
        <span className="t">任务链 #{target.id}</span>
      </div>
      {err ? <div className="mdw-prog-empty">任务链读取失败：{err}</div> : null}
      {!err && !tree ? <div className="mdw-prog-empty">载入中…</div> : null}
      {tree ? (
        <div className="mdw-prog-tree">
          <ChainTreeItem node={tree} depth={0} onOpen={(id, dk) => onOpen(Number(id), dk)} />
        </div>
      ) : null}
      <div className="mdw-prog-note">链是树：每个节点都可以反馈分叉。点节点打开任务页。</div>
    </div>
  );
}
