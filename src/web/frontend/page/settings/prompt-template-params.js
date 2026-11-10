// 设置面板「提示词模板」的只读参数速查表：每区块**实际可用**的参数（参数名 + 一句含义）。
// 只做速查，不写语法/示例——引擎名称、选型理由、语法教程、示例模板与成段说明
// 仍然只写在 skill / docs，不放到设置页。
// 数据来自共享 ctx（delivery-template.js 的 buildDeliveryCtx）与 attach 的 attachTemplateCtx。
export const BLOCK_PARAMS = {
  context: [
    {
      label: '项目',
      items: [
        ['repo.name', '项目名'],
        ['repo.intro', '项目介绍正文'],
        ['repo.introPath', '介绍全文路径'],
        ['repo.docs', '补充文档（可循环 path/tag/note）'],
        ['repo.docCount', '补充文档数'],
        ['repo.refRepos', '本仓库直接绑定的参考仓库（repos 中 type=ref，不是文档库 refs；可循环 name/path/note）'],
        ['repo.refRepoCount', '本仓库直接绑定的参考仓库数'],
      ],
    },
    {
      label: '组',
      items: [
        ['group.name', '组名'],
        ['group.desc', '组定位'],
        ['group.intro', '组介绍正文'],
        ['group.note', '本项目在组里的位置'],
        ['group.peers', '组内成员（可循环 name/note）'],
        ['group.docs', '组绑定参考文件（可循环）'],
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
        ['kind', '类型：file / url / task / ref'],
        ['kindLabel', '类型显示名：附件/图片/链接/任务/文档'],
        ['name', '展示名（任务型为实时标题，不是正文）'],
        ['size', '字节数'],
        ['sizeText', '可读大小（1.2 MB）'],
        ['mime', 'MIME 类型'],
        ['storage', '存储来源：local / cloud / url / internal'],
        ['role', '关系角色：inline / reference / doc / attach'],
        ['origin', '来源：inline（正文内嵌）/ area（附件区）'],
        ['originLabel', '来源显示名'],
        ['usage', '取用说明（按类型生成，含确切命令）'],
        ['cmd', '取用命令（file 未同步 / task / ref；url 为空）'],
        ['locator', '简短定位串（路径 / 链接 / #seq 标题 / 文档路径）'],
        ['isImage', '是否图片（kind=file 的子类型）'],
        ['needsSync', '该条是否需要先同步到本地'],
      ],
    },
    {
      label: '文件型（kind=file）· file 子对象',
      items: [
        ['file.localPath', '本地绝对路径（已同步时才有值）'],
        ['file.fileId', '资源 id（未同步时用它拉取）'],
        ['file.exists', '本机盘上是否已有副本'],
        ['file.syncCmd', '未同步时的命令：nx-kv file sync --ids <fileId>'],
        ['localPath', 'file.localPath 的平铺别名（旧模板兼容）'],
        ['fileId', 'file.fileId 的平铺别名'],
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
        ['ref.refId', 'refs 表 id'],
        ['ref.title', '文档标题'],
        ['ref.relPath', '文档相对路径 / 外部 md 绝对路径'],
        ['ref.readCmd', '读取命令：nx-kv docs get rel:<路径>（或 path:<绝对路径>）'],
        ['refId', 'ref.refId 的平铺别名'],
        ['relPath', 'ref.relPath 的平铺别名'],
        ['readCmd', 'ref.readCmd 的平铺别名'],
      ],
    },
    {
      label: '同步汇总',
      items: [
        ['attach.syncSummary.text', '本次批量同步的一行汇总'],
        ['attach.syncSummary.dir', '同步目录'],
        ['attach.syncSummary.downloaded', '已下载数'],
        ['attach.syncSummary.skipped', '跳过数'],
        ['attach.syncSummary.failureCount', '失败数'],
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
        ['goal.check', '时间检查指令（任务级）'],
        ['goal.statusLine', '目录级目标状态行'],
        ['goal.name', '目标名'],
        ['goal.deadline', '截止时间'],
        ['goal.remainingSec', '剩余秒数'],
        ['goal.remainingMin', '剩余分钟（向上取整）'],
        ['goal.overtimeSec', '超时秒数'],
        ['goal.reached', '是否到点'],
      ],
    },
    {
      label: '通用',
      items: [['task.id', '任务号']],
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
        ['getloop.text', '持续 get 指令正文'],
        ['getloop.waitMinutes', '单轮等待分钟数'],
      ],
    },
    {
      label: '通用',
      items: [['task.id', '任务号']],
    },
  ],
};
