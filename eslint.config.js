// ESLint 扁平配置。
//
// 这里主要管的不是代码风格（那个交给约定与编辑器），而是**分层约束**：
// 把「谁可以依赖谁」写成机器可检查的规则。架构意图一旦只写在文档里，
// 就会随提交次数慢慢衰减；写成 lint 规则则会当场拦下。
import { defineConfig } from 'eslint/config';

const BASE_RULES = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-undef': 'off', // 浏览器/Node 全局混用，靠运行时暴露；装 globals 包不值得
  eqeqeq: ['error', 'smart'],
  'prefer-const': 'error',
  'no-var': 'error',
  'no-console': 'off', // CLI 工具，输出就是产品
};

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
    ignores: ['src/web/public/**', 'node_modules/**', '.tool/**', '.claude/**'],
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

  // ---- todo 模块：禁止按 id 定位 ----
  {
    files: ['src/modules/todo/**/*.{js,jsx}'],
    rules: { 'no-restricted-syntax': ['error', ...TODO_NO_ID_LOOKUP] },
  },

  // ---- 分层约束 ----
  {
    // core 是零业务语义的基础层：常量、存储、git、diff、文件树、错误。
    // 它一旦依赖上层，复用性就没了——而这些正是别的项目要照搬的部分。
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../modules/**', '../runtime/**', '../web/**'],
              message: 'core 是最底层，不得依赖 modules / runtime / web。',
            },
          ],
        },
      ],
    },
  },
  {
    // 功能域模块之间禁止互相依赖。需要共享的东西下沉到 core/。
    // 唯一的只读例外是 settings（基础模块），故不在禁列。
    files: ['src/modules/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../repos/*', '../skills/*', '../github/*', '../bundled/*', '../system/*'],
              message: '模块之间不得互相依赖；共享逻辑请下沉到 core/。唯一例外是 ../settings/service.js。',
            },
          ],
        },
      ],
    },
  },
  {
    // system 是刻意的聚合模块（bootstrap 要一次拿齐各模块状态），是上述规则的例外
    files: ['src/modules/system/**/*.js'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // 前端：这条规则的价值最高——把 Node 侧代码 import 进视图，
    // Vite 会把 node: 内置模块一起打进浏览器包，构建期报错或运行期炸掉。
    files: ['src/web/frontend/**/*.{js,jsx}'],
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
              group: ['**/modules/*/index.js', '**/modules/*/service.js', '**/runtime/**', '**/core/**'],
              message:
                '前端只能 import 模块的 view.jsx。index.js/service.js/runtime/core 是 Node 侧代码，拖进浏览器包会把 node: 内置模块一起带进来。',
            },
          ],
        },
      ],
    },
  },
]);
