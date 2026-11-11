// templates 仓储门面：模块内统一从这里拿 repo（不直接 import core/db）。
import { openTemplatesStore, resetTemplatesStore, db, txw, resolveTemplatesDb } from './open.js';
import * as templates from './templates.js';

export { openTemplatesStore, resetTemplatesStore, db, txw, resolveTemplatesDb, templates };
export { closeDb, isStoreOpen } from '../../../core/db/index.js';

/** 便捷聚合：`repo.templates.getDefaultRow('newtask')`。 */
export default {
  open: openTemplatesStore,
  reset: resetTemplatesStore,
  db,
  txw,
  resolveTemplatesDb,
  templates,
};
