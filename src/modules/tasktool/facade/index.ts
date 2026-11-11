// 对外稳定门面：submit / get（AsyncIterable）+ 兼容 getTask / wait
export { submit, submitTask } from './submit.js';
export { get, getTask } from './get.js';
export { wait, waitForTask } from './wait.js';
