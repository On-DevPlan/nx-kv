// 编程入口的兼容垫片：注册 tsx loader 后转发到 TS 源码。
//
// 为什么存在：package.json 的 main/exports 面向「不带 tsx 的普通 Node import」。
// 真相源是 index.ts（与 CLI / dev / 测试同一条执行路径），这里只负责让
// `import('nx-kv')` 在任何 Node 进程里都能跑通——垫片先注册 loader 再转发，
// 转发发生在同一模块图里，不存在「第二份实现」。
// 库内代码请直接 import './index.ts'；这个垫片只服务包外消费方。
import { register } from 'tsx/esm/api';

register();

export * from './index.ts';
