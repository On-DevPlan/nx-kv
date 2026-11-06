// 存储模块（`nx-kv db …`）：状态 / 迁移 / 校验 / 备份。
//
// 这个模块**没有面板**（http: null）：它是给运维与人用的诊断入口，
// 面板上按钮做不了的事（比如"迁移前先 --dry-run 看一眼"）反而是它的主场。
// 按 registry 的约定，「没有 http」是合法的显式声明，不是漏写。
import * as service from './service.js';

export default {
  id: 'db',
  title: '存储（SQLite）',
  order: 90,
  actions: [
    {
      id: 'db.status',
      cli: ['db', 'status'],
      http: null,
      summary: '库状态：路径、user_version、各表行数、任务状态分布（只读，不升级）',
      run: () => service.status(),
      render: (d) => service.renderStatus(d),
    },
    {
      id: 'db.migrate',
      cli: ['db', 'migrate'],
      http: null,
      summary: '迁移：无标志 = 从 legacy JSON 全量导入；版本落后 = 走升级链（含 --dry-run 演练）',
      flags: {
        'dry-run': { type: 'boolean', hint: '演练：事务末尾回滚，库与 JSON 都不改' },
        apply: { type: 'boolean', hint: '显式执行（默认就是执行，此标志让脚本自证意图）' },
      },
      run: (ctx) => service.migrate({ dryRun: ctx['dry-run'] === true, apply: ctx.apply === true }),
      render: (d) => service.renderMigrate(d),
    },
    {
      id: 'db.verify',
      cli: ['db', 'verify'],
      http: null,
      summary: '逐项校验：版本/行数/状态分布/正文哈希/seq 对应/外键/完整性',
      run: () => service.verify(),
      render: (d) => service.renderVerify(d),
    },
    {
      id: 'db.backup',
      cli: ['db', 'backup'],
      http: null,
      summary: 'VACUUM INTO 备份（WAL 下不能直接 copy .db；保留最近 5 份）',
      flags: {
        dir: { type: 'string', hint: '备份目录（缺省 ~/.nx-kv/backups/）' },
        keep: { type: 'number', default: 5, hint: '保留最近几份（0 = 不清理）' },
      },
      run: (ctx) => service.backup({ dir: ctx.dir, keep: ctx.keep }),
      render: (d) => service.renderBackup(d),
    },
  ],
};
