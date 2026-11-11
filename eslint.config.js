// ESLint 扁平配置。
//
// 这里主要管的不是代码风格（那个交给约定与编辑器），而是**分层约束**：
// 把「谁可以依赖谁」写成机器可检查的规则。架构意图一旦只写在文档里，
// 就会随提交次数慢慢衰减；写成 lint 规则则会当场拦下。
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const BASE_RULES = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-undef': 'off', // 浏览器/Node 全局混用，靠运行时暴露；装 globals 包不值得
  eqeqeq: ['error', 'smart'],
  'prefer-const': 'error',
  'no-var': 'error',
  'no-console': 'off', // CLI 工具，输出就是产品
};

// TS 文件的基础规则：unused 检查交给 @typescript-eslint（认得出类型层的用法，
// no-unused-vars 的 JS 版会把「参数声明了类型但没读」误报）；no-undef 交给 tsc。
const TS_BASE_RULES = {
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  // 迁移期允许 any：从 legacy JS 迁来的 action 体与服务层绑定还没类型化
  // （契约由入口的 zod schema 把关，类型化随服务层毕业推进逐步收紧）。
  '@typescript-eslint/no-explicit-any': 'warn',
  eqeqeq: ['error', 'smart'],
  'prefer-const': 'error',
  'no-var': 'error',
  'no-console': 'off',
};

// TS 专属规则的文件范围（typescript-eslint 的部分推荐条目不带 files，
// 展开前必须补上，否则会误伤存量 .js/.jsx）。
const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];

// runtime 的**装配层**（模块不得 import：registry → modules → runtime → registry 会成环）。
// runtime 的类型/装饰器/容器层不在此列——模板形态下模块必须 import 它们。
const RUNTIME_ASSEMBLY_BAN = [
  '../../runtime/cli.js',
  '../../runtime/cli.ts',
  '../../runtime/registry.js',
  '../../runtime/registry.ts',
  '../../runtime/server.js',
  '../../runtime/server.ts',
  '../../runtime/api.js',
  '../../runtime/api.ts',
  '../../runtime/spec.js',
  '../../runtime/spec.ts',
  '../../runtime/help.js',
  '../../runtime/help.ts',
  '../../runtime/codegen.js',
  '../../runtime/codegen.ts',
];

// 清单定位的硬约束，写成 lint 规则让它在编辑器和 CI 里立刻拦下。
//
// 背景：待办的 id **非常容易重复**（分配只扫「待办 + 冻结」，会被复用），
// 拿它当定位键迟早改错数据。定位一律用任务**内容**（--ref）。
//
// ⚠️ 只保留这一条，是因为其余几种「按 id 定位」的写法在语法上与**正确**的写法
// 无法区分：`{ id: nextTaskId(...) }`（分配新 id）、`{ task, id: task.id }`（回传）、
// `#{t.id}`（展示）都是合法的。加规则抓它们会先对着正确代码报错——
// 一条会误伤的规则比没有这条规则更糟：它会逼人写 eslint-disable，然后彻底失效。
//
// 所以这里只钉住一种**语法上就说得清**的形式：拿任务的 id 去拼定位路径。
// 剩下的靠 service.js 的契约注释、registry 的装载期自检，以及 code review。
const TODO_NO_ID_LOOKUP = [
  {
    // 模板拼 URL：`/api/todo/${t.id}` —— 定位路径只能是不含变量的字面量
    selector: "TemplateLiteral[quasis.0.value.raw=/api\\/todo\\//]:not([expressions.length=0])",
    message: '别用任务 id 拼定位路径：id 会重复。走 /api/todo/item + body.ref（任务内容）。',
  },
];

