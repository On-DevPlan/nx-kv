// action 共享的 flag 定义（自 index.js 拆出）：cwd/key 主题定位与 wait 的现状参数。

export const CWD = { type: 'string', hint: '工作目录（作为主题；默认当前目录）' };
export const SUMMARY = { type: 'string', required: true, hint: '当前现状（agent 当前状态，展示给用户）' };
// 任务级寻址的 key flag：全局主题没有 cwd，只能按 key 定位（__GLOBAL__）
export const KEY = { type: 'string', hint: '主题 key（与 --cwd 二选一；全局任务池固定 __GLOBAL__）' };
