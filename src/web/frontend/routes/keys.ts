// 全局池的固定 key（#/global → key=__GLOBAL__）。
// 单独一处：dir 路由要用它判「全局池」，而 route-map 从 routes 反向依赖会成环。
export const GLOBAL_KEY = '__GLOBAL__';
