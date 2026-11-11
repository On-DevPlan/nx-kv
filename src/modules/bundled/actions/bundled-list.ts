// bundled.list —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { bundledListInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { renderList } from '../support.js';
const service: any = serviceNs;

export class BundledListAction extends ActionBase {
  @action({
    id: 'bundled.list',
    cli: [['skill', 'list'], ['skill', 'install', '--list'], ['bundled', 'list']],
    http: ['GET', '/api/bundled'],
    summary: '列出包内自带 skill（含文件数与描述）+ 默认装哪个 + 有哪些 group',
    input: bundledListInput,
    render: renderList,
  })
  async list(__ctx: any, meta: any = {}) {

          const info: any = await service.groupsInfo();
          if (meta.transport !== 'http') return info;
          const details: any = await service.listBundledSkills();
          // 展开顺序要紧：info.skills 是**名字数组**，details 是**对象数组**
          // （{name,dir,files,description}）。先铺 info、再压 details，否则
          // skills 会被覆盖回字符串数组 —— 面板与 smoke 读 skills[].name 全变 undefined。
          return {
            ...info,
            defaultDir: service.DEFAULT_SKILLS_DIR,
            // smoke 与面板都在读 skills[].name —— HTTP 侧保持这个形状
            skills: details,
            details,
          };
      
  }
}
