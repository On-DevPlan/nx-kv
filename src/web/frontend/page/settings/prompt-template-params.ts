// 设置面板「提示词模板」的只读参数速查表：每区块**实际可用**的参数（参数名 + 一句含义）。
// 只做速查，不写语法/示例——引擎名称、选型理由、语法教程、示例模板与成段说明
// 仍然只写在 skill / docs，不放到设置页。
// 数据来自共享 ctx（delivery-template.js 的 buildDeliveryCtx）与 attach 的 attachTemplateCtx。

/** 一组参数（label 是分组名，items 每项 = [参数名, 一句含义]）。 */
export interface BlockParamGroup {
  label: string;
  items: [string, string][];
}

/** 各区块的参数速查表（键 = prompt-blocks 的区块 id）。 */
export type BlockParamTable = Record<string, BlockParamGroup[]>;

export const BLOCK_PARAMS: BlockParamTable = {
  context: [
    {
      label: '项目',
      items: [
        ['repo.name', '项目名'],
        ['repo.intro', '项目主篇正文（唯一自动内嵌的正文）'],
        ['repo.introRefId', '项目主篇 refId（取用：nx-kv docs get --ref <refId>）'],
        ['repo.introDesc', '项目主篇描述'],
        ['repo.docs', '其余项目文档（可循环 desc/title/refId/hasBody/note）'],
        ['repo.docCount', '其余项目文档数'],
        ['repo.refRepos', '本仓库直接绑定的参考仓库（repos 中 type=ref，不是文档库 refs；可循环 name/path/note）'],
        ['repo.refRepoCount', '本仓库直接绑定的参考仓库数'],
      ],
    },
    {
      label: '组',
      items: [
        ['group.name', '组名'],
        ['group.desc', '组定位'],
        ['group.introRefId', '组主篇 refId（取用：nx-kv docs get --ref <refId>）'],
        ['group.introDesc', '组主篇描述'],
        ['group.note', '本项目在组里的位置'],
        ['group.peers', '组内成员（可循环 name/note）'],
        ['group.docs', '组文档（可循环 desc/title/refId/hasBody/note）'],
        ['group.refRepos', '本组绑定的参考仓库（repos 中 type=ref，不是文档库 refs；可循环 name/path/note）'],
        ['group.refRepoCount', '本组绑定的参考仓库数'],
        ['groups', '其余组（可循环 name/desc/path）'],
      ],
    },
    {
      label: '参考仓库',
      items: [
        ['refRepos.list', '直接绑定 ∪ 组级绑定的去重并集（repos 中 type=ref，不是文档库 refs；可循环 name/path/note）'],
        ['refRepos.count', '去重并集的条目数（无绑定时为 0，整段不出现）'],
      ],
    },
    {
      label: '通用',
      items: [
        ['task.id', '任务号'],
        ['task.text', '任务原文'],
        ['params', '外部参数（k=v）'],
      ],
    },
  ],
  attachment: [
    {
      label: '统计',
      items: [
        ['attach.count', '附件总数'],
        ['attach.inlineCount', '正文内嵌数量'],
        ['attach.areaCount', '附件区数量'],
        ['attach.hasInline', '是否有正文内嵌'],
        ['attach.hasArea', '是否有附件区条目'],
        ['attach.needsSyncCount', '需要同步到本地的文件数'],
      ],
    },
    {
      label: '附件条目（通用，attach.list 内循环）',
      items: [
        ['kind', '类型：file / url / task / ref / mdfile / folder'],
        ['kindLabel', '类型显示名：附件/图片/链接/任务/文档/md/文件夹'],
        ['name', '展示名（任务型为实时标题，不是正文）'],
        ['size', '字节数'],
        ['sizeText', '可读大小（1.2 MB）'],
        ['mime', 'MIME 类型'],
        ['storage', '存储来源：local / url / internal'],
        ['role', '关系角色：inline / reference / doc / attach'],
        ['origin', '来源：inline（正文内嵌）/ area（附件区）'],
        ['originLabel', '来源显示名'],
        ['usage', '取用说明（按类型生成，含确切命令）'],
        ['cmd', '取用命令（file / task / ref；url 为空）'],
        ['locator', '简短定位串（路径 / 链接 / #seq 标题 / 文档路径）'],
        ['isImage', '是否图片（kind=file 的子类型）'],
        ['needsSync', '本机文件缺失（true = 本机附件仓没有这个文件）'],
      ],
    },
    {
      label: '文件型（kind=file）· file 子对象',
      items: [
        ['file.localPath', '本机绝对路径（命中本机附件仓时才有值）'],
        ['file.fileId', '资源 id'],
        ['file.exists', '本机盘上是否已有副本'],
        ['localPath', 'file.localPath 的平铺别名（旧模板兼容）'],
        ['fileId', 'file.fileId 的平铺别名'],
      ],
    },
    {
      label: '文件夹型（kind=folder）· folder 子对象（#127）',
      items: [
        ['folder.absPath', '本地文件夹绝对路径（目录内容不入库）'],
        ['folder.exists', '目录当前是否可访问'],
        ['folder.missing', '目录是否已不在本机'],
        ['folder.readCmd', '查看该附件登记信息的命令'],
        ['usage', '取用说明：先列目录看结构，再用 Read 读需要的文件'],
      ],
    },
    {
      label: '链接型（kind=url）· url 子对象',
      items: [
        ['url.href', '可访问的完整链接，可直接抓取'],
        ['url.host', '链接域名（host）'],
        ['href', 'url.href 的平铺别名'],
        ['host', 'url.host 的平铺别名'],
        ['urlText', '链接字符串别名'],
      ],
    },
    {
      label: '任务型（kind=task）· task 子对象',
      items: [
        ['task.taskId', '本机 tasks.id（join 用；任务被清理后为 0）'],
        ['task.topicKey', '任务所在 topic key'],
        ['task.topicName', '任务所在 topic 名'],
        ['task.seq', 'topic 内编号（对外显示的任务号）'],
        ['task.title', '实时标题（正文首行，不是正文）'],
        ['task.status', '实时状态：pending/claimed/done/cancelled'],
        ['task.statusLabel', '状态显示名'],
        ['task.address', '地址 topicKey:seq'],
        ['task.storedAddress', '附件行里存的旧地址（搬家前）'],
        ['task.addressDrift', '地址是否已漂移（任务搬过 topic）'],
        ['task.resolved', '正文当前是否可读'],
        ['task.purged', '目标任务是否已被清理'],
        ['task.deleted', '目标任务是否已软删'],
        ['task.showCmd', '取正文命令：nx-kv localtask show --id <seq> --key <topicKey>'],
        ['seq', 'task.seq 的平铺别名'],
        ['title', 'task.title 的平铺别名'],
        ['showCmd', 'task.showCmd 的平铺别名'],
      ],
    },
    {
      label: '文档型（kind=ref）· ref 子对象',
      items: [
        ['ref.refId', 'refs 表 id（取正文用它，不依赖任何路径）'],
        ['ref.title', '文档标题（正文首行 # 标题，缺省回落 desc / 名字）'],
        ['ref.desc', '文档短描述（v7；快速定位这篇讲什么）'],
        ['ref.readCmd', '读取命令：nx-kv docs get --ref <refId>'],
        ['refId', 'ref.refId 的平铺别名'],
        ['readCmd', 'ref.readCmd 的平铺别名'],
      ],
    },
    {
      label: '通用',
      items: [
        ['task.id', '任务号'],
        ['task.text', '任务原文（交付模板等处仍在用）'],
      ],
    },
  ],
  timecheck: [
    {
      label: '时间目标',
      items: [
        ['goal.check', '时间检查指令（任务级；每轮 check 按当下模板渲染）'],
        ['goal.statusLine', '目录级目标状态行'],
        ['goal.name', '目标名'],
        ['goal.goalKey', '任务级目标 key（check --task 用）'],
        ['goal.durationHuman', '持续时长（人话，如 2 小时）'],
        ['goal.durationSec', '持续秒数'],
        ['goal.deadline', '截止时间'],
        ['goal.remainingSec', '剩余秒数'],
        ['goal.remainingHuman', '剩余时长（人话）'],
        ['goal.remainingMin', '剩余分钟（向上取整）'],
        ['goal.elapsedHuman', '已过时长（人话）'],
        ['goal.elapsedSec', '已过秒数'],
        ['goal.overtimeSec', '超时秒数'],
        ['goal.reached', '是否到点'],
        ['goal.extra', '发布方附加要求（领取后可动态改）'],
      ],
    },
    {
      label: '通用',
      items: [
        ['task.id', '任务号'],
        ['task.text', '任务实时原文'],
      ],
    },
  ],
  goalhint: [
    {
      label: '时间目标上下文（任务级）',
      items: [
        ['goal.goalKey', '任务级目标 key（check --task 用）'],
        ['goal.durationHuman', '持续时长（人话）'],
        ['goal.durationSec', '持续秒数'],
        ['goal.startedAt', '开始计时时间'],
        ['goal.deadline', '截止时间'],
        ['goal.remainingHuman', '剩余时长（人话）'],
        ['goal.remainingSec', '剩余秒数'],
        ['goal.elapsedHuman', '已过时长（人话）'],
        ['goal.elapsedSec', '已过秒数'],
        ['goal.overtimeSec', '超时秒数'],
        ['goal.reached', '是否到点'],
        ['goal.extra', '发布方附加要求（领取后可动态改）'],
      ],
    },
    {
      label: '任务',
      items: [
        ['task.id', '任务号'],
        ['task.text', '任务实时原文（check 返回对象同样可用）'],
      ],
    },
  ],
  // #90：未到点就 done 的拦截文案（blocked 返回里的 guard 字段）
  doneguard: [
    {
      label: '时间目标上下文（任务级）',
      items: [
        ['goal.blocked', '恒为 true（只在这条拦截路径上出现，交付渲染时整段省略）'],
        ['goal.goalKey', '任务级目标 key（check --task 用）'],
        ['goal.durationHuman', '持续时长（人话）'],
        ['goal.durationSec', '持续秒数'],
        ['goal.startedAt', '开始计时时间'],
        ['goal.deadline', '截止时间'],
        ['goal.remainingHuman', '剩余时长（人话）'],
        ['goal.remainingSec', '剩余秒数'],
        ['goal.elapsedHuman', '已过时长（人话）'],
        ['goal.elapsedSec', '已过秒数'],
      ],
    },
    {
      label: '任务',
      items: [
        ['task.id', '任务号'],
        ['task.text', '任务实时原文'],
      ],
    },
    {
      label: '可用的 helper（与所有区块同一套）',
      items: [
        ['percent goal.elapsedSec goal.durationSec', '已用百分比（0 位小数；可加第三参控制小数位）'],
        ['gte a b / gt / lt / lte / eq / ne / between v min max', '比较，返回布尔，可直接进 {{#if}}'],
        ['and / or / not', '逻辑'],
        ['add / sub / mul / div / mod / round / floor / ceil / ratio / clamp', '数值计算（坏输入输出 NaN，不抛错）'],
        ['includes / length / default', '字符串'],
        ['formatDuration', '秒数转人话'],
      ],
    },
  ],
  ext: [
    {
      label: '队列',
      items: [
        ['ext.topic', '主题 / 队列名'],
        ['ext.count', '待领取任务数'],
        ['ext.list', '待领取清单（可循环 id/title/topic）'],
      ],
    },
    {
      label: '通用',
      items: [['task.id', '任务号']],
    },
  ],
  ack: [
    {
      label: '通用',
      items: [
        ['task.id', '任务号'],
        ['task.text', '任务原文'],
        ['source', '任务来源（local/global）'],
        ['summary', '领取方现状'],
        ['name', '领取方名字'],
        ['cwd', '领取方目录'],
        ['params', '外部参数（k=v）'],
      ],
    },
  ],
  getloop: [
    {
      label: '持续 get',
      items: [
        ['getloop.text', '持续 get 指令正文（默认模板已内联，仅旧配置需要）'],
        ['getloop.waitMinutes', '单轮等待分钟数'],
      ],
    },
    {
      label: '通用',
      items: [['task.id', '任务号']],
    },
  ],
};