export default defineConfig([
  {
    // dist/** 因带斜杠被锚定在仓库根，嵌套的构建产物目录要显式列出
    ignores: ['src/web/public/**', 'src/web/frontend/dist/**', 'node_modules/**', '.tool/**', '.claude/**', '.workbuddy/**', 'plan/**', 'dist/**', 'temp/**'],
  },
  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: BASE_RULES,
  },

  // ---- TypeScript：typescript-eslint 推荐集 + TS 版基础规则 ----
  //
  // 不开 type-aware 规则（那需要 parserOptions.project，lint 会慢一个量级）；
  // 类型正确性由 `pnpm typecheck`（tsc -b，strict）把关，这里只管语法层。
  //
  // ⚠️ recommended 里有两个条目**不带 files**（base / recommended 本身）——
  // 直接展开会让 TS 专属规则跑到 .js/.jsx/.mjs 上（存量前端代码会被
  // @typescript-eslint/no-unused-expressions 之类误伤）。这里给它们补上
  // TS 专属的 files 范围，TS 用推荐集、JS 继续用 BASE_RULES。
  ...tseslint.configs.recommended.map((c) => (c.files ? c : { ...c, files: TS_FILES })),
  {
    files: ['**/*.{ts,tsx}'],
    rules: TS_BASE_RULES,
  },
  {
    // codegen 产物：生成物不追求「手写级」整洁（长 import 块、必要的类型断言）
    files: ['**/*.generated.ts'],
    rules: {
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
    },
  },

  // ---- todo 模块：禁止按 id 定位 ----
  {
    files: ['src/modules/todo/**/*.{js,jsx,ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...TODO_NO_ID_LOOKUP] },
  },

  // ---- 分层约束 ----
  {
    // core 是零业务语义的基础层：常量、存储、git、diff、文件树、错误。
    // 它一旦依赖上层，复用性就没了——而这些正是别的项目要照搬的部分。
    files: ['src/core/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../modules/**', '../runtime/**', '../web/**', '../shared/**'],
              message: 'core 是最底层，不得依赖 modules / runtime / web / shared。',
            },
          ],
        },
      ],
    },
  },
  {
    // 功能域模块之间禁止互相依赖。需要共享的东西下沉到 core/。
    // 唯一的只读例外是 system（聚合模块），单独在下面放开。
    files: ['src/modules/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // 枚举式互依禁列：新增模块必须在此补 '../<新模块>/*'，漏补是静默的
              group: ['../repos/*', '../skills/*', '../github/*', '../bundled/*', '../system/*', '../todo/*', '../sessiontask/*'],
              message: '模块之间不得互相依赖；共享逻辑请下沉到 core/。唯一例外是 ../settings/service.js。',
            },
            {
              // 后端模块不得依赖前端：面板只通过 HTTP /api 拿数据。
              // 两端都要用的纯函数放 src/shared/（见下面那条 shared 规则）。
              group: ['../web/**', '../../web/**', '**/web/frontend/**'],
              message: '后端模块不得 import 前端代码：前端只通过 /api 消费后端，跨端纯函数放 src/shared/。',
            },
            {
              // 反向同理：registry → modules → runtime → registry 会成环。
              // 需要运行期数据（命令表之类）时，由 runtime 传给模块的纯函数，而不是模块去拿。
              //
              // 例外：**runtime 的类型/装饰器/容器层**（types/module、action-base、
              // action-decorator、container）是模板形态的公共契约，模块按模板写就得 import
              // 它们（ModuleBase 基类、@action 装饰器、IoC 容器）。它们**不 import
              // registry**，所以不成环——禁的是 runtime 的**装配层**（cli / registry /
              // server / api / spec / help / codegen）。
              group: RUNTIME_ASSEMBLY_BAN,
              message:
                '模块不得依赖 runtime 的装配层（会成环）：只能用 runtime 的类型/装饰器/容器层' +
                '（types/module、action-base、action-decorator、container）；运行期数据由 runtime 注入模块的纯函数。',
            },
          ],
          paths: [
            { name: 'react', message: '后端模块里不许出现 react（视图归 src/web/frontend/）。' },
            { name: 'react-dom', message: '后端模块里不许出现 react（视图归 src/web/frontend/）。' },
          ],
        },
      ],
    },
  },
  {
    // 同构纯函数层：Node 与浏览器加载**同一份**代码（附件语法、双链、frontmatter…），
    // 所以它必须零依赖——碰 node: 就进不了浏览器包，碰第三方包就进不了 Node。
    files: ['src/shared/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../**', 'node:*'],
              message: 'shared 是同构层：除同目录相对引用外不得依赖任何东西。',
            },
          ],
        },
      ],
    },
  },
  {
    // system 是刻意的聚合模块（bootstrap 要一次拿齐各模块状态）：放开「模块互依」，
    // 其余边界照旧 —— 它曾经靠 `await import('../../runtime/cli.js')` 拿命令表，
    // 那正是这条规则要拦的形状（现在改成 core 快照格子传表给 routes 的纯函数）。
    files: ['src/modules/system/**/*.{js,ts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../web/**', '../../web/**', '**/web/frontend/**'],
              message: '后端模块不得 import 前端代码。',
            },
            {
              group: RUNTIME_ASSEMBLY_BAN,
              message:
                '模块不得依赖 runtime 的装配层（会成环）：只能用 runtime 的类型/装饰器/容器层；' +
                '运行期数据由 runtime 注入模块的纯函数。',
            },
          ],
          paths: [
            { name: 'react', message: '后端模块里不许出现 react。' },
            { name: 'react-dom', message: '后端模块里不许出现 react。' },
          ],
        },
      ],
    },
  },
  {
    // 前端：这条规则的价值最高——把 Node 侧代码 import 进视图，
    // Vite 会把 node: 内置模块一起打进浏览器包，构建期报错或运行期炸掉。
    files: ['src/web/frontend/**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: '前端不能引用 Node 内置模块。',
            },
            {
              // 前端只能碰 src/shared/ 的同构纯函数；后端模块里的任何文件都不许读。
              // 相对深度是死的（page/components 一律 4 层回到 src/），真正的兜底是
              // tests/unit/layering.test.mjs —— 它解析真实路径再比对层次。
              group: ['**/modules/*/index.js', '**/modules/*/service.js', '../../../../modules/**', '../../../modules/**'],
              message:
                '前端只通过 /api 拿数据（跨端纯函数在 src/shared/）。拖进后端模块会把 node: 内置模块带进浏览器包。',
            },
          ],
        },
      ],
    },
  },

  {
    // 生成的 typed client 例外：它 type-only 引后端 schema 与 action 类
    // （类型契约的单一来源），`import type` 在编译期被擦除——浏览器包里
    // 不会有任何后端代码，node: 内置模块也就进不去。
    // ESLint 的 no-restricted-imports 分不清 type import 与值 import，所以在这
    // 一处显式豁免（文件是 codegen 产物，手改会被下次生成覆盖）。
    files: ['src/web/frontend/api/client.generated.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // ---- 前端：打开 no-undef ----
  //
  // 为什么单独开：全局 `no-undef` 是关掉的（浏览器/Node 全局混用），
  // 但**前端**的全局面其实很小、也很确定，而"写错一个名字 = 整页崩"这件事
  // 代价太高——真实踩过三次：
  //   1. `localtask/view.jsx` 用了 `<CliHints>` 却没 import →「本地任务」页整页报错
  //   2. 同文件用了 `useMemo` 却没 import → 同样整页崩
  //   3. 同文件用了 `dialog(...)` 却没定义 → 点「彻底清除」直接抛异常
  // 三次都只有浏览器能看见，lint 与单测都放行了。
  //
  // 下面这份全局表就是浏览器 + ES2024 的交集，不多不少；
  // 装了 globals 包也省不掉这份"白名单"——前端自己知道该用哪些全局。
  {
    files: ['src/web/frontend/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        // 浏览器
        window: 'readonly', document: 'readonly', location: 'readonly', navigator: 'readonly',
        history: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
        fetch: 'readonly', console: 'readonly', alert: 'readonly', confirm: 'readonly',
        prompt: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
        clearInterval: 'readonly', queueMicrotask: 'readonly', structuredClone: 'readonly', getComputedStyle: 'readonly',
        MutationObserver: 'readonly', ResizeObserver: 'readonly', IntersectionObserver: 'readonly',
        CSS: 'readonly',
        EventSource: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly',
        TextDecoder: 'readonly', Response: 'readonly', Request: 'readonly', Headers: 'readonly',
        // ES
        globalThis: 'readonly', undefined: 'readonly', NaN: 'readonly', Infinity: 'readonly',
        Object: 'readonly', Array: 'readonly', String: 'readonly', Number: 'readonly',
        Boolean: 'readonly', Symbol: 'readonly', BigInt: 'readonly', Math: 'readonly',
        JSON: 'readonly', Date: 'readonly', RegExp: 'readonly', Error: 'readonly',
        TypeError: 'readonly', RangeError: 'readonly', SyntaxError: 'readonly',
        ReferenceError: 'readonly', EvalError: 'readonly', URIError: 'readonly',
        Promise: 'readonly', Map: 'readonly', Set: 'readonly', WeakMap: 'readonly',
        WeakSet: 'readonly', Proxy: 'readonly', Reflect: 'readonly', Intl: 'readonly',
        ArrayBuffer: 'readonly', Uint8Array: 'readonly', Int8Array: 'readonly',
        Uint16Array: 'readonly', Uint32Array: 'readonly', Float32Array: 'readonly',
        Float64Array: 'readonly', DataView: 'readonly', parseInt: 'readonly',
        parseFloat: 'readonly', isNaN: 'readonly', isFinite: 'readonly',
        encodeURIComponent: 'readonly', decodeURIComponent: 'readonly',
        encodeURI: 'readonly', decodeURI: 'readonly',
        // 下载导出物（Blob + createObjectURL）
        Blob: 'readonly',
        // 附件导入（文件 → dataURL）
        FileReader: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },
]);
