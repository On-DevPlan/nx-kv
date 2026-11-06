# 模板引擎选型（实测）

> 结论先说：**用 Handlebars**（唯一在「原型链防护 / 独占行剥离 / 单遍渲染」三项都符合的），
> 但 `noEscape: true` 必须开，且条件段一律写 `{{#if}}`，不要写 `{{#x}}`。
> 如果不想引入运行时依赖，就保留现在这份 200 行原型 —— 它已经按契约跑通了 19 条断言。
>
> 实测环境：node 22.22.2，handlebars 4.7.10 / liquidjs 10.30.1 / mustache 4.2.0。

---

## 一、契约（先定判据，再看库）

模板正文是**用户能改的**，所以这四条是硬要求：

1. **不能执行任意 JS** —— 用户能编辑的文本绝不能变成代码。
2. **不能泄漏原型链** —— `{{constructor}}` 这种不该拿到对象。
3. **单遍渲染** —— 插入的值不再被扫描。任务正文里出现 `{{...}}` 必须逐字原样。
4. **独占一行的块标记不留空行** —— 段落没命中时不能凭空多出一行；否则交付文本会到处是空洞。

## 二、实测对照

| 检查项 | Handlebars | LiquidJS | Mustache |
|---|---|---|---|
| 缺失变量 → 空串 | ✅ | ✅ | ✅ |
| 默认 HTML 转义 | ⚠️ **默认转义**，需 `noEscape: true` | ✅ 不转义 | ⚠️ 需 `{{{x}}}` |
| 列表 + 项内条件 | ✅ `{{#each}}` + `{{#if this.tag}}` | ⚠️ `{% if d.tag %}` **空串为真**，得写 `!= ''` | ✅ `{{#docs}}…{{/docs}}` |
| 条件段是否切换上下文 | ⚠️ `{{#goal}}` **会切**，必须用 `{{#if goal}}` | ✅ `{% if %}` 不切 | ✅ 会切但回退查找父级，恰好不坏 |
| 段落丢弃后不留空行 | ✅ **自动剥离独占行的块标记** | ❌ 留空行（`头\n\n尾`） | ✅ 自动剥离 |
| 单遍渲染 | ✅ | ✅ | ✅ |
| 原型链防护 | ✅ `{{constructor}}` → 空 | ✅ → 空 | ❌ **`[object Object]`** |
| 共享片段 | ✅ partials | ✅ include | ✅ partials |
| 依赖 | 4 个（minimist / neo-async / source-map / wordwrap） | 1 个（commander） | **0 个** |
| 整包体积 | 2888 KB（`handlebars.min.js` 89 KB） | 1897 KB | 111 KB（单文件 23 KB） |

三条实测证据（可直接复现）：

```
handlebars  {{#goal}}{{goal.durationHuman}}|{{durationHuman}}{{/goal}}
            → "|2 小时"          ← 切了上下文，父级的 goal 取不到
handlebars  {{#if goal}}{{goal.durationHuman}}{{/if}}
            → "2 小时"           ← 不切，正确
mustache    {{constructor}}
            → "[object Object]"  ← 原型链漏了
liquid      {% if d.tag %}…{% endif %}  对空字符串
            → 照常输出            ← 空串在 Liquid 里是 truthy
```

## 三、为什么是 Handlebars

1. **独占行剥离**正好是我们要的那条「不折叠空白」契约 —— 它连块标记所在的那一整行都吃掉，
   段落没命中时不留空行，命中时也不多空行。这条我在自研原型里手写了 30 行才做对。
2. **原型链防护**内建（4.x 起有 proto-access-control）。Mustache 没有，而模板是用户能编辑的。
3. **partials** 可以直接映射成库里的另一条模板 —— 「公共片段 + 组合」不用另发明机制。
4. 支持 `\{{` 转义字面花括号，比我们原来「正文无法表达字面 `{{`」的限制少一个坑。

## 四、两个必须写进代码的注意事项

**1. `noEscape: true` 一定要开。**
Handlebars 默认按 HTML 转义，markdown 里的 `'` `"` `<` 会变成 `&#x27;` `&quot;` `&lt;`。
交付给 agent 的提示词里出现这些实体，会像乱码。实测确认过：
`it's "a" & <b>` → `it&#x27;s &quot;a&quot; &amp; &lt;b&gt;`。

**2. 条件段一律 `{{#if x}}`，禁止裸 `{{#x}}`。**
裸段在 Handlebars 里是「以 x 为上下文渲染」，`{{#goal}}{{goal.durationHuman}}{{/goal}}`
会渲染成空 —— 因为切进 `goal` 之后就没有 `goal` 这个键了。
`{{#if goal}}` 只判断真假、不换上下文，才是我们要的语义。

文档里现有的写法（`{{#goal}}…{{/goal}}`）要统一改成 `{{#if goal}}`。
渲染原型 `prompt-render.mjs` 已同时支持两种，方便过渡。

## 五、变量字典与引擎无关

`templates.vars_schema` 是**我们自己的元数据**，跟用哪个引擎没关系：

```json
[{ "key": "goal.durationHuman", "type": "string", "label": "约定时长",
   "source": "builtin", "usage": "{{goal.durationHuman}}", "required": true }]
```

前端拿它渲染表单、按 `usage` 显示占位符写法；`source='custom'` 的才给输入框，
`builtin` 的只做展示（值来自任务/仓库/组数据）。

**不需要视图，也不需要单独的表。** 模板就一行，`vars_schema` 是这个行里的一个字段，
前端拿到模板对象直接读数组、按顺序渲染表单即可：

```sql
SELECT id, category, name, vars_schema FROM templates WHERE deleted_at IS NULL;  -- 列表
SELECT * FROM templates WHERE id = ?;                                            -- 编辑页
```

真要跨模板反查（「哪些模板用到 goal.*」），一条 `json_each` 就够，不必固化成视图：

```sql
SELECT t.id FROM templates t, json_each(t.vars_schema) j
 WHERE json_extract(j.value, '$.key') = ? AND t.deleted_at IS NULL;
```

## 六、还要补一道保存时校验

`undeclaredVars(body, schema)`：正文里用了、但 `vars_schema` 没声明的变量。
不查的话，用户改了正文加 `{{xxx}}`，前端表单里没有这个字段，值永远是空 —— **静默丢值**。
实测能检出：

```
body: {{repo.name}} 和 {{undefinedThing}}   schema: [repo.name]
→ 未声明: ['undefinedThing']
```
