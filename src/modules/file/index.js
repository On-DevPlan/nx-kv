// 附件模块（双后端：云端图床的用户空间视图 + 本机附件仓）。
//
// 不声明 `resource`：这里的「集合」是附件存储的投影（云端图床 / 本机仓），
// `upload/sync` 是它的动作，硬凑 get/update/remove 五动词只会得到语义别扭的命令。
// 命令与路由仍然一一对应，所以「面板上能做的，CLI 都能做」依旧成立。
//
// 两条链路的分工（任务 #15 口径）：云端清单（todo）附件走图床；
// 本地任务（localtask）贴图走 --local 本机仓——不碰网、零云端依赖。
import * as service from './service.js';

// 所有动作都接受 --group 覆盖当前工作空间；默认取本机配置里的当前值
const GROUP = { type: 'number', hint: '工作空间 id（默认取当前）' };

export default {
  id: 'file',
  title: '附件',
  order: 40,
  // 没有独立面板：附件在「清单」页里被引用与预览，单独开一个 tab
  // 会得到第二个「附件列表」，反而不知道以哪个为准。

  actions: [
    {
      id: 'file.list',
      cli: ['file', 'list'],
      http: ['GET', '/api/file'],
      summary: '列出当前用户空间的附件（含本地已同步路径）',
      flags: {
        group: GROUP,
        limit: { type: 'number', default: 100 },
        offset: { type: 'number', default: 0 },
      },
      run: (ctx) => service.listFilesAction(ctx),
      render: (d) => service.renderFileList(d),
    },
    {
      id: 'file.upload',
      cli: ['file', 'upload'],
      http: ['POST', '/api/file'],
      summary: '上传附件（--local 存本机附件仓，本地任务贴图用；默认传当前用户空间的云端图床）',
      flags: {
        path: { type: 'string', hint: '本机文件路径' },
        content: { type: 'string', hint: 'base64 内容（面板上传用，可为 data URL）' },
        name: { type: 'string', hint: '文件名（content 上传时必填）' },
        contentType: { type: 'string', hint: '覆盖 Content-Type（默认按扩展名猜）' },
        local: { type: 'boolean', hint: '存本机附件仓（~/.nx-kv/attachments/local/），不碰云端' },
        accessLevel: { type: 'string', enum: ['public', 'private', 'protected'], default: 'public', hint: '出图权限；public 才能被 <img> 直接预览（--local 时无意义）' },
        group: GROUP,
      },
      run: (ctx) => service.uploadFileAction(ctx),
      render: (d) => service.renderUpload(d),
    },
    {
      id: 'file.get',
      cli: ['file', 'get'],
      http: ['GET', '/api/file/item'],
      summary: '查单个附件的元数据与本地路径',
      args: ['fileId'],
      flags: { group: GROUP },
      run: (ctx) => service.getFileAction(ctx.fileId, { group: ctx.group }),
      render: (d) => service.renderFileInfo(d),
    },
    {
      id: 'file.remove',
      cli: ['file', 'remove'],
      http: ['DELETE', '/api/file/item'],
      summary: '删除附件（后端软删；本地副本要清用 file sync --prune）',
      args: ['fileId'],
      flags: { group: GROUP },
      run: (ctx) => service.removeFileAction(ctx.fileId, { group: ctx.group }),
      render: (d) => service.renderRemove(d),
    },
    {
      id: 'file.content',
      // HTTP 侧直接透传文件本体（面板里 <img src="/api/file/content/<id>"> 预览）；
      // CLI 侧只打印地址与本地路径 —— 终端吐二进制没有意义。
      cli: ['file', 'content'],
      http: ['GET', '/api/file/content/:fileId'],
      stream: true,
      summary: '取附件本体：面板内联预览；CLI 打印出图地址与本地路径',
      args: ['fileId'],
      flags: { group: GROUP },
      run: (ctx) => (ctx.__raw
        ? service.serveContent(ctx)
        : service.getFileAction(ctx.fileId, { group: ctx.group })),
      render: (d) => service.renderContent(d),
    },
    {
      id: 'file.orphans',
      cli: ['file', 'orphans'],
      http: ['GET', '/api/file/orphans'],
      summary: '列出无主资源（没有任何任务/文档关系边；删任务、删文档、删正文行之后用）',
      run: () => service.listOrphanAttachmentsAction(),
      render: (d) => service.renderOrphans(d),
    },
    {
      id: 'file.prune',
      cli: ['file', 'prune'],
      http: ['POST', '/api/file/prune'],
      summary: '回收无主资源（DB 行 + 附件根目录内的本机/镜像字节；仍被引用的不删）',
      flags: {
        'dry-run': { type: 'boolean', hint: '只列清单不删除' },
        dryRun: { type: 'boolean', hint: '同 --dry-run（HTTP body 用）' },
      },
      run: (ctx) => service.pruneOrphanAttachmentsAction({ dryRun: (ctx.dryRun ?? ctx['dry-run']) === true }),
      render: (d) => service.renderPrune(d),
    },
    {
      id: 'file.sync',
      cli: ['file', 'sync'],
      http: ['POST', '/api/file/sync'],
      summary: '把附件同步到本机（默认全部；--ids 只同步指定附件）——为了不再依赖网络读附件',
      flags: {
        ids: { type: 'array', hint: '只同步这些 fileId（逗号分隔）' },
        dir: { type: 'string', hint: '本地目录（默认 ~/.nx-kv/attachments/<工作空间>/）' },
        prune: { type: 'boolean', hint: '删掉本地已不在后端的文件（仅全量同步时生效）' },
        dryRun: { type: 'boolean', hint: '只列出将下载什么，不落盘' },
        group: GROUP,
      },
      run: (ctx) => service.syncFilesAction(ctx),
      render: (d) => service.renderSync(d),
    },
  ],
};
