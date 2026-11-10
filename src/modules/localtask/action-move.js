// 本机 ⇄ 云端迁移 action（自 index.js 拆出）：面板与 CLI 同构（原型设计稿 §5/§7.3）。
import * as move from './move.js';
import { CWD, KEY } from './action-flags.js';

export const moveActions = [
  {
    id: 'task.move',
    cli: ['task', 'move'],
    http: ['POST', '/api/task/move'],
    summary:
      '在本机队列与云端清单之间迁移任务（先写目标端、成功才改源端；--undo 按返回的 target-id 精确撤销）',
    flags: {
      from: { type: 'string', enum: ['local', 'cloud'], hint: '迁移源' },
      to: { type: 'string', enum: ['local', 'cloud'], hint: '迁移目标' },
      // 源/目标定位：local 侧用 --id + (--cwd|--key)；cloud 侧用 --topic + --text
      id: { type: 'number', hint: '本机任务编号（from=local 时必填）' },
      cwd: CWD,
      key: KEY,
      topic: { type: 'string', hint: '云端主题（= 目录名；from=cloud 必填，to=cloud 缺省用目录名）' },
      text: { type: 'string', hint: '云端任务内容（from=cloud 时按内容定位）' },
      pick: { type: 'number', hint: '云端同内容多条时的编号（消歧）' },
      merge: { type: 'boolean', hint: '目标端已有同内容时合并到已有条目（不新增）' },
      group: { type: 'number', hint: '云端工作空间 id（默认取当前）' },
      undo: { type: 'boolean', hint: '撤销一次迁移（配合 --target-id 与原 move 参数）' },
      'target-id': { type: 'number', hint: '撤销用：迁移时返回的 targetId' },
      'tombstone-id': { type: 'number', hint: '撤销 local→cloud 时可显式指定本机迁出条目编号（缺省用 --id）' },
    },
    run: (ctx) =>
      move.moveTask({
        from: ctx.from,
        to: ctx.to,
        id: ctx.id,
        cwd: ctx.cwd,
        key: ctx.key,
        topic: ctx.topic,
        text: ctx.text,
        pick: ctx.pick,
        merge: ctx.merge,
        group: ctx.group,
        undo: ctx.undo,
        'target-id': ctx['target-id'],
        'tombstone-id': ctx['tombstone-id'],
      }),
    render: (d) => {
      if (d.undone) {
        return d.from === 'local'
          ? `已撤销: 云端「${d.topic}」的条目已删除，本机「${d.dirName}」#${d.tombstoneId} 回到待领取`
          : `已撤销: 本机「${d.dirName}」#${d.targetId} 已移除，云端「${d.topic}」已恢复`;
      }
      const head =
        d.from === 'local'
          ? `本机「${d.dirName}」#${d.tombstoneId} → 云端「${d.topic}」（${d.merged ? `合并到已有条目 #${d.targetId}` : `新待办 #${d.targetId}`}）`
          : `云端「${d.topic}」 → 本机「${d.dirName}」（待领取首位 #${d.targetId}）`;
      const tail = d.from === 'local' ? `\n原位置留有迁出记录（可在面板跳转/移除；task move --undo 撤销）` : '';
      return head + (d.dupCount ? `\n（目标端原有 ${d.dupCount} 条同内容）` : '') + tail;
    },
  },
];
