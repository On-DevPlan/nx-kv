// attachment 插件（order 20）：附件识别。数据变换（attachTemplateCtx）留在
// tasktool/attach-template.ts（依赖 attach-resource 的标注工具链，随插件搬会牵动
// 三处引用）——插件消费宿主取数标注后的 attach 对象，schema 声明变量目录。
import { z } from 'zod';
import { PromptPlugin } from '../base.js';

const schema = z.strictObject({
  // 内层 looseObject 且字段全 optional：attach 对象由宿主（attachTemplateCtx）构造，
  // schema 的校验职责收敛在「顶层段键 ∈ writes」（strictObject），子形状是变量目录
  attach: z.looseObject({
    count: z.number().optional(),
    inlineCount: z.number().optional(),
    areaCount: z.number().optional(),
    hasInline: z.boolean().optional(),
    hasArea: z.boolean().optional(),
    list: z.array(z.looseObject({})).optional(),
  }).nullable(),
});

export class AttachmentPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'attachment';
  readonly order = 20;
  readonly tag = 'nx-kv.attachment';
  readonly label = '附件识别';
  override readonly writes = ['attach'];
  readonly dataSchema = schema;

  /** deps.attach：attachTemplateCtx(attachments).attach（无附件 → null） */
  constructor(template: string, private readonly deps: { attach: unknown }) {
    super(template);
  }

  protected data() {
    return { attach: (this.deps.attach ?? null) as z.infer<typeof schema>['attach'] };
  }
}
