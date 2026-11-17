import { PLUGIN_IDS, pluginMeta, templatesOf } from '../src/modules/promptplug/index.js';

const SEED = new Set(['task', 'cwd', 'goal', 'source', 'summary', 'name', 'params']);
const rows = [];
for (const id of PLUGIN_IDS) {
  const p = pluginMeta(id);
  const own = new Set(p.schema.fields.map((f) => f.key.split('.')[0]));
  const tpl = templatesOf(id)[0].text;
  const used = new Set();
  for (const m of tpl.matchAll(/\{\{([^}]*)\}\}/g)) {
    for (const t of m[1].matchAll(/\b([a-z][\w]*)\s*\./g)) used.add(t[1]);
  }
  const foreign = [...used].filter((s) => !SEED.has(s) && !own.has(s));
  rows.push({ id, own: [...own].join(','), used: [...used].sort().join(','), foreign: foreign.join(',') });
}
for (const r of rows) console.log(`${r.id.padEnd(11)} own=${(r.own || '-').padEnd(28)} 引用=${(r.used || '-').padEnd(46)} 跨段=${r.foreign || '无'}`);
