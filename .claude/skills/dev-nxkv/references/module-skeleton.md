# 模块骨架 —— nx-kv 里长一个功能域

> 配套 [[dev-nxkv]]。这里给**可直接抄的骨架**与每一处的理由；字段细节见 [[action-contract]]。

## 分层地图

```
src/
├── core/            跨模块共享的原语（不依赖任何模块）
│   ├── errors.js        badInput / notFound / conflict —— 业务错误的标准三件套
│   ├── paths.js         APP_DIR / DEFAULT_PORT 等路径常量
│   ├── config.js        本机配置与工作空间（group）解析
│   ├── kvapi.js         KV 后端客户端
│   ├── fileapi.js       图床（后端文件）客户端
│   ├── attachstore.js   附件本地镜像
│   ├── fstree.js / zip.js / prompt.js / instruction-template.js / frontmatter.js …
├── modules/<name>/   功能域：service.js（业务真相）+ index.js（action 声明）
├── runtime/          传输壳：cli.js（命令解析）/ api.js（路由分发）/ server.js / registry.js / spec.js
├── index.js          编程入口：导出各模块 service（不是 CLI/HTTP 壳）
└── web/frontend/     React 面板
    ├── App.jsx           壳：工作区、路由、数据轮询
    ├── registry.js       VIEWS：视图 → 归属模块 → 组件（懒加载）
    ├── panels.jsx        PANEL_ORDER、面板工厂、路由 ↔ 面板
    ├── api/client.js     api(path, {method, body}) —— 后端响应 {ok,data} / {ok,error,code}
    ├── page/             页面级视图（dir / group / repos / cloud / overview …）
    ├── components/       可复用组件（sidebar / ui / icons / md / repos / cloud / board）
    ├── modules/md/       纯前端视图模块（MD 工作台）
    └── style.css / style-v2.css   v1 存量 / v2 tokens（新增样式优先 v2）
```

## 后端：一个模块 = service + action 表

`src/modules/<name>/index.js`

```js
// 模块声明：id 唯一、order 决定 CLI/帮助里的排序、view 标记「面板上有它」
import * as service from './service.js';

export default {
  id: 'thing',            // 与目录名一致（registry.test.mjs 靠它对齐）
  title: '某某',
  order: 50,              // 小的靠前
  view: null,             // 或 () => import('../../web/frontend/page/thing/index.jsx')
  actions: [
    {
      id: 'thing.list',
      cli: ['thing', 'list'],
      http: ['GET', '/api/thing'],
      summary: '列出所有某某',
      flags: { limit: { type: 'number', default: 100 } },
      run: (ctx) => service.list(ctx),
      render: (d) => `${d.items.length} 项`,
    },
  ],
};
```

`src/modules/<name>/service.js` —— **业务真相源**：

- 不认识 `argv`、不认识 HTTP：入参是普通对象，返回普通对象；`render` 负责变成人读的一行。
- 错误用 `core/errors.js` 的 `badInput / notFound / conflict`，不要自己造 `new Error`。
- 落盘遵循仓库既有写法：**原子写 + 进程内串行化**
  （写临时文件 → rename；Windows 上 rename 偶发 EPERM，重试几次；并发写用一条 Promise 队列串起来）。
- **身份用 key，不用本地 id**：id 是本机行主键（换机导入后必变），key 才是跨机稳定的身份
  （归一化远程地址派生，或用户自定义）。关系（成员、绑定）一律挂 key。

```js
import { badInput, notFound } from '../../core/errors.js';

export async function list({ limit = 100 } = {}) {
  const s = await loadStore();               // 自己模块的 store 读写
  return { items: s.things.slice(0, limit) };
}
```

## 注册三步（漏了测试就红）

1. `src/modules/<name>/index.js` —— 模块目录有了 `index.js` 才算数
2. `src/runtime/registry.js` —— `import` 进来加进 `MODULES`（按 `order` 排序）
3. `src/web/frontend/registry.js` —— 有面板的话登记 `VIEWS`（每条要带 `module:` 归属）

```js
// src/runtime/registry.js
import thing from '../modules/thing/index.js';
export const MODULES = [/* … */, thing].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
```

```js
// src/web/frontend/registry.js
{ id: 'thing', module: 'thing', component: lazy(() => import('./page/thing/index.jsx')) },
```

> `module.view` 只表示「这个模块在面板上有视图」并给一个惰性入口；
> **真正决定 tab 与路由的是前端 `registry.js` 的 `VIEWS` 与 `panels.jsx`**。
> 视图多已迁到 `src/web/frontend/page/`，此时模块里写
> `view: () => import('../../web/frontend/page/<x>/index.jsx')`（见 `repos` 模块）。

## 前端：视图骨架

```jsx
// src/web/frontend/page/thing/index.jsx
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast, useGuard, useDialog, Modal } from '../../components/ui.jsx';

export default function ThingView() {
  const toast = useToast();
  const guard = useGuard();          // 包住异步动作：出错 toast，不炸 UI
  const { dialog, node: dialogNode } = useDialog();
  const [items, setItems] = useState([]);

  const load = useCallback(async () => {
    setItems(await api('/api/thing').catch(() => []));
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = (it) => guard(async () => {
    await api(`/api/thing/${encodeURIComponent(it.id)}`, { method: 'DELETE' });
    toast(`已删除 ${it.name}`);
    await load();
  });

  return (
    <div className="rp-page">
      {/* 样式用 v2 tokens；语义色：等待=--doing(蓝)、完成=--live(绿)、警示=--wait(琥珀) */}
      <div className="rp-table-wrap">…</div>
      {dialogNode}
    </div>
  );
}
```

要点：

- 后端返回 `{ok:true,data}` / `{ok:false,error,code}`；`api()` 已处理，失败抛 `Error` 且带 `.code`。
- 异步动作用 `guard()` 包；破坏性动作先 `dialog({danger:true})` 确认。
- `console.log` 在本仓库**不拦**（`no-console: off`——CLI 的输出就是产品）；但别留在提交里，
  面板侧要反馈就 toast / 状态位，CLI 侧就用 `render`。
- 新样式优先 `style-v2.css`；`style.css` 是 v1 存量，别往里堆新规则。

## 文件规模

单文件 **≤ 400 行**是警戒线（超过就拆）。仓库里已有的反例：
`src/web/frontend/page/repos/index.jsx` 超千行——改动它要保守，必要时按区块拆组件。

## 共享逻辑放哪

两个模块都要用 → 下沉 `core/`（叶子模块，不反向依赖任何模块）。
需要动态 import 的场景写成「`core/` 里放实现，`modules/` 里放薄壳」——
模块之间**不得**互相 import（`eslint.config.js` 的禁列），新增模块还要把自己补进禁列。
