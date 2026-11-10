// templates / settings 阶段：templates.json → templates；本机设置与偏好白名单 → settings。
import { CONFIG_PREF_KEYS, jsonText, LOCALTASK_SETTING_KEYS } from './data.js';

export function importTemplates(db, templatesData, atMs, report) {
  const list = Array.isArray(templatesData && templatesData.templates) ? templatesData.templates : [];
  const defaultId = String((templatesData && templatesData.defaultId) || '');
  list.forEach((t, index) => {
    const id = String((t && t.id) || '').trim();
    if (!id) return;
    // legacy 只有"新建任务的骨架正文"这一种用途 → category='newtask'
    // is_default 一律先落 0：类目的「唯一位」可能已被内置 seed 占住
    //（ux_templates_default 每类目最多一个），下面循环外统一两步落默认。
    db.run(
      `INSERT INTO templates (id, category, name, slot, body, vars_schema, vars, is_default,
                              enabled, sort_order, builtin, state, version, deleted_at,
                              created_at, updated_at)
       VALUES (:id, 'newtask', :name, 'suffix', :body, '[]', :vars, 0,
               1, :sort, :builtin, '', 0, NULL, :at, :at)
       ON CONFLICT(id) DO NOTHING`,
      {
        id,
        name: String(t.name || id),
        body: String(t.body || ''),
        vars: jsonText(t.values && typeof t.values === 'object' ? t.values : {}),
        sort: index,
        builtin: t.builtin ? 1 : 0,
        at: atMs,
      }
    );
    report.imported.templates += 1;
  });
  // defaultId → is_default 列。两步落：先摘掉类目里已有的默认，再点亮 defaultId
  // 指的那行（defaultId 对不上任何行时保持原默认 —— 与旧 normalize 同兜底）。
  if (defaultId) {
    db.run("UPDATE templates SET is_default = 0 WHERE category = 'newtask' AND is_default = 1");
    db.run(
      "UPDATE templates SET is_default = 1, updated_at = :at WHERE id = :id AND category = 'newtask'",
      { id: defaultId, at: atMs }
    );
  }
}

function setSetting(db, key, value, atMs) {
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (:k, :v, :at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { k: key, v: jsonText(value), at: atMs }
  );
}

export function importSettings(db, localtasksData, configData, atMs, report) {
  const lt = (localtasksData && localtasksData.settings) || null;
  if (lt && typeof lt === 'object') {
    for (const k of LOCALTASK_SETTING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(lt, k)) continue;
      setSetting(db, 'lt.' + k, lt[k], atMs);
      report.imported.settings += 1;
    }
  }
  if (configData && typeof configData === 'object') {
    // 白名单写入：**只**这四个偏好。token / baseUrl / email / userId / groupId
    // 是凭据与会话身份，绝不允许进库（库会被备份、dump、拷走排障）。
    for (const k of CONFIG_PREF_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(configData, k)) continue;
      setSetting(db, 'app.' + k, configData[k], atMs);
      report.imported.settings += 1;
    }
  }
}
