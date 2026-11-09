// 模板表的窄仓储：一次调用 = 一条（或一小簇）语句。
//
// 与 localtask/repos 的 repo 同一纪律：返回纯对象；不存在返回 null（不抛）；
// 写路径经 txw；SQL 只出现在 repo 层。
//
// 「默认模板」的落点：schema 的 `is_default` 列（每 category 唯一，由
// ux_templates_default 部分索引强制）——它就是旧 store 的 defaultId，
// 一列两用：`WHERE category=:c AND is_default=1` 即 defaultId。
// （T06 任务书里写的是落 settings 表 `tpl.defaultId`；实际落 is_default 列，
// 理由见 service.js 头注释的偏差说明。）
import { db, txw } from './open.js';

/** 全部模板行（含禁用；软删的排除）。稳定序：category → sort_order → id。 */
export function listRows(conn = db(), { category = '' } = {}) {
  const where = category
    ? "WHERE deleted_at IS NULL AND category = :category"
    : 'WHERE deleted_at IS NULL';
  return conn.all(
    `SELECT * FROM templates ${where} ORDER BY category, sort_order, id`,
    category ? { category } : {}
  );
}

/** 按 id 取行（软删的查不到）。 */
export function getRow(id, conn = db()) {
  return (
    conn.get('SELECT * FROM templates WHERE id = :id AND deleted_at IS NULL', { id: String(id || '') }) ||
    null
  );
}

/** 某类目的默认模板行（没有则 null）。 */
export function getDefaultRow(category, conn = db()) {
  return (
    conn.get(
      'SELECT * FROM templates WHERE category = :c AND is_default = 1 AND deleted_at IS NULL LIMIT 1',
      { c: String(category || '') }
    ) || null
  );
}

/**
 * upsert 一行（INSERT OR IGNORE —— **绝不覆盖已有行**：内置模板的出厂 seed 与
 * legacy 导入都走这里，用户改过的 body / vars 不能被任何引导逻辑覆盖）。
 */
export function insertIfAbsent(conn, row) {
  conn.run(
    `INSERT INTO templates (id, category, name, slot, body, vars_schema, vars, is_default,
                            enabled, sort_order, builtin, state, version, deleted_at,
                            created_at, updated_at, scope, origin_topic)
     VALUES (:id, :category, :name, :slot, :body, :schema, :vars, :isDefault,
             :enabled, :sort, :builtin, '', 0, NULL, :created, :updated, :scope, :originTopic)
     ON CONFLICT(id) DO NOTHING`,
    {
      id: row.id,
      category: row.category || 'newtask',
      name: row.name || row.id,
      slot: row.slot || 'suffix',
      body: row.body,
      schema: rowJson(row.varsSchema, '[]'),
      vars: rowJson(row.vars, '{}'),
      isDefault: row.isDefault ? 1 : 0,
      enabled: row.enabled === 0 ? 0 : 1,
      sort: Number(row.sortOrder) || 0,
      builtin: row.builtin ? 1 : 0,
      created: row.createdAtMs,
      updated: row.updatedAtMs,
      // 可见域（v3）：数组归一在 service 层做完，这里只管落库形状
      scope: rowJson(row.scope, '["*"]'),
      originTopic: String(row.originTopic || ''),
    }
  );
}

/** 更新内容列（只动传入的字段）。返回是否存在。 */
export function updateRow(conn, id, patch, atMs) {
  const sets = [];
  const params = { id: String(id || ''), at: atMs };
  if (patch.name !== undefined) {
    sets.push('name = :name');
    params.name = String(patch.name);
  }
  if (patch.body !== undefined) {
    sets.push('body = :body');
    params.body = String(patch.body);
  }
  if (patch.vars !== undefined) {
    sets.push('vars = :vars');
    params.vars = rowJson(patch.vars);
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = :enabled');
    params.enabled = patch.enabled ? 1 : 0;
  }
  if (patch.scope !== undefined) {
    sets.push('scope = :scope');
    params.scope = rowJson(patch.scope, '["*"]');
  }
  // origin_topic 不进 updateRow：它是创建事实（v3 裁决），不随编辑改写
  if (!sets.length) return !!getRow(id, conn);
  sets.push('updated_at = :at');
  const r = conn.run(`UPDATE templates SET ${sets.join(', ')} WHERE id = :id AND deleted_at IS NULL`, params);
  return Number(r.changes) > 0;
}

const rowJson = (v, fallback) => {
  if (v === undefined || v === null) return fallback;
  return typeof v === 'string' ? v : JSON.stringify(v);
};

/**
 * 设某类目的默认模板：先摘掉该类目现默认，再点亮目标。
 * ux_templates_default（每 category 唯一）保证不会出现两个默认。
 */
export function setDefault(conn, category, id, atMs) {
  conn.run(
    'UPDATE templates SET is_default = 0, updated_at = :at WHERE category = :c AND is_default = 1',
    { c: String(category || ''), at: atMs }
  );
  conn.run(
    'UPDATE templates SET is_default = 1, updated_at = :at WHERE id = :id AND deleted_at IS NULL',
    { id: String(id || ''), at: atMs }
  );
}

/** 硬删一行（内置模板不可删是 service 层的规则）。返回是否存在。 */
export function deleteRow(conn, id) {
  const r = conn.run('DELETE FROM templates WHERE id = :id', { id: String(id || '') });
  return Number(r.changes) > 0;
}

/** 该类目下一个可用的 sort_order（追加到末尾）。 */
export function nextSortOrder(conn, category) {
  const row = conn.get('SELECT COALESCE(MAX(sort_order), -1) AS m FROM templates WHERE category = :c', {
    c: String(category || ''),
  });
  return Number((row && row.m) || -1) + 1;
}

/**
 * 主题的三把钥匙（key / repo_key / group_key）——scope 判定只认这三列。
 * 查无此主题返回 null（service 层降级为「只按裸 key 命中 + 全局」）。
 * topics 是共享存储，这里只读三列，不复制 localtask 的仓储逻辑。
 */
export function getTopicKeys(key, conn = db()) {
  return (
    conn.get(
      'SELECT key, repo_key, group_key FROM topics WHERE key = :key AND deleted_at IS NULL',
      { key: String(key || '') }
    ) || null
  );
}

/** 事务入口的窄转发。 */
export { txw };
